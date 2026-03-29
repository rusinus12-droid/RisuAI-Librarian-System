//@name long_memory_ai_assistant
//@display-name Librarian System V1.0
//@author rusinus12@gmail.com
//@api 3.0
//@version 2.7.7
//@arg max_limit int Max number of memories to keep (Default: 150)
//@arg threshold int Minimum importance to save memory (Default: 5)
//@arg gc_frequency int Run GC every N turns (Default: 10)
//@arg emotion_enabled string Enable Emotion Engine (true/false, Default: true)
//@arg summary_threshold int Threshold to start memory consolidation (Default: 100)
//@arg lorebook_inject string Enable lorebook chat injection (true/false, Default: true)
//@arg debug string Enable debug logging (true/false, Default: false)
//@arg cbs_enabled string Enable CBS syntax processing (true/false, Default: true)
//@arg sim_threshold string Minimum similarity to retrieve (Default: 0.25)
//@link https://github.com/

/**
 * =============================================================================
 * LONG MEMORY & AI ASSISTANT v2.7.7 (Vertex & Copilot Support)
 * =============================================================================
 * [v2.7.7 Features]
 * 1. Multi-Provider Support: OpenAI, Google, Anthropic, OpenRouter, **Vertex AI**, **GitHub Copilot**
 * 2. [Merged] v2.1 Enterprise Hybrid Engine (Dedup, Score Bias Fix)
 * 3. [Improved] Async Background Queue (Non-blocking API calls)
 * 4. [Improved] Regex Optimization & Prompt Injection Defense
 * =============================================================================
 */

