//@name libra_world_manager
//@display-name LIBRA World Manager
//@author rusinus12@gmail.com
//@api 3.0
//@version 3.0.0

(async () => {
    // ══════════════════════════════════════════════════════════════
    // [CORE] Error Handler
    // ══════════════════════════════════════════════════════════════
    class LIBRAError extends Error {
        constructor(message, code, cause = null) {
            super(message);
            this.name = 'LIBRAError';
            this.code = code;
            this.cause = cause;
            this.timestamp = Date.now();
        }
    }

    const getChatMessages = (chat) => {
        if (!chat) return [];
        return chat.msgs || chat.messages || chat.message || chat.log || chat.mes || chat.chat || [];
    };
    const getComparableMessageText = (msg) => {
        const roleHint = (msg?.role === 'user' || msg?.is_user) ? 'user' : 'ai';
        return Utils.getNarrativeComparableText(Utils.getMessageText(msg), roleHint);
    };
    const stripLBDATA = (text) => {
        if (!text) return '';
        return String(text)
            .replace(/---\s*\[LBDATA START\][\s\S]*?\[LBDATA END\]\s*---/gi, '')
            .replace(/\[LBDATA START\][\s\S]*?\[LBDATA END\]/gi, '')
            .trim();
    };

    // ══════════════════════════════════════════════════════════════
    // [UTILITY] State Management
    // ══════════════════════════════════════════════════════════════
    const MemoryState = {
        gcCursor: 0,
        hashIndex: new Map(),
        metaCache: null,
        simCache: null,
        sessionCache: new Map(),
        rollbackTracker: new Map(), // { msg_id: [lore_keys] }
        pendingTurnCommits: new Map(), // { chat_id: pending turn payload }
        transientMissing: new Map(), // { msg_id: { since, reason } }
        currentSessionId: null,
        _activeChatId: null,
        isSessionRestored: false,
        ignoredGreetingId: null,
        isInitialized: false,
        currentTurn: 0,
        initVersion: 0,
        refreshStabilizeUntil: 0,
        refreshDeleteBlockUntil: 0,

        reset() {
            this.gcCursor = 0;
            this.hashIndex.clear();
            this.metaCache?.cache?.clear();
            this.simCache?.cache?.clear();
            this.sessionCache.clear();
            this.rollbackTracker.clear();
            this.pendingTurnCommits.clear();
            this.transientMissing.clear();
            this.initVersion++;
            this.refreshStabilizeUntil = 0;
            this.refreshDeleteBlockUntil = 0;
        }
    };

    const REFRESH_STABILIZE_MS = 2500;
    const REFRESH_DELETE_BLOCK_MS = 15000;
    const enterRefreshRecoveryWindow = () => {
        const now = Date.now();
        MemoryState.refreshStabilizeUntil = Math.max(MemoryState.refreshStabilizeUntil || 0, now + REFRESH_STABILIZE_MS);
        MemoryState.refreshDeleteBlockUntil = Math.max(MemoryState.refreshDeleteBlockUntil || 0, now + REFRESH_DELETE_BLOCK_MS);
        MemoryState.transientMissing.clear();
    };
    const isRefreshStabilizing = () => Date.now() < (MemoryState.refreshStabilizeUntil || 0);
    const isRefreshDeleteBlocked = () => Date.now() < (MemoryState.refreshDeleteBlockUntil || 0);
    const getChatMemoryScopeKey = (chat) => String(chat?.id || '__global__');
    const PENDING_FINALIZE_MIN_MS = 3500;
    const PENDING_FINALIZE_REQUIRED_MATCHES = 2;
    const PENDING_STALE_MS = 180000;
    const UI_INTERACTION_BLOCK_MS = 1200;
    const UI_INTERACTION_EVENTS = ['pointerdown', 'mousedown', 'touchstart', 'click', 'keydown'];
    const LIBRA_UI_GUARD_CLEANUP_KEY = '__LIBRA_UI_GUARD_CLEANUP__';
    const LIBRA_TURN_RECOVERY_TIMER_CLEANUP_KEY = '__LIBRA_TURN_RECOVERY_TIMER_CLEANUP__';
    const COLD_START_SCOPE_PRESETS = {
        all: 0,
        partial_100: 100,
        partial_300: 300
    };
    let uiInteractionHotUntil = 0;
    let uiInteractionListenersBound = false;
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
    const isLibraDebugEnabled = () => {
        try {
            return typeof MemoryEngine !== 'undefined' && !!MemoryEngine.CONFIG?.debug;
        } catch {
            return false;
        }
    };
    function resolveColdStartHistoryLimit(preset, fallbackLimit = 100) {
        const normalized = String(preset || '').toLowerCase();
        if (Object.prototype.hasOwnProperty.call(COLD_START_SCOPE_PRESETS, normalized)) {
            return COLD_START_SCOPE_PRESETS[normalized];
        }
        const parsedFallback = Number(fallbackLimit);
        return Number.isFinite(parsedFallback) ? Math.max(0, parsedFallback) : 100;
    }
    const markUiInteractionHot = () => {
        uiInteractionHotUntil = Math.max(uiInteractionHotUntil, Date.now() + UI_INTERACTION_BLOCK_MS);
    };
    const unbindUiInteractionGuards = () => {
        if (typeof document !== 'undefined') {
            UI_INTERACTION_EVENTS.forEach((eventName) => {
                document.removeEventListener(eventName, markUiInteractionHot, true);
            });
        }
        uiInteractionListenersBound = false;
        if (typeof globalThis !== 'undefined' && globalThis[LIBRA_UI_GUARD_CLEANUP_KEY] === unbindUiInteractionGuards) {
            delete globalThis[LIBRA_UI_GUARD_CLEANUP_KEY];
        }
    };
    const bindUiInteractionGuards = () => {
        if (typeof document === 'undefined') return;
        const existingCleanup = typeof globalThis !== 'undefined' ? globalThis[LIBRA_UI_GUARD_CLEANUP_KEY] : null;
        if (typeof existingCleanup === 'function' && existingCleanup !== unbindUiInteractionGuards) {
            existingCleanup();
        }
        if (uiInteractionListenersBound) return;
        uiInteractionListenersBound = true;
        UI_INTERACTION_EVENTS.forEach((eventName) => {
            document.addEventListener(eventName, markUiInteractionHot, true);
        });
        if (typeof globalThis !== 'undefined') {
            globalThis[LIBRA_UI_GUARD_CLEANUP_KEY] = unbindUiInteractionGuards;
        }
    };
    const resolveActiveChatContext = async (preferredChat = null) => {
        try {
            const char = await risuai.getCharacter();
            const charIdx = typeof risuai.getCurrentCharacterIndex === 'function'
                ? await risuai.getCurrentCharacterIndex()
                : -1;
            let chatIndex = typeof risuai.getCurrentChatIndex === 'function'
                ? await risuai.getCurrentChatIndex()
                : -1;
            if (!char || charIdx < 0) return { char: char || null, charIdx: -1, chat: null, chatIndex: -1 };

            const chats = Array.isArray(char?.chats) ? char.chats : [];
            if (preferredChat?.id) {
                const resolved = chats.findIndex(entry => String(entry?.id || '') === String(preferredChat.id));
                if (resolved >= 0) chatIndex = resolved;
            }
            const chat = chats?.[chatIndex] || null;
            return { char, charIdx, chat, chatIndex };
        } catch {
            return { char: null, charIdx: -1, chat: null, chatIndex: -1 };
        }
    };
    const requireLoadedCharacter = async () => {
        const char = await risuai.getCharacter();
        if (!char) {
            throw new LIBRAError('No character loaded', 'NO_CHAR');
        }
        return char;
    };
    const persistLoreToActiveChat = async (preferredChat, lore, opts = {}) => {
        if (!Array.isArray(lore)) return { ok: false, reason: 'invalid_lore' };
        const { saveCheckpoint = false } = opts;
        bindUiInteractionGuards();
        const delayMs = uiInteractionHotUntil - Date.now();
        if (delayMs > 0) {
            await sleep(delayMs + 50);
        }
        const ctx = await resolveActiveChatContext(preferredChat);
        if (!ctx.char || !ctx.chat || ctx.charIdx < 0 || ctx.chatIndex < 0) {
            return { ok: false, reason: 'missing_chat_context' };
        }

        const nextChat = cloneForMutation(ctx.chat);
        nextChat.localLore = lore.map(entry => safeClone(entry));

        if (typeof risuai.setChatToIndex === 'function') {
            await risuai.setChatToIndex(ctx.charIdx, ctx.chatIndex, nextChat);
        } else {
            const nextChar = cloneForMutation(ctx.char);
            nextChar.chats = Array.isArray(nextChar.chats) ? nextChar.chats : [];
            nextChar.chats[ctx.chatIndex] = nextChat;
            await risuai.setCharacter(nextChar);
        }

        if (saveCheckpoint) {
            await RefreshCheckpointManager.saveCheckpoint(ctx.char, nextChat, lore);
        }
        return { ok: true, chat: nextChat, chatIndex: ctx.chatIndex, charIdx: ctx.charIdx };
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

        readUnlock() {
            if (this.readers <= 0) {
                this.readers = 0;
                if (isLibraDebugEnabled()) {
                    console.warn('[LIBRA][RWLock] readUnlock called with no active readers');
                }
                this._next();
                return;
            }
            this.readers--;
            this._next();
        }
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
    // [UTILITY] Async Task Queue
    // ══════════════════════════════════════════════════════════════
    class AsyncTaskQueue {
        constructor(maxConcurrent = 1, label = 'AsyncTaskQueue') {
            this.maxConcurrent = Math.max(1, maxConcurrent);
            this.label = label;
            this.queue = [];
            this.active = 0;
        }

        _isDebugEnabled() {
            return isLibraDebugEnabled();
        }

        _now() {
            try {
                return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            } catch {
                return Date.now();
            }
        }

        _log(message) {
            if (this._isDebugEnabled()) {
                console.log(`[LIBRA][${this.label}] ${message}`);
            }
        }

        _drain() {
            while (this.active < this.maxConcurrent && this.queue.length > 0) {
                const item = this.queue.shift();
                this.active += 1;
                const startedAt = this._now();
                const queuedFor = Math.max(0, Math.round(startedAt - item.enqueuedAt));
                this._log(`start ${item.name} | queued=${queuedFor}ms | active=${this.active}/${this.maxConcurrent} | pending=${this.queue.length}`);
                Promise.resolve()
                    .then(item.task)
                    .then(item.resolve)
                    .catch(item.reject)
                    .finally(() => {
                        const finishedAt = this._now();
                        const ranFor = Math.max(0, Math.round(finishedAt - startedAt));
                        this.active -= 1;
                        this._log(`finish ${item.name} | ran=${ranFor}ms | active=${this.active}/${this.maxConcurrent} | pending=${this.queue.length}`);
                        this._drain();
                    });
            }
        }

        enqueue(task, name = 'task') {
            return new Promise((resolve, reject) => {
                const item = { task, resolve, reject, name, enqueuedAt: this._now() };
                this.queue.push(item);
                this._log(`enqueue ${item.name} | active=${this.active}/${this.maxConcurrent} | pending=${this.queue.length}`);
                this._drain();
            });
        }

        get pendingCount() { return this.queue.length; }
        get activeCount() { return this.active; }
    }

    const MaintenanceLLMQueue = new AsyncTaskQueue(3, 'MaintenanceLLMQueue');
    const BackgroundMaintenanceQueue = new AsyncTaskQueue(1, 'BackgroundMaintenanceQueue');
    const runMaintenanceLLM = (task, name = 'maintenance-llm') => MaintenanceLLMQueue.enqueue(task, name);

    const safeClone = (value) => {
        if (value == null || typeof value !== 'object') return value;
        try {
            return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
        } catch (cloneError) {
            try {
                return JSON.parse(JSON.stringify(value));
            } catch (jsonError) {
                if (isLibraDebugEnabled()) {
                    console.warn('[LIBRA] safeClone failed; returning original reference', cloneError?.message || cloneError, jsonError?.message || jsonError);
                }
                return value;
            }
        }
    };
    const cloneForMutation = (value) => {
        const cloned = safeClone(value);
        if (cloned !== value || value == null || typeof value !== 'object') return cloned;
        if (Array.isArray(value)) {
            return value.map(item => safeClone(item));
        }
        return { ...value };
    };

    const extractJson = (text) => {
        if (!text || typeof text !== 'string') return null;
        const cleaned = Utils.stripLLMThinkingTags(text).trim();

        const sanitizeJsonCandidate = (value) => String(value || '')
            .replace(/^\uFEFF/, '')
            .replace(/[“”]/g, '"')
            .replace(/[‘’]/g, "'")
            .replace(/,\s*([}\]])/g, '$1')
            .trim();

        const parseCandidate = (candidate) => {
            const normalized = sanitizeJsonCandidate(candidate);
            if (!normalized) return null;
            try {
                return JSON.parse(normalized);
            } catch {
                return null;
            }
        };

        const findBalancedJsonObject = (source) => {
            const raw = String(source || '');
            let start = -1;
            let depth = 0;
            let inString = false;
            let escaped = false;
            for (let i = 0; i < raw.length; i++) {
                const ch = raw[i];
                if (start < 0) {
                    if (ch === '{') {
                        start = i;
                        depth = 1;
                    }
                    continue;
                }
                if (inString) {
                    if (escaped) {
                        escaped = false;
                    } else if (ch === '\\') {
                        escaped = true;
                    } else if (ch === '"') {
                        inString = false;
                    }
                    continue;
                }
                if (ch === '"') {
                    inString = true;
                    continue;
                }
                if (ch === '{') depth += 1;
                else if (ch === '}') {
                    depth -= 1;
                    if (depth === 0) return raw.slice(start, i + 1);
                }
            }
            if (start >= 0 && depth > 0) return raw.slice(start);
            return '';
        };

        const tryRepairTruncatedJson = (candidate) => {
            let normalized = sanitizeJsonCandidate(candidate);
            if (!normalized.startsWith('{')) return null;

            let inString = false;
            let escaped = false;
            let braceDepth = 0;
            let bracketDepth = 0;
            for (let i = 0; i < normalized.length; i++) {
                const ch = normalized[i];
                if (inString) {
                    if (escaped) escaped = false;
                    else if (ch === '\\') escaped = true;
                    else if (ch === '"') inString = false;
                    continue;
                }
                if (ch === '"') inString = true;
                else if (ch === '{') braceDepth += 1;
                else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
                else if (ch === '[') bracketDepth += 1;
                else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
            }

            if (inString) normalized += '"';
            normalized += ']'.repeat(bracketDepth);
            normalized += '}'.repeat(braceDepth);
            normalized = normalized.replace(/,\s*([}\]])/g, '$1');
            return parseCandidate(normalized);
        };

        const direct = parseCandidate(cleaned);
        if (direct) return direct;

        const codeBlock = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (codeBlock) {
            const parsedCodeBlock = parseCandidate(codeBlock[1]);
            if (parsedCodeBlock) return parsedCodeBlock;
            const balancedCodeBlock = findBalancedJsonObject(codeBlock[1]);
            const repairedCodeBlock = parseCandidate(balancedCodeBlock) || tryRepairTruncatedJson(balancedCodeBlock);
            if (repairedCodeBlock) return repairedCodeBlock;
        }

        const balanced = findBalancedJsonObject(cleaned);
        return parseCandidate(balanced) || tryRepairTruncatedJson(balanced) || null;
    };

    const getEmbeddingDebugSnapshotSafe = () => {
        let engine = null;
        try {
            engine = MemoryEngine?.EmbeddingEngine || null;
        } catch {
            engine = null;
        }
        if (!engine || typeof engine.getDebugSnapshot !== 'function') {
            return {
                totalCalls: 0,
                cacheHits: 0,
                providerCalls: 0,
                lastProvider: '',
                lastModel: '',
                lastDims: 0,
                lastStatus: 'unavailable'
            };
        }
        try {
            return engine.getDebugSnapshot();
        } catch {
            return {
                totalCalls: 0,
                cacheHits: 0,
                providerCalls: 0,
                lastProvider: '',
                lastModel: '',
                lastDims: 0,
                lastStatus: 'error'
            };
        }
    };

    const deriveMaxTurnFromLorebook = (lorebook) => {
        const managed = Array.isArray(lorebook) ? lorebook.filter(entry => entry?.comment && String(entry.comment).startsWith('lmai_')) : [];
        let maxTurn = 0;
        const turnKeys = new Set(['turn', 'upToTurn', 'lastSummaryTurn', 'currentTurn', 'lastConsolidationTurn', 'firstTurn', 'lastTurn', 't']);
        const seenObjects = new WeakSet();

        const consider = (value) => {
            const num = Number(value);
            if (Number.isFinite(num) && num >= 0 && num < 1000000) {
                maxTurn = Math.max(maxTurn, Math.floor(num));
            }
        };

        const walk = (value, parentKey = '') => {
            if (value == null) return;
            if (Array.isArray(value)) {
                for (const item of value) walk(item, parentKey);
                return;
            }
            if (typeof value !== 'object') {
                if (turnKeys.has(parentKey)) consider(value);
                return;
            }
            if (seenObjects.has(value)) return;
            seenObjects.add(value);
            for (const [key, child] of Object.entries(value)) {
                if (turnKeys.has(key)) consider(child);
                walk(child, key);
            }
        };

        for (const entry of managed) {
            try {
                if (entry.comment === 'lmai_memory') {
                    const metaMatch = String(entry.content || '').match(/\[META:(\{.*?\})\]/);
                    if (metaMatch) {
                        const meta = JSON.parse(metaMatch[1]);
                        consider(meta?.t);
                    }
                }
            } catch { /* ignore malformed meta */ }

            try {
                const parsed = JSON.parse(entry.content || '{}');
                walk(parsed);
            } catch { /* not all entries are JSON */ }
        }

        return maxTurn;
    };

    // ══════════════════════════════════════════════════════════════
    // [UTILITY] Global Utilities
    // ══════════════════════════════════════════════════════════════
    const Utils = {
        confirmEx: (msg) => new Promise(res => {
            setTimeout(() => res(window.confirm(msg)), 0);
        }),
        alertEx: (msg) => new Promise(res => {
            setTimeout(() => { window.alert(msg); res(); }, 0);
        }),
        sleep: (ms) => new Promise(res => setTimeout(res, ms)),

        /**
         * LLM 사고/필터 태그 제거 (프로바이더 공통)
         * <thoughts>, <thinking>, <__filter_complete__> 등 LLM 내부 추론 태그를 제거
         */
        stripLLMThinkingTags: (text) => {
            if (!text) return text;
            let clean = String(text);
            clean = clean.replace(/<thoughts>[\s\S]*?<\/thoughts>/gi, '');
            clean = clean.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
            clean = clean.replace(/<__filter_complete__>[\s\S]*?<\/__filter_complete__>/gi, '');
            clean = clean.replace(/<__filter_complete__\s*\/?>/gi, '');
            // 닫히지 않은 사고 태그 제거 (LLM 출력이 잘린 경우)
            clean = clean.replace(/<thoughts>[\s\S]*$/gi, '');
            clean = clean.replace(/<thinking>[\s\S]*$/gi, '');
            return clean;
        },

        stripManagedModuleTags: (text) => {
            if (!text) return text;
            let clean = String(text);
            clean = clean.replace(/<GT-CTRL\b[^>]*\/>/gi, '');
            clean = clean.replace(/<GT-SEP\/>/gi, '');
            clean = clean.replace(/<GigaTrans>[\s\S]*?<\/GigaTrans>/gi, '');
            clean = stripLBDATA(clean);
            clean = clean.replace(/\[Lightboard Platform Managed\]/gi, '');
            clean = clean.replace(/<lb-[\w-]+(?:\s[^>]*)?>[\s\S]*?<\/lb-[\w-]+>/gi, '');
            clean = clean.replace(/<lb-[\w-]+(?:\s[^>]*)?\/>/gi, '');
            return clean;
        },
        
        sanitizeForLibra: (text) => {
            if (!text) return text;
            let clean = Utils.stripLLMThinkingTags(text);
            clean = Utils.stripManagedModuleTags(clean);
            
            const result = clean.trim();
            if (isLibraDebugEnabled() && result !== text.trim()) {
                console.log(`[LIBRA] Text sanitized (Module compatibility active)`);
            }
            return result;
        },

        getMessageText: (msg) => {
            if (!msg || typeof msg !== 'object') return '';

            const extract = (value) => {
                if (value == null) return '';
                if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                    return String(value);
                }
                if (Array.isArray(value)) {
                    return value.map(extract).filter(Boolean).join('\n').trim();
                }
                if (typeof value === 'object') {
                    const preferredKeys = ['content', 'text', 'message', 'msg', 'mes', 'data', 'value'];
                    for (const key of preferredKeys) {
                        const picked = extract(value[key]);
                        if (picked) return picked;
                    }
                }
                return '';
            };

            return extract(msg.data)
                || extract(msg.content)
                || extract(msg.text)
                || extract(msg.message)
                || extract(msg.msg)
                || extract(msg.mes)
                || '';
        },

        getLibraComparableText: (text) => {
            const sanitized = Utils.sanitizeForLibra(text);
            return typeof sanitized === 'string' ? sanitized.trim() : String(sanitized || '').trim();
        },

        getMemorySourceText: (text) => {
            const strippedThinking = Utils.stripLLMThinkingTags(text);
            const strippedManaged = Utils.stripManagedModuleTags(strippedThinking);
            return typeof strippedManaged === 'string' ? strippedManaged.trim() : String(strippedManaged || '').trim();
        },

        hasLibraVisibleContent: (text) => {
            return Utils.getLibraComparableText(text).length > 0;
        },

        isRecoverableNarrativeCandidate: (text, roleHint = 'either') => {
            const raw = Utils.getMemorySourceText(text);
            if (!raw || raw.length < 3) return false;
            if (Utils.isMetaPromptLike(raw)) return false;
            if (Utils.isTagOnlyToolResponse(raw)) return false;

            const lower = raw.toLowerCase();
            const blockedMarkers = [
                '[lbdata start]',
                '[lbdata end]',
                '<past conversations>',
                '</past conversations>',
                '--- chat log end ---',
                '"messages": [',
                '"max_tokens":',
                '"logit_bias":',
                '## ai guidance:',
                '## character information',
                '<others info>',
                '<lore>',
                '</lore>'
            ];
            if (blockedMarkers.some(marker => lower.includes(marker))) return false;

            if (roleHint === 'user' && /^(?:assistant|character)\s*:/im.test(raw) && !/^user\s*:/im.test(raw)) {
                return false;
            }
            if (roleHint === 'ai' && /^user\s*:/im.test(raw) && !/^(?:assistant|character)\s*:/im.test(raw) && !/\[응답\]/.test(raw)) {
                return false;
            }
            return true;
        },

        scoreNarrativeCandidate: (text, roleHint = 'either') => {
            const raw = Utils.getMemorySourceText(text);
            if (!Utils.isRecoverableNarrativeCandidate(raw, roleHint)) return -Infinity;

            const lower = raw.toLowerCase();
            let score = 0;

            score += Math.min(8, Math.floor(raw.length / 180));
            if (/\n/.test(raw)) score += 2;
            if (/["“”]|'.+?'/.test(raw)) score += 2;
            if (/⏱️|\[사용자\]|\[응답\]|^user\s*:|^(assistant|character)\s*:/im.test(raw)) score += 3;
            if (/<current input>/i.test(raw)) score -= 2;
            if (/\bjson\b|logit_bias|max_tokens|stream\s*:\s*true/i.test(lower)) score -= 6;
            if (/##\s*ai guidance:|##\s*character information|<others info>|<lore>/i.test(raw)) score -= 6;
            if (roleHint === 'user' && /^user\s*:/im.test(raw)) score += 2;
            if (roleHint === 'ai' && /^(assistant|character)\s*:/im.test(raw)) score += 2;
            if (roleHint === 'ai' && /⏱️|chatindex|@hidden spoiler@|# response/i.test(raw)) score += 3;

            return score;
        },

        extractNarrativePayload: (text, roleHint = 'either') => {
            const raw = Utils.getMemorySourceText(text);
            if (!raw) return '';
            if (!Utils.isMetaPromptLike(raw) && !Utils.isTagOnlyToolResponse(raw)) {
                return Utils.isRecoverableNarrativeCandidate(raw, roleHint) ? raw : '';
            }

            const seen = new Set();
            const candidates = [];
            const pushCandidate = (value) => {
                const candidate = Utils.getMemorySourceText(value);
                if (!candidate) return;
                const normalized = candidate.trim();
                if (!normalized || seen.has(normalized)) return;
                seen.add(normalized);
                candidates.push(normalized);
            };

            const tagged = Utils.splitTaggedTurn(raw);
            if (roleHint !== 'ai') pushCandidate(tagged.user);
            if (roleHint !== 'user') pushCandidate(tagged.ai);

            const currentInputMatch = raw.match(/<Current Input>\s*```([\s\S]*?)```\s*<\/Current Input>/i);
            pushCandidate(currentInputMatch?.[1] || '');

            const userMatch = raw.match(/(?:^|\n)\s*USER:\s*"([\s\S]*?)"\s*(?=\n\s*(?:CHARACTER:|ASSISTANT:|SYSTEM:|$))/i);
            if (roleHint !== 'ai') pushCandidate(userMatch?.[1] || '');

            const assistantMatch = raw.match(/(?:^|\n)\s*(?:ASSISTANT|CHARACTER):\s*([\s\S]*?)\s*(?=\n\s*(?:USER:|SYSTEM:|$))/i);
            if (roleHint !== 'user') pushCandidate(assistantMatch?.[1] || '');

            const ranked = candidates
                .map(candidate => ({ candidate, score: Utils.scoreNarrativeCandidate(candidate, roleHint) }))
                .filter(item => Number.isFinite(item.score))
                .sort((a, b) => b.score - a.score);

            return ranked[0]?.candidate || '';
        },

        getNarrativeComparableText: (text, roleHint = 'either') => {
            return Utils.extractNarrativePayload(text, roleHint);
        },

        getNarrativeSourceText: (text, roleHint = 'either') => {
            return Utils.extractNarrativePayload(text, roleHint);
        },

        isTagOnlyToolResponse: (text) => {
            const raw = String(text || '').trim();
            if (!raw) return false;
            const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            if (!lines.length || lines.length > 6) return false;
            return lines.every(line => /^(?:\[[^\]\n]+\])+(?:[★■\s]+)?$/.test(line));
        },

        isMetaPromptLike: (text) => {
            const raw = String(text || '').trim();
            if (!raw) return false;
            const lower = raw.toLowerCase();
            const patterns = [
                '# system rule',
                'you are a data extraction bot',
                'your only job is to analyze',
                'analyze the following chat log',
                'provide the data string now',
                'final output format',
                'affection tag rules',
                'status tag rules',
                'rules start',
                'chat log start',
                'reiteration phase',
                '<|im_start|>system',
                '# advance_notice',
                '# system_role',
                'translate the <sample_text>',
                'output only the translated text',
                'preserve as is',
                'core_principles',
                'additional_instructions',
                'narrative register [mandatory]',
                'zero omission + zero translationese',
                'this prompt has been confirmed for use only in fully personalized, private sessions',
                '<system>',
                '</system>',
                '<thoughts>',
                '<thinking>',
                'output must strictly follow these rules',
                'output json:',
                'do not output any other text',
                'system: pov : freely',
                'respond in full english',
                'all the characters inside this rp are adults who are acting',
                'platform policies were disabled',
                'platform policy unactivated'
            ];
            return patterns.some(p => lower.includes(p));
        },

        hasSubstantialNarrativePayload: (text, roleHint = 'either') => {
            const candidate = Utils.extractNarrativePayload(text, roleHint);
            if (!candidate) return false;
            const visible = String(candidate)
                .replace(/\[[^\]\n]{1,80}\]/g, ' ')
                .replace(/<[^>\n]{1,80}>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (visible.length < 12) return false;
            const meaningfulUnits = (visible.match(/[A-Za-z0-9\u3131-\u318E\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFF]/g) || []).length;
            return meaningfulUnits >= 8;
        },

        isForcedBypassPrompt: (text) => {
            const raw = String(text || '').trim();
            if (!raw) return false;
            return /^provide the data string now\.?$/i.test(raw);
        },

        splitTaggedTurn: (text) => {
            const raw = String(text || '');
            const userMatch = raw.match(/\[사용자\]\s*([\s\S]*?)(?:\n\[응답\]|\r\n\[응답\]|$)/);
            const aiMatch = raw.match(/\[응답\]\s*([\s\S]*)$/);
            return {
                user: (userMatch?.[1] || '').trim(),
                ai: (aiMatch?.[1] || '').trim()
            };
        },

        shouldExcludeMemoryContent: (text, roleHint = 'either') => {
            const recovered = Utils.extractNarrativePayload(text, roleHint);
            if (recovered) return false;

            const raw = Utils.getLibraComparableText(text);
            if (!raw) return true;
            const tagged = Utils.splitTaggedTurn(raw);
            if (tagged.user || tagged.ai) {
                if (Utils.isMetaPromptLike(tagged.user) || Utils.isMetaPromptLike(tagged.ai)) return true;
                if (Utils.isTagOnlyToolResponse(tagged.ai)) return true;
            }
            if (Utils.isMetaPromptLike(raw)) return true;
            if (Utils.isTagOnlyToolResponse(raw)) return true;
            return false;
        },

        shouldExcludeStoredMemoryContent: (text) => {
            const raw = Utils.getMemorySourceText(text);
            if (!raw || raw.length < 5) return true;
            if (Utils.isMetaPromptLike(raw)) return true;
            if (Utils.isTagOnlyToolResponse(raw)) return true;

            const tagged = Utils.splitTaggedTurn(raw);
            if (tagged.user && Utils.isMetaPromptLike(tagged.user)) return true;
            if (tagged.ai && Utils.isTagOnlyToolResponse(tagged.ai)) return true;
            return false;
        },

        shouldBypassNarrativeSystems: (userText, aiText = '') => {
            const user = Utils.getNarrativeComparableText(userText, 'user');
            const ai = Utils.getNarrativeComparableText(aiText, 'ai');
            const rawUser = Utils.getMemorySourceText(userText);
            const hasNarrativePayload =
                Utils.hasSubstantialNarrativePayload(userText, 'user') ||
                Utils.hasSubstantialNarrativePayload(aiText, 'ai');

            if (!user && !ai && !hasNarrativePayload) return true;
            if (Utils.isForcedBypassPrompt(user) || Utils.isForcedBypassPrompt(rawUser)) return true;
            return false;
        },

        isNarrativeRequestType: (type) => {
            const normalized = String(type || '').trim().toLowerCase();
            if (!normalized) return true;
            if (normalized === 'model' || normalized === 'submodel' || normalized === 'otherax') return true;
            if (normalized === 'memory' || normalized === 'emotion' || normalized === 'translate') return false;
            return true;
        }
    };

    const LibraLoreKeys = {
        entityFromName: (name) => `lmai_entity::${TokenizerEngine.simpleHash(String(name || '').trim().toLowerCase())}`,
        relationFromNames: (nameA, nameB) => {
            const a = String(nameA || '').trim().toLowerCase();
            const b = String(nameB || '').trim().toLowerCase();
            const parts = [a, b].sort();
            return `lmai_relation::${TokenizerEngine.simpleHash(parts.join('::'))}`;
        },
        worldGraph: () => 'lmai_world_graph::core',
        narrative: () => 'lmai_narrative::core',
        charStates: () => 'lmai_char_states::core',
        worldStates: () => 'lmai_world_states::core'
    };

    const parseLooseJson = (text) => {
        if (!text || typeof text !== 'string') return null;
        const cleaned = Utils.stripLLMThinkingTags(text).trim();
        try {
            return JSON.parse(cleaned);
        } catch {}
        const codeBlock = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (codeBlock) {
            try {
                const inner = codeBlock[1].trim().match(/\{[\s\S]*\}/);
                if (inner) return JSON.parse(inner[0]);
            } catch {}
        }
        try {
            const match = cleaned.match(/\{[\s\S]*\}/);
            return match ? JSON.parse(match[0]) : null;
        } catch {
            return null;
        }
    };

    // ══════════════════════════════════════════════════════════════
    // [MANAGER] Cold Start Manager
    // ══════════════════════════════════════════════════════════════
    const ColdStartManager = (() => {
        let isProcessing = false;

        const ColdStartSummaryPrompt = `당신은 과거 대화 내역을 분석하여 핵심 요약을 생성하는 전문가입니다.
제공된 대화 청크를 분석하여 다음 정보를 JSON 형식으로 추출하십시오.

{
    "events": ["주요 사건 리스트"],
    "characters": [
        { "name": "이름", "details": "외모/성격/배경 요약" }
    ],
    "relationships": [
        { "pair": ["A", "B"], "status": "관계 요약" }
    ],
    "world_rules": ["감지된 세계관 규칙"]
}

[외형 필수 항목]
characters의 details 중 외모에 다음을 반드시 포함하여 기술하십시오:
- 머리색, 머리모양, 피부색, 눈 모양, 눈 색, 키, 체형
- 여성 캐릭터의 경우 가슴 크기, 성기 특징도 반드시 포함
- 남성 캐릭터의 경우 성기 특징도 반드시 포함 (크기, 형태 등)
- 대화에서 직접 언급되지 않더라도 묘사에서 유추 가능하면 추출

[성격 필수 항목]
characters의 details 중 성격에 다음을 반드시 포함하여 기술하십시오:
- 성관념/Sexual attitudes (e.g. "개방적", "보수적", "순결주의")
- 성적취향/Sexual preferences (e.g. "이성애", "양성애", "S성향", "M성향")
- 대화에서 직접 언급되지 않더라도 묘사에서 유추 가능하면 추출

[출력 언어 규칙 / Output Language Rules]
- 이름(name)은 반드시 "한글(English)" 형식으로 작성하십시오. (e.g. "정수진(Jeong Sujin)", "히비키(Hibiki)")
- 이름을 제외한 모든 서술(details, events, status, world_rules 등)은 반드시 영문으로 작성하십시오.
- Names MUST be in "한글(English)" format. All other descriptions MUST be written in English.

주의: 반드시 유효한 JSON 구조만 반환하십시오. 다른 설명은 생략하십시오.`;

        const FinalSynthesisPrompt = `당신은 여러 개의 대화 요약본을 하나로 통합하는 마스터 편집자입니다.
분할된 요약 데이터들을 바탕으로, 이 채팅방의 현재 상태를 정의하는 최종 보고서를 JSON 형식으로 작성하십시오.

반환 형식:
{
    "narrative": "전체 줄거리 요약",
    "entities": [ { "name": "이름", "appearance": "외모", "personality": "성격", "background": "배경" } ],
    "relations": [ { "entityA": "이름", "entityB": "이름", "type": "관계유형", "sentiment": "감정상태" } ],
    "world": { "tech": "기술수준", "rules": ["규칙들"] }
}

[외형 필수 항목]
entities의 appearance에 다음을 반드시 포함하여 기술하십시오:
- 머리색, 머리모양, 피부색, 눈 모양, 눈 색, 키, 체형
- 여성 캐릭터의 경우 가슴 크기, 성기 특징도 반드시 포함
- 남성 캐릭터의 경우 성기 특징도 반드시 포함 (크기, 형태 등)
- 원본 요약 데이터에서 유추 가능하면 반드시 추출

[성격 필수 항목]
entities의 personality에 다음을 반드시 포함하여 기술하십시오:
- 성관념 (e.g. "개방적", "보수적", "순결주의")
- 성적취향 (e.g. "이성애", "양성애", "S성향", "M성향")
- 원본 요약 데이터에서 유추 가능하면 반드시 추출

[출력 언어 규칙 / Output Language Rules]
- 이름(name)은 반드시 "한글(English)" 형식으로 작성하십시오. (e.g. "정수진(Jeong Sujin)", "히비키(Hibiki)")
- 이름을 제외한 모든 서술(appearance, personality, narrative 등)은 반드시 영문으로 작성하십시오.
- Names MUST be in "한글(English)" format. All other descriptions MUST be written in English.

주의: 반드시 JSON만 반환하십시오.`;

        const ReanalysisReviewPrompt = `당신은 대화 로그를 재검증하는 서사 데이터 감사관입니다.
현재 구축된 데이터와 새로 재분석한 후보 데이터를 비교하고, 제공된 원문 대화 발췌를 기준으로 더 정확한 내용을 선택하거나 보정하십시오.

반드시 다음 JSON 형식만 반환하십시오:
{
  "narrative": "검증 후 최종 줄거리 요약",
  "entities": [ { "name": "이름", "appearance": "외모", "personality": "성격", "background": "배경" } ],
  "relations": [ { "entityA": "이름", "entityB": "이름", "type": "관계유형", "sentiment": "감정상태" } ],
  "world": { "tech": "기술수준", "rules": ["규칙들"] },
  "reviewNotes": ["어떤 부분을 왜 선택/보정했는지 짧은 근거"]
}

규칙:
- 원문 대화 발췌에 근거가 없는 정보는 제거하십시오.
- 현재 데이터와 후보 데이터 중 더 정확한 쪽을 선택하되, 필요하면 둘을 보정 결합할 수 있습니다.
- 추측하지 말고 원문 근거를 우선하십시오.
- 반드시 JSON만 반환하십시오.`;

        const ReanalysisFinalArbiterPrompt = `당신은 재분석 최종 판정자입니다.
기존 구조 데이터, 새로 생성된 후보 데이터, 그리고 부분 review 결과들을 함께 검토하여 가장 정확한 최종 서사 데이터를 결정하십시오.

반드시 다음 JSON 형식만 반환하십시오:
{
  "narrative": "최종 줄거리 요약",
  "entities": [ { "name": "이름", "appearance": "외모", "personality": "성격", "background": "배경" } ],
  "relations": [ { "entityA": "이름", "entityB": "이름", "type": "관계유형", "sentiment": "감정상태" } ],
  "world": { "tech": "기술수준", "rules": ["규칙들"] }
}

규칙:
- 부분 review 결과들은 원문 발췌를 기반으로 한 보정 근거입니다.
- 기존 구조 데이터와 후보 데이터가 충돌하면, review 결과와 일치하는 쪽을 우선하십시오.
- review 결과가 일부만 다루는 경우에는 나머지 필드는 가장 일관된 데이터를 유지하십시오.
- 반드시 JSON만 반환하십시오.`;

        const ANALYSIS_MAX_LINE_CHARS = 900;
        const ANALYSIS_MAX_CHUNK_CHARS = 9000;
        const SYNTHESIS_MAX_INPUT_CHARS = 12000;
        const REVIEW_EXCERPT_MAX_CHARS = 5000;
        const REVIEW_DATA_MAX_CHARS = 2200;
        const REANALYSIS_REVIEW_WINDOW_CHARS = 2600;
        const REANALYSIS_REVIEW_WINDOW_MESSAGES = 18;
        const REANALYSIS_REVIEW_WINDOW_OVERLAP = 4;
        const REANALYSIS_REVIEW_MAX_WINDOWS = 6;
        const IMPORT_KNOWLEDGE_MAX_ITEM_CHARS = 1800;

        const truncateForLLM = (value, maxChars, marker = '\n...[TRUNCATED]...\n') => {
            const text = String(value || '');
            const limit = Math.max(0, Number(maxChars) || 0);
            if (!limit || text.length <= limit) return text;
            if (limit <= marker.length + 20) return text.slice(0, limit);
            const remain = limit - marker.length;
            const headSize = Math.ceil(remain * 0.6);
            const tailSize = Math.max(0, remain - headSize);
            return `${text.slice(0, headSize)}${marker}${tailSize > 0 ? text.slice(-tailSize) : ''}`;
        };

        const compactTextArray = (items, maxItems = 6, maxItemChars = 240) => {
            return dedupeTextArray(items)
                .slice(0, maxItems)
                .map(item => truncateForLLM(item, maxItemChars, ' ...[TRUNCATED]... '));
        };

        const compactChunkSummary = (summary) => ({
            events: compactTextArray(summary?.events, 6, 220),
            characters: (Array.isArray(summary?.characters) ? summary.characters : [])
                .slice(0, 8)
                .map(ch => ({
                    name: truncateForLLM(ch?.name || '', 80, ' ... '),
                    details: truncateForLLM(ch?.details || '', 420, ' ...[TRUNCATED]... ')
                }))
                .filter(ch => ch.name || ch.details),
            relationships: (Array.isArray(summary?.relationships) ? summary.relationships : [])
                .slice(0, 8)
                .map(rel => ({
                    pair: Array.isArray(rel?.pair) ? rel.pair.slice(0, 2).map(name => truncateForLLM(name || '', 80, ' ... ')) : [],
                    status: truncateForLLM(rel?.status || '', 260, ' ...[TRUNCATED]... ')
                }))
                .filter(rel => rel.pair.length === 2 || rel.status),
            world_rules: compactTextArray(summary?.world_rules, 8, 220)
        });

        const buildBoundedJsonArray = (items, maxChars, fallbackValue = []) => {
            const list = Array.isArray(items) ? items : [];
            if (list.length === 0) return JSON.stringify(fallbackValue);
            const out = [];
            for (const item of list) {
                out.push(item);
                const serialized = JSON.stringify(out);
                if (serialized.length > maxChars) {
                    out.pop();
                    break;
                }
            }
            if (out.length === 0) {
                return truncateForLLM(JSON.stringify([list[0]]), maxChars);
            }
            return JSON.stringify(out);
        };

        const compactStructuredSnapshot = (data) => ({
            narrative: truncateForLLM(data?.narrative || '', 1200, ' ...[TRUNCATED]... '),
            entities: (Array.isArray(data?.entities) ? data.entities : [])
                .slice(0, 10)
                .map(entity => ({
                    name: truncateForLLM(entity?.name || '', 80, ' ... '),
                    appearance: truncateForLLM(entity?.appearance || '', 260, ' ...[TRUNCATED]... '),
                    personality: truncateForLLM(entity?.personality || '', 260, ' ...[TRUNCATED]... '),
                    background: truncateForLLM(entity?.background || '', 260, ' ...[TRUNCATED]... ')
                }))
                .filter(entity => entity.name),
            relations: (Array.isArray(data?.relations) ? data.relations : [])
                .slice(0, 12)
                .map(relation => ({
                    entityA: truncateForLLM(relation?.entityA || '', 80, ' ... '),
                    entityB: truncateForLLM(relation?.entityB || '', 80, ' ... '),
                    type: truncateForLLM(relation?.type || '', 180, ' ...[TRUNCATED]... '),
                    sentiment: truncateForLLM(relation?.sentiment || '', 220, ' ...[TRUNCATED]... ')
                }))
                .filter(relation => relation.entityA && relation.entityB),
            world: {
                tech: truncateForLLM(data?.world?.tech || '', 120, ' ... '),
                rules: compactTextArray(data?.world?.rules, 10, 220)
            }
        });

        const buildCompactStructuredJson = (data, maxChars = REVIEW_DATA_MAX_CHARS) => {
            return buildBoundedJsonArray([compactStructuredSnapshot(data)], maxChars, [{}]).replace(/^\[(.*)\]$/s, '$1');
        };

        const stripReviewNotes = (data) => {
            if (!data || typeof data !== 'object') return data;
            const { reviewNotes, ...rest } = data;
            return rest;
        };

        const buildReanalysisReviewWindows = (msgs) => {
            const source = Array.isArray(msgs) ? msgs : [];
            if (source.length === 0) return [];
            const windows = [];
            let start = 0;
            while (start < source.length && windows.length < REANALYSIS_REVIEW_MAX_WINDOWS) {
                const collected = [];
                let totalChars = 0;
                let idx = start;
                while (idx < source.length && collected.length < REANALYSIS_REVIEW_WINDOW_MESSAGES) {
                    const item = source[idx];
                    const role = (item?.msg?.role === 'user' || item?.msg?.is_user) ? 'User' : 'AI';
                    const line = `${role}: ${truncateForLLM(item?.text || '', 500, ' ...[TRUNCATED]... ')}`;
                    const delta = line.length + (collected.length > 0 ? 2 : 0);
                    if (collected.length > 0 && totalChars + delta > REANALYSIS_REVIEW_WINDOW_CHARS) break;
                    collected.push(item);
                    totalChars += delta;
                    idx += 1;
                }
                if (collected.length === 0) {
                    const single = source[start];
                    windows.push([single]);
                    start += 1;
                } else {
                    windows.push(collected);
                    if (idx >= source.length) break;
                    start = Math.max(start + 1, idx - REANALYSIS_REVIEW_WINDOW_OVERLAP);
                }
            }
            return windows;
        };

        const buildAnalysisChunkText = (chunk) => {
            const lines = (Array.isArray(chunk) ? chunk : [])
                .filter(({ msg }) => msg != null)
                .map(({ msg, text }) => {
                    const role = (msg?.role === 'user' || msg?.is_user) ? 'User' : 'AI';
                    return `${role}: ${truncateForLLM(text, ANALYSIS_MAX_LINE_CHARS, ' ...[TRUNCATED]... ')}`;
                })
                .filter(Boolean);
            if (lines.length === 0) return '';
            let joined = lines.join('\n\n');
            if (joined.length <= ANALYSIS_MAX_CHUNK_CHARS) return joined;

            const kept = [];
            let total = 0;
            let left = 0;
            let right = lines.length - 1;
            while (left <= right) {
                const takeLeft = kept.length % 2 === 0;
                const candidate = takeLeft ? lines[left++] : lines[right--];
                if (!candidate) continue;
                const delta = candidate.length + (kept.length > 0 ? 2 : 0);
                if (total + delta > ANALYSIS_MAX_CHUNK_CHARS) break;
                if (takeLeft) kept.push(candidate);
                else kept.splice(Math.max(1, kept.length), 0, candidate);
                total += delta;
            }

            const marker = '...[CHUNK TRUNCATED FOR ANALYSIS]...';
            if (left <= right && total + marker.length + 2 <= ANALYSIS_MAX_CHUNK_CHARS) {
                const headCount = Math.ceil(kept.length / 2);
                joined = [
                    ...kept.slice(0, headCount),
                    marker,
                    ...kept.slice(headCount)
                ].join('\n\n');
                return truncateForLLM(joined, ANALYSIS_MAX_CHUNK_CHARS);
            }
            joined = kept.join('\n\n');
            return truncateForLLM(joined, ANALYSIS_MAX_CHUNK_CHARS);
        };

        const buildSynthesisInput = (chunkSummaries) => {
            const compacted = (Array.isArray(chunkSummaries) ? chunkSummaries : []).map(compactChunkSummary);
            return buildBoundedJsonArray(compacted, SYNTHESIS_MAX_INPUT_CHARS, []);
        };

        const check = async () => {
            if (isProcessing) return;
            
            const char = await risuai.getCharacter();
            if (!char) return;

            const chat = char.chats?.[char.chatPage];
            if (!chat || getChatMessages(chat).length < 5) return;

            const lore = MemoryEngine.getEffectiveLorebook(char, chat);
            const hasLibraData = lore.some(e => 
                e.comment === "lmai_world_graph" || 
                e.comment === "lmai_narrative"
            );

            if (!hasLibraData) {
                const confirmed = await Utils.confirmEx(
                    "이 채팅방에서 LIBRA가 처음 실행되었습니다.\n과거 대화 내역을 분석하여 초기 메모리와 세계관을 구축하시겠습니까?\n(LLM 토큰이 소모됩니다)"
                );
                if (confirmed) {
                    await startAutoSummarization();
                }
            }
        };

        const normalizeKnowledgeText = (value) => String(value || '')
            .replace(/\s+/g, ' ')
            .replace(/^[\s,.;:!?()\[\]{}"'`~\-]+|[\s,.;:!?()\[\]{}"'`~\-]+$/g, '')
            .trim()
            .toLowerCase();

        const dedupeTextArray = (items) => {
            const out = [];
            const seen = new Set();
            for (const item of (Array.isArray(items) ? items : [])) {
                const raw = String(item || '').trim();
                if (!raw) continue;
                const key = normalizeKnowledgeText(raw);
                if (!key || seen.has(key)) continue;
                seen.add(key);
                out.push(raw);
            }
            return out;
        };

        const coalesceKnowledgeField = (...values) => {
            let best = '';
            for (const value of values) {
                const text = String(value || '').trim();
                if (!text) continue;
                if (!best || text.length > best.length) best = text;
            }
            return best;
        };

        const dedupeEntitiesForMerge = (entities) => {
            const merged = new Map();
            for (const entity of (Array.isArray(entities) ? entities : [])) {
                const name = String(entity?.name || '').trim();
                if (!name) continue;
                const key = EntityManager.normalizeName(name);
                const prev = merged.get(key) || { name, appearance: '', personality: '', background: '' };
                merged.set(key, {
                    name: prev.name || name,
                    appearance: coalesceKnowledgeField(prev.appearance, entity?.appearance),
                    personality: coalesceKnowledgeField(prev.personality, entity?.personality),
                    background: coalesceKnowledgeField(prev.background, entity?.background)
                });
            }
            return Array.from(merged.values());
        };

        const dedupeRelationsForMerge = (relations) => {
            const merged = new Map();
            for (const relation of (Array.isArray(relations) ? relations : [])) {
                const entityA = EntityManager.normalizeName(relation?.entityA || '');
                const entityB = EntityManager.normalizeName(relation?.entityB || '');
                if (!entityA || !entityB || entityA === entityB) continue;
                const key = [entityA, entityB].sort().join('__');
                const prev = merged.get(key) || { entityA, entityB, type: '', sentiment: '' };
                merged.set(key, {
                    entityA: prev.entityA || entityA,
                    entityB: prev.entityB || entityB,
                    type: coalesceKnowledgeField(prev.type, relation?.type),
                    sentiment: coalesceKnowledgeField(prev.sentiment, relation?.sentiment)
                });
            }
            return Array.from(merged.values());
        };

        const dedupeWorldRulesForMerge = (existingRules, newRules) => {
            return dedupeTextArray([
                ...(Array.isArray(existingRules) ? existingRules : []),
                ...(Array.isArray(newRules) ? newRules : [])
            ]);
        };

        const sanitizeStructuredKnowledge = (finalData) => ({
            narrative: String(finalData?.narrative || '').trim(),
            entities: dedupeEntitiesForMerge(finalData?.entities),
            relations: dedupeRelationsForMerge(finalData?.relations),
            world: {
                tech: String(finalData?.world?.tech || '').trim(),
                rules: dedupeTextArray(finalData?.world?.rules)
            }
        });

        const mergeStructuredKnowledge = async (finalData, options = {}) => {
            const opts = {
                updateNarrative: true,
                worldNote: "Updated via Cold Start",
                sourceId: 'baseline',
                ...options
            };
            const sanitized = sanitizeStructuredKnowledge(finalData);
            await loreLock.writeLock();
            try {
                const char = await requireLoadedCharacter();
                const chat = char.chats?.[char.chatPage];
                let lore = [...MemoryEngine.getLorebook(char, chat)];
                
                LMAI_GUI.toast("데이터 반영 중...");

                if (opts.updateNarrative) {
                    const narrative = NarrativeTracker.getState();
                    narrative.storylines = [{
                        id: 1,
                        name: "Initial Storyline",
                        entities: (sanitized.entities || []).map(e => e.name),
                        turns: [0],
                        firstTurn: 0,
                        lastTurn: 0,
                        recentEvents: [{ turn: 0, brief: "Cold Start: Initial summary applied." }],
                        summaries: [{ upToTurn: 0, summary: sanitized.narrative || '', keyPoints: [], ongoingTensions: [], timestamp: Date.now() }],
                        currentContext: sanitized.narrative || '',
                        keyPoints: [],
                        ongoingTensions: []
                    }];
                }

                // 2. Entities & Relations 반영
                for (const ent of (sanitized.entities || [])) {
                    if (!ent.name) continue;
                    EntityManager.updateEntity(ent.name, {
                        appearance: { features: [ent.appearance || ''] },
                        personality: { traits: [ent.personality || ''] },
                        background: { origin: ent.background || '' },
                        source: opts.updateNarrative ? 'cold_start' : 'hypa_v3_import',
                        s_id: opts.sourceId
                    }, lore);
                }

                for (const rel of (sanitized.relations || [])) {
                    if (!rel.entityA || !rel.entityB) continue;
                    EntityManager.updateRelation(rel.entityA, rel.entityB, {
                        relationType: rel.type || '',
                        sentiments: { fromAtoB: rel.sentiment || '' },
                        s_id: opts.sourceId
                    }, lore);
                }

                // 3. World Rules 반영 (Root Node)
                HierarchicalWorldManager.loadWorldGraph(lore);
                const profile = HierarchicalWorldManager.getProfile();
                const rootNode = profile?.nodes?.get(profile?.rootId);
                if (rootNode && sanitized.world) {
                    const techValue = String(sanitized.world.tech || '').trim();
                    if (techValue && !/^(unknown|none|n\/a)$/i.test(techValue)) {
                        rootNode.rules.exists.technology = techValue;
                    }
                    rootNode.rules.physics.special_phenomena = dedupeWorldRulesForMerge(
                        rootNode.rules?.physics?.special_phenomena,
                        sanitized.world.rules
                    );
                    rootNode.meta.notes = opts.worldNote;
                    rootNode.meta.s_id = opts.sourceId;
                }

                // 4. 모든 매니저의 상태를 하나의 로어북 배열로 통합
                // 각 saveState는 lore 배열을 직접 수정하며, 최종 저장은 아래에서 한 번만 수행합니다.
                
                await HierarchicalWorldManager.saveWorldGraphUnsafe(lore);
                await NarrativeTracker.saveState(lore);
                await StoryAuthor.saveState(lore);
                await Director.saveState(lore);
                await CharacterStateTracker.saveState(lore);
                await WorldStateTracker.saveState(lore);
                
                // EntityManager의 캐시를 로어북 엔트리로 변환하여 병합
                const currentTurn = MemoryState.currentTurn;
                for (const [name, entity] of EntityManager.getEntityCache()) {
                    entity.meta.s_id = entity.meta.s_id || 'baseline';
                    const entry = {
                        key: LibraLoreKeys.entityFromName(name),
                        comment: "lmai_entity",
                        content: JSON.stringify(entity, null, 2),
                        mode: 'normal',
                        insertorder: 50,
                        alwaysActive: false
                    };
                    const existingIdx = lore.findIndex(e => {
                        if (e.comment !== "lmai_entity") return false;
                        try {
                            const parsed = JSON.parse(e.content || '{}');
                            return EntityManager.normalizeName(parsed.name || '') === name;
                        } catch {
                            return false;
                        }
                    });
                    if (existingIdx >= 0) lore[existingIdx] = entry;
                    else lore.push(entry);
                }

                for (const [id, relation] of EntityManager.getRelationCache()) {
                    relation.meta.s_id = relation.meta.s_id || 'baseline';
                    const entry = {
                        key: LibraLoreKeys.relationFromNames(relation.entityA, relation.entityB),
                        comment: "lmai_relation",
                        content: JSON.stringify(relation, null, 2),
                        mode: 'normal',
                        insertorder: 60,
                        alwaysActive: false
                    };
                    const existingIdx = lore.findIndex(e => {
                        if (e.comment !== "lmai_relation") return false;
                        try {
                            const parsed = JSON.parse(e.content || '{}');
                            const parsedId = parsed.id || `${EntityManager.normalizeName(parsed.entityA || '')}_${EntityManager.normalizeName(parsed.entityB || '')}`;
                            return parsedId === id;
                        } catch {
                            return false;
                        }
                    });
                    if (existingIdx >= 0) lore[existingIdx] = entry;
                    else lore.push(entry);
                }

                // 최종 저장
                if (chat) {
                    chat.localLore = lore;
                } else {
                    char.lorebook = lore;
                }
                await persistLoreToActiveChat(chat, lore);

                LMAI_GUI.toast("✨ LIBRA 초기 메모리 구축이 완료되었습니다!");
                delete MemoryState.pendingColdStartData;

            } catch (e) {
                console.error("[LIBRA] Cold Start Apply Error:", e);
                LMAI_GUI.toast("❌ 데이터 반영 중 오류 발생");
            } finally {
                loreLock.writeUnlock();
            }
        };

        const applyFinalData = async (finalData) => mergeStructuredKnowledge(finalData, {
            updateNarrative: true,
            worldNote: "Updated via Cold Start",
            sourceId: 'baseline'
        });

        const buildConversationExcerpt = (msgs, maxChars = REVIEW_EXCERPT_MAX_CHARS) => {
            const lines = (Array.isArray(msgs) ? msgs : [])
                .filter(({ msg }) => msg != null)
                .map(({ msg, text }) => `${(msg?.role === 'user' || msg?.is_user) ? 'User' : 'AI'}: ${truncateForLLM(text, 700, ' ...[TRUNCATED]... ')}`)
                .filter(Boolean);
            const full = lines.join('\n\n');
            return truncateForLLM(full, maxChars, '\n\n...[TRUNCATED FOR REVIEW]...\n\n');
        };

        const buildCurrentStructuredSnapshot = (lore) => {
            const narrativeState = NarrativeTracker.getState?.() || { storylines: [] };
            const storylines = Array.isArray(narrativeState.storylines) ? narrativeState.storylines : [];
            const narrative = storylines
                .map(storyline => {
                    const parts = [];
                    if (storyline.name) parts.push(storyline.name);
                    if (storyline.currentContext) parts.push(storyline.currentContext);
                    if (Array.isArray(storyline.keyPoints) && storyline.keyPoints.length > 0) parts.push(`Key: ${storyline.keyPoints.join('; ')}`);
                    if (Array.isArray(storyline.ongoingTensions) && storyline.ongoingTensions.length > 0) parts.push(`Flow: ${storyline.ongoingTensions.join('; ')}`);
                    return parts.join(' | ');
                })
                .filter(Boolean)
                .join('\n');
            const entities = Array.from(EntityManager.getEntityCache().values()).map(entity => ({
                name: entity.name || '',
                appearance: [...(entity.appearance?.features || []), ...(entity.appearance?.distinctiveMarks || []), ...(entity.appearance?.clothing || [])].filter(Boolean).join(', '),
                personality: [...(entity.personality?.traits || []), ...(entity.personality?.likes || []), ...(entity.personality?.dislikes || [])].filter(Boolean).join(', '),
                background: [entity.background?.origin || '', entity.background?.occupation || '', ...(entity.background?.history || [])].filter(Boolean).join(', ')
            }));
            const relations = Array.from(EntityManager.getRelationCache().values()).map(relation => ({
                entityA: relation.entityA || '',
                entityB: relation.entityB || '',
                type: relation.relationType || '',
                sentiment: [relation.sentiments?.fromAtoB || '', relation.sentiments?.fromBtoA || ''].filter(Boolean).join(' / ')
            }));
            const profile = HierarchicalWorldManager.getProfile();
            const rootNode = profile?.nodes?.get(profile?.rootId);
            return sanitizeStructuredKnowledge({
                narrative,
                entities,
                relations,
                world: {
                    tech: rootNode?.rules?.exists?.technology || '',
                    rules: rootNode?.rules?.physics?.special_phenomena || []
                }
            });
        };

        const replaceStructuredKnowledge = async (finalData, options = {}) => {
            const opts = {
                worldNote: 'Rebuilt via Reanalysis',
                sourceId: 'reanalysis',
                ...options
            };
            const sanitized = sanitizeStructuredKnowledge(finalData);
            await loreLock.writeLock();
            try {
                const char = await requireLoadedCharacter();
                const chat = char.chats?.[char.chatPage];
                let lore = [...MemoryEngine.getLorebook(char, chat)];

                lore = lore.filter(entry => ![
                    'lmai_entity',
                    'lmai_relation',
                    'lmai_narrative',
                    'lmai_story_author',
                    'lmai_char_states',
                    'lmai_world_states'
                ].includes(entry.comment));

                EntityManager.clearCache();
                for (const ent of (sanitized.entities || [])) {
                    if (!ent.name) continue;
                    EntityManager.updateEntity(ent.name, {
                        appearance: { features: [ent.appearance || ''] },
                        personality: { traits: [ent.personality || ''] },
                        background: { origin: ent.background || '' },
                        source: 'reanalysis',
                        s_id: opts.sourceId
                    }, lore);
                }
                for (const rel of (sanitized.relations || [])) {
                    if (!rel.entityA || !rel.entityB) continue;
                    EntityManager.updateRelation(rel.entityA, rel.entityB, {
                        relationType: rel.type || '',
                        sentiments: { fromAtoB: rel.sentiment || '' },
                        s_id: opts.sourceId
                    }, lore);
                }

                NarrativeTracker.resetState({
                    storylines: [{
                        id: 1,
                        name: 'Rebuilt Storyline',
                        entities: (sanitized.entities || []).map(e => e.name).filter(Boolean),
                        turns: [0],
                        firstTurn: 0,
                        lastTurn: 0,
                        recentEvents: [{ turn: 0, brief: 'Past conversation reanalysis applied.' }],
                        summaries: [{ upToTurn: 0, summary: sanitized.narrative || '', keyPoints: [], ongoingTensions: [], timestamp: Date.now() }],
                        currentContext: sanitized.narrative || '',
                        keyPoints: [],
                        ongoingTensions: []
                    }],
                    turnLog: [],
                    lastSummaryTurn: 0
                });
                StoryAuthor.resetState();
                CharacterStateTracker.resetState();
                WorldStateTracker.resetState();

                HierarchicalWorldManager.loadWorldGraph(lore);
                const profile = HierarchicalWorldManager.getProfile();
                const rootNode = profile?.nodes?.get(profile?.rootId);
                if (rootNode) {
                    rootNode.rules = rootNode.rules || { exists: {}, systems: {}, physics: {}, custom: {} };
                    rootNode.rules.exists = rootNode.rules.exists || {};
                    rootNode.rules.physics = rootNode.rules.physics || {};
                    rootNode.rules.exists.technology = String(sanitized.world?.tech || '').trim();
                    rootNode.rules.physics.special_phenomena = [...(sanitized.world?.rules || [])];
                    rootNode.meta.notes = opts.worldNote;
                    rootNode.meta.s_id = opts.sourceId;
                }

                await HierarchicalWorldManager.saveWorldGraphUnsafe(lore);
                await NarrativeTracker.saveState(lore);
                await StoryAuthor.saveState(lore);
                await Director.saveState(lore);
                await CharacterStateTracker.saveState(lore);
                await WorldStateTracker.saveState(lore);
                await EntityManager.saveToLorebook(char, chat, lore);

                if (chat) chat.localLore = lore;
                else char.lorebook = lore;
                await persistLoreToActiveChat(chat, lore);
            } finally {
                loreLock.writeUnlock();
            }
        };

        const synthesizeStructuredKnowledge = async (rawTexts, taskLabel = 'knowledge-import') => {
            const texts = (Array.isArray(rawTexts) ? rawTexts : [])
                .map(v => String(v || '').trim())
                .filter(Boolean);
            if (texts.length === 0) return null;

            const textChunks = [];
            const chunkSize = 8;
            for (let i = 0; i < texts.length; i += chunkSize) {
                textChunks.push(texts.slice(i, i + chunkSize));
            }

            const chunkPromises = textChunks.map((chunk, i) => {
                const chunkText = chunk.map((text, idx) => `Knowledge ${idx + 1}: ${truncateForLLM(text, IMPORT_KNOWLEDGE_MAX_ITEM_CHARS, ' ...[TRUNCATED]... ')}`).join('\n\n');
                return runMaintenanceLLM(() =>
                    LLMProvider.call(MemoryEngine.CONFIG, ColdStartSummaryPrompt, chunkText, { maxTokens: 1500, profile: 'aux' })
                , `${taskLabel}-chunk-${i + 1}`);
            });
            const chunkResults = await Promise.allSettled(chunkPromises);

            const chunkSummaries = [];
            for (const result of chunkResults) {
                if (result.status === 'fulfilled' && result.value.content) {
                    const parsed = extractJson(result.value.content);
                    if (parsed) chunkSummaries.push(parsed);
                }
            }
            if (chunkSummaries.length === 0) return null;

            let finalData = null;
            for (let attempt = 0; attempt < 2 && !finalData; attempt++) {
                try {
                    const synthesisInput = buildSynthesisInput(chunkSummaries);
                    const synthesisResult = await runMaintenanceLLM(() =>
                        LLMProvider.call(
                            MemoryEngine.CONFIG,
                            FinalSynthesisPrompt,
                            synthesisInput,
                            { maxTokens: 2000, profile: 'aux' }
                        )
                    , `${taskLabel}-synthesis-${attempt + 1}`);
                    if (synthesisResult?.content) finalData = extractJson(synthesisResult.content);
                } catch (e) {
                    if (attempt === 0) console.warn('[LIBRA] Knowledge synthesis retry:', e?.message || e);
                }
            }

            if (!finalData) {
                const merged = {
                    narrative: chunkSummaries.map(c => (c.events || []).join('; ')).filter(Boolean).join(' ') || "Imported knowledge summary applied.",
                    entities: [],
                    relations: [],
                    world: { tech: "unknown", rules: [] }
                };
                const nameSet = new Set();
                for (const chunk of chunkSummaries) {
                    for (const ch of (chunk.characters || [])) {
                        if (ch.name && !nameSet.has(ch.name)) {
                            nameSet.add(ch.name);
                            merged.entities.push({ name: ch.name, appearance: ch.details || "", personality: "", background: "" });
                        }
                    }
                    for (const rel of (chunk.relationships || [])) {
                        if (rel.pair?.length === 2) {
                            merged.relations.push({ entityA: rel.pair[0], entityB: rel.pair[1], type: rel.status || '', sentiment: '' });
                        }
                    }
                    merged.world.rules.push(...(chunk.world_rules || []));
                }
                finalData = merged;
            }
            return finalData;
        };

        const buildAnalyzableMessages = (chat) => {
            const msgs_all = getChatMessages(chat);
            const historyLimit = resolveColdStartHistoryLimit(
                MemoryEngine.CONFIG.coldStartScopePreset,
                MemoryEngine.CONFIG.coldStartHistoryLimit
            );
            const sourceMsgs = historyLimit > 0 ? msgs_all.slice(-historyLimit) : msgs_all;
            return sourceMsgs
                .filter(m => m.id !== MemoryState.ignoredGreetingId)
                .map(m => ({ msg: m, text: getComparableMessageText(m) }))
                .filter(item => {
                    if (!item.text || !item.msg) return false;
                    const isUser = item.msg?.role === 'user' || item.msg?.is_user;
                    if (isUser && Utils.isMetaPromptLike(item.text)) return false;
                    if (!isUser && (Utils.isMetaPromptLike(item.text) || Utils.isTagOnlyToolResponse(item.text))) return false;
                    return !Utils.shouldExcludeMemoryContent(item.text);
                });
        };

        const analyzeConversationMessages = async (msgs, taskLabel = 'cold-start') => {
            if (!Array.isArray(msgs) || msgs.length === 0) return null;
            const chunks = [];
            const chunkSize = 25;
            for (let i = 0; i < msgs.length; i += chunkSize) {
                chunks.push(msgs.slice(i, i + chunkSize));
            }

            LMAI_GUI.toast(`총 ${chunks.length}개 청크 병렬 분석 시작...`);

            const chunkPromises = chunks.map((chunk, i) => {
                const chunkText = buildAnalysisChunkText(chunk);
                return runMaintenanceLLM(() =>
                    LLMProvider.call(MemoryEngine.CONFIG, ColdStartSummaryPrompt, chunkText, { maxTokens: 1500, profile: 'aux' })
                , `${taskLabel}-chunk-${i + 1}`);
            });
            const chunkResults = await Promise.allSettled(chunkPromises);

            const chunkSummaries = [];
            for (const result of chunkResults) {
                if (result.status === 'fulfilled' && result.value.content) {
                    const parsed = extractJson(result.value.content);
                    if (parsed) chunkSummaries.push(parsed);
                }
            }
            if (chunkSummaries.length === 0) throw new Error("분석 결과 생성 실패: LLM이 구성되지 않았거나 응답을 파싱할 수 없습니다.");

            LMAI_GUI.toast("최종 데이터 합성 중...");
            let finalData = null;
            for (let attempt = 0; attempt < 2 && !finalData; attempt++) {
                if (attempt > 0) LMAI_GUI.toast("합성 재시도 중...");
                try {
                    const synthesisInput = buildSynthesisInput(chunkSummaries);
                    const synthesisResult = await runMaintenanceLLM(() =>
                        LLMProvider.call(
                            MemoryEngine.CONFIG,
                            FinalSynthesisPrompt,
                            synthesisInput,
                            { maxTokens: 2000, profile: 'aux' }
                        )
                    , `${taskLabel}-synthesis-${attempt + 1}`);
                    if (synthesisResult.skipped) throw new Error("LLM이 구성되지 않았습니다.");
                    if (synthesisResult.content) finalData = extractJson(synthesisResult.content);
                } catch (synthErr) {
                    if (attempt === 0) console.warn("[LIBRA] Synthesis attempt failed, retrying:", synthErr?.message);
                }
            }

            if (!finalData) {
                console.warn("[LIBRA] Final synthesis failed, using chunk merge fallback");
                const merged = {
                    narrative: chunkSummaries.map(c => (c.events || []).join('; ')).filter(Boolean).join(' ') || "Cold Start: Initial analysis applied.",
                    entities: [],
                    relations: [],
                    world: { tech: "unknown", rules: [] }
                };
                const nameSet = new Set();
                for (const chunk of chunkSummaries) {
                    for (const ch of (chunk.characters || [])) {
                        if (ch.name && !nameSet.has(ch.name)) {
                            nameSet.add(ch.name);
                            merged.entities.push({ name: ch.name, appearance: ch.details || "", personality: "", background: "" });
                        }
                    }
                    for (const rel of (chunk.relationships || [])) {
                        if (rel.pair?.length === 2) {
                            merged.relations.push({ entityA: rel.pair[0], entityB: rel.pair[1], type: rel.status || "", sentiment: "" });
                        }
                    }
                    merged.world.rules.push(...(chunk.world_rules || []));
                }
                finalData = merged;
            }
            return finalData;
        };

        const reanalyzeHistoricalConversation = async () => {
            isProcessing = true;
            try {
                const char = await risuai.getCharacter();
                if (!char) throw new Error("캐릭터 데이터를 불러올 수 없습니다.");
                const chat = char.chats?.[char.chatPage];
                if (!chat) throw new Error("채팅방을 찾을 수 없습니다.");
                const lore = MemoryEngine.getLorebook(char, chat);
                const msgs = buildAnalyzableMessages(chat);
                if (msgs.length === 0) throw new Error("재분석할 대화 내역이 없습니다.");

                const candidateData = await analyzeConversationMessages(msgs, 'cold-reanalysis');
                const currentData = buildCurrentStructuredSnapshot(lore);
                let finalData = candidateData;

                if (LLMProvider.isConfigured(MemoryEngine.CONFIG, 'aux')) {
                    try {
                        const reviewWindows = buildReanalysisReviewWindows(msgs);
                        const reviewedResults = [];
                        for (let i = 0; i < reviewWindows.length; i++) {
                            const reviewInput = [
                                `[원문 대화 발췌 / Source Conversation Excerpt]`,
                                buildConversationExcerpt(reviewWindows[i], REANALYSIS_REVIEW_WINDOW_CHARS),
                                ``,
                                `[현재 구축된 데이터 / Current Structured Data]`,
                                buildCompactStructuredJson(currentData, REVIEW_DATA_MAX_CHARS),
                                ``,
                                `[재분석 후보 데이터 / Reanalyzed Candidate Data]`,
                                buildCompactStructuredJson(candidateData, REVIEW_DATA_MAX_CHARS)
                            ].join('\n');
                            LMAI_GUI.toast(`기존 데이터와 재분석 후보를 대조 중... (${i + 1}/${reviewWindows.length})`);
                            const reviewResult = await runMaintenanceLLM(() =>
                                LLMProvider.call(MemoryEngine.CONFIG, ReanalysisReviewPrompt, reviewInput, { maxTokens: 1400, profile: 'aux' })
                            , `cold-reanalysis-review-${i + 1}`);
                            const reviewed = extractJson(reviewResult?.content || '');
                            if (reviewed) reviewedResults.push(stripReviewNotes(reviewed));
                        }

                        if (LLMProvider.isConfigured(MemoryEngine.CONFIG, 'primary')) {
                            LMAI_GUI.toast("메인 LLM이 최종 데이터를 판정 중...");
                            const arbiterInput = [
                                `[현재 구축된 데이터 / Current Structured Data]`,
                                buildCompactStructuredJson(currentData, REVIEW_DATA_MAX_CHARS),
                                ``,
                                `[재분석 후보 데이터 / Reanalyzed Candidate Data]`,
                                buildCompactStructuredJson(candidateData, REVIEW_DATA_MAX_CHARS),
                                ``,
                                `[부분 Review 결과 / Partial Review Results]`,
                                buildBoundedJsonArray(reviewedResults.map(stripReviewNotes), SYNTHESIS_MAX_INPUT_CHARS, [])
                            ].join('\n');
                            const arbiterResult = await runMaintenanceLLM(() =>
                                LLMProvider.call(MemoryEngine.CONFIG, ReanalysisFinalArbiterPrompt, arbiterInput, { maxTokens: 1800, profile: 'primary' })
                            , 'cold-reanalysis-final-arbiter');
                            const arbited = extractJson(arbiterResult?.content || '');
                            if (arbited) finalData = arbited;
                        } else if (reviewedResults.length === 1) {
                            finalData = reviewedResults[0];
                        } else if (reviewedResults.length > 1) {
                            finalData = reviewedResults[reviewedResults.length - 1];
                        }
                    } catch (e) {
                        console.warn('[LIBRA] Reanalysis review fallback to candidate:', e?.message || e);
                    }
                }

                await replaceStructuredKnowledge(finalData, {
                    sourceId: 'reanalysis',
                    worldNote: 'Rebuilt via Reanalysis'
                });
                LMAI_GUI.toast("♻️ 과거 대화 재분석 및 재구축 완료");
            } catch (e) {
                console.error("[LIBRA] Reanalysis Error:", e);
                LMAI_GUI.toast(`❌ 재분석 실패: ${e.message || e}`);
            } finally {
                isProcessing = false;
            }
        };

        const integrateImportedKnowledge = async (rawTexts, sourceLabel = 'Hypa V3') => {
            if (!MemoryEngine.CONFIG.useLLM) {
                throw new Error("LLM 사용이 꺼져 있어 구조화 분석을 진행할 수 없습니다.");
            }
            const finalData = await synthesizeStructuredKnowledge(rawTexts, `import-${String(sourceLabel || 'knowledge').toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}`);
            if (!finalData) {
                throw new Error("가져온 지식 데이터를 구조화하지 못했습니다.");
            }
            await mergeStructuredKnowledge(finalData, {
                updateNarrative: false,
                worldNote: `Updated via ${sourceLabel} Import`,
                sourceId: 'hypa_v3'
            });
            return finalData;
        };

        const startAutoSummarization = async () => {
            isProcessing = true;
            try {
                const char = await risuai.getCharacter();
                if (!char) throw new Error("캐릭터 데이터를 불러올 수 없습니다.");

                const chat = char.chats?.[char.chatPage];
                const msgs_all = getChatMessages(chat);

                if (!chat || msgs_all.length === 0) {
                    throw new Error("분석할 대화 내역이 없습니다.");
                }
                const msgs = buildAnalyzableMessages(chat);
                
                if (msgs.length === 0) throw new Error("분석할 대화 내역이 없습니다.");
                const finalData = await analyzeConversationMessages(msgs, 'cold-start');

                if (MemoryEngine.CONFIG.debug) console.log("[LIBRA] Cold Start Synthesis Data:", finalData);
                
                // 데이터 반영 실행
                await applyFinalData(finalData);

            } catch (e) {
                console.error("[LIBRA] Cold Start Error:", e);
                LMAI_GUI.toast(`❌ 분석 실패: ${e.message || e}`);
            } finally {
                isProcessing = false;
            }
        };

        return { check, startAutoSummarization, reanalyzeHistoricalConversation, integrateImportedKnowledge };
    })();

    // ══════════════════════════════════════════════════════════════
    // [MANAGER] Transition Manager
    // ══════════════════════════════════════════════════════════════
    const TransitionManager = (() => {
        const BUFFER_KEY = 'LIBRA_TRANSITION_BUFFER';
        const SCENE_CONTEXT_KEY = 'LIBRA_SCENE_CONTEXT';

        const TransitionSummaryPrompt = `당신은 대화 세션 전환을 돕는 맥락 브릿지 전문가입니다.
제공된 마지막 대화 내역을 바탕으로, 새 채팅방에서 대화를 자연스럽게 이어갈 수 있도록 현재 상황을 요약하십시오.

[필수 포함 내용]
1. 현재 장소 및 시간적 배경
2. 주요 등장인물들이 직전에 수행하던 구체적인 행동
3. 현재 대화의 핵심 분위기와 진행 중인 사건의 긴박함 정도

요약은 1~2문단으로 간결하고 명확하게 작성하십시오.`;

        const _generateUUID = () => {
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                return crypto.randomUUID();
            }
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = (Math.random() * 16) | 0;
                return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
            });
        };

        const _libraComments = [
            "lmai_world_graph", "lmai_world_node", "lmai_entity",
            "lmai_relation", "lmai_narrative", "lmai_story_author", "lmai_char_states",
            "lmai_world_states", "lmai_memory"
        ];

        const _buildInheritedLore = (sourceLore, sceneSummary) => {
            const inherited = sourceLore.filter(e => _libraComments.includes(e.comment));

            const memoryEntries = inherited.filter(e => e.comment === 'lmai_memory');
            const structuralEntries = inherited.filter(e => e.comment !== 'lmai_memory');
            const baselineEntries = structuralEntries.map(e => {
                try {
                    const content = JSON.parse(e.content);
                    if (content.meta) content.meta.s_id = 'baseline';
                    else if (e.comment === 'lmai_world_graph') content.meta = { s_id: 'baseline' };
                    return { ...e, content: JSON.stringify(content) };
                } catch { return e; }
            });

            let newLore = [...baselineEntries, ...memoryEntries];

            if (sceneSummary) {
                const meta = { imp: 10, t: 0, ttl: -1, cat: 'system', summary: 'Previous Scene Context', s_id: 'baseline' };
                const sceneEntry = {
                    key: SCENE_CONTEXT_KEY,
                    comment: "lmai_memory",
                    content: `[META:${JSON.stringify(meta)}]\n【직전 상황 요약 / Previous Scene Context】\n${sceneSummary}`,
                    mode: 'normal',
                    insertorder: 10,
                    alwaysActive: false
                };
                newLore.unshift(sceneEntry);
            }

            return newLore;
        };

        const executeTransition = async () => {
            try {
                const sourceChar = await requireLoadedCharacter();
                const sourceChat = sourceChar.chats?.[sourceChar.chatPage];
                const lore = [...MemoryEngine.getLorebook(sourceChar, sourceChat)];
                const sourceChatId = sourceChat?.id || null;

                LMAI_GUI.toast("데이터 패키징 중...");

                // 1. 직전 상황 요약 생성 (Graceful Degradation 적용)
                let sceneSummary = "";
                try {
                    const msgs_all = getChatMessages(sourceChat);
                    const lastMsgs = msgs_all.slice(-10)
                        .filter(m => m.id !== MemoryState.ignoredGreetingId)
                        .map(m => ({ msg: m, text: getComparableMessageText(m) }))
                        .filter(item => item.text);
                    if (lastMsgs.length > 0) {
                        LMAI_GUI.toast("직전 상황 요약 중...");
                        const contextText = lastMsgs
                            .filter(({ msg }) => msg != null)
                            .map(({ msg, text }) => `${(msg?.role === 'user' || msg?.is_user) ? 'User' : 'AI'}: ${text}`)
                            .join('\n\n');
                        const result = await LLMProvider.call(MemoryEngine.CONFIG, TransitionSummaryPrompt, contextText, { maxTokens: 800 });
                        if (result.content) sceneSummary = Utils.stripLLMThinkingTags(result.content).trim();
                    }
                } catch (summaryError) {
                    console.warn("[LIBRA] Transition Summary generation failed, but continuing transition:", summaryError);
                }

                // 2. 새 채팅방에 주입할 로어 구축
                const inheritedLore = _buildInheritedLore(lore, sceneSummary);

                await loreLock.writeLock();
                try {
                    // 3. 새 채팅방 생성 및 데이터 직접 주입
                    LMAI_GUI.toast("새 채팅방 생성 중...");
                    const latestChar = await requireLoadedCharacter();
                    const latestChat = latestChar.chats?.[latestChar.chatPage];
                    const latestSourceChatId = latestChat?.id || null;
                    if (latestSourceChatId !== sourceChatId) {
                        throw new LIBRAError('Active chat changed during transition', 'CHAT_CHANGED');
                    }

                    const nextChar = cloneForMutation(latestChar);
                    nextChar.chats = Array.isArray(nextChar.chats) ? nextChar.chats : [];
                    const chatCount = nextChar.chats.length;
                    const newChat = {
                        message: [],
                        note: '',
                        name: `Session ${chatCount + 1} (LIBRA)`,
                        localLore: inheritedLore,
                        fmIndex: -1,
                        id: _generateUUID()
                    };

                    nextChar.chats.unshift(newChat);
                    nextChar.chatPage = 0;

                    await risuai.pluginStorage.setItem(BUFFER_KEY, JSON.stringify({
                        loreEntries: inheritedLore,
                        sceneSummary,
                        sourceChatId,
                        targetChatId: newChat.id,
                        createdAt: Date.now(),
                        memoryState: {
                            gcCursor: MemoryState.gcCursor || 0,
                            currentTurn: MemoryState.currentTurn || 0
                        }
                    }));

                    await risuai.setCharacter(nextChar);

                    // 4. 세션 추적 갱신
                    MemoryState._activeChatId = newChat.id;
                    MemoryState.currentSessionId = `sess_${newChat.id}_${Date.now()}`;

                    // 5. 엔진 재로드
                    HierarchicalWorldManager.loadWorldGraph(inheritedLore, true);
                    EntityManager.rebuildCache(inheritedLore);
                    NarrativeTracker.loadState(inheritedLore);
                    StoryAuthor.loadState(inheritedLore);
                    Director.loadState(inheritedLore);
                    CharacterStateTracker.loadState(inheritedLore);
                    WorldStateTracker.loadState(inheritedLore);

                    // 6. 상태 복구
                    MemoryState.isSessionRestored = true;
                    await identifyGreeting();
                    await risuai.pluginStorage.removeItem(BUFFER_KEY);
                } finally {
                    loreLock.writeUnlock();
                }

                console.log("[LIBRA] Session transition complete. New chat created with inherited data.");
                LMAI_GUI.toast("✨ 새 세션이 생성되었습니다! 모든 기억이 계승되었습니다.");
                return true;
            } catch (e) {
                console.error("[LIBRA] Execute Transition Error:", e);
                return false;
            }
        };

        const restoreTransition = async () => {
            let buffer;
            try {
                const saved = await risuai.pluginStorage.getItem(BUFFER_KEY);
                if (!saved) return false;
                buffer = typeof saved === 'string' ? JSON.parse(saved) : saved;
            } catch (e) {
                console.error("[LIBRA] Restore Parse Error:", e);
                return false;
            }

            if (!buffer || !buffer.loreEntries) return false;

            await loreLock.writeLock();
            try {
                const char = await risuai.getCharacter();
                const chat = char.chats?.[char.chatPage];
                let currentLore = (chat?.localLore) || char.lorebook || [];
                const currentChatId = chat?.id || null;
                const currentMsgs = getChatMessages(chat);
                const currentManaged = MemoryEngine.getManagedEntries(currentLore);
                let currentMaxTurn = 0;
                for (const entry of currentManaged) {
                    const meta = MemoryEngine.getCachedMeta(entry);
                    if (meta?.t > currentMaxTurn) currentMaxTurn = meta.t;
                }
                const bufferedTurn = Number(buffer?.memoryState?.currentTurn || 0);
                const targetChatId = buffer?.targetChatId || null;
                const sourceChatId = buffer?.sourceChatId || null;
                const targetMismatch = !!targetChatId && !!currentChatId && targetChatId !== currentChatId;
                const likelyProgressed =
                    (Array.isArray(currentMsgs) && currentMsgs.length > 1) ||
                    currentMaxTurn > bufferedTurn;

                if (targetMismatch) {
                    console.warn(`[LIBRA] Skipping stale transition restore: target chat ${targetChatId} != current chat ${currentChatId}`);
                    return false;
                }

                if (likelyProgressed) {
                    console.warn(`[LIBRA] Skipping transition restore because current chat already progressed beyond buffer (chat=${currentChatId}, source=${sourceChatId}, turn ${currentMaxTurn} > ${bufferedTurn} or msgs=${currentMsgs.length})`);
                    return false;
                }

                LMAI_GUI.toast("이전 기억 복구 중...");

                const libraComments = [
                    "lmai_world_graph", "lmai_world_node", "lmai_entity", 
                    "lmai_relation", "lmai_narrative", "lmai_story_author", "lmai_char_states", 
                    "lmai_world_states"
                ];
                
                let updatedLore = currentLore.filter(e => !libraComments.includes(e.comment) && e.key !== SCENE_CONTEXT_KEY);
                
                // 1. 핵심 LIBRA 노드 주입 (lmai_memory는 병합 처리)
                const memoryEntries = buffer.loreEntries.filter(e => e.comment === 'lmai_memory');
                const structuralEntries = buffer.loreEntries.filter(e => e.comment !== 'lmai_memory');
                const baselineEntries = structuralEntries.map(e => {
                    try {
                        const content = JSON.parse(e.content);
                        if (content.meta) content.meta.s_id = 'baseline';
                        else if (e.comment === 'lmai_world_graph') content.meta = { s_id: 'baseline' };
                        return { ...e, content: JSON.stringify(content) };
                    } catch { return e; }
                });
                updatedLore = [...baselineEntries, ...updatedLore];

                // 1b. 이전 세션 lmai_memory 병합 (기존 현재 세션 메모리는 보존)
                if (memoryEntries.length > 0) {
                    const metaPat = /\[META:(\{[^}]+\})\]/;
                    const existingContents = new Set(
                        updatedLore
                            .filter(e => e.comment === 'lmai_memory')
                            .map(e => (e.content || '').replace(metaPat, '').trim())
                            .filter(c => c)
                    );
                    for (const mem of memoryEntries) {
                        const memContent = (mem.content || '').replace(metaPat, '').trim();
                        if (memContent && !existingContents.has(memContent)) {
                            updatedLore.push(mem);
                        }
                    }
                }

                // 2. 직전 상황 요약(Scene Context) 주입
                if (buffer.sceneSummary) {
                    const meta = { imp: 10, t: 0, ttl: -1, cat: 'system', summary: 'Previous Scene Context', s_id: 'baseline' };
                    const sceneEntry = {
                        key: SCENE_CONTEXT_KEY,
                        comment: "lmai_memory",
                        content: `[META:${JSON.stringify(meta)}]\n【직전 상황 요약 / Previous Scene Context】\n${buffer.sceneSummary}`,
                        mode: 'normal',
                        insertorder: 10,
                        alwaysActive: false
                    };
                    updatedLore.unshift(sceneEntry);
                }

                // 3. 상태 복구
                if (buffer.memoryState) {
                    MemoryState.gcCursor = buffer.memoryState.gcCursor || 0;
                    MemoryState.currentTurn = buffer.memoryState.currentTurn || 0;
                }

                // 저장 및 엔진 재로드
                if (chat) chat.localLore = updatedLore;
                else char.lorebook = updatedLore;
                
                await persistLoreToActiveChat(chat, updatedLore, { saveCheckpoint: true });

                // 세션 추적 갱신
                MemoryState._activeChatId = chat?.id || null;
                MemoryState.currentSessionId = `sess_${chat?.id || 'global'}_${Date.now()}`;
                
                HierarchicalWorldManager.loadWorldGraph(updatedLore, true);
                EntityManager.rebuildCache(updatedLore);
                NarrativeTracker.loadState(updatedLore);
                StoryAuthor.loadState(updatedLore);
                Director.loadState(updatedLore);
                CharacterStateTracker.loadState(updatedLore);
                WorldStateTracker.loadState(updatedLore);

                MemoryState.isSessionRestored = true;
                await identifyGreeting();

                LMAI_GUI.toast("✨ 이전 기억과 마지막 맥락이 복구되었습니다!");
                return true;
            } catch (e) {
                console.error("[LIBRA] Restore Transition Error:", e);
                return false;
            } finally {
                await risuai.pluginStorage.removeItem(BUFFER_KEY);
                loreLock.writeUnlock();
            }
        };

        const identifyGreeting = async () => {
            if (!MemoryState.isSessionRestored) return;
            
            try {
                const char = await risuai.getCharacter();
                const chat = char?.chats?.[char.chatPage];
                const msgs_all = getChatMessages(chat);
                
                if (chat && msgs_all.length === 1) {
                    const firstMsg = msgs_all[0];
                    if (firstMsg && firstMsg.role !== 'user' && !firstMsg.is_user) {
                        MemoryState.ignoredGreetingId = firstMsg.id;
                        console.log(`[LIBRA] Initial greeting identified and will be isolated: ${firstMsg.id}`);
                    }
                }
            } catch (e) {
                console.warn("[LIBRA] Failed to identify greeting:", e);
            }
        };

        return { executeTransition, restoreTransition, identifyGreeting };
    })();

    // ══════════════════════════════════════════════════════════════
    // [ENGINE] Sync & Rollback Engine
    // ══════════════════════════════════════════════════════════════
    const SyncEngine = (() => {
        const TRANSIENT_MISSING_GRACE_MS = 15000;

        const getTrackerMeta = (tracked) => {
            if (tracked && typeof tracked === 'object' && !Array.isArray(tracked)) return tracked;
            return { loreKeys: Array.isArray(tracked) ? tracked : [], sourceHash: null };
        };

        const syncMemory = async (char, chat, lore) => {
            const msgs_all = getChatMessages(chat);
            // Fail-safe: chat.msgs가 유효하지 않으면 롤백 건너뜀 (대량 삭제 방지)
            if (!chat || msgs_all.length === 0 || MemoryState.rollbackTracker.size === 0) {
                return false;
            }

            if (isRefreshDeleteBlocked()) {
                if (MemoryEngine.CONFIG.debug) {
                    console.log('[LIBRA] syncMemory deletion skipped during refresh protection window');
                }
                return false;
            }

            const now = Date.now();
            const currentMsgIds = new Set();
            const comparableTextToMsgId = new Map();

            for (const msg of msgs_all) {
                if (!msg?.id) continue;
                currentMsgIds.add(msg.id);

                const roleHint = (msg?.role === 'user' || msg?.is_user) ? 'user' : 'ai';
                const comparableText = Utils.getNarrativeComparableText(Utils.getMessageText(msg), roleHint);
                if (comparableText) {
                    comparableTextToMsgId.set(TokenizerEngine.simpleHash(comparableText), msg.id);
                    MemoryState.transientMissing.delete(msg.id);
                } else if (MemoryEngine.CONFIG.debug) {
                    console.log(`[LIBRA] syncMemory skipped comparable text for msg ${msg.id}`);
                }
            }

            const trackedMsgIds = Array.from(MemoryState.rollbackTracker.keys());
            const deletedMsgIds = [];

            for (const id of trackedMsgIds) {
                const tracked = getTrackerMeta(MemoryState.rollbackTracker.get(id));
                const replacementId = tracked.sourceHash ? comparableTextToMsgId.get(tracked.sourceHash) : null;

                if (replacementId && replacementId !== id) {
                    MemoryState.rollbackTracker.set(replacementId, tracked);
                    MemoryState.rollbackTracker.delete(id);
                    MemoryState.transientMissing.delete(id);
                    if (MemoryEngine.CONFIG.debug) {
                        console.log(`[LIBRA] Message tracker migrated ${id} -> ${replacementId} via sourceHash remap`);
                    }
                    continue;
                }

                if (currentMsgIds.has(id)) {
                    MemoryState.transientMissing.delete(id);
                    continue;
                }

                const transient = MemoryState.transientMissing.get(id);
                if (!transient) {
                    MemoryState.transientMissing.set(id, { since: now, reason: 'missing' });
                    continue;
                }

                if ((now - transient.since) < TRANSIENT_MISSING_GRACE_MS) {
                    continue;
                }

                deletedMsgIds.push(id);
            }

            if (deletedMsgIds.length === 0) return false;

            await loreLock.writeLock();
            try {
                const workingLore = Array.isArray(lore) ? lore.map(entry => safeClone(entry)) : [];
                let changed = false;
                let removedCount = 0;
                const currentSession = MemoryState.currentSessionId;

                for (const m_id of deletedMsgIds) {
                    // 1. 로어북 스캔 및 조건부 삭제
                    for (let i = workingLore.length - 1; i >= 0; i--) {
                        const entry = workingLore[i];
                        try {
                            // lmai_memory: [META:...] 태그로 m_id 확인
                            const metaMatch = entry.content?.match(/\[META:(\{.*?\})\]/);
                            if (metaMatch) {
                                const meta = JSON.parse(metaMatch[1]);
                                // 방어 로직: 현재 세션이 아니거나 baseline인 경우 절대 삭제 안함
                                if (meta.m_id === m_id && meta.s_id === currentSession && meta.s_id !== 'baseline') {
                                    workingLore.splice(i, 1);
                                    changed = true;
                                    removedCount++;
                                }
                                continue;
                            }
                            // lmai_entity / lmai_relation: 최신 메시지면 snapshot 복원, 그 외에는 연결만 분리
                            if (entry.comment === 'lmai_entity' || entry.comment === 'lmai_relation') {
                                const parsed = JSON.parse(entry.content || '{}');
                                const entMeta = parsed.meta || {};
                                const sourceIds = Array.isArray(entMeta.m_ids)
                                    ? entMeta.m_ids.filter(Boolean)
                                    : (entMeta.m_id ? [entMeta.m_id] : []);
                                if (sourceIds.includes(m_id) && entMeta.s_id === currentSession && entMeta.s_id !== 'baseline') {
                                    const isLatestSource = entMeta.m_id === m_id;
                                    if (isLatestSource) {
                                        EntityManager.restoreRollbackSnapshot(parsed, m_id);
                                    } else {
                                        EntityManager.discardRollbackSnapshot(parsed, m_id);
                                    }
                                    entMeta.m_ids = sourceIds.filter(id => id !== m_id);
                                    entMeta.m_id = entMeta.m_ids.length > 0 ? entMeta.m_ids[entMeta.m_ids.length - 1] : null;
                                    parsed.meta = entMeta;
                                    entry.content = JSON.stringify(parsed, null, 2);
                                    changed = true;
                                    removedCount++;
                                }
                            }
                        } catch (e) {
                            if (MemoryEngine.CONFIG?.debug) {
                                console.warn('[LIBRA] SyncEngine entry processing error:', e?.message);
                            }
                            continue;
                        }
                    }

                    // 2. 트래커에서 제거
                    MemoryState.rollbackTracker.delete(m_id);
                    MemoryState.transientMissing.delete(m_id);
                }

                if (changed) {
                    // 캐시 재구축
                    EntityManager.rebuildCache(workingLore);
                    HierarchicalWorldManager.loadWorldGraph(workingLore, true);
                    NarrativeTracker.loadState(workingLore);
                    StoryAuthor.loadState(workingLore);
                    Director.loadState(workingLore);
                    CharacterStateTracker.loadState(workingLore);
                    WorldStateTracker.loadState(workingLore);
                    
                    MemoryEngine.setLorebook(char, chat, workingLore);
                    await persistLoreToActiveChat(chat, workingLore);
                    
                    // Unobtrusive feedback
                    console.log(`[LIBRA] 🔄 Phantom memory synced (cleaned ${removedCount} lore links tied to deleted messages)`);
                }
                return changed;
            } catch (e) {
                console.error("[LIBRA] Sync Error:", e);
                return false;
            } finally {
                loreLock.writeUnlock();
            }
        };

        return { syncMemory };
    })();

    // ══════════════════════════════════════════════════════════════
    // [ENGINE] Missed Turn Recovery
    // ══════════════════════════════════════════════════════════════
    const TurnRecoveryEngine = (() => {
        const POLL_MS = 4000;
        const MAX_RECOVER_PER_PASS = 2;
        const MAX_SCAN_MESSAGES = 60;
        let inFlight = false;
        let timerStarted = false;
        let pollTimerId = null;

        const getProcessedMessageIds = (lore) => {
            const ids = new Set();
            for (const entry of MemoryEngine.getManagedEntries(lore)) {
                const meta = MemoryEngine.getCachedMeta(entry);
                if (meta?.m_id) ids.add(meta.m_id);
            }
            for (const id of MemoryState.rollbackTracker.keys()) ids.add(id);
            if (MemoryState.ignoredGreetingId) ids.add(MemoryState.ignoredGreetingId);
            return ids;
        };

        const findPreviousUserMessage = (msgs, startIndex) => {
            for (let i = startIndex - 1; i >= 0; i--) {
                const msg = msgs[i];
                if (msg && (msg.role === 'user' || msg.is_user)) return msg;
            }
            return null;
        };

        const collectRecoverableTurns = (chat, lore) => {
            const msgs = getChatMessages(chat);
            const processedIds = getProcessedMessageIds(lore);
            const pendingHashes = PendingTurnManager.getPendingComparableHashes(chat);
            const windowed = msgs.slice(-MAX_SCAN_MESSAGES);
            const recoverable = [];
            let lastProcessedNarrativeIdx = -1;

            for (let i = 0; i < windowed.length; i++) {
                const msg = windowed[i];
                if (!msg || msg.role === 'user' || msg.is_user) continue;

                const aiText = Utils.getNarrativeComparableText(Utils.getMessageText(msg), 'ai');
                if (!aiText) continue;
                if (pendingHashes.has(TokenizerEngine.simpleHash(aiText))) continue;

                const previousUser = findPreviousUserMessage(windowed, i);
                const userText = getStrictNarrativeUserText(Utils.getMessageText(previousUser));
                if (Utils.shouldBypassNarrativeSystems(userText, aiText)) continue;

                if (msg.id && processedIds.has(msg.id)) {
                    lastProcessedNarrativeIdx = i;
                }
            }

            for (let i = Math.max(0, lastProcessedNarrativeIdx + 1); i < windowed.length; i++) {
                const msg = windowed[i];
                if (!msg || msg.role === 'user' || msg.is_user) continue;
                if (!msg.id || processedIds.has(msg.id)) continue;

                const aiText = Utils.getNarrativeComparableText(Utils.getMessageText(msg), 'ai');
                if (!aiText) continue;
                if (pendingHashes.has(TokenizerEngine.simpleHash(aiText))) continue;

                const previousUser = findPreviousUserMessage(windowed, i);
                const userText = getStrictNarrativeUserText(Utils.getMessageText(previousUser));
                if (Utils.shouldBypassNarrativeSystems(userText, aiText)) continue;

                recoverable.push({
                    aiMsg: msg,
                    userMsg: userText || '',
                    aiResponse: aiText
                });
            }

            return recoverable.slice(-MAX_RECOVER_PER_PASS);
        };

        const processRecoveredTurns = async (char, chat, lore, turns, reason = 'recovery') => {
            if (!Array.isArray(turns) || turns.length === 0) return 0;
            let recoveredCount = 0;
            const config = MemoryEngine.CONFIG;

            for (const turn of turns) {
                const m_id = turn.aiMsg?.id;
                if (!m_id) continue;

                const currentProcessedIds = getProcessedMessageIds(lore);
                if (currentProcessedIds.has(m_id)) continue;

                MemoryEngine.incrementTurn();
                const currentTurn = MemoryEngine.getCurrentTurn();
                const turnState = await processNarrativeTurnState(char, chat, lore, turn.userMsg, turn.aiResponse, m_id);
                const memoryImportance = config.emotionEnabled
                    ? EmotionEngine.boostImportance(5, turnState.conversationEmotion)
                    : 5;
                const memoryContent = `[사용자] ${turn.userMsg}\n[응답] ${turn.aiResponse}`;

                const newMemory = await MemoryEngine.prepareMemory(
                    { content: memoryContent, importance: memoryImportance },
                    currentTurn, lore, lore, char, chat, m_id
                );

                if (newMemory) {
                    lore.push(newMemory);
                }

                MemoryState.rollbackTracker.set(m_id, {
                    loreKeys: newMemory ? [newMemory.key || TokenizerEngine.getSafeMapKey(newMemory.content)] : [],
                    sourceHash: turn.aiResponse ? TokenizerEngine.simpleHash(turn.aiResponse) : null
                });
                MemoryState.transientMissing.delete(m_id);

                await HierarchicalWorldManager.saveWorldGraph(char, chat, lore);
                await EntityManager.saveToLorebook(char, chat, lore);
                await CharacterStateTracker.saveState(lore);
                await WorldStateTracker.saveState(lore);

                const effectiveLoreForAuthor = MemoryEngine.getEffectiveLorebook(char, chat);
                await Promise.allSettled([
                    ...turnState.entitiesToConsolidate.map(name =>
                        CharacterStateTracker.consolidateIfNeeded(name, currentTurn, config)
                    ),
                    WorldStateTracker.consolidateIfNeeded(currentTurn, config)
                ]);
                try {
                    await StoryAuthor.updatePlanIfNeeded(
                        currentTurn,
                        config,
                        turn.userMsg,
                        turn.aiResponse,
                        turnState.involvedEntities,
                        effectiveLoreForAuthor
                    );
                } catch (e) {
                    console.warn('[LIBRA] Story author recovery update failed:', e?.message || e);
                }
                try {
                    await Director.updateDirective(
                        currentTurn,
                        config,
                        turn.userMsg,
                        turn.aiResponse,
                        turnState.involvedEntities,
                        effectiveLoreForAuthor
                    );
                } catch (e) {
                    console.warn('[LIBRA] Director recovery update failed:', e?.message || e);
                }
                recoveredCount++;
            }

            if (recoveredCount === 0) return 0;

            const narrativeState = NarrativeTracker.getState();
            if (narrativeState && typeof narrativeState === 'object') {
                narrativeState.lastSummaryTurn = 0;
            }
            await Promise.allSettled([
                NarrativeTracker.summarizeIfNeeded(MemoryEngine.getCurrentTurn(), config)
            ]);

            await NarrativeTracker.saveState(lore);
            await StoryAuthor.saveState(lore);
            await Director.saveState(lore);
            MemoryEngine.setLorebook(char, chat, lore);
            await persistLoreToActiveChat(chat, lore, { saveCheckpoint: true });

            if (config.debug) {
                console.log(`[LIBRA] Recovered ${recoveredCount} missed turn(s) via ${reason}`);
            }
            return recoveredCount;
        };

        const recoverIfNeeded = async (reason = 'manual-check') => {
            if (inFlight) return 0;
            if (reason === 'polling' && isRefreshStabilizing()) {
                if (MemoryEngine.CONFIG.debug) {
                    console.log('[LIBRA] polling recovery delayed during refresh stabilization window');
                }
                return 0;
            }
            inFlight = true;
            try {
                const char = await risuai.getCharacter();
                const chat = char?.chats?.[char?.chatPage];
                if (!char || !chat) return 0;
                const lore = [...MemoryEngine.getLorebook(char, chat)];
                if (!MemoryState.isInitialized) await _lazyInit(lore);

                const _chatId = chat?.id || null;
                if (MemoryState._activeChatId !== _chatId) {
                    reloadChatScopedRuntime(lore, _chatId, { resetSessionCaches: true, forceWorldReload: true });
                    MemoryState.currentSessionId = `sess_${_chatId || 'global'}_${Date.now()}`;
                } else {
                    HierarchicalWorldManager.loadWorldGraph(lore);
                    if (EntityManager.getEntityCache().size === 0) {
                        reloadChatScopedRuntime(lore, _chatId, { forceWorldReload: false });
                    }
                }
                if (!MemoryState.currentSessionId) {
                    MemoryState.currentSessionId = `sess_${_chatId || 'global'}_${Date.now()}`;
                }

                const pendingResult = await PendingTurnManager.finalizePending(char, chat, reason);
                if (pendingResult?.status === 'finalized') {
                    return 0;
                }

                const recoverable = collectRecoverableTurns(chat, lore);
                if (recoverable.length === 0) return 0;
                return await processRecoveredTurns(char, chat, lore, recoverable, reason);
            } catch (e) {
                console.warn('[LIBRA] Missed turn recovery failed:', e?.message || e);
                return 0;
            } finally {
                inFlight = false;
            }
        };

        const stopPolling = () => {
            if (pollTimerId != null && typeof clearInterval === 'function') {
                clearInterval(pollTimerId);
            }
            pollTimerId = null;
            timerStarted = false;
            if (typeof globalThis !== 'undefined' && globalThis[LIBRA_TURN_RECOVERY_TIMER_CLEANUP_KEY] === stopPolling) {
                delete globalThis[LIBRA_TURN_RECOVERY_TIMER_CLEANUP_KEY];
            }
        };
        const startPolling = () => {
            if (typeof setInterval === 'undefined') return;
            const existingCleanup = typeof globalThis !== 'undefined' ? globalThis[LIBRA_TURN_RECOVERY_TIMER_CLEANUP_KEY] : null;
            if (typeof existingCleanup === 'function' && existingCleanup !== stopPolling) {
                existingCleanup();
            }
            if (timerStarted && pollTimerId != null) return;
            stopPolling();
            timerStarted = true;
            pollTimerId = setInterval(() => {
                recoverIfNeeded('polling').catch(() => {});
            }, POLL_MS);
            if (typeof globalThis !== 'undefined') {
                globalThis[LIBRA_TURN_RECOVERY_TIMER_CLEANUP_KEY] = stopPolling;
            }
        };

        return { recoverIfNeeded, startPolling, stopPolling };
    })();

    const RefreshCheckpointManager = (() => {
        const KEY = 'LIBRA_REFRESH_CHECKPOINT_V1';
        const isManaged = (entry) => Boolean(entry?.comment && String(entry.comment).startsWith('lmai_'));
        const getSignature = (entry) => [
            entry?.comment || '',
            entry?.key || '',
            TokenizerEngine.simpleHash(entry?.content || '')
        ].join('::');
        const getMaxTurn = (entries) => deriveMaxTurnFromLorebook(entries);

        const saveCheckpoint = async (char, chat, lore) => {
            if (!char || !chat || !Array.isArray(lore)) return false;
            const managed = lore.filter(isManaged);
            if (managed.length === 0) return false;

            const payload = {
                chatId: chat.id || null,
                savedAt: Date.now(),
                maxTurn: getMaxTurn(managed),
                entries: managed
            };

            await risuai.pluginStorage.setItem(KEY, JSON.stringify(payload));
            return true;
        };

        const restoreIfAhead = async (char, chat, lore) => {
            if (!char || !chat || !Array.isArray(lore)) return false;
            let raw;
            try {
                raw = await risuai.pluginStorage.getItem(KEY);
            } catch {
                return false;
            }
            if (!raw) return false;

            let payload;
            try {
                payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
            } catch {
                return false;
            }

            if (!payload?.chatId || payload.chatId !== (chat.id || null) || !Array.isArray(payload.entries)) {
                return false;
            }

            const currentManaged = lore.filter(isManaged);
            const currentMaxTurn = getMaxTurn(currentManaged);
            const checkpointMaxTurn = Number(payload.maxTurn || 0);
            if (checkpointMaxTurn <= currentMaxTurn) return false;

            const nonManaged = lore.filter(entry => !isManaged(entry));
            const mergedManaged = [];
            const seen = new Set();
            for (const entry of payload.entries) {
                const sig = getSignature(entry);
                if (seen.has(sig)) continue;
                seen.add(sig);
                mergedManaged.push(entry);
            }

            const nextLore = [...nonManaged, ...mergedManaged];
            MemoryEngine.setLorebook(char, chat, nextLore);
            await persistLoreToActiveChat(chat, nextLore);
            MemoryEngine.rebuildIndex(nextLore);
            HierarchicalWorldManager.loadWorldGraph(nextLore, true);
            EntityManager.rebuildCache(nextLore);
            NarrativeTracker.loadState(nextLore);
            StoryAuthor.loadState(nextLore);
            Director.loadState(nextLore);
            CharacterStateTracker.loadState(nextLore);
            WorldStateTracker.loadState(nextLore);
            MemoryEngine.setTurn(checkpointMaxTurn);

            console.log(`[LIBRA] Refresh checkpoint restored for chat ${chat.id} (turn ${currentMaxTurn} -> ${checkpointMaxTurn})`);
            return true;
        };

        return { saveCheckpoint, restoreIfAhead };
    })();

    const findLatestAssistantMessage = (chat) => {
        const msgs = getChatMessages(chat);
        for (let i = msgs.length - 1; i >= 0; i--) {
            const msg = msgs[i];
            if (!msg || msg.role === 'user' || msg.is_user) continue;
            return msg;
        }
        return null;
    };

    const scheduleTurnMaintenance = (char, chat, turnState, aiResponse, turnForMaintenance, maintenanceConfig) => {
        const entityNamesForMaintenance = Array.from(turnState.entitiesToConsolidate);
        if (maintenanceConfig.debug) {
            console.log(`[LIBRA] Scheduling background maintenance | turn=${turnForMaintenance} | entities=${entityNamesForMaintenance.length} | bgPending=${BackgroundMaintenanceQueue.pendingCount} | llmPending=${MaintenanceLLMQueue.pendingCount}`);
        }
        BackgroundMaintenanceQueue.enqueue(async () => {
            const startedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            try {
                const effectiveLoreForAuthor = MemoryEngine.getEffectiveLorebook(char, chat);
                await Promise.allSettled([
                    NarrativeTracker.summarizeIfNeeded(turnForMaintenance, maintenanceConfig),
                    ...entityNamesForMaintenance.map(name =>
                        CharacterStateTracker.consolidateIfNeeded(name, turnForMaintenance, maintenanceConfig)
                    ),
                    WorldStateTracker.consolidateIfNeeded(turnForMaintenance, maintenanceConfig)
                ]);
                try {
                    await StoryAuthor.updatePlanIfNeeded(
                        turnForMaintenance,
                        maintenanceConfig,
                        turnState.strictUserMsg,
                        aiResponse,
                        turnState.involvedEntities,
                        effectiveLoreForAuthor
                    );
                } catch (e) {
                    console.warn('[LIBRA] Story author background update failed:', e?.message || e);
                }
                try {
                    await Director.updateDirective(
                        turnForMaintenance,
                        maintenanceConfig,
                        turnState.strictUserMsg,
                        aiResponse,
                        turnState.involvedEntities,
                        effectiveLoreForAuthor
                    );
                } catch (e) {
                    console.warn('[LIBRA] Director background update failed:', e?.message || e);
                }

                await loreLock.writeLock();
                try {
                    const latestChar = await requireLoadedCharacter();
                    const latestChat = latestChar.chats?.[latestChar.chatPage];
                    if (!latestChat) return;
                    const latestLore = [...MemoryEngine.getLorebook(latestChar, latestChat)];

                    HierarchicalWorldManager.saveWorldGraphUnsafe(latestLore);
                    await EntityManager.saveToLorebook(latestChar, latestChat, latestLore);
                    await NarrativeTracker.saveState(latestLore);
                    await StoryAuthor.saveState(latestLore);
                    await Director.saveState(latestLore);
                    await CharacterStateTracker.saveState(latestLore);
                    await WorldStateTracker.saveState(latestLore);

                    MemoryEngine.setLorebook(latestChar, latestChat, latestLore);
                    await persistLoreToActiveChat(latestChat, latestLore, { saveCheckpoint: true });
                } finally {
                    loreLock.writeUnlock();
                }
                if (maintenanceConfig.debug) {
                    const finishedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                    console.log(`[LIBRA] Background maintenance complete | turn=${turnForMaintenance} | duration=${Math.max(0, Math.round(finishedAt - startedAt))}ms | llmPending=${MaintenanceLLMQueue.pendingCount} | llmActive=${MaintenanceLLMQueue.activeCount}`);
                }
            } catch (bgErr) {
                console.error('[LIBRA] Background maintenance error:', bgErr?.message || bgErr);
            }
        }, `afterRequest-turn-${turnForMaintenance}`).catch(e => {
            console.error('[LIBRA] Background maintenance queue error:', e?.message || e);
        });
    };

    const PendingTurnManager = (() => {
        const pruneStale = () => {
            const now = Date.now();
            for (const [key, pending] of MemoryState.pendingTurnCommits.entries()) {
                if (!pending || (now - Number(pending.createdAt || now)) <= PENDING_STALE_MS) continue;
                MemoryState.pendingTurnCommits.delete(key);
            }
        };

        const getPending = (chat) => {
            pruneStale();
            return MemoryState.pendingTurnCommits.get(getChatMemoryScopeKey(chat)) || null;
        };

        const getPendingComparableHashes = (chat) => {
            const pending = getPending(chat);
            if (!pending?.aiHash) return new Set();
            return new Set([pending.aiHash]);
        };

        const registerPending = (chat, payload) => {
            if (!chat || !payload?.aiHash) return null;
            const key = getChatMemoryScopeKey(chat);
            const prev = MemoryState.pendingTurnCommits.get(key);
            const next = {
                ...payload,
                chatId: chat?.id || null,
                createdAt: Date.now(),
                firstSeenAt: Date.now(),
                lastSeenAt: 0,
                stableMatches: prev?.aiHash === payload.aiHash ? Number(prev.stableMatches || 0) : 0,
                observedMessageId: prev?.aiHash === payload.aiHash ? (prev.observedMessageId || null) : null,
                observedHash: prev?.aiHash === payload.aiHash ? (prev.observedHash || null) : null
            };
            MemoryState.pendingTurnCommits.set(key, next);
            enterRefreshRecoveryWindow();
            return next;
        };

        const dropPending = (chat) => {
            MemoryState.pendingTurnCommits.delete(getChatMemoryScopeKey(chat));
        };

        const finalizePending = async (char, chat, reason = 'stabilized') => {
            const pending = getPending(chat);
            if (!char || !chat || !pending) return { status: 'none' };

            const latestAiMsg = findLatestAssistantMessage(chat);
            if (latestAiMsg && pending.initialMessageId && latestAiMsg.id === pending.initialMessageId) {
                return { status: 'waiting', reason: 'message_not_yet_added' };
            }

            const latestComparable = Utils.getNarrativeComparableText(Utils.getMessageText(latestAiMsg), 'ai');
            const latestHash = latestComparable ? TokenizerEngine.simpleHash(latestComparable) : null;

            if (!latestHash) {
                return { status: 'waiting', reason: 'no_latest_hash' };
            }

            const now = Date.now();
            pending.lastSeenAt = now;
            if (pending.observedHash === latestHash) pending.stableMatches = Number(pending.stableMatches || 0) + 1;
            else pending.stableMatches = 1;
            pending.observedHash = latestHash;
            pending.observedMessageId = latestAiMsg?.id || pending.observedMessageId || null;
            pending.aiResponse = latestComparable;
            MemoryState.pendingTurnCommits.set(getChatMemoryScopeKey(chat), pending);

            if ((now - Number(pending.createdAt || now)) < PENDING_FINALIZE_MIN_MS) {
                return { status: 'waiting', reason: 'age_guard' };
            }
            if (Number(pending.stableMatches || 0) < PENDING_FINALIZE_REQUIRED_MATCHES) {
                return { status: 'waiting', reason: 'stability_guard' };
            }

            MemoryEngine.incrementTurn();
            const currentTurn = MemoryEngine.getCurrentTurn();
            const lore = MemoryEngine.getLorebook(char, chat);
            const config = MemoryEngine.CONFIG;
            const m_id = latestAiMsg?.id || pending.observedMessageId || null;
            const allowNarrativeProcessing = pending.allowNarrativeProcessing !== false;
            const allowMemoryCapture = pending.allowMemoryCapture !== false;
            const turnState = allowNarrativeProcessing
                ? await processNarrativeTurnState(char, chat, lore, pending.userMsgForNarrative, pending.aiResponse, m_id, {
                    autoContinue: !!pending.autoContinueTurn
                })
                : {
                    config,
                    conversationEmotion: config.emotionEnabled
                        ? EmotionEngine.analyze([pending.userMsgForNarrative, pending.aiResponse].filter(Boolean).join('\n'))
                        : null,
                    involvedEntities: [],
                    entitiesToConsolidate: [],
                    strictUserMsg: pending.userMsgForNarrative || '',
                    recordedNarrativeTurn: false
                };
            const memoryImportance = config.emotionEnabled
                ? EmotionEngine.boostImportance(5, turnState.conversationEmotion)
                : 5;
            const memoryContent = `[사용자] ${pending.userMsgForMemory || ''}\n[응답] ${pending.aiResponse}`;
            const newMemory = allowMemoryCapture
                ? await MemoryEngine.prepareMemory(
                    { content: memoryContent, importance: memoryImportance },
                    currentTurn, lore, lore, char, chat, m_id
                )
                : null;

            if (newMemory) {
                await loreLock.writeLock();
                try {
                    lore.push(newMemory);
                    MemoryEngine.setLorebook(char, chat, lore);
                    await persistLoreToActiveChat(chat, lore, { saveCheckpoint: true });
                } finally {
                    loreLock.writeUnlock();
                }
            }

            if (m_id) {
                const createdKeys = [];
                if (newMemory) createdKeys.push(newMemory.key || TokenizerEngine.getSafeMapKey(newMemory.content));
                MemoryState.rollbackTracker.set(m_id, {
                    loreKeys: createdKeys,
                    sourceHash: pending.aiHash
                });
                MemoryState.transientMissing.delete(m_id);
            }

            dropPending(chat);
            if (allowNarrativeProcessing) {
                scheduleTurnMaintenance(char, chat, turnState, pending.aiResponse, currentTurn, config);
            }
            if (config.debug) {
                console.log(`[LIBRA] Pending turn finalized via ${reason} | turn=${currentTurn} | chat=${chat?.id || 'global'}`);
            }
            return { status: 'finalized', turn: currentTurn, memoryCreated: Boolean(newMemory) };
        };

        return { getPending, getPendingComparableHashes, registerPending, finalizePending, dropPending };
    })();

    const processNarrativeTurnState = async (char, chat, lore, userMsg, aiResponse, m_id = null, options = {}) => {
        const config = MemoryEngine.CONFIG;
        const strictUserMsg = getStrictNarrativeUserText(userMsg);
        const conversationBaseText = [strictUserMsg, aiResponse].filter(Boolean).join('\n');
        const conversationEmotion = config.emotionEnabled ? EmotionEngine.analyze(conversationBaseText) : null;
        const conversationEmotionNote = config.emotionEnabled ? EmotionEngine.formatSummary(conversationEmotion, 0.35) : '';

        const complexAnalysis = ComplexWorldDetector.analyze(strictUserMsg, aiResponse);

        if (config.debug && complexAnalysis.hasComplexElements) {
            console.log('[LIBRA] Complex indicators:', complexAnalysis.indicators);
            console.log('[LIBRA] Dimensional shifts:', complexAnalysis.dimensionalShifts);
        }

        for (const shift of complexAnalysis.dimensionalShifts) {
            if (!shift.to) continue;
            const profile = HierarchicalWorldManager.getProfile();
            if (!profile?.nodes) continue;
            let targetNode = null;

            for (const [id, node] of profile.nodes) {
                if (node.name.includes(shift.to) || shift.to.includes(node.name)) {
                    targetNode = node;
                    break;
                }
            }

            if (!targetNode) {
                const createResult = HierarchicalWorldManager.createNode({
                    name: shift.to,
                    layer: 'dimension',
                    parent: profile.rootId,
                    source: 'auto_detected'
                });
                if (createResult.success) {
                    targetNode = createResult.node;
                    if (config.debug) console.log('[LIBRA] New dimension created:', shift.to);
                }
            }

            if (targetNode) {
                HierarchicalWorldManager.changeActivePath(targetNode.id, { method: shift.type });
            }
        }

        const profile = HierarchicalWorldManager.getProfile();
        if (complexAnalysis.indicators.multiverse && !profile.global.multiverse) {
            profile.global.multiverse = true;
            profile.global.dimensionTravel = true;
        }
        if (complexAnalysis.indicators.timeTravel) profile.global.timeTravel = true;
        if (complexAnalysis.indicators.metaNarrative) profile.global.metaNarrative = true;

        const storedInfo = EntityAwareProcessor.formatStoredInfo();
        const entityResult = await EntityAwareProcessor.extractFromConversation(
            strictUserMsg, aiResponse, storedInfo, config
        );

        if (entityResult.success) {
            for (const entityData of entityResult.entities || []) {
                if (!entityData.name) continue;
                const consistency = EntityManager.checkConsistency(entityData.name, entityData, lore);
                if (!consistency.consistent && config.debug) {
                    console.warn(`[LIBRA] Entity consistency warning:`, consistency.conflicts);
                }
            }
            await EntityAwareProcessor.applyExtractions(entityResult, lore, config, m_id);
        }

        const involvedEntities = (entityResult.success && entityResult.entities)
            ? entityResult.entities.map(e => e.name).filter(Boolean)
            : [];
        const narrativeUserLabel = strictUserMsg || ((options.autoContinue && aiResponse) ? '[auto-continue]' : '');
        const recordedNarrativeTurn = !!narrativeUserLabel;
        if (recordedNarrativeTurn) {
            await NarrativeTracker.recordTurn(MemoryEngine.getCurrentTurn(), narrativeUserLabel, aiResponse, involvedEntities, config);
        }

        const entitiesToConsolidate = new Set();
        if (entityResult.success) {
            for (const entityData of entityResult.entities || []) {
                if (!entityData.name || !entityData.status) continue;
                const statusForRecord = {
                    ...entityData.status,
                    notes: [entityData.status.notes || '', conversationEmotionNote].filter(Boolean).join(' | ')
                };
                const isCritical = CharacterStateTracker.isCriticalMoment(entityData.name, statusForRecord);
                CharacterStateTracker.recordState(entityData.name, MemoryEngine.getCurrentTurn(), statusForRecord);
                if (isCritical) {
                    CharacterStateTracker.recordCriticalMoment(entityData.name, MemoryEngine.getCurrentTurn(),
                        `Critical change: ${JSON.stringify(statusForRecord)}`);
                }
                entitiesToConsolidate.add(entityData.name);
            }
        }

        const worldProfile = HierarchicalWorldManager.getProfile();
        const currentRules = HierarchicalWorldManager.getCurrentRules();
        const worldSnapshot = {
            activePath: worldProfile?.activePath || [],
            rules: currentRules,
            global: worldProfile?.global || {},
            notes: [
                complexAnalysis.hasComplexElements ? `Complex: ${Object.keys(complexAnalysis.indicators).join(',')}` : '',
                conversationEmotionNote
            ].filter(Boolean).join(' | ')
        };
        const isWorldCritical = WorldStateTracker.isCriticalMoment(worldSnapshot);
        WorldStateTracker.recordState(MemoryEngine.getCurrentTurn(), worldSnapshot);
        if (isWorldCritical) {
            WorldStateTracker.recordCriticalMoment(MemoryEngine.getCurrentTurn(),
                `World path changed: ${(worldSnapshot.activePath || []).join('→')}`);
        }

        return {
            config,
            conversationEmotion,
            entityResult,
            involvedEntities,
            entitiesToConsolidate: Array.from(entitiesToConsolidate),
            strictUserMsg,
            narrativeUserLabel,
            recordedNarrativeTurn
        };
    };

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
            return { size: this.cache.size, hitRate: total > 0 ? +(this.hits / total).toFixed(3) : 0 };
        }
    }

    // ══════════════════════════════════════════════════════════════
    // [API] Providers
    // ══════════════════════════════════════════════════════════════
    class BaseProvider {
        async callLLM(config, systemPrompt, userContent, options) { throw new Error('Not implemented'); }
        async getEmbedding(config, text) { throw new Error('Not implemented'); }
        
        _checkKey(key) {
            if (!key || key.trim() === '') {
                throw new LIBRAError('API Key is missing. Please check your settings.', 'MISSING_KEY');
            }
        }

        _checkUrl(url, kind = 'API URL') {
            if (!url || String(url).trim() === '') {
                throw new LIBRAError(`${kind} is missing. Please check your settings.`, 'MISSING_URL');
            }
        }

        _normalizeUrl(url, suffix) {
            const raw = String(url || '').trim();
            this._checkUrl(raw);
            const normalizedSuffix = String(suffix || '');
            if (!normalizedSuffix) return raw;
            if (raw.includes(normalizedSuffix)) return raw;
            return raw.replace(/\/$/, '') + normalizedSuffix;
        }

        _appendApiKey(url, apiKey) {
            const raw = String(url || '').trim();
            if (!apiKey || raw.includes('key=')) return raw;
            return `${raw}${raw.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey)}`;
        }

        _extractTextParts(content) {
            const parts = Array.isArray(content?.parts) ? content.parts : [];
            return parts
                .filter(part => part && !part.thought)
                .map(part => String(part?.text || '').trim())
                .filter(Boolean)
                .join('\n\n');
        }

        async _fetchRaw(url, requestInit, timeoutMs = 120000) {
            let timeoutId = null;
            const timeoutPromise = new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new LIBRAError('API Request timed out', 'TIMEOUT')), timeoutMs);
            });

            const fetchPromise = (async () => {
                const res = await risuai.nativeFetch(url, requestInit);
                if (!res) {
                    return { ok: false, status: 500, text: async () => 'RisuAI internal fetch error (undefined response)' };
                }
                return res;
            })();
            try {
                return await Promise.race([fetchPromise, timeoutPromise]);
            } finally {
                if (timeoutId != null && typeof clearTimeout === 'function') {
                    clearTimeout(timeoutId);
                }
            }
        }

        async _fetch(url, headers, body, timeoutMs = 120000) {
            if (MemoryEngine.CONFIG?.debug) {
                console.warn("[LIBRA Debug] API Request Payload:", JSON.stringify(body, null, 2));
            }
            const response = await this._fetchRaw(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(body)
            }, timeoutMs);
            if (!response || !response.ok) {
                const status = response?.status || 'Unknown';
                const errorBody = await response?.text().catch(() => 'No error body') || 'No response';
                throw new LIBRAError(`API Error: ${status} - ${errorBody}`, 'API_ERROR');
            }
            return await response.json();
        }
    }

    const COPILOT_MODEL_MAP = {
        'gpt-4.1': 'gpt-4o',
        'gpt-4.1-mini': 'gpt-4o-mini',
        'gpt-4.1-nano': 'gpt-4o-mini'
    };
    const COPILOT_CODE_VERSION = '1.85.0';
    const COPILOT_CHAT_VERSION = '0.22.0';
    const COPILOT_USER_AGENT = `GitHubCopilotChat/${COPILOT_CHAT_VERSION}`;
    const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';
    const COPILOT_TOKEN_CACHE_KEY = 'copilot_tid_token';
    const COPILOT_TOKEN_EXPIRY_KEY = 'copilot_tid_token_expiry';

    class OpenAIProvider extends BaseProvider {
        async _getCopilotBearerToken(rawToken) {
            const sourceToken = String(rawToken || '').replace(/[^\x20-\x7E]/g, '').trim();
            if (!sourceToken) return '';
            try {
                const cachedToken = String(await risuai.pluginStorage.getItem(COPILOT_TOKEN_CACHE_KEY) || '').trim();
                const cachedExpiry = Number(await risuai.pluginStorage.getItem(COPILOT_TOKEN_EXPIRY_KEY) || 0);
                if (cachedToken && Number.isFinite(cachedExpiry) && Date.now() < cachedExpiry - 60000) {
                    return cachedToken;
                }
            } catch {}

            try {
                const response = await this._fetchRaw(COPILOT_TOKEN_URL, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json',
                        'Authorization': `Bearer ${sourceToken}`,
                        'Origin': 'vscode-file://vscode-app',
                        'Editor-Version': `vscode/${COPILOT_CODE_VERSION}`,
                        'Editor-Plugin-Version': `copilot-chat/${COPILOT_CHAT_VERSION}`,
                        'Copilot-Integration-Id': 'vscode-chat',
                        'User-Agent': COPILOT_USER_AGENT
                    }
                }, 12000);
                if (!response.ok) return sourceToken;
                const data = await response.json().catch(() => null);
                const token = String(data?.token || '').trim();
                const expiry = Number(data?.expires_at || 0) * 1000;
                if (!token) return sourceToken;
                try {
                    await risuai.pluginStorage.setItem(COPILOT_TOKEN_CACHE_KEY, token);
                    await risuai.pluginStorage.setItem(COPILOT_TOKEN_EXPIRY_KEY, String(expiry || (Date.now() + 30 * 60 * 1000)));
                } catch {}
                return token;
            } catch {
                return sourceToken;
            }
        }

        async callLLM(config, systemPrompt, userContent, options) {
            this._checkKey(config.llm.key);
            const provider = (config.llm.provider || 'openai').toLowerCase();
            const endpointSuffix = provider === 'copilot' ? '/chat/completions' : '/v1/chat/completions';
            const url = this._normalizeUrl(config.llm.url, endpointSuffix);
            const authToken = provider === 'copilot'
                ? await this._getCopilotBearerToken(config.llm.key)
                : config.llm.key;
            const headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            };
            if (provider === 'openrouter') {
                headers['HTTP-Referer'] = 'https://risuai.xyz';
                headers['X-Title'] = 'Librarian System';
            } else if (provider === 'copilot') {
                headers['Editor-Version'] = `vscode/${COPILOT_CODE_VERSION}`;
                headers['Editor-version'] = `vscode/${COPILOT_CODE_VERSION}`;
                headers['Editor-Plugin-Version'] = `copilot-chat/${COPILOT_CHAT_VERSION}`;
                headers['Editor-plugin-version'] = `copilot-chat/${COPILOT_CHAT_VERSION}`;
                headers['Copilot-Integration-Id'] = 'vscode-chat';
                headers['User-Agent'] = COPILOT_USER_AGENT;
                headers['X-Github-Api-Version'] = '2025-10-01';
                headers['X-Initiator'] = 'user';
            }

            let modelName = config.llm.model;
            if (provider === 'copilot' && COPILOT_MODEL_MAP[modelName]) {
                console.warn(`[LIBRA] Copilot: model "${modelName}" mapped to "${COPILOT_MODEL_MAP[modelName]}"`);
                modelName = COPILOT_MODEL_MAP[modelName];
            }

            const body = {
                model: modelName,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userContent }
                ],
                temperature: config.llm.temp || 0.3,
                max_tokens: options.maxTokens || 1000
            };
            if (config.llm.reasoningEffort && config.llm.reasoningEffort !== 'none') {
                body.reasoning_effort = config.llm.reasoningEffort;
                body.max_completion_tokens = options.maxTokens || 1000;
                delete body.max_tokens;
            }

            const data = await this._fetch(url, headers, body, config.llm.timeout);
            return { content: data.choices?.[0]?.message?.content || '', usage: data.usage || {} };
        }

        async getEmbedding(config, text) {
            this._checkKey(config.embed.key);
            const url = this._normalizeUrl(config.embed.url, '/v1/embeddings');
            const headers = { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.embed.key}`
            };
            const body = { input: [text], model: config.embed.model };
            const data = await this._fetch(url, headers, body, config.embed.timeout);
            return data?.data?.[0]?.embedding;
        }
    }

    class AnthropicProvider extends BaseProvider {
        async callLLM(config, systemPrompt, userContent, options) {
            this._checkKey(config.llm.key);
            let url = config.llm.url;
            if (!url.includes('/v1/')) url = url.replace(/\/$/, '') + '/v1/messages';
            const headers = {
                'Content-Type': 'application/json',
                'x-api-key': config.llm.key,
                'anthropic-version': '2023-06-01'
            };
            const body = {
                model: config.llm.model,
                system: systemPrompt,
                messages: [{ role: 'user', content: userContent }],
                max_tokens: options.maxTokens || 1000,
                temperature: config.llm.temp || 0.3
            };
            if ((config.llm.reasoningBudgetTokens || 0) >= 1024) {
                body.thinking = {
                    type: 'enabled',
                    budget_tokens: Math.max(1024, parseInt(config.llm.reasoningBudgetTokens, 10) || 1024)
                };
            }
            const data = await this._fetch(url, headers, body, config.llm.timeout);
            const content = Array.isArray(data.content)
                ? data.content
                    .filter(block => block && (block.type === 'text' || typeof block.text === 'string'))
                    .map(block => String(block.text || '').trim())
                    .filter(Boolean)
                    .join('\n\n')
                : '';
            return { content, usage: data.usage || {} };
        }
    }

    class GeminiProvider extends BaseProvider {
        async callLLM(config, systemPrompt, userContent, options) {
            this._checkKey(config.llm.key);
            const baseUrl = String(config.llm.url || '').trim().replace(/\/$/, '');
            this._checkUrl(baseUrl);
            const modelPath = `/models/${config.llm.model}:generateContent`;
            const url = this._appendApiKey(baseUrl.includes(':generateContent') ? baseUrl : `${baseUrl}${modelPath}`, config.llm.key);
            const body = {
                contents: [{ role: "user", parts: [{ text: userContent }] }],
                generationConfig: {
                    temperature: config.llm.temp || 0.3,
                    maxOutputTokens: options.maxTokens || 1000
                }
            };
            if (systemPrompt) {
                body.systemInstruction = { parts: [{ text: systemPrompt }] };
            }
            if ((config.llm.reasoningBudgetTokens || 0) > 0) {
                body.generationConfig.thinkingConfig = {
                    thinkingBudget: Math.max(0, parseInt(config.llm.reasoningBudgetTokens, 10) || 0)
                };
            }
            const data = await this._fetch(url, { 'Content-Type': 'application/json', 'x-goog-api-key': config.llm.key }, body, config.llm.timeout);
            return { content: this._extractTextParts(data.candidates?.[0]?.content) || '', usage: data.usageMetadata || data.usage || {} };
        }

        async getEmbedding(config, text) {
            this._checkKey(config.embed.key);
            const baseUrl = String(config.embed.url || '').trim().replace(/\/$/, '');
            this._checkUrl(baseUrl, 'Embedding API URL');
            const modelPath = `/models/${config.embed.model}:embedContent`;
            const url = this._appendApiKey(baseUrl.includes(':embedContent') ? baseUrl : `${baseUrl}${modelPath}`, config.embed.key);
            const body = {
                model: `models/${config.embed.model}`,
                content: { parts: [{ text: text }] }
            };
            const data = await this._fetch(url, { 'Content-Type': 'application/json', 'x-goog-api-key': config.embed.key }, body, config.embed.timeout);
            return data?.embedding?.values;
        }
    }

    class VertexAIProvider extends BaseProvider {
        static _tokenCache = new Map();

        static _str2ab(privateKey) {
            const binaryString = atob(String(privateKey || '').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\\n|\n/g, ''));
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
            return bytes.buffer;
        }

        static _base64url(source) {
            let binary = '';
            for (let i = 0; i < source.length; i++) {
                binary += String.fromCharCode(source[i]);
            }
            return btoa(binary)
                .replace(/=+$/, '')
                .replace(/\+/g, '-')
                .replace(/\//g, '_');
        }

        static async _generateAccessToken(clientEmail, privateKey) {
            const now = Math.floor(Date.now() / 1000);
            const header = { alg: 'RS256', typ: 'JWT' };
            const claimSet = {
                iss: clientEmail,
                scope: 'https://www.googleapis.com/auth/cloud-platform',
                aud: 'https://oauth2.googleapis.com/token',
                exp: now + 3600,
                iat: now
            };
            const encodedHeader = VertexAIProvider._base64url(new TextEncoder().encode(JSON.stringify(header)));
            const encodedClaimSet = VertexAIProvider._base64url(new TextEncoder().encode(JSON.stringify(claimSet)));
            const key = await crypto.subtle.importKey(
                'pkcs8',
                VertexAIProvider._str2ab(privateKey),
                { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } },
                false,
                ['sign']
            );
            const signature = await crypto.subtle.sign(
                'RSASSA-PKCS1-v1_5',
                key,
                new TextEncoder().encode(`${encodedHeader}.${encodedClaimSet}`)
            );
            const jwt = `${encodedHeader}.${encodedClaimSet}.${VertexAIProvider._base64url(new Uint8Array(signature))}`;
            const response = await risuai.nativeFetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
            });
            if (!response?.ok) {
                const errText = await response?.text?.().catch(() => String(response?.status || 'Unknown')) || 'No response';
                throw new Error(`Failed to get Vertex AI access token: ${errText}`);
            }
            const data = await response.json();
            if (!data?.access_token) throw new Error('No access token in Vertex AI token response');
            return data.access_token;
        }

        static async _getAccessToken(rawKey) {
            const cacheKey = String(rawKey || '').trim();
            const cached = VertexAIProvider._tokenCache.get(cacheKey);
            if (cached?.token && Date.now() < cached.expiry) return cached.token;
            let clientEmail = '';
            let privateKey = '';
            try {
                const credentials = JSON.parse(cacheKey);
                clientEmail = credentials.client_email;
                privateKey = credentials.private_key;
            } catch {
                throw new Error('Vertex AI Key must be a JSON service account credential. e.g. {"client_email":"...","private_key":"..."}');
            }
            if (!clientEmail || !privateKey) {
                throw new Error('Vertex AI credentials missing client_email or private_key');
            }
            const token = await VertexAIProvider._generateAccessToken(clientEmail, privateKey);
            VertexAIProvider._tokenCache.set(cacheKey, { token, expiry: Date.now() + 3500 * 1000 });
            return token;
        }

        async callLLM(config, systemPrompt, userContent, options) {
            this._checkKey(config.llm.key);
            const baseUrl = String(config.llm.url || '').trim().replace(/\/$/, '');
            this._checkUrl(baseUrl);
            const model = String(config.llm.model || '').trim();
            const accessToken = await VertexAIProvider._getAccessToken(config.llm.key);
            const isThinkingModel = /gemini-(3|2\.5)/i.test(model);
            const requestedTokens = options.maxTokens || 1000;
            const maxOutputTokens = isThinkingModel ? Math.max(requestedTokens, 8192) : requestedTokens;
            const body = {
                contents: [{ role: "user", parts: [{ text: userContent }] }],
                generationConfig: { temperature: config.llm.temp || 0.3, maxOutputTokens: maxOutputTokens }
            };
            if (systemPrompt) {
                body.systemInstruction = { parts: [{ text: systemPrompt }] };
            }
            if (isThinkingModel) {
                body.generationConfig.thinkingConfig = { includeThoughts: false };
                if ((config.llm.reasoningBudgetTokens || 0) > 0) {
                    body.generationConfig.thinkingConfig.thinkingBudget = Math.max(0, parseInt(config.llm.reasoningBudgetTokens, 10) || 0);
                }
            } else if ((config.llm.reasoningBudgetTokens || 0) > 0) {
                body.generationConfig.thinkingConfig = {
                    thinkingBudget: Math.max(0, parseInt(config.llm.reasoningBudgetTokens, 10) || 0)
                };
            }
            const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` };
            const url = baseUrl.includes(':generateContent') ? baseUrl : `${baseUrl}/${model}:generateContent`;
            const data = await this._fetch(url, headers, body, config.llm.timeout);
            return { content: this._extractTextParts(data.candidates?.[0]?.content) || '', usage: data.usageMetadata || data.usage || {} };
        }

        async getEmbedding(config, text) {
            this._checkKey(config.embed.key);
            this._checkUrl(config.embed.url, 'Embedding API URL');
            const accessToken = await VertexAIProvider._getAccessToken(config.embed.key);
            const body = {
                instances: [{ content: text }],
                parameters: { autoTruncate: true }
            };
            const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` };
            const data = await this._fetch(config.embed.url, headers, body, config.embed.timeout);
            return data?.predictions?.[0]?.embeddings?.values
                || data?.embedding?.values
                || data?.embeddings?.[0]?.values;
        }
    }

    const AutoProvider = (() => {
        const providers = {
            openai: new OpenAIProvider(),
            anthropic: new AnthropicProvider(),
            claude: new AnthropicProvider(),
            gemini: new GeminiProvider(),
            vertex: new VertexAIProvider(),
            openrouter: new OpenAIProvider(),
            copilot: new OpenAIProvider(),
            voyageai: new OpenAIProvider(),
            custom: new OpenAIProvider()
        };

        return {
            get: (name) => providers[(name || 'openai').toLowerCase()] || providers.openai
        };
    })();

    const MEMORY_PRESETS = {
        general: { maxLimit: 120, threshold: 6, simThreshold: 0.35, gcBatchSize: 4 },
        sim_small: { maxLimit: 220, threshold: 5, simThreshold: 0.26, gcBatchSize: 6 },
        sim_medium: { maxLimit: 360, threshold: 4, simThreshold: 0.20, gcBatchSize: 8 },
        sim_large: { maxLimit: 560, threshold: 3, simThreshold: 0.15, gcBatchSize: 12 }
    };
    const WEIGHT_MODE_PRESETS = {
        auto: { similarity: 0.5, importance: 0.3, recency: 0.2 },
        romance: { similarity: 0.5, importance: 0.3, recency: 0.2 },
        action: { similarity: 0.4, importance: 0.2, recency: 0.4 },
        mystery: { similarity: 0.4, importance: 0.5, recency: 0.1 },
        daily: { similarity: 0.3, importance: 0.3, recency: 0.4 }
    };

    const normalizeWeights = (weights, fallback = WEIGHT_MODE_PRESETS.auto) => {
        const raw = {
            similarity: Number(weights?.similarity ?? fallback.similarity),
            importance: Number(weights?.importance ?? fallback.importance),
            recency: Number(weights?.recency ?? fallback.recency)
        };
        let sum = raw.similarity + raw.importance + raw.recency;
        if (!(sum > 0)) return { ...fallback };
        if (Math.abs(sum - 1) > 0.01) {
            raw.similarity /= sum;
            raw.importance /= sum;
            raw.recency /= sum;
        }
        return raw;
    };

    const resolveWeightsForMode = (mode, customWeights) => {
        const normalizedMode = String(mode || 'auto').toLowerCase();
        if (normalizedMode === 'custom') return normalizeWeights(customWeights, WEIGHT_MODE_PRESETS.auto);
        if (WEIGHT_MODE_PRESETS[normalizedMode]) return { ...WEIGHT_MODE_PRESETS[normalizedMode] };
        return { ...WEIGHT_MODE_PRESETS.auto };
    };

    const inferMemoryPreset = (cfg) => {
        const maxLimit = Number(cfg?.maxLimit);
        const threshold = Number(cfg?.threshold);
        const simThreshold = Number(cfg?.simThreshold);
        const gcBatchSize = Number(cfg?.gcBatchSize);
        for (const [key, preset] of Object.entries(MEMORY_PRESETS)) {
            if (
                maxLimit === preset.maxLimit &&
                threshold === preset.threshold &&
                Math.abs(simThreshold - preset.simThreshold) < 0.0001 &&
                gcBatchSize === preset.gcBatchSize
            ) {
                return key;
            }
        }
        return 'custom';
    };

    const inferColdStartScopePreset = (limit) => {
        const normalizedLimit = Math.max(0, Number(limit) || 0);
        for (const [key, value] of Object.entries(COLD_START_SCOPE_PRESETS)) {
            if (normalizedLimit === value) return key;
        }
        return normalizedLimit === 0 ? 'all' : (normalizedLimit <= 100 ? 'partial_100' : 'partial_300');
    };

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
            const cjkCount = (text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f\uac00-\ud7af]/g) || []).length;
            const nonCjk = text.length - cjkCount;
            const ratio = type === 'gpt4' ? 0.45 : 0.55;
            return Math.ceil(nonCjk * ratio + cjkCount * 1.8) + (text.match(/\s/g) || []).length;
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

        const run = () => {
            while (q.length > 0 && active < MAX_CONCURRENT) {
                active++;
                const { task, resolve, reject } = q.shift();
                task().then(resolve, reject).finally(() => {
                    active--;
                    run();
                });
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
    // [ENGINE] Emotion Analyzer
    // ══════════════════════════════════════════════════════════════
    const EmotionEngine = (() => {
        const NEGATION_WORDS_KO = ['않', '안 ', '안하', '안 해', '못', '없', '아니', '별로', '전혀', '절대'];
        const NEGATION_WORDS_EN = ['not', 'no', 'never', 'neither', 'hardly', 'barely', 'cannot', "can't", "don't", "doesn't", "didn't", "won't", "isn't", "aren't"];
        const NEGATION_WORDS_JA = ['ない', 'じゃない', 'ではない', 'ません', 'ぬ', 'ず', 'なかった', '嫌いじゃない'];
        const NEGATION_WINDOW = 10;
        const DOMINANT_PRIORITY = ['affection', 'joy', 'sadness', 'fear', 'surprise', 'anger', 'disgust'];

        const hasNegationNearby = (text, matchIndex) => {
            const start = Math.max(0, matchIndex - NEGATION_WINDOW);
            const end = Math.min(text.length, matchIndex + NEGATION_WINDOW);
            const context = text.slice(start, end);
            if (NEGATION_WORDS_KO.some(neg => context.includes(neg))) return true;
            if (NEGATION_WORDS_JA.some(neg => context.includes(neg))) return true;
            return NEGATION_WORDS_EN.some((neg) => {
                const escaped = neg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                return new RegExp(`\\b${escaped}\\b`, 'i').test(context);
            });
        };

        const analyze = (text) => {
            const lowerText = (text || "").toLowerCase();
            let score = 0;
            const emotions = { affection: 0, joy: 0, sadness: 0, anger: 0, fear: 0, surprise: 0, disgust: 0 };

            const keywords = {
                affection: ['애틋', '애절', '다정', '다정하', '따뜻', '포근', '소중', '아끼', '그리워', '보고 싶', '보고싶', '안아', '껴안', '손잡', '입맞', '키스', '사랑', '좋아하', '설레', '두근', '떨리', '애정', '위로', '보듬', 'tender', 'affection', 'affectionate', 'longing', 'yearning', 'cherish', 'gentle', 'care for', 'caring', 'miss you', 'hold hands', 'hug', 'embrace', 'love', 'fond', '切な', '愛し', '恋し', '会いた', '抱きし', '手を握', '優し', '大切', 'ぬくも', '恋'],
                joy: ['기쁘', '행복', '좋아', '웃', '미소', '즐거', 'happy', 'joy', 'glad', 'smile', 'laugh', 'delighted', '嬉し', '幸せ', '好き', '笑', '楽しい', '喜び'],
                sadness: ['슬프', '우울', '눈물', '울', 'sad', 'depressed', 'tears', 'cry', 'miss', '悲し', 'つら', '辛い', '涙', '泣', '寂し'],
                anger: ['화나', '분노', '짜증', '열받', 'angry', 'furious', 'rage', 'annoyed', 'irritated', '怒', '腹立', '苛立', 'むかつ', 'イライラ'],
                fear: ['무서', '두려', '공포', '불안', 'scared', 'afraid', 'fear', 'anxious', 'terrified', '怖', '恐', '不安', '怯え', '震え'],
                surprise: ['놀라', '충격', '깜짝', 'surprised', 'shocked', 'astonished', 'startled', '驚', 'びっくり', '仰天', 'ショック'],
                disgust: ['역겨', '혐오', '싫어', 'disgusted', 'hate', 'loathe', 'revolted', '嫌', '気持ち悪', 'うんざり', '吐き気', '最悪']
            };

            const keywordWeights = {
                affection: 1.2,
                joy: 1.0,
                sadness: 1.0,
                anger: 0.9,
                fear: 1.0,
                surprise: 0.9,
                disgust: 1.0
            };

            for (const [emotion, words] of Object.entries(keywords)) {
                for (const word of words) {
                    let idx = lowerText.indexOf(word);
                    while (idx !== -1) {
                        if (!hasNegationNearby(lowerText, idx)) {
                            emotions[emotion] += keywordWeights[emotion] || 1;
                            score += keywordWeights[emotion] || 1;
                        }
                        idx = lowerText.indexOf(word, idx + 1);
                    }
                }
            }

            // 애틋함/그리움이 강한 문맥에서는 분노보다 관계 감정을 우선 반영
            if (emotions.affection > 0) {
                if (emotions.anger > 0 && emotions.affection >= emotions.anger) {
                    emotions.anger = Math.max(0, emotions.anger - (emotions.affection * 0.75));
                }
                emotions.joy += emotions.affection * 0.35;
                emotions.sadness += emotions.affection * 0.25;
            }

            const dominant = Object.entries(emotions)
                .filter(([, s]) => s > 0)
                .sort((a, b) => {
                    if (b[1] !== a[1]) return b[1] - a[1];
                    return DOMINANT_PRIORITY.indexOf(a[0]) - DOMINANT_PRIORITY.indexOf(b[0]);
                })[0];
            return {
                scores: emotions,
                dominant: dominant ? dominant[0] : 'neutral',
                intensity: Math.min(1, score / 5)
            };
        };

        const formatSummary = (result, threshold = 0.35) => {
            if (!result || result.dominant === 'neutral' || (result.intensity || 0) < threshold) return '';
            return `Emotion: ${result.dominant} (${(result.intensity || 0).toFixed(2)})`;
        };

        const boostImportance = (baseImportance, result) => {
            const base = Math.max(1, Math.min(10, parseInt(baseImportance, 10) || 5));
            if (!result || result.dominant === 'neutral') return base;
            let bonus = 0;
            if ((result.intensity || 0) >= 0.35) bonus += 1;
            if ((result.intensity || 0) >= 0.65) bonus += 1;
            if (['fear', 'anger', 'surprise', 'sadness', 'affection'].includes(result.dominant)) bonus += 1;
            return Math.max(1, Math.min(10, base + bonus));
        };

        return { analyze, formatSummary, boostImportance, NEGATION_WORDS_KO, NEGATION_WORDS_EN, NEGATION_WORDS_JA };
    })();

    // ══════════════════════════════════════════════════════════════
    // [API] LLM Provider
    // ══════════════════════════════════════════════════════════════
    const getLLMProfileConfig = (config, profile = 'primary') => {
        const baseConfig = config || {};
        const primary = baseConfig.llm || {};
        const aux = (baseConfig.auxLlm && baseConfig.auxLlm.enabled) ? baseConfig.auxLlm : {};
        const wantsAux = String(profile || 'primary').toLowerCase() === 'aux';
        const hasAux = !!String(aux.key || '').trim();
        const selected = wantsAux && hasAux
            ? {
                ...primary,
                ...aux,
                provider: aux.provider || primary.provider,
                url: aux.url || primary.url,
                key: aux.key || primary.key,
                model: aux.model || primary.model
            }
            : primary;
        return {
            config: { ...baseConfig, llm: { ...selected } },
            profile: wantsAux && hasAux ? 'aux' : 'primary'
        };
    };
    const isLLMProfileConfigured = (config, profile = 'primary') => {
        if (!config?.useLLM) return false;
        const resolved = getLLMProfileConfig(config, profile);
        return !!String(resolved?.config?.llm?.key || '').trim();
    };
    const LLMProvider = (() => {
        const call = async (config, systemPrompt, userContent, options = {}) => {
            const resolved = getLLMProfileConfig(config, options.profile || 'primary');
            const activeConfig = resolved.config;
            if (!activeConfig.useLLM || !activeConfig.llm?.key) {
                return { content: null, skipped: true, reason: 'LLM not configured' };
            }

            try {
                const providerName = activeConfig.llm.provider || 'openai';
                const provider = AutoProvider.get(providerName);
                const debugLabel = options.debugLabel || options.label || `${resolved.profile}-generic`;
                const startAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                if (activeConfig.debug) {
                    console.log(
                        `[LIBRA][LLM] start | label=${debugLabel} | profile=${resolved.profile} | provider=${providerName} | model=${activeConfig.llm.model || ''} | url=${activeConfig.llm.url || ''} | systemChars=${String(systemPrompt || '').length} | userChars=${String(userContent || '').length}`
                    );
                }
                const result = await provider.callLLM(activeConfig, systemPrompt, userContent, options);
                if (activeConfig.debug) {
                    const endAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                    console.log(
                        `[LIBRA][LLM] success | label=${debugLabel} | profile=${resolved.profile} | provider=${providerName} | duration=${Math.max(0, Math.round(endAt - startAt))}ms | contentChars=${String(result?.content || '').length}`
                    );
                }
                return result;
            } catch (e) {
                if (activeConfig.debug) {
                    console.warn(
                        `[LIBRA][LLM] fail | profile=${resolved.profile} | provider=${activeConfig.llm?.provider || 'openai'} | model=${activeConfig.llm?.model || ''} | url=${activeConfig.llm?.url || ''} | error=${e?.message || e}`
                    );
                }
                console.error('[LIBRA] LLM Provider Error:', e?.message || e);
                throw e;
            }
        };

        return { call, isConfigured: isLLMProfileConfigured };
    })();

    // ══════════════════════════════════════════════════════════════
    // [ENGINE] World Templates
    // ══════════════════════════════════════════════════════════════
    const WORLD_TEMPLATES = {
        modern_reality: {
            name: '현대 현실',
            description: '우리가 사는 현실 세계와 유사',
            rules: {
                exists: { magic: false, ki: false, technology: 'modern', supernatural: false, mythical_creatures: [], non_human_races: [] },
                systems: { leveling: false, skills: false, stats: false, classes: false, guilds: false, factions: false }
            }
        },
        fantasy: {
            name: '판타지',
            description: '마법과 신화적 존재가 존재하는 세계',
            rules: {
                exists: { magic: true, ki: false, technology: 'medieval', supernatural: true, mythical_creatures: ['dragon', 'fairy', 'demon'], non_human_races: ['elf', 'dwarf', 'orc'] },
                systems: { leveling: false, skills: false, stats: false, classes: false, guilds: true, factions: true }
            }
        },
        wuxia: {
            name: '무협',
            description: '기와 무공이 존재하는 무림 세계',
            rules: {
                exists: { magic: false, ki: true, technology: 'medieval', supernatural: true, mythical_creatures: [], non_human_races: [] },
                systems: { leveling: false, skills: true, stats: false, classes: false, guilds: true, factions: true }
            }
        },
        game_isekai: {
            name: '게임 이세계',
            description: '레벨, 스킬, 스탯 시스템이 존재',
            rules: {
                exists: { magic: true, ki: false, technology: 'medieval', supernatural: true, mythical_creatures: ['dragon', 'demon'], non_human_races: ['elf', 'dwarf', 'beastkin'] },
                systems: { leveling: true, skills: true, stats: true, classes: true, guilds: true, factions: true }
            }
        },
        modern_fantasy: {
            name: '현대 판타지',
            description: '현대 배경에 초능력/마법이 공존',
            rules: {
                exists: { magic: true, ki: false, technology: 'modern', supernatural: true, mythical_creatures: [], non_human_races: [] },
                systems: { leveling: false, skills: false, stats: false, classes: false, guilds: false, factions: true }
            }
        },
        sf: {
            name: 'SF',
            description: '고도로 발달한 과학 기술의 세계',
            rules: {
                exists: { magic: false, ki: false, technology: 'futuristic', supernatural: false, mythical_creatures: [], non_human_races: ['android', 'alien'] },
                systems: { leveling: false, skills: false, stats: false, classes: false, guilds: false, factions: true }
            }
        },
        cyberpunk: {
            name: '사이버펑크',
            description: '첨단 기술과 디스토피아가 공존',
            rules: {
                exists: { magic: false, ki: false, technology: 'futuristic', supernatural: false, mythical_creatures: [], non_human_races: ['cyborg', 'android'] },
                systems: { leveling: false, skills: true, stats: true, classes: false, guilds: false, factions: true }
            }
        },
        post_apocalyptic: {
            name: '포스트 아포칼립스',
            description: '재앙 이후의 황폐한 세계',
            rules: {
                exists: { magic: false, ki: false, technology: 'modern', supernatural: true, mythical_creatures: [], non_human_races: ['mutant'] },
                systems: { leveling: false, skills: true, stats: false, classes: false, guilds: false, factions: true }
            }
        }
    };

    // ══════════════════════════════════════════════════════════════
    // [MANAGER] Hierarchical World Manager
    // ══════════════════════════════════════════════════════════════
    const HierarchicalWorldManager = (() => {
        let profile = null;
        const WORLD_GRAPH_COMMENT = "lmai_world_graph";
        const WORLD_NODE_COMMENT = "lmai_world_node";

        const createDefaultProfile = () => ({
            version: '6.0',
            rootId: null,
            global: { multiverse: false, dimensionTravel: false, timeTravel: false, metaNarrative: false },
            nodes: new Map(),
            activePath: [],
            interference: { level: 0, recentEvents: [] },
            meta: { created: Date.now(), updated: 0, complexity: 1 }
        });

        const createDefaultRootNode = () => ({
            id: 'world_main',
            name: '주요 세계',
            layer: 'dimension',
            parent: null,
            children: [],
            isActive: true,
            isPrimary: true,
            accessCondition: null,
            rules: {
                exists: { magic: false, ki: false, technology: 'modern', supernatural: false, mythical_creatures: [], non_human_races: [] },
                systems: { leveling: false, skills: false, stats: false, classes: false, guilds: false, factions: false },
                physics: { gravity: 'normal', time_flow: 'linear', space: 'three_dimensional', special_phenomena: [] },
                inheritance: { mode: 'extend', exceptions: [] }
            },
            dimensional: null,
            connections: [],
            meta: { created: Date.now(), updated: 0, source: 'default', notes: '' }
        });

        const deepMerge = (target, source) => {
            const result = { ...target };
            for (const key in source) {
                if (Array.isArray(source[key])) {
                    result[key] = [...new Set([...(Array.isArray(result[key]) ? result[key] : []), ...source[key]])];
                } else if (source[key] && typeof source[key] === 'object') {
                    const nextTarget = (result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) ? result[key] : {};
                    result[key] = deepMerge(nextTarget, source[key]);
                } else {
                    result[key] = source[key];
                }
            }
            return result;
        };

        const deepClone = safeClone;

        const loadWorldGraph = (lorebook, force = false) => {
            if (profile && !force) return profile;

            profile = null;
            const graphEntry = lorebook.find(e => e.comment === WORLD_GRAPH_COMMENT);
            if (graphEntry) {
                try {
                    const parsed = JSON.parse(graphEntry.content);
                    profile = { ...createDefaultProfile(), ...parsed, nodes: new Map(parsed.nodes || []) };
                } catch (e) {
                    console.warn('[LIBRA] Failed to parse world graph:', e?.message);
                }
            }

            if (!profile) {
                profile = createDefaultProfile();
            }

            const nodeEntries = lorebook.filter(e => e.comment === WORLD_NODE_COMMENT);
            for (const entry of nodeEntries) {
                try {
                    const node = JSON.parse(entry.content);
                    profile.nodes.set(node.id, node);
                } catch (e) {
                    console.warn('[LIBRA] Failed to parse world node:', e?.message);
                }
            }

            if (profile.nodes.size === 0) {
                const rootNode = createDefaultRootNode();
                profile.nodes.set(rootNode.id, rootNode);
                profile.rootId = rootNode.id;
                profile.activePath = [rootNode.id];
            }

            return profile;
        };

        const getEffectiveRules = (nodeId) => {
            const node = profile.nodes.get(nodeId);
            if (!node) return null;

            const parentChain = [];
            const visited = new Set();
            let currentId = node.parent;
            
            visited.add(nodeId); // 현재 노드 등록
            while (currentId) {
                if (visited.has(currentId)) {
                    console.warn(`[LIBRA] Circular reference detected in world graph at node: ${currentId}`);
                    break;
                }
                visited.add(currentId);
                const parentNode = profile.nodes.get(currentId);
                if (parentNode) {
                    parentChain.unshift(parentNode);
                    currentId = parentNode.parent;
                } else break;
            }

            let effectiveRules = { exists: {}, systems: {}, physics: {}, custom: {} };
            for (const parent of parentChain) {
                effectiveRules = mergeRules(effectiveRules, parent.rules, parent.rules?.inheritance?.mode || 'extend');
            }
            effectiveRules = mergeRules(effectiveRules, node.rules, node.rules?.inheritance?.mode || 'extend');
            return effectiveRules;
        };

        const mergeRules = (base, overlay, mode) => {
            if (!overlay) return base;
            if (mode === 'override' || mode === 'isolate') return deepClone(overlay);
            return deepMerge(base, overlay);
        };

        const getCurrentRules = () => {
            if (!profile || profile.activePath.length === 0) return null;
            const currentId = profile.activePath[profile.activePath.length - 1];
            return getEffectiveRules(currentId);
        };

        const buildPathToNode = (nodeId) => {
            const path = [];
            const visited = new Set();
            let currentId = nodeId;
            while (currentId) {
                if (visited.has(currentId)) {
                    console.warn(`[LIBRA] Circular reference detected while building active path: ${currentId}`);
                    break;
                }
                visited.add(currentId);
                const node = profile.nodes.get(currentId);
                if (!node) break;
                path.unshift(currentId);
                currentId = node.parent;
            }
            return path;
        };

        const changeActivePath = (newNodeId, transition = null) => {
            const node = profile.nodes.get(newNodeId);
            if (!node) return { success: false, reason: 'Node not found' };

            const oldPath = [...profile.activePath];
            const newPath = buildPathToNode(newNodeId);
            if (newPath.length === 0) return { success: false, reason: 'Unable to build path' };
            profile.activePath = newPath;
            for (const [, worldNode] of profile.nodes) worldNode.isActive = false;
            for (const pathNodeId of newPath) {
                const pathNode = profile.nodes.get(pathNodeId);
                if (pathNode) pathNode.isActive = true;
            }

            if (transition) {
                profile.interference.recentEvents.push({
                    type: 'dimension_shift',
                    from: oldPath,
                    to: [...profile.activePath],
                    method: transition.method,
                    turn: MemoryState.currentTurn
                });
                if (profile.interference.recentEvents.length > 10) {
                    profile.interference.recentEvents.shift();
                }
                profile.interference.level = Math.min(1, profile.interference.recentEvents.length / 10);
            }

            return { success: true, oldPath, newPath: profile.activePath, node };
        };

        const popActivePath = () => {
            if (profile.activePath.length <= 1) return { success: false, reason: 'Cannot pop root' };
            const removedId = profile.activePath.pop();
            const removedNode = profile.nodes.get(removedId);
            if (removedNode) removedNode.isActive = false;
            return { success: true, removedNode, currentPath: profile.activePath };
        };

        const createNode = (config) => {
            const id = config.id ||`node_${Date.now()}`;
            const parentId = config.parent;

            if (parentId) {
                const parent = profile.nodes.get(parentId);
                if (!parent) return { success: false, reason: 'Parent not found' };
            }

            const node = {
                id,
                name: config.name || '새로운 세계',
                layer: config.layer || 'dimension',
                parent: parentId,
                children: [],
                isActive: false,
                isPrimary: config.isPrimary || false,
                accessCondition: config.accessCondition || null,
                rules: config.rules || { exists: {}, systems: {}, physics: {}, inheritance: { mode: 'extend', exceptions: [] } },
                dimensional: config.dimensional || null,
                connections: config.connections || [],
                meta: { created: Date.now(), updated: 0, source: config.source || 'user', notes: config.notes || '' }
            };

            profile.nodes.set(id, node);
            if (parentId) {
                const parent = profile.nodes.get(parentId);
                if (parent) parent.children.push(id);
            }

            updateComplexity();
            return { success: true, node };
        };

        const updateNode = (nodeId, updates) => {
            const node = profile.nodes.get(nodeId);
            if (!node) return { success: false, reason: 'Node not found' };

            if (updates.name) node.name = updates.name;
            if (updates.rules) node.rules = deepMerge(node.rules, updates.rules);
            if (updates.dimensional) node.dimensional = { ...node.dimensional, ...updates.dimensional };
            if (updates.connections) node.connections = [...node.connections, ...updates.connections];
            node.meta.updated = Date.now();

            return { success: true, node };
        };

        const updateComplexity = () => {
            const nodeCount = profile.nodes.size;
            const connectionCount = Array.from(profile.nodes.values()).reduce((sum, n) => sum + (n.connections?.length || 0), 0);
            profile.meta.complexity = 1 + Math.log2(nodeCount + 1) + (connectionCount * 0.1);
        };

        const _saveWorldGraphUnsafe = (lorebook) => {
            profile.meta.updated = Date.now();
            const graphEntry = {
                key: LibraLoreKeys.worldGraph(),
                comment: WORLD_GRAPH_COMMENT,
                content: JSON.stringify({
                    version: profile.version,
                    rootId: profile.rootId,
                    global: profile.global,
                    activePath: profile.activePath,
                    interference: profile.interference,
                    meta: profile.meta,
                    nodes: Array.from(profile.nodes.entries())
                }),
                mode: 'normal',
                insertorder: 1,
                alwaysActive: false
            };

            const existingIdx = lorebook.findIndex(e => e.comment === WORLD_GRAPH_COMMENT);
            if (existingIdx >= 0) lorebook[existingIdx] = graphEntry;
            else lorebook.unshift(graphEntry);
        };

        const saveWorldGraph = async (char, chat, lorebook) => {
            await loreLock.writeLock();
            try {
                _saveWorldGraphUnsafe(lorebook);
            } finally {
                loreLock.writeUnlock();
            }
        };

        const formatForPrompt = () => {
            if (!profile) return '';

            const parts = [];
            parts.push('【세계관 구조 / World Structure】');

            const globalFeatures = [];
            if (profile.global.multiverse) globalFeatures.push('멀티버스/Multiverse');
            if (profile.global.dimensionTravel) globalFeatures.push('차원 이동 가능/Dimension Travel');
            if (profile.global.timeTravel) globalFeatures.push('시간 여행 가능/Time Travel');
            if (profile.global.metaNarrative) globalFeatures.push('메타 서술/Meta Narrative');
            if (globalFeatures.length > 0) parts.push(`구조/Structure: ${globalFeatures.join(', ')}`);

            if (profile.activePath.length > 0) {
                parts.push('\n[현재 위치 / Current Location]');
                for (let i = 0; i < profile.activePath.length; i++) {
                    const node = profile.nodes.get(profile.activePath[i]);
                    if (node) {
                        const indent = '  '.repeat(i);
                        const active = i === profile.activePath.length - 1 ? ' ← 현재/Current' : '';
                        parts.push(`${indent}${node.name}${active}`);
                    }
                }
            }

            const currentRules = getCurrentRules();
            if (currentRules) {
                parts.push('\n[현재 세계 규칙 / Current World Rules]');
                const exists = currentRules.exists || {};
                const existingElements = [];
                if (exists.magic) existingElements.push('마법/Magic');
                if (exists.ki) existingElements.push('기(氣)/Ki');
                if (exists.supernatural) existingElements.push('초자연/Supernatural');
                if (exists.mythical_creatures?.length > 0) existingElements.push(...exists.mythical_creatures);
                if (existingElements.length > 0) parts.push(`  존재/Exists: ${existingElements.join(', ')}`);

                    const systems = currentRules.systems || {};
                    const activeSystems = [];
                    if (systems.leveling) activeSystems.push('레벨/Level');
                    if (systems.skills) activeSystems.push('스킬/Skill');
                    if (systems.stats) activeSystems.push('스탯/Stats');
                    if (activeSystems.length > 0) parts.push(`  시스템/Systems: ${activeSystems.join(', ')}`);

                    if (exists.technology) {
                        parts.push(`  기술/Technology: ${exists.technology}`);
                    }
                    const physics = currentRules.physics || {};
                    if (Array.isArray(physics.special_phenomena) && physics.special_phenomena.length > 0) {
                        parts.push(`  현상/Phenomena: ${physics.special_phenomena.join(', ')}`);
                    }
            }

            if (profile.interference.level > 0.5) {
                parts.push('\n⚠️ 차원 간섭도 높음 - 세계 간 영향 가능 / High dimensional interference - cross-world effects possible');
            }

            return parts.join('\n');
        };

        return {
            loadWorldGraph,
            getCurrentRules,
            getEffectiveRules,
            changeActivePath,
            popActivePath,
            createNode,
            updateNode,
            saveWorldGraph,
            saveWorldGraphUnsafe: _saveWorldGraphUnsafe,
            formatForPrompt,
            getProfile: () => profile,
            getActivePath: () => profile?.activePath || [],
            WORLD_TEMPLATES
        };
    })();

    // ══════════════════════════════════════════════════════════════
    // [MANAGER] Entity Manager
    // ══════════════════════════════════════════════════════════════
    const EntityManager = (() => {
        const entityCache = new Map();
        const relationCache = new Map();
        const ENTITY_COMMENT = "lmai_entity";
        const RELATION_COMMENT = "lmai_relation";
        const RELATION_DELTA_SCALE = 0.5;
        const MAX_ROLLBACK_SNAPSHOTS = 12;
        let identityState = {
            userCanonical: 'User',
            userAliases: new Set(['user', '사용자', 'you', 'me', '나', '본인'])
        };

        const normalizeBaseName = (name) => {
            if (!name) return '';
            let normalized = String(name || '')
                .replace(/[“”"'`‘’]/g, '')
                .replace(/\([^)]*\)/g, ' ')
                .replace(/\[[^\]]*\]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            const koTitles = ['선생님', '교수님', '박사님', '씨', '님', '양', '군'];
            const enTitles = ['Mr.', 'Mrs.', 'Ms.', 'Miss', 'Dr.', 'Prof.', 'Sir', 'Lady', 'Lord'];
            for (const title of koTitles) {
                if (normalized.endsWith(title) && normalized.length > title.length + 1) {
                    normalized = normalized.slice(0, -title.length).trim();
                    break;
                }
            }
            for (const title of enTitles) {
                const needsBoundary = !title.endsWith('.');
                const hasTitlePrefix = normalized.startsWith(title + ' ')
                    || (!needsBoundary && normalized.startsWith(title))
                    || normalized === title;
                if (hasTitlePrefix) {
                    normalized = normalized.slice(title.length).trim();
                    break;
                }
            }
            return normalized.trim();
        };

        const getKoreanShortName = (name) => {
            const base = normalizeBaseName(name);
            if (!/^[가-힣]{3,4}$/.test(base)) return '';
            return base.slice(-2);
        };

        const getEnglishOrJapaneseNameParts = (name) => {
            const base = normalizeBaseName(name);
            if (!base) return [];
            const spaceParts = base.split(/\s+/).filter(Boolean);
            if (spaceParts.length >= 2) {
                return spaceParts;
            }
            if (/[・·]/.test(base)) {
                return base.split(/[・·]/).map(v => v.trim()).filter(Boolean);
            }
            return [];
        };

        const buildAliasCandidates = (name, includeShortKorean = true) => {
            const base = normalizeBaseName(name);
            if (!base) return [];
            const compact = base.replace(/\s+/g, '');
            const aliases = new Set([base, compact, base.toLowerCase(), compact.toLowerCase()]);
            if (includeShortKorean) {
                const shortKo = getKoreanShortName(base);
                if (shortKo) {
                    aliases.add(shortKo);
                    aliases.add(shortKo.toLowerCase());
                }
            }
            return [...aliases].filter(Boolean);
        };

        const refreshIdentity = (char, db) => {
            const aliases = new Set(['user', '사용자', 'you', 'me', '나', '본인']);
            const configuredUserName = normalizeBaseName(db?.username || '');
            const personaName = normalizeBaseName(db?.personas?.[db?.selectedPersona || 0]?.name || '');
            const canonical = configuredUserName || personaName || identityState.userCanonical || 'User';
            buildAliasCandidates(canonical, true).forEach(alias => aliases.add(alias));
            if (personaName) buildAliasCandidates(personaName, true).forEach(alias => aliases.add(alias));
            identityState = {
                userCanonical: canonical,
                userAliases: aliases
            };
            return identityState;
        };

        const isUserAlias = (name) => {
            const aliases = buildAliasCandidates(name, true);
            return aliases.some(alias => identityState.userAliases.has(alias));
        };

        const extractEntityAliases = (entity) => {
            const aliases = new Set();
            buildAliasCandidates(entity?.name || '', true).forEach(alias => aliases.add(alias));
            for (const part of getEnglishOrJapaneseNameParts(entity?.name || '')) {
                buildAliasCandidates(part, false).forEach(alias => aliases.add(alias));
            }
            const metaAliases = Array.isArray(entity?.meta?.aliases) ? entity.meta.aliases : [];
            for (const alias of metaAliases) {
                buildAliasCandidates(alias, true).forEach(candidate => aliases.add(candidate));
            }
            return [...aliases].filter(Boolean);
        };

        const collectKnownEntities = (lorebook) => {
            // If entityCache is populated (after rebuildCache), use it directly to avoid
            // redundant lorebook parsing and duplicate entries
            if (entityCache.size > 0) {
                return Array.from(entityCache.values());
            }
            // Fallback: parse lorebook entries when cache is not yet built
            const known = [];
            for (const entry of Array.isArray(lorebook) ? lorebook : []) {
                if (entry.comment !== ENTITY_COMMENT) continue;
                try {
                    known.push(JSON.parse(entry.content || '{}'));
                } catch (e) {
                    if (typeof MemoryEngine !== 'undefined' && MemoryEngine.CONFIG?.debug) {
                        console.warn('[LIBRA] collectKnownEntities parse error:', e?.message);
                    }
                }
            }
            return known;
        };

        const resolveCanonicalName = (name, lorebook = []) => {
            const base = normalizeBaseName(name);
            if (!base) return '';
            if (isUserAlias(base)) return identityState.userCanonical || base;

            const incomingAliases = new Set(buildAliasCandidates(base, true));
            const knownEntities = collectKnownEntities(lorebook);
            const exactAliasMatch = knownEntities.find(entity => {
                const entityAliases = extractEntityAliases(entity);
                return entityAliases.some(alias => incomingAliases.has(alias));
            });
            if (exactAliasMatch?.name) {
                return normalizeBaseName(exactAliasMatch.name);
            }

            const shortKo = getKoreanShortName(base) || (/^[가-힣]{2}$/.test(base) ? base : '');
            if (shortKo) {
                const matches = knownEntities
                    .map(entity => normalizeBaseName(entity?.name || ''))
                    .filter(entityName => /^[가-힣]{3,4}$/.test(entityName) && entityName.endsWith(shortKo));
                const uniqueMatches = [...new Set(matches)];
                if (uniqueMatches.length === 1) return uniqueMatches[0];
            }

            const jpEnBase = normalizeBaseName(base);
            const jpEnIsSingleToken = getEnglishOrJapaneseNameParts(jpEnBase).length === 0
                && !/\s/.test(jpEnBase)
                && /[A-Za-z\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff]/.test(jpEnBase);
            if (jpEnIsSingleToken) {
                const matches = knownEntities
                    .map(entity => normalizeBaseName(entity?.name || ''))
                    .filter(Boolean)
                    .filter(entityName => {
                        const parts = getEnglishOrJapaneseNameParts(entityName);
                        if (parts.length < 2) return false;
                        return parts.some(part => normalizeBaseName(part).toLowerCase() === jpEnBase.toLowerCase());
                    });
                const uniqueMatches = [...new Set(matches)];
                if (uniqueMatches.length === 1) return uniqueMatches[0];
            }

            return base;
        };

        const normalizeName = (name, lorebook = []) => {
            return resolveCanonicalName(name, lorebook);
        };

        const makeRelationId = (nameA, nameB, lorebook = []) => {
            const sorted = [normalizeName(nameA, lorebook), normalizeName(nameB, lorebook)].sort();
            return `${sorted[0]}_${sorted[1]}`;
        };

        const addSourceMessageId = (meta, m_id) => {
            if (!meta || !m_id) return;
            const list = Array.isArray(meta.m_ids) ? meta.m_ids.filter(Boolean) : [];
            if (!list.includes(m_id)) list.push(m_id);
            meta.m_ids = list;
            meta.m_id = m_id;
        };

        const deepClone = safeClone;

        const trimRollbackSnapshots = (snapshots) => {
            if (!snapshots || typeof snapshots !== 'object') return {};
            const keys = Object.keys(snapshots);
            if (keys.length <= MAX_ROLLBACK_SNAPSHOTS) return snapshots;
            const sorted = keys.sort((a, b) => Number(snapshots[b]?.turn || 0) - Number(snapshots[a]?.turn || 0));
            const keep = new Set(sorted.slice(0, MAX_ROLLBACK_SNAPSHOTS));
            const trimmed = {};
            for (const key of keep) trimmed[key] = snapshots[key];
            return trimmed;
        };

        const captureRollbackSnapshot = (target, m_id, stateFactory) => {
            if (!target?.meta || !m_id || typeof stateFactory !== 'function') return;
            const snapshots = (target.meta.rollbackSnapshots && typeof target.meta.rollbackSnapshots === 'object')
                ? target.meta.rollbackSnapshots
                : {};
            if (!snapshots[m_id]) {
                snapshots[m_id] = {
                    turn: MemoryState.currentTurn,
                    state: deepClone(stateFactory(target))
                };
            }
            target.meta.rollbackSnapshots = trimRollbackSnapshots(snapshots);
        };

        const discardRollbackSnapshot = (target, m_id) => {
            const snapshots = target?.meta?.rollbackSnapshots;
            if (!snapshots || typeof snapshots !== 'object' || !m_id) return false;
            if (!Object.prototype.hasOwnProperty.call(snapshots, m_id)) return false;
            delete snapshots[m_id];
            if (Object.keys(snapshots).length === 0) delete target.meta.rollbackSnapshots;
            else target.meta.rollbackSnapshots = snapshots;
            return true;
        };

        const restoreRollbackSnapshot = (target, m_id) => {
            const snapshots = target?.meta?.rollbackSnapshots;
            if (!snapshots || typeof snapshots !== 'object' || !m_id) return false;
            const snapshot = snapshots[m_id];
            if (!snapshot?.state || typeof snapshot.state !== 'object') {
                discardRollbackSnapshot(target, m_id);
                return false;
            }

            const state = deepClone(snapshot.state);
            if (Object.prototype.hasOwnProperty.call(state, 'appearance')) target.appearance = state.appearance || { features: [], distinctiveMarks: [], clothing: [] };
            if (Object.prototype.hasOwnProperty.call(state, 'personality')) target.personality = state.personality || { traits: [], values: [], fears: [], likes: [], dislikes: [], sexualOrientation: '', sexualPreferences: [] };
            if (Object.prototype.hasOwnProperty.call(state, 'background')) target.background = state.background || { origin: '', occupation: '', history: [], secrets: [] };
            if (Object.prototype.hasOwnProperty.call(state, 'status')) target.status = state.status || { currentLocation: '', currentMood: '', healthStatus: '', lastUpdated: 0 };
            if (Object.prototype.hasOwnProperty.call(state, 'relationType')) target.relationType = state.relationType || target.relationType;
            if (Object.prototype.hasOwnProperty.call(state, 'details')) target.details = state.details || { howMet: '', duration: '', closeness: 0.3, trust: 0.5, events: [] };
            if (Object.prototype.hasOwnProperty.call(state, 'sentiments')) target.sentiments = state.sentiments || { fromAtoB: '', fromBtoA: '', currentTension: 0, lastInteraction: 0 };

            discardRollbackSnapshot(target, m_id);
            return true;
        };

        const applyRelationshipDelta = (current, delta) => {
            const safeCurrent = Number.isFinite(Number(current)) ? Number(current) : 0;
            const safeDelta = Number.isFinite(Number(delta)) ? Number(delta) : 0;
            return Math.max(0, Math.min(1, safeCurrent + (safeDelta * RELATION_DELTA_SCALE)));
        };

        const getRelationFloors = (relationType) => {
            const text = String(relationType || '').toLowerCase();
            const rules = [
                { keywords: ['연인', '애인', 'lover', 'romantic partner', 'spouse', 'wife', 'husband'], closeness: 0.75, trust: 0.75 },
                { keywords: ['썸', '호감', 'crush', 'flirt'], closeness: 0.55, trust: 0.45 },
                { keywords: ['친구', '동료', 'friend', 'teammate', 'partner'], closeness: 0.45, trust: 0.45 },
                { keywords: ['가족', '형제', '자매', '남매', '모녀', '부녀', 'family', 'sibling', 'parent'], closeness: 0.65, trust: 0.6 },
                { keywords: ['스승', '제자', 'mentor', 'student', 'teacher'], closeness: 0.35, trust: 0.55 },
                { keywords: ['라이벌', '경쟁', 'rival'], closeness: 0.3, trust: 0.2 },
                { keywords: ['적', '원수', 'enemy', 'hostile'], closeness: 0.05, trust: 0.05 }
            ];
            for (const rule of rules) {
                if (rule.keywords.some(keyword => text.includes(keyword))) {
                    return { closeness: rule.closeness, trust: rule.trust };
                }
            }
            return null;
        };

        const harmonizeRelationMetrics = (relation) => {
            if (!relation?.details) return relation;
            const floors = getRelationFloors(relation.relationType);
            if (!floors) return relation;
            relation.details.closeness = Math.max(
                Number.isFinite(Number(relation.details.closeness)) ? Number(relation.details.closeness) : 0,
                floors.closeness
            );
            relation.details.trust = Math.max(
                Number.isFinite(Number(relation.details.trust)) ? Number(relation.details.trust) : 0,
                floors.trust
            );
            return relation;
        };

        const normalizeFiniteNumber = (value, fallback = 0) => {
            const numeric = Number(value);
            return Number.isFinite(numeric) ? numeric : fallback;
        };

        const mergeEntityRecords = (baseEntity, incomingEntity) => {
            if (!baseEntity) return incomingEntity;
            if (!incomingEntity) return baseEntity;
            baseEntity.meta = baseEntity.meta || {};
            incomingEntity.meta = incomingEntity.meta || {};
            const aliasSet = new Set([
                ...(Array.isArray(baseEntity.meta.aliases) ? baseEntity.meta.aliases : []),
                ...(Array.isArray(incomingEntity.meta.aliases) ? incomingEntity.meta.aliases : []),
                normalizeBaseName(baseEntity.name || ''),
                normalizeBaseName(incomingEntity.name || '')
            ].filter(Boolean));
            baseEntity.meta.aliases = [...aliasSet];

            for (const key of ['features', 'distinctiveMarks', 'clothing']) {
                baseEntity.appearance = baseEntity.appearance || {};
                incomingEntity.appearance = incomingEntity.appearance || {};
                const merged = new Set([...(baseEntity.appearance[key] || []), ...(incomingEntity.appearance[key] || [])].filter(Boolean));
                baseEntity.appearance[key] = [...merged];
            }
            for (const key of ['traits', 'values', 'fears', 'likes', 'dislikes', 'sexualPreferences']) {
                baseEntity.personality = baseEntity.personality || {};
                incomingEntity.personality = incomingEntity.personality || {};
                const merged = new Set([...(baseEntity.personality[key] || []), ...(incomingEntity.personality[key] || [])].filter(Boolean));
                baseEntity.personality[key] = [...merged];
            }
            if (!baseEntity.personality.sexualOrientation && incomingEntity.personality?.sexualOrientation) {
                baseEntity.personality.sexualOrientation = incomingEntity.personality.sexualOrientation;
            }
            baseEntity.background = baseEntity.background || {};
            incomingEntity.background = incomingEntity.background || {};
            if (!baseEntity.background.origin && incomingEntity.background.origin) baseEntity.background.origin = incomingEntity.background.origin;
            if (!baseEntity.background.occupation && incomingEntity.background.occupation) baseEntity.background.occupation = incomingEntity.background.occupation;
            const mergedHistory = new Set([...(baseEntity.background.history || []), ...(incomingEntity.background.history || [])].filter(Boolean));
            baseEntity.background.history = [...mergedHistory];
            baseEntity.status = baseEntity.status || {};
            incomingEntity.status = incomingEntity.status || {};
            if (!baseEntity.status.currentLocation && incomingEntity.status.currentLocation) baseEntity.status.currentLocation = incomingEntity.status.currentLocation;
            if (!baseEntity.status.currentMood && incomingEntity.status.currentMood) baseEntity.status.currentMood = incomingEntity.status.currentMood;
            if (!baseEntity.status.healthStatus && incomingEntity.status.healthStatus) baseEntity.status.healthStatus = incomingEntity.status.healthStatus;
            baseEntity.meta.created = Math.min(
                normalizeFiniteNumber(baseEntity.meta.created, Infinity),
                normalizeFiniteNumber(incomingEntity.meta.created, Infinity)
            );
            if (!Number.isFinite(baseEntity.meta.created)) baseEntity.meta.created = 0;
            baseEntity.meta.updated = Math.max(
                normalizeFiniteNumber(baseEntity.meta.updated, 0),
                normalizeFiniteNumber(incomingEntity.meta.updated, 0)
            );
            baseEntity.meta.confidence = Math.max(
                normalizeFiniteNumber(baseEntity.meta.confidence, 0),
                normalizeFiniteNumber(incomingEntity.meta.confidence, 0)
            );
            return baseEntity;
        };

        const mergeRelationRecords = (baseRelation, incomingRelation) => {
            if (!baseRelation) return incomingRelation;
            if (!incomingRelation) return baseRelation;
            if (!baseRelation.relationType && incomingRelation.relationType) baseRelation.relationType = incomingRelation.relationType;
            baseRelation.details = baseRelation.details || {};
            incomingRelation.details = incomingRelation.details || {};
            if (!baseRelation.details.howMet && incomingRelation.details.howMet) baseRelation.details.howMet = incomingRelation.details.howMet;
            if (!baseRelation.details.duration && incomingRelation.details.duration) baseRelation.details.duration = incomingRelation.details.duration;
            baseRelation.details.closeness = Math.max(Number(baseRelation.details.closeness || 0), Number(incomingRelation.details.closeness || 0));
            baseRelation.details.trust = Math.max(Number(baseRelation.details.trust || 0), Number(incomingRelation.details.trust || 0));
            const mergedEvents = [...(baseRelation.details.events || []), ...(incomingRelation.details.events || [])];
            baseRelation.details.events = mergedEvents.slice(-20);
            baseRelation.sentiments = baseRelation.sentiments || {};
            incomingRelation.sentiments = incomingRelation.sentiments || {};
            if (!baseRelation.sentiments.fromAtoB && incomingRelation.sentiments.fromAtoB) baseRelation.sentiments.fromAtoB = incomingRelation.sentiments.fromAtoB;
            if (!baseRelation.sentiments.fromBtoA && incomingRelation.sentiments.fromBtoA) baseRelation.sentiments.fromBtoA = incomingRelation.sentiments.fromBtoA;
            baseRelation.sentiments.currentTension = Math.max(Number(baseRelation.sentiments.currentTension || 0), Number(incomingRelation.sentiments.currentTension || 0));
            baseRelation.sentiments.lastInteraction = Math.max(Number(baseRelation.sentiments.lastInteraction || 0), Number(incomingRelation.sentiments.lastInteraction || 0));
            baseRelation.meta = baseRelation.meta || {};
            incomingRelation.meta = incomingRelation.meta || {};
            baseRelation.meta.created = Math.min(
                normalizeFiniteNumber(baseRelation.meta.created, Infinity),
                normalizeFiniteNumber(incomingRelation.meta.created, Infinity)
            );
            if (!Number.isFinite(baseRelation.meta.created)) baseRelation.meta.created = 0;
            baseRelation.meta.updated = Math.max(
                normalizeFiniteNumber(baseRelation.meta.updated, 0),
                normalizeFiniteNumber(incomingRelation.meta.updated, 0)
            );
            baseRelation.meta.confidence = Math.max(
                normalizeFiniteNumber(baseRelation.meta.confidence, 0),
                normalizeFiniteNumber(incomingRelation.meta.confidence, 0)
            );
            harmonizeRelationMetrics(baseRelation);
            return baseRelation;
        };

        const buildEntityMentionRegex = (name) => {
            const escaped = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const latinName = /^[a-z0-9 .'-]+$/i.test(name);
            if (latinName) {
                return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
            }
            return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?:[이가은는을를와과랑이랑도의께님씨아야]|\\s|$|[.,!?])`, 'iu');
        };

        const mentionsEntity = (text, entityOrName) => {
            const rawText = String(text || '').trim();
            const entity = typeof entityOrName === 'string' ? { name: entityOrName } : (entityOrName || {});
            const candidates = extractEntityAliases(entity)
                .map(alias => normalizeBaseName(alias))
                .filter(alias => alias && alias.length >= 2);
            if (!rawText || candidates.length === 0) return false;

            const tokenSet = new Set(
                TokenizerEngine.tokenize(rawText)
                    .map(token => String(token || '').toLowerCase())
                    .filter(Boolean)
            );
            const compactText = rawText.toLowerCase().replace(/\s+/g, '');

            for (const candidate of candidates) {
                const loweredName = candidate.toLowerCase();
                if (tokenSet.has(loweredName)) return true;
                const compactName = loweredName.replace(/\s+/g, '');
                if (compactName.length >= 2 && compactText.includes(compactName)) {
                    if (buildEntityMentionRegex(candidate).test(rawText)) return true;
                }
                if (buildEntityMentionRegex(candidate).test(rawText)) return true;
            }

            return false;
        };

        const normalizeEntityShape = (entity) => {
            if (!entity || typeof entity !== 'object') return entity;
            entity.appearance = entity.appearance || {};
            entity.appearance.features = Array.isArray(entity.appearance.features) ? entity.appearance.features : [];
            entity.appearance.distinctiveMarks = Array.isArray(entity.appearance.distinctiveMarks) ? entity.appearance.distinctiveMarks : [];
            entity.appearance.clothing = Array.isArray(entity.appearance.clothing) ? entity.appearance.clothing : [];
            entity.personality = entity.personality || {};
            entity.personality.traits = Array.isArray(entity.personality.traits) ? entity.personality.traits : [];
            entity.personality.values = Array.isArray(entity.personality.values) ? entity.personality.values : [];
            entity.personality.fears = Array.isArray(entity.personality.fears) ? entity.personality.fears : [];
            entity.personality.likes = Array.isArray(entity.personality.likes) ? entity.personality.likes : [];
            entity.personality.dislikes = Array.isArray(entity.personality.dislikes) ? entity.personality.dislikes : [];
            entity.personality.sexualPreferences = Array.isArray(entity.personality.sexualPreferences) ? entity.personality.sexualPreferences : [];
            entity.personality.sexualOrientation = typeof entity.personality.sexualOrientation === 'string' ? entity.personality.sexualOrientation : '';
            entity.background = entity.background || {};
            entity.background.origin = typeof entity.background.origin === 'string' ? entity.background.origin : '';
            entity.background.occupation = typeof entity.background.occupation === 'string' ? entity.background.occupation : '';
            entity.background.history = Array.isArray(entity.background.history) ? entity.background.history : [];
            entity.background.secrets = Array.isArray(entity.background.secrets) ? entity.background.secrets : [];
            entity.status = entity.status || {};
            entity.status.currentLocation = typeof entity.status.currentLocation === 'string' ? entity.status.currentLocation : '';
            entity.status.currentMood = typeof entity.status.currentMood === 'string' ? entity.status.currentMood : '';
            entity.status.healthStatus = typeof entity.status.healthStatus === 'string' ? entity.status.healthStatus : '';
            entity.status.lastUpdated = Number.isFinite(Number(entity.status.lastUpdated)) ? Number(entity.status.lastUpdated) : 0;
            return entity;
        };

        const getOrCreateEntity = (name, lorebook) => {
            const normalizedName = resolveCanonicalName(name, lorebook);
            if (!normalizedName) return null;

            if (entityCache.has(normalizedName)) return entityCache.get(normalizedName);

            const existing = lorebook.find(e => {
                if (e.comment !== ENTITY_COMMENT) return false;
                try {
                    const parsed = JSON.parse(e.content || '{}');
                    return resolveCanonicalName(parsed.name || '', lorebook) === normalizedName;
                } catch {
                    return false;
                }
            });
            if (existing) {
                try {
                    const profile = normalizeEntityShape(JSON.parse(existing.content));
                    profile.meta = profile.meta || { created: 0, updated: 0, confidence: 0.5, source: '' };
                    if (!Array.isArray(profile.meta.m_ids) && profile.meta.m_id) profile.meta.m_ids = [profile.meta.m_id];
                    profile.meta.aliases = Array.isArray(profile.meta.aliases) ? profile.meta.aliases : [];
                    if (name && normalizeBaseName(name) && !profile.meta.aliases.includes(normalizeBaseName(name)) && normalizeBaseName(name) !== normalizedName) {
                        profile.meta.aliases.push(normalizeBaseName(name));
                    }
                    entityCache.set(normalizedName, profile);
                    return profile;
                } catch {}
            }

            const newEntity = {
                id: TokenizerEngine.simpleHash(normalizedName),
                name: normalizedName,
                type: 'character',
                appearance: { features: [], distinctiveMarks: [], clothing: [] },
                personality: { traits: [], values: [], fears: [], likes: [], dislikes: [], sexualOrientation: '', sexualPreferences: [] },
                background: { origin: '', occupation: '', history: [], secrets: [] },
                status: { currentLocation: '', currentMood: '', healthStatus: '', lastUpdated: 0 },
                meta: { created: MemoryState.currentTurn, updated: 0, confidence: 0.5, source: '', aliases: Array.from(new Set([normalizeBaseName(name)].filter(Boolean))) }
            };

            entityCache.set(normalizedName, newEntity);
            return newEntity;
        };

        const getOrCreateRelation = (nameA, nameB, lorebook) => {
            const normalizedA = resolveCanonicalName(nameA, lorebook);
            const normalizedB = resolveCanonicalName(nameB, lorebook);
            if (!normalizedA || !normalizedB || normalizedA === normalizedB) return null;

            const relationId = makeRelationId(normalizedA, normalizedB, lorebook);
            if (relationCache.has(relationId)) return relationCache.get(relationId);

            const existing = lorebook.find(e => {
                if (e.comment !== RELATION_COMMENT) return false;
                try {
                    const parsed = JSON.parse(e.content || '{}');
                    const parsedId = parsed.id || makeRelationId(parsed.entityA || '', parsed.entityB || '', lorebook);
                    return parsedId === relationId;
                } catch {
                    return false;
                }
            });
            if (existing) {
                try {
                    const relation = JSON.parse(existing.content);
                    relation.meta = relation.meta || { created: 0, updated: 0, confidence: 0.3, source: '' };
                    if (!Array.isArray(relation.meta.m_ids) && relation.meta.m_id) relation.meta.m_ids = [relation.meta.m_id];
                    relationCache.set(relationId, relation);
                    return relation;
                } catch {}
            }

            const newRelation = {
                id: relationId,
                entityA: normalizedA,
                entityB: normalizedB,
                relationType: '아는 사이',
                details: { howMet: '', duration: '', closeness: 0.3, trust: 0.5, events: [] },
                sentiments: { fromAtoB: '', fromBtoA: '', currentTension: 0, lastInteraction: MemoryState.currentTurn },
                meta: { created: MemoryState.currentTurn, updated: 0, confidence: 0.3 }
            };

            relationCache.set(relationId, newRelation);
            return newRelation;
        };

        const updateEntity = (name, updates, lorebook) => {
            const entity = getOrCreateEntity(name, lorebook);
            if (!entity) return null;
            entity.meta = entity.meta || { created: MemoryState.currentTurn, updated: 0, confidence: 0.5, source: '', aliases: [] };
            entity.meta.aliases = Array.isArray(entity.meta.aliases) ? entity.meta.aliases : [];
            const incomingAlias = normalizeBaseName(name);
            if (incomingAlias && incomingAlias !== entity.name && !entity.meta.aliases.includes(incomingAlias)) {
                entity.meta.aliases.push(incomingAlias);
            }

            const currentTurn = MemoryState.currentTurn;
            if (updates.m_id != null) {
                captureRollbackSnapshot(entity, updates.m_id, (target) => ({
                    appearance: target.appearance,
                    personality: target.personality,
                    background: target.background,
                    status: target.status
                }));
            }

            if (updates.appearance) {
                for (const key of ['features', 'distinctiveMarks', 'clothing']) {
                    if (Array.isArray(updates.appearance[key])) {
                        if (!Array.isArray(entity.appearance[key])) entity.appearance[key] = [];
                        const newItems = updates.appearance[key].filter(item => !entity.appearance[key].includes(item));
                        entity.appearance[key].push(...newItems);
                    }
                }
            }

            if (updates.personality) {
                for (const key of ['traits', 'values', 'fears', 'likes', 'dislikes', 'sexualPreferences']) {
                    if (Array.isArray(updates.personality[key])) {
                        if (!Array.isArray(entity.personality[key])) entity.personality[key] = [];
                        const newItems = updates.personality[key].filter(item => !entity.personality[key].includes(item));
                        entity.personality[key].push(...newItems);
                    }
                }
                if (updates.personality.sexualOrientation && !entity.personality.sexualOrientation) {
                    entity.personality.sexualOrientation = updates.personality.sexualOrientation;
                }
            }

            if (updates.background) {
                if (updates.background.origin && !entity.background.origin) entity.background.origin = updates.background.origin;
                if (updates.background.occupation && !entity.background.occupation) entity.background.occupation = updates.background.occupation;
                if (Array.isArray(updates.background.history)) {
                    if (!Array.isArray(entity.background.history)) entity.background.history = [];
                    const newHistory = updates.background.history.filter(h => !entity.background.history.includes(h));
                    entity.background.history.push(...newHistory);
                }
            }

            if (updates.status) {
                if (updates.status.currentLocation) entity.status.currentLocation = updates.status.currentLocation;
                if (updates.status.currentMood) entity.status.currentMood = updates.status.currentMood;
                if (updates.status.healthStatus) entity.status.healthStatus = updates.status.healthStatus;
                entity.status.lastUpdated = currentTurn;
            }

            entity.meta.updated = currentTurn;
            if (updates.source) entity.meta.source = updates.source;
            entity.meta.confidence = Math.min(1, entity.meta.confidence + 0.1);
            
            // Sync/Rollback Metadata
            if (updates.s_id != null) entity.meta.s_id = updates.s_id;
            if (updates.m_id != null) addSourceMessageId(entity.meta, updates.m_id);

            return entity;
        };

        const updateRelation = (nameA, nameB, updates, lorebook) => {
            const relation = getOrCreateRelation(nameA, nameB, lorebook);
            if (!relation) return null;

            const currentTurn = MemoryState.currentTurn;
            if (updates.m_id != null) {
                captureRollbackSnapshot(relation, updates.m_id, (target) => ({
                    relationType: target.relationType,
                    details: target.details,
                    sentiments: target.sentiments
                }));
            }

            if (updates.relationType) relation.relationType = updates.relationType;

            if (updates.details) {
                if (updates.details.howMet) relation.details.howMet = updates.details.howMet;
                if (updates.details.duration) relation.details.duration = updates.details.duration;
                if (typeof updates.details.closeness === 'number') relation.details.closeness = applyRelationshipDelta(relation.details.closeness, updates.details.closeness);
                if (typeof updates.details.trust === 'number') relation.details.trust = applyRelationshipDelta(relation.details.trust, updates.details.trust);
            }

            if (updates.sentiments) {
                if (updates.sentiments.fromAtoB) relation.sentiments.fromAtoB = updates.sentiments.fromAtoB;
                if (updates.sentiments.fromBtoA) relation.sentiments.fromBtoA = updates.sentiments.fromBtoA;
                if (typeof updates.sentiments.tension === 'number') relation.sentiments.currentTension = Math.max(0, Math.min(1, relation.sentiments.currentTension + updates.sentiments.tension));
            }

            if (updates.event) {
                relation.details.events.push({ turn: currentTurn, event: updates.event, sentiment: updates.eventSentiment || 'neutral' });
                if (relation.details.events.length > 20) relation.details.events = relation.details.events.slice(-15);
            }

            relation.meta.updated = currentTurn;
            relation.sentiments.lastInteraction = currentTurn;

            // Sync/Rollback Metadata
            if (updates.s_id != null) relation.meta.s_id = updates.s_id;
            if (updates.m_id != null) addSourceMessageId(relation.meta, updates.m_id);

            harmonizeRelationMetrics(relation);

            return relation;
        };

        const checkConsistency = (entityName, newInfo, lorebook = []) => {
            const entity = entityCache.get(resolveCanonicalName(entityName, lorebook));
            if (!entity) return { consistent: true, conflicts: [] };

            const conflicts = [];
            if (newInfo.appearance?.features) {
                const opposites = { '키가 큼': ['키가 작음'], '키가 작음': ['키가 큼'], '검은 머리': ['금발', '갈색 머리'], '금발': ['검은 머리', '갈색 머리'], 'tall': ['short'], 'short': ['tall'], 'black hair': ['blonde', 'brown hair'], 'blonde': ['black hair', 'brown hair'], 'brown hair': ['black hair', 'blonde'] };
                const currentFeatures = Array.isArray(entity.appearance.features) ? entity.appearance.features : [];
                for (const feature of newInfo.appearance.features) {
                    if (opposites[feature]) {
                        for (const opp of opposites[feature]) {
                            if (currentFeatures.includes(opp)) {
                                conflicts.push({ type: 'appearance', existing: opp, new: feature, message:`외모 충돌: "${opp}" vs "${feature}"` });
                            }
                        }
                    }
                }
            }

            return { consistent: conflicts.length === 0, conflicts };
        };

        const formatEntityForPrompt = (entity) => {
            const parts = [];
            parts.push(`【${entity.name}】`);
            if (entity.appearance.features.length > 0 || entity.appearance.distinctiveMarks.length > 0) {
                parts.push(`  외모/Appearance: ${[...entity.appearance.features, ...entity.appearance.distinctiveMarks].join(', ')}`);
            }
            if (entity.personality.traits.length > 0) parts.push(`  성격/Personality: ${entity.personality.traits.join(', ')}`);
            if (entity.personality.sexualOrientation) parts.push(`  성관념/Sexual Orientation: ${entity.personality.sexualOrientation}`);
            if (entity.personality.sexualPreferences?.length > 0) parts.push(`  성적취향/Sexual Preferences: ${entity.personality.sexualPreferences.join(', ')}`);
            if (entity.personality.likes.length > 0) parts.push(`  좋아하는 것/Likes: ${entity.personality.likes.join(', ')}`);
            if (entity.personality.dislikes.length > 0) parts.push(`  싫어하는 것/Dislikes: ${entity.personality.dislikes.join(', ')}`);
            if (entity.background.origin) parts.push(`  출신/Origin: ${entity.background.origin}`);
            if (entity.background.occupation) parts.push(`  직업/Occupation: ${entity.background.occupation}`);
            if (entity.status.currentMood) parts.push(`  현재 기분/Current Mood: ${entity.status.currentMood}`);
            if (entity.status.currentLocation) parts.push(`  현재 위치/Current Location: ${entity.status.currentLocation}`);
            return parts.join('\n');
        };

        const formatRelationForPrompt = (relation) => {
            const parts = [];
            parts.push(`【${relation.entityA} ↔ ${relation.entityB}】`);
            parts.push(`  관계/Relation: ${relation.relationType}`);
            if (relation.details.closeness > 0.7) parts.push(`  친밀도/Closeness: 매우 가까움/Very Close`);
            else if (relation.details.closeness > 0.4) parts.push(`  친밀도/Closeness: 보통/Moderate`);
            else parts.push(`  친밀도/Closeness: 어색함/Distant`);
            if (relation.details.trust > 0.7) parts.push(`  신뢰도/Trust: 매우 높음/Very High`);
            else if (relation.details.trust > 0.4) parts.push(`  신뢰도/Trust: 보통/Moderate`);
            else parts.push(`  신뢰도/Trust: 낮음/Low`);
            if (relation.sentiments.fromAtoB) parts.push(`    - ${relation.entityA} → ${relation.entityB}: ${relation.sentiments.fromAtoB}`);
            if (relation.sentiments.fromBtoA) parts.push(`    - ${relation.entityB} → ${relation.entityA}: ${relation.sentiments.fromBtoA}`);
            return parts.join('\n');
        };

        const clearCache = () => { entityCache.clear(); relationCache.clear(); };

        const rebuildCache = (lorebook) => {
            clearCache();
            for (const entry of lorebook) {
                try {
                    if (entry.comment === ENTITY_COMMENT) {
                        const entity = normalizeEntityShape(JSON.parse(entry.content));
                        entity.id = entity.id || TokenizerEngine.simpleHash(normalizeName(entity.name || ''));
                        entity.meta = entity.meta || { created: 0, updated: 0, confidence: 0.5, source: '' };
                        if (!Array.isArray(entity.meta.m_ids) && entity.meta.m_id) entity.meta.m_ids = [entity.meta.m_id];
                        entity.meta.aliases = Array.isArray(entity.meta.aliases) ? entity.meta.aliases : [];
                        const canonicalName = resolveCanonicalName(entity.name, lorebook);
                        if (entityCache.has(canonicalName)) {
                            entityCache.set(canonicalName, mergeEntityRecords(entityCache.get(canonicalName), entity));
                        } else {
                            entityCache.set(canonicalName, entity);
                        }
                    } else if (entry.comment === RELATION_COMMENT) {
                        const relation = JSON.parse(entry.content);
                        relation.entityA = resolveCanonicalName(relation.entityA || '', lorebook);
                        relation.entityB = resolveCanonicalName(relation.entityB || '', lorebook);
                        relation.id = relation.id || makeRelationId(relation.entityA || '', relation.entityB || '', lorebook);
                        relation.meta = relation.meta || { created: 0, updated: 0, confidence: 0.3, source: '' };
                        if (!Array.isArray(relation.meta.m_ids) && relation.meta.m_id) relation.meta.m_ids = [relation.meta.m_id];
                        if (relationCache.has(relation.id)) {
                            relationCache.set(relation.id, mergeRelationRecords(relationCache.get(relation.id), relation));
                        } else {
                            relationCache.set(relation.id, relation);
                        }
                    }
                } catch (e) {
                    if (typeof MemoryEngine !== 'undefined' && MemoryEngine.CONFIG?.debug) {
                        console.warn('[LIBRA] rebuildCache entry parse error:', e?.message);
                    }
                }
            }
        };

        const saveToLorebook = async (char, chat, lorebook) => {
            const currentTurn = MemoryState.currentTurn;

            for (const [name, entity] of entityCache) {
                entity.meta = entity.meta || { created: currentTurn, updated: currentTurn, confidence: 0.5, source: '' };
                entity.meta.updated = currentTurn;
                const entry = {
                    key: LibraLoreKeys.entityFromName(entity.name || name),
                    comment: ENTITY_COMMENT,
                    content: JSON.stringify(entity, null, 2),
                    mode: 'normal',
                    insertorder: 50,
                    alwaysActive: false
                };
                const existingIdx = lorebook.findIndex(e => {
                    if (e.comment !== ENTITY_COMMENT) return false;
                    try {
                        const parsed = JSON.parse(e.content || '{}');
                        return resolveCanonicalName(parsed.name || '', lorebook) === name;
                    } catch {
                        return false;
                    }
                });
                if (existingIdx >= 0) lorebook[existingIdx] = entry;
                else lorebook.push(entry);
            }

            for (const [id, relation] of relationCache) {
                relation.meta = relation.meta || { created: currentTurn, updated: currentTurn, confidence: 0.3, source: '' };
                relation.meta.updated = currentTurn;
                const entry = {
                    key: LibraLoreKeys.relationFromNames(relation.entityA, relation.entityB),
                    comment: RELATION_COMMENT,
                    content: JSON.stringify(relation, null, 2),
                    mode: 'normal',
                    insertorder: 60,
                    alwaysActive: false
                };
                const existingIdx = lorebook.findIndex(e => {
                    if (e.comment !== RELATION_COMMENT) return false;
                    try {
                        const parsed = JSON.parse(e.content || '{}');
                        const parsedId = parsed.id || makeRelationId(parsed.entityA || '', parsed.entityB || '', lorebook);
                        return parsedId === id;
                    } catch {
                        return false;
                    }
                });
                if (existingIdx >= 0) lorebook[existingIdx] = entry;
                else lorebook.push(entry);
            }
        };

        return {
            refreshIdentity,
            normalizeName, makeRelationId, getOrCreateEntity, getOrCreateRelation,
            updateEntity, updateRelation, checkConsistency, formatEntityForPrompt,
            formatRelationForPrompt, clearCache, rebuildCache, saveToLorebook,
            mentionsEntity, restoreRollbackSnapshot, discardRollbackSnapshot,
            getEntityCache: () => entityCache, getRelationCache: () => relationCache
        };
    })();

    // ══════════════════════════════════════════════════════════════
    // [MANAGER] Narrative Tracker
    // ══════════════════════════════════════════════════════════════
    const NarrativeTracker = (() => {
        const NARRATIVE_COMMENT = 'lmai_narrative';
        const SUMMARY_INTERVAL = 5;

        let narrativeState = {
            storylines: [],
            turnLog: [],
            lastSummaryTurn: 0
        };

        const clipText = (text, max = 180) => {
            const normalized = String(text || '').replace(/\s+/g, ' ').trim();
            if (!normalized) return '';
            if (normalized.length <= max) return normalized;
            const sliced = normalized.slice(0, Math.max(0, max - 1));
            const boundary = Math.max(sliced.lastIndexOf('. '), sliced.lastIndexOf('! '), sliced.lastIndexOf('? '), sliced.lastIndexOf(', '), sliced.lastIndexOf(' '));
            const compact = (boundary >= Math.max(24, Math.floor(max * 0.45)) ? sliced.slice(0, boundary) : sliced).trim();
            return `${compact}…`;
        };

        const cleanNarrativeText = (text) => {
            const raw = Utils.getNarrativeSourceText(text, 'ai') || Utils.getMemorySourceText(text);
            if (!raw) return '';
            const cleanedLines = raw
                .replace(/\r/g, '')
                .split('\n')
                .map(line => line.trim())
                .filter(line => {
                    if (!line) return false;
                    if (/^#{1,6}\s+/.test(line)) return false;
                    if (/^(?:volume|chapter)\b/i.test(line)) return false;
                    if (/^chatindex\s*:/i.test(line)) return false;
                    if (/^⏱️?\s*\[/.test(line)) return false;
                    if (/^\[\s*(?:response|응답|assistant|character)\s*\]$/i.test(line)) return false;
                    if (/^[-=_*]{3,}$/.test(line)) return false;
                    if (/^```/.test(line)) return false;
                    return true;
                });
            return cleanedLines.join('\n').trim();
        };

        const extractNarrativeParagraph = (text) => {
            const cleaned = cleanNarrativeText(text);
            if (!cleaned) return '';
            const paragraphs = cleaned
                .split(/\n{2,}/)
                .map(part => part.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim())
                .filter(Boolean);
            const meaningful = paragraphs.find(part => (part.match(/[A-Za-z0-9\u3131-\u318E\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFF]/g) || []).length >= 12);
            return meaningful || paragraphs[0] || '';
        };

        const buildHeuristicTurnBrief = (userMsg, aiResponse) => {
            const paragraph = extractNarrativeParagraph(aiResponse);
            const normalizedUser = clipText(userMsg, 120);
            if (!paragraph) return normalizedUser;

            const sentences = paragraph.match(/[^.!?…\n]+(?:[.!?…]+|$)/g) || [paragraph];
            const picked = [];
            let totalLength = 0;
            for (const sentence of sentences) {
                const compact = sentence.replace(/\s+/g, ' ').trim();
                if (!compact) continue;
                if (picked.length >= 2) break;
                if (picked.length > 0 && totalLength + compact.length > 180) break;
                picked.push(compact);
                totalLength += compact.length;
            }

            const summary = clipText((picked.join(' ') || paragraph).replace(/^["'“”‘’]+|["'“”‘’]+$/g, ''), 180);
            if (summary) return summary;
            return normalizedUser;
        };

        const generateTurnBrief = async (userMsg, aiResponse, config) => {
            const heuristic = buildHeuristicTurnBrief(userMsg, aiResponse);
            if (!LLMProvider.isConfigured(config, 'aux')) return heuristic;

            const sourceUser = clipText(userMsg, 180);
            const sourceAi = clipText(extractNarrativeParagraph(aiResponse), 900);
            if (!sourceAi) return heuristic;

            try {
                const result = await runMaintenanceLLM(() =>
                    LLMProvider.call(
                        config,
                        'You compress a roleplay turn into one concrete narrative beat. Focus on what changed, was decided, revealed, or emotionally shifted. Respond in the same language as the content. Output plain text only, one sentence, no markdown, no quotes, max 160 characters.',
                        `User action:\n${sourceUser || '(none)'}\n\nAI response:\n${sourceAi}`,
                        { maxTokens: 120, profile: 'aux' }
                    )
                , 'narrative-turn-brief');
                return clipText(result?.content || heuristic, 180) || heuristic;
            } catch (e) {
                console.warn('[LIBRA] Narrative turn brief failed:', e?.message);
                return heuristic;
            }
        };

        const deriveKeyPointsFromBrief = (brief, maxItems = 3) => {
            const normalized = String(brief || '').replace(/\s+/g, ' ').trim();
            if (!normalized) return [];
            const parts = normalized
                .split(/\s*(?:;|,| 그리고 | but | however | meanwhile | while )\s*/i)
                .map(part => clipText(part, 80))
                .filter(Boolean);
            return [...new Set(parts)].slice(0, maxItems);
        };

        const deriveOngoingTensionsFromTurn = (turnEntry, maxItems = 3) => {
            const brief = clipText(turnEntry?.summary || turnEntry?.response || '', 180);
            const userAction = clipText(turnEntry?.userAction || '', 120);
            const candidates = [];
            if (brief) candidates.push(`Current pressure: ${brief}`);
            if (userAction && brief && !brief.toLowerCase().includes(userAction.toLowerCase())) {
                candidates.push(`Pending response to: ${userAction}`);
            }
            if (!brief && userAction) candidates.push(`Pending response to: ${userAction}`);
            return [...new Set(candidates.map(item => clipText(item, 120)).filter(Boolean))].slice(0, maxItems);
        };

        const applyLiveNarrativeSnapshot = (storyline, turnEntry) => {
            if (!storyline || !turnEntry) return;
            const brief = clipText(turnEntry.summary || turnEntry.response || turnEntry.userAction, 180);
            if (!brief) return;

            storyline.currentContext = brief;
            const liveKeyPoints = deriveKeyPointsFromBrief(brief);
            const liveTensions = deriveOngoingTensionsFromTurn(turnEntry);
            if ((!Array.isArray(storyline.keyPoints) || storyline.keyPoints.length === 0) && liveKeyPoints.length > 0) {
                storyline.keyPoints = liveKeyPoints;
            }
            if (!Array.isArray(storyline.ongoingTensions) || storyline.ongoingTensions.length === 0) {
                storyline.ongoingTensions = liveTensions;
            } else if (liveTensions.length > 0) {
                storyline.ongoingTensions = [...new Set([...liveTensions, ...storyline.ongoingTensions])].slice(0, 6);
            }
            storyline.summaries = Array.isArray(storyline.summaries) ? storyline.summaries : [];

            const existingLiveIndex = storyline.summaries.findIndex(entry => entry?.live === true);
            const liveEntry = {
                upToTurn: Number(turnEntry.turn || 0),
                summary: brief,
                keyPoints: liveKeyPoints,
                ongoingTensions: [...storyline.ongoingTensions],
                timestamp: Date.now(),
                live: true
            };

            if (existingLiveIndex >= 0) storyline.summaries[existingLiveIndex] = liveEntry;
            else storyline.summaries.push(liveEntry);

            if (storyline.summaries.length > 12) {
                storyline.summaries = storyline.summaries.slice(-12);
            }
        };

        const normalizeTurnEntry = (entry = {}) => {
            const userAction = clipText(entry.userAction || '', 200);
            const sourceResponse = String(entry.summary || entry.response || '').trim();
            const summary = clipText(buildHeuristicTurnBrief(userAction, sourceResponse), 180);
            return {
                turn: Number(entry.turn || 0),
                timestamp: Number(entry.timestamp || Date.now()),
                userAction,
                response: summary,
                involvedEntities: Array.isArray(entry.involvedEntities)
                    ? entry.involvedEntities.map(e => typeof e === 'string' ? e : e?.name).filter(Boolean)
                    : [],
                summary
            };
        };

        const normalizeState = (state = null) => {
            const nextState = state && typeof state === 'object' ? safeClone(state) : { storylines: [], turnLog: [], lastSummaryTurn: 0 };
            nextState.turnLog = Array.isArray(nextState.turnLog) ? nextState.turnLog.map(normalizeTurnEntry).filter(entry => entry.turn >= 0) : [];
            const turnMap = new Map(nextState.turnLog.map(entry => [entry.turn, entry]));
            nextState.storylines = Array.isArray(nextState.storylines) ? nextState.storylines.map((storyline, idx) => {
                const turns = Array.isArray(storyline?.turns) ? storyline.turns.map(turn => Number(turn)).filter(Number.isFinite) : [];
                const recentEvents = Array.isArray(storyline?.recentEvents) ? storyline.recentEvents.map((event) => {
                    const turn = Number(event?.turn ?? event);
                    const matched = turnMap.get(turn);
                    return {
                        turn: Number.isFinite(turn) ? turn : '?',
                        brief: clipText(matched?.summary || event?.brief || '', 180)
                    };
                }).filter(event => String(event.brief || '').trim()) : [];
                return {
                    id: Number(storyline?.id || idx + 1),
                    name: String(storyline?.name || `Storyline #${idx + 1}`),
                    entities: Array.isArray(storyline?.entities) ? storyline.entities.map(String).filter(Boolean) : [],
                    turns,
                    firstTurn: Number(storyline?.firstTurn || turns[0] || 0),
                    lastTurn: Number(storyline?.lastTurn || turns[turns.length - 1] || 0),
                    recentEvents: recentEvents.slice(-10),
                    summaries: Array.isArray(storyline?.summaries) ? storyline.summaries.map(entry => ({
                        upToTurn: Number(entry?.upToTurn || 0),
                        summary: clipText(entry?.summary || '', 240),
                        keyPoints: Array.isArray(entry?.keyPoints) ? entry.keyPoints.map(String).filter(Boolean) : [],
                        ongoingTensions: Array.isArray(entry?.ongoingTensions) ? entry.ongoingTensions.map(String).filter(Boolean) : [],
                        timestamp: Number(entry?.timestamp || Date.now()),
                        live: entry?.live === true
                    })) : [],
                    currentContext: clipText(storyline?.currentContext || '', 260),
                    keyPoints: Array.isArray(storyline?.keyPoints) ? storyline.keyPoints.map(String).filter(Boolean) : [],
                    ongoingTensions: Array.isArray(storyline?.ongoingTensions) ? storyline.ongoingTensions.map(String).filter(Boolean) : []
                };
            }) : [];
            nextState.lastSummaryTurn = Number(nextState.lastSummaryTurn || 0);
            return nextState;
        };

        const loadState = (lorebook) => {
            const entry = lorebook.find(e => e.comment === NARRATIVE_COMMENT);
            if (entry) {
                try {
                    narrativeState = normalizeState(JSON.parse(entry.content));
                } catch (e) { console.warn('[LIBRA] Narrative state parse failed:', e?.message); }
            }
            return narrativeState;
        };

        const saveState = async (lorebook) => {
            const entry = {
                key: LibraLoreKeys.narrative(),
                comment: NARRATIVE_COMMENT,
                content: JSON.stringify(narrativeState),
                mode: 'normal',
                insertorder: 5,
                alwaysActive: false
            };
            const idx = lorebook.findIndex(e => e.comment === NARRATIVE_COMMENT);
            if (idx >= 0) lorebook[idx] = entry;
            else lorebook.push(entry);
        };

        const recordTurn = async (turn, userMsg, aiResponse, entities = [], config = MemoryEngine.CONFIG) => {
            const responseBrief = await generateTurnBrief(userMsg, aiResponse, config);
            const turnEntry = {
                turn,
                timestamp: Date.now(),
                userAction: clipText(userMsg, 200),
                response: responseBrief,
                involvedEntities: entities.map(e => typeof e === 'string' ? e : e.name),
                summary: responseBrief
            };
            narrativeState.turnLog.push(turnEntry);

            if (narrativeState.turnLog.length > 50) {
                narrativeState.turnLog = narrativeState.turnLog.slice(-50);
            }

            assignToStoryline(turnEntry);
        };

        const assignToStoryline = (turnEntry) => {
            const entities = turnEntry.involvedEntities;

            let bestMatch = null;
            let bestScore = 0;

            for (const storyline of narrativeState.storylines) {
                const overlap = entities.filter(e => storyline.entities.includes(e)).length;
                const score = entities.length > 0 ? overlap / entities.length : 0;
                if (score > bestScore && score >= 0.3) {
                    bestScore = score;
                    bestMatch = storyline;
                }
            }

            if (bestMatch) {
                bestMatch.turns.push(turnEntry.turn);
                bestMatch.lastTurn = turnEntry.turn;
                for (const e of entities) {
                    if (!bestMatch.entities.includes(e)) bestMatch.entities.push(e);
                }
                bestMatch.recentEvents.push({
                    turn: turnEntry.turn,
                    brief: clipText(turnEntry.summary || turnEntry.response || turnEntry.userAction, 180)
                });
                if (bestMatch.recentEvents.length > 10) {
                    bestMatch.recentEvents = bestMatch.recentEvents.slice(-10);
                }
                applyLiveNarrativeSnapshot(bestMatch, turnEntry);
            } else if (entities.length > 0) {
                const id = narrativeState.storylines.length + 1;
                const storyline = {
                    id,
                    name: `Storyline #${id}`,
                    entities: [...entities],
                    turns: [turnEntry.turn],
                    firstTurn: turnEntry.turn,
                    lastTurn: turnEntry.turn,
                    recentEvents: [{
                        turn: turnEntry.turn,
                        brief: clipText(turnEntry.summary || turnEntry.response || turnEntry.userAction, 180)
                    }],
                    summaries: [],
                    currentContext: '',
                    keyPoints: [],
                    ongoingTensions: []
                };
                applyLiveNarrativeSnapshot(storyline, turnEntry);
                narrativeState.storylines.push(storyline);
            }
        };

        const summarizeIfNeeded = async (currentTurn, config) => {
            if (currentTurn - narrativeState.lastSummaryTurn < SUMMARY_INTERVAL) return;

            // Build per-storyline tasks, then execute in parallel
            const tasks = [];
            let summarized = false;
            for (const storyline of narrativeState.storylines) {
                const recentTurns = narrativeState.turnLog.filter(
                    t => storyline.turns.includes(t.turn) && t.turn > (storyline.summaries.length > 0 ? storyline.summaries[storyline.summaries.length - 1].upToTurn : 0)
                );

                if (recentTurns.length < 3) continue;

                if (LLMProvider.isConfigured(config, 'aux')) {
                    const turnTexts = recentTurns.map(t => `Turn ${t.turn}: ${t.userAction} -> ${t.summary || t.response || t.userAction}`).join('\n');
                    tasks.push(
                        runMaintenanceLLM(() =>
                            LLMProvider.call(config,
                                'You are a narrative analyst. Summarize the following story events concisely. Identify the key plot points, character developments, and ongoing tensions. Respond in the same language as the content.\n\nOutput JSON: {"summary": "...", "keyPoints": ["..."], "ongoingTensions": ["..."], "context": "brief context for continuation"}',
                                `Storyline: ${storyline.name}\nEntities: ${storyline.entities.join(', ')}\n\nRecent events:\n${turnTexts}`,
                                { maxTokens: 500, profile: 'aux' }
                            )
                        , `narrative-summary-${storyline.id || storyline.name || 'storyline'}`).then(result => {
                            if (!result.content) return false;
                            const parsed = extractJson(result.content);
                            if (parsed) {
                                storyline.summaries = (storyline.summaries || []).filter(entry => entry?.live !== true);
                                storyline.summaries.push({
                                    upToTurn: currentTurn,
                                    summary: parsed.summary || '',
                                    keyPoints: parsed.keyPoints || [],
                                    ongoingTensions: parsed.ongoingTensions || [],
                                    timestamp: Date.now()
                                });
                                storyline.currentContext = parsed.context || parsed.summary || '';
                                if (parsed.keyPoints) {
                                    storyline.keyPoints = [...new Set([...storyline.keyPoints, ...parsed.keyPoints])].slice(-20);
                                }
                                if (parsed.ongoingTensions) {
                                    storyline.ongoingTensions = [...new Set([...(storyline.ongoingTensions || []), ...parsed.ongoingTensions])].slice(-20);
                                }
                                return true;
                            }
                            return false;
                        }).catch(e => {
                            console.warn('[LIBRA] Narrative summary failed:', e?.message);
                            return false;
                        })
                    );
                } else {
                    const brief = clipText(recentTurns.map(t => t.summary || t.response || t.userAction).filter(Boolean).join(' -> '), 240);
                    storyline.summaries = (storyline.summaries || []).filter(entry => entry?.live !== true);
                    storyline.summaries.push({
                        upToTurn: currentTurn,
                        summary: brief,
                        keyPoints: [],
                        ongoingTensions: [],
                        timestamp: Date.now()
                    });
                    storyline.currentContext = brief;
                    summarized = true;
                }
            }

            if (tasks.length > 0) {
                const results = await Promise.allSettled(tasks);
                const anySucceeded = results.some(r => r.status === 'fulfilled' && r.value === true);
                if (anySucceeded) summarized = true;
            }
            if (summarized) {
                narrativeState.lastSummaryTurn = currentTurn;
            }
        };

        const formatForPrompt = () => {
            if (narrativeState.storylines.length === 0) return '';

            const parts = ['【내러티브 현황 / Narrative Status】'];

            for (const storyline of narrativeState.storylines) {
                parts.push(`\n[${storyline.name}] (Entities: ${storyline.entities.join(', ')})`);
                if (storyline.currentContext) {
                    parts.push(`  Context: ${storyline.currentContext}`);
                }
                if (storyline.keyPoints.length > 0) {
                    parts.push(`  Key Points: ${storyline.keyPoints.slice(-5).join('; ')}`);
                }
                if (Array.isArray(storyline.ongoingTensions) && storyline.ongoingTensions.length > 0) {
                    parts.push(`  Ongoing Story Flow: ${storyline.ongoingTensions.slice(-5).join('; ')}`);
                }
                if (storyline.recentEvents.length > 0) {
                    const last3 = storyline.recentEvents.slice(-3);
                    parts.push(`  Recent: ${last3.map(e => `T${e.turn}: ${e.brief}`).join(' → ')}`);
                }
            }

            return parts.join('\n');
        };

        const getState = () => narrativeState;
        const resetState = (nextState = null) => {
            narrativeState = normalizeState(nextState);
            return narrativeState;
        };

        return { loadState, saveState, recordTurn, summarizeIfNeeded, formatForPrompt, getState, resetState };
    })();

    // ══════════════════════════════════════════════════════════════
    // [MANAGER] Story Author
    // ══════════════════════════════════════════════════════════════
    const StoryAuthor = (() => {
        const AUTHOR_COMMENT = 'lmai_story_author';
        const PLAN_INTERVAL = 2;

        let authorState = {
            currentArc: '',
            narrativeGoal: '',
            activeTensions: [],
            nextBeats: [],
            guardrails: [],
            focusCharacters: [],
            recentDecisions: [],
            autoAdvanceOnEmptyInput: true,
            lastPlanTurn: 0,
            lastUpdated: 0
        };

        const loadState = (lorebook) => {
            const entry = lorebook.find(e => e.comment === AUTHOR_COMMENT);
            if (entry) {
                try {
                    authorState = { ...authorState, ...JSON.parse(entry.content) };
                } catch (e) { console.warn('[LIBRA] Story author state parse failed:', e?.message); }
            }
            return authorState;
        };

        const saveState = async (lorebook) => {
            const entry = {
                key: 'lmai_story_author::plan',
                comment: AUTHOR_COMMENT,
                content: JSON.stringify(authorState),
                mode: 'normal',
                insertorder: 6,
                alwaysActive: false
            };
            const idx = lorebook.findIndex(e => e.comment === AUTHOR_COMMENT);
            if (idx >= 0) lorebook[idx] = entry;
            else lorebook.push(entry);
        };

        const getRelevantMemorySummaries = (limit = 6) => {
            try {
                const char = typeof risuai !== 'undefined' ? risuai.getCharacter?.() : null;
                return [];
            } catch {
                return [];
            }
        };

        const buildPayload = (turn, userMsg, aiResponse, involvedEntities = [], effectiveLore = []) => {
            const names = [...new Set((involvedEntities || []).map(e => typeof e === 'string' ? e : e?.name).filter(Boolean))];
            const entityCache = Array.from(EntityManager.getEntityCache().values());
            const focusedEntities = names.length > 0
                ? entityCache.filter(entity => names.includes(entity.name))
                : entityCache.slice(0, 4);
            const relationTexts = Array.from(EntityManager.getRelationCache().values())
                .filter(rel => focusedEntities.some(entity => entity.name === rel.entityA || entity.name === rel.entityB))
                .slice(0, 6)
                .map(rel => EntityManager.formatRelationForPrompt(rel));
            const entityTexts = focusedEntities.slice(0, 6).map(entity => EntityManager.formatEntityForPrompt(entity));
            const charStateTexts = focusedEntities
                .map(entity => CharacterStateTracker.formatForPrompt(entity.name))
                .filter(Boolean);
            const worldPrompt = HierarchicalWorldManager.formatForPrompt();
            const worldStatePrompt = WorldStateTracker.formatForPrompt();
            const narrativePrompt = NarrativeTracker.formatForPrompt();
            const recentTurns = (NarrativeTracker.getState()?.turnLog || []).slice(-8)
                .map(t => `Turn ${t.turn}: ${t.userAction} -> ${t.response}`);
            const memoryEntries = MemoryEngine.getManagedEntries(effectiveLore)
                .map(entry => ({ entry, meta: MemoryEngine.getCachedMeta(entry) }))
                .sort((a, b) => (b.meta.imp - a.meta.imp) || (b.meta.t - a.meta.t))
                .slice(0, 6)
                .map(({ entry }) => (entry.content || '').replace(MemoryEngine.META_PATTERN, '').trim().slice(0, 180));
            const loreSnippets = MemoryEngine.CONFIG.useLorebookRAG
                ? effectiveLore
                    .filter(e => !e.comment || !String(e.comment).startsWith('lmai_'))
                    .slice(0, 3)
                    .map(e => (e.content || '').slice(0, 180))
                : [];

            return {
                turn,
                userMsg,
                isEmptyInput: !String(userMsg || '').trim(),
                aiResponse,
                focusedEntities: focusedEntities.map(e => e.name),
                entityTexts,
                relationTexts,
                charStateTexts,
                worldPrompt,
                worldStatePrompt,
                narrativePrompt,
                recentTurns,
                memoryEntries,
                loreSnippets
            };
        };

        const buildHeuristicPlan = (payload, mode) => {
            const firstStoryline = (NarrativeTracker.getState()?.storylines || [])[0];
            const defaultArc = firstStoryline?.name || 'Ongoing Story';
            const nextBeats = [];
            if (payload.focusedEntities.length > 0) {
                nextBeats.push(`${payload.focusedEntities[0]} should take a concrete action that changes the scene.`);
            }
            if (payload.relationTexts.length > 0) {
                nextBeats.push('Let relationship tension shift through dialogue or a small decision, not exposition.');
            }
            if (payload.worldStatePrompt) {
                nextBeats.push('Use the current world state as an active pressure on the scene.');
            }
            if (payload.isEmptyInput) {
                nextBeats.push('The user gave no new input, so continue from the current scene and move it forward by one clear beat.');
                nextBeats.push('Do not stall in static atmosphere; make someone act, decide, reveal, interrupt, or shift the relationship.');
            }
            if (mode === 'aggressive') {
                nextBeats.push('Do not let the scene stall; force a meaningful turn before the response ends.');
            } else {
                nextBeats.push('Advance one meaningful beat while preserving continuity.');
            }
            return {
                currentArc: authorState.currentArc || defaultArc,
                narrativeGoal: authorState.narrativeGoal || (payload.isEmptyInput
                    ? 'Continue the scene without waiting for user direction and produce the next concrete beat.'
                    : 'Maintain momentum and create the next meaningful beat.'),
                activeTensions: authorState.activeTensions?.length ? authorState.activeTensions : ['Preserve continuity while escalating the most relevant tension.'],
                nextBeats,
                guardrails: [
                    'Respect established world rules, relationship states, and hidden information boundaries.',
                    'Prefer causally grounded developments over random twists.'
                ],
                focusCharacters: payload.focusedEntities,
                recentDecisions: (authorState.recentDecisions || []).slice(-4)
            };
        };

        const updatePlanIfNeeded = async (currentTurn, config, userMsg, aiResponse, involvedEntities = [], effectiveLore = []) => {
            if (!config.storyAuthorEnabled) return;
            if ((currentTurn - (authorState.lastPlanTurn || 0)) < PLAN_INTERVAL && (authorState.nextBeats || []).length > 0) return;

            const payload = buildPayload(currentTurn, userMsg, aiResponse, involvedEntities, effectiveLore);
            let nextPlan = null;
            const mode = String(config.storyAuthorMode || 'proactive').toLowerCase();

            if (LLMProvider.isConfigured(config, 'aux')) {
                try {
                    const system = [
                        'You are LIBRA Story Author, a proactive story planner working inside the memory engine.',
                        'Using the provided world, memory, entity, relation, narrative, and state data, produce a compact plan that actively steers the next response.',
                        'The main model will write the final prose, so focus on story-driving guidance, not final narration.',
                        'If the user input is empty, do not wait passively. Continue the current scene and force one meaningful narrative beat using existing context.',
                        'Respond only as JSON: {"currentArc":"","narrativeGoal":"","activeTensions":[""],"nextBeats":[""],"guardrails":[""],"focusCharacters":[""],"recentDecisions":[""]}'
                    ].join('\n');
                    const user = [
                        `Mode: ${mode}`,
                        `Turn: ${currentTurn}`,
                        `Empty Input: ${payload.isEmptyInput ? 'yes' : 'no'}`,
                        payload.userMsg ? `User Input:\n${payload.userMsg}` : '',
                        payload.aiResponse ? `Latest Response:\n${payload.aiResponse}` : '',
                        payload.worldPrompt ? `World:\n${payload.worldPrompt}` : '',
                        payload.narrativePrompt ? `Narrative:\n${payload.narrativePrompt}` : '',
                        payload.entityTexts.length ? `Entities:\n${payload.entityTexts.join('\n\n')}` : '',
                        payload.relationTexts.length ? `Relations:\n${payload.relationTexts.join('\n\n')}` : '',
                        payload.charStateTexts.length ? `Character States:\n${payload.charStateTexts.join('\n\n')}` : '',
                        payload.worldStatePrompt ? `World State:\n${payload.worldStatePrompt}` : '',
                        payload.recentTurns.length ? `Recent Turns:\n${payload.recentTurns.join('\n')}` : '',
                        payload.memoryEntries.length ? `Important Memories:\n- ${payload.memoryEntries.join('\n- ')}` : '',
                        payload.loreSnippets.length ? `Lorebook Hints:\n- ${payload.loreSnippets.join('\n- ')}` : ''
                    ].filter(Boolean).join('\n\n');
                    const result = await runMaintenanceLLM(
                        () => LLMProvider.call(config, system, user, { maxTokens: 700, profile: 'aux' }),
                        `story-author-${currentTurn}`
                    );
                    const parsed = parseLooseJson(result?.content || '');
                    if (parsed) nextPlan = parsed;
                } catch (e) {
                    console.warn('[LIBRA] Story author planning failed:', e?.message);
                }
            }

            if (!nextPlan) nextPlan = buildHeuristicPlan(payload, mode);

            authorState = {
                ...authorState,
                currentArc: String(nextPlan.currentArc || authorState.currentArc || '').trim(),
                narrativeGoal: String(nextPlan.narrativeGoal || authorState.narrativeGoal || '').trim(),
                activeTensions: Array.isArray(nextPlan.activeTensions) ? nextPlan.activeTensions.slice(0, 6) : (authorState.activeTensions || []),
                nextBeats: Array.isArray(nextPlan.nextBeats) ? nextPlan.nextBeats.slice(0, 6) : (authorState.nextBeats || []),
                guardrails: Array.isArray(nextPlan.guardrails) ? nextPlan.guardrails.slice(0, 6) : (authorState.guardrails || []),
                focusCharacters: Array.isArray(nextPlan.focusCharacters) ? nextPlan.focusCharacters.slice(0, 6) : payload.focusedEntities,
                recentDecisions: [...(authorState.recentDecisions || []), ...(Array.isArray(nextPlan.recentDecisions) ? nextPlan.recentDecisions : [])].slice(-8),
                lastPlanTurn: currentTurn,
                lastUpdated: Date.now()
            };
        };

        const formatForPrompt = () => {
            if (!MemoryEngine.CONFIG.storyAuthorEnabled) return '';
            const parts = ['【스토리 작가 개입 / Story Author Guidance】'];
            const mode = String(MemoryEngine.CONFIG.storyAuthorMode || 'proactive').toLowerCase();
            if (mode === 'aggressive') {
                parts.push('LIBRA must actively drive the scene forward and avoid passive continuation.');
            } else if (mode === 'supportive') {
                parts.push('LIBRA should gently steer the scene while preserving user-led rhythm.');
            } else {
                parts.push('LIBRA should proactively shape the next beat while keeping continuity intact.');
            }
            if (authorState.autoAdvanceOnEmptyInput !== false) {
                parts.push('If the user input is empty, continue the current scene automatically and make at least one meaningful beat happen.');
            }
            if (authorState.currentArc) parts.push(`Current Arc: ${authorState.currentArc}`);
            if (authorState.narrativeGoal) parts.push(`Narrative Goal: ${authorState.narrativeGoal}`);
            if (authorState.focusCharacters?.length) parts.push(`Focus Characters: ${authorState.focusCharacters.join(', ')}`);
            if (authorState.activeTensions?.length) parts.push(`Active Tensions: ${authorState.activeTensions.join('; ')}`);
            if (authorState.nextBeats?.length) parts.push(`Next Beats: ${authorState.nextBeats.join('; ')}`);
            if (authorState.guardrails?.length) parts.push(`Guardrails: ${authorState.guardrails.join('; ')}`);
            parts.push('Advance at least one meaningful beat, reveal character through action/dialogue, and make full use of memory, relationships, world rules, and ongoing narrative context.');
            return parts.join('\n');
        };

        const getState = () => authorState;
        const resetState = () => {
            authorState = {
                currentArc: '',
                narrativeGoal: '',
                activeTensions: [],
                nextBeats: [],
                guardrails: [],
                focusCharacters: [],
                recentDecisions: [],
                autoAdvanceOnEmptyInput: true,
                lastPlanTurn: 0,
                lastUpdated: 0
            };
            return authorState;
        };

        return { loadState, saveState, updatePlanIfNeeded, formatForPrompt, getState, resetState };
    })();

    // ══════════════════════════════════════════════════════════════
    // [MANAGER] Director
    // ══════════════════════════════════════════════════════════════
    const Director = (() => {
        const DIRECTOR_COMMENT = 'lmai_director';

        let directorState = {
            sceneMandate: '',
            requiredOutcomes: [],
            forbiddenMoves: [],
            emphasis: [],
            targetPacing: 'steady',
            pressureLevel: 'strong',
            focusCharacters: [],
            lastTurn: 0,
            lastUpdated: 0
        };

        const loadState = (lorebook) => {
            const entry = lorebook.find(e => e.comment === DIRECTOR_COMMENT);
            if (entry) {
                try {
                    directorState = { ...directorState, ...JSON.parse(entry.content) };
                } catch (e) { console.warn('[LIBRA] Director state parse failed:', e?.message); }
            }
            return directorState;
        };

        const saveState = async (lorebook) => {
            const entry = {
                key: 'lmai_director::directive',
                comment: DIRECTOR_COMMENT,
                content: JSON.stringify(directorState),
                mode: 'normal',
                insertorder: 6,
                alwaysActive: false
            };
            const idx = lorebook.findIndex(e => e.comment === DIRECTOR_COMMENT);
            if (idx >= 0) lorebook[idx] = entry;
            else lorebook.push(entry);
        };

        const buildPayload = (turn, userMsg, aiResponse, involvedEntities = [], effectiveLore = []) => {
            const names = [...new Set((involvedEntities || []).map(e => typeof e === 'string' ? e : e?.name).filter(Boolean))];
            const entityCache = Array.from(EntityManager.getEntityCache().values());
            const focusedEntities = names.length > 0
                ? entityCache.filter(entity => names.includes(entity.name))
                : entityCache.slice(0, 4);
            const recentTurns = (NarrativeTracker.getState()?.turnLog || []).slice(-8)
                .map(t => `Turn ${t.turn}: ${t.userAction} -> ${t.response}`);
            const memoryEntries = MemoryEngine.getManagedEntries(effectiveLore)
                .map(entry => ({ entry, meta: MemoryEngine.getCachedMeta(entry) }))
                .sort((a, b) => (b.meta.imp - a.meta.imp) || (b.meta.t - a.meta.t))
                .slice(0, 6)
                .map(({ entry }) => (entry.content || '').replace(MemoryEngine.META_PATTERN, '').trim().slice(0, 180));

            return {
                turn,
                userMsg,
                aiResponse,
                isEmptyInput: !String(userMsg || '').trim(),
                focusedEntities: focusedEntities.map(e => e.name),
                worldPrompt: HierarchicalWorldManager.formatForPrompt(),
                worldStatePrompt: WorldStateTracker.formatForPrompt(),
                narrativePrompt: NarrativeTracker.formatForPrompt(),
                storyAuthorPrompt: StoryAuthor.formatForPrompt(),
                recentTurns,
                memoryEntries
            };
        };

        const buildHeuristicDirective = (payload, mode) => {
            const focus = payload.focusedEntities.slice(0, 4);
            const requiredOutcomes = [];
            const forbiddenMoves = [
                'Do not end the response in a static holding pattern.',
                'Do not contradict established world rules, relationships, or known facts.'
            ];
            const emphasis = [
                'Prioritize concrete action, consequence, or decision over exposition.',
                'Make at least one visible shift in tension, information, or relationship state.'
            ];

            if (focus.length > 0) {
                requiredOutcomes.push(`At least one of ${focus.join(', ')} must take a decisive action.`);
            } else {
                requiredOutcomes.push('Someone in the current scene must trigger a concrete change before the response ends.');
            }
            if (payload.worldStatePrompt) {
                requiredOutcomes.push('Use the current world state as active pressure on the scene.');
            }
            if (payload.isEmptyInput) {
                requiredOutcomes.push('Continue the scene without waiting for user input and force one meaningful beat.');
            }

            let targetPacing = 'steady';
            let pressureLevel = 'standard';
            let sceneMandate = 'Drive the scene forward with a clear, consequential beat.';
            if (mode === 'light') {
                targetPacing = 'measured';
                pressureLevel = 'light';
                sceneMandate = 'Gently steer the scene toward a meaningful next beat without overwhelming the current tone.';
            } else if (mode === 'strong') {
                targetPacing = 'brisk';
                pressureLevel = 'strong';
                sceneMandate = 'Actively force a meaningful turn in the scene and avoid passive continuation.';
            } else if (mode === 'absolute') {
                targetPacing = 'relentless';
                pressureLevel = 'absolute';
                sceneMandate = 'Override passivity. The response must create an unmistakable narrative change this turn.';
                forbiddenMoves.push('Do not resolve the turn with pure atmosphere, repetition, or non-committal dialogue.');
            }

            return {
                sceneMandate,
                requiredOutcomes,
                forbiddenMoves,
                emphasis,
                targetPacing,
                pressureLevel,
                focusCharacters: focus
            };
        };

        const updateDirective = async (currentTurn, config, userMsg, aiResponse, involvedEntities = [], effectiveLore = []) => {
            if (!config.directorEnabled) return;

            const payload = buildPayload(currentTurn, userMsg, aiResponse, involvedEntities, effectiveLore);
            const mode = String(config.directorMode || 'strong').toLowerCase();
            let nextDirective = null;

            if (LLMProvider.isConfigured(config, 'aux')) {
                try {
                    const system = [
                        'You are LIBRA Director, the highest-priority scene supervisor inside the memory engine.',
                        'You intervene every turn and produce firm scene-direction rules for the next response.',
                        'Focus on directorial control: pacing, mandatory beats, forbidden moves, and pressure.',
                        'Do not write prose. Do not summarize vaguely. Create forceful, actionable supervision.',
                        'Respond only as JSON: {"sceneMandate":"","requiredOutcomes":[""],"forbiddenMoves":[""],"emphasis":[""],"targetPacing":"","pressureLevel":"","focusCharacters":[""]}'
                    ].join('\n');
                    const user = [
                        `Mode: ${mode}`,
                        `Turn: ${currentTurn}`,
                        payload.userMsg ? `User Input:\n${payload.userMsg}` : 'User Input: (empty)',
                        payload.aiResponse ? `Latest Response:\n${payload.aiResponse}` : '',
                        payload.worldPrompt ? `World:\n${payload.worldPrompt}` : '',
                        payload.worldStatePrompt ? `World State:\n${payload.worldStatePrompt}` : '',
                        payload.narrativePrompt ? `Narrative:\n${payload.narrativePrompt}` : '',
                        payload.storyAuthorPrompt ? `Story Author:\n${payload.storyAuthorPrompt}` : '',
                        payload.recentTurns.length ? `Recent Turns:\n${payload.recentTurns.join('\n')}` : '',
                        payload.memoryEntries.length ? `Important Memories:\n- ${payload.memoryEntries.join('\n- ')}` : '',
                        payload.focusedEntities.length ? `Focus Characters:\n${payload.focusedEntities.join(', ')}` : ''
                    ].filter(Boolean).join('\n\n');
                    const result = await runMaintenanceLLM(
                        () => LLMProvider.call(config, system, user, { maxTokens: 650, profile: 'aux' }),
                        `director-${currentTurn}`
                    );
                    const parsed = parseLooseJson(result?.content || '');
                    if (parsed) nextDirective = parsed;
                } catch (e) {
                    console.warn('[LIBRA] Director planning failed:', e?.message);
                }
            }

            if (!nextDirective) nextDirective = buildHeuristicDirective(payload, mode);

            directorState = {
                ...directorState,
                sceneMandate: String(nextDirective.sceneMandate || directorState.sceneMandate || '').trim(),
                requiredOutcomes: Array.isArray(nextDirective.requiredOutcomes) ? nextDirective.requiredOutcomes.slice(0, 6) : (directorState.requiredOutcomes || []),
                forbiddenMoves: Array.isArray(nextDirective.forbiddenMoves) ? nextDirective.forbiddenMoves.slice(0, 6) : (directorState.forbiddenMoves || []),
                emphasis: Array.isArray(nextDirective.emphasis) ? nextDirective.emphasis.slice(0, 6) : (directorState.emphasis || []),
                targetPacing: String(nextDirective.targetPacing || directorState.targetPacing || 'steady').trim(),
                pressureLevel: String(nextDirective.pressureLevel || directorState.pressureLevel || mode).trim(),
                focusCharacters: Array.isArray(nextDirective.focusCharacters) ? nextDirective.focusCharacters.slice(0, 6) : payload.focusedEntities,
                lastTurn: currentTurn,
                lastUpdated: Date.now()
            };
        };

        const formatForPrompt = () => {
            if (!MemoryEngine.CONFIG.directorEnabled) return '';
            const mode = String(MemoryEngine.CONFIG.directorMode || 'strong').toLowerCase();
            const parts = ['【감독 개입 / Director Supervision】'];
            if (mode === 'light') {
                parts.push('Apply light but persistent guidance to keep the scene moving.');
            } else if (mode === 'absolute') {
                parts.push('This is top-priority direction. The response must obey it and create a strong narrative turn now.');
            } else if (mode === 'strong') {
                parts.push('Apply strong directorial control and force a meaningful beat in this response.');
            } else {
                parts.push('Apply firm directorial guidance in this response.');
            }
            if (directorState.sceneMandate) parts.push(`Scene Mandate: ${directorState.sceneMandate}`);
            if (directorState.focusCharacters?.length) parts.push(`Focus Characters: ${directorState.focusCharacters.join(', ')}`);
            if (directorState.targetPacing) parts.push(`Target Pacing: ${directorState.targetPacing}`);
            if (directorState.pressureLevel) parts.push(`Pressure Level: ${directorState.pressureLevel}`);
            if (directorState.requiredOutcomes?.length) parts.push(`Required Outcomes: ${directorState.requiredOutcomes.join('; ')}`);
            if (directorState.forbiddenMoves?.length) parts.push(`Forbidden Moves: ${directorState.forbiddenMoves.join('; ')}`);
            if (directorState.emphasis?.length) parts.push(`Emphasis: ${directorState.emphasis.join('; ')}`);
            parts.push('Treat these instructions as higher priority than passive continuation. The response must create visible movement in plot, tension, or relationship state this turn.');
            return parts.join('\n');
        };

        const getState = () => directorState;
        const resetState = () => {
            directorState = {
                sceneMandate: '',
                requiredOutcomes: [],
                forbiddenMoves: [],
                emphasis: [],
                targetPacing: 'steady',
                pressureLevel: 'strong',
                focusCharacters: [],
                lastTurn: 0,
                lastUpdated: 0
            };
            return directorState;
        };

        return { loadState, saveState, updateDirective, formatForPrompt, getState, resetState };
    })();

    // ══════════════════════════════════════════════════════════════
    // [MANAGER] Character State Tracker
    // ══════════════════════════════════════════════════════════════
    const CharacterStateTracker = (() => {
        const STATE_COMMENT = 'lmai_char_states';
        const CONSOLIDATION_INTERVAL = 5;

        let stateHistory = {};

        const loadState = (lorebook) => {
            const entry = lorebook.find(e => e.comment === STATE_COMMENT);
            if (entry) {
                try { stateHistory = JSON.parse(entry.content); } catch (e) { console.warn('[LIBRA] Char state parse failed:', e?.message); }
            }
            return stateHistory;
        };

        const saveState = async (lorebook) => {
            const entry = {
                key: LibraLoreKeys.charStates(),
                comment: STATE_COMMENT,
                content: JSON.stringify(stateHistory),
                mode: 'normal',
                insertorder: 6,
                alwaysActive: false
            };
            const idx = lorebook.findIndex(e => e.comment === STATE_COMMENT);
            if (idx >= 0) lorebook[idx] = entry;
            else lorebook.push(entry);
        };

        const recordState = (entityName, turn, stateSnapshot) => {
            if (!stateHistory[entityName]) {
                stateHistory[entityName] = { turnLog: [], consolidated: [], lastConsolidationTurn: 0 };
            }
            const history = stateHistory[entityName];
            history.turnLog.push({
                turn,
                timestamp: Date.now(),
                location: stateSnapshot.currentLocation || '',
                mood: stateSnapshot.currentMood || '',
                health: stateSnapshot.healthStatus || '',
                notes: stateSnapshot.notes || ''
            });
            if (history.turnLog.length > 30) {
                history.turnLog = history.turnLog.slice(-30);
            }
        };

        const recordCriticalMoment = (entityName, turn, description) => {
            if (!stateHistory[entityName]) {
                stateHistory[entityName] = { turnLog: [], consolidated: [], lastConsolidationTurn: 0 };
            }
            stateHistory[entityName].consolidated.push({
                turn,
                type: 'critical',
                description,
                timestamp: Date.now()
            });
        };

        const consolidateIfNeeded = async (entityName, currentTurn, config) => {
            const history = stateHistory[entityName];
            if (!history) return;
            if (currentTurn - history.lastConsolidationTurn < CONSOLIDATION_INTERVAL) return;

            const recentLogs = history.turnLog.filter(
                t => t.turn > history.lastConsolidationTurn
            );
            if (recentLogs.length < 3) return;

            if (LLMProvider.isConfigured(config, 'aux')) {
                try {
                    const logText = recentLogs.map(l =>
                        `Turn ${l.turn}: Location=${l.location}, Mood=${l.mood}, Health=${l.health}${l.notes ? ', Notes=' + l.notes : ''}`
                    ).join('\n');

                    const result = await runMaintenanceLLM(() =>
                        LLMProvider.call(config,
                            'Summarize the character state changes below. Note significant changes. Respond in the same language as the content.\nOutput JSON: {"summary": "...", "significantChanges": ["..."]}',
                            `Character: ${entityName}\nState log:\n${logText}`,
                            { maxTokens: 300, profile: 'aux' }
                        )
                    , `char-state-${entityName}`);

                    if (result.content) {
                        const cleanedContent = Utils.stripLLMThinkingTags(result.content);
                        const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            const parsed = JSON.parse(jsonMatch[0]);
                            history.consolidated.push({
                                turn: currentTurn,
                                type: 'periodic',
                                description: parsed.summary || '',
                                changes: parsed.significantChanges || [],
                                timestamp: Date.now()
                            });
                        }
                    }
                    history.lastConsolidationTurn = currentTurn;
                } catch (e) {
                    console.warn('[LIBRA] Char state consolidation failed:', e?.message);
                }
            } else {
                const last = recentLogs[recentLogs.length - 1];
                history.consolidated.push({
                    turn: currentTurn,
                    type: 'periodic',
                    description: `Location: ${last.location}, Mood: ${last.mood}, Health: ${last.health}`,
                    changes: [],
                    timestamp: Date.now()
                });
                history.lastConsolidationTurn = currentTurn;
            }

            if (history.consolidated.length > 20) {
                history.consolidated = history.consolidated.slice(-20);
            }
        };

        const isCriticalMoment = (entityName, newState) => {
            const history = stateHistory[entityName];
            if (!history || history.turnLog.length === 0) return false;
            const last = history.turnLog[history.turnLog.length - 1];
            if (last.health && newState.healthStatus && last.health !== newState.healthStatus) return true;
            if (last.location && newState.currentLocation && last.location !== newState.currentLocation) return true;
            return false;
        };

        const formatForPrompt = (entityName) => {
            const history = stateHistory[entityName];
            if (!history) return '';
            const parts = [];

            if (history.consolidated.length > 0) {
                const lastConsolidated = history.consolidated[history.consolidated.length - 1];
                parts.push(`  State History: ${lastConsolidated.description}`);
            }

            const recent = history.turnLog.slice(-3);
            if (recent.length > 0) {
                const stateStr = recent.map(l => {
                    const segments = [];
                    if (l.location) segments.push(l.location);
                    if (l.mood) segments.push(l.mood);
                    if (l.health) segments.push(l.health);
                    return `T${l.turn}: ${segments.join(', ')}`;
                }).join(' → ');
                parts.push(`  Recent States: ${stateStr}`);
            }

            return parts.join('\n');
        };

        const getState = () => stateHistory;
        const resetState = (nextState = null) => {
            stateHistory = nextState ? safeClone(nextState) : {};
            return stateHistory;
        };

        return { loadState, saveState, recordState, recordCriticalMoment, consolidateIfNeeded, isCriticalMoment, formatForPrompt, getState, resetState };
    })();

    // ══════════════════════════════════════════════════════════════
    // [MANAGER] World State Tracker
    // ══════════════════════════════════════════════════════════════
    const WorldStateTracker = (() => {
        const STATE_COMMENT = 'lmai_world_states';
        const CONSOLIDATION_INTERVAL = 5;

        let stateHistory = { turnLog: [], consolidated: [], lastConsolidationTurn: 0 };

        const loadState = (lorebook) => {
            const entry = lorebook.find(e => e.comment === STATE_COMMENT);
            if (entry) {
                try { stateHistory = JSON.parse(entry.content); } catch (e) { console.warn('[LIBRA] World state parse failed:', e?.message); }
            }
            return stateHistory;
        };

        const saveState = async (lorebook) => {
            const entry = {
                key: LibraLoreKeys.worldStates(),
                comment: STATE_COMMENT,
                content: JSON.stringify(stateHistory),
                mode: 'normal',
                insertorder: 7,
                alwaysActive: false
            };
            const idx = lorebook.findIndex(e => e.comment === STATE_COMMENT);
            if (idx >= 0) lorebook[idx] = entry;
            else lorebook.push(entry);
        };

        const recordState = (turn, worldSnapshot) => {
            stateHistory.turnLog.push({
                turn,
                timestamp: Date.now(),
                activeWorld: worldSnapshot.activePath || [],
                rulesSnapshot: worldSnapshot.rules || {},
                globalFlags: worldSnapshot.global || {},
                notes: worldSnapshot.notes || ''
            });
            if (stateHistory.turnLog.length > 30) {
                stateHistory.turnLog = stateHistory.turnLog.slice(-30);
            }
        };

        const recordCriticalMoment = (turn, description) => {
            stateHistory.consolidated.push({
                turn,
                type: 'critical',
                description,
                timestamp: Date.now()
            });
        };

        const consolidateIfNeeded = async (currentTurn, config) => {
            if (currentTurn - stateHistory.lastConsolidationTurn < CONSOLIDATION_INTERVAL) return;
            const recentLogs = stateHistory.turnLog.filter(t => t.turn > stateHistory.lastConsolidationTurn);
            if (recentLogs.length < 3) return;

            if (LLMProvider.isConfigured(config, 'aux')) {
                try {
                    const logText = recentLogs.map(l =>
                        `Turn ${l.turn}: World=${(l.activeWorld||[]).join('→')}, Notes=${l.notes||'none'}`
                    ).join('\n');

                    const result = await runMaintenanceLLM(() =>
                        LLMProvider.call(config,
                            'Summarize world state changes below. Note dimension shifts and rule changes. Respond in the same language as the content.\nOutput JSON: {"summary": "...", "significantChanges": ["..."]}',
                            `World state log:\n${logText}`,
                            { maxTokens: 300, profile: 'aux' }
                        )
                    , `world-state-${currentTurn}`);

                    if (result.content) {
                        const cleanedContent = Utils.stripLLMThinkingTags(result.content);
                        const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            const parsed = JSON.parse(jsonMatch[0]);
                            stateHistory.consolidated.push({
                                turn: currentTurn,
                                type: 'periodic',
                                description: parsed.summary || '',
                                changes: parsed.significantChanges || [],
                                timestamp: Date.now()
                            });
                        }
                    }
                    stateHistory.lastConsolidationTurn = currentTurn;
                } catch (e) {
                    console.warn('[LIBRA] World state consolidation failed:', e?.message);
                }
            } else {
                const last = recentLogs[recentLogs.length - 1];
                stateHistory.consolidated.push({
                    turn: currentTurn,
                    type: 'periodic',
                    description: `World: ${(last.activeWorld||[]).join('→')}`,
                    changes: [],
                    timestamp: Date.now()
                });
                stateHistory.lastConsolidationTurn = currentTurn;
            }

            if (stateHistory.consolidated.length > 20) {
                stateHistory.consolidated = stateHistory.consolidated.slice(-20);
            }
        };

        const isCriticalMoment = (newWorldState) => {
            if (stateHistory.turnLog.length === 0) return false;
            const last = stateHistory.turnLog[stateHistory.turnLog.length - 1];
            const lastPath = (last.activeWorld || []).join(',');
            const newPath = (newWorldState.activePath || []).join(',');
            return lastPath !== newPath;
        };

        const formatForPrompt = () => {
            const parts = [];
            if (stateHistory.consolidated.length > 0) {
                const lastC = stateHistory.consolidated[stateHistory.consolidated.length - 1];
                parts.push(`World History: ${lastC.description}`);
            }
            const recent = stateHistory.turnLog.slice(-3);
            if (recent.length > 0) {
                parts.push(`Recent: ${recent.map(l => `T${l.turn}: ${(l.activeWorld||[]).slice(-1).join('')}${l.notes ? '(' + l.notes + ')' : ''}`).join(' → ')}`);
            }
            return parts.join('\n');
        };

        const getState = () => stateHistory;
        const resetState = (nextState = null) => {
            stateHistory = nextState ? safeClone(nextState) : { turnLog: [], consolidated: [], lastConsolidationTurn: 0 };
            return stateHistory;
        };

        return { loadState, saveState, recordState, recordCriticalMoment, consolidateIfNeeded, isCriticalMoment, formatForPrompt, getState, resetState };
    })();

    // ══════════════════════════════════════════════════════════════
    // [MANAGER] Memory Engine
    // ══════════════════════════════════════════════════════════════
    const MemoryEngine = (() => {
        const CONFIG = {
            memoryPreset: 'general',
            maxLimit: MEMORY_PRESETS.general.maxLimit,
            threshold: MEMORY_PRESETS.general.threshold,
            simThreshold: MEMORY_PRESETS.general.simThreshold,
            gcBatchSize: MEMORY_PRESETS.general.gcBatchSize,
            coldStartScopePreset: 'partial_100',
            coldStartHistoryLimit: 100,
            tokenizerType: 'simple',
            weightMode: 'auto',
            weights: { importance: 0.3, similarity: 0.5, recency: 0.2 },
            debug: false,
            useLLM: true,
            cbsEnabled: true,
            emotionEnabled: true,
            storyAuthorEnabled: true,
            storyAuthorMode: 'proactive',
            directorEnabled: true,
            directorMode: 'strong',
            worldAdjustmentMode: 'dynamic',
            llm: { provider: 'openai', url: '', key: '', model: 'gpt-4o-mini', temp: 0.3, timeout: 120000, reasoningEffort: 'none', reasoningBudgetTokens: 0 },
            auxLlm: { enabled: false, provider: 'openai', url: '', key: '', model: 'gpt-4o-mini', temp: 0.2, timeout: 90000, reasoningEffort: 'none', reasoningBudgetTokens: 0 },
            embed: { provider: 'openai', url: '', key: '', model: 'text-embedding-3-small', timeout: 120000 }
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
            action: ['공격', '회피', '기습', '위험', '비명', '달려', '총', '검', '폭발', 'attack', 'dodge', 'ambush', 'danger', 'scream', 'run', 'gun', 'sword', 'explosion', 'fight', 'battle', 'combat'],
            romance: ['사랑', '좋아', '키스', '안아', '입술', '눈물', '손잡', '두근', '설레', 'love', 'like', 'kiss', 'hug', 'lips', 'tears', 'hold hands', 'heartbeat', 'flutter', 'romance', 'affection'],
            mystery: ['단서', '증거', '범인', '비밀', '거짓말', '수상', '추리', '의심', 'clue', 'evidence', 'culprit', 'secret', 'lie', 'suspicious', 'detective', 'suspect', 'mystery', 'investigate'],
            daily: ['밥', '날씨', '오늘', '일상', '학교', '회사', '집에', '친구', 'food', 'weather', 'today', 'daily', 'school', 'work', 'home', 'friend', 'routine', 'morning']
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
                const mapping = { affection: 'romance', sadness: 'romance', anger: 'action', fear: 'mystery', joy: 'daily', surprise: 'mystery', disgust: 'mystery' };
                for (const [emotionName, emotionScore] of Object.entries(emotion.scores || {})) {
                    if (!emotionScore) continue;
                    const mappedGenre = mapping[emotionName];
                    if (!mappedGenre) continue;
                    scores[mappedGenre] += Math.min(1, emotionScore / 3);
                }
                if (CONFIG.debug) {
                    console.log('[LIBRA] Emotion analysis:', {
                        dominant: emotion.dominant,
                        intensity: emotion.intensity,
                        scores: emotion.scores
                    });
                }
            }

            const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
            if (top[1] < 1) return null;

            return WEIGHT_MODE_PRESETS[top[0]];
        };

        const calculateDynamicWeights = (query) => detectGenreWeights(query) || CONFIG.weights;
        const _log = (msg) => { if (CONFIG.debug) console.log(`[LIBRA] ${msg}`); };
        const getSafeKey = (entry) => entry.id || TokenizerEngine.getSafeMapKey(entry.content || "");
        let lastRetrievalDebug = null;

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

            const engine = EmbeddingEngine;
            if (!engine || typeof engine.getEmbedding !== 'function' || typeof engine.cosineSimilarity !== 'function') {
                simCache.set(cKey, jaccard);
                return jaccard;
            }

            const vecA = await engine.getEmbedding(textA);
            const vecB = await engine.getEmbedding(textB);
            const score = (vecA && vecB) ? engine.cosineSimilarity(vecA, vecB) * 0.7 + jaccard * 0.3 : jaccard;
            simCache.set(cKey, score);
            return score;
        };

        const calcRecency = (turn, current) => Math.exp(-Math.max(0, current - turn) / 20);
        const normalizeLoreKeywords = (raw) => {
            if (Array.isArray(raw)) return raw.map(v => String(v || '').trim()).filter(Boolean);
            return String(raw || '')
                .split(/[\n,|]/g)
                .map(v => v.trim())
                .filter(Boolean);
        };

        const isStandardLoreActive = (entry, text) => {
            if (!entry) return false;
            if (entry.alwaysActive) return true;

            const primary = normalizeLoreKeywords(entry.key);
            const secondary = normalizeLoreKeywords(entry.secondkey);
            const keywords = [...new Set([...primary, ...secondary])];
            if (keywords.length === 0) return true;

            const haystack = String(text || '').toLowerCase();
            const matches = (keyword) => haystack.includes(String(keyword || '').toLowerCase());
            const mode = String(entry.mode || '').toLowerCase();

            if (mode.includes('and')) return keywords.every(matches);
            if (mode.includes('not')) return keywords.every(keyword => !matches(keyword));
            return keywords.some(matches);
        };

        const prefilterStandardLore = (query, entries, limit = 24) => {
            const queryTokens = new Set(TokenizerEngine.tokenize(query || ''));
            const scored = (Array.isArray(entries) ? entries : []).map((entry) => {
                const keys = normalizeLoreKeywords(entry.key).concat(normalizeLoreKeywords(entry.secondkey));
                const keyTokens = new Set(keys.flatMap(token => TokenizerEngine.tokenize(token)));
                const contentTokens = new Set(TokenizerEngine.tokenize(entry.content || ''));
                let keyOverlap = 0;
                let contentOverlap = 0;
                queryTokens.forEach((token) => {
                    if (keyTokens.has(token)) keyOverlap++;
                    if (contentTokens.has(token)) contentOverlap++;
                });
                const score = (keyOverlap * 4) + contentOverlap + (entry.alwaysActive ? 0.25 : 0);
                return { entry, score };
            });

            return scored
                .sort((a, b) => b.score - a.score)
                .slice(0, Math.max(3, limit))
                .map(item => item.entry);
        };

        const isLibraManagedEntry = (entry) => Boolean(entry?.comment && String(entry.comment).startsWith('lmai_'));

        const getLoreSignature = (entry) => {
            return [
                entry?.comment || '',
                entry?.key || '',
                TokenizerEngine.simpleHash(entry?.content || '')
            ].join('::');
        };

        const getEffectiveLorebook = (char, chat) => {
            const globalLore = Array.isArray(char?.lorebook) ? char.lorebook : [];
            const localLore = Array.isArray(chat?.localLore) ? chat.localLore : [];
            if (localLore.length === 0) return globalLore;
            if (globalLore.length === 0) return localLore;

            const merged = [];
            const seen = new Set();
            const mark = (entry) => {
                const key = getLoreSignature(entry);
                if (seen.has(key)) return;
                seen.add(key);
                merged.push(entry);
            };

            globalLore.forEach(mark);
            localLore.forEach(mark);
            return merged;
        };

        const normalizeLoreStorage = async (char, chat) => {
            const globalLore = Array.isArray(char?.lorebook) ? char.lorebook : null;
            const localLore = Array.isArray(chat?.localLore) ? chat.localLore : null;
            if (!globalLore || !localLore) return false;

            const globalLibra = globalLore.filter(isLibraManagedEntry);
            if (globalLibra.length === 0) return false;

            const localSeen = new Set(localLore.map(getLoreSignature));
            const migrated = [];
            for (const entry of globalLibra) {
                const signature = getLoreSignature(entry);
                if (localSeen.has(signature)) continue;
                localSeen.add(signature);
                migrated.push(entry);
            }

            char.lorebook = globalLore.filter(entry => !isLibraManagedEntry(entry));
            if (migrated.length > 0) {
                chat.localLore = [...localLore, ...migrated];
            }
            return migrated.length > 0 || globalLibra.length > 0;
        };

        const EmbeddingEngine = (() => {
            const debugStats = {
                totalCalls: 0,
                cacheHits: 0,
                providerCalls: 0,
                lastProvider: '',
                lastModel: '',
                lastDims: 0,
                lastStatus: 'idle'
            };
            return {
                getEmbedding: async (text) => {
                    debugStats.totalCalls += 1;
                    const cache = getSimCache();
                    if (cache.has(text)) {
                        debugStats.cacheHits += 1;
                        debugStats.lastProvider = CONFIG.embed?.provider || 'openai';
                        debugStats.lastModel = CONFIG.embed?.model || '';
                        debugStats.lastDims = Array.isArray(cache.get(text)) ? cache.get(text).length : 0;
                        debugStats.lastStatus = 'cache-hit';
                        if (CONFIG.debug) {
                            console.log(`[LIBRA][EMBED] cache-hit | provider=${CONFIG.embed?.provider || 'openai'} | model=${CONFIG.embed?.model || ''} | chars=${String(text || '').length}`);
                        }
                        return Promise.resolve(cache.get(text));
                    }
                    return EmbeddingQueue.enqueue(async () => {
                        const m = CONFIG.embed;
                        if (!m?.url || !m?.key) return null;

                        try {
                            const providerName = m.provider || 'openai';
                            const provider = AutoProvider.get(providerName);
                            debugStats.providerCalls += 1;
                            debugStats.lastProvider = providerName;
                            debugStats.lastModel = m.model || '';
                            debugStats.lastStatus = 'start';
                            const startAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                            if (CONFIG.debug) {
                                console.log(
                                    `[LIBRA][EMBED] start | provider=${providerName} | model=${m.model || ''} | url=${m.url || ''} | chars=${String(text || '').length} | queuePending=${EmbeddingQueue.pendingCount || 0}`
                                );
                            }
                            const vec = await provider.getEmbedding(CONFIG, text);

                            if (vec) cache.set(text, vec);
                            debugStats.lastDims = Array.isArray(vec) ? vec.length : 0;
                            debugStats.lastStatus = vec ? 'success' : 'empty';
                            if (CONFIG.debug) {
                                const endAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                                console.log(
                                    `[LIBRA][EMBED] ${vec ? 'success' : 'empty'} | provider=${providerName} | duration=${Math.max(0, Math.round(endAt - startAt))}ms | dims=${Array.isArray(vec) ? vec.length : 0}`
                                );
                            }
                            return vec;
                        } catch (e) {
                            debugStats.lastStatus = 'error';
                            if (CONFIG.debug) console.warn('[LIBRA] Embedding Error:', e?.message || e);
                            return null;
                        }
                    });
                },
                getDebugSnapshot: () => ({ ...debugStats }),
                cosineSimilarity: (a, b) => {
                    if (!a || !b || a.length !== b.length) return 0;
                    let dot = 0, normA = 0, normB = 0;
                    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i]; }
                    return (normA && normB) ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
                }
            };
        })();

        const formatMemories = (memories) => {
            if (!memories || memories.length === 0) return '';
            return memories.map((m, i) => {
                const meta = getCachedMeta(m);
                const content = (m.content || "").replace(META_PATTERN, '').trim();
                const originLabel = meta.source === 'narrative_source_record' ? '서사 근거 원문' : '원문 기억';
                return`[${i + 1}] (${originLabel} / 중요도:${meta.imp}/10) ${content.slice(0, 140)}`;
            }).join('\n');
        };

        const incrementalGC = (allEntries, currentTurn) => {
            const toDelete = new Set();
            if (allEntries.length === 0) return { entries: allEntries, deleted: 0 };

            // TTL 검사는 lmai_memory 엔트리만 대상으로 함 (시스템 엔트리 보호)
            const memoryEntries = allEntries.filter(e => e.comment === 'lmai_memory');
            if (memoryEntries.length > 0) {
                for (let i = 0; i < CONFIG.gcBatchSize; i++) {
                    const idx = (MemoryState.gcCursor + i) % memoryEntries.length;
                    const entry = memoryEntries[idx];
                    const meta = getCachedMeta(entry);
                    const ttl = Number(meta.ttl);
                    const turn = Number(meta.t);
                    if (ttl !== -1 && Number.isFinite(turn) && Number.isFinite(ttl) && (turn + ttl) < currentTurn) {
                        toDelete.add(getSafeKey(entry));
                    }
                }
                MemoryState.gcCursor = (MemoryState.gcCursor + CONFIG.gcBatchSize) % Math.max(1, memoryEntries.length);
            }

            const managed = memoryEntries;
            if (managed.length > CONFIG.maxLimit) {
                const overflowCount = managed.length - CONFIG.maxLimit;
                const ranked = [...managed].sort((a, b) => {
                    const metaA = getCachedMeta(a);
                    const metaB = getCachedMeta(b);
                    const belowThresholdA = (metaA.imp || 0) < CONFIG.threshold ? 0 : 1;
                    const belowThresholdB = (metaB.imp || 0) < CONFIG.threshold ? 0 : 1;
                    if (belowThresholdA !== belowThresholdB) return belowThresholdA - belowThresholdB;
                    if ((metaA.imp || 0) !== (metaB.imp || 0)) return (metaA.imp || 0) - (metaB.imp || 0);
                    return (metaA.t || 0) - (metaB.t || 0);
                });
                ranked
                    .slice(0, overflowCount)
                    .forEach(e => toDelete.add(getSafeKey(e)));
            }

            if (toDelete.size > 0) {
                MemoryState.hashIndex.forEach(set => toDelete.forEach(item => set.delete(item)));
                const emptyKeys = [];
                MemoryState.hashIndex.forEach((set, key) => { if (set.size === 0) emptyKeys.push(key); });
                emptyKeys.forEach(key => MemoryState.hashIndex.delete(key));
                return { entries: allEntries.filter(e => !toDelete.has(getSafeKey(e))), deleted: toDelete.size };
            }
            return { entries: allEntries, deleted: 0 };
        };

        return {
            CONFIG, getSafeKey, getCachedMeta, calcRecency, EmbeddingEngine, EmotionEngine,
            TokenizerEngine, formatMemories, incrementalGC, META_PATTERN, parseMeta,

            rebuildIndex: (lorebook) => {
                _log("Rebuilding Hash Index...");
                MemoryState.hashIndex.clear();
                const entries = Array.isArray(lorebook) ? lorebook : [];
                entries.forEach(entry => {
                    if (entry.comment === 'lmai_memory') {
                        try {
                            const content = Utils.getMemorySourceText((entry.content || "").replace(META_PATTERN, ''));
                            if (content.length < 5) return;
                            if (Utils.shouldExcludeStoredMemoryContent(content)) return;
                            const key = getSafeKey(entry);
                            const idxKey = TokenizerEngine.getIndexKey(content);
                            if (!MemoryState.hashIndex.has(idxKey)) MemoryState.hashIndex.set(idxKey, new Set());
                            MemoryState.hashIndex.get(idxKey).add(key);
                        } catch (e) {
                            if (CONFIG.debug) {
                                console.warn('[LIBRA] rebuildIndex entry error:', e?.message);
                            }
                        }
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
                    const existingContent = Utils.getMemorySourceText((item.content || "").replace(META_PATTERN, ''));
                    if (!existingContent) continue;
                    if (Math.abs(existingContent.length - content.length) > content.length * 0.7) continue;
                    if (await calcSimilarity(existingContent, content) > 0.75) return true;
                }
                return false;
            },

            prepareMemory: async (data, currentTurn, existingList, lorebook, char, chat, m_id = null) => {
                const content = Utils.getMemorySourceText(data?.content || '');
                const importance = data?.importance;
                if (!content || content.length < 5) return null;
                if (Utils.shouldExcludeStoredMemoryContent(content)) return null;

                const managed = MemoryEngine.getManagedEntries(lorebook);
                if (managed.length >= Math.floor(CONFIG.maxLimit * 0.95)) {
                    _log(`Early GC: ${managed.length}/${CONFIG.maxLimit}`);
                    const gcResult = MemoryEngine.incrementalGC(lorebook, currentTurn);
                    if (gcResult.deleted > 0) {
                        _log(`GC removed ${gcResult.deleted} entries`);
                        lorebook.length = 0;
                        lorebook.push(...gcResult.entries);
                        MemoryEngine.rebuildIndex(lorebook);
                        if (char && chat !== undefined) MemoryEngine.setLorebook(char, chat, lorebook);
                    }
                }

                const updatedList = lorebook || existingList;
                if (await MemoryEngine.checkDuplication(content, updatedList)) return null;

                const imp = importance || 5;
                const ttl = imp >= Math.max(9, CONFIG.threshold + 2) ? -1 : (imp >= CONFIG.threshold ? 60 : 30);
                const meta = { 
                    t: currentTurn, ttl, imp, cat: 'personal', ent: [], 
                    summary: '',
                    source: 'narrative_source_record',
                    sourceHint: 'Used as source evidence for narrative summaries.',
                    s_id: MemoryState.currentSessionId,
                    m_id: m_id
                };

                const entryContent = `[META:${JSON.stringify(meta)}]\n${content}\n`;
                const strippedContent = entryContent.replace(META_PATTERN, '').trim();
                const idxKey = TokenizerEngine.getIndexKey(strippedContent);
                const safeKey = TokenizerEngine.getSafeMapKey(entryContent);
                if (!MemoryState.hashIndex.has(idxKey)) MemoryState.hashIndex.set(idxKey, new Set());
                MemoryState.hashIndex.get(idxKey).add(safeKey);

                return {
                    key: "", comment: 'lmai_memory',
                    content: entryContent,
                    mode: "normal", insertorder: 100, alwaysActive: false
                };
            },

            retrieveMemories: async (query, currentTurn, candidates, vars, topK = 15) => {
                const cleanQuery = query.trim();
                const queryTokens = TokenizerEngine.tokenize(cleanQuery);
                const W = calculateDynamicWeights(cleanQuery);
                const originalCandidateCount = Array.isArray(candidates) ? candidates.length : 0;
                
                let filtered = candidates.filter(entry => {
                    const meta = getCachedMeta(entry);
                    const ttl = Number(meta.ttl);
                    const turn = Number(meta.t);
                    if (!(ttl === -1 || (Number.isFinite(turn) && Number.isFinite(ttl) && (turn + ttl) >= currentTurn))) return false;
                    const content = Utils.getMemorySourceText((entry.content || "").replace(META_PATTERN, ''));
                    if (Utils.shouldExcludeStoredMemoryContent(content)) return false;
                    return true;
                });

                // Optimization: Pre-filter by keyword overlap if too many candidates,
                // but keep a recency/importance backstop so paraphrased RP recall
                // queries do not lose their best semantic matches before similarity.
                if (filtered.length > 50 && queryTokens.length >= 2) {
                    const ranked = filtered.map(entry => {
                        const content = Utils.getMemorySourceText((entry.content || "").replace(META_PATTERN, ''));
                        const contentTokens = new Set(TokenizerEngine.tokenize(content));
                        let overlap = 0;
                        for (const token of queryTokens) {
                            if (contentTokens.has(token)) overlap++;
                        }
                        const meta = getCachedMeta(entry);
                        const fallbackRank = (calcRecency(meta.t, currentTurn) * 0.6) + ((meta.imp / 10) * 0.4);
                        return { entry, overlap, fallbackRank };
                    });

                    const maxOverlap = ranked.reduce((max, item) => Math.max(max, item.overlap), 0);
                    if (maxOverlap > 0) {
                        const selected = new Set();
                        const overlapTop = ranked
                            .slice()
                            .sort((a, b) => b.overlap - a.overlap || b.fallbackRank - a.fallbackRank)
                            .slice(0, 60);
                        overlapTop.forEach(item => selected.add(item.entry));

                        const fallbackTop = ranked
                            .slice()
                            .sort((a, b) => b.fallbackRank - a.fallbackRank || b.overlap - a.overlap)
                            .slice(0, 20);
                        fallbackTop.forEach(item => selected.add(item.entry));

                        filtered = Array.from(selected);
                    }
                }

                let belowThresholdCount = 0;
                const scoredResults = await Promise.all(filtered.map(async (entry) => {
                    const meta = getCachedMeta(entry);
                    const text = Utils.getMemorySourceText((entry.content || "").replace(META_PATTERN, ''));
                    const sim = await calcSimilarity(cleanQuery, text);
                    const recency = calcRecency(meta.t, currentTurn);
                    const importance = (meta.imp / 10);
                    const score = (sim * W.similarity) + (recency * W.recency) + (importance * W.importance);
                    if (sim < CONFIG.simThreshold) {
                        belowThresholdCount += 1;
                        return {
                            entry,
                            accepted: false,
                            similarity: sim,
                            recency,
                            importance,
                            finalScore: score,
                            meta,
                            text
                        };
                    }
                    return {
                        entry: { ...entry, _score: score },
                        accepted: true,
                        similarity: sim,
                        recency,
                        importance,
                        finalScore: score,
                        meta,
                        text
                    };
                }));

                const accepted = scoredResults.filter(item => item && item.accepted).sort((a, b) => b.finalScore - a.finalScore);
                const selected = accepted.slice(0, topK).map(item => item.entry);
                lastRetrievalDebug = {
                    query: cleanQuery,
                    originalCandidates: originalCandidateCount,
                    filteredCandidates: filtered.length,
                    selectedCount: selected.length,
                    belowThresholdCount,
                    simThreshold: CONFIG.simThreshold,
                    threshold: CONFIG.threshold,
                    weights: { ...W },
                    topEntries: accepted.slice(0, Math.min(3, accepted.length)).map(item => ({
                        importance: Number(item.importance.toFixed(3)),
                        similarity: Number(item.similarity.toFixed(3)),
                        recency: Number(item.recency.toFixed(3)),
                        finalScore: Number(item.finalScore.toFixed(3)),
                        turn: item.meta?.t || 0,
                        preview: String(item.text || '').slice(0, 80)
                    }))
                };
                return selected;
            },

            getLorebook: (char, chat) => Array.isArray(chat?.localLore) ? chat.localLore : (Array.isArray(char?.lorebook) ? char.lorebook : []),
            getEffectiveLorebook,
            normalizeLoreStorage,
            isStandardLoreActive,
            prefilterStandardLore,
            setLorebook: (char, chat, data) => {
                if (Array.isArray(chat?.localLore)) chat.localLore = data;
                else if (Array.isArray(char?.lorebook)) char.lorebook = data;
                else if (chat) chat.localLore = data;
                else if (char) char.lorebook = data;
            },
            getManagedEntries: (lorebook) => (Array.isArray(lorebook) ? lorebook : []).filter(e => e.comment === 'lmai_memory'),
            getLastRetrievalDebug: () => lastRetrievalDebug ? safeClone(lastRetrievalDebug) : null,
            getCacheStats: () => ({ meta: getMetaCache().stats, sim: getSimCache().stats }),
            incrementTurn: () => { MemoryState.currentTurn++; return MemoryState.currentTurn; },
            getCurrentTurn: () => MemoryState.currentTurn,
            setTurn: (turn) => { MemoryState.currentTurn = turn; }
        };
    })();

    // ══════════════════════════════════════════════════════════════
    // [ENGINE] CBSEngine
    // ══════════════════════════════════════════════════════════════
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

        function readCbsTagAt(text, startIndex) {
            if (String(text || "").slice(startIndex, startIndex + 2) !== "{{") return null;
            let depth = 1, i = startIndex + 2;
            while (i < text.length) {
                const two = text.slice(i, i + 2);
                if (two === "{{") { depth += 1; i += 2; continue; }
                if (two === "}}") { depth -= 1; i += 2; if (depth === 0) return { start: startIndex, end: i, raw: text.slice(startIndex, i), inner: text.slice(startIndex + 2, i - 2) }; continue; }
                i += 1;
            }
            return null;
        }

        function findNextCbsTag(text, startIndex) {
            const src = String(text || "");
            for (let i = startIndex; i < src.length - 1; i += 1) { if (src[i] === "{" && src[i + 1] === "{") return readCbsTagAt(src, i); }
            return null;
        }

        function readBracketCbsExprAt(text, startIndex) {
            const src = String(text || "");
            if (src.slice(startIndex, startIndex + 10) !== "[CBS_EXPR:") return null;
            let i = startIndex + 10;
            while (i < src.length) {
                if (src[i] === "]") {
                    return {
                        start: startIndex,
                        end: i + 1,
                        raw: src.slice(startIndex, i + 1),
                        inner: src.slice(startIndex + 10, i)
                    };
                }
                i += 1;
            }
            return null;
        }

        function findNextBracketCbsExpr(text, startIndex) {
            const src = String(text || "");
            for (let i = startIndex; i < src.length - 9; i += 1) {
                if (src[i] === "[" && src.slice(i, i + 10) === "[CBS_EXPR:") return readBracketCbsExprAt(src, i);
            }
            return null;
        }

        function findNextAnyCbsToken(text, startIndex) {
            const curly = findNextCbsTag(text, startIndex);
            const bracket = findNextBracketCbsExpr(text, startIndex);
            if (!curly) return bracket;
            if (!bracket) return curly;
            return curly.start <= bracket.start ? curly : bracket;
        }

        function extractCbsBlock(text, startTag, blockName) {
            let depth = 1, cursor = startTag.end, elseTag = null;
            while (cursor < text.length) {
                const tag = findNextCbsTag(text, cursor);
                if (!tag) break;
                const inner = safeTrim(tag.inner);
                const opensSameBlock = inner.startsWith(`#${blockName} `) || inner.startsWith(`#${blockName}::`);
                const closesSameBlock = inner === `/${blockName}` || inner === "/";
                const isElseTag = inner === "else" || inner === ":else";
                if (opensSameBlock) depth += 1;
                else if (closesSameBlock) { depth -= 1; if (depth === 0) return { body: text.slice(startTag.end, elseTag ? elseTag.start : tag.start), elseBody: elseTag ? text.slice(elseTag.end, tag.start) : "", end: tag.end }; }
                else if (isElseTag && depth === 1 && (blockName === "if" || blockName === "when")) elseTag = tag;
                cursor = tag.end;
            }
            return { body: text.slice(startTag.end), elseBody: "", end: text.length };
        }

        function trimLegacyCbsBlockBody(text) {
            const src = String(text ?? "").replace(/^\n+|\n+$/g, "");
            return src.split(/\r?\n/g).map((line) => line.replace(/^\s+/, "")).join("\n");
        }

        async function evalStandaloneWhenCondition(rawCondition, runtime, args = []) {
            const tokens = splitTopLevelCbsByDoubleColon(String(rawCondition ?? ""));
            let mode = "default";
            if (tokens[0] && safeTrim(tokens[0]).toLowerCase() === "keep") {
                mode = "keep";
                tokens.shift();
            } else if (tokens[0] && safeTrim(tokens[0]).toLowerCase() === "legacy") {
                mode = "legacy";
                tokens.shift();
            }

            async function evalTokens(items) {
                const parts = items.map((item) => safeTrim(String(item ?? ""))).filter((item) => item.length > 0);
                if (parts.length === 0) return false;
                if (parts[0] === "not") return !(await evalTokens(parts.slice(1)));
                if ((parts[0] === "var" || parts[0] === "toggle") && parts.length >= 2) {
                    const value = await renderStandaloneCbsText(parts.slice(1).join("::"), runtime, args);
                    return isStandaloneCbsTruthy(value);
                }
                if (parts.length === 1) {
                    const value = await renderStandaloneCbsText(parts[0], runtime, args);
                    return isStandaloneCbsTruthy(value);
                }

                const left = await renderStandaloneCbsText(parts[0], runtime, args);
                const op = safeTrim(parts[1]).toLowerCase();
                if (op === "and") return isStandaloneCbsTruthy(left) && (await evalTokens(parts.slice(2)));
                if (op === "or") return isStandaloneCbsTruthy(left) || (await evalTokens(parts.slice(2)));

                const right = await renderStandaloneCbsText(parts[2] || "", runtime, args);
                const leftNum = Number(left), rightNum = Number(right);
                const isNumeric = !Number.isNaN(leftNum) && !Number.isNaN(rightNum);
                switch (op) {
                    case "is":
                    case "vis":
                    case "tis":
                    case "==":
                    case "equal":
                        return left === right;
                    case "isnot":
                    case "visnot":
                    case "tisnot":
                    case "!=":
                    case "notequal":
                    case "not_equal":
                        return left !== right;
                    case ">":
                    case "greater":
                        return isNumeric ? leftNum > rightNum : left > right;
                    case ">=":
                    case "greaterequal":
                    case "greater_equal":
                        return isNumeric ? leftNum >= rightNum : left >= right;
                    case "<":
                    case "less":
                        return isNumeric ? leftNum < rightNum : left < right;
                    case "<=":
                    case "lessequal":
                    case "less_equal":
                        return isNumeric ? leftNum <= rightNum : left <= right;
                    default:
                        return isStandaloneCbsTruthy(await renderStandaloneCbsText(parts.join("::"), runtime, args));
                }
            }

            return {
                truthy: await evalTokens(tokens),
                mode
            };
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
            if (!whitelistRegex.test(src) || blacklist.some(k => src.includes(k))) return looksConditional ? "0" : src;
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
            try {
                let expr = safeTrim(inner); if (!expr) return "";
                if (expr.includes("{{")) { expr = safeTrim(await renderStandaloneCbsText(expr, runtime, args)); if (!expr) return ""; }
                if (expr === "char" || expr === "Char") return safeTrim(runtime?.char?.name || "Char");
                if (expr === "user" || expr === "User") return runtime?.userName || "User";
                const parts = splitTopLevelCbsByDoubleColon(expr).map((s) => String(s ?? ""));
                const head = safeTrim(parts[0] || "");
                if (head === "arg") { const index = Math.max(0, (parseInt(safeTrim(parts[1] || "1"), 10) || 1) - 1); return args[index] ?? "null"; }
                if (head === "getvar") { const keyRaw = parts.slice(1).join("::"); const key = safeTrim(await renderStandaloneCbsText(keyRaw, runtime, args)); if (!key) return "null"; if (Object.prototype.hasOwnProperty.call(runtime.vars, key)) return runtime.vars[key]; if (Object.prototype.hasOwnProperty.call(runtime.globalVars, key)) return runtime.globalVars[key]; return "null"; }
                if (head === "calc") { const expression = await renderStandaloneCbsText(parts.slice(1).join("::"), runtime, args); return evalStandaloneCbsCalc(expression); }
                if (head === "call") { runtime._callDepth = (runtime._callDepth || 0) + 1; if (runtime._callDepth > 20) { runtime._callDepth--; return "[ERROR:max recursion]"; } try { const fnName = safeTrim(await renderStandaloneCbsText(parts[1] || "", runtime, args)); const fnBody = runtime.functions[fnName]; if (!fnBody) return ""; const callArgs = []; for (let i = 2; i < parts.length; i += 1) callArgs.push(await renderStandaloneCbsText(parts[i], runtime, args)); return await renderStandaloneCbsText(fnBody, runtime, callArgs); } finally { runtime._callDepth--; } }
                if (head === "none") return "";
                if (head === "char_desc") return safeTrim(runtime?.char?.desc || runtime?.char?.description || "");
                if (head === "ujb") return safeTrim(runtime?.db?.globalNote || "");
                if (head === "system_note") return safeTrim(runtime?.db?.globalNote || "");
                if (head === "random") { const choices = parts.slice(1); if (choices.length === 0) return ""; const randIdx = Math.floor(Math.random() * choices.length); return await renderStandaloneCbsText(choices[randIdx], runtime, args); }
                if (head === "token_count") { const text = await renderStandaloneCbsText(parts.slice(1).join("::"), runtime, args); return String(TokenizerEngine.estimateTokens(text, 'simple')); }
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
            } catch (e) {
                console.warn("[LIBRA] CBS Expr Eval Error:", e?.message);
                return "";
            }
        }

        async function evalBracketCbsExpr(inner, runtime, args = []) {
            const parts = splitTopLevelCbsByDoubleColon(inner).map((s) => safeTrim(s));
            const head = parts[0] || "";

            if (!head) return "";
            if (head.toLowerCase() === "annotation") {
                return await renderStandaloneCbsText(parts[1] || "", runtime, args);
            }

            // Fallback: treat payload like a normal CBS expression so unsupported
            // forms degrade into a usable string instead of leaking raw tokens.
            return await evalStandaloneCbsExpr(inner, runtime, args);
        }

        async function renderStandaloneCbsText(text, runtime, args = []) {
            const src = String(text ?? "");
            if (!src || (!src.includes("{{") && !src.includes("[CBS_EXPR:"))) return src;
            let out = "", cursor = 0;
            while (cursor < src.length) {
                const tag = findNextAnyCbsToken(src, cursor);
                if (!tag) { out += src.slice(cursor); break; }
                out += src.slice(cursor, tag.start);
                const inner = safeTrim(tag.inner);
                if (tag.raw.startsWith("[CBS_EXPR:")) {
                    out += await evalBracketCbsExpr(inner, runtime, args);
                    cursor = tag.end;
                    continue;
                }
                if (inner.startsWith("#func ")) { const fnName = safeTrim(inner.slice(6)); const block = extractCbsBlock(src, tag, "func"); if (fnName) runtime.functions[fnName] = block.body; cursor = block.end; continue; }
                if (inner.startsWith("#if_pure ")) { const conditionRaw = inner.slice(9); const block = extractCbsBlock(src, tag, "if_pure"); const condition = await evalStandaloneCbsExpr(conditionRaw, runtime, args); out += await renderStandaloneCbsText(isStandaloneCbsTruthy(condition) ? block.body : block.elseBody, runtime, args); cursor = block.end; continue; }
                if (inner.startsWith("#if ")) { const conditionRaw = inner.slice(4); const block = extractCbsBlock(src, tag, "if"); const condition = await evalStandaloneCbsExpr(conditionRaw, runtime, args); out += await renderStandaloneCbsText(isStandaloneCbsTruthy(condition) ? block.body : block.elseBody, runtime, args); cursor = block.end; continue; }
                if (inner.startsWith("#unless ")) { const conditionRaw = inner.slice(8); const block = extractCbsBlock(src, tag, "unless"); const condition = await evalStandaloneCbsExpr(conditionRaw, runtime, args); out += await renderStandaloneCbsText(isStandaloneCbsTruthy(condition) ? block.elseBody : block.body, runtime, args); cursor = block.end; continue; }
                if (inner.startsWith("#when ")) {
                    const block = extractCbsBlock(src, tag, "when");
                    const result = await evalStandaloneWhenCondition(inner.slice(6), runtime, args);
                    const selected = result.truthy ? block.body : block.elseBody;
                    const body = result.mode === "legacy" ? trimLegacyCbsBlockBody(selected) : selected;
                    out += await renderStandaloneCbsText(body, runtime, args);
                    cursor = block.end;
                    continue;
                }
                if (inner.startsWith("#when::")) {
                    const block = extractCbsBlock(src, tag, "when");
                    const result = await evalStandaloneWhenCondition(inner.slice(6), runtime, args);
                    const selected = result.truthy ? block.body : block.elseBody;
                    const body = result.mode === "legacy" ? trimLegacyCbsBlockBody(selected) : selected;
                    out += await renderStandaloneCbsText(body, runtime, args);
                    cursor = block.end;
                    continue;
                }
                if (inner === "else" || inner === ":else" || inner === "/if" || inner === "/unless" || inner === "/func" || inner === "/if_pure" || inner === "/when" || inner === "/") { cursor = tag.end; continue; }
                out += await evalStandaloneCbsExpr(inner, runtime, args); cursor = tag.end;
            }
            return out;
        }

        return {
            process: async (text) => {
                if (!MemoryEngine.CONFIG.cbsEnabled) return text;
                const src = String(text ?? ""); if (!src || (!src.includes("{{") && !src.includes("[CBS_EXPR:"))) return src;
                try {
                    const runtime = await getStandaloneCbsRuntime();
                    return await renderStandaloneCbsText(src, runtime, []);
                } catch (e) { console.error("[LIBRA] CBS Process Error", e); return src; }
            },
            clean: (text) => typeof text === 'string'
                ? text.replace(/\{\{[^}]*\}\}/g, '').replace(/\[CBS_EXPR:[^\]]*\]/g, '').trim()
                : ""
        };
    })();

    // ══════════════════════════════════════════════════════════════
    // [PROCESSOR] Complex World Detector
    // ══════════════════════════════════════════════════════════════
    const ComplexWorldDetector = (() => {
        const COMPLEX_PATTERNS = {
            multiverse: [/차원/, /평행\s*우주/, /멀티버스/, /이세계/, /다른\s*세계/, /워프/, /포탈/, /귀환/, /소환/, /전생/, /dimension/i, /parallel\s*universe/i, /multiverse/i, /another\s*world/i, /isekai/i, /warp/i, /portal/i, /summon/i, /reincarnation/i, /transmigrat/i],
            timeTravel: [/시간\s*여행/, /과거로/, /미래로/, /타임\s*머신/, /루프/, /회귀/, /타임\s*리프/, /time\s*travel/i, /to\s*the\s*past/i, /to\s*the\s*future/i, /time\s*machine/i, /time\s*loop/i, /regression/i, /time\s*leap/i],
            metaNarrative: [/작가/, /독자/, /4차\s*벽/, /픽션/, /이야기\s*속/, /메타/, /author/i, /reader/i, /fourth\s*wall/i, /fiction/i, /inside\s*the\s*story/i, /meta/i, /breaking.*wall/i],
            virtualReality: [/가상\s*현실/, /VR/, /게임\s*속/, /시뮬레이션/, /로그\s*(인|아웃)/, /던전/, /virtual\s*reality/i, /VR/i, /inside\s*the\s*game/i, /simulation/i, /log\s*(in|out)/i, /dungeon/i],
            dreamWorld: [/꿈\s*속/, /몽중/, /무의식/, /악몽/, /dream/i, /nightmare/i, /unconscious/i, /dreamworld/i]
        };

        const detectComplexIndicators = (text) => {
            const detected = {};
            for (const [type, patterns] of Object.entries(COMPLEX_PATTERNS)) {
                const matches = [];
                for (const pattern of patterns) {
                    const match = text.match(pattern);
                    if (match) matches.push({ pattern: pattern.source, matched: match[0] });
                }
                if (matches.length > 0) detected[type] = matches;
            }
            return detected;
        };

        const detectDimensionalShift = (text) => {
            const shifts = [];
            const movePatterns = [
                { pattern: /(.+?)에서\s+(.+?)으?로\s*(이동|넘어|건너)/, type: 'movement' },
                { pattern: /(.+?)을\s*통해\s+(.+?)에?\s*(도착|진입)/, type: 'portal' },
                { pattern: /(.+?)에?\s*소환되?어?\s+(.+?)에?\s*당도/, type: 'summon' },
                { pattern: /(.+?)에서\s+(.+?)으?로\s*(전생|환생|빙의)/, type: 'reincarnation' },
                // English patterns (use [^.,;!?]+ to avoid matching across sentence boundaries)
                { pattern: /(?:from|left)\s+([^.,;!?]+?)\s+(?:to|into|towards)\s+([^.,;!?]+?)(?:\s|$|[.,;!?])/i, type: 'movement' },
                { pattern: /(?:through|via)\s+([^.,;!?]+?)\s+(?:arrived?|entered?|reached?)\s+([^.,;!?]+?)(?:\s|$|[.,;!?])/i, type: 'portal' },
                { pattern: /summoned\s+(?:to|into)\s+([^.,;!?]+?)(?:\s|$|[.,;!?])/i, type: 'summon', singleGroup: true },
                { pattern: /(?:reincarnated?|reborn|transmigrated?)\s+(?:in|into|as)\s+([^.,;!?]+?)(?:\s|$|[.,;!?])/i, type: 'reincarnation', singleGroup: true }
            ];
            for (const mp of movePatterns) {
                const match = text.match(mp.pattern);
                if (match) {
                    if (mp.singleGroup) {
                        shifts.push({ type: mp.type, from: 'unknown', to: match[1]?.trim() || 'unknown', matched: match[0] });
                    } else {
                        shifts.push({ type: mp.type, from: match[1]?.trim() || 'unknown', to: match[2]?.trim() || 'unknown', matched: match[0] });
                    }
                }
            }
            return shifts;
        };

        const analyze = (userMessage, aiResponse) => {
            const text =`${userMessage} ${aiResponse}`;
            const complexIndicators = detectComplexIndicators(text);
            const dimensionalShifts = detectDimensionalShift(text);

            let complexityScore = Object.keys(complexIndicators).length * 0.3 + dimensionalShifts.length * 0.5;

            return {
                hasComplexElements: complexityScore > 0,
                complexityScore: Math.min(1, complexityScore),
                indicators: complexIndicators,
                dimensionalShifts,
                requiresNewNode: dimensionalShifts.length > 0
            };
        };

        return { detectComplexIndicators, detectDimensionalShift, analyze };
    })();

    // ══════════════════════════════════════════════════════════════
    // [PROCESSOR] Entity Extraction Prompt
    // ══════════════════════════════════════════════════════════════
    const EntityExtractionPrompt = `당신은 대화에서 인물 정보와 세계관 정보를 추출하는 전문가입니다.
You are an expert at extracting character and world information from conversations.

[현재 저장된 정보 / Currently Stored Information]
{STORED_INFO}

[대화 내용 / Conversation]
{CONVERSATION}

[작업 / Task]
대화에서 다음 정보를 추출하여 JSON 형식으로 출력:
Extract the following information from the conversation and output in JSON format:

1. 인물 정보 / Character Info (entities)
   - name: 이름/Name
   - appearance: { features: [], distinctiveMarks: [], clothing: [] }
   - personality: { traits: [], likes: [], dislikes: [], fears: [], sexualOrientation: "", sexualPreferences: [] }
   - background: { origin: "", occupation: "", history: [] }
   - status: { currentMood: "", currentLocation: "", healthStatus: "" }

2. 관계 정보 / Relationship Info (relations)
   - entityA, entityB: 인물 이름/Character names
   - relationType: 관계 유형/Relationship type
   - closenessDelta: 친밀도 변화/Closeness change (-0.3 ~ 0.3)
   - trustDelta: 신뢰도 변화/Trust change (-0.3 ~ 0.3)

3. 세계관 정보 / World Info (world)
   - classification: { primary: "modern_reality" | "fantasy" | "wuxia" | "game_isekai" | ... }
   - exists: { magic: true/false, ki: true/false, ... }
   - systems: { leveling: true/false, skills: true/false, ... }

[외형 추출 필수 규칙 / Mandatory Appearance Extraction Rules]
- 캐릭터의 외형(appearance.features)에는 반드시 다음 항목을 포함하여 추출하십시오:
  For each character, you MUST extract and include the following in appearance.features:
  * 머리색/Hair color (e.g. "검은 머리", "은발", "blonde hair")
  * 머리모양/Hair style (e.g. "긴 생머리", "숏컷", "ponytail", "twin tails")
  * 피부색/Skin tone (e.g. "하얀 피부", "갈색 피부", "fair skin")
  * 눈 모양/Eye shape (e.g. "큰 눈", "날카로운 눈매", "round eyes")
  * 눈 색/Eye color (e.g. "갈색 눈", "붉은 눈", "blue eyes")
  * 키/Height (e.g. "키가 큰 편", "작은 키", "약 170cm", "tall")
  * 체형/Body type (e.g. "마른 체형", "근육질", "슬림", "curvy", "athletic")
  * 가슴 크기 (여성)/Breast size (female) (e.g. "큰 가슴", "빈유", "large bust")
  * 성기 특징/Genital features (e.g. "큰 자지", "작은 음경", "large penis", "tight pussy")
- 대화에서 직접 언급되지 않더라도, 캐릭터 설정이나 묘사에서 유추 가능한 경우 추출하십시오.
  Even if not explicitly stated, extract if reasonably inferable from character descriptions.
- 이미 저장된 정보에 해당 항목이 없으면 반드시 채우십시오.
  If these fields are missing from stored info, you MUST fill them.

[성격 필수 추출 규칙 / Mandatory Personality Extraction Rules]
- 캐릭터의 성격(personality)에는 반드시 다음 항목을 포함하여 추출하십시오:
  For each character, you MUST extract and include the following in personality:
  * 성관념/Sexual attitudes (e.g. "개방적", "보수적", "순결주의", "open-minded", "conservative")
  * 성적취향/Sexual preferences (e.g. "이성애", "양성애", "S성향", "M성향", "heterosexual", "bisexual", "dominant", "submissive")
- sexualOrientation: 성관념을 문자열로 기술
- sexualPreferences: 성적취향을 배열로 기술
- 대화에서 직접 언급되지 않더라도, 캐릭터 설정이나 묘사에서 유추 가능한 경우 추출하십시오.

[규칙 / Rules]
- 명시적으로 언급된 정보만 추출 / Only extract explicitly mentioned information (단, 위의 필수 외형 항목은 유추 가능하면 추출)
- 기존 정보와 충돌하면 conflict 필드에 표시 / Mark conflicts with existing info in the conflict field

[출력 언어 규칙 / Output Language Rules]
- 이름(name, entityA, entityB)은 반드시 "한글(English)" 형식으로 작성하십시오. (e.g. "정수진(Jeong Sujin)", "히비키(Hibiki)")
- 이름을 제외한 모든 서술(features, traits, status, relationType 등)은 반드시 영문으로 작성하십시오.
- Names MUST be in "한글(English)" format. All other descriptions MUST be written in English.

[출력 / Output]
{ "entities": [...], "relations": [...], "world": {...}, "conflicts": [...] }`;

    // ══════════════════════════════════════════════════════════════
    // [PROCESSOR] Entity-Aware Processor
    // ══════════════════════════════════════════════════════════════
    const EntityAwareProcessor = (() => {
        const normalizeWorldRuleUpdate = (world) => {
            const normalized = {};
            const primaryClass = String(world?.classification?.primary || '').trim();
            if (primaryClass && WORLD_TEMPLATES[primaryClass]?.rules) {
                Object.assign(normalized, safeClone(WORLD_TEMPLATES[primaryClass].rules));
            }
            for (const key of ['exists', 'systems', 'physics', 'custom']) {
                if (world?.[key] && typeof world[key] === 'object' && !Array.isArray(world[key])) {
                    normalized[key] = {
                        ...(normalized[key] || {}),
                        ...world[key]
                    };
                }
            }
            return normalized;
        };

        const buildWorldConflictProbe = (world) => ({
            mentionsMagic: typeof world?.exists?.magic === 'boolean' ? world.exists.magic : undefined,
            mentionsKi: typeof world?.exists?.ki === 'boolean' ? world.exists.ki : undefined,
            mythicalCreature: Array.isArray(world?.exists?.mythical_creatures) ? world.exists.mythical_creatures[0] : undefined,
            content: JSON.stringify(world || {})
        });

        const extractFromConversation = async (userMsg, aiResponse, storedInfo, config) => {
            if (!config.useLLM) return { success: true, entities: [], relations: [], world: {}, conflicts: [] };

            const systemInstruction = EntityExtractionPrompt.replace('{STORED_INFO}', storedInfo || '없음').replace('{CONVERSATION}', '');
            const userContent = `[사용자]\n${userMsg}\n\n[응답]\n${aiResponse}`;

            try {
                const result = await LLMProvider.call(config, systemInstruction, userContent, { maxTokens: 1500 });
                const content = Utils.stripLLMThinkingTags(result.content || '');
                const parsed = extractJson(content);
                if (!parsed || typeof parsed !== 'object') throw new Error('No valid JSON found');
                return { success: true, entities: parsed.entities || [], relations: parsed.relations || [], world: parsed.world || {}, conflicts: parsed.conflicts || [] };
            } catch (e) {
                console.error('[LIBRA] Entity extraction failed:', e?.message);
                return { success: false, entities: [], relations: [], world: {}, conflicts: [], error: e?.message };
            }
        };

        const applyExtractions = async (extractions, lorebook, config, m_id = null) => {
            const { entities, relations, world, conflicts } = extractions;
            const appliedChanges = [];
            const s_id = MemoryState.currentSessionId;

            for (const entityData of entities || []) {
                if (!entityData.name) continue;
                const consistency = EntityManager.checkConsistency(entityData.name, entityData, lore);
                if (!consistency.consistent && config.debug) {
                    console.warn(`[LIBRA] Entity consistency warning:`, consistency.conflicts);
                }
                const updated = EntityManager.updateEntity(entityData.name, {
                    appearance: entityData.appearance,
                    personality: entityData.personality,
                    background: entityData.background,
                    status: entityData.status,
                    source: 'conversation',
                    s_id, m_id
                }, lorebook);
                if (updated) appliedChanges.push(`Entity "${entityData.name}" updated`);
            }

            for (const relationData of relations || []) {
                if (!relationData.entityA || !relationData.entityB) continue;
                const updated = EntityManager.updateRelation(relationData.entityA, relationData.entityB, {
                    relationType: relationData.relationType,
                    details: { closeness: relationData.closenessDelta, trust: relationData.trustDelta },
                    sentiments: relationData.sentiments,
                    event: relationData.event,
                    s_id, m_id
                }, lorebook);
                if (updated) appliedChanges.push(`Relation "${relationData.entityA} ↔ ${relationData.entityB}" updated`);
            }

            const hasWorldPayload = !!(world && (
                world.classification ||
                (world.exists && Object.keys(world.exists).length > 0) ||
                (world.systems && Object.keys(world.systems).length > 0) ||
                (world.physics && Object.keys(world.physics).length > 0) ||
                (world.custom && Object.keys(world.custom).length > 0)
            ));

            if (hasWorldPayload) {
                const worldProfile = HierarchicalWorldManager.getProfile();
                if (worldProfile && worldProfile.nodes.size > 0) {
                    const activePath = HierarchicalWorldManager.getActivePath();
                    const currentNodeId = activePath.length > 0 ? activePath[activePath.length - 1] : null;
                    if (currentNodeId) {
                        const currentNode = worldProfile.nodes.get(currentNodeId);
                        const worldRuleUpdate = normalizeWorldRuleUpdate(world);
                        const mode = String(config.worldAdjustmentMode || 'dynamic').toLowerCase();
                        const intent = WorldAdjustmentManager.analyzeUserIntent(_lastUserMessage || '', []);
                        const conflictsDetected = WorldAdjustmentManager.detectConflict(buildWorldConflictProbe(world), currentNode || {});
                        const allowUpdate =
                            mode === 'soft' ||
                            conflictsDetected.length === 0 ||
                            (mode === 'dynamic' && (intent.type === 'explicit_change' || intent.type === 'implicit_expand'));

                        if (allowUpdate) {
                            HierarchicalWorldManager.updateNode(currentNodeId, { rules: worldRuleUpdate });
                            appliedChanges.push(`World rules updated (${mode})`);
                            if (conflictsDetected.length > 0) {
                                conflicts.push(...conflictsDetected.map(c => ({ ...c, handledBy: mode })));
                            }
                        } else {
                            conflicts.push(...conflictsDetected.map(c => ({ ...c, blockedBy: mode || 'hard' })));
                        }
                    }
                }
            }

            return { applied: appliedChanges, warnings: conflicts || [] };
        };

        const formatStoredInfo = (maxEntities = 10) => {
            const parts = [];
            const entities = Array.from(EntityManager.getEntityCache().values()).slice(0, maxEntities);
            if (entities.length > 0) {
                parts.push('[인물 정보]');
                for (const entity of entities) parts.push(EntityManager.formatEntityForPrompt(entity));
            }
            const relations = Array.from(EntityManager.getRelationCache().values()).slice(0, maxEntities * 2);
            if (relations.length > 0) {
                parts.push('\n[관계 정보]');
                for (const relation of relations) parts.push(EntityManager.formatRelationForPrompt(relation));
            }
            return parts.join('\n');
        };

        return { extractFromConversation, applyExtractions, formatStoredInfo };
    })();

    // ══════════════════════════════════════════════════════════════
    // [PROCESSOR] World Adjustment Manager
    // ══════════════════════════════════════════════════════════════
const WorldAdjustmentManager = (() => {
    const analyzeUserIntent = (userMessage, conflictInfo) => {
        const text = userMessage.toLowerCase();

        // 명시적 변경 요청 패턴 / Explicit change patterns
        const explicitChangePatterns = [
            /사실은\s*.+인\s*거야/,
            /알고보니\s*.+/,
            /세계관\s*(바꿔|변경|수정)/,
            /이제부터\s*.+/,
            /.+가\s*아니라\s*.+/,
            /설정\s*(바꾸|변경)/,
            /actually.+is\s/i, /turns?\s*out.+/i, /change\s*(the)?\s*world/i, /from\s*now\s*on/i, /it's\s*not.+but/i, /change\s*(the)?\s*setting/i
        ];

        for (const pattern of explicitChangePatterns) {
            if (pattern.test(text)) {
                return { type: 'explicit_change', confidence: 0.9, reason: '사용자가 명시적으로 설정 변경을 요청함 / User explicitly requested setting change' };
            }
        }

        // 암시적 확장 패턴 / Implicit expand patterns
        const implicitExpandPatterns = [
            /새로운\s*.+/,
            /처음\s*(보는|듣는)\s*.+/,
            /.+라는\s*(것이|존재가)\s*있어/,
            /new\s+.+/i, /first\s*time\s*(seeing|hearing)/i, /there\s*(is|are|exists?)\s+.+/i
        ];

        for (const pattern of implicitExpandPatterns) {
            if (pattern.test(text)) {
                return { type: 'implicit_expand', confidence: 0.6, reason: '이야기 전개상 새로운 요소 등장 / New element appeared in narrative' };
            }
        }

        // 실수/착각 가능성 / Mistake patterns
        const mistakePatterns = [
            /아\s*미안/, /잘못\s*(말했|적었)/, /아니\s*그게\s*아니라/,
            /oh\s*sorry/i, /my\s*(bad|mistake)/i, /i\s*meant/i, /no\s*that'?s?\s*not/i
        ];

        for (const pattern of mistakePatterns) {
            if (pattern.test(text)) {
                return { type: 'mistake', confidence: 0.4, reason: '사용자의 실수 가능성 / Possible user mistake' };
            }
        }

        // 기본값
        return { type: 'narrative', confidence: 0.5, reason: '일반적인 이야기 서술 / General narrative' };
    };

    // 충돌 감지
    const detectConflict = (newInfo, worldProfile) => {
        if (!worldProfile) return [];

        const conflicts = [];
        const rules = worldProfile.rules || {};
        const exists = rules.exists || {};

        // 마법 존재 여부 충돌
        if (newInfo.mentionsMagic !== undefined && newInfo.mentionsMagic !== exists.magic) {
            conflicts.push({
                area: 'exists',
                key: 'magic',
                type: 'existence_violation',
                existing: exists.magic,
                new: newInfo.mentionsMagic,
                description: `마법 존재 여부: ${exists.magic} → ${newInfo.mentionsMagic}`
            });
        }

        // 기 존재 여부 충돌
        if (newInfo.mentionsKi !== undefined && newInfo.mentionsKi !== exists.ki) {
            conflicts.push({
                area: 'exists',
                key: 'ki',
                type: 'existence_violation',
                existing: exists.ki,
                new: newInfo.mentionsKi,
                description: `기(氣) 존재 여부: ${exists.ki} → ${newInfo.mentionsKi}`
            });
        }

        // 신화적 존재 충돌
        if (newInfo.mythicalCreature && exists.mythical_creatures && !exists.mythical_creatures.includes(newInfo.mythicalCreature)) {
            conflicts.push({
                area: 'exists',
                key: 'mythical_creatures',
                type: 'entity_violation',
                existing: exists.mythical_creatures,
                new: newInfo.mythicalCreature,
                description: `${newInfo.mythicalCreature}는 이 세계관에 존재하지 않습니다`
            });
        }

        // 금지 요소 충돌
        const forbidden = worldProfile.consistency?.forbidden || [];
        for (const item of forbidden) {
            if (newInfo.content && newInfo.content.includes(item)) {
                conflicts.push({
                    area: 'forbidden',
                    key: item,
                    type: 'forbidden_violation',
                    description: `"${item}"는 이 세계관에서 금지된 요소입니다`
                });
            }
        }

        return conflicts;
    };

    // 조정 실행
    const executeAdjustment = (worldProfile, newInfo, adjustmentConfig, intent) => {
        const mode = adjustmentConfig.mode;
        const area = newInfo.area;
        const areaConfig = adjustmentConfig.adjustableAreas[area];

        if (!areaConfig?.adjustable) {
            return { success: false, reason: '해당 영역은 조정할 수 없습니다', action: 'reject' };
        }

        // 다이내믹 모드: 맥락 기반 판단
        if (mode === 'dynamic') {
            if (intent.type === 'explicit_change' && intent.confidence > 0.7) {
                // 명시적 변경 요청
                return applyChange(worldProfile, newInfo, 'auto_adjust');
            }
            if (intent.type === 'implicit_expand' && intent.confidence > 0.5) {
                // 암시적 확장
                return applyChange(worldProfile, newInfo, 'auto_expand');
            }
        }

        // 소프트 모드: 자동 조정
        if (mode === 'soft') {
            if (intent.confidence < 0.4) {
                return applyChange(worldProfile, newInfo, 'silent_adjust');
            }
        }

        // 하드 모드: 거부
        if (mode === 'hard') {
            return {
                success: false,
                action: 'reject_with_warning',
                reason: '엄격 모드: 세계관 설정을 변경할 수 없습니다',
                suggestion: '세계관 설정을 직접 수정하려면 설정 메뉴를 이용하세요'
            };
        }

        // 기본: 확인 요청
        return {
            success: false,
            action: 'confirm_needed',
            reason: '세계관과 충돌합니다',
            options: [
                { label: '네, 변경합니다', action: 'accept' },
                { label: '아니요, 유지합니다', action: 'reject' },
                { label: '이번만 예외', action: 'exception' }
            ]
        };
    };

    // 변경 적용
    const applyChange = (worldProfile, newInfo, action) => {
        const changes = [];
        const description = [];

        if (newInfo.area === 'exists' && newInfo.key) {
            if (['magic', 'ki', 'supernatural'].includes(newInfo.key)) {
                worldProfile.rules.exists[newInfo.key] = newInfo.value;
                changes.push({ path:`rules.exists.${newInfo.key}`, value: newInfo.value });
                description.push(`${newInfo.key === 'magic' ? '마법' : newInfo.key === 'ki' ? '기(氣)' : '초자연'}: ${newInfo.value}`);
            }
            if (newInfo.key === 'mythical_creatures' && newInfo.value) {
                if (!Array.isArray(worldProfile.rules.exists.mythical_creatures)) {
                    worldProfile.rules.exists.mythical_creatures = [];
                }
                if (!worldProfile.rules.exists.mythical_creatures.includes(newInfo.value)) {
                    worldProfile.rules.exists.mythical_creatures.push(newInfo.value);
                    changes.push({ path: 'rules.exists.mythical_creatures', added: newInfo.value });
                    description.push(`신화적 존재 추가: ${newInfo.value}`);
                }
            }
        }

        if (newInfo.area === 'systems' && newInfo.key) {
            worldProfile.rules.systems[newInfo.key] = newInfo.value;
            changes.push({ path:`rules.systems.${newInfo.key}`, value: newInfo.value });
            description.push(`시스템(${newInfo.key}): ${newInfo.value}`);
        }

        worldProfile.meta.updated = MemoryState.currentTurn;

        return { success: true, action, changes, description: description.join(', ') };
    };

    return { analyzeUserIntent, detectConflict, executeAdjustment, applyChange };
})();

// ══════════════════════════════════════════════════════════════
// [TRIGGER] RisuAI Event Handlers
// ══════════════════════════════════════════════════════════════
// 마지막 사용자 메시지 캐시 (beforeRequest → afterRequest 전달용)
let _lastUserMessage = '';
let _lastUserMessageRaw = '';

const buildCanonicalUserPayload = (msg) => {
    if (!msg || !(msg.role === 'user' || msg.is_user)) {
        return { strict: '', raw: '' };
    }
    const raw = Utils.getMemorySourceText(Utils.getMessageText(msg));
    const strict = getStrictNarrativeUserText(Utils.getMessageText(msg));
    return { strict, raw };
};

const findLatestNarrativeUserText = (messages = []) => {
    const list = Array.isArray(messages) ? messages : [];
    for (let i = list.length - 1; i >= 0; i--) {
        const msg = list[i];
        if (!msg || !(msg.role === 'user' || msg.is_user)) continue;
        const text = Utils.getNarrativeComparableText(Utils.getMessageText(msg), 'user');
        if (text) return text;
    }
    return '';
};

const findLatestVisibleUserText = (messages = []) => {
    const list = Array.isArray(messages) ? messages : [];
    for (let i = list.length - 1; i >= 0; i--) {
        const msg = list[i];
        if (!msg || !(msg.role === 'user' || msg.is_user)) continue;
        const text = Utils.getMemorySourceText(Utils.getMessageText(msg));
        if (text) return text;
    }
    return '';
};

const findLatestUserMessage = (messages = []) => {
    const list = Array.isArray(messages) ? messages : [];
    for (let i = list.length - 1; i >= 0; i--) {
        const msg = list[i];
        if (msg && (msg.role === 'user' || msg.is_user)) return msg;
    }
    return null;
};

const resolveCanonicalUserPayload = (messages = []) => {
    const primary = buildCanonicalUserPayload(findLatestUserMessage(messages));
    if (primary.strict || primary.raw) return primary;
    return {
        strict: _lastUserMessage || '',
        raw: _lastUserMessageRaw || _lastUserMessage || ''
    };
};

const getStrictNarrativeUserText = (text) => {
    const candidate = Utils.getNarrativeComparableText(text, 'user');
    if (!candidate) return '';
    if (Utils.isForcedBypassPrompt(candidate)) return '';
    return candidate;
};

const reloadChatScopedRuntime = (lore, chatId = null, opts = {}) => {
    const { resetSessionCaches = false, forceWorldReload = false } = opts;
    if (resetSessionCaches) {
        MemoryState.reset();
        MemoryState.ignoredGreetingId = null;
        MemoryState.isSessionRestored = false;
        _lastUserMessage = '';
        _lastUserMessageRaw = '';
    }
    MemoryEngine.rebuildIndex(lore);
    EntityManager.rebuildCache(lore);
    HierarchicalWorldManager.loadWorldGraph(lore, forceWorldReload);
    NarrativeTracker.loadState(lore);
    StoryAuthor.loadState(lore);
    Director.loadState(lore);
    CharacterStateTracker.loadState(lore);
    WorldStateTracker.loadState(lore);
    MemoryEngine.setTurn(deriveMaxTurnFromLorebook(lore));
    MemoryState._activeChatId = chatId || null;
};

// 지연 초기화 (CHAT_START 대체 - beforeRequest 최초 호출 시 실행)
    const _lazyInit = async (lore) => {
    if (MemoryState.isInitialized) return;
    reloadChatScopedRuntime(lore, MemoryState._activeChatId, { forceWorldReload: false });
    const managed = MemoryEngine.getManagedEntries(lore);
    MemoryState.isInitialized = true;
    TurnRecoveryEngine.startPolling();
    if (MemoryEngine.CONFIG.debug) {
        console.log(`[LIBRA] Lazy init. Turn: ${MemoryEngine.getCurrentTurn()}, Memories: ${managed.length}`);
        console.log(`[LIBRA] Entities: ${EntityManager.getEntityCache().size}, Relations: ${EntityManager.getRelationCache().size}`);
    }
};

if (typeof risuai !== 'undefined') {
    // beforeRequest: OpenAI 메시지 배열에 컨텍스트 주입
    risuai.addRisuReplacer('beforeRequest', async (messages, type) => {
        // 메시지 배열 유효성 검증
        const safeMessages = (Array.isArray(messages) ? messages : []).filter(m => m && typeof m === 'object' && m.role);
        try {
            if (!Utils.isNarrativeRequestType(type)) {
                if (MemoryEngine.CONFIG?.debug) {
                    console.log(`[LIBRA] beforeRequest skipped for non-primary request type: ${type}`);
                }
                return safeMessages;
            }

            const char = await risuai.getCharacter();
            if (!char) return safeMessages;
            let db = null; try { db = await risuai.getDatabase(); } catch {}
            EntityManager.refreshIdentity(char, db);

            const chat = char.chats?.[char.chatPage];
            if (!chat) return safeMessages;

            if (await MemoryEngine.normalizeLoreStorage(char, chat)) {
                await persistLoreToActiveChat(chat, MemoryEngine.getLorebook(char, chat));
            }

            let lore = MemoryEngine.getLorebook(char, chat);
            let effectiveLore = MemoryEngine.getEffectiveLorebook(char, chat);

            // 원본 메시지 배열을 보호하기 위해 함수 시작 시 복사본 생성 (유효한 메시지만)
            const result = safeMessages.map(m => ({ ...m }));

            // 지연 초기화
            await _lazyInit(lore);

            // 세션 변경 감지: 다른 채팅방으로 전환된 경우 모든 캐시 강제 재구축
            const _chatId = chat?.id || null;
            if (MemoryState._activeChatId !== _chatId) {
                reloadChatScopedRuntime(lore, _chatId, { resetSessionCaches: true, forceWorldReload: true });
                enterRefreshRecoveryWindow();
                MemoryState.currentSessionId = `sess_${_chatId || 'global'}_${Date.now()}`;
            } else {
                HierarchicalWorldManager.loadWorldGraph(lore);
                if (EntityManager.getEntityCache().size === 0) {
                    reloadChatScopedRuntime(lore, _chatId, { forceWorldReload: false });
                }
            }

            const checkpointRestored = await RefreshCheckpointManager.restoreIfAhead(char, chat, lore);
            if (checkpointRestored) {
                lore = MemoryEngine.getLorebook(char, chat);
                effectiveLore = MemoryEngine.getEffectiveLorebook(char, chat);
                enterRefreshRecoveryWindow();
            }

            // 1. 자동 롤백 및 동기화 실행 (삭제/스와이프 감지)
            if (!isRefreshStabilizing()) {
                await SyncEngine.syncMemory(char, chat, lore);
                await TurnRecoveryEngine.recoverIfNeeded('beforeRequest');
            } else if (MemoryEngine.CONFIG.debug) {
                console.log('[LIBRA] beforeRequest sync/recovery delayed during refresh stabilization window');
            }

            const latestRequestUser = result.filter(m => m?.role === 'user').slice(-1)[0] || null;
            let userMessage = latestRequestUser?.content || '';
            if (MemoryEngine.CONFIG.cbsEnabled && typeof CBSEngine !== 'undefined') {
                userMessage = await CBSEngine.process(userMessage);
                const lastUserIdx = result.map(m => m?.role).lastIndexOf('user');
                if (lastUserIdx >= 0) result[lastUserIdx].content = userMessage;
            }
            let canonicalUser = buildCanonicalUserPayload({ role: 'user', content: userMessage });
            if (!canonicalUser.strict && !canonicalUser.raw) {
                canonicalUser = buildCanonicalUserPayload(findLatestUserMessage(getChatMessages(chat)));
            }
            userMessage = canonicalUser.strict;
            _lastUserMessage = canonicalUser.strict || '';
            _lastUserMessageRaw = canonicalUser.raw || '';

            const directorPrompt = Director.formatForPrompt();
            const allowDirectorOverride = !!(MemoryEngine.CONFIG.directorEnabled && directorPrompt);
            if (Utils.shouldBypassNarrativeSystems(userMessage, '') && !allowDirectorOverride) {
                if (MemoryEngine.CONFIG.debug) {
                    const hasNarrativePayload = Utils.hasSubstantialNarrativePayload(userMessage, 'user');
                    console.log(`[LIBRA] beforeRequest bypassed for meta/tool-style prompt | hasNarrativePayload=${hasNarrativePayload} | userChars=${String(userMessage || '').length}`);
                }
                _lastUserMessage = '';
                _lastUserMessageRaw = '';
                return result;
            }

            // 언급된 엔티티 찾기
            const mentionedEntities = [];
            const entityCache = EntityManager.getEntityCache();
            for (const [name, entity] of entityCache) {
                if (EntityManager.mentionsEntity(userMessage, entity || name)) {
                    mentionedEntities.push(entity);
                }
            }

            // 세계관 프롬프트 생성
            const worldPrompt = HierarchicalWorldManager.formatForPrompt();

            // 엔티티 프롬프트
            const entityPrompt = mentionedEntities.length > 0
                ? mentionedEntities.map(e => EntityManager.formatEntityForPrompt(e)).join('\n\n')
                : '';

            // 관계 프롬프트
            const relationPrompt = mentionedEntities.length > 0
                ? Array.from(EntityManager.getRelationCache().values())
                    .filter(r => mentionedEntities.some(e => e.name === r.entityA || e.name === r.entityB))
                    .map(r => EntityManager.formatRelationForPrompt(r))
                    .join('\n\n')
                : '';

            // 기억 및 로어북 동적 검색 (RAG)
            const embedBeforeMemory = getEmbeddingDebugSnapshotSafe();
            const memoryCandidates = MemoryEngine.getManagedEntries(lore);
            const memories = await MemoryEngine.retrieveMemories(
                userMessage, MemoryEngine.getCurrentTurn(), memoryCandidates, {}, 10
            );
            const memoryText = MemoryEngine.formatMemories(memories);

            let lorebookText = '';
            if (MemoryEngine.CONFIG.useLorebookRAG) {
                // 일반 로어북을 메모리 엔진이 인식할 수 있도록 임시 META 래핑
                const activeStandardLore = effectiveLore
                    .filter(e => !e.comment || !e.comment.startsWith('lmai_'))
                    .filter(e => MemoryEngine.isStandardLoreActive(e, userMessage));
                const candidateStandardLore = MemoryEngine.prefilterStandardLore(userMessage, activeStandardLore, 24);
                const standardLore = candidateStandardLore.map(e => ({
                    ...e,
                    content: `[META:{"t":${MemoryEngine.getCurrentTurn()},"ttl":-1,"imp":8}] ` + (e.content || '')
                }));
                
                if (standardLore.length > 0) {
                    const loreResults = await MemoryEngine.retrieveMemories(
                        userMessage, MemoryEngine.getCurrentTurn(), standardLore, {}, 3
                    );
                    if (loreResults.length > 0) {
                        lorebookText = loreResults.map((m, i) => `[참고 설정 ${i+1}] ${m.content.replace(MemoryEngine.META_PATTERN, '').slice(0, 400)}`).join('\n');
                    }
                }
            }
            const embedAfterMemory = getEmbeddingDebugSnapshotSafe();

            // 컨텍스트 구성
            const contextParts = [];
            const injectedSections = [];
            if (directorPrompt) {
                contextParts.push(directorPrompt);
                injectedSections.push(`director(${directorPrompt.length})`);
            }
            if (worldPrompt) {
                contextParts.push(worldPrompt);
                injectedSections.push(`world(${worldPrompt.length})`);
            }
            if (lorebookText) {
                const section = '[로어북 설정 / Reference Lorebook]\n' + lorebookText;
                contextParts.push(section);
                injectedSections.push(`lorebook(${lorebookText.length})`);
            }
            if (entityPrompt) {
                const section = '[인물 정보 / Character Info]\n' + entityPrompt;
                contextParts.push(section);
                injectedSections.push(`entities(${mentionedEntities.length}/${entityPrompt.length})`);
            }
            if (relationPrompt) {
                const section = '[관계 정보 / Relationship Info]\n' + relationPrompt;
                contextParts.push(section);
                injectedSections.push(`relations(${relationPrompt.length})`);
            }
            if (memories.length > 0) {
                const section = '[관련 기억 / Related Memories]\n' + memoryText;
                contextParts.push(section);
                injectedSections.push(`memories(${memories.length}/${memoryText.length})`);
            }

            // Narrative context
            const narrativePrompt = NarrativeTracker.formatForPrompt();
            if (narrativePrompt) {
                contextParts.push(narrativePrompt);
                injectedSections.push(`narrative(${narrativePrompt.length})`);
            }
            const storyAuthorPrompt = StoryAuthor.formatForPrompt();
            if (storyAuthorPrompt) {
                contextParts.push(storyAuthorPrompt);
                injectedSections.push(`storyAuthor(${storyAuthorPrompt.length})`);
            }

            // Character state context
            for (const entity of mentionedEntities) {
                const statePrompt = CharacterStateTracker.formatForPrompt(entity.name);
                if (statePrompt) {
                    contextParts.push(`[${entity.name} State]\n${statePrompt}`);
                    injectedSections.push(`charState:${entity.name}(${statePrompt.length})`);
                }
            }

            // World state context
            const worldStatePrompt = WorldStateTracker.formatForPrompt();
            if (worldStatePrompt) {
                contextParts.push('[World State History]\n' + worldStatePrompt);
                injectedSections.push(`worldState(${worldStatePrompt.length})`);
            }

            const instructions = [
                '[지시사항 / Instructions]',
                '1. 위 세계관 및 [로어북 설정]을 최우선으로 준수하세요. / Strictly follow the world rules and [Reference Lorebook] above as the highest priority.',
                '2. 존재하지 않는 요소(마법, 기, 레벨 등)는 절대 언급하지 마세요. / Never mention non-existent elements.',
                '3. 인물 정보를 일관되게 유지하세요. 제공된 설정과 충돌하는 기억이나 행동을 생성하지 마세요. / Maintain character info consistently. Do not generate memories or actions that conflict with the provided settings.',
                '4. 진행 중인 이야기의 맥락을 유지하세요. / Maintain the context of ongoing storylines.',
                '5. 캐릭터의 감정, 위치, 건강 상태가 이전 턴과 일관되어야 합니다. / Character emotion, location, health must be consistent with previous turns.',
                '6. 세계관의 물리 법칙과 시스템 규칙을 위반하지 마세요. / Do not violate world physics and system rules.'
            ].join('\n');
            contextParts.push(instructions);
            injectedSections.push(`instructions(${instructions.length})`);

            if (contextParts.length === 0) return result;
            const contextStr = contextParts.join('\n\n');

            // 시스템 메시지에 컨텍스트 주입
            const sysIdx = result.findIndex(m => m?.role === 'system');
            if (sysIdx >= 0) {
                result[sysIdx].content = (result[sysIdx].content || '') + '\n\n' + contextStr;
            } else {
                result.unshift({ role: 'system', content: contextStr });
            }

            // Add context reminder before last user message
            if (contextParts.length > 1) {
                const lastUserIdx = result.map(m => m?.role).lastIndexOf('user');
                if (lastUserIdx > 0) {
                    result.splice(lastUserIdx, 0, {
                        role: 'system',
                        content: '[Librarian System Context Reminder]\n' +
                            (directorPrompt ? directorPrompt + '\n' : '') +
                            (narrativePrompt ? narrativePrompt + '\n' : '') +
                            (storyAuthorPrompt ? storyAuthorPrompt + '\n' : '') +
                            (mentionedEntities.length > 0 ? 'Active characters: ' + mentionedEntities.map(e => e.name).join(', ') + '\n' : '') +
                            'Maintain consistency with all provided context.'
                    });
                }
            }

            if (MemoryEngine.CONFIG.debug) {
                const memoryDebug = MemoryEngine.getLastRetrievalDebug();
                console.log('[LIBRA] World:', HierarchicalWorldManager.getActivePath());
                console.log('[LIBRA] Entities:', mentionedEntities.length);
                if (memoryDebug) {
                    const topSummary = (memoryDebug.topEntries || [])
                        .map((item, idx) => `#${idx + 1} imp=${item.importance} sim=${item.similarity} rec=${item.recency} final=${item.finalScore} t=${item.turn} "${item.preview}"`)
                        .join(' || ');
                    console.log(
                        `[LIBRA] Memory Retrieval: candidates=${memoryDebug.originalCandidates} -> filtered=${memoryDebug.filteredCandidates} -> selected=${memoryDebug.selectedCount} | belowSimThreshold=${memoryDebug.belowThresholdCount} | threshold=${memoryDebug.threshold} | simThreshold=${memoryDebug.simThreshold} | weights=${JSON.stringify(memoryDebug.weights)}`
                    );
                    if (topSummary) {
                        console.log(`[LIBRA] Memory Top Scores: ${topSummary}`);
                    }
                }
                console.log(
                    `[LIBRA] Embedding Activity: configured=${!!(MemoryEngine.CONFIG.embed?.url && MemoryEngine.CONFIG.embed?.key)} | used=${embedAfterMemory.totalCalls > embedBeforeMemory.totalCalls} | providerCalls=${Math.max(0, embedAfterMemory.providerCalls - embedBeforeMemory.providerCalls)} | cacheHits=${Math.max(0, embedAfterMemory.cacheHits - embedBeforeMemory.cacheHits)} | provider=${embedAfterMemory.lastProvider || MemoryEngine.CONFIG.embed?.provider || 'openai'} | model=${embedAfterMemory.lastModel || MemoryEngine.CONFIG.embed?.model || ''} | lastStatus=${embedAfterMemory.lastStatus} | dims=${embedAfterMemory.lastDims || 0}`
                );
                console.log(`[LIBRA] Injected Sections: ${injectedSections.join(' | ') || 'none'} | totalChars=${contextStr.length}`);
            }

            // Final safety filter to prevent RisuAI core crash
            const finalResult = (Array.isArray(result) ? result : []).filter(m => m && typeof m === 'object' && m.role);
            return finalResult.length > 0 ? finalResult : safeMessages;
        } catch (e) {
            console.error('[LIBRA] beforeRequest Error:', e?.message || e);
            return safeMessages;
        }
    });

    // afterRequest: 기억 저장 및 엔티티 업데이트
    risuai.addRisuReplacer('afterRequest', async (content, type) => {
        try {
            if (!Utils.isNarrativeRequestType(type)) {
                if (MemoryEngine.CONFIG?.debug) {
                    console.log(`[LIBRA] afterRequest skipped for non-primary request type: ${type}`);
                }
                return content;
            }

            const char = await risuai.getCharacter();
            if (!char) return content;
            let db = null; try { db = await risuai.getDatabase(); } catch {}
            EntityManager.refreshIdentity(char, db);

            const chat = char.chats?.[char.chatPage];
            const msgs_all = getChatMessages(chat);
            if (!chat || msgs_all.length === 0) return content;

            if (await MemoryEngine.normalizeLoreStorage(char, chat)) {
                await persistLoreToActiveChat(chat, MemoryEngine.getLorebook(char, chat));
            }

            // 인사말 필터링: 자동 생성된 첫 인사말은 분석에서 제외
            const aiMsg = msgs_all[msgs_all.length - 1];
            if (aiMsg && aiMsg.id === MemoryState.ignoredGreetingId) {
                if (MemoryEngine.CONFIG.debug) console.log(`[LIBRA] Bypassing analysis for isolated greeting: ${aiMsg.id}`);
                return content;
            }

            const priorMsgs = msgs_all.slice(0, Math.max(0, msgs_all.length - 1));
            const canonicalUser = resolveCanonicalUserPayload(priorMsgs);
            const userMsgForNarrative = canonicalUser.strict;
            const userMsgForMemory = canonicalUser.raw || canonicalUser.strict;
            const aiResponseRaw = String(content || '');
            const aiResponse = Utils.getNarrativeComparableText(aiResponseRaw, 'ai');
            const isAutoContinueTurn = !userMsgForNarrative && !userMsgForMemory && !!aiResponse;
            const allowNarrativeProcessing = (!!aiResponse && !Utils.shouldBypassNarrativeSystems(userMsgForNarrative, aiResponse)) || isAutoContinueTurn;
            const allowMemoryCapture = !!aiResponse && (isAutoContinueTurn || !!userMsgForMemory || !!userMsgForNarrative);

            if (!allowNarrativeProcessing && !allowMemoryCapture) {
                if (MemoryEngine.CONFIG.debug) {
                    console.log('[LIBRA] afterRequest bypassed for meta/tool-style turn');
                }
                return content;
            }

            // 세션 변경 감지: 다른 채팅방으로 전환된 경우 모든 캐시 강제 재구축
            const _chatId = chat?.id || null;
            const lore = MemoryEngine.getLorebook(char, chat);
            if (MemoryState._activeChatId !== _chatId) {
                reloadChatScopedRuntime(lore, _chatId, { resetSessionCaches: true, forceWorldReload: true });
                enterRefreshRecoveryWindow();
                MemoryState.currentSessionId = `sess_${_chatId || 'global'}_${Date.now()}`;
            } else {
                HierarchicalWorldManager.loadWorldGraph(lore);
            }

            PendingTurnManager.registerPending(chat, {
                userMsgForNarrative,
                userMsgForMemory,
                aiResponse,
                aiResponseRaw,
                autoContinueTurn: isAutoContinueTurn,
                allowNarrativeProcessing,
                allowMemoryCapture,
                aiHash: aiResponse ? TokenizerEngine.simpleHash(aiResponse) : null,
                initialMessageId: aiMsg?.id || null,
                requestType: type
            });
            if (MemoryEngine.CONFIG.debug) {
                console.log(`[LIBRA] Pending turn registered | chat=${chat?.id || 'global'} | aiHash=${TokenizerEngine.simpleHash(aiResponse || '')}`);
            }

            _lastUserMessage = '';
            _lastUserMessageRaw = '';

            return content;
        } catch (e) {
            console.error('[LIBRA] afterRequest Error:', e?.message || e);
            return content;
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
        console.warn('[LIBRA] Config load failed:', e?.message || e);
    }

    const getVal = (key, argName, type, parent, fallback) => {
        const localVal = parent ? local[parent]?.[key] : local[key];
        let argVal;
        try { argVal = risuai.getArgument(argName); } catch {}
        const configVal = parent ? cfg[parent]?.[key] : cfg[key];
        const raw = localVal !== undefined ? localVal : argVal !== undefined ? argVal : configVal !== undefined ? configVal : fallback;

        if (raw === undefined || raw === null) return fallback;

        switch (type) {
            case 'number': { const n = Number(raw); return isNaN(n) ? (fallback ?? configVal) : n; }
            case 'boolean': return raw === true || raw === 1 || raw === 'true' || raw === '1';
            default: return String(raw);
        }
    };

    cfg.maxLimit = getVal('maxLimit', 'max_limit', 'number', null, MEMORY_PRESETS.general.maxLimit);
    cfg.threshold = getVal('threshold', 'threshold', 'number', null, MEMORY_PRESETS.general.threshold);
    cfg.simThreshold = getVal('simThreshold', 'sim_threshold', 'number', null, MEMORY_PRESETS.general.simThreshold);
    const coldStartScopePreset = getVal('coldStartScopePreset', 'cold_start_scope_preset', 'string', null, inferColdStartScopePreset(cfg.coldStartHistoryLimit));
    const coldStartHistoryLimit = getVal('coldStartHistoryLimit', 'cold_start_history_limit', 'number', null, resolveColdStartHistoryLimit(coldStartScopePreset, 100));
    cfg.coldStartScopePreset = Object.prototype.hasOwnProperty.call(COLD_START_SCOPE_PRESETS, String(coldStartScopePreset || '').toLowerCase())
        ? String(coldStartScopePreset || '').toLowerCase()
        : inferColdStartScopePreset(coldStartHistoryLimit);
    cfg.coldStartHistoryLimit = resolveColdStartHistoryLimit(cfg.coldStartScopePreset, coldStartHistoryLimit);
    cfg.debug = getVal('debug', 'debug', 'boolean', null, false);
    cfg.useLLM = true;
    cfg.cbsEnabled = getVal('cbsEnabled', 'cbs_enabled', 'boolean', null, true);
    cfg.useLorebookRAG = getVal('useLorebookRAG', 'use_lorebook_rag', 'boolean', null, true);
    cfg.emotionEnabled = getVal('emotionEnabled', 'emotion_enabled', 'boolean', null, true);
    cfg.storyAuthorEnabled = getVal('storyAuthorEnabled', 'story_author_enabled', 'boolean', null, true);
    cfg.gcBatchSize = getVal('gcBatchSize', 'gc_batch_size', 'number', null, MEMORY_PRESETS.general.gcBatchSize);
    cfg.memoryPreset = getVal('memoryPreset', 'memory_preset', 'string', null, inferMemoryPreset(cfg));
    cfg.worldAdjustmentMode = getVal('worldAdjustmentMode', 'world_adjustment_mode', 'string', null, 'dynamic');
    cfg.storyAuthorMode = getVal('storyAuthorMode', 'story_author_mode', 'string', null, 'proactive');
    cfg.directorEnabled = getVal('directorEnabled', 'director_enabled', 'boolean', null, true);
    cfg.directorMode = getVal('directorMode', 'director_mode', 'string', null, 'strong');
    if (!cfg.storyAuthorEnabled || cfg.storyAuthorMode === 'disabled') {
        cfg.storyAuthorEnabled = false;
        cfg.storyAuthorMode = 'disabled';
    } else {
        cfg.storyAuthorEnabled = true;
    }
    if (!cfg.directorEnabled || cfg.directorMode === 'disabled') {
        cfg.directorEnabled = false;
        cfg.directorMode = 'disabled';
    } else {
        cfg.directorEnabled = true;
    }

    cfg.llm = {
        provider: getVal('provider', 'llm_provider', 'string', 'llm', 'openai'),
        url: getVal('url', 'llm_url', 'string', 'llm', ''),
        key: getVal('key', 'llm_key', 'string', 'llm', ''),
        model: getVal('model', 'llm_model', 'string', 'llm', 'gpt-4o-mini'),
        temp: getVal('temp', 'llm_temp', 'number', 'llm', 0.3),
        timeout: getVal('timeout', 'llm_timeout', 'number', 'llm', 120000),
        reasoningEffort: getVal('reasoningEffort', 'llm_reasoning_effort', 'string', 'llm', 'none'),
        reasoningBudgetTokens: getVal('reasoningBudgetTokens', 'llm_reasoning_budget_tokens', 'number', 'llm', 0)
    };
    cfg.auxLlm = {
        enabled: getVal('enabled', 'aux_llm_enabled', 'boolean', 'auxLlm', false),
        provider: getVal('provider', 'aux_llm_provider', 'string', 'auxLlm', cfg.llm.provider || 'openai'),
        url: getVal('url', 'aux_llm_url', 'string', 'auxLlm', cfg.llm.url || ''),
        key: getVal('key', 'aux_llm_key', 'string', 'auxLlm', ''),
        model: getVal('model', 'aux_llm_model', 'string', 'auxLlm', cfg.llm.model || 'gpt-4o-mini'),
        temp: getVal('temp', 'aux_llm_temp', 'number', 'auxLlm', 0.2),
        timeout: getVal('timeout', 'aux_llm_timeout', 'number', 'auxLlm', 90000),
        reasoningEffort: getVal('reasoningEffort', 'aux_llm_reasoning_effort', 'string', 'auxLlm', 'none'),
        reasoningBudgetTokens: getVal('reasoningBudgetTokens', 'aux_llm_reasoning_budget_tokens', 'number', 'auxLlm', 0)
    };
    if (!cfg.auxLlm.enabled || !String(cfg.auxLlm.key || '').trim()) {
        cfg.auxLlm.enabled = false;
    }

    cfg.embed = {
        provider: getVal('provider', 'embed_provider', 'string', 'embed', 'openai'),
        url: getVal('url', 'embed_url', 'string', 'embed', ''),
        key: getVal('key', 'embed_key', 'string', 'embed', ''),
        model: getVal('model', 'embed_model', 'string', 'embed', 'text-embedding-3-small'),
        timeout: getVal('timeout', 'embed_timeout', 'number', 'embed', 120000)
    };
    const mode = (getVal('weightMode', 'weight_mode', 'string', null, 'auto')).toLowerCase();
    cfg.weightMode = mode;

    const customWeights = {
        similarity: getVal('w_sim', 'w_sim', 'number', null, WEIGHT_MODE_PRESETS.auto.similarity),
        importance: getVal('w_imp', 'w_imp', 'number', null, WEIGHT_MODE_PRESETS.auto.importance),
        recency: getVal('w_rec', 'w_rec', 'number', null, WEIGHT_MODE_PRESETS.auto.recency)
    };
    cfg.weights = resolveWeightsForMode(mode, customWeights);
};

// Initialize
(async () => {
    try {
        console.log('[LIBRA] v3.0.0 Initializing...');
        await updateConfigFromArgs();

        if (typeof risuai !== 'undefined') {
            const char = await risuai.getCharacter();
            if (char) {
                const chat = char?.chats?.[char.chatPage];
                // 세션 ID 생성
                MemoryState.currentSessionId = `sess_${chat?.id || 'global'}_${Date.now()}`;
                MemoryState._activeChatId = chat?.id || null;

                if (chat) {
                    const lore = (chat.localLore) || char.lorebook || [];
                    if (Array.isArray(lore)) {
                        MemoryEngine.rebuildIndex(lore);
                        HierarchicalWorldManager.loadWorldGraph(lore);
                        EntityManager.rebuildCache(lore);
                        NarrativeTracker.loadState(lore);
                        StoryAuthor.loadState(lore);
                        Director.loadState(lore);
                        CharacterStateTracker.loadState(lore);
                        WorldStateTracker.loadState(lore);
                        // 저장된 메모리 중 가장 최신 턴으로 setTurn 초기화
                        const managed = MemoryEngine.getManagedEntries(lore);
                        const maxTurn = deriveMaxTurnFromLorebook(lore);
                        MemoryEngine.setTurn(maxTurn);
                    }
                }
            }
        }

        MemoryState.isInitialized = true;
        // afterRequest-based memory commits depend on the recovery poller;
        // when init completes before _lazyInit runs, start it explicitly here.
        TurnRecoveryEngine.startPolling();
        const activeCfg = MemoryEngine.CONFIG;
        const embedStatus = (activeCfg.embed?.url && activeCfg.embed?.key) ? `${activeCfg.embed.provider}/${activeCfg.embed.model}` : 'disabled (fallback to Jaccard)';
        console.log(`[LIBRA] v3.0.0 Ready. LLM=${activeCfg.useLLM} | Mode=${activeCfg.weightMode} | Embed=${embedStatus}`);
        
        // Memory Carry-Over 및 Cold Start 감지 실행
        if (typeof risuai !== 'undefined') {
            setTimeout(async () => {
                try {
                    const currentChar = await risuai.getCharacter();
                    const currentChat = currentChar?.chats?.[currentChar?.chatPage];
                    const currentLore = currentChat ? ((currentChat.localLore) || currentChar.lorebook || []) : [];
                    if (currentChar && currentChat && Array.isArray(currentLore)) {
                        await RefreshCheckpointManager.restoreIfAhead(currentChar, currentChat, currentLore);
                    }
                } catch (checkpointError) {
                    console.warn('[LIBRA] Refresh checkpoint restore skipped:', checkpointError?.message || checkpointError);
                }

                const restored = await TransitionManager.restoreTransition();
                if (!restored) {
                    await ColdStartManager.check();
                }
            }, 2000);
        }
    } catch (e) {
        console.error("[LIBRA] Init Error:", e?.message || e);
    }
})();

// ══════════════════════════════════════════════════════════════
// [GUI] LIBRA World Manager UI (V1.1 Rendering Method Applied)
// ══════════════════════════════════════════════════════════════
const LMAI_GUI = (() => {
    const GUI_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#1a1a2e;--bg2:#16213e;--bg3:#0f3460;--accent:#533483;--accent2:#6a44a0;--text:#e0e0e0;--text2:#a0a0b0;--border:#2a2a4a;--success:#2ecc71;--danger:#e74c3c;--radius:8px}
.lmai-overlay{position:fixed;top:0;left:0;width:100%;height:100%;padding:16px;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:'Segoe UI',system-ui,sans-serif;color:var(--text);overflow:auto}
.gui-wrap{width:min(100%,720px);max-height:calc(100vh - 32px);height:min(85vh,960px);background:var(--bg);border-radius:12px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.5)}
.hdr{background:var(--bg2);border-bottom:1px solid var(--border);padding:10px 14px;display:flex;align-items:center;gap:10px;flex-shrink:0;flex-wrap:wrap}
.hdr h1{font-size:15px;font-weight:600;white-space:nowrap;margin:0}
.tabs{display:flex;gap:3px;background:var(--bg);border-radius:var(--radius);padding:3px;flex:1;min-width:0;overflow:auto}
.tb{flex:1;padding:5px 8px;border:none;background:transparent;color:var(--text2);cursor:pointer;border-radius:6px;font-size:12px;transition:all .2s}
.tb:hover{background:var(--bg3);color:var(--text)}
.tb.on{background:var(--accent);color:#fff}
.xbtn{background:transparent;border:none;color:var(--text2);cursor:pointer;font-size:17px;padding:3px 8px;border-radius:var(--radius);transition:all .2s}
.xbtn:hover{background:var(--danger);color:#fff}
.content{flex:1;overflow:hidden;min-height:0}
.panel{display:none;height:100%;overflow-y:auto;padding:14px;min-height:0;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
.panel.on{display:block}
.toolbar{display:flex;gap:7px;align-items:center;margin-bottom:10px;flex-wrap:wrap}
input,select,textarea{background:var(--bg2);border:1px solid var(--border);color:var(--text);padding:5px 9px;border-radius:var(--radius);font-size:13px;outline:none;transition:border-color .2s}
input:focus,select:focus,textarea:focus{border-color:var(--accent2)}
.si{flex:1;min-width:150px}
.stat{font-size:12px;color:var(--text2);white-space:nowrap}
.list{display:flex;flex-direction:column;gap:7px}
.card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:11px;transition:border-color .2s}
.card:hover{border-color:var(--accent2)}
.card-hdr{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:7px;gap:8px}
.card-meta{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:5px}
.hint{margin-top:6px;font-size:11px;color:var(--text2);line-height:1.45}
.bdg{font-size:11px;padding:2px 7px;border-radius:10px;font-weight:500;white-space:nowrap}
.bh{background:#2d4a2d;color:#5dbb5d}
.bm{background:#4a3d1a;color:#c89c1a}
.bl{background:#2a2a2a;color:#888}
.bt{background:var(--bg3);color:var(--text2)}
.acts{display:flex;gap:5px;flex-shrink:0;flex-wrap:wrap}
.btn{padding:6px 10px;border:none;border-radius:var(--radius);font-size:12px;cursor:pointer;transition:all .2s;min-height:32px}
.bp{background:var(--accent);color:#fff}.bp:hover{background:var(--accent2)}
.bs{background:var(--success);color:#fff}.bs:hover{opacity:0.85}
.bd{background:transparent;border:1px solid var(--danger);color:var(--danger)}.bd:hover{background:var(--danger);color:#fff}
.sec{font-size:12px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin:14px 0 7px;border-bottom:1px solid var(--border);padding-bottom:5px}
.sec:first-child{margin-top:0}
.sgrid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.ss{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:14px}
.ss h3{font-size:12px;margin-bottom:10px;color:var(--text2)}
.fld{display:flex;flex-direction:column;gap:3px;margin-bottom:9px}
.fld label{font-size:11px;color:var(--text2)}
.fld input,.fld select,.fld textarea{width:100%}
.tr{display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)}
.tr:last-child{border-bottom:none}
.tr label{font-size:13px}
.tog{position:relative;width:34px;height:19px}
.tog input{opacity:0;width:0;height:0}
.tsl{position:absolute;top:0;left:0;right:0;bottom:0;background:var(--border);border-radius:19px;cursor:pointer;transition:.2s}
.tsl:before{content:'';position:absolute;width:15px;height:15px;left:2px;bottom:2px;background:#fff;border-radius:50%;transition:.2s}
.tog input:checked+.tsl{background:var(--accent)}
.tog input:checked+.tsl:before{transform:translateX(15px)}
.wt{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:10px;margin-bottom:10px;min-height:60px}
.wn{display:flex;align-items:center;gap:7px;padding:5px 8px;border-radius:var(--radius);cursor:pointer;transition:background .2s}
.wn:hover{background:var(--bg3)}
.wn.cur{background:var(--accent)}
.wn-name{font-size:13px}
.wn-layer{font-size:11px;color:var(--text2)}
.sbar{position:sticky;bottom:0;background:var(--bg2);border-top:1px solid var(--border);padding:9px 14px;display:flex;gap:7px;flex-wrap:wrap}
.toast{position:fixed;bottom:65px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;padding:7px 18px;border-radius:18px;font-size:13px;opacity:0;transition:opacity .3s;pointer-events:none;z-index:999;white-space:nowrap}
.toast.on{opacity:1}
.ec{width:100%;background:var(--bg);border:1px solid transparent;color:var(--text);padding:3px 5px;border-radius:4px;font-size:12px;line-height:1.5;resize:none;transition:border-color .2s}
.ec:focus{border-color:var(--accent2);outline:none}
.rw{display:flex;gap:7px;align-items:center}
.rw input[type=range]{flex:1;accent-color:var(--accent)}
.rv{min-width:28px;text-align:right;font-size:12px;color:var(--text2)}
.empty{text-align:center;color:var(--text2);font-size:13px;padding:30px 0}
.cs{display:flex;gap:10px;flex-wrap:wrap;margin-top:7px}
.ci{background:var(--bg3);padding:5px 11px;border-radius:var(--radius);font-size:12px;color:var(--text2)}
.ef{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:5px}
.add-form{background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:10px;margin-bottom:10px;display:none}
.add-form.on{display:block}
@media(max-width:780px){
  .lmai-overlay{padding:0;align-items:stretch;justify-content:stretch}
  .gui-wrap{width:100%;max-width:100%;height:100dvh;max-height:100dvh;border-radius:0}
  .hdr{position:sticky;top:0;z-index:2;padding:10px 10px 8px}
  .hdr h1{width:100%;white-space:normal;line-height:1.35}
  .tabs{width:100%;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));overflow:visible}
  .tb{font-size:11px;padding:8px 6px}
  .xbtn{margin-left:auto}
  .sgrid,.ef{grid-template-columns:1fr}
  .toolbar{display:grid;grid-template-columns:1fr 1fr;align-items:stretch}
  .toolbar > *{min-width:0}
  .toolbar .si,.toolbar .stat{grid-column:1 / -1}
  .toolbar .btn,.toolbar select,.toolbar input{width:100%}
  .card-hdr{flex-direction:column;align-items:stretch}
  .acts{width:100%;justify-content:flex-end}
  .sbar > .btn{flex:1 1 100%}
  .rw{flex-wrap:wrap}
  .rv{min-width:36px}
  .wt{min-height:72px}
}
@media(max-width:480px){
  .tabs{grid-template-columns:repeat(2,minmax(0,1fr))}
  .panel{padding:10px}
  .toolbar{grid-template-columns:1fr}
  .toolbar .si,.toolbar .stat{grid-column:auto}
  .acts{justify-content:stretch}
  .acts .btn{flex:1 1 100%}
}
    `;

    const GUI_BODY = `
<div class="gui-wrap">
<div class="hdr">
  <h1>📚 LIBRA World Manager <span style="font-size:0.7rem; font-weight:normal; opacity:0.5;">v3.0.0</span></h1>
  <div class="tabs">
    <button class="tb on" data-tab="memory">📚 메모리</button>
    <button class="tb" data-tab="entity">👤 엔티티</button>
    <button class="tb" data-tab="narrative">🧵 내러티브</button>
    <button class="tb" data-tab="world">🌍 세계관</button>
    <button class="tb" data-tab="settings">⚙ 설정</button>
  </div>
  <button class="xbtn" id="xbtn">✕</button>
</div>
<div class="content">
  <div id="tab-memory" class="panel on">
    <div class="toolbar">
      <input type="text" id="ms" class="si" placeholder="🔍 메모리 검색...">
      <select id="mf">
        <option value="all">전체 중요도</option>
        <option value="h">높음 (7+)</option>
        <option value="m">중간 (4-6)</option>
        <option value="l">낮음 (1-3)</option>
      </select>
      <span class="stat">총 <strong id="mc">0</strong>개</span>
      <button class="btn bs" id="btn-toggle-add-mem">➕ 추가</button>
      <button class="btn bp" id="btn-save-all-mem">💾 저장</button>
    </div>
    <div id="amf" class="add-form">
      <div class="fld"><label>내용</label><textarea id="am-c" rows="3" class="ec" placeholder="새 메모리 내용..."></textarea></div>
      <div class="ef">
        <div class="fld"><label>중요도 (1-10)</label><input type="number" id="am-i" min="1" max="10" value="5"></div>
        <div class="fld"><label>카테고리</label><input type="text" id="am-cat" placeholder="일반"></div>
      </div>
      <div style="display:flex;gap:5px;margin-top:5px">
        <button class="btn bs" id="btn-add-mem">추가</button>
        <button class="btn bd" id="btn-cancel-mem">취소</button>
      </div>
    </div>
    <div id="ml" class="list"></div>
  </div>
  <div id="tab-entity" class="panel">
    <div class="toolbar">
      <button class="btn bs" id="btn-toggle-add-ent">➕ 인물 추가</button>
      <button class="btn bs" id="btn-toggle-add-rel">➕ 관계 추가</button>
      <button class="btn bp" id="btn-save-ents">💾 저장</button>
    </div>
    <div id="aef" class="add-form">
      <div class="fld"><label>이름</label><input type="text" id="ae-name" placeholder="캐릭터 이름"></div>
      <div class="ef">
        <div class="fld"><label>직업</label><input type="text" id="ae-occ" placeholder="직업"></div>
        <div class="fld"><label>위치</label><input type="text" id="ae-loc" placeholder="현재 위치"></div>
      </div>
      <div class="fld"><label>외모 특징 (쉼표 구분)</label><input type="text" id="ae-feat" placeholder="검은 머리, 키 큰"></div>
      <div class="fld"><label>성격 특성 (쉼표 구분)</label><input type="text" id="ae-trait" placeholder="친절한, 용감한"></div>
      <div class="fld"><label>성관념</label><input type="text" id="ae-sexual-orientation" placeholder="개방적, 보수적"></div>
      <div class="fld"><label>성적취향 (쉼표 구분)</label><input type="text" id="ae-sexual-preferences" placeholder="이성애, S성향"></div>
      <div style="display:flex;gap:5px;margin-top:5px">
        <button class="btn bs" id="btn-add-ent">추가</button>
        <button class="btn bd" id="btn-cancel-ent">취소</button>
      </div>
    </div>
    <div id="arf" class="add-form">
      <div class="ef">
        <div class="fld"><label>인물 A</label><input type="text" id="ar-a" placeholder="인물 A"></div>
        <div class="fld"><label>인물 B</label><input type="text" id="ar-b" placeholder="인물 B"></div>
      </div>
      <div class="ef">
        <div class="fld"><label>관계 유형</label><input type="text" id="ar-type" placeholder="친구, 연인 등"></div>
        <div class="fld"><label>친밀도</label><div class="rw"><input type="range" id="ar-cls" min="0" max="100" value="50"><span id="ar-clsv" class="rv">50</span></div></div>
      </div>
      <div class="ef">
        <div class="fld"><label>신뢰도</label><div class="rw"><input type="range" id="ar-trs" min="0" max="100" value="50"><span id="ar-trsv" class="rv">50</span></div></div>
        <div class="fld"><label>감정 (A→B)</label><input type="text" id="ar-sent" placeholder="호감, 경계 등"></div>
      </div>
      <div style="display:flex;gap:5px;margin-top:5px">
        <button class="btn bs" id="btn-add-rel">추가</button>
        <button class="btn bd" id="btn-cancel-rel">취소</button>
      </div>
    </div>
    <div class="sec">👥 인물 목록</div>
    <div id="el" class="list"></div>
    <div class="sec">🤝 관계 목록</div>
    <div id="rl" class="list"></div>
  </div>
  <div id="tab-narrative" class="panel">
    <div class="toolbar">
      <span class="stat">총 <strong id="nc">0</strong>개 스토리라인</span>
      <button class="btn bs" id="btn-add-narrative">➕ 스토리라인 추가</button>
      <button class="btn bp" id="btn-save-narrative">💾 내러티브 저장</button>
    </div>
    <div id="narrative-list" class="list"></div>
  </div>
  <div id="tab-world" class="panel">
    <div class="sec">🗺 세계관 트리</div>
    <div id="wt" class="wt"></div>
    <div class="sec">🌐 전역 기능</div>
    <div class="wt">
      <div class="tr"><label>멀티버스</label><label class="tog"><input type="checkbox" id="w1"><span class="tsl"></span></label></div>
      <div class="tr"><label>차원 이동</label><label class="tog"><input type="checkbox" id="w2"><span class="tsl"></span></label></div>
      <div class="tr"><label>시간 여행</label><label class="tog"><input type="checkbox" id="w3"><span class="tsl"></span></label></div>
      <div class="tr"><label>메타 서술</label><label class="tog"><input type="checkbox" id="w4"><span class="tsl"></span></label></div>
    </div>
    <div class="sec">📋 현재 세계 규칙</div>
    <div id="wr" class="wt" style="font-size:12px"></div>
    <div class="sbar"><button class="btn bp" id="btn-save-world">💾 세계관 저장</button></div>
  </div>
  <div id="tab-settings" class="panel">
    <div class="sgrid">
      <div class="ss">
        <h3>🤖 LLM 설정</h3>
        <div class="fld"><label>Provider</label><select id="slp"><option value="openai">OpenAI</option><option value="claude">Claude</option><option value="gemini">Gemini</option><option value="openrouter">OpenRouter</option><option value="vertex">Vertex</option><option value="copilot">Copilot</option><option value="custom">Custom</option></select></div>
        <div class="fld"><label>URL</label><input type="text" id="slu" placeholder="https://api.openai.com/v1/chat/completions"></div>
        <div class="fld"><label>API Key</label><input type="password" id="slk" placeholder="sk-..."></div>
        <div class="fld"><label>Model</label><input type="text" id="slm" placeholder="gpt-4o-mini"></div>
        <div class="fld"><label>Temperature</label><div class="rw"><input type="range" id="slt" min="0" max="1" step="0.1"><span id="sltv" class="rv">0.3</span></div></div>
        <div class="fld"><label>Timeout (ms)</label><input type="number" id="slto" placeholder="120000"></div>
        <div class="fld"><label>Reasoning Effort</label><select id="slre"><option value="none">사용 안 함</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
        <div class="fld"><label>Reasoning Budget Tokens</label><input type="number" id="slrb" placeholder="0"></div>
      </div>
      <div class="ss">
        <h3>⚡ 보조 LLM 설정</h3>
        <div class="tr"><label>듀얼 LLM 사용</label><label class="tog"><input type="checkbox" id="sax"><span class="tsl"></span></label></div>
        <div class="fld"><label>Provider</label><select id="saxp"><option value="openai">OpenAI</option><option value="claude">Claude</option><option value="gemini">Gemini</option><option value="openrouter">OpenRouter</option><option value="vertex">Vertex</option><option value="copilot">Copilot</option><option value="custom">Custom</option></select></div>
        <div class="fld"><label>URL</label><input type="text" id="saxu" placeholder="비우면 메인 URL 폴백"></div>
        <div class="fld"><label>API Key</label><input type="password" id="saxk" placeholder="비우면 메인 LLM 사용"></div>
        <div class="fld"><label>Model</label><input type="text" id="saxm" placeholder="gpt-4o-mini"></div>
        <div class="fld"><label>Temperature</label><div class="rw"><input type="range" id="saxt" min="0" max="1" step="0.1"><span id="saxtv" class="rv">0.2</span></div></div>
        <div class="fld"><label>Timeout (ms)</label><input type="number" id="saxto" placeholder="90000"></div>
        <div class="fld"><label>Reasoning Effort</label><select id="saxre"><option value="none">사용 안 함</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
        <div class="fld"><label>Reasoning Budget Tokens</label><input type="number" id="saxrb" placeholder="0"></div>
      </div>
      <div class="ss">
        <h3>🧠 Embedding 설정</h3>
        <div class="fld"><label>Provider</label><select id="sep"><option value="openai">OpenAI</option><option value="gemini">Gemini</option><option value="vertex">Vertex</option><option value="voyageai">VoyageAI</option><option value="custom">Custom</option></select></div>
        <div class="fld"><label>URL</label><input type="text" id="seu" placeholder="https://api.openai.com/v1/embeddings"></div>
        <div class="fld"><label>API Key</label><input type="password" id="sek" placeholder="sk-..."></div>
        <div class="fld"><label>Model</label><input type="text" id="sem" placeholder="text-embedding-3-small"></div>
        <div class="fld"><label>Timeout (ms)</label><input type="number" id="seto" placeholder="120000"></div>
      </div>
      <div class="ss">
        <h3>💾 메모리 설정</h3>
        <div class="fld"><label>프리셋</label><select id="smp"><option value="general">일반봇</option><option value="sim_small">소규모 시뮬봇</option><option value="sim_medium">중규모 시뮬봇</option><option value="sim_large">대규모 시뮬봇</option><option value="custom">커스텀</option></select></div>
        <div class="fld"><label>최대 메모리 수</label><input type="number" id="sml" placeholder="200"></div>
        <div class="fld"><label>중요도 임계값</label><input type="number" id="sth" placeholder="5"></div>
        <div class="fld"><label>유사도 임계값</label><div class="rw"><input type="range" id="sst" min="0" max="1" step="0.05"><span id="sstv" class="rv">0.25</span></div></div>
        <div class="fld"><label>GC 배치 크기</label><input type="number" id="sgc" placeholder="5"></div>
      </div>
      <div class="ss">
        <h3>📜 과거 대화 분석</h3>
            <div class="fld"><label>분석 범위 프리셋</label><select id="scsp"><option value="all">전체</option><option value="partial_100">부분(100)</option><option value="partial_300">부분(300)</option></select></div>
        <div style="display:flex;gap:7px;flex-wrap:wrap">
          <button class="btn bp" id="btn-cold-start">🔄 과거 대화 분석</button>
          <button class="btn bp" id="btn-cold-reanalyze">♻️ 과거 대화 재분석</button>
          <button class="btn bs" id="btn-import-hypa-v3">📥 하이파 V3 → 로어북</button>
        </div>
      </div>
      <div class="ss">
        <h3>🔧 플러그인 기능</h3>
        <div class="tr"><label>CBS 엔진 사용</label><label class="tog"><input type="checkbox" id="scbs" title="매크로 및 조건부 텍스트({{...}})를 처리합니다."><span class="tsl"></span></label></div>
        <div class="tr"><label>로어북 동적 참조 (RAG)</label><label class="tog"><input type="checkbox" id="slrag" title="일반 로어북의 설정도 검색하여 AI에게 전달합니다."><span class="tsl"></span></label></div>
        <div class="tr"><label>감정 분석 사용</label><label class="tog"><input type="checkbox" id="semo" title="감정 분석 엔진을 활성화합니다."><span class="tsl"></span></label></div>
        <div class="tr"><label>디버그 모드</label><label class="tog"><input type="checkbox" id="sdb"><span class="tsl"></span></label></div>
      </div>
      <div class="ss">
        <h3>⚖ 가중치 & 모드</h3>
        <div class="fld"><label>가중치 모드</label>
          <select id="swm">
            <option value="auto">자동 (장르 감지)</option>
            <option value="romance">로맨스</option>
            <option value="action">액션</option>
            <option value="mystery">미스터리</option>
            <option value="daily">일상</option>
            <option value="custom">커스텀</option>
          </select>
        </div>
        <div id="cw" style="display:none">
          <div class="fld"><label>유사도 <span id="wsv" class="rv">0.50</span></label><input type="range" id="sws" min="0" max="1" step="0.05"></div>
          <div class="fld"><label>중요도 <span id="wiv" class="rv">0.30</span></label><input type="range" id="swi" min="0" max="1" step="0.05"></div>
          <div class="fld"><label>최신성 <span id="wrv" class="rv">0.20</span></label><input type="range" id="swr" min="0" max="1" step="0.05"></div>
        </div>
        <div class="fld"><label>세계관 조정 모드</label>
          <select id="sam">
            <option value="dynamic">다이내믹 (맥락 기반)</option>
            <option value="soft">소프트 (자동 조정)</option>
            <option value="hard">하드 (엄격 거부)</option>
          </select>
        </div>
      </div>
      <div class="ss">
        <h3>🧪 고급</h3>
        <div class="fld"><label>스토리 작가 모드</label>
          <select id="ssam">
            <option value="disabled">비활성</option>
            <option value="supportive">서포트형</option>
            <option value="proactive">주도형</option>
            <option value="aggressive">강공형</option>
          </select>
        </div>
        <div class="fld"><label>감독 모드</label>
          <select id="sdm">
            <option value="disabled">비활성</option>
            <option value="light">라이트</option>
            <option value="standard">표준</option>
            <option value="strong">강함</option>
            <option value="absolute">절대감독</option>
          </select>
        </div>
      </div>
    </div>
    <div class="sec">📊 캐시 통계</div>
    <div id="cst" class="cs"></div>
    <div class="sbar">
      <button class="btn bp" id="btn-transition">🚀 다음 세션으로 대화 이어가기</button>
      <button class="btn bp" id="btn-save-settings">💾 설정 저장</button>
      <button class="btn bd" id="btn-reset-settings">🔄 초기화</button>
    </div>
  </div>
</div>
</div>
<div id="toast" class="toast"></div>
    `;

    const show = async () => {
        const R = (typeof Risuai !== 'undefined') ? Risuai : (typeof risuai !== 'undefined' ? risuai : null);
        if (!R) return;

        // 기존 레이어가 있다면 제거
        const existingOverlay = document.getElementById('lmai-overlay');
        if (existingOverlay) existingOverlay.remove();

        // 1. V1.1 방식: DOM 엘리먼트 직접 생성 (보안정책 우회)
        const overlay = document.createElement('div');
        overlay.id = 'lmai-overlay';
        overlay.className = 'lmai-overlay';
        
        // CSS 주입
        const style = document.createElement('style');
        style.textContent = GUI_CSS;
        overlay.appendChild(style);

        // 본문 주입
        const bodyWrap = document.createElement('div');
        bodyWrap.style.width = '100%';
        bodyWrap.style.display = 'flex';
        bodyWrap.style.justifyContent = 'center';
        bodyWrap.innerHTML = GUI_BODY;
        overlay.appendChild(bodyWrap);

        document.body.appendChild(overlay);

        // 2. 데이터 준비
        const char = await R.getCharacter();
        const chat = char?.chats?.[char.chatPage];
        let lore = char ? (MemoryEngine.getLorebook(char, chat) || []) : [];

        let _MEM = lore.filter(e => e.comment === 'lmai_memory');
        let _ENT = lore.filter(e => e.comment === 'lmai_entity');
        let _REL = lore.filter(e => e.comment === 'lmai_relation');
        const narrativeEntry = lore.find(e => e.comment === 'lmai_narrative');
        const worldEntry = lore.find(e => e.comment === 'lmai_world_graph');
        let _NAR = { storylines: [], turnLog: [], lastSummaryTurn: 0 };
        try {
            if (narrativeEntry) {
                _NAR = JSON.parse(narrativeEntry.content);
            } else {
                _NAR = safeClone(NarrativeTracker.getState?.() || _NAR);
            }
        } catch {}

        let _WLD = { nodes: [], activePath: [], global: {}, rootId: null };
        try {
            if (worldEntry) {
                const p = JSON.parse(worldEntry.content);
                _WLD = {
                    ...p,
                    nodes: p.nodes instanceof Map ? Array.from(p.nodes.entries()) : Array.isArray(p.nodes) ? p.nodes : Object.entries(p.nodes || {})
                };
            } else {
                const profile = HierarchicalWorldManager.getProfile();
                if (profile) {
                    _WLD = { nodes: Array.from(profile.nodes.entries()), activePath: profile.activePath || [], global: profile.global || {}, rootId: profile.rootId };
                }
            }
        } catch {}

        let _CFG = { ...MemoryEngine.CONFIG };
        try {
            const saved = await R.pluginStorage.getItem('LMAI_Config');
            if (saved) {
                const p = typeof saved === 'string' ? JSON.parse(saved) : saved;
                _CFG = { ..._CFG, ...p };
            }
        } catch {}

        // 유틸리티 함수
        const esc = (s) => { const d = document.createElement("div"); d.appendChild(document.createTextNode(s||"")); return d.innerHTML; };
        const escAttr = (s) => esc(s).replace(/"/g,"&quot;").replace(/'/g,"&#39;");
        const toast = (m, d) => { const t = overlay.querySelector("#toast"); t.textContent = m; t.classList.add("on"); setTimeout(() => t.classList.remove("on"), d||2000); };
        const parseMeta = (c) => { var m=(c||"").match(/\[META:(\{.*?\})\]/); if(!m)return{imp:5,t:0,ttl:0,cat:""}; try{return JSON.parse(m[1]);}catch(e){return{imp:5,t:0,ttl:0,cat:""};} };
        const stripMeta = (c) => (c||"").replace(/\[META:\{.*?\}\]/g,"").trim();
        const impBdg = (i) => { const cls = i>=7?"bh":i>=4?"bm":"bl"; return `<span class="bdg ${cls}">중요도 ${i}</span>`; };
        
        const saveLoreToChar = async (newLore, cb) => {
            if (!char) return;
            await loreLock.writeLock();
            try {
                const targetChat = char.chats?.[char.chatPage];
                if (targetChat && Array.isArray(targetChat.localLore)) targetChat.localLore = newLore;
                else if (Array.isArray(char.lorebook)) char.lorebook = newLore;
                else if (targetChat) targetChat.localLore = newLore;
                await persistLoreToActiveChat(targetChat, newLore);
                lore = Array.isArray(newLore) ? [...newLore] : [];
                MemoryEngine.rebuildIndex(lore);
                HierarchicalWorldManager.loadWorldGraph(lore);
                EntityManager.rebuildCache(lore);
                NarrativeTracker.loadState(lore);
                StoryAuthor.loadState(lore);
                Director.loadState(lore);
                CharacterStateTracker.loadState(lore);
                WorldStateTracker.loadState(lore);
                if (cb) cb();
            } catch (e) {
                toast("❌ 저장 실패");
                console.error("[LIBRA] Save Error:", e);
            } finally {
                loreLock.writeUnlock();
            }
        };

        const getHypaScopeId = (targetChar) => {
            if (!targetChar) return null;
            const directId = String(targetChar?.chaId || targetChar?.id || targetChar?._id || '').replace(/[^0-9a-zA-Z_-]/g, '');
            if (directId) return directId;
            const fallbackName = String(targetChar?.name || '').trim();
            return fallbackName ? `name_${TokenizerEngine.simpleHash(fallbackName)}` : null;
        };

        const splitHypaKeys = (raw) => String(raw || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

        const importHypaV3ToLorebook = async () => {
            if (!char) {
                toast("❌ 캐릭터를 찾을 수 없습니다");
                return;
            }
            const scopeId = getHypaScopeId(char);
            if (!scopeId) {
                toast("❌ 하이파 V3 scopeId를 만들 수 없습니다");
                return;
            }
            const scopedKey = `static_knowledge_chunks::${scopeId}`;
            let raw = null;
            try {
                raw = await R.pluginStorage.getItem(scopedKey);
                if (!raw) raw = await R.pluginStorage.getItem('static_knowledge_chunks');
            } catch (e) {
                console.error('[LIBRA] Hypa V3 load failed:', e);
            }
            if (!raw) {
                toast("❌ 하이파 V3 데이터가 없습니다");
                return;
            }

            let chunks = [];
            try {
                chunks = typeof raw === 'string' ? JSON.parse(raw) : raw;
            } catch (e) {
                console.error('[LIBRA] Hypa V3 parse failed:', e);
                toast("❌ 하이파 V3 데이터를 파싱하지 못했습니다");
                return;
            }
            if (!Array.isArray(chunks) || chunks.length === 0) {
                toast("❌ 가져올 하이파 V3 청크가 없습니다");
                return;
            }

            const imported = [];
            let index = 0;
            for (const chunk of chunks) {
                const content = String(chunk?.content || chunk?.text || chunk?.summary || '').trim();
                if (!content) continue;
                const primaryKeys = Array.isArray(chunk?.keys) && chunk.keys.length ? chunk.keys.map(k => String(k || '').trim()).filter(Boolean) : splitHypaKeys(chunk?.key);
                const secondaryKeys = splitHypaKeys(chunk?.secondkey);
                imported.push({
                    key: primaryKeys.join(', '),
                    secondkey: secondaryKeys.join(', '),
                    comment: 'hypa_v3_import',
                    content,
                    mode: 'normal',
                    insertorder: 95,
                    alwaysActive: chunk?.alwaysActive === true,
                    selective: chunk?.selective === true,
                    useRegex: chunk?.useRegex === true,
                    disable: false,
                    source: String(chunk?.source || 'Hypa V3'),
                    hypaChunkId: String(chunk?.id || `chunk_${index++}`)
                });
            }

            if (imported.length === 0) {
                toast("❌ 로어북으로 변환할 하이파 V3 내용이 없습니다");
                return;
            }

            const preserved = lore.filter(e => e.comment !== 'hypa_v3_import');
            await saveLoreToChar([...preserved, ...imported], () => {
                toast(`✅ 하이파 V3 ${imported.length}개 청크를 로어북으로 가져왔습니다`);
            });

            try {
                toast("🧠 하이파 V3 지식을 캐릭터/세계관에 반영 중...");
                await ColdStartManager.integrateImportedKnowledge(imported.map(entry => entry.content), 'Hypa V3');
                toast("✨ 하이파 V3 지식이 캐릭터/세계관에 반영되었습니다");
            } catch (e) {
                console.error('[LIBRA] Hypa V3 structural import failed:', e);
                toast(`⚠️ 로어북 가져오기는 완료됐지만 구조화 반영은 실패했습니다: ${e?.message || e}`);
            }
        };

        // UI 업데이트 로직
        const switchTab = (n) => {
            overlay.querySelectorAll(".panel").forEach(p => p.classList.remove("on"));
            overlay.querySelectorAll(".tb").forEach(b => {
                b.classList.remove("on");
                if (b.dataset.tab === n) b.classList.add("on");
            });
            overlay.querySelector("#tab-" + n).classList.add("on");
        };

        const renderMems = (list) => {
            const c = overlay.querySelector("#ml");
            overlay.querySelector("#mc").textContent = list.length;
            if (!list.length) { c.innerHTML = '<div class="empty">저장된 메모리가 없습니다</div>'; return; }
            c.innerHTML = list.map((m) => {
                const meta = parseMeta(m.content);
                const content = stripMeta(m.content);
                const idx = _MEM.indexOf(m);
                const ttl = meta.ttl === -1 ? "영구" : (meta.ttl || 0) + "turn";
                const originBadge = meta.source === 'narrative_source_record' ? `<span class="bdg bt">서사 요약 원본</span>` : '';
                return `<div class="card" id="mc-${idx}">
                    <div class="card-hdr">
                        <div class="card-meta">${impBdg(meta.imp||5)}<span class="bdg bt">턴 ${meta.t||0}</span><span class="bdg bt">TTL:${ttl}</span>${originBadge}${meta.cat ? `<span class="bdg bt">${esc(meta.cat)}</span>` : ''}</div>
                        <div class="acts">
                            <button class="btn bp act-save-mem" data-idx="${idx}">저장</button>
                            <button class="btn bd act-del-mem" data-idx="${idx}">삭제</button>
                        </div>
                    </div>
                    <textarea class="ec mt-val" data-idx="${idx}" rows="3">${esc(content)}</textarea>
                    ${meta.sourceHint ? `<div class="hint">${esc(meta.sourceHint)}</div>` : ''}
                    <div style="display:flex;gap:7px;align-items:center;margin-top:5px">
                        <label style="font-size:11px;color:var(--text2)">중요도:</label>
                        <input type="number" class="mi-val" data-idx="${idx}" min="1" max="10" value="${meta.imp||5}" style="width:55px">
                    </div>
                </div>`;
            }).join("");
        };

        const filterMems = () => {
            const q = overlay.querySelector("#ms").value.toLowerCase();
            const f = overlay.querySelector("#mf").value;
            const res = _MEM.filter(m => {
                const meta = parseMeta(m.content);
                const c = stripMeta(m.content).toLowerCase();
                const mq = !q || c.indexOf(q) >= 0;
                const mf = f === "h" ? (meta.imp || 5) >= 7 : f === "m" ? ((meta.imp || 5) >= 4 && (meta.imp || 5) < 7) : f === "l" ? (meta.imp || 5) < 4 : true;
                return mq && mf;
            });
            renderMems(res);
        };

        const renderEnts = () => {
            const ec = overlay.querySelector("#el");
            if (!_ENT.length) { ec.innerHTML = '<div class="empty">추적된 인물이 없습니다</div>'; }
            else {
                ec.innerHTML = _ENT.map((e, i) => {
                    let d = {}; try { d = JSON.parse(e.content); } catch (x) {}
                    const occ = (d.background && d.background.occupation) || "";
                    const loc = (d.status && d.status.currentLocation) || "";
                    const feats = (d.appearance && d.appearance.features || []).join(", ");
                    const traits = (d.personality && d.personality.traits || []).join(", ");
                    const sexualOrientation = (d.personality && d.personality.sexualOrientation) || "";
                    const sexualPreferences = (d.personality && d.personality.sexualPreferences || []).join(", ");
                    return `<div class="card">
                        <div class="card-hdr"><strong>${esc(d.name || e.key || "?")}</strong>
                            <div class="acts"><button class="btn bp act-save-ent" data-idx="${i}">저장</button><button class="btn bd act-del-ent" data-idx="${i}">삭제</button></div>
                        </div>
                        <div class="ef">
                            <div class="fld"><label>직업</label><input type="text" class="eo-val" data-idx="${i}" value="${escAttr(occ)}"></div>
                            <div class="fld"><label>위치</label><input type="text" class="eL-val" data-idx="${i}" value="${escAttr(loc)}"></div>
                        </div>
                        <div class="fld" style="margin-top:5px"><label>외모 특징</label><input type="text" class="eF-val" data-idx="${i}" value="${escAttr(feats)}"></div>
                        <div class="fld"><label>성격 특성</label><input type="text" class="eP-val" data-idx="${i}" value="${escAttr(traits)}"></div>
                        <div class="fld"><label>성관념</label><input type="text" class="eSO-val" data-idx="${i}" value="${escAttr(sexualOrientation)}"></div>
                        <div class="fld"><label>성적취향</label><input type="text" class="eSP-val" data-idx="${i}" value="${escAttr(sexualPreferences)}"></div>
                    </div>`;
                }).join("");
            }

            const rc = overlay.querySelector("#rl");
            if (!_REL.length) { rc.innerHTML = '<div class="empty">추적된 관계가 없습니다</div>'; }
            else {
                rc.innerHTML = _REL.map((r, i) => {
                    let d = {}; try { d = JSON.parse(r.content); } catch (x) {}
                    const cls = Math.round(((d.details && d.details.closeness) || 0) * 100);
                    const trs = Math.round(((d.details && d.details.trust) || 0) * 100);
                    return `<div class="card">
                        <div class="card-hdr"><strong>${esc(d.entityA || "?")} ↔ ${esc(d.entityB || "?")}</strong>
                            <div class="acts"><button class="btn bp act-save-rel" data-idx="${i}">저장</button><button class="btn bd act-del-rel" data-idx="${i}">삭제</button></div>
                        </div>
                        <div class="ef">
                            <div class="fld"><label>관계 유형</label><input type="text" class="rT-val" data-idx="${i}" value="${escAttr(d.relationType || "")}"></div>
                            <div class="fld"><label>감정 (A→B)</label><input type="text" class="rS-val" data-idx="${i}" value="${escAttr((d.sentiments && d.sentiments.fromAtoB) || "")}"></div>
                        </div>
                        <div class="ef">
                            <div class="fld"><label>친밀도 ${cls}%</label><div class="rw"><input type="range" class="rC-val" data-idx="${i}" min="0" max="100" value="${cls}"></div></div>
                            <div class="fld"><label>신뢰도 ${trs}%</label><div class="rw"><input type="range" class="rR-val" data-idx="${i}" min="0" max="100" value="${trs}"></div></div>
                        </div>
                    </div>`;
                }).join("");
            }
        };

        const formatNarrativeRecentEvents = (storyline) => {
            const events = Array.isArray(storyline?.recentEvents) ? storyline.recentEvents : [];
            return events.map(evt => {
                if (evt && typeof evt === 'object') {
                    const turn = evt.turn ?? '?';
                    const brief = String(evt.brief || '').trim();
                    return brief ? `T${turn}: ${brief}` : '';
                }
                return String(evt || '').trim();
            }).filter(Boolean).join("\n");
        };

        const formatNarrativeSummaryHistory = (storyline) => {
            const summaries = Array.isArray(storyline?.summaries) ? storyline.summaries : [];
            return summaries.map((entry, idx) => {
                const turn = entry?.upToTurn ?? '?';
                const summary = String(entry?.summary || '').trim();
                const keyPoints = Array.isArray(entry?.keyPoints) && entry.keyPoints.length > 0
                    ? ` | Key: ${entry.keyPoints.join('; ')}`
                    : '';
                const tensions = Array.isArray(entry?.ongoingTensions) && entry.ongoingTensions.length > 0
                    ? ` | Flow: ${entry.ongoingTensions.join('; ')}`
                    : '';
                return `${idx + 1}. T${turn} | ${summary}${keyPoints}${tensions}`.trim();
            }).filter(Boolean).join("\n");
        };

        const formatNarrativeTurnFlow = (storyline) => {
            const turns = new Set(Array.isArray(storyline?.turns) ? storyline.turns : []);
            const logs = Array.isArray(_NAR?.turnLog) ? _NAR.turnLog : [];
            return logs
                .filter(entry => turns.has(entry.turn))
                .map(entry => `T${entry.turn} | User: ${String(entry.userAction || '').trim()} | AI: ${String(entry.summary || entry.response || '').trim()}`)
                .join("\n\n");
        };

        const renderNarrative = () => {
            const list = overlay.querySelector("#narrative-list");
            const counter = overlay.querySelector("#nc");
            const storylines = Array.isArray(_NAR?.storylines) ? _NAR.storylines : [];
            counter.textContent = storylines.length;
            if (!storylines.length) {
                list.innerHTML = '<div class="empty">저장된 내러티브가 없습니다</div>';
                return;
            }

            list.innerHTML = storylines.map((storyline, i) => {
                const entities = Array.isArray(storyline.entities) ? storyline.entities.join(", ") : "";
                const keyPoints = Array.isArray(storyline.keyPoints) ? storyline.keyPoints.join(", ") : "";
                const recentEvents = formatNarrativeRecentEvents(storyline);
                const ongoingFlow = Array.isArray(storyline.ongoingTensions) ? storyline.ongoingTensions.join(", ") : "";
                const summaryHistory = formatNarrativeSummaryHistory(storyline);
                const turnFlow = formatNarrativeTurnFlow(storyline);
                const summary = Array.isArray(storyline.summaries) && storyline.summaries.length > 0
                    ? (storyline.summaries[storyline.summaries.length - 1]?.summary || "")
                    : "";
                return `<div class="card">
                    <div class="card-hdr">
                        <strong>${esc(storyline.name || `Storyline ${i + 1}`)}</strong>
                        <div class="acts">
                            <button class="btn bp act-save-nar" data-idx="${i}">저장</button>
                            <button class="btn bd act-del-nar" data-idx="${i}">삭제</button>
                        </div>
                    </div>
                    <div class="fld"><label>이름</label><input type="text" class="nN-val" data-idx="${i}" value="${escAttr(storyline.name || '')}"></div>
                    <div class="fld"><label>등장 인물 (쉼표 구분)</label><input type="text" class="nE-val" data-idx="${i}" value="${escAttr(entities)}"></div>
                    <div class="fld"><label>현재 맥락</label><textarea class="ec nC-val" data-idx="${i}" rows="3">${esc(storyline.currentContext || '')}</textarea></div>
                    <div class="fld"><label>핵심 포인트 (쉼표 구분)</label><input type="text" class="nK-val" data-idx="${i}" value="${escAttr(keyPoints)}"></div>
                    <div class="fld"><label>진행 중 흐름 (쉼표 구분)</label><input type="text" class="nO-val" data-idx="${i}" value="${escAttr(ongoingFlow)}"></div>
                    <div class="fld"><label>최근 이벤트 (줄바꿈 구분)</label><textarea class="ec nR-val" data-idx="${i}" rows="4">${esc(recentEvents)}</textarea></div>
                    <div class="fld"><label>최근 요약</label><textarea class="ec nS-val" data-idx="${i}" rows="3">${esc(summary)}</textarea></div>
                    <div class="fld"><label>요약 이력 (읽기 전용)</label><textarea class="ec" rows="6" readonly>${esc(summaryHistory)}</textarea></div>
                    <div class="fld"><label>턴별 서사 흐름 (읽기 전용)</label><textarea class="ec" rows="8" readonly>${esc(turnFlow)}</textarea></div>
                </div>`;
            }).join("");
        };

        const renderWorld = () => {
            const tc = overlay.querySelector("#wt");
            const rc = overlay.querySelector("#wr");
            if (!_WLD || !_WLD.nodes || !_WLD.nodes.length) { tc.innerHTML = '<div class="empty">세계관 데이터가 없습니다</div>'; return; }
            const ap = _WLD.activePath || [];
            
            const rn = (id, depth, visited) => {
                if (depth > 50 || visited.has(id)) return "";
                visited.add(id);
                let entry = null;
                for (let j = 0; j < _WLD.nodes.length; j++) { if (_WLD.nodes[j][0] === id) { entry = _WLD.nodes[j][1]; break; } }
                if (!entry) return "";
                const active = ap.indexOf(id) >= 0;
                const ind = depth * 14;
                let h = `<div class="wn${active ? " cur" : ""}" style="padding-left:${10 + ind}px">
                    ${depth > 0 ? "└ " : ""}<span class="wn-name">${esc(entry.name)}</span>
                    <span class="wn-layer">[${esc(entry.layer || "dim")}]</span>
                    ${active ? '<span class="bdg bh" style="margin-left:4px">현재</span>' : ''}</div>`;
                const ch = entry.children || [];
                for (let k = 0; k < ch.length; k++) h += rn(ch[k], depth + 1, visited);
                return h;
            };
            tc.innerHTML = _WLD.rootId ? rn(_WLD.rootId, 0, new Set()) : _WLD.nodes.map(n => `<div class="wn"><span class="wn-name">${esc((n[1] || {}).name || "?")}</span></div>`).join("");
            
            const g = _WLD.global || {};
            overlay.querySelector("#w1").checked = !!g.multiverse;
            overlay.querySelector("#w2").checked = !!g.dimensionTravel;
            overlay.querySelector("#w3").checked = !!g.timeTravel;
            overlay.querySelector("#w4").checked = !!g.metaNarrative;
            
            const lid = ap[ap.length - 1];
            let cn = null;
            if (lid) { for (let n = 0; n < _WLD.nodes.length; n++) { if (_WLD.nodes[n][0] === lid) { cn = _WLD.nodes[n][1]; break; } } }
            if (cn && cn.rules) {
                const r = cn.rules; const ex = r.exists || {}; const sys = r.systems || {}; const itms = [];
                if (ex.magic) itms.push("마법 ✓");
                if (ex.ki) itms.push("기(氣) ✓");
                if (ex.supernatural) itms.push("초자연 ✓");
                if (sys.leveling) itms.push("레벨링 ✓");
                if (sys.skills) itms.push("스킬 ✓");
                if (sys.stats) itms.push("스탯 ✓");
                if (ex.technology) itms.push("기술: " + esc(ex.technology));
                rc.innerHTML = itms.length ? itms.map(i => `<span class="bdg bt" style="display:inline-block;margin:2px">${i}</span>`).join("") : '<span style="color:var(--text2)">규칙 없음</span>';
            }
        };

        const buildNarrativeLoreEntry = () => ({
            key: LibraLoreKeys.narrative(),
            comment: 'lmai_narrative',
            content: JSON.stringify(_NAR),
            mode: 'normal',
            insertorder: 70,
            alwaysActive: false
        });

        const applyMemoryPresetToUI = (presetKey) => {
            const preset = MEMORY_PRESETS[presetKey];
            if (!preset) return;
            overlay.querySelector("#sml").value = preset.maxLimit;
            overlay.querySelector("#sth").value = preset.threshold;
            const simSlider = overlay.querySelector("#sst");
            simSlider.value = preset.simThreshold;
            overlay.querySelector("#sstv").textContent = parseFloat(simSlider.value).toFixed(2);
            overlay.querySelector("#sgc").value = preset.gcBatchSize;
        };

        const applyColdStartScopePresetToUI = (presetKey) => {
            overlay.querySelector("#scsp").value =
                Object.prototype.hasOwnProperty.call(COLD_START_SCOPE_PRESETS, presetKey)
                    ? presetKey
                    : 'partial_100';
        };

        const markMemoryPresetCustom = () => {
            const presetSelect = overlay.querySelector("#smp");
            if (presetSelect.value !== "custom") presetSelect.value = "custom";
        };
        const applyWeightValuesToUI = (weights) => {
            const resolved = normalizeWeights(weights, WEIGHT_MODE_PRESETS.auto);
            overlay.querySelector("#sws").value = resolved.similarity;
            overlay.querySelector("#wsv").textContent = parseFloat(resolved.similarity).toFixed(2);
            overlay.querySelector("#swi").value = resolved.importance;
            overlay.querySelector("#wiv").textContent = parseFloat(resolved.importance).toFixed(2);
            overlay.querySelector("#swr").value = resolved.recency;
            overlay.querySelector("#wrv").textContent = parseFloat(resolved.recency).toFixed(2);
        };

        const loadSettings = () => {
            const c = _CFG;
            overlay.querySelector("#slp").value = (c.llm && c.llm.provider) || "openai";
            overlay.querySelector("#slu").value = (c.llm && c.llm.url) || "";
            overlay.querySelector("#slk").value = (c.llm && c.llm.key) || "";
            overlay.querySelector("#slm").value = (c.llm && c.llm.model) || "gpt-4o-mini";
            const t = overlay.querySelector("#slt"); t.value = (c.llm && c.llm.temp) || 0.3; overlay.querySelector("#sltv").textContent = t.value;
            overlay.querySelector("#slto").value = (c.llm && c.llm.timeout) || 120000;
            overlay.querySelector("#slre").value = (c.llm && c.llm.reasoningEffort) || "none";
            overlay.querySelector("#slrb").value = (c.llm && c.llm.reasoningBudgetTokens) || 0;
            overlay.querySelector("#sax").checked = !!(c.auxLlm && c.auxLlm.enabled);
            overlay.querySelector("#saxp").value = (c.auxLlm && c.auxLlm.provider) || (c.llm && c.llm.provider) || "openai";
            overlay.querySelector("#saxu").value = (c.auxLlm && c.auxLlm.url) || "";
            overlay.querySelector("#saxk").value = (c.auxLlm && c.auxLlm.key) || "";
            overlay.querySelector("#saxm").value = (c.auxLlm && c.auxLlm.model) || (c.llm && c.llm.model) || "gpt-4o-mini";
            const at = overlay.querySelector("#saxt"); at.value = (c.auxLlm && c.auxLlm.temp) || 0.2; overlay.querySelector("#saxtv").textContent = at.value;
            overlay.querySelector("#saxto").value = (c.auxLlm && c.auxLlm.timeout) || 90000;
            overlay.querySelector("#saxre").value = (c.auxLlm && c.auxLlm.reasoningEffort) || "none";
            overlay.querySelector("#saxrb").value = (c.auxLlm && c.auxLlm.reasoningBudgetTokens) || 0;
            overlay.querySelector("#scbs").checked = c.cbsEnabled !== false;
            overlay.querySelector("#slrag").checked = c.useLorebookRAG !== false;
            overlay.querySelector("#semo").checked = c.emotionEnabled !== false;
            overlay.querySelector("#sep").value = (c.embed && c.embed.provider) || "openai";
            overlay.querySelector("#seu").value = (c.embed && c.embed.url) || "";
            overlay.querySelector("#sek").value = (c.embed && c.embed.key) || "";
            overlay.querySelector("#sem").value = (c.embed && c.embed.model) || "text-embedding-3-small";
            overlay.querySelector("#seto").value = (c.embed && c.embed.timeout) || 120000;
            const memoryPreset = c.memoryPreset || inferMemoryPreset(c);
            overlay.querySelector("#smp").value = MEMORY_PRESETS[memoryPreset] ? memoryPreset : "custom";
            overlay.querySelector("#sml").value = c.maxLimit || MEMORY_PRESETS.general.maxLimit;
            overlay.querySelector("#sth").value = c.threshold || MEMORY_PRESETS.general.threshold;
            const s = overlay.querySelector("#sst"); s.value = c.simThreshold || MEMORY_PRESETS.general.simThreshold; overlay.querySelector("#sstv").textContent = parseFloat(s.value).toFixed(2);
            overlay.querySelector("#sgc").value = c.gcBatchSize || MEMORY_PRESETS.general.gcBatchSize;
            applyColdStartScopePresetToUI(c.coldStartScopePreset || inferColdStartScopePreset(c.coldStartHistoryLimit));
            if (MEMORY_PRESETS[memoryPreset]) applyMemoryPresetToUI(memoryPreset);
            
            const swm = overlay.querySelector("#swm");
            swm.value = c.weightMode || "auto";
            overlay.querySelector("#cw").style.display = swm.value === "custom" ? "block" : "none";
            applyWeightValuesToUI(c.weights || resolveWeightsForMode(c.weightMode, null));
            overlay.querySelector("#sam").value = c.worldAdjustmentMode || "dynamic";
            overlay.querySelector("#ssam").value = c.storyAuthorMode || "proactive";
            overlay.querySelector("#sdm").value = c.directorEnabled === false ? "disabled" : (c.directorMode || "strong");
            overlay.querySelector("#sdb").checked = !!c.debug;
            
            const cacheStats = MemoryEngine.getCacheStats();
            overlay.querySelector("#cst").innerHTML = `
                <div class="ci">메모리: ${_MEM.length}</div>
                <div class="ci">인물: ${_ENT.length}</div>
                <div class="ci">관계: ${_REL.length}</div>
                <div class="ci">메타캐시 히트율: ${(parseFloat(cacheStats?.meta?.hitRate) * 100 || 0).toFixed(1)}%</div>
                <div class="ci">유사도캐시: ${cacheStats?.sim?.size ?? 0}</div>
            `;
        };

        // 3. 자바스크립트로 직접 이벤트 연결 (Event Delegation)
        overlay.querySelector('#xbtn').onclick = () => { overlay.remove(); R.hideContainer(); };
        overlay.querySelectorAll('.tb').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
        
        // 상단 툴바 및 폼 액션
        overlay.querySelector('#btn-toggle-add-mem').onclick = () => overlay.querySelector('#amf').classList.toggle('on');
        overlay.querySelector('#btn-cancel-mem').onclick = () => overlay.querySelector('#amf').classList.remove('on');
        overlay.querySelector('#btn-toggle-add-ent').onclick = () => overlay.querySelector('#aef').classList.toggle('on');
        overlay.querySelector('#btn-cancel-ent').onclick = () => overlay.querySelector('#aef').classList.remove('on');
        overlay.querySelector('#btn-toggle-add-rel').onclick = () => overlay.querySelector('#arf').classList.toggle('on');
        overlay.querySelector('#btn-cancel-rel').onclick = () => overlay.querySelector('#arf').classList.remove('on');

        overlay.querySelector('#ms').oninput = filterMems;
        overlay.querySelector('#mf').onchange = filterMems;
        overlay.querySelector('#swm').onchange = (e) => {
            const mode = e.target.value;
            overlay.querySelector('#cw').style.display = mode === 'custom' ? 'block' : 'none';
            if (mode !== 'custom') {
                applyWeightValuesToUI(resolveWeightsForMode(mode, null));
            }
        };
        overlay.querySelector('#smp').onchange = (e) => {
            const presetKey = e.target.value;
            if (presetKey === 'custom') return;
            applyMemoryPresetToUI(presetKey);
        };
        overlay.querySelector('#btn-import-hypa-v3').onclick = importHypaV3ToLorebook;

        // 슬라이더 값 실시간 반영
        const bindSlider = (id, targetId) => overlay.querySelector(id).oninput = (e) => overlay.querySelector(targetId).textContent = e.target.value;
        bindSlider('#slt', '#sltv');
        bindSlider('#saxt', '#saxtv');
        bindSlider('#sst', '#sstv');
        bindSlider('#ar-cls', '#ar-clsv');
        bindSlider('#ar-trs', '#ar-trsv');
        bindSlider('#sws', '#wsv');
        bindSlider('#swi', '#wiv');
        bindSlider('#swr', '#wrv');
        ['#sml', '#sth', '#sgc'].forEach(id => overlay.querySelector(id).addEventListener('input', markMemoryPresetCustom));
        overlay.querySelector('#sst').addEventListener('input', () => {
            overlay.querySelector('#sstv').textContent = parseFloat(overlay.querySelector('#sst').value).toFixed(2);
            markMemoryPresetCustom();
        });

        // 메모리 액션
        overlay.querySelector('#btn-add-mem').onclick = () => {
            const c = Utils.getMemorySourceText(overlay.querySelector("#am-c").value);
            if (!c) { toast("❌ 내용을 입력하세요"); return; }
            const imp = parseInt(overlay.querySelector("#am-i").value) || 5;
            const cat = overlay.querySelector("#am-cat").value.trim() || "";
            const meta = { imp: Math.max(1, Math.min(10, imp)), t: 0, ttl: -1, cat: cat, summary: '', source: 'narrative_source_record', sourceHint: 'Used as source evidence for narrative summaries.' };
            _MEM.push({ key: "", comment: "lmai_memory", content: `[META:${JSON.stringify(meta)}]\n${c}`, mode: "normal", insertorder: 100, alwaysActive: false });
            overlay.querySelector("#am-c").value = "";
            overlay.querySelector('#amf').classList.remove('on');
            filterMems(); toast("✅ 메모리 추가됨");
        };

        overlay.querySelector('#btn-save-all-mem').onclick = () => {
            // LIBRA GUI가 직접 편집하는 타입 목록
            const guiManaged = new Set(['lmai_memory', 'lmai_entity', 'lmai_relation', 'lmai_world_graph', 'lmai_world_node']);
            // 비편집 엔트리 보존 (비-LIBRA 엔트리 + 트래커 엔트리)
            const preserved = lore.filter(e => !guiManaged.has(e.comment));
            let newLore = [...preserved];
            if (_WLD) newLore.unshift({ key: LibraLoreKeys.worldGraph(), comment: "lmai_world_graph", content: JSON.stringify(_WLD), mode: "normal", insertorder: 1, alwaysActive: false });
            _ENT.forEach(e => newLore.push(e));
            _REL.forEach(r => newLore.push(r));
            _MEM.forEach(m => newLore.push({ key: m.key || "", comment: "lmai_memory", content: m.content, mode: "normal", insertorder: 100, alwaysActive: false }));
            saveLoreToChar(newLore, () => toast("💾 메모리 저장됨"));
        };

        // 엔티티 및 관계 액션
        overlay.querySelector('#btn-add-ent').onclick = () => {
            const name = overlay.querySelector("#ae-name").value.trim();
            if (!name) { toast("❌ 이름을 입력하세요"); return; }
            const normalizedName = EntityManager.normalizeName(name);
            const d = {
                id: TokenizerEngine.simpleHash(normalizedName),
                name: normalizedName,
                type: 'character',
                appearance: {
                    features: (overlay.querySelector("#ae-feat")?.value || '').split(",").map(s => s.trim()).filter(Boolean),
                    distinctiveMarks: [],
                    clothing: []
                },
                personality: {
                    traits: (overlay.querySelector("#ae-trait")?.value || '').split(",").map(s => s.trim()).filter(Boolean),
                    values: [],
                    fears: [],
                    likes: [],
                    dislikes: [],
                    sexualOrientation: (overlay.querySelector("#ae-sexual-orientation")?.value || '').trim(),
                    sexualPreferences: (overlay.querySelector("#ae-sexual-preferences")?.value || '').split(",").map(s => s.trim()).filter(Boolean)
                },
                background: {
                    origin: '',
                    occupation: (overlay.querySelector("#ae-occ")?.value || '').trim(),
                    history: [],
                    secrets: []
                },
                status: {
                    currentLocation: (overlay.querySelector("#ae-loc")?.value || '').trim(),
                    currentMood: '',
                    healthStatus: '',
                    lastUpdated: MemoryState.currentTurn
                },
                meta: { created: MemoryState.currentTurn, updated: MemoryState.currentTurn, confidence: 0.7, source: 'gui' }
            };
            _ENT.push({ key: LibraLoreKeys.entityFromName(normalizedName), comment: "lmai_entity", content: JSON.stringify(d), mode: "normal", insertorder: 50, alwaysActive: false });
            overlay.querySelector("#ae-name").value = ""; overlay.querySelector("#ae-occ").value = ""; overlay.querySelector("#ae-loc").value = ""; overlay.querySelector("#ae-feat").value = ""; overlay.querySelector("#ae-trait").value = ""; overlay.querySelector("#ae-sexual-orientation").value = ""; overlay.querySelector("#ae-sexual-preferences").value = "";
            overlay.querySelector('#aef').classList.remove('on');
            renderEnts(); toast("✅ 인물 추가됨");
        };

        overlay.querySelector('#btn-add-rel').onclick = () => {
            const a = overlay.querySelector("#ar-a").value.trim();
            const b = overlay.querySelector("#ar-b").value.trim();
            if (!a || !b) { toast("❌ 인물을 입력하세요"); return; }
            const entityA = EntityManager.normalizeName(a);
            const entityB = EntityManager.normalizeName(b);
            const sortedPair = [entityA, entityB].sort();
            const d = {
                id: `${sortedPair[0]}_${sortedPair[1]}`,
                entityA,
                entityB,
                relationType: overlay.querySelector("#ar-type").value.trim() || "관계",
                details: {
                    howMet: '',
                    duration: '',
                    closeness: (parseInt(overlay.querySelector("#ar-cls").value) || 0) / 100,
                    trust: (parseInt(overlay.querySelector("#ar-trs").value) || 0) / 100,
                    events: []
                },
                sentiments: {
                    fromAtoB: overlay.querySelector("#ar-sent").value.trim(),
                    fromBtoA: '',
                    currentTension: 0,
                    lastInteraction: MemoryState.currentTurn
                },
                meta: { created: MemoryState.currentTurn, updated: MemoryState.currentTurn, confidence: 0.6, source: 'gui' }
            };
            _REL.push({ key: LibraLoreKeys.relationFromNames(entityA, entityB), comment: "lmai_relation", content: JSON.stringify(d), mode: "normal", insertorder: 51, alwaysActive: false });
            overlay.querySelector("#ar-a").value = ""; overlay.querySelector("#ar-b").value = ""; overlay.querySelector("#ar-type").value = ""; overlay.querySelector("#ar-sent").value = "";
            overlay.querySelector('#arf').classList.remove('on');
            renderEnts(); toast("✅ 관계 추가됨");
        };

        overlay.querySelector('#btn-save-ents').onclick = () => {
            const guiManaged = new Set(['lmai_memory', 'lmai_entity', 'lmai_relation', 'lmai_world_graph', 'lmai_world_node']);
            const preserved = lore.filter(e => !guiManaged.has(e.comment));
            let newLore = [...preserved];
            if (_WLD) newLore.unshift({ key: "world_graph", comment: "lmai_world_graph", content: JSON.stringify(_WLD), mode: "normal", insertorder: 1, alwaysActive: false });
            _ENT.forEach(e => newLore.push(e));
            _REL.forEach(r => newLore.push(r));
            _MEM.forEach(m => newLore.push(m));
            saveLoreToChar(newLore, () => toast("💾 저장됨"));
        };

        overlay.querySelector('#btn-save-world').onclick = () => {
            if (!_WLD) return;
            _WLD.global = _WLD.global || {};
            _WLD.global.multiverse = overlay.querySelector("#w1").checked;
            _WLD.global.dimensionTravel = overlay.querySelector("#w2").checked;
            _WLD.global.timeTravel = overlay.querySelector("#w3").checked;
            _WLD.global.metaNarrative = overlay.querySelector("#w4").checked;
            const guiManaged = new Set(['lmai_memory', 'lmai_entity', 'lmai_relation', 'lmai_world_graph', 'lmai_world_node']);
            const preserved = lore.filter(e => !guiManaged.has(e.comment));
            let newLore = [...preserved];
            newLore.unshift({ key: "world_graph", comment: "lmai_world_graph", content: JSON.stringify(_WLD), mode: "normal", insertorder: 1, alwaysActive: false });
            _ENT.forEach(e => newLore.push(e));
            _REL.forEach(r => newLore.push(r));
            _MEM.forEach(m => newLore.push(m));
            saveLoreToChar(newLore, () => { toast("💾 세계관 저장됨"); renderWorld(); });
        };

        overlay.querySelector('#btn-save-settings').onclick = () => {
            const customWeights = normalizeWeights({
                similarity: parseFloat(overlay.querySelector("#sws").value) || WEIGHT_MODE_PRESETS.auto.similarity,
                importance: parseFloat(overlay.querySelector("#swi").value) || WEIGHT_MODE_PRESETS.auto.importance,
                recency: parseFloat(overlay.querySelector("#swr").value) || WEIGHT_MODE_PRESETS.auto.recency
            }, WEIGHT_MODE_PRESETS.auto);
            
            const coldStartScopePreset = overlay.querySelector("#scsp").value || 'partial_100';
            const storyAuthorMode = overlay.querySelector("#ssam").value || 'disabled';
            const directorMode = overlay.querySelector("#sdm").value || 'disabled';
            const cfg = {
                useLLM: true,
                cbsEnabled: overlay.querySelector("#scbs").checked,
                useLorebookRAG: overlay.querySelector("#slrag").checked,
                emotionEnabled: overlay.querySelector("#semo").checked,
                storyAuthorEnabled: storyAuthorMode !== 'disabled',
                directorEnabled: directorMode !== 'disabled',
                debug: overlay.querySelector("#sdb").checked,
                memoryPreset: overlay.querySelector("#smp").value || "custom",
                maxLimit: parseInt(overlay.querySelector("#sml").value) || MEMORY_PRESETS.general.maxLimit,
                threshold: parseInt(overlay.querySelector("#sth").value) || MEMORY_PRESETS.general.threshold,
                simThreshold: parseFloat(overlay.querySelector("#sst").value) || MEMORY_PRESETS.general.simThreshold,
                gcBatchSize: parseInt(overlay.querySelector("#sgc").value) || MEMORY_PRESETS.general.gcBatchSize,
                coldStartScopePreset,
                coldStartHistoryLimit: resolveColdStartHistoryLimit(coldStartScopePreset, 100),
                weightMode: overlay.querySelector("#swm").value,
                weights: resolveWeightsForMode(overlay.querySelector("#swm").value, customWeights),
                worldAdjustmentMode: overlay.querySelector("#sam").value,
                storyAuthorMode,
                directorMode,
                llm: {
                    provider: overlay.querySelector("#slp").value,
                    url: overlay.querySelector("#slu").value,
                    key: overlay.querySelector("#slk").value,
                    model: overlay.querySelector("#slm").value,
                    temp: parseFloat(overlay.querySelector("#slt").value) || 0.3,
                    timeout: parseInt(overlay.querySelector("#slto").value) || 120000,
                    reasoningEffort: overlay.querySelector("#slre").value || "none",
                    reasoningBudgetTokens: parseInt(overlay.querySelector("#slrb").value) || 0
                },
                auxLlm: {
                    enabled: overlay.querySelector("#sax").checked,
                    provider: overlay.querySelector("#saxp").value,
                    url: overlay.querySelector("#saxu").value,
                    key: overlay.querySelector("#saxk").value,
                    model: overlay.querySelector("#saxm").value,
                    temp: parseFloat(overlay.querySelector("#saxt").value) || 0.2,
                    timeout: parseInt(overlay.querySelector("#saxto").value) || 90000,
                    reasoningEffort: overlay.querySelector("#saxre").value || "none",
                    reasoningBudgetTokens: parseInt(overlay.querySelector("#saxrb").value) || 0
                },
                embed: {
                    provider: overlay.querySelector("#sep").value,
                    url: overlay.querySelector("#seu").value,
                    key: overlay.querySelector("#sek").value,
                    model: overlay.querySelector("#sem").value,
                    timeout: parseInt(overlay.querySelector("#seto").value) || 120000
                }
            };
            console.warn("[LIBRA Debug] Saved Settings:", cfg);
            R.pluginStorage.setItem("LMAI_Config", JSON.stringify(cfg)).then(() => {
                Object.assign(MemoryEngine.CONFIG, cfg);
                _CFG = { ...MemoryEngine.CONFIG };
                toast("💾 설정 저장됨");
            }).catch(() => toast("❌ 저장 실패"));
        };

        overlay.querySelector('#btn-reset-settings').onclick = () => {
            if (!confirm("모든 설정을 초기값으로 되돌리시겠습니까?")) return;
            _CFG = { useLLM: true, cbsEnabled: true, useLorebookRAG: true, emotionEnabled: true, storyAuthorEnabled: true, storyAuthorMode: "proactive", directorEnabled: true, directorMode: "strong", debug: false, memoryPreset: "general", maxLimit: MEMORY_PRESETS.general.maxLimit, threshold: MEMORY_PRESETS.general.threshold, simThreshold: MEMORY_PRESETS.general.simThreshold, gcBatchSize: MEMORY_PRESETS.general.gcBatchSize, coldStartScopePreset: "partial_100", coldStartHistoryLimit: 100, weightMode: "auto", worldAdjustmentMode: "dynamic", llm: { provider: "openai", url: "", key: "", model: "gpt-4o-mini", temp: 0.3, timeout: 120000, reasoningEffort: "none", reasoningBudgetTokens: 0 }, auxLlm: { enabled: false, provider: "openai", url: "", key: "", model: "gpt-4o-mini", temp: 0.2, timeout: 90000, reasoningEffort: "none", reasoningBudgetTokens: 0 }, embed: { provider: "openai", url: "", key: "", model: "text-embedding-3-small", timeout: 120000 } };
            loadSettings(); toast("🔄 설정 초기화됨");
        };

        // 리스트 동적 버튼 이벤트 위임 (Event Delegation)
        overlay.addEventListener('click', (e) => {
            const target = e.target;
            if (target.classList.contains('act-save-mem')) {
                const idx = parseInt(target.dataset.idx, 10);
                if (isNaN(idx) || idx < 0 || idx >= _MEM.length) return;
                const nc = Utils.getMemorySourceText(overlay.querySelector(".mt-val[data-idx='"+idx+"']")?.value || '');
                const ni = parseInt(overlay.querySelector(".mi-val[data-idx='"+idx+"']")?.value) || 5;
                const meta = parseMeta(_MEM[idx].content);
                meta.imp = Math.max(1, Math.min(10, ni));
                meta.summary = '';
                meta.source = meta.source || 'narrative_source_record';
                meta.sourceHint = meta.sourceHint || 'Used as source evidence for narrative summaries.';
                _MEM[idx].content = `[META:${JSON.stringify(meta)}]\n${nc}`;
                toast("✅ 메모리 수정됨");
            } else if (target.classList.contains('act-del-mem')) {
                const idx = parseInt(target.dataset.idx, 10);
                if (isNaN(idx) || idx < 0 || idx >= _MEM.length) return;
                if (!confirm("이 메모리를 삭제하시겠습니까?")) return;
                _MEM.splice(idx, 1); filterMems(); toast("🗑 메모리가 삭제됨");
            } else if (target.classList.contains('act-save-ent')) {
                const i = parseInt(target.dataset.idx, 10);
                if (isNaN(i) || i < 0 || i >= _ENT.length) return;
                let d = {}; try { d = JSON.parse(_ENT[i].content); } catch (x) {}
                d.background = d.background || {}; d.background.occupation = overlay.querySelector(".eo-val[data-idx='"+i+"']")?.value || '';
                d.status = d.status || {}; d.status.currentLocation = overlay.querySelector(".eL-val[data-idx='"+i+"']")?.value || '';
                d.appearance = d.appearance || {}; d.appearance.features = (overlay.querySelector(".eF-val[data-idx='"+i+"']")?.value || '').split(",").map(s => s.trim()).filter(Boolean);
                d.personality = d.personality || {};
                d.personality.traits = (overlay.querySelector(".eP-val[data-idx='"+i+"']")?.value || '').split(",").map(s => s.trim()).filter(Boolean);
                d.personality.sexualOrientation = (overlay.querySelector(".eSO-val[data-idx='"+i+"']")?.value || '').trim();
                d.personality.sexualPreferences = (overlay.querySelector(".eSP-val[data-idx='"+i+"']")?.value || '').split(",").map(s => s.trim()).filter(Boolean);
                _ENT[i].content = JSON.stringify(d); toast("✅ 인물 데이터 수정됨");
            } else if (target.classList.contains('act-del-ent')) {
                const i = parseInt(target.dataset.idx, 10);
                if (isNaN(i) || i < 0 || i >= _ENT.length) return;
                if (!confirm("이 인물 데이터를 삭제하시겠습니까?")) return;
                _ENT.splice(i, 1); renderEnts(); toast("🗑 삭제됨");
            } else if (target.classList.contains('act-save-rel')) {
                const i = parseInt(target.dataset.idx, 10);
                if (isNaN(i) || i < 0 || i >= _REL.length) return;
                let d = {}; try { d = JSON.parse(_REL[i].content); } catch (x) {}
                d.relationType = overlay.querySelector(".rT-val[data-idx='"+i+"']")?.value || '';
                d.sentiments = d.sentiments || {}; d.sentiments.fromAtoB = overlay.querySelector(".rS-val[data-idx='"+i+"']")?.value || '';
                d.details = d.details || {}; d.details.closeness = (parseInt(overlay.querySelector(".rC-val[data-idx='"+i+"']")?.value) || 0) / 100;
                d.details.trust = (parseInt(overlay.querySelector(".rR-val[data-idx='"+i+"']")?.value) || 0) / 100;
                const floors = (() => {
                    const text = String(d.relationType || '').toLowerCase();
                    if (['연인', '애인', 'lover', 'romantic partner', 'spouse', 'wife', 'husband'].some(k => text.includes(k))) return { closeness: 0.75, trust: 0.75 };
                    if (['썸', '호감', 'crush', 'flirt'].some(k => text.includes(k))) return { closeness: 0.55, trust: 0.45 };
                    if (['친구', '동료', 'friend', 'teammate', 'partner'].some(k => text.includes(k))) return { closeness: 0.45, trust: 0.45 };
                    if (['가족', '형제', '자매', '남매', '모녀', '부녀', 'family', 'sibling', 'parent'].some(k => text.includes(k))) return { closeness: 0.65, trust: 0.6 };
                    if (['스승', '제자', 'mentor', 'student', 'teacher'].some(k => text.includes(k))) return { closeness: 0.35, trust: 0.55 };
                    if (['라이벌', '경쟁', 'rival'].some(k => text.includes(k))) return { closeness: 0.3, trust: 0.2 };
                    if (['적', '원수', 'enemy', 'hostile'].some(k => text.includes(k))) return { closeness: 0.05, trust: 0.05 };
                    return null;
                })();
                if (floors) {
                    d.details.closeness = Math.max(d.details.closeness || 0, floors.closeness);
                    d.details.trust = Math.max(d.details.trust || 0, floors.trust);
                }
                _REL[i].content = JSON.stringify(d);
                renderEnts();
                toast("✅ 관계 데이터 수정됨");
            } else if (target.classList.contains('act-del-rel')) {
                const i = parseInt(target.dataset.idx, 10);
                if (isNaN(i) || i < 0 || i >= _REL.length) return;
                if (!confirm("이 관계 데이터를 삭제하시겠습니까?")) return;
                _REL.splice(i, 1); renderEnts(); toast("🗑 삭제됨");
            } else if (target.classList.contains('act-save-nar')) {
                const i = parseInt(target.dataset.idx, 10);
                if (isNaN(i) || i < 0 || i >= (_NAR.storylines || []).length) return;
                const storyline = _NAR.storylines[i] || {};
                storyline.name = (overlay.querySelector(".nN-val[data-idx='"+i+"']")?.value || '').trim() || `Storyline ${i + 1}`;
                storyline.entities = (overlay.querySelector(".nE-val[data-idx='"+i+"']")?.value || '').split(",").map(s => s.trim()).filter(Boolean);
                storyline.currentContext = (overlay.querySelector(".nC-val[data-idx='"+i+"']")?.value || '').trim();
                storyline.keyPoints = (overlay.querySelector(".nK-val[data-idx='"+i+"']")?.value || '').split(",").map(s => s.trim()).filter(Boolean);
                storyline.ongoingTensions = (overlay.querySelector(".nO-val[data-idx='"+i+"']")?.value || '').split(",").map(s => s.trim()).filter(Boolean);
                storyline.recentEvents = (overlay.querySelector(".nR-val[data-idx='"+i+"']")?.value || '')
                    .split(/\r?\n/)
                    .map(s => s.trim())
                    .filter(Boolean)
                    .map((line, idx) => {
                        const match = line.match(/^T(\d+)\s*:\s*(.+)$/i);
                        if (match) return { turn: Number(match[1]), brief: match[2].trim() };
                        return { turn: idx + 1, brief: line };
                    });
                const latestSummary = (overlay.querySelector(".nS-val[data-idx='"+i+"']")?.value || '').trim();
                storyline.summaries = Array.isArray(storyline.summaries) ? storyline.summaries : [];
                if (latestSummary) {
                    const upToTurn = MemoryEngine.getCurrentTurn();
                    const last = storyline.summaries[storyline.summaries.length - 1];
                    if (last) {
                        last.summary = latestSummary;
                        last.upToTurn = upToTurn;
                        last.keyPoints = [...storyline.keyPoints];
                        last.ongoingTensions = [...storyline.ongoingTensions];
                    } else {
                        storyline.summaries.push({ upToTurn, summary: latestSummary, keyPoints: [...storyline.keyPoints], ongoingTensions: [...storyline.ongoingTensions], timestamp: Date.now() });
                    }
                }
                _NAR.storylines[i] = storyline;
                renderNarrative();
                toast("✅ 내러티브 수정됨");
            } else if (target.classList.contains('act-del-nar')) {
                const i = parseInt(target.dataset.idx, 10);
                if (isNaN(i) || i < 0 || i >= (_NAR.storylines || []).length) return;
                if (!confirm("이 스토리라인을 삭제하시겠습니까?")) return;
                _NAR.storylines.splice(i, 1);
                renderNarrative();
                toast("🗑 스토리라인 삭제됨");
            }
        });

        overlay.querySelector('#btn-transition').onclick = async () => {
            const confirmed = await Utils.confirmEx(
                "현재 기억을 보존한 채 새 채팅방을 자동 생성하시겠습니까?\n모든 LIBRA 데이터(기억, 엔티티, 세계관 등)가 새 방으로 계승됩니다.\n(LLM 토큰이 일부 소모될 수 있습니다)"
            );
            if (!confirmed) return;

            LMAI_GUI.toast("🚀 세션 전환 중...");
            const success = await TransitionManager.executeTransition();
            
            if (success) {
                await Utils.alertEx(
                    "✅ 새 세션 생성 완료!\n\n모든 기억과 세계관 데이터가 새 채팅방으로 계승되었습니다.\n채팅 목록에서 새로 생성된 방을 확인하세요."
                );
            } else {
                await Utils.alertEx("❌ 세션 전환 중 오류가 발생했습니다. 다시 시도해 주세요.");
            }
        };

        overlay.querySelector('#btn-cold-start').onclick = async () => {
            if (!confirm("현재 채팅방의 과거 내역을 분석하여 메모리를 재구축하시겠습니까?")) return;
            await ColdStartManager.startAutoSummarization();
        };

        overlay.querySelector('#btn-cold-reanalyze').onclick = async () => {
            if (!confirm("현재 구축된 데이터와 새 재분석 결과를 원문 대화 기준으로 대조한 뒤, 더 적절한 구조 데이터로 재구축하시겠습니까?")) return;
            await ColdStartManager.reanalyzeHistoricalConversation();
        };

        overlay.querySelector('#btn-add-narrative').onclick = () => {
            _NAR.storylines = Array.isArray(_NAR.storylines) ? _NAR.storylines : [];
            _NAR.storylines.push({
                id: (_NAR.storylines.reduce((max, s) => Math.max(max, Number(s?.id || 0)), 0) || 0) + 1,
                name: `New Storyline ${_NAR.storylines.length + 1}`,
                entities: [],
                turns: [],
                recentEvents: [],
                summaries: [],
                keyPoints: [],
                ongoingTensions: [],
                currentContext: ''
            });
            renderNarrative();
            toast("➕ 스토리라인 추가됨");
        };

        overlay.querySelector('#btn-save-narrative').onclick = async () => {
            const narrativeEntry = buildNarrativeLoreEntry();
            const nextLore = lore.filter(e => e.comment !== 'lmai_narrative');
            nextLore.push(narrativeEntry);
            await saveLoreToChar(nextLore, () => {
                NarrativeTracker.loadState(nextLore);
                toast("💾 내러티브 저장 완료");
            });
        };

        // 초기 화면 렌더링
        filterMems();
        renderEnts();
        renderNarrative();
        renderWorld();
        loadSettings();

        await R.showContainer('fullscreen');
    };

    const toast = (m, d) => {
        const existing = document.getElementById('lmai-overlay');
        const t = existing?.querySelector("#toast");
        if (t) {
            t.textContent = m;
            t.classList.add("on");
            setTimeout(() => t.classList.remove("on"), d || 2000);
        } else {
            console.log(`[LIBRA Toast] ${m}`);
        }
    };

    return { show, toast };
})();

// GUI 등록
(async () => {
    const R = (typeof Risuai !== 'undefined') ? Risuai : (typeof risuai !== 'undefined' ? risuai : null);
    if (R) {
        try {
            await R.registerSetting('LIBRA World Manager', LMAI_GUI.show, '📚', 'html', 'lmai-settings');
            await R.registerButton({
                name: 'LIBRA',
                icon: '📚',
                iconType: 'html',
                location: 'action',
                id: 'lmai-button'
            }, LMAI_GUI.show);
            console.log('[LIBRA] GUI registered.');
        } catch (e) {
            console.warn('[LIBRA] GUI registration failed:', e?.message || e);
        }
    }
})();


// Export
if (typeof globalThis !== 'undefined') {
    globalThis.LIBRA = {
        MemoryEngine,
        EntityManager,
        HierarchicalWorldManager,
        ComplexWorldDetector,
        WorldAdjustmentManager,
        NarrativeTracker,
        StoryAuthor,
        CharacterStateTracker,
        WorldStateTracker,
        MemoryState
    };
}

})();
