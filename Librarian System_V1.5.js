//@name long_memory_ai_assistant
//@display-name Librarian System v4.0 Pro (With LLM Processor)
//@author rusinus12@gmail.com
//@api 3.0
//@version 4.0.0

(async () => {
    // ══════════════════════════════════════════════════════════════
    // [CORE] Error Handler
    // ══════════════════════════════════════════════════════════════
    class LMAIError extends Error {
        constructor(message, code, cause = null) {
            super(message);
            this.name = 'LMAIError';
            this.code = code;
            this.cause = cause;
            this.timestamp = Date.now();
        }
    }

    // ══════════════════════════════════════════════════════════════
    // [UTILITY] State Management
    // ══════════════════════════════════════════════════════════════
    const MemoryState = {
        gcCursor: 0,
        hashIndex: new Map(),
        metaCache: null,
        simCache: null,
        sessionCache: new Map(), // LLM 응답 캐시
        isInitialized: false,
        currentTurn: 0,
        initVersion: 0,

        reset() {
            this.gcCursor = 0;
            this.hashIndex.clear();
            this.metaCache?.cache?.clear();
            this.simCache?.cache?.clear();
            this.sessionCache.clear();
            this.initVersion++;
        }
    };

    // ══════════════════════════════════════════════════════════════
    // [UTILITY] RWLock
    // ══════════════════════════════════════════════════════════════
    class RWLock {
        constructor() {
            this.readers = 0;
            this.writer = false;
            this.queue = [];
        }

        async readLock() {
            return new Promise(resolve => {
                if (!this.writer && this.queue.length === 0) {
                    this.readers++;
                    resolve();
                } else {
                    this.queue.push({ type: 'read', resolve });
                }
            });
        }

        async writeLock() {
            return new Promise(resolve => {
                if (!this.writer && this.readers === 0) {
                    this.writer = true;
                    resolve();
                } else {
                    this.queue.push({ type: 'write', resolve });
                }
            });
        }

        readUnlock() { this.readers--; this._next(); }
        writeUnlock() { this.writer = false; this._next(); }

        _next() {
            while (this.queue.length > 0) {
                const next = this.queue[0];
                if (next.type === 'write') {
                    if (this.readers === 0) {
                        this.queue.shift();
                        this.writer = true;
                        next.resolve();
                        return;
                    }
                    break;
                } else if (next.type === 'read') {
                    if (!this.writer) {
                        this.queue.shift();
                        this.readers++;
                        next.resolve();
                        continue;
                    }
                    break;
                }
            }
        }
    }

    const loreLock = new RWLock();

    // ══════════════════════════════════════════════════════════════
    // [UTILITY] LRU Cache
    // ══════════════════════════════════════════════════════════════
    class LRUCache {
        constructor(maxSize = 1000) {
            this.cache = new Map();
            this.maxSize = maxSize;
            this.hits = 0;
            this.misses = 0;
        }

        get(k) {
            if (!this.cache.has(k)) { this.misses++; return undefined; }
            this.hits++;
            const v = this.cache.get(k);
            this.cache.delete(k);
            this.cache.set(k, v);
            return v;
        }

        peek(k) { return this.cache.get(k); }

        set(k, v) {
            if (this.cache.has(k)) this.cache.delete(k);
            if (this.cache.size >= this.maxSize) {
                this.cache.delete(this.cache.keys().next().value);
            }
            this.cache.set(k, v);
        }

        has(k) { return this.cache.has(k); }
        delete(k) { return this.cache.delete(k); }
        clear() { this.cache.clear(); this.hits = 0; this.misses = 0; }
        get stats() {
            const total = this.hits + this.misses;
            return { size: this.cache.size, hitRate: total > 0 ? (this.hits / total).toFixed(3) : 0 };
        }
    }

    // ══════════════════════════════════════════════════════════════
    // [ENGINE] Tokenizer & Hash
    // ══════════════════════════════════════════════════════════════
    const TokenizerEngine = (() => {
        const simpleHash = (s) => {
            let h = 0;
            for (let i = 0; i < (s || "").length; i++) {
                h = Math.imul(31, h) ^ s.charCodeAt(i) | 0;
            }
            return h;
        };

        const getSafeMapKey = (text) => {
            const t = text || "";
            return `${simpleHash(t)}_${t.slice(0, 8)}_${t.slice(-4)}`;
        };

        const tokenize = (t) =>
            (t || "").toLowerCase()
                .replace(/[^\w가-힣\s]/g, ' ')
                .split(/\s+/)
                .filter(w => w.length > 1);

        const getIndexKey = (text) => {
            const tokens = tokenize(text);
            const textLen = text.length;
            let combined;
            if (tokens.length <= 8) {
                combined = tokens.join("_");
            } else {
                combined = [...tokens.slice(0, 5), ...tokens.slice(-3)].join("_");
            }
            return simpleHash(`${combined}_${textLen}`);
        };

        const estimateTokens = (text, type = 'simple') => {
            if (!text) return 0;
            const ratio = type === 'gpt4' ? 0.5 : 0.6;
            return Math.ceil(text.length * ratio) + (text.match(/\s/g) || []).length;
        };

        return { simpleHash, tokenize, getIndexKey, getSafeMapKey, estimateTokens };
    })();

    // ══════════════════════════════════════════════════════════════
    // [ENGINE] Embedding Queue
    // ══════════════════════════════════════════════════════════════
    const EmbeddingQueue = (() => {
        const q = [];
        const MAX_CONCURRENT = 2;
        let active = 0;
        let running = false;

        const run = async () => {
            if (running) return;
            running = true;
            try {
                while (q.length > 0 && active < MAX_CONCURRENT) {
                    active++;
                    const { task, resolve, reject } = q.shift();
                    try {
                        resolve(await task());
                    } catch (e) {
                        reject(e);
                    } finally {
                        active--;
                    }
                }
            } finally {
                running = false;
            }
        };

        return {
            enqueue: (task) => new Promise((res, rej) => {
                q.push({ task, resolve: res, reject: rej });
                run();
            }),
            get queueLength() { return q.length; },
            get activeCount() { return active; }
        };
    })();

    // ══════════════════════════════════════════════════════════════
    // [ENGINE] Emotion Analyzer (보조)
    // ══════════════════════════════════════════════════════════════
    const EmotionEngine = (() => {
        const NEGATION_WORDS = ['않', '안', '못', '말', '미', '노', '누', '구', '별로', '전혀', '절대'];
        const NEGATION_WINDOW = 5;

        const hasNegationNearby = (text, matchIndex, keyword) => {
            const start = Math.max(0, matchIndex - NEGATION_WINDOW - keyword.length);
            const end = Math.min(text.length, matchIndex + NEGATION_WINDOW);
            const context = text.slice(start, end);
            return NEGATION_WORDS.some(neg => context.includes(neg));
        };

        const analyze = (text) => {
            const lowerText = (text || "").toLowerCase();
            let score = 0;
            const emotions = { joy: 0, sadness: 0, anger: 0, fear: 0, surprise: 0, disgust: 0 };

            const keywords = {
                joy: ['기쁘', '행복', '좋아', '웃', '미소', '즐거'],
                sadness: ['슬프', '우울', '눈물', '울', '그리워'],
                anger: ['화나', '분노', '짜증', '열받'],
                fear: ['무서', '두려', '공포', '불안'],
                surprise: ['놀라', '충격', '깜짝'],
                disgust: ['역겨', '혐오', '싫어']
            };

            for (const [emotion, words] of Object.entries(keywords)) {
                for (const word of words) {
                    let idx = lowerText.indexOf(word);
                    while (idx !== -1) {
                        if (!hasNegationNearby(lowerText, idx, word)) {
                            emotions[emotion]++;
                            score++;
                        }
                        idx = lowerText.indexOf(word, idx + 1);
                    }
                }
            }

            const dominant = Object.entries(emotions).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1])[0];
            return {
                scores: emotions,
                dominant: dominant ? dominant[0] : 'neutral',
                intensity: Math.min(1, score / 5)
            };
        };

        return { analyze, NEGATION_WORDS };
    })();

    // ══════════════════════════════════════════════════════════════
    // [NEW] LLM Memory Processor (v4.0 핵심)
    // ══════════════════════════════════════════════════════════════
    const LLMProcessor = (() => {
        const MEMORY_PROMPT = `당신은 대화 기록을 분석하여 장기 기억 데이터를 생성하는 전문가입니다.

[입력]
최근 대화 내용

[작업]
1. 장기적으로 기억해야 할 핵심 정보 추출 (일상 인사/감정 표현 제외)
2. 사실(Fact), 선호(Preference), 관계(Relationship), 계획(Plan) 위주

[출력 형식] 오직 JSON만 출력:
{
  "shouldSave": true/false,
  "summary": "한 문장 요약 (50자 이내)",
  "facts": ["주체: 내용", "주체: 내용"],
  "importance": 1-10,
  "category": "personal|relationship|knowledge|plan|event",
  "entities": ["이름1", "이름2"],
  "sentiment": "positive|negative|neutral"
}

[규칙]
- 이미 알려진 정보나 중복 내용은 shouldSave: false
- 추측 금지, 명시된 내용만 저장
- 문장은 간결하게`;

        /**
         * LLM 호출을 통한 기억 처리
         * @param {string} userMsg - 사용자 메시지
         * @param {string} aiResponse - AI 응답
         * @param {object} config - 설정 객체
         * @returns {Promise<object|null>} 처리된 기억 객체 또는 null
         */
        const processMemory = async (userMsg, aiResponse, config) => {
            const model = config.mainModel;
            if (!model?.url || !model?.key) {
                // LLM 설정이 없으면 폴백: 원문 저장
                console.warn('[LMAI] No LLM configured, using fallback');
                return {
                    shouldSave: true,
                    summary: `[사용자] ${userMsg.slice(0, 50)}... [응답] ${aiResponse.slice(0, 50)}...`,
                    facts: [],
                    importance: 5,
                    category: 'personal',
                    entities: [],
                    sentiment: 'neutral',
                    fallback: true
                };
            }

            const inputText = `[사용자]\n${userMsg}\n\n[응답]\n${aiResponse}`;

            // 캐시 확인
            const cacheKey = TokenizerEngine.simpleHash(inputText);
            if (MemoryState.sessionCache.has(cacheKey)) {
                return MemoryState.sessionCache.get(cacheKey);
            }

            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000); // 10초 타임아웃

                const response = await risuai.fetch(model.url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${model.key}`
                    },
                    body: JSON.stringify({
                        model: model.model || 'gpt-4o-mini',
                        messages: [
                            { role: 'system', content: MEMORY_PROMPT },
                            { role: 'user', content: inputText }
                        ],
                        temperature: 0.3,
                        max_tokens: 500
                    }),
                    signal: controller.signal
                });

                clearTimeout(timeout);

                if (!response.ok) {
                    throw new LMAIError(`LLM API Error: ${response.status}`, 'LLM_API_ERROR');
                }

                const data = await response.json();
                const content = data.choices?.[0]?.message?.content || '';

                // JSON 추출 (```json ...``` 블록 처리)
                let jsonStr = content;
                const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
                if (jsonMatch) {
                    jsonStr = jsonMatch[1].trim();
                } else {
                    // { } 사이 내용 추출
                    const braceStart = content.indexOf('{');
                    const braceEnd = content.lastIndexOf('}');
                    if (braceStart !== -1 && braceEnd !== -1) {
                        jsonStr = content.slice(braceStart, braceEnd + 1);
                    }
                }

                const result = JSON.parse(jsonStr);

                // 검증
                if (typeof result.shouldSave !== 'boolean') {
                    result.shouldSave = true;
                }
                if (typeof result.importance !== 'number' || result.importance < 1 || result.importance > 10) {
                    result.importance = 5;
                }

                // 캐시 저장
                MemoryState.sessionCache.set(cacheKey, result);

                if (config.debug) {
                    console.log('[LMAI] LLM Processed:', result);
                }

                return result;

            } catch (e) {
                if (e.name === 'AbortError') {
                    console.warn('[LMAI] LLM Timeout - using fallback');
                } else {
                    console.error('[LMAI] LLM Processing Error:', e?.message || e);
                }

                // 에러 시 폴백
                return {
                    shouldSave: true,
                    summary: userMsg.slice(0, 100),
                    facts: [],
                    importance: 5,
                    category: 'personal',
                    entities: [],
                    sentiment: 'neutral',
                    fallback: true,
                    error: e?.message
                };
            }
        };

        return { processMemory };
    })();

    // ══════════════════════════════════════════════════════════════
    // [CORE] Memory Engine (v4.0)
    // ══════════════════════════════════════════════════════════════
    const MemoryEngine = (() => {
        const CONFIG = {
            maxLimit: 200,
            threshold: 5,
            simThreshold: 0.25,
            gcBatchSize: 5,
            tokenizerType: 'simple',
            weightMode: 'auto',
            weights: { importance: 0.3, similarity: 0.5, recency: 0.2 },
            debug: false,
            cbsEnabled: true,
            emotionEnabled: true,
            loreComment: "lmai_memory",
            injectionTemplate: "[관련 기억]\n{{memories}}\n[/관련 기억]",
            useLLM: true, // v4.0: LLM 사용 여부
            mainModel: { format: "openai", url: "", key: "", model: "gpt-4o-mini", temp: 0.3 },
            embedModel: { format: "openai", url: "", key: "", model: "text-embedding-3-small" }
        };

        const getMetaCache = () => {
            if (!MemoryState.metaCache) MemoryState.metaCache = new LRUCache(2000);
            return MemoryState.metaCache;
        };

        const getSimCache = () => {
            if (!MemoryState.simCache) MemoryState.simCache = new LRUCache(5000);
            return MemoryState.simCache;
        };

        const GENRE_KEYWORDS = {
            action: ['공격', '회피', '기습', '위험', '비명', '달려', '총', '검', '폭발', '피격', '격투', '추격'],
            romance: ['사랑', '좋아', '키스', '안아', '입술', '눈물', '손잡', '두근', '설레', '고백', '포옹', '그리워'],
            mystery: ['단서', '증거', '범인', '비밀', '거짓말', '수상', '추리', '의심', '진실', '조사', '누가', '왜'],
            daily: ['밥', '날씨', '오늘', '일상', '학교', '회사', '집에', '친구', '쇼핑', '영화', '산책']
        };

        const EMOTION_GENRE_MAP = {
            sadness: 'romance', anger: 'action', fear: 'mystery', joy: 'daily', surprise: 'action'
        };

        const detectGenreWeights = (query) => {
            if (CONFIG.weightMode !== 'auto') return null;
            const text = (query || "").toLowerCase();
            const scores = { action: 0, romance: 0, mystery: 0, daily: 0 };

            for (const [genre, words] of Object.entries(GENRE_KEYWORDS)) {
                for (const word of words) {
                    if (text.includes(word)) scores[genre]++;
                }
            }

            if (CONFIG.emotionEnabled) {
                const emotion = EmotionEngine.analyze(text);
                if (emotion.dominant !== 'neutral' && emotion.intensity > 0.3) {
                    const mapped = EMOTION_GENRE_MAP[emotion.dominant];
                    if (mapped && scores[mapped] !== undefined) {
                        scores[mapped] += emotion.intensity;
                    }
                }
            }

            const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
            if (top[1] < 1) return null;

            const PRESETS = {
                action: { similarity: 0.4, importance: 0.2, recency: 0.4 },
                romance: { similarity: 0.5, importance: 0.3, recency: 0.2 },
                mystery: { similarity: 0.4, importance: 0.5, recency: 0.1 },
                daily: { similarity: 0.3, importance: 0.3, recency: 0.4 }
            };

            return PRESETS[top[0]];
        };

        const calculateDynamicWeights = (query) => detectGenreWeights(query) || CONFIG.weights;
        const _log = (msg) => { if (CONFIG.debug) console.log(`[LMAI] ${msg}`); };
        const getSafeKey = (entry) => entry.id || TokenizerEngine.getSafeMapKey(entry.content || "");

        const META_PATTERN = /\[META:(\{[^}]+\})\]/;

        const parseMeta = (raw) => {
            const def = { t: 0, ttl: 0, imp: 5, type: 'context', cat: 'personal', ent: [] };
            if (typeof raw !== 'string') return def;
            try {
                const m = raw.match(META_PATTERN);
                return m ? { ...def, ...JSON.parse(m[1]) } : def;
            } catch { return def; }
        };

        const getCachedMeta = (entry) => {
            const key = getSafeKey(entry);
            const cache = getMetaCache();
            const cached = cache.peek(key);
            if (cached !== undefined) return cached;
            const m = parseMeta(entry.content);
            cache.set(key, m);
            return m;
        };

        const calcSimilarity = async (textA, textB) => {
            const hA = TokenizerEngine.simpleHash(textA);
            const hB = TokenizerEngine.simpleHash(textB);
            const cKey = hA < hB ? `${hA}_${hB}` : `${hB}_${hA}`;
            const simCache = getSimCache();
            if (simCache.has(cKey)) return simCache.get(cKey);

            const lenA = textA.length, lenB = textB.length;
            if (Math.abs(lenA - lenB) > Math.max(lenA, lenB) * 0.7) { simCache.set(cKey, 0); return 0; }

            const tA = new Set(TokenizerEngine.tokenize(textA));
            const tB = new Set(TokenizerEngine.tokenize(textB));
            let inter = 0;
            tA.forEach(w => { if (tB.has(w)) inter++; });
            const jaccard = (tA.size + tB.size) > 0 ? inter / (tA.size + tB.size - inter) : 0;

            if (jaccard < 0.1) { simCache.set(cKey, 0); return 0; }

            const vecA = await EmbeddingEngine.getEmbedding(textA);
            const vecB = await EmbeddingEngine.getEmbedding(textB);

            const score = (vecA && vecB)
                ? EmbeddingEngine.cosineSimilarity(vecA, vecB) * 0.7 + jaccard * 0.3
                : jaccard * 0.7;

            simCache.set(cKey, score);
            return score;
        };

        const calcRecency = (turn, current) => Math.exp(-Math.max(0, current - turn) / 20);

        // ═══════════════════════════════════════════════════════════
        // Embedding Engine
        // ═══════════════════════════════════════════════════════════
        const EmbeddingEngine = (() => {
            return {
                getEmbedding: async (text) => {
                    const cache = getSimCache();
                    if (cache.has(text)) return Promise.resolve(cache.get(text));

                    return EmbeddingQueue.enqueue(async () => {
                        const m = CONFIG.embedModel;
                        if (!m?.url) return null;

                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), 15000);

                        try {
                            const res = await risuai.fetch(m.url, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${m.key}`
                                },
                                body: JSON.stringify({ input: [text], model: m.model }),
                                signal: controller.signal
                            });
                            clearTimeout(timeout);

                            const data = await res.json();
                            const vec = data?.data?.[0]?.embedding;
                            if (vec) cache.set(text, vec);
                            return vec;
                        } catch (e) {
                            clearTimeout(timeout);
                            if (CONFIG.debug) console.warn(`[LMAI] Embedding Error:`, e?.message || e);
                            return null;
                        }
                    });
                },

                cosineSimilarity: (a, b) => {
                    if (!a || !b || a.length !== b.length) return 0;
                    let dot = 0, normA = 0, normB = 0;
                    for (let i = 0; i < a.length; i++) {
                        dot += a[i] * b[i];
                        normA += a[i] * a[i];
                        normB += b[i] * b[i];
                    }
                    return (normA && normB) ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
                }
            };
        })();

        // ═══════════════════════════════════════════════════════════
        // Memory Formatter (v4.0 - 개선된 포맷)
        // ═══════════════════════════════════════════════════════════
        const formatMemories = (memories) => {
            if (!memories || memories.length === 0) return '';

            const formatted = memories.map((m, i) => {
                const meta = getCachedMeta(m);
                const content = (m.content || "").replace(META_PATTERN, '').trim();
                const imp = meta.imp || 5;
                const cat = meta.cat || 'personal';
                const turn = meta.t || 0;

                // v4.0: 구조화된 내용 반환
                let entry = `[${i + 1}] (중요도:${imp}/10 | ${cat} | 턴:${turn})`;
                if (meta.summary) {
                    entry += `\n    요약: ${meta.summary}`;
                }
                entry += `\n    ${content}`;

                return entry;
            }).join('\n\n');

            return CONFIG.injectionTemplate.replace('{{memories}}', formatted);
        };

        // ═══════════════════════════════════════════════════════════
        // GC with State Update
        // ═══════════════════════════════════════════════════════════
        const incrementalGC = (allEntries, currentTurn) => {
            const toDelete = new Set();
            const totalEntries = allEntries.length;
            if (totalEntries === 0) return { entries: allEntries, deleted: 0 };

            const batchSize = CONFIG.gcBatchSize;
            for (let i = 0; i < batchSize; i++) {
                const idx = (MemoryState.gcCursor + i) % totalEntries;
                const entry = allEntries[idx];
                const meta = getCachedMeta(entry);
                if (meta.ttl !== -1 && (meta.t + meta.ttl) < currentTurn) {
                    toDelete.add(getSafeKey(entry));
                }
            }
            MemoryState.gcCursor = (MemoryState.gcCursor + batchSize) % Math.max(1, totalEntries);

            const managed = allEntries.filter(e => e.comment === CONFIG.loreComment);
            if (managed.length > CONFIG.maxLimit) {
                managed
                    .sort((a, b) => getCachedMeta(a).t - getCachedMeta(b).t)
                    .slice(0, managed.length - CONFIG.maxLimit)
                    .forEach(e => toDelete.add(getSafeKey(e)));
            }

            if (toDelete.size > 0) {
                MemoryState.hashIndex.forEach((set) => {
                    toDelete.forEach(item => set.delete(item));
                });
                MemoryState.hashIndex.forEach((set, key) => {
                    if (set.size === 0) MemoryState.hashIndex.delete(key);
                });
                return { entries: allEntries.filter(e => !toDelete.has(getSafeKey(e))), deleted: toDelete.size };
            }
            return { entries: allEntries, deleted: 0 };
        };

        // ═══════════════════════════════════════════════════════════
        // Public API
        // ═══════════════════════════════════════════════════════════
        return {
            CONFIG,
            getSafeKey,
            getCachedMeta,
            calcRecency,
            EmbeddingEngine,
            EmotionEngine,
            LLMProcessor,
            TokenizerEngine,
            formatMemories,

            rebuildIndex: (lorebook) => {
                _log("Rebuilding Hash Index...");
                MemoryState.hashIndex.clear();
                const entries = Array.isArray(lorebook) ? lorebook : [];
                entries.forEach(entry => {
                    if (entry.comment !== CONFIG.loreComment) return;
                    try {
                        const content = (entry.content || "").replace(META_PATTERN, '').trim();
                        if (content.length < 5) return;
                        const key = getSafeKey(entry);
                        const idxKey = TokenizerEngine.getIndexKey(content);
                        if (!MemoryState.hashIndex.has(idxKey)) MemoryState.hashIndex.set(idxKey, new Set());
                        MemoryState.hashIndex.get(idxKey).add(key);
                    } catch (e) {
                        console.error("[LMAI] Index Error:", e?.message || e);
                    }
                });
            },

            checkDuplication: async (content, existingList) => {
                const idxKey = TokenizerEngine.getIndexKey(content);
                const candidates = MemoryState.hashIndex.get(idxKey) || new Set();
                const map = new Map(existingList.map(e => [getSafeKey(e), e]));

                const checkPool = [...Array.from(candidates).map(k => map.get(k)).filter(Boolean), ...existingList.slice(-5)];
                const uniqueCheck = new Set(checkPool);

                for (const item of uniqueCheck) {
                    if (!item || !item.content) continue;
                    if (Math.abs(item.content.length - content.length) > content.length * 0.7) continue;
                    const sim = await calcSimilarity(item.content, content);
                    if (sim > 0.75) return true;
                }
                return false;
            },

            // ═══════════════════════════════════════════════════════════
            // [v4.0] prepareMemory - LLM Processing Integration
            // ═══════════════════════════════════════════════════════════
            prepareMemory: async (data, currentTurn, existingList, lorebook, char, chat) => {
                const { userMsg, aiResponse } = data;

                if (!userMsg && !aiResponse) return null;

                // 1. LLM으로 기억 처리
                let processed;
                if (CONFIG.useLLM) {
                    processed = await LLMProcessor.processMemory(userMsg || '', aiResponse || '', CONFIG);
                } else {
                    // 폴백
                    processed = {
                        shouldSave: true,
                        summary: `[사용자] ${userMsg?.slice(0, 50) || 'N/A'}... [응답] ${aiResponse?.slice(0, 50) || 'N/A'}...`,
                        facts: [],
                        importance: 5,
                        category: 'personal',
                        entities: [],
                        sentiment: 'neutral'
                    };
                }

                // 2. 저장 가치가 없으면 리턴
                if (!processed.shouldSave) {
                    _log("LLM decided not to save this memory");
                    return null;
                }

                // 3. GC 체크
                const managed = MemoryEngine.getManagedEntries(lorebook);
                if (managed.length >= Math.floor(CONFIG.maxLimit * 0.95)) {
                    _log(`Early GC: ${managed.length}/${CONFIG.maxLimit}`);
                    const gcResult = MemoryEngine.incrementalGC(lorebook, currentTurn);

                    if (gcResult.deleted > 0) {
                        _log(`GC removed ${gcResult.deleted} entries`);
                        lorebook.length = 0;
                        lorebook.push(...gcResult.entries);
                        MemoryEngine.rebuildIndex(lorebook);
                        if (char && chat !== undefined) {
                            MemoryEngine.setLorebook(char, chat, lorebook);
                        }
                    }
                }

                // 4. 중복 체크 (요약 기준)
                const summaryText = processed.summary || userMsg || '';
                const updatedList = lorebook || existingList;
                if (await MemoryEngine.checkDuplication(summaryText, updatedList)) {
                    _log("Duplicate memory detected");
                    return null;
                }

                // 5. 메타데이터 생성
                const imp = processed.importance || 5;
                const ttl = imp >= 9 ? -1 : 30;
                const meta = {
                    t: currentTurn,
                    ttl,
                    imp,
                    cat: processed.category || 'personal',
                    ent: processed.entities || [],
                    summary: processed.summary || '',
                    sentiment: processed.sentiment || 'neutral'
                };

                // 6. 내용 구성
                let contentStr = '';
                if (processed.facts && processed.facts.length > 0) {
                    contentStr = processed.facts.map(f => `[사실] ${f}`).join('\n');
                } else {
                    contentStr = summaryText;
                }

                // 7. 인덱스 등록
                const idxKey = TokenizerEngine.getIndexKey(contentStr);
                if (!MemoryState.hashIndex.has(idxKey)) MemoryState.hashIndex.set(idxKey, new Set());
                MemoryState.hashIndex.get(idxKey).add(TokenizerEngine.getSafeMapKey(contentStr));

                return {
                    key: "",
                    comment: CONFIG.loreComment,
                    content: `[META:${JSON.stringify(meta)}]\n${contentStr}\n`,
                    mode: "normal",
                    insertorder: 100,
                    alwaysActive: true
                };
            },

            retrieveMemories: async (query, currentTurn, candidates, vars, topK = 15) => {
                const cleanQuery = query.trim();
                const W = calculateDynamicWeights(cleanQuery);

                const validCandidates = candidates.filter(entry => {
                    const meta = getCachedMeta(entry);
                    return meta.ttl === -1 || (meta.t + meta.ttl) >= currentTurn;
                });

                const results = await Promise.all(validCandidates.map(async (entry) => {
                    const meta = getCachedMeta(entry);
                    const text = (entry.content || "").replace(META_PATTERN, '').trim();
                    const sim = await calcSimilarity(cleanQuery, text);
                    if (sim < CONFIG.simThreshold) return null;

                    const score = (sim * W.similarity)
                        + (calcRecency(meta.t, currentTurn) * W.recency)
                        + ((meta.imp / 10) * W.importance);

                    return { ...entry, _score: score };
                }));

                return results
                    .filter(Boolean)
                    .sort((a, b) => b._score - a._score)
                    .slice(0, topK);
            },

            incrementalGC,

            getLorebook: (char, chat) =>
                Array.isArray(char.lorebook) ? char.lorebook : (chat?.localLore || []),

            setLorebook: (char, chat, data) => {
                if (Array.isArray(char.lorebook)) char.lorebook = data;
                else if (chat) chat.localLore = data;
            },

            getManagedEntries: (lorebook) =>
                (Array.isArray(lorebook) ? lorebook : []).filter(e => e.comment === CONFIG.loreComment),

            getCacheStats: () => ({ meta: getMetaCache().stats, sim: getSimCache().stats }),

            getState: () => ({ ...MemoryState }),

            incrementTurn: () => { MemoryState.currentTurn++; return MemoryState.currentTurn; },
            getCurrentTurn: () => MemoryState.currentTurn,
            setTurn: (turn) => { MemoryState.currentTurn = turn; }
        };
    })();

    // ══════════════════════════════════════════════════════════════
    // [TRIGGER] RisuAI Event Handlers
    // ══════════════════════════════════════════════════════════════
    const writeMutex = { locked: false, queue: [] };

    const acquireLock = async () => {
        return new Promise(resolve => {
            if (!writeMutex.locked) {
                writeMutex.locked = true;
                resolve();
            } else {
                writeMutex.queue.push(resolve);
            }
        });
    };

    const releaseLock = () => {
        if (writeMutex.queue.length > 0) {
            const next = writeMutex.queue.shift();
            next();
        } else {
            writeMutex.locked = false;
        }
    };

    // ══════════════════════════════════════════════════════════════
    // GENERATE_BEFORE - Memory Inject
    // ══════════════════════════════════════════════════════════════
    if (typeof risuai !== 'undefined' && risuai.registerTrigger) {
        risuai.registerTrigger('GENERATE_BEFORE', async (data) => {
            try {
                const char = await risuai.getCharacter();
                if (!char) return data;

                const chat = char.chats?.[char.chatPage];
                if (!chat) return data;

                const lore = MemoryEngine.getLorebook(char, chat);
                const candidates = MemoryEngine.getManagedEntries(lore);

                if (candidates.length === 0) return data;

                const userMessage = data.messages?.[data.messages.length - 1]?.content || '';
                const query = userMessage.slice(0, 500);

                const memories = await MemoryEngine.retrieveMemories(
                    query,
                    MemoryEngine.getCurrentTurn(),
                    candidates,
                    {},
                    10
                );

                if (memories.length === 0) return data;

                const memoryText = MemoryEngine.formatMemories(memories);

                if (data.prompt) {
                    data.prompt = data.prompt + '\n\n' + memoryText;
                } else if (data.messages) {
                    data.messages.unshift({ role: 'system', content: memoryText });
                }

                if (MemoryEngine.CONFIG.debug) {
                    console.log(`[LMAI] Injected ${memories.length} memories`);
                }

                return data;
            } catch (e) {
                console.error('[LMAI] GENERATE_BEFORE Error:', e?.message || e);
                return data;
            }
        });

        // ══════════════════════════════════════════════════════════════
        // GENERATE_AFTER - Memory Save with LLM Processing
        // ══════════════════════════════════════════════════════════════
        risuai.registerTrigger('GENERATE_AFTER', async (data) => {
            try {
                const char = await risuai.getCharacter();
                if (!char) return data;

                const chat = char.chats?.[char.chatPage];
                if (!chat) return data;

                MemoryEngine.incrementTurn();

                const userMsg = data.userMessage || '';
                const aiResponse = data.reply || data.response || '';

                if (!userMsg && !aiResponse) return data;

                const lore = MemoryEngine.getLorebook(char, chat);

                await acquireLock();
                try {
                    // v4.0: LLM 처리된 기억 저장
                    const newMemory = await MemoryEngine.prepareMemory(
                        { userMsg, aiResponse },
                        MemoryEngine.getCurrentTurn(),
                        lore,
                        lore,
                        char,
                        chat
                    );

                    if (newMemory) {
                        lore.push(newMemory);
                        MemoryEngine.setLorebook(char, chat, lore);
                        await risuai.setCharacter(char);

                        if (MemoryEngine.CONFIG.debug) {
                            console.log(`[LMAI] Saved memory (Turn: ${MemoryEngine.getCurrentTurn()})`);
                        }
                    }
                } finally {
                    releaseLock();
                }

                return data;
            } catch (e) {
                console.error('[LMAI] GENERATE_AFTER Error:', e?.message || e);
                return data;
            }
        });

        // CHAT_START
        risuai.registerTrigger('CHAT_START', async (data) => {
            try {
                const char = await risuai.getCharacter();
                if (!char) return data;

                const chat = char.chats?.[char.chatPage];
                if (!chat) return data;

                const lore = MemoryEngine.getLorebook(char, chat);
                const managed = MemoryEngine.getManagedEntries(lore);

                let maxTurn = 0;
                for (const entry of managed) {
                    const meta = MemoryEngine.getCachedMeta(entry);
                    if (meta.t > maxTurn) maxTurn = meta.t;
                }

                MemoryEngine.setTurn(maxTurn + 1);
                MemoryEngine.rebuildIndex(lore);

                if (MemoryEngine.CONFIG.debug) {
                    console.log(`[LMAI] Chat started. Turn: ${MemoryEngine.getCurrentTurn()}, Memories: ${managed.length}`);
                }

                return data;
            } catch (e) {
                console.error('[LMAI] CHAT_START Error:', e?.message || e);
                return data;
            }
        });
    }

    // ══════════════════════════════════════════════════════════════
    // [MAIN] Initialization
    // ══════════════════════════════════════════════════════════════
    const updateConfigFromArgs = async () => {
        const cfg = MemoryEngine.CONFIG;
        let local = {};
        try {
            const saved = await risuai.pluginStorage.getItem('LMAI_Config');
            if (saved) local = typeof saved === 'string' ? JSON.parse(saved) : saved;
        } catch (e) {
            console.warn('[LMAI] Config load failed:', e?.message || e);
        }

        const getVal = (key, argName, type, parent = null, fallback = undefined) => {
            const localVal = parent ? local[parent]?.[key] : local[key];
            let argVal;
            if (argName) { try { argVal = risuai.getArgument(argName); } catch { } }
            const configVal = parent ? cfg[parent]?.[key] : cfg[key];

            const raw = localVal !== undefined ? localVal
                : argVal !== undefined ? argVal
                    : configVal !== undefined ? configVal
                        : fallback;

            if (raw === undefined || raw === null) return fallback;

            switch (type) {
                case 'number': {
                    const n = Number(raw);
                    return isNaN(n) ? (fallback ?? configVal) : n;
                }
                case 'boolean':
                    return raw === true || raw === 1 || raw === 'true' || raw === '1';
                default:
                    return String(raw);
            }
        };

        cfg.maxLimit = getVal('maxLimit', 'max_limit', 'number', null, 200);
        cfg.threshold = getVal('threshold', 'threshold', 'number', null, 5);
        cfg.simThreshold = getVal('simThreshold', 'sim_threshold', 'number', null, 0.25);
        cfg.debug = getVal('debug', 'debug', 'boolean', null, false);
        cfg.useLLM = getVal('useLLM', 'use_llm', 'boolean', null, true);
        cfg.injectionTemplate = getVal('injectionTemplate', 'injection_template', 'string', null, '[관련 기억]\n{{memories}}\n[/관련 기억]');

        cfg.mainModel = {
            url: getVal('url', 'main_url', 'string', 'mainModel', ''),
            key: getVal('key', 'main_key', 'string', 'mainModel', ''),
            model: getVal('model', 'main_model', 'string', 'mainModel', 'gpt-4o-mini'),
            temp: getVal('temp', 'main_temp', 'number', 'mainModel', 0.3)
        };
        cfg.embedModel = {
            url: getVal('url', 'embed_url', 'string', 'embedModel', ''),
            key: getVal('key', 'embed_key', 'string', 'embedModel', ''),
            model: getVal('model', 'embed_model', 'string', 'embedModel', 'text-embedding-3-small')
        };

        const mode = (getVal('weightMode', 'weight_mode', 'string', null, 'auto')).toLowerCase();
        cfg.weightMode = mode;

        const PRESETS = {
            romance: { similarity: 0.5, importance: 0.3, recency: 0.2 },
            action: { similarity: 0.4, importance: 0.2, recency: 0.4 },
            mystery: { similarity: 0.4, importance: 0.5, recency: 0.1 },
            daily: { similarity: 0.3, importance: 0.3, recency: 0.4 }
        };

        if (PRESETS[mode]) {
            cfg.weights = PRESETS[mode];
        } else {
            cfg.weights = {
                similarity: getVal('w_sim', 'w_sim', 'number', null, 0.5),
                importance: getVal('w_imp', 'w_imp', 'number', null, 0.3),
                recency: getVal('w_rec', 'w_rec', 'number', null, 0.2)
            };
        }
    };

    // Initialize
    try {
        console.log('[LMAI] v4.0 Pro Initializing...');
        await updateConfigFromArgs();

        if (typeof risuai !== 'undefined') {
            const char = await risuai.getCharacter();
            const chat = char?.chats?.[char.chatPage];
            const lore = MemoryEngine.getLorebook(char, chat);
            MemoryEngine.rebuildIndex(lore);
        }

        MemoryState.isInitialized = true;
        console.log(`[LMAI] v4.0 Pro Ready. LLM=${MemoryEngine.CONFIG.useLLM} | Mode=${MemoryEngine.CONFIG.weightMode}`);
    } catch (e) {
        console.error("[LMAI] Init Error:", e?.message || e, e?.stack);
    }

    // Export
    if (typeof globalThis !== 'undefined') {
        globalThis.LMAI = MemoryEngine;
    }

})();