(async () => {
    try {
        console.log('[LMAI] v2.7.7 Initializing...');

        // ─────────────────────────────────────────────
        // [UTILITY] LRU Cache & Shared Resources
        // ─────────────────────────────────────────────
        class LRUCache {
            constructor(maxSize = 1000) {
                this.cache = new Map();
                this.maxSize = maxSize;
            }
            get(key) {
                if (!this.cache.has(key)) return undefined;
                const value = this.cache.get(key);
                this.cache.delete(key);
                this.cache.set(key, value);
                return value;
            }
            set(key, value) {
                if (this.cache.has(key)) this.cache.delete(key);
                if (this.cache.size >= this.maxSize) {
                    this.cache.delete(this.cache.keys().next().value);
                }
                this.cache.set(key, value);
            }
            has(key) { return this.cache.has(key); }
            delete(key) { return this.cache.delete(key); }
            clear() { this.cache.clear(); }
        }

        const sharedTokenCache = new LRUCache(2000);

        // ─────────────────────────────────────────────
        // [UTILITY] Background Task Queue (Async Handler)
        // ─────────────────────────────────────────────
        const BackgroundQueue = (() => {
            const taskQueue = [];
            let isProcessing = false;

            const processQueue = async () => {
                if (isProcessing || taskQueue.length === 0) return;

                isProcessing = true;
                const task = taskQueue.shift();

                try {
                    await task();
                } catch (error) {
                    console.error("[LMAI Queue] Task Execution Failed:", error);
                } finally {
                    isProcessing = false;
                    if (taskQueue.length > 0) {
                        setTimeout(processQueue, 200);
                    }
                }
            };

            return {
                enqueue: (task) => {
                    taskQueue.push(task);
                    if (!isProcessing) {
                        processQueue();
                    }
                },
                getPendingCount: () => taskQueue.length
            };
        })();

        // ─────────────────────────────────────────────
        // [ENGINE] Tokenizer Engine & Text Preprocessor
        // ─────────────────────────────────────────────
        const TokenizerEngine = (() => {
            const tokenCache = sharedTokenCache;

            const TOKENIZER_TYPES = {
                SIMPLE: 'simple', GPT4: 'gpt4', GPT4O: 'gpt4o', CLAUDE: 'claude', GEMINI: 'gemini', CUSTOM: 'custom'
            };

            const TOKEN_RATIOS = {
                simple: { en: 0.25, ko: 0.5, other: 0.4 },
                gpt4: { en: 0.25, ko: 0.5, other: 0.4 },
                gpt4o: { en: 0.22, ko: 0.45, other: 0.35 },
                claude: { en: 0.25, ko: 0.55, other: 0.4 },
                gemini: { en: 0.25, ko: 0.5, other: 0.4 }
            };

            const detectLanguage = (text) => {
                if (!text || typeof text !== 'string') return 'other';
                const koreanChars = (text.match(/[가-힣]/g) || []).length;
                const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
                const totalChars = text.replace(/\s/g, '').length;
                if (totalChars === 0) return 'other';
                if (koreanChars / totalChars > 0.3) return 'ko';
                if (englishChars / totalChars > 0.5) return 'en';
                return 'other';
            };

            const simpleHash = (str) => {
                if (typeof str !== 'string') return 0;
                let hash = 0;
                for (let i = 0; i < str.length; i++) {
                    hash = ((hash << 5) - hash) + str.charCodeAt(i);
                    hash |= 0;
                }
                return hash;
            };

            const estimateTokens = (text, tokenizerType = 'simple') => {
                if (!text || typeof text !== 'string') return 0;
                const cacheKey = tokenizerType + ':' + simpleHash(text);
                if (tokenCache.has(cacheKey)) return tokenCache.get(cacheKey);

                const ratios = TOKEN_RATIOS[tokenizerType] || TOKEN_RATIOS.simple;
                const lang = detectLanguage(text);
                const ratio = ratios[lang] || ratios.other;

                let tokens = Math.ceil(text.length * ratio);
                const words = text.split(/\s+/).filter(w => w.length > 0);
                const punctuation = (text.match(/[.,!?;:'"()\[\]{}]/g) || []).length;
                const newlines = (text.match(/\n/g) || []).length;

                tokens = Math.max(tokens, words.length);
                tokens += Math.floor(punctuation * 0.3);
                tokens += newlines;
                tokens = Math.max(tokens, 1);

                tokenCache.set(cacheKey, tokens);
                return tokens;
            };

            const countTokensViaAPI = async (text, apiUrl, apiKey) => {
                if (!apiUrl || !text) return null;
                try {
                    const headers = { 'Content-Type': 'application/json' };
                    if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
                    const res = await risuai.nativeFetch(apiUrl, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ text })
                    });
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    const data = await res.json();
                    return data.token_count || data.count || null;
                } catch (e) {
                    console.error('[LMAI] Tokenizer API error:', e);
                    return null;
                }
            };

            return {
                TOKENIZER_TYPES,

                countTokens: async (text, config = {}) => {
                    if (!text || typeof text !== 'string') return 0;
                    const type = config.type || 'simple';
                    if (type === 'custom' && config.customUrl) {
                        const apiResult = await countTokensViaAPI(text, config.customUrl, config.customKey);
                        if (apiResult !== null) return apiResult;
                    }
                    return estimateTokens(text, type);
                },

                countTokensSync: (text, type = 'simple') => estimateTokens(text, type),

                tokenize: (text) => {
                    if (typeof text !== 'string') return [];
                    const key = text.trim().toLowerCase();
                    if (tokenCache.has(key)) return tokenCache.get(key);
                    const tokens = key.replace(/[^\w가-힣\s]/g, ' ').split(/\s+/).filter(w => w.length > 1);
                    tokenCache.set(key, tokens);
                    return tokens;
                },

                getTokenStats: (text, type = 'simple') => {
                    if (!text || typeof text !== 'string') {
                        return { tokens: 0, chars: 0, words: 0, ratio: 0, language: 'other', tokenizer: type };
                    }
                    const tokens = estimateTokens(text, type);
                    const chars = text.length;
                    const words = text.split(/\s+/).filter(w => w.length > 0).length;
                    const lang = detectLanguage(text);
                    return { tokens, chars, words, ratio: (tokens / chars).toFixed(3), language: lang, tokenizer: type };
                },

                detectLanguage
            };
        })();

        // ─────────────────────────────────────────────
        // [CORE] Memory Engine (v2.1 Enterprise Hybrid Merged)
        // ─────────────────────────────────────────────
        const MemoryEngine = (() => {
            const CONFIG = {
                version: "mem_v2.1_hybrid_merged",
                maxLimit: 150, threshold: 5, simThreshold: 0.25, 
                dedupRange: 30, dedupRandomSample: 30,
                defaultDecay: 20, cacheClearThreshold: 1000, gcFrequency: 10,
                maxTokensPerMemory: 500,
                tokenizerType: 'simple',
                customTokenizerUrl: '',
                customTokenizerKey: '',
                ttlValues: { core: -1, episodicMult: 30, context: 30 },
                weights: { importance: 0.3, similarity: 0.6, recency: 0.1 },
                debug: false, translationFilter: false,
                thinkingEnabled: false, thinkingLevel: 'medium',
                loreComment: "lmai_memory", chatLoreComment: "lmai_chat_memory", archiveComment: "lmai_archive",
                cbsEnabled: true, emotionEnabled: true, summaryThreshold: 80,
                mainModel: { format: "openai", url: "", key: "", model: "", temp: 0.7 },
                embedModel: { format: "openai", url: "", key: "", model: "text-embedding-3-small" }
            };

            const metaCache = new LRUCache(2000);
            const tokenCache = sharedTokenCache;
            const simCache = new LRUCache(3000);
            const embeddingFailCache = new LRUCache(500);
            const _log = (msg) => { if (CONFIG.debug) console.log(`[LMAI v2.1 Hybrid] ${msg}`); };

            const simpleHash = (str) => {
                if (typeof str !== 'string') return 0;
                let hash = 0;
                for (let i = 0; i < str.length; i++) {
                    hash = ((hash << 5) - hash) + str.charCodeAt(i);
                    hash |= 0;
                }
                return hash;
            };

            const getTrigrams = (s) => {
                if (typeof s !== 'string') return new Set();
                const t = new Set();
                for (let i = 0; i < s.length - 2; i++) t.add(s.substring(i, i + 3));
                return t;
            };

            const getSafeKey = (entry) => entry.id || `mem_${TokenizerEngine.countTokensSync(entry.content || "null", 'simple')}_${(entry.content || "null").substring(0, 20)}`;

            const getCachedMeta = (entry) => {
                if (!entry || typeof entry.content !== 'string') return null;
                const key = getSafeKey(entry);
                if (metaCache.has(key)) return metaCache.get(key);
                const meta = parseMeta(entry.content);
                metaCache.set(key, meta);
                return meta;
            };

            const parseMeta = (raw) => {
                const def = { t: 0, ttl: 0, imp: 5, type: 'context', turn: 0, tokens: 0, vars: {} };
                if (typeof raw !== 'string') return def;
                try {
                    const m = raw.match(/<!--MEM:({[\s\S]*?})-->/);
                    if (m && m[1]) return { ...def, ...JSON.parse(m[1]) };
                } catch (e) {}
                return def;
            };

            const calcRecency = (turn, currentTurn) => {
                const age = currentTurn - turn;
                return age < 0 ? 1 : Math.exp(-age / CONFIG.defaultDecay);
            };

            const isExpired = (meta, currentTurn) => {
                if (!meta || meta.ttl === -1) return false;
                return (meta.t + meta.ttl) < currentTurn;
            };

            const calcSimilarity = async (textA, textB) => {
                if (typeof textA !== 'string' || typeof textB !== 'string') return 0;

                const cKey = `${simpleHash(textA)}_${simpleHash(textB)}`;
                if (simCache.has(cKey)) return simCache.get(cKey);

                let score = 0;
                const m = CONFIG.embedModel;

                if (m.url && m.key) {
                    const failKey = `${simpleHash(textA)}|${simpleHash(textB)}`;
                    if (!embeddingFailCache.has(failKey)) {
                        try {
                            const vecA = await EmbeddingEngine.getEmbedding(textA);
                            const vecB = await EmbeddingEngine.getEmbedding(textB);
                            if (vecA && vecB) {
                                score = EmbeddingEngine.cosineSimilarity(vecA, vecB);
                                simCache.set(cKey, score);
                                return score;
                            }
                        } catch (e) {
                            embeddingFailCache.set(failKey, true);
                        }
                    }
                }

                if (score === 0 || !m.url) {
                    const setA = new Set(TokenizerEngine.tokenize(textA));
                    const setB = new Set(TokenizerEngine.tokenize(textB));
                    if (setA.size > 0 && setB.size > 0) {
                        let inter = 0;
                        setA.forEach(w => { if (setB.has(w)) inter++; });
                        const tSim = inter / (setA.size + setB.size - inter);
                        const triA = getTrigrams(textA);
                        const triB = getTrigrams(textB);
                        let triInter = 0;
                        triA.forEach(t => { if (triB.has(t)) triInter++; });
                        const nSim = (triA.size + triB.size - triInter) > 0 ? triInter / (triA.size + triB.size - triInter) : 0;
                        score = (tSim * 0.6) + (nSim * 0.4);
                    }
                }

                simCache.set(cKey, score);
                return score;
            };

            return {
                CONFIG, calcSimilarity, getSafeKey, getCachedMeta, calcRecency, isExpired,

                prepareMemory: async (data, currentTurn, existingList, currentVars = {}) => {
                    const { content, importance } = data;
                    if (typeof content !== 'string' || content.trim().length < 5) return null;
                    const imp = importance || 5;
                    if (imp < CONFIG.threshold) return null;

                    const cleanContent = CBSEngine.clean(content);

                    // [v2.1 Hybrid] Long-term Dedup: Random Sampling
                    const recent = existingList.slice(-CONFIG.dedupRange);
                    const oldItems = existingList.slice(0, existingList.length - CONFIG.dedupRange);
                    const randomSample = [];
                    if (oldItems.length > 0) {
                        for(let i = 0; i < CONFIG.dedupRandomSample && i < oldItems.length; i++) {
                            const idx = Math.floor(Math.random() * oldItems.length);
                            randomSample.push(oldItems[idx]);
                        }
                    }
                    const checkPool = [...recent, ...randomSample];

                    const sims = await Promise.all(checkPool.map(item => 
                        item?.content ? calcSimilarity(CBSEngine.clean(item.content), cleanContent) : Promise.resolve(0)
                    ));
                    if (sims.some(s => s > 0.75)) {
                        _log("Dedup: Semantic match found (Recent or Random Sample).");
                        return null;
                    }

                    const type = (/(이름|나이|직업|성별|거주|관계|특징)/.test(content) || imp >= 9) ? 'core' : (imp >= 6 ? 'episodic' : 'context');
                    const ttl = type === 'core' ? -1 : (type === 'episodic' ? imp * CONFIG.ttlValues.episodicMult : CONFIG.ttlValues.context);

                    const tokenConfig = { type: CONFIG.tokenizerType, customUrl: CONFIG.customTokenizerUrl, customKey: CONFIG.customTokenizerKey };
                    let finalContent = content;
                    const tokenCount = await TokenizerEngine.countTokens(content, tokenConfig);
                    if (tokenCount > CONFIG.maxTokensPerMemory) {
                        _log(`Memory truncated: ${tokenCount} > ${CONFIG.maxTokensPerMemory} tokens`);
                        const ratio = CONFIG.maxTokensPerMemory / tokenCount;
                        finalContent = content.substring(0, Math.floor(content.length * ratio * 0.9));
                    }

                    const snapshot = {};
                    ['world', 'floor', 'hp', 'location'].forEach(k => {
                        if (currentVars[k] !== undefined) snapshot[k] = currentVars[k];
                    });

                    const actualTokens = await TokenizerEngine.countTokens(finalContent, tokenConfig);
                    const meta = { t: currentTurn, ttl, imp, type, turn: currentTurn, tokens: actualTokens, vars: snapshot };

                    return { 
                        key: "", comment: CONFIG.loreComment, 
                        content: `\n${finalContent}\n<!--MEM:${JSON.stringify(meta)}-->`, 
                        mode: "normal", insertorder: 100, alwaysActive: true 
                    };
                },

                retrieveMemories: async (query, currentTurn, candidates, currentVars, topK = 15) => {
                    const W = CONFIG.weights;
                    const cleanQuery = CBSEngine.clean(query);
                    const currentWorld = currentVars['world'];

                    const validCandidates = [];
                    for (const entry of candidates) {
                        const meta = getCachedMeta(entry);
                        if (!meta || isExpired(meta, currentTurn)) continue;
                        if (CONFIG.cbsEnabled && meta.cbs && !CBSEngine.evalCondition(meta.cbs, currentVars)) continue;
                        validCandidates.push({ entry, meta, cleanContent: CBSEngine.clean(entry.content) });
                    }

                    const similarities = await Promise.all(
                        validCandidates.map(({ cleanContent }) => calcSimilarity(cleanQuery, cleanContent))
                    );

                    const scored = validCandidates.map(({ entry, meta, cleanContent }, i) => {
                        const sim = similarities[i];
                        if (sim < CONFIG.simThreshold) return null;

                        let worldBonus = 0;
                        if (currentWorld && meta.vars && meta.vars.world === currentWorld) {
                            worldBonus = 0.2; 
                        }

                        // [v2.1 Hybrid] Score Bias Correction
                        const normImp = meta.imp / 10;
                        const score = (sim * W.similarity) + (calcRecency(meta.t, currentTurn) * W.recency) + (normImp * W.importance * sim) + worldBonus;

                        return {
                            ...entry,
                            _score: score,
                            _meta: meta
                        };
                    }).filter(Boolean);

                    return scored.sort((a, b) => b._score - a._score).slice(0, topK);
                },

                cleanupMemories: (allEntries, currentTurn) => {
                    if (currentTurn % CONFIG.gcFrequency !== 0) return { cleanedList: null, deletedCount: 0 };

                    const toDelete = new Set();
                    allEntries.forEach(e => {
                        if (e.comment === CONFIG.loreComment && isExpired(getCachedMeta(e), currentTurn)) toDelete.add(getSafeKey(e));
                    });

                    const managed = allEntries.filter(e => e.comment === CONFIG.loreComment && !toDelete.has(getSafeKey(e)));
                    if (managed.length > CONFIG.maxLimit) {
                        managed
                            .map(e => { const m = getCachedMeta(e); return { ...e, _delScore: (m.imp / 10 * 0.6) + (calcRecency(m.t, currentTurn) * 0.4) }; })
                            .sort((a, b) => a._delScore - b._delScore)
                            .slice(0, managed.length - CONFIG.maxLimit)
                            .forEach(e => toDelete.add(getSafeKey(e)));
                    }
                    return { cleanedList: allEntries.filter(e => !toDelete.has(getSafeKey(e))), deletedCount: toDelete.size };
                },

                getLorebook: (char, chat) => {
                    if (Array.isArray(char.lorebook)) return char.lorebook;
                    if (chat && Array.isArray(chat.localLore)) return chat.localLore;
                    return [];
                },

                setLorebook: (char, chat, data) => {
                    if (Array.isArray(char.lorebook)) {
                        char.lorebook = data;
                    } else if (chat) {
                        chat.localLore = data;
                    }
                },

                getManagedEntries: (lorebook) => Array.isArray(lorebook) ? lorebook.filter(e => e.comment === CONFIG.loreComment || e.comment === CONFIG.archiveComment) : [],

                getTotalTokens: async (lorebook) => {
                    const entries = MemoryEngine.getManagedEntries(lorebook);
                    const tokenConfig = { type: CONFIG.tokenizerType, customUrl: CONFIG.customTokenizerUrl, customKey: CONFIG.customTokenizerKey };
                    let total = 0;
                    for (const entry of entries) {
                        const meta = getCachedMeta(entry);
                        if (meta && meta.tokens) {
                            total += meta.tokens;
                        } else {
                            total += await TokenizerEngine.countTokens(CBSEngine.clean(entry.content), tokenConfig);
                        }
                    }
                    return total;
                }
            };
        })();

        // ─────────────────────────────────────────────
        // [ENGINES] CBSEngine (Regex Optimized)
        // ─────────────────────────────────────────────
        const CBSEngine = (() => {
            const R = /^(\w+)\s*(>=|<=|==|!=|>|<)\s*(".*?"|-?\d+\.?\d*)$/;
            const safeTrim = (v) => typeof v === "string" ? v.trim() : "";

            function parseDefaultVariables(raw) {
                return String(raw || "").split(/\r?\n/g).map((line) => line.trim()).filter(Boolean).map((line) => {
                    const eq = line.indexOf("=");
                    if (eq === -1) return null;
                    return [line.slice(0, eq).trim(), line.slice(eq + 1)];
                }).filter((pair) => pair && pair[0]);
            }

            function splitTopLevelCbsByDoubleColon(raw) {
                const src = String(raw || "");
                const result = [];
                let current = "", braceDepth = 0, parenDepth = 0;
                for (let i = 0; i < src.length; i += 1) {
                    const two = src.slice(i, i + 2);
                    if (two === "{{") { braceDepth += 1; current += two; i += 1; continue; }
                    if (two === "}}" && braceDepth > 0) { braceDepth -= 1; current += two; i += 1; continue; }
                    if (src[i] === "(") parenDepth += 1;
                    if (src[i] === ")" && parenDepth > 0) parenDepth -= 1;
                    if (two === "::" && braceDepth === 0 && parenDepth === 0) { result.push(current); current = ""; i += 1; continue; }
                    current += src[i];
                }
                result.push(current);
                return result;
            }

            // [Optimized] String search instead of complex Regex for performance
            function findNextCbsTag(text, startIndex) {
                const src = String(text || "");
                for (let i = startIndex; i < src.length - 1; i++) {
                    if (src[i] === '{' && src[i + 1] === '{') {
                        let depth = 1;
                        let j = i + 2;
                        while (j < src.length - 1) {
                            if (src[j] === '{' && src[j + 1] === '{') { depth++; j++; }
                            else if (src[j] === '}' && src[j + 1] === '}') {
                                depth--;
                                if (depth === 0) {
                                    return { start: i, end: j + 2, inner: src.substring(i + 2, j), raw: src.substring(i, j + 2) };
                                }
                                j++;
                            }
                            j++;
                        }
                        return null;
                    }
                }
                return null;
            }

            function extractCbsBlock(text, startTag, blockName) {
                let depth = 1, cursor = startTag.end, elseTag = null;
                while (cursor < text.length) {
                    const tag = findNextCbsTag(text, cursor);
                    if (!tag) break;
                    const inner = safeTrim(tag.inner);
                    if (inner.startsWith(`#${blockName} `)) depth += 1;
                    else if (inner === `/${blockName}`) { depth -= 1; if (depth === 0) return { body: text.slice(startTag.end, elseTag ? elseTag.start : tag.start), elseBody: elseTag ? text.slice(elseTag.end, tag.start) : "", end: tag.end }; }
                    else if (inner === "else" && depth === 1 && blockName === "if") elseTag = tag;
                    cursor = tag.end;
                }
                return { body: text.slice(startTag.end), elseBody: "", end: text.length };
            }

            async function getStandaloneCbsRuntime() {
                const char = await risuai.getCharacter();
                const chat = (char && char.chats && char.chatPage !== undefined) ? char.chats[char.chatPage] : {};
                let db = null; try { db = await risuai.getDatabase(); } catch {}
                const vars = Object.create(null);
                for (const [k, v] of parseDefaultVariables(char?.defaultVariables)) vars[k] = String(v ?? "");
                for (const [k, v] of parseDefaultVariables(db?.templateDefaultVariables)) if (!(k in vars)) vars[k] = String(v ?? "");
                const scriptState = chat?.scriptstate && typeof chat.scriptstate === "object" ? chat.scriptstate : {};
                for (const [rawKey, value] of Object.entries(scriptState)) { const key = String(rawKey || ""); vars[key] = value == null ? "null" : String(value); }
                const globalVars = db?.globalChatVariables && typeof db.globalChatVariables === "object" ? db.globalChatVariables : {};
                const userName = safeTrim(db?.username || "User");
                const finalDb = { ...db, globalNote: chat?.localLore?.globalNote || db?.globalNote || "" };
                return { char, chat, db: finalDb, vars, globalVars, userName, functions: Object.create(null) };
            }

            function evalStandaloneCbsCalc(expression) {
                const src = String(expression || "").replace(/\s+/g, " ").trim();
                if (!src) return "";
                const looksConditional = /[<>=!&|]/.test(src);
                if (src.includes("{{") || src.includes("}}") || src.includes("[CBS_")) return looksConditional ? "0" : src;

                const whitelistRegex = /^[\d\s()+\-*/%<>=!&|.,'"_[\]]+$/;
                const blacklist = ["window", "process", "document", "risuai", "require", "import", "Function", "eval", "constructor", "prototype", "__proto__"];

                if (!whitelistRegex.test(src) || blacklist.some(k => src.includes(k))) {
                    return looksConditional ? "0" : src;
                }

                try {
                    const result = Function(`"use strict"; return (${src});`)();
                    if (typeof result === "boolean") return result ? "1" : "0";
                    return result == null ? "" : String(result);
                } catch { return looksConditional ? "0" : src; }
            }

            function isStandaloneCbsTruthy(value) {
                const src = safeTrim(String(value ?? ""));
                if (!src || src === "0" || src.toLowerCase() === "false" || src.toLowerCase() === "null") return false;
                return true;
            }

            async function evalStandaloneCbsExpr(inner, runtime, args = []) {
                let expr = safeTrim(inner); if (!expr) return "";
                if (expr.includes("{{")) { expr = safeTrim(await renderStandaloneCbsText(expr, runtime, args)); if (!expr) return ""; }
                if (expr === "char" || expr === "Char") return safeTrim(runtime?.char?.name || "Char");
                if (expr === "user" || expr === "User") return runtime?.userName || "User";
                const parts = splitTopLevelCbsByDoubleColon(expr).map((s) => String(s ?? ""));
                const head = safeTrim(parts[0] || "");
                if (head === "arg") { const index = Math.max(0, (parseInt(safeTrim(parts[1] || "1"), 10) || 1) - 1); return args[index] ?? "null"; }
                if (head === "getvar") { const keyRaw = parts.slice(1).join("::"); const key = safeTrim(await renderStandaloneCbsText(keyRaw, runtime, args)); if (!key) return "null"; if (Object.prototype.hasOwnProperty.call(runtime.vars, key)) return runtime.vars[key]; if (Object.prototype.hasOwnProperty.call(runtime.globalVars, key)) return runtime.globalVars[key]; return "null"; }
                if (head === "calc") { const expression = await renderStandaloneCbsText(parts.slice(1).join("::"), runtime, args); return evalStandaloneCbsCalc(expression); }
                if (head === "call") { const fnName = safeTrim(await renderStandaloneCbsText(parts[1] || "", runtime, args)); const fnBody = runtime.functions[fnName]; if (!fnBody) return ""; const callArgs = []; for (let i = 2; i < parts.length; i += 1) callArgs.push(await renderStandaloneCbsText(parts[i], runtime, args)); return await renderStandaloneCbsText(fnBody, runtime, callArgs); }
                if (head === "none") return "";
                if (head === "char_desc") return safeTrim(runtime?.char?.desc || runtime?.char?.description || "");
                if (head === "ujb" || head === "system_note") return safeTrim(runtime?.db?.globalNote || "");
                if (head === "random") { const choices = parts.slice(1); if (choices.length === 0) return ""; const randIdx = Math.floor(Math.random() * choices.length); return await renderStandaloneCbsText(choices[randIdx], runtime, args); }
                if (head === "token_count") { const text = await renderStandaloneCbsText(parts.slice(1).join("::"), runtime, args); return String(TokenizerEngine.countTokensSync(text, MemoryEngine.CONFIG.tokenizerType)); }
                if (["equal", "not_equal", "greater", "greater_equal", "less", "less_equal"].includes(head)) {
                    const v1 = await renderStandaloneCbsText(parts[1] || "", runtime, args), v2 = await renderStandaloneCbsText(parts[2] || "", runtime, args);
                    const n1 = Number(v1), n2 = Number(v2), isNum = !isNaN(n1) && !isNaN(n2);
                    switch(head) {
                        case "equal": return v1 === v2 ? "1" : "0"; case "not_equal": return v1 !== v2 ? "1" : "0";
                        case "greater": return (isNum ? n1 > n2 : v1 > v2) ? "1" : "0"; case "greater_equal": return (isNum ? n1 >= n2 : v1 >= v2) ? "1" : "0";
                        case "less": return (isNum ? n1 < n2 : v1 < v2) ? "1" : "0"; case "less_equal": return (isNum ? n1 <= n2 : v1 <= v2) ? "1" : "0";
                    }
                }
                if (Object.prototype.hasOwnProperty.call(runtime.vars, expr)) return runtime.vars[expr];
                if (Object.prototype.hasOwnProperty.call(runtime.globalVars, expr)) return runtime.globalVars[expr];
                return expr;
            }

            async function renderStandaloneCbsText(text, runtime, args = []) {
                const src = String(text ?? ""); if (!src || !src.includes("{{")) return src;
                let out = "", cursor = 0;
                while (cursor < src.length) {
                    const tag = findNextCbsTag(src, cursor);
                    if (!tag) { out += src.slice(cursor); break; }
                    out += src.slice(cursor, tag.start);
                    const inner = safeTrim(tag.inner);
                    if (inner.startsWith("#func ")) { const fnName = safeTrim(inner.slice(6)); const block = extractCbsBlock(src, tag, "func"); if (fnName) runtime.functions[fnName] = block.body; cursor = block.end; continue; }
                    if (inner.startsWith("#if ")) { const conditionRaw = inner.slice(4); const block = extractCbsBlock(src, tag, "if"); const condition = await evalStandaloneCbsExpr(conditionRaw, runtime, args); out += await renderStandaloneCbsText(isStandaloneCbsTruthy(condition) ? block.body : block.elseBody, runtime, args); cursor = block.end; continue; }
                    if (inner.startsWith("#unless ")) { const conditionRaw = inner.slice(8); const block = extractCbsBlock(src, tag, "unless"); const condition = await evalStandaloneCbsExpr(conditionRaw, runtime, args); out += await renderStandaloneCbsText(isStandaloneCbsTruthy(condition) ? block.elseBody : block.body, runtime, args); cursor = block.end; continue; }
                    if (inner === "else" || inner === "/if" || inner === "/unless" || inner === "/func") { cursor = tag.end; continue; }
                    out += await evalStandaloneCbsExpr(inner, runtime, args); cursor = tag.end;
                }
                return out;
            }

            return {
                evalCondition: (cond, vars) => {
                    if (!cond) return true;
                    return cond.split('&&').every(p => {
                        const m = p.trim().match(R);
                        if (!m) return false;
                        const [_, k, op, v] = m;
                        const left = vars[k];
                        const right = v.startsWith('"') ? v.slice(1, -1) : Number(v);
                        if (left === undefined) return false;
                        switch(op) {
                            case '>=': return left >= right; case '<=': return left <= right;
                            case '==': return left == right; case '!=': return left != right;
                            case '>': return left > right; case '<': return left < right;
                            default: return false;
                        }
                    });
                },
                parseVariables: (text, vars) => {
                    if (!text) return vars;
                    const n = { ...vars };
                    for (const m of text.matchAll(/\{\{(\w+)\s*=\s*(".*?"|-?\d+\.?\d*)\}\}/g)) {
                        n[m[1]] = m[2].startsWith('"') ? m[2].slice(1, -1) : Number(m[2]);
                    }
                    return n;
                },
                process: async (text) => {
                    if (!MemoryEngine.CONFIG.cbsEnabled) return text;
                    const src = String(text ?? ""); if (!src || !src.includes("{{")) return src;
                    try {
                        const runtime = await getStandaloneCbsRuntime();
                        return await renderStandaloneCbsText(src, runtime, []);
                    } catch (e) { console.error("[LMAI] CBS Process Error", e); return src; }
                },
                clean: (text) => typeof text === 'string' ? text.replace(/<!--MEM:.*?-->/g, '').replace(/<!--EMO:.*?-->/g, '').replace(/\{\{[\s\S]*?\}\}/g, '').replace(/\[CBS_\d+\]/g, '').trim() : ""
            };
        })();

        // [v2.7] Multi-Provider Embedding Engine
        const EmbeddingEngine = (() => {
            const cache = new LRUCache(1000);
            return {
                _cache: cache,
                getEmbedding: async (text) => {
                    if (!text) return null;
                    if (cache.has(text)) return cache.get(text);
                    const m = MemoryEngine.CONFIG.embedModel;
                    if (!m.url || !m.key) return null;

                    try {
                        let url = m.url;
                        const headers = { "Content-Type": "application/json" };
                        let body = {};
                        let vec = null;

                        if (m.format === 'gemini') {
                            url = `${url.replace(/\/$/, '')}/models/${m.model}:embedContent?key=${m.key}`;
                            body = { model: m.model, content: { parts: [{ text }] } };
                            const res = await risuai.nativeFetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
                            if (res && !res.ok) {
                                let errText = `HTTP ${res.status}`;
                                try { errText += `: ${await res.text()}`; } catch (e) {}
                                throw new Error(errText);
                            }
                            const data = await res.json();
                            vec = data?.embedding?.value;
                        } else {
                            if (m.format === 'anthropic') headers["x-api-key"] = m.key;
                            else headers["Authorization"] = `Bearer ${m.key}`;

                            body = { input: [text], model: m.model };
                            const res = await risuai.nativeFetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
                            if (res && !res.ok) {
                                let errText = `HTTP ${res.status}`;
                                try { errText += `: ${await res.text()}`; } catch (e) {}
                                throw new Error(errText);
                            }
                            const data = await res.json();
                            vec = data?.data?.[0]?.embedding;
                        }

                        if (vec) { 
                            cache.set(text, vec); 
                            return vec; 
                        }
                    } catch (e) { 
                        console.error("[LMAI] Embed Error", e); 
                    }
                    return null;
                },
                cosineSimilarity: (a, b) => {
                    if (!a || !b || a.length !== b.length) return 0;
                    let dot = 0, normA = 0, normB = 0;
                    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i]; }
                    const mag = Math.sqrt(normA) * Math.sqrt(normB);
                    return mag === 0 ? 0 : dot / mag;
                }
            };
        })();

        // [v2.7.7] Multi-Provider AI Engine (Vertex & Copilot Added)
        const AuxAIEngine = (() => {
            const OR_MODELS_URL = "https://openrouter.ai/api/v1/models";
            const OR_CACHE_KEY = "lmai_or_models_cache";
            const OR_CACHE_TS_KEY = "lmai_or_models_ts";
            const OR_CACHE_TTL = 3600000;

            const safeTrim = (v) => typeof v === "string" ? v.trim() : "";

            const hasEmbeddingModality = (m) => {
                const mods = [
                    ...(Array.isArray(m?.output_modalities) ? m.output_modalities : []),
                    ...(Array.isArray(m?.architecture?.output_modalities) ? m.architecture.output_modalities : [])
                ].map(v => safeTrim(v).toLowerCase());
                return mods.includes("embedding") || mods.includes("embeddings");
            };

            const isLikelyEmbeddingModel = (m, id = "") => {
                const sid = id.toLowerCase();
                return sid.includes("embedding") || sid.includes("embed-") || hasEmbeddingModality(m);
            };

            return {
                getOpenRouterModels: async () => {
                    const now = Date.now();
                    try {
                        const cached = await risuai.pluginStorage.getItem(OR_CACHE_KEY);
                        const ts = Number(await risuai.pluginStorage.getItem(OR_CACHE_TS_KEY) || 0);
                        if (cached && (now - ts < OR_CACHE_TTL)) return JSON.parse(cached);

                        const m = MemoryEngine.CONFIG.mainModel;
                        const headers = {
                            "Accept": "application/json",
                            "HTTP-Referer": "https://risuai.xyz",
                            "X-Title": "Librarian System"
                        };
                        if (m.format === 'openrouter' && m.key) headers["Authorization"] = `Bearer ${m.key}`;

                        const res = await AuxAIEngine._performRequest(OR_MODELS_URL, { method: 'GET', headers });
                        const data = typeof res.json === 'function' ? await res.json() : res;
                        const raw = Array.isArray(data?.data) ? data.data : [];

                        const list = raw
                            .filter(m => {
                                const id = safeTrim(m?.id || m?.name || "");
                                return id && !isLikelyEmbeddingModel(m, id);
                            })
                            .map(m => safeTrim(m?.id || m?.name || ""))
                            .filter(Boolean);

                        if (list.length > 0) {
                            await risuai.pluginStorage.setItem(OR_CACHE_KEY, JSON.stringify(list));
                            await risuai.pluginStorage.setItem(OR_CACHE_TS_KEY, String(now));
                            return list;
                        }
                    } catch (e) { console.error("[LMAI] OR Fetch Error", e); }
                    return [];
                },

                _formatBody: (m, system, prompt) => {
                    let body = {};
                    const thinking = MemoryEngine.CONFIG.thinkingEnabled;
                    const level = MemoryEngine.CONFIG.thinkingLevel;

                    // OpenAI, Copilot, OpenRouter, Vertex (OpenAI Compatible) 공용 구조
                    if (['openai', 'copilot', 'openrouter', 'vertex'].includes(m.format)) {
                         body = { 
                            model: m.model, 
                            messages: [{ role: "system", content: system }, { role: "user", content: prompt }], 
                            temperature: m.temp || 0.7 
                        };
                        if (thinking && (m.model.includes('o1') || m.model.includes('o3'))) {
                            body.reasoning_effort = level;
                            delete body.temperature;
                        }
                    } 
                    else if (m.format === 'anthropic') {
                        body = { 
                            model: m.model, 
                            system: system, 
                            messages: [{ role: "user", content: prompt }], 
                            max_tokens: 4096,
                            temperature: m.temp || 0.7 
                        };
                        if (thinking) {
                            const budgets = { low: 2000, medium: 8000, high: 16000 };
                            body.thinking = { type: "enabled", budget_tokens: budgets[level] || 8000 };
                            body.temperature = 1.0;
                        }
                    } else if (m.format === 'gemini') {
                        body = { 
                            contents: [{ parts: [{ text: system + "\n" + prompt }] }], 
                            generationConfig: { temperature: m.temp || 0.7 } 
                        };
                        if (thinking) {
                            body.generationConfig.thinkingConfig = { includeThoughts: true };
                        }
                    }
                    return body;
                },

                _performRequest: async (url, options) => {
                    const controller = new AbortController();
                    const tid = setTimeout(() => controller.abort(), 60000);
                    try {
                        const res = await risuai.nativeFetch(url, { ...options, signal: controller.signal });
                        clearTimeout(tid);
                        return res;
                    } catch (e) {
                        clearTimeout(tid);
                        console.warn("[LMAI] nativeFetch failed, falling back to risuFetch", e);
                        return await risuai.risuFetch(url, options);
                    }
                },

                chat: async (prompt, system = "You are an assistant.") => {
                    const m = MemoryEngine.CONFIG.mainModel;
                    if (!m.url || !m.key) return null;

                    const headers = { "Content-Type": "application/json" };
                    let url = m.url;

                    try {
                        // [Added] GitHub Copilot Support
                        if (m.format === 'copilot') {
                            headers["Authorization"] = `Bearer ${m.key}`;
                            // Copilot은 사용자가 URL을 입력해야 함 (기본값 설정 가능)
                            if (!url || url === 'https://api.openai.com/v1/chat/completions') {
                                url = "https://api.githubcopilot.com/chat/completions";
                            }
                        }
                        // [Added] Vertex AI Support
                        else if (m.format === 'vertex') {
                            headers["Authorization"] = `Bearer ${m.key}`;
                            // URL은 사용자가 Vertex 전체 엔드포인트를 입력해야 함
                            // 예: https://us-central1-aiplatform.googleapis.com/v1/projects/PROJECT/locations/us-central1/publishers/google/models/gemini-pro:generateContent
                            // Body는 OpenAI 호환 모드를 가정하거나, Gemini 포맷 사용 시 분기 필요. 여기서는 OpenAI 호환 가정.
                        }
                        else if (m.format === 'anthropic') {
                            headers["x-api-key"] = m.key;
                            headers["anthropic-version"] = "2023-06-01";
                            if (!url.includes('/v1/')) url = url.replace(/\/$/, '') + '/v1/messages';
                        } else if (m.format === 'gemini') {
                            url = `${url.replace(/\/$/, '')}/models/${m.model}:generateContent?key=${m.key}`;
                        } else {
                            // OpenAI, Openrouter
                            headers["Authorization"] = `Bearer ${m.key}`;
                        }

                        const body = AuxAIEngine._formatBody(m, system, prompt);
                        const res = await AuxAIEngine._performRequest(url, { method: 'POST', headers, body: JSON.stringify(body) });
                        if (res && !res.ok) {
                            let errText = `HTTP ${res.status}`;
                            try { errText += `: ${await res.text()}`; } catch (e) {}
                            throw new Error(errText);
                        }
                        const data = typeof res.json === 'function' ? await res.json() : res;

                        // Response Parsing
                        if (m.format === 'gemini') {
                            const parts = data?.candidates?.[0]?.content?.parts || [];
                            const textParts = parts.filter(p => p.text && !p.thought);
                            return textParts.map(p => p.text).join('\n').trim() || parts?.[0]?.text?.trim();
                        } else if (m.format === 'anthropic') {
                            const parts = data?.content || [];
                            return parts.filter(p => p.type === 'text').map(p => p.text).join('\n').trim();
                        }
                        // OpenAI, Copilot, Vertex(OpenAI compat), OpenRouter
                        return data?.choices?.[0]?.message?.content?.trim();

                    } catch (e) { console.error("[LMAI] AI Error", e); }
                    return null;
                }
            };
        })();

        const EmotionEngine = (() => {
            const EM = { joy: ['기쁨', '행복'], sadness: ['슬픔'], anger: ['분노'], fear: ['두려움'], surprise: ['놀라움'], trust: ['신뢰'] };
            return {
                analyze: async (text) => {
                    if (!MemoryEngine.CONFIG.emotionEnabled) return 'neutral';
                    if (text.length > 50 && MemoryEngine.CONFIG.mainModel.url) {
                        const res = await AuxAIEngine.chat(`Emotion? (joy/sadness/anger/fear/surprise/trust/neutral): "${text}"`, "One word.");
                        if (res && Object.keys(EM).includes(res.toLowerCase())) return res.toLowerCase();
                    }
                    const s = { joy: 0, sadness: 0, anger: 0, fear: 0, surprise: 0, trust: 0 };
                    for (const [e, ks] of Object.entries(EM)) ks.forEach(k => { if (text.includes(k)) s[e]++; });
                    const d = Object.entries(s).reduce((a, b) => a[1] >= b[1] ? a : b);
                    return d[1] > 0 ? d[0] : 'neutral';
                }
            };
        })();

        const SummaryEngine = (() => {
            return {
                consolidate: async (lorebook, currentTurn, threshold) => {
                    const managed = MemoryEngine.getManagedEntries(lorebook);
                    if (managed.length < threshold) return { cleanedList: null, archiveEntry: null };
                    const toSum = managed.slice(0, 10);
                    const rawText = toSum.map(m => CBSEngine.clean(m.content)).join('\n');
                    const prompt = `Summarize the following roleplay memories into a cohesive narrative archive. CRUCIAL: Preserve important proper nouns (names, items, locations), key emotional shifts, and significant character actions/decisions. Do not just list facts; maintain the context of the story.\n\nMemories:\n${rawText}`;
                    const aiSum = await AuxAIEngine.chat(prompt, "You are an expert roleplay memory archiver.");
                    const content = aiSum ? `[Archive] ${aiSum}` : `[Archive] ${rawText.substring(0, 400)}`;

                    const tokenConfig = { type: MemoryEngine.CONFIG.tokenizerType, customUrl: MemoryEngine.CONFIG.customTokenizerUrl, customKey: MemoryEngine.CONFIG.customTokenizerKey };
                    const tokenCount = await TokenizerEngine.countTokens(content, tokenConfig);
                    const meta = { t: currentTurn, ttl: -1, imp: 7, type: 'archive', turn: currentTurn, tokens: tokenCount };
                    const entry = { key: "", comment: MemoryEngine.CONFIG.archiveComment, content: `\n${content}`, mode: "normal", insertorder: 10, alwaysActive: true };
                    const delKeys = new Set(toSum.map(m => MemoryEngine.getSafeKey(m)));
                    return { cleanedList: [...lorebook.filter(e => !delKeys.has(MemoryEngine.getSafeKey(e))), entry], archiveEntry: entry };
                }
            };
        })();

        // ─────────────────────────────────────────────
        // [MAIN] Initialization
        // ─────────────────────────────────────────────
        let writeMutex = Promise.resolve();

        const safeModifyCharacter = async (modifierFunc) => {
            if (typeof risuai === 'undefined' || !risuai.getCharacter) return false;

            const currentMutex = writeMutex;
            let resolveMutex;
            writeMutex = new Promise(r => resolveMutex = r);

            try {
                await currentMutex;

                const char = await risuai.getCharacter();
                if (!char) return false;

                const charCopy = JSON.parse(JSON.stringify(char));
                const result = await modifierFunc(charCopy);

                if (result && typeof result === 'object') {
                    return await risuai.setCharacter(result);
                }
                return false;
            } catch (e) {
                console.error("[LMAI] Mutex Task fail", e);
                return false;
            } finally {
                resolveMutex();
            }
        };

        const updateConfigFromArgs = async () => {
            const cfg = MemoryEngine.CONFIG;
            let local = {};

            try { 
                const saved = await risuai.pluginStorage.getItem('LMAI_Config');
                if (saved) {
                    local = typeof saved === 'string' ? JSON.parse(saved) : saved;
                }
            } catch (e) { console.log("[LMAI] No saved config found, using defaults."); }

            const getVal = async (key, argName, type, parent = null) => {
                let argVal;
                if (argName && typeof risuai !== 'undefined' && typeof risuai.getArgument === 'function') {
                    try { argVal = await risuai.getArgument(argName); } catch (e) {}
                }

                let localVal;
                if (parent && local[parent] !== undefined) localVal = local[parent][key];
                else if (!parent && local[key] !== undefined) localVal = local[key];

                if (localVal !== undefined && localVal !== null && localVal !== '') {
                    if (type === 'number') {
                        const num = Number(localVal);
                        return isNaN(num) ? (parent ? cfg[parent][key] : cfg[key]) : num;
                    }
                    if (type === 'boolean') return (localVal === true || localVal === 'true' || localVal === 1 || localVal === '1');
                    return String(localVal);
                }

                if (argVal !== undefined && argVal !== null && argVal !== '' && argVal !== 0 && argVal !== '0') {
                    if (type === 'number') {
                        const num = Number(argVal);
                        if (!isNaN(num)) return num;
                    }
                    if (type === 'boolean') return (argVal === true || argVal === 'true' || argVal === 1 || argVal === '1');
                    return String(argVal);
                }

                return parent ? cfg[parent][key] : cfg[key];
            };

            cfg.maxLimit = await getVal('maxLimit', 'max_limit', 'number');
            cfg.threshold = await getVal('threshold', 'threshold', 'number');
            cfg.simThreshold = await getVal('simThreshold', 'sim_threshold', 'number') ?? 0.25;
            cfg.gcFrequency = await getVal('gcFrequency', 'gc_frequency', 'number') || 10;
            cfg.debug = await getVal('debug', 'debug', 'boolean');
            cfg.translationFilter = await getVal('translationFilter', null, 'boolean');
            cfg.cbsEnabled = await getVal('cbsEnabled', 'cbs_enabled', 'boolean');
            cfg.emotionEnabled = await getVal('emotionEnabled', 'emotion_enabled', 'boolean');
            cfg.summaryThreshold = await getVal('summaryThreshold', 'summary_threshold', 'number');
            cfg.thinkingEnabled = await getVal('thinkingEnabled', null, 'boolean');
            cfg.thinkingLevel = await getVal('thinkingLevel', null, 'string') || 'medium';
            cfg.dedupRandomSample = await getVal('dedupRandomSample', null, 'number') || 30;

            cfg.tokenizerType = await getVal('tokenizerType', null, 'string') || 'simple';
            cfg.maxTokensPerMemory = await getVal('maxTokensPerMemory', null, 'number') || 500;
            cfg.customTokenizerUrl = await getVal('customTokenizerUrl', null, 'string') || '';
            cfg.customTokenizerKey = await getVal('customTokenizerKey', null, 'string') || '';

            cfg.mainModel = {
                format: await getVal('format', null, 'string', 'mainModel'),
                url: await getVal('url', null, 'string', 'mainModel'),
                key: await getVal('key', null, 'string', 'mainModel'),
                model: await getVal('model', null, 'string', 'mainModel'),
                temp: await getVal('temp', null, 'number', 'mainModel')
            };
            cfg.embedModel = {
                format: await getVal('format', null, 'string', 'embedModel'),
                url: await getVal('url', null, 'string', 'embedModel'),
                key: await getVal('key', null, 'string', 'embedModel'),
                model: await getVal('model', null, 'string', 'embedModel')
            };
        };

        await updateConfigFromArgs();

        // ─────────────────────────────────────────────
        // [UI] Dashboard
        // ─────────────────────────────────────────────
        await risuai.registerSetting('LMAI', async () => {
            const overlay = document.createElement('div');
            overlay.id = 'lmai-overlay';
            Object.assign(overlay.style, { position: 'fixed', top: '0', left: '0', width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.85)', zIndex: '9999', padding: '20px', color: '#eee', fontFamily: 'sans-serif', overflowY: 'auto', boxSizing: 'border-box' });

            const escapeHtml = (unsafe) => (unsafe||'').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

            const formatOptions = (selected) => {
                // [Added] vertex, copilot
                return ['openai', 'gemini', 'vertex', 'anthropic', 'openrouter', 'copilot'].map(v => 
                    `<option value="${v}" ${v === selected ? 'selected' : ''}>${v.charAt(0).toUpperCase() + v.slice(1)}</option>`
                ).join('');
            };

            const tokenizerOptions = (selected) => {
                return Object.values(TokenizerEngine.TOKENIZER_TYPES).map(v =>
                    `<option value="${v}" ${v === selected ? 'selected' : ''}>${v.toUpperCase()}</option>`
                ).join('');
            };

            overlay.innerHTML = `
                <div id="lmai-app" style="max-width: 750px; margin: 0 auto; background: #1a1a1a; padding: 0; border-radius: 12px; border: 1px solid #444; overflow: hidden; display: flex; flex-direction: column; height: 90vh;">
                    <datalist id="lmai-model-list"></datalist>
                    <div id="lmai-header" style="background: #252525; padding: 15px 20px; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center;">
                        <h2 style="margin: 0; font-size: 1.2em; color: #4a9eff;">📚 Librarian System V1.0</h2>
                        <div style="display: flex; gap: 10px;">
                            <button class="lmai-tab-btn" data-tab="home" style="background:none; border:none; color:#4a9eff; cursor:pointer; font-weight:bold; padding: 5px 10px;">🏠 홈</button>
                            <button class="lmai-tab-btn" data-tab="memory" style="background:none; border:none; color:#aaa; cursor:pointer; font-weight:bold; padding: 5px 10px;">🧠 메모리</button>
                            <button class="lmai-tab-btn" data-tab="tokenizer" style="background:none; border:none; color:#aaa; cursor:pointer; font-weight:bold; padding: 5px 10px;">📝 토크나이저</button>
                            <button class="lmai-tab-btn" data-tab="settings" style="background:none; border:none; color:#aaa; cursor:pointer; font-weight:bold; padding: 5px 10px;">⚙️ 설정</button>
                        </div>
                    </div>

                    <div id="lmai-body" style="flex: 1; padding: 20px; overflow-y: auto;">
                        <div id="lmai-pane-home" class="lmai-pane">
                            <h3 style="color: #4a9eff;">환영합니다!</h3>
                            <p style="line-height: 1.6; color: #ccc;"><b>Librarian System V1.0</b> (v2.7.7)</p>
                            <ul style="color: #bbb; line-height: 1.8;">
                                <li><b>Multi-Provider API:</b> OpenAI, Google, Anthropic, OpenRouter, <b>Vertex AI</b>, <b>GitHub Copilot</b></li>
                                <li><b>Hybrid Engine:</b> 장기 기억 중복 방지 & 검색 편향 보정</li>
                                <li><b>Async Queue:</b> 논블로킹 API 처리</li>
                            </ul>
                        </div>

                        <div id="lmai-pane-memory" class="lmai-pane" style="display: none;">
                            <div id="lmai-memory-container">로딩 중...</div>
                        </div>

                        <div id="lmai-pane-tokenizer" class="lmai-pane" style="display: none;">
                            <h3 style="margin-top: 0; color: #4a9eff;">📝 토크나이저 설정 (Tokenizer)</h3>
                            <div style="background: #222; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                                <label style="font-weight: bold; margin-bottom: 10px; display: block;" title="텍스트를 토큰으로 변환하는 방식을 선택합니다.">토크나이저 타입 (Type) ❓</label>
                                <select id="cfg-tokenizerType" style="width: 100%; background: #1a1a1a; border: 1px solid #444; color: #eee; padding: 8px; border-radius: 4px;">
                                    ${tokenizerOptions(MemoryEngine.CONFIG.tokenizerType)}
                                </select>
                            </div>
                            <div style="background: #222; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                                <label style="font-weight: bold; margin-bottom: 10px; display: block;" title="개별 메모리 항목이 가질 수 있는 최대 토큰 수입니다.">토큰 제한 (Max Tokens) ❓</label>
                                <input type="number" id="cfg-maxTokensPerMemory" min="50" max="2000" style="width: 100%; background: #1a1a1a; border: 1px solid #444; color: #eee; padding: 8px; border-radius: 4px;" value="${MemoryEngine.CONFIG.maxTokensPerMemory}">
                            </div>
                             <div id="custom-tokenizer-settings" style="background: #222; padding: 15px; border-radius: 8px; margin-bottom: 15px; display: ${MemoryEngine.CONFIG.tokenizerType === 'custom' ? 'block' : 'none'};">
                                <label style="font-weight: bold; color: #4a9eff;">🔌 외부 토크나이저 API</label>
                                <input type="text" id="cfg-customTokenizerUrl" placeholder="https://your-api.com/count" style="width: 100%; background: #1a1a1a; border: 1px solid #444; color: #eee; padding: 8px; border-radius: 4px; margin-top: 5px;" value="${escapeHtml(MemoryEngine.CONFIG.customTokenizerUrl)}">
                                <input type="password" id="cfg-customTokenizerKey" placeholder="API Key (선택)" style="width: 100%; background: #1a1a1a; border: 1px solid #444; color: #eee; padding: 8px; border-radius: 4px; margin-top: 5px;" value="${escapeHtml(MemoryEngine.CONFIG.customTokenizerKey)}">
                            </div>
                            <div style="background: #222; padding: 15px; border-radius: 8px;">
                                <label style="font-weight: bold; margin-bottom: 10px; display: block;">🔍 토크 테스트</label>
                                <textarea id="tokenizer-test-input" placeholder="토큰 수를 계산할 텍스트를 입력하세요..." style="width: 100%; height: 100px; background: #1a1a1a; border: 1px solid #444; color: #eee; padding: 8px; border-radius: 4px;"></textarea>
                                <button id="tokenizer-test-btn" style="margin-top: 10px; background: #4a9eff; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">토큰 계산</button>
                                <div id="tokenizer-test-result" style="margin-top: 10px; padding: 10px; background: #1a1a1a; border-radius: 4px; display: none;"></div>
                            </div>
                        </div>

                        <div id="lmai-pane-settings" class="lmai-pane" style="display: none;">
                            <h3 style="margin-top: 0;">⚙️ 전역 설정 (General)</h3>
                            <div style="display: flex; flex-direction: column; gap: 15px;">
                                <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;"><input type="checkbox" id="cfg-cbsEnabled" ${MemoryEngine.CONFIG.cbsEnabled ? 'checked' : ''}> CBS 처리 활성화</label>
                                <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;"><input type="checkbox" id="cfg-emotionEnabled" ${MemoryEngine.CONFIG.emotionEnabled ? 'checked' : ''}> 감정 분석 활성화</label>
                                <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;"><input type="checkbox" id="cfg-debug" ${MemoryEngine.CONFIG.debug ? 'checked' : ''}> 디버그 모드</label>
                                <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;"><input type="checkbox" id="cfg-translationFilter" ${MemoryEngine.CONFIG.translationFilter ? 'checked' : ''}> 번역 필터링</label>
                                <hr style="border: 0; border-top: 1px solid #333; width: 100%;">

                                <div style="background: #222; padding: 15px; border-radius: 8px;">
                                    <label style="font-weight: bold; color: #4a9eff; margin-bottom: 10px; display: block;">🤖 메인 모델 (Main Model)</label>
                                    <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 10px;">
                                        <div>
                                            <label style="font-size: 0.8em; color: #888;">제공자 (Provider)</label>
                                            <select id="cfg-main-format" style="width: 100%; background: #1a1a1a; border: 1px solid #444; color: #eee; padding: 8px; border-radius: 4px;">
                                                ${formatOptions(MemoryEngine.CONFIG.mainModel.format)}
                                            </select>
                                        </div>
                                        <div>
                                            <label style="font-size: 0.8em; color: #888;">모델명 (Model)</label>
                                            <input type="text" id="cfg-main-model" list="lmai-model-list" autocomplete="off" placeholder="gpt-4o" style="width: 100%; background: #1a1a1a; border: 1px solid #444; color: #eee; padding: 8px; border-radius: 4px;" value="${escapeHtml(MemoryEngine.CONFIG.mainModel.model)}">
                                        </div>
                                    </div>
                                    <label style="font-size: 0.8em; color: #888; margin-top: 10px; display: block;">접속 주소 (URL)</label>
                                    <input type="text" id="cfg-main-url" placeholder="https://api.openai.com/v1/chat/completions" style="width: 100%; background: #1a1a1a; border: 1px solid #444; color: #eee; padding: 8px; border-radius: 4px;" value="${escapeHtml(MemoryEngine.CONFIG.mainModel.url)}">
                                    <label style="font-size: 0.8em; color: #888; margin-top: 10px; display: block;">API 키 (Key)</label>
                                    <input type="password" id="cfg-main-key" placeholder="sk-..." style="width: 100%; background: #1a1a1a; border: 1px solid #444; color: #eee; padding: 8px; border-radius: 4px;" value="${escapeHtml(MemoryEngine.CONFIG.mainModel.key)}">
                                    <div style="margin-top: 10px;">
                                        <label style="font-size: 0.8em; color: #888;">창의성 (Temp): <span id="temp-val">${MemoryEngine.CONFIG.mainModel.temp}</span></label>
                                        <input type="range" id="cfg-main-temp" min="0" max="2" step="0.1" value="${MemoryEngine.CONFIG.mainModel.temp}" style="width: 100%;">
                                    </div>
                                </div>

                                <hr style="border: 0; border-top: 1px solid #333; width: 100%;">

                                <div style="background: #222; padding: 15px; border-radius: 8px;">
                                    <label style="font-weight: bold; color: #4a9eff; margin-bottom: 10px; display: block;">🔍 임베딩 모델 (Embedding)</label>
                                    <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 10px;">
                                        <div>
                                            <label style="font-size: 0.8em; color: #888;">제공자 (Provider)</label>
                                            <select id="cfg-embed-format" style="width: 100%; background: #1a1a1a; border: 1px solid #444; color: #eee; padding: 8px; border-radius: 4px;">
                                                ${formatOptions(MemoryEngine.CONFIG.embedModel.format)}
                                            </select>
                                        </div>
                                        <div>
                                            <label style="font-size: 0.8em; color: #888;">모델명 (Model)</label>
                                            <input type="text" id="cfg-embed-model" list="lmai-model-list" autocomplete="off" placeholder="text-embedding-3-small" style="width: 100%; background: #1a1a1a; border: 1px solid #444; color: #eee; padding: 8px; border-radius: 4px;" value="${escapeHtml(MemoryEngine.CONFIG.embedModel.model)}">
                                        </div>
                                    </div>
                                    <label style="font-size: 0.8em; color: #888; margin-top: 10px; display: block;">접속 주소 (URL)</label>
                                    <input type="text" id="cfg-embed-url" placeholder="https://api.openai.com/v1/embeddings" style="width: 100%; background: #1a1a1a; border: 1px solid #444; color: #eee; padding: 8px; border-radius: 4px;" value="${escapeHtml(MemoryEngine.CONFIG.embedModel.url)}">
                                    <label style="font-size: 0.8em; color: #888; margin-top: 10px; display: block;">API 키 (Key)</label>
                                    <input type="password" id="cfg-embed-key" placeholder="sk-..." style="width: 100%; background: #1a1a1a; border: 1px solid #444; color: #eee; padding: 8px; border-radius: 4px;" value="${escapeHtml(MemoryEngine.CONFIG.embedModel.key)}">
                                </div>

                                <hr style="border: 0; border-top: 1px solid #333; width: 100%;">

                                <div style="background: #222; padding: 15px; border-radius: 8px;">
                                    <label style="font-weight: bold; color: #4a9eff; margin: 0 0 15px 0;">🧠 Memory Settings</label>
                                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
                                        <div>
                                            <label style="font-size: 0.8em; color: #888;">Max Memories</label>
                                            <input type="number" id="cfg-maxLimit" style="width: 100%; background: #1a1a1a; border: 1px solid #444; color: #eee; padding: 8px; border-radius: 4px;" value="${MemoryEngine.CONFIG.maxLimit}">
                                        </div>
                                        <div>
                                            <label style="font-size: 0.8em; color: #888;">Importance</label>
                                            <input type="number" id="cfg-threshold" style="width: 100%; background: #1a1a1a; border: 1px solid #444; color: #eee; padding: 8px; border-radius: 4px;" value="${MemoryEngine.CONFIG.threshold}">
                                        </div>
                                        <div>
                                            <label style="font-size: 0.8em; color: #888;">Similarity</label>
                                            <input type="number" id="cfg-simThreshold" step="0.05" style="width: 100%; background: #1a1a1a; border: 1px solid #444; color: #eee; padding: 8px; border-radius: 4px;" value="${MemoryEngine.CONFIG.simThreshold}">
                                        </div>
                                    </div>
                                    <div style="margin-top: 10px;">
                                         <label style="font-size: 0.8em; color: #888;">Dedup Random Sample</label>
                                         <input type="number" id="cfg-dedupRandomSample" style="width: 100%; background: #1a1a1a; border: 1px solid #444; color: #eee; padding: 8px; border-radius: 4px;" value="${MemoryEngine.CONFIG.dedupRandomSample}">
                                    </div>
                                </div>

                                <button id="lmai-save-cfg" style="background: #4a9eff; color: white; border: none; padding: 12px; border-radius: 6px; cursor: pointer; font-weight: bold;">💾 설정 저장</button>
                            </div>
                        </div>
                    </div>

                    <div id="lmai-footer" style="padding: 15px 20px; border-top: 1px solid #333; text-align: center;">
                        <button id="lmai-close-dash" style="background: #333; color: #ccc; border: 1px solid #444; padding: 8px 30px; border-radius: 4px; cursor: pointer;">닫기</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            // Tab switching logic (omitted for brevity, same as before)
            const panes = overlay.querySelectorAll('.lmai-pane');
            const btns = overlay.querySelectorAll('.lmai-tab-btn');
            const switchTab = (tabId) => {
                panes.forEach(p => p.style.display = 'none');
                btns.forEach(b => b.style.color = '#aaa');
                const targetPane = overlay.querySelector(`#lmai-pane-${tabId}`);
                const targetBtn = overlay.querySelector(`[data-tab="${tabId}"]`);
                if (targetPane) targetPane.style.display = 'block';
                if (targetBtn) targetBtn.style.color = '#4a9eff';
                if (tabId === 'memory') renderMemoryTab();
            };
            btns.forEach(b => b.onclick = () => switchTab(b.dataset.tab));
            switchTab('home');

            // Tokenizer toggle logic
            const tokenizerSelect = overlay.querySelector('#cfg-tokenizerType');
            const customSettings = overlay.querySelector('#custom-tokenizer-settings');
            if (tokenizerSelect && customSettings) {
                tokenizerSelect.onchange = () => customSettings.style.display = tokenizerSelect.value === 'custom' ? 'block' : 'none';
            }

            // Save logic
            overlay.querySelector('#lmai-save-cfg').onclick = async () => {
                try {
                    const newCfg = {
                        cbsEnabled: overlay.querySelector('#cfg-cbsEnabled').checked,
                        emotionEnabled: overlay.querySelector('#cfg-emotionEnabled').checked,
                        debug: overlay.querySelector('#cfg-debug').checked,
                        translationFilter: overlay.querySelector('#cfg-translationFilter').checked,
                        maxLimit: Number(overlay.querySelector('#cfg-maxLimit').value),
                        threshold: Number(overlay.querySelector('#cfg-threshold').value),
                        simThreshold: Number(overlay.querySelector('#cfg-simThreshold').value),
                        dedupRandomSample: Number(overlay.querySelector('#cfg-dedupRandomSample').value),
                        tokenizerType: overlay.querySelector('#cfg-tokenizerType').value,
                        maxTokensPerMemory: Number(overlay.querySelector('#cfg-maxTokensPerMemory').value),
                        customTokenizerUrl: overlay.querySelector('#cfg-customTokenizerUrl').value,
                        customTokenizerKey: overlay.querySelector('#cfg-customTokenizerKey').value,
                        mainModel: {
                            format: overlay.querySelector('#cfg-main-format').value,
                            url: overlay.querySelector('#cfg-main-url').value,
                            key: overlay.querySelector('#cfg-main-key').value,
                            model: overlay.querySelector('#cfg-main-model').value,
                            temp: Number(overlay.querySelector('#cfg-main-temp').value)
                        },
                        embedModel: {
                            format: overlay.querySelector('#cfg-embed-format').value,
                            url: overlay.querySelector('#cfg-embed-url').value,
                            key: overlay.querySelector('#cfg-embed-key').value,
                            model: overlay.querySelector('#cfg-embed-model').value
                        }
                    };
                    await risuai.pluginStorage.setItem('LMAI_Config', JSON.stringify(newCfg));
                    await updateConfigFromArgs();
                    alert("✅ 저장 성공");
                } catch (e) { alert("❌ 저장 실패: " + e.message); }
            };

            document.getElementById('lmai-close-dash').onclick = () => { overlay.remove(); risuai.hideContainer(); };
            await risuai.showContainer('fullscreen');
        }, '📊', 'html');

        // ─────────────────────────────────────────────
        // [HOOKS] Before/After Request (Optimized)
        // ─────────────────────────────────────────────

        await risuai.addRisuReplacer('beforeRequest', async (messages) => {
            if (!Array.isArray(messages)) return messages;

            const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
            let query = lastUserMsg ? lastUserMsg.content : "";

            if (query && MemoryEngine.CONFIG.cbsEnabled) {
                query = await CBSEngine.process(query);
            }

            // Security Filter
            if (query) {
                query = query.replace(/<x_system_context[\s\S]*?>[\s\S]*?<\/x_system_context>/gi, '[FILTERED]');
            }

            if (MemoryEngine.CONFIG.translationFilter) {
                const tagInstruction = "\n\n[System Directive: You MUST wrap your actual roleplay response inside <original>...</original> tags.]";
                const targetMsg = messages[messages.length - 1]; 
                if (targetMsg && !targetMsg.content.includes('<original>...</original>')) {
                    targetMsg.content += tagInstruction;
                }
            }

            if (!query) return messages;

            const char = await risuai.getCharacter();
            if (char) {
                const chat = char.chats && char.chats[char.chatPage] ? char.chats[char.chatPage] : {};
                let vars = {};
                const recentHistory = (chat.message || []).slice(-10);
                recentHistory.forEach(m => { vars = CBSEngine.parseVariables(m.content, vars); });
                const turn = (chat.message || []).length;

                const lore = MemoryEngine.getLorebook(char, chat);
                const managed = MemoryEngine.getManagedEntries(lore);
                const memRes = await MemoryEngine.retrieveMemories(query, turn, managed, vars, 5);

                if (memRes.length > 0) {
                    const memoryContext = memRes.map(m => `- ${CBSEngine.clean(m.content).substring(0, 120)}`).join('\n');
                    const instructText = `\n\n<x_system_context type="subconscious_memory">\n${memoryContext}\n</x_system_context>`;

                    const targetMsg = messages[messages.length - 1];
                    if (targetMsg) targetMsg.content += instructText;
                }
            }
            return messages;
        });

        await risuai.addRisuReplacer('afterRequest', async (content) => {
            if (typeof content !== 'string') return content;

            let cleanContent = content;
            const findTranslationBlock = (text) => {
                const match = text.match(/<original>([\s\S]*?)<\/original>/i);
                return match && match[1] ? match[1].trim() : text.trim();
            };

            if (MemoryEngine.CONFIG.translationFilter) cleanContent = findTranslationBlock(content);
            if (cleanContent.length < 5) return content;

            // Background Processing
            BackgroundQueue.enqueue(async () => {
                try {
                    const char = await risuai.getCharacter();
                    if (!char) return;

                    const chat = char.chats && char.chats[char.chatPage] ? char.chats[char.chatPage] : {};
                    const turn = (chat.message || []).length;

                    let currentVars = {};
                    (chat.message || []).slice(-10).forEach(m => { currentVars = CBSEngine.parseVariables(m.content, currentVars); });

                    let lore = MemoryEngine.getLorebook(char, chat);
                    const emotion = await EmotionEngine.analyze(cleanContent);

                    let memText = cleanContent;
                    if (MemoryEngine.CONFIG.mainModel.url) {
                         const s = await AuxAIEngine.chat(`Condense: ${cleanContent}`, "Archiver");
                         if (s) memText = s;
                    }

                    const sumRes = await SummaryEngine.consolidate(lore, turn, MemoryEngine.CONFIG.summaryThreshold);
                    if (sumRes.cleanedList) lore = sumRes.cleanedList;

                    const gc = MemoryEngine.cleanupMemories(lore, turn);
                    if (gc.cleanedList) lore = gc.cleanedList;

                    const mem = await MemoryEngine.prepareMemory({ content: `[${emotion}] ${memText}`, importance: 5 }, turn, lore, currentVars);
                    if (mem) lore.push(mem);

                    await safeModifyCharacter(c => {
                        if (!c.chats || c.chatPage === undefined) return c;
                        const currentChat = c.chats[c.chatPage];
                        MemoryEngine.setLorebook(c, currentChat, lore);
                        return c;
                    });
                } catch (e) { console.error("[LMAI] Background Error", e); }
            });

            return content;
        });

    } catch (e) { console.error("[LMAI] Init Error", e); }
})();
