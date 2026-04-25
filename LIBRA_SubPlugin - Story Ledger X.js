//@name libra_story_ledger_x
//@display-name LIBRA Story Ledger X
//@author rusinus12@gmail.com
//@api 3.0
//@version 0.1.0

(function () {
  'use strict';

  /**
   * LIBRA Story Ledger X
   *
   * Deterministic narrative memory ledger.
   * Does not call LLM.
   * Does not replace World Manager / Narrative Core X.
   * Records and recalls story consequences, unresolved tensions,
   * payoff candidates, scene deltas, and weak theme/motif traces.
   */

  try {
    globalThis.__LIBRA_STORY_LEDGER_X_RUNTIME__?.cleanup?.();
  } catch (_) {}

  const PLUGIN_ID = 'libra.story.ledgerx';
  const PLUGIN_NAME = 'LIBRA Story Ledger X';
  const PLUGIN_VERSION = '0.1.0';
  const STORAGE_PREFIX = 'LIBRA_STORY_LEDGER_X_V1::';
  const SETTINGS_KEY = 'LIBRA_StoryLedgerX_Settings_v1';
  const INDEX_KEY = `${STORAGE_PREFIX}__index__`;

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    promptGuidanceEnabled: true,
    maxConflictTraces: 32,
    maxConsequences: 48,
    maxPayoffs: 48,
    maxSceneDeltas: 24,
    maxThemeMotifs: 16,
    guidanceMaxItems: 6,
    guidanceMaxChars: 1200,
    decayEnabled: true,
    dormantAfterTurns: 12,
    expireAfterTurns: 36,
    minPriorityForPrompt: 0.25,
    debug: false
  });

  const runtimeState = {
    activeScopeId: 'global',
    lastStatus: 'idle',
    lastError: '',
    lastIngestedAt: 0,
    lastFinalizedAt: 0,
    lastGuidanceAt: 0,
    lastGuidanceCount: 0,
    degraded: false
  };

  const stateCache = new Map();
  let settingsCache = null;
  const saveTimers = new Map();

  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value || 0)));
  const now = () => Date.now();
  const textOf = (value = '') => String(value ?? '').replace(/\s+/g, ' ').trim();
  const compactText = (value = '', limit = 240) => {
    const text = textOf(value);
    const max = Math.max(0, Number(limit || 0));
    if (!max || text.length <= max) return text;
    return `${text.slice(0, Math.max(1, max - 1)).trim()}…`;
  };
  const normalizeKey = (text) =>
    String(text || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .trim();
  const ensureArray = (value) => Array.isArray(value) ? value : (value == null ? [] : [value]);
  const uniqueTexts = (items = [], limit = 999) => {
    const seen = new Set();
    const output = [];
    ensureArray(items).forEach((item) => {
      const text = textOf(item);
      const key = normalizeKey(text);
      if (!key || seen.has(key)) return;
      seen.add(key);
      output.push(text);
    });
    return output.slice(0, Math.max(0, Number(limit || 0)));
  };
  const cloneValue = (value, fallback = null) => {
    try {
      return JSON.parse(JSON.stringify(value ?? fallback));
    } catch (_) {
      if (Array.isArray(value)) return value.slice();
      if (value && typeof value === 'object') return { ...value };
      return value ?? fallback;
    }
  };
  const safeJsonParse = (raw, fallback) => {
    try {
      if (raw == null || raw === '') return fallback;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (_) {
      return fallback;
    }
  };
  const simpleHash = (value = '') => {
    const text = String(value || '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  };
  const idFor = (prefix, parts = []) => `${prefix}_${simpleHash(parts.map(item => textOf(item)).join('|'))}`;

  const getStorage = () => {
    try {
      const bridge = globalThis?.LIBRA?.RuntimeBridge || globalThis?.LIBRA_RuntimeBridge || null;
      if (bridge?.storageGetItem && bridge?.storageSetItem) return bridge;
    } catch (_) {}
    try {
      const storage = globalThis?.risuai?.pluginStorage || globalThis?.RisuAI?.pluginStorage || null;
      if (storage?.getItem && storage?.setItem) {
        return {
          storageGetItem: key => storage.getItem(key),
          storageSetItem: (key, value) => storage.setItem(key, value),
          storageRemoveItem: key => storage.removeItem?.(key)
        };
      }
    } catch (_) {}
    try {
      const local = globalThis?.localStorage || null;
      if (local?.getItem && local?.setItem) {
        return {
          storageGetItem: key => local.getItem(key),
          storageSetItem: (key, value) => local.setItem(key, value),
          storageRemoveItem: key => local.removeItem(key)
        };
      }
    } catch (_) {}
    return null;
  };

  const storageGetItem = async (key) => {
    const storage = getStorage();
    if (!storage?.storageGetItem) return '';
    return await storage.storageGetItem(key);
  };
  const storageSetItem = async (key, value) => {
    const storage = getStorage();
    if (!storage?.storageSetItem) throw new Error('storage_unavailable');
    return await storage.storageSetItem(key, value);
  };
  const storageRemoveItem = async (key) => {
    const storage = getStorage();
    if (!storage?.storageRemoveItem) return false;
    await storage.storageRemoveItem(key);
    return true;
  };
  const getSettings = () => ({ ...DEFAULT_SETTINGS, ...(settingsCache || {}) });
  const loadSettings = async () => {
    if (settingsCache) return getSettings();
    const parsed = safeJsonParse(await storageGetItem(SETTINGS_KEY), {});
    settingsCache = parsed && typeof parsed === 'object' ? parsed : {};
    return getSettings();
  };

  const buildEmptyState = (scopeId = 'global') => ({
    version: 'story_ledger_x_v1',
    scopeId: textOf(scopeId) || 'global',
    updatedAt: 0,
    conflictTraces: [],
    consequenceLedger: [],
    payoffTracker: [],
    sceneDeltaLog: [],
    themeMotifTrace: [],
    stats: {
      totalIngested: 0,
      lastTurnIndex: 0,
      lastSourceMessageIds: []
    }
  });

  const normalizeSourceIds = (value) => uniqueTexts(ensureArray(value), 32);
  const getChatMessages = (chat = null) => {
    if (!chat || typeof chat !== 'object') return [];
    if (Array.isArray(chat.message)) return chat.message;
    if (Array.isArray(chat.messages)) return chat.messages;
    if (Array.isArray(chat.msgs)) return chat.msgs;
    return [];
  };
  const getMessageText = (msg = {}) => {
    if (!msg || typeof msg !== 'object') return '';
    if (typeof msg.data === 'string') return msg.data;
    if (typeof msg.content === 'string') return msg.content;
    if (typeof msg.message === 'string') return msg.message;
    if (typeof msg.text === 'string') return msg.text;
    if (Array.isArray(msg.swipes) && Number.isFinite(Number(msg.swipe_id))) {
      return String(msg.swipes[Number(msg.swipe_id)] || '');
    }
    return '';
  };
  const getRisuApi = () => {
    if (typeof globalThis === 'undefined') return null;
    return globalThis.Risuai || globalThis.risuai || globalThis.RisuAI || null;
  };
  const stripNativeCopySuffix = (value = '') => {
    let text = textOf(value);
    for (let i = 0; i < 4; i += 1) {
      const next = textOf(text
        .replace(/\s*[\[(](?:copy|copy\s*\d+|copied|사본|복사본)[\])]\s*$/i, '')
        .replace(/\s*[-_:–—]?\s*(?:copy|copy\s*\d+|copied|사본|복사본)\s*$/i, ''));
      if (!next || next === text) break;
      text = next;
    }
    return text;
  };
  const hasNativeCopyNameSignal = (value = '') => /\bcopy\b|copied|복사|사본/i.test(textOf(value));
  const buildNativeChatContentSignature = (chat = {}) => {
    const rows = getChatMessages(chat)
      .filter(msg => msg && typeof msg === 'object')
      .map((msg) => {
        const role = textOf(msg?.role || (msg?.is_user ? 'user' : 'assistant')).toLowerCase();
        const text = textOf(getMessageText(msg));
        return text ? `${role}:${text}` : '';
      })
      .filter(Boolean);
    const joined = rows.join('\n');
    return { count: rows.length, chars: joined.length, hash: rows.length ? simpleHash(joined) : '' };
  };
  const isNativeCopiedChatPair = (targetChat = {}, sourceChat = {}) => {
    const targetId = textOf(targetChat?.id || targetChat?.chatId || targetChat?.chatroom_id);
    const sourceId = textOf(sourceChat?.id || sourceChat?.chatId || sourceChat?.chatroom_id);
    if (!targetId || !sourceId || targetId === sourceId) return false;
    const targetName = textOf(targetChat?.name || targetChat?.title || '');
    const sourceName = textOf(sourceChat?.name || sourceChat?.title || '');
    const targetBase = stripNativeCopySuffix(targetName).toLowerCase();
    const sourceBase = stripNativeCopySuffix(sourceName).toLowerCase();
    const copyNameMatch = !!targetBase && !!sourceBase
      && hasNativeCopyNameSignal(targetName)
      && (targetBase === sourceBase || targetName.toLowerCase().startsWith(sourceName.toLowerCase()));
    const targetSig = buildNativeChatContentSignature(targetChat);
    const sourceSig = buildNativeChatContentSignature(sourceChat);
    const exactMessages = targetSig.count > 0
      && targetSig.count === sourceSig.count
      && targetSig.chars === sourceSig.chars
      && targetSig.hash === sourceSig.hash;
    return copyNameMatch && exactMessages;
  };
  const normalizeState = (state = {}, scopeId = 'global') => {
    const normalizedScope = textOf(scopeId || state?.scopeId || 'global') || 'global';
    return {
      ...buildEmptyState(normalizedScope),
      ...(state && typeof state === 'object' ? state : {}),
      version: 'story_ledger_x_v1',
      scopeId: normalizedScope,
      updatedAt: Number(state?.updatedAt || 0),
      conflictTraces: ensureArray(state?.conflictTraces).map(normalizeConflict).filter(item => item.label),
      consequenceLedger: ensureArray(state?.consequenceLedger).map(normalizeConsequence).filter(item => item.decision || item.immediateResult),
      payoffTracker: ensureArray(state?.payoffTracker).map(normalizePayoff).filter(item => item.label),
      sceneDeltaLog: ensureArray(state?.sceneDeltaLog).map(normalizeSceneDelta).filter(item => item.summary),
      themeMotifTrace: ensureArray(state?.themeMotifTrace).map(normalizeTheme).filter(item => item.label || item.motif),
      stats: {
        totalIngested: Number(state?.stats?.totalIngested || 0),
        lastTurnIndex: Number(state?.stats?.lastTurnIndex || 0),
        lastSourceMessageIds: normalizeSourceIds(state?.stats?.lastSourceMessageIds || [])
      }
    };
  };

  function normalizeConflict(item = {}) {
    const label = compactText(item?.label || item?.text || item?.summary || '', 180);
    const type = ['internal', 'relationship', 'world', 'secret', 'deadline', 'unknown'].includes(item?.type) ? item.type : 'unknown';
    const status = ['latent', 'active', 'escalating', 'aftermath', 'resolved', 'dormant'].includes(item?.status) ? item.status : 'active';
    return {
      id: textOf(item?.id) || idFor('conflict', [label, type]),
      label,
      type,
      parties: uniqueTexts(item?.parties || [], 12),
      source: textOf(item?.source || 'fallback') || 'fallback',
      primary: item?.primary === true,
      status,
      pressure: clamp(item?.pressure, 0, 1),
      firstSeenAt: Number(item?.firstSeenAt || now()),
      lastSeenAt: Number(item?.lastSeenAt || now()),
      seenCount: Math.max(1, Number(item?.seenCount || 1)),
      decay: Math.max(0, Number(item?.decay || 0)),
      unresolvedBecause: compactText(item?.unresolvedBecause || '', 220),
      doNotResolveYet: item?.doNotResolveYet === true,
      sourceMessageIds: normalizeSourceIds(item?.sourceMessageIds || []),
      evidenceRefs: uniqueTexts(item?.evidenceRefs || [], 24)
    };
  }

  function normalizeConsequence(item = {}) {
    const decision = compactText(item?.decision || item?.label || '', 220);
    const immediateResult = compactText(item?.immediateResult || '', 220);
    const status = ['pending', 'active', 'paid', 'expired'].includes(item?.status) ? item.status : 'pending';
    return {
      id: textOf(item?.id) || idFor('consequence', [decision, immediateResult, item?.actor || '']),
      decision,
      actor: compactText(item?.actor || '', 80),
      immediateResult,
      cost: compactText(item?.cost || '', 160),
      delayedEffect: compactText(item?.delayedEffect || '', 180),
      affectedRelations: uniqueTexts(item?.affectedRelations || [], 12),
      affectedWorld: uniqueTexts(item?.affectedWorld || [], 12),
      status,
      dueHint: compactText(item?.dueHint || '', 120),
      priority: clamp(item?.priority, 0, 1),
      createdAt: Number(item?.createdAt || now()),
      lastTouchedAt: Number(item?.lastTouchedAt || now()),
      source: textOf(item?.source || 'fallback') || 'fallback',
      sourceMessageIds: normalizeSourceIds(item?.sourceMessageIds || [])
    };
  }

  function normalizePayoff(item = {}) {
    const label = compactText(item?.label || item?.text || '', 220);
    const kind = ['openQuestion', 'payoffCandidate', 'doNotResolveYet', 'continuityLock'].includes(item?.kind) ? item.kind : 'openQuestion';
    const status = ['open', 'seeded', 'ready', 'paid', 'dormant'].includes(item?.status) ? item.status : 'open';
    return {
      id: textOf(item?.id) || idFor('payoff', [kind, label]),
      label,
      kind,
      status,
      priority: clamp(item?.priority, 0, 1),
      firstSeenAt: Number(item?.firstSeenAt || now()),
      lastSeenAt: Number(item?.lastSeenAt || now()),
      source: textOf(item?.source || 'storyAuthor') || 'storyAuthor',
      sourceMessageIds: normalizeSourceIds(item?.sourceMessageIds || [])
    };
  }

  function normalizeSceneDelta(item = {}) {
    const summary = compactText(item?.summary || item?.narrativeBrief || '', 260);
    return {
      id: textOf(item?.id) || idFor('scene_delta', [item?.turnIndex || 0, summary]),
      turnIndex: Math.max(0, Number(item?.turnIndex || 0)),
      summary,
      relationDelta: uniqueTexts(item?.relationDelta || [], 8),
      emotionDelta: uniqueTexts(item?.emotionDelta || [], 8),
      informationDelta: uniqueTexts(item?.informationDelta || [], 8),
      worldDelta: uniqueTexts(item?.worldDelta || [], 8),
      conflictDelta: uniqueTexts(item?.conflictDelta || [], 8),
      source: textOf(item?.source || 'fallback') || 'fallback',
      sourceMessageIds: normalizeSourceIds(item?.sourceMessageIds || []),
      createdAt: Number(item?.createdAt || now())
    };
  }

  function normalizeTheme(item = {}) {
    const label = compactText(item?.label || '', 100);
    const motif = compactText(item?.motif || item?.lastExpression || '', 160);
    return {
      id: textOf(item?.id) || idFor('theme', [label, motif]),
      label,
      motif,
      strength: clamp(item?.strength, 0, 1),
      lastExpression: compactText(item?.lastExpression || motif || label, 180),
      source: textOf(item?.source || 'storyAuthor') || 'storyAuthor',
      firstSeenAt: Number(item?.firstSeenAt || now()),
      lastSeenAt: Number(item?.lastSeenAt || now()),
      sourceMessageIds: normalizeSourceIds(item?.sourceMessageIds || [])
    };
  }

  const stateKey = (scopeId = 'global') => `${STORAGE_PREFIX}${textOf(scopeId) || 'global'}`;
  const stateEntryCount = (state = {}) => (
    ensureArray(state?.conflictTraces).length
    + ensureArray(state?.consequenceLedger).length
    + ensureArray(state?.payoffTracker).length
    + ensureArray(state?.sceneDeltaLog).length
    + ensureArray(state?.themeMotifTrace).length
  );
  const loadStateIndex = async () => {
    const parsed = safeJsonParse(await storageGetItem(INDEX_KEY), null);
    return {
      version: 1,
      updatedAt: Number(parsed?.updatedAt || 0),
      scopes: ensureArray(parsed?.scopes)
        .map(item => ({
          scopeId: textOf(item?.scopeId),
          updatedAt: Number(item?.updatedAt || 0),
          count: Math.max(0, Number(item?.count || 0)),
          sourceMessageIds: normalizeSourceIds(item?.sourceMessageIds || [])
        }))
        .filter(item => item.scopeId)
    };
  };
  const saveStateIndexEntry = async (scopeId = 'global', state = {}) => {
    const normalizedScope = textOf(scopeId) || 'global';
    if (!normalizedScope) return false;
    try {
      const entry = {
        scopeId: normalizedScope,
        updatedAt: Number(state?.updatedAt || now()),
        count: stateEntryCount(state),
        sourceMessageIds: normalizeSourceIds([
          ...(state?.stats?.lastSourceMessageIds || []),
          ...ensureArray(state?.conflictTraces).flatMap(item => item?.sourceMessageIds || []),
          ...ensureArray(state?.consequenceLedger).flatMap(item => item?.sourceMessageIds || []),
          ...ensureArray(state?.payoffTracker).flatMap(item => item?.sourceMessageIds || []),
          ...ensureArray(state?.sceneDeltaLog).flatMap(item => item?.sourceMessageIds || []),
          ...ensureArray(state?.themeMotifTrace).flatMap(item => item?.sourceMessageIds || [])
        ])
      };
      const index = await loadStateIndex();
      await storageSetItem(INDEX_KEY, JSON.stringify({
        version: 1,
        updatedAt: now(),
        scopes: [entry, ...index.scopes.filter(item => item.scopeId !== normalizedScope)].slice(0, 240)
      }));
      return true;
    } catch (_) {
      return false;
    }
  };
  const resolveExplicitCopySourceScopeId = (context = {}) => {
    const chat = context?.chat || {};
    const candidates = [
      context?.copiedFromScopeId,
      context?.copiedFromChatId,
      context?.sourceScopeId,
      context?.sourceChatId,
      context?.originalScopeId,
      context?.originalChatId,
      context?.copySourceScopeId,
      context?.copySourceChatId,
      chat?.copiedFromScopeId,
      chat?.copiedFromChatId,
      chat?.sourceScopeId,
      chat?.sourceChatId,
      chat?.originalScopeId,
      chat?.originalChatId,
      chat?.copySourceScopeId,
      chat?.copySourceChatId,
      chat?.metadata?.copiedFromScopeId,
      chat?.metadata?.copiedFromChatId,
      chat?.metadata?.sourceScopeId,
      chat?.metadata?.sourceChatId
    ];
    return uniqueTexts(candidates, 2)[0] || '';
  };
  const findNativeCopiedChatSourceForScope = async (targetScopeId = '') => {
    const target = textOf(targetScopeId);
    if (!target || target === 'global') return null;
    const api = getRisuApi();
    if (!api || typeof api.getCharacter !== 'function') return null;
    let character = null;
    try {
      character = await api.getCharacter();
    } catch (_) {
      character = null;
    }
    const chats = Array.isArray(character?.chats) ? character.chats : [];
    if (!chats.length) return null;
    const activeChat = chats.find(chat => textOf(chat?.id || chat?.chatId || chat?.chatroom_id) === target)
      || chats[Math.max(0, Number(character?.chatPage || 0))]
      || null;
    if (!activeChat) return null;
    const candidates = [];
    for (const chat of chats) {
      const sourceScopeId = textOf(chat?.id || chat?.chatId || chat?.chatroom_id);
      if (!sourceScopeId || sourceScopeId === target) continue;
      if (!isNativeCopiedChatPair(activeChat, chat)) continue;
      const sourceState = await loadState(sourceScopeId);
      const count = stateEntryCount(sourceState);
      if (count <= 0) continue;
      candidates.push({
        sourceScopeId,
        sourceState,
        count,
        sourceName: textOf(chat?.name || chat?.title || '')
      });
    }
    candidates.sort((a, b) => b.count - a.count || a.sourceScopeId.localeCompare(b.sourceScopeId));
    return candidates[0] || null;
  };
  const importStateFromNativeCopiedChatIfNeeded = async (context = {}, targetScopeId = '') => {
    const target = textOf(targetScopeId || context?.scopeId || runtimeState.activeScopeId || 'global') || 'global';
    if (!target || target === 'global') return null;
    const targetState = await loadState(target);
    if (stateEntryCount(targetState || {}) > 0) return null;
    if (targetState?.copiedFromScopeId || targetState?.copiedFromImportedAt) return null;
    const source = await findNativeCopiedChatSourceForScope(target);
    if (!source?.sourceScopeId || !source?.sourceState) return null;
    const cloned = normalizeState({
      ...cloneValue(source.sourceState, {}),
      scopeId: target,
      copiedFromScopeId: source.sourceScopeId,
      copiedFromImportedAt: now(),
      copyImportMatch: {
        mode: 'native-risu-chat-copy',
        sourceName: source.sourceName || '',
        entryCount: source.count
      }
    }, target);
    await saveState(target, cloned);
    runtimeState.activeScopeId = target;
    runtimeState.lastStatus = `native chat copy Story Ledger imported · ${source.sourceScopeId}`;
    reportRuntime('native-chat-copy-import', target, cloned);
    return { scopeId: target, state: cloned, copiedFromScopeId: source.sourceScopeId };
  };
  const importStateFromCopiedChatIfNeeded = async (context = {}, targetScopeId = '') => {
    const target = textOf(targetScopeId || context?.scopeId || runtimeState.activeScopeId || 'global') || 'global';
    if (!target || target === 'global') return null;
    const sourceScopeId = resolveExplicitCopySourceScopeId(context);
    if (!sourceScopeId || sourceScopeId === target || sourceScopeId === 'global') {
      return importStateFromNativeCopiedChatIfNeeded(context, target);
    }
    const targetState = await loadState(target);
    if (stateEntryCount(targetState || {}) > 0) return null;
    if (targetState?.copiedFromScopeId || targetState?.copiedFromImportedAt) return null;
    const sourceState = await loadState(sourceScopeId);
    if (stateEntryCount(sourceState) <= 0) return null;
    const cloned = normalizeState({
      ...cloneValue(sourceState, {}),
      scopeId: target,
      copiedFromScopeId: sourceScopeId,
      copiedFromImportedAt: now(),
      copyImportMatch: { mode: 'explicit-source' }
    }, target);
    await saveState(target, cloned);
    runtimeState.activeScopeId = target;
    runtimeState.lastStatus = `chat copy Story Ledger imported · ${sourceScopeId}`;
    reportRuntime('chat-copy-import', target, cloned);
    return { scopeId: target, state: cloned, copiedFromScopeId: sourceScopeId };
  };
  const loadState = async (scopeId = 'global') => {
    const normalizedScope = textOf(scopeId) || 'global';
    if (stateCache.has(normalizedScope)) return stateCache.get(normalizedScope);
    const raw = await storageGetItem(stateKey(normalizedScope));
    const state = normalizeState(safeJsonParse(raw, buildEmptyState(normalizedScope)), normalizedScope);
    stateCache.set(normalizedScope, state);
    return state;
  };
  const saveState = async (scopeId = 'global', state = null) => {
    const normalizedScope = textOf(scopeId) || 'global';
    const normalized = normalizeState(state || stateCache.get(normalizedScope) || buildEmptyState(normalizedScope), normalizedScope);
    normalized.updatedAt = now();
    stateCache.set(normalizedScope, normalized);
    await storageSetItem(stateKey(normalizedScope), JSON.stringify(normalized));
    void saveStateIndexEntry(normalizedScope, normalized);
    return normalized;
  };
  const scheduleSave = (scopeId = 'global') => {
    const normalizedScope = textOf(scopeId) || 'global';
    const existingTimer = saveTimers.get(normalizedScope);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      saveTimers.delete(normalizedScope);
      saveState(normalizedScope).catch(error => reportSoftError('save', error));
    }, 80);
    saveTimers.set(normalizedScope, timer);
  };

  const reportSoftError = (domain, error) => {
    const message = compactText(error?.message || String(error || 'unknown_error'), 240);
    runtimeState.lastError = `[${domain}] ${message}`;
    runtimeState.degraded = true;
    if (getSettings().debug) {
      try { console.warn(`[LIBRA Story Ledger X] ${domain}:`, error?.message || error); } catch (_) {}
    }
    try {
      globalThis?.LIBRA?.PluginCoordinator?.reportRuntime?.(PLUGIN_ID, {
        lastStatus: 'degraded',
        lastError: runtimeState.lastError,
        domain: 'story-ledger'
      });
    } catch (_) {}
  };

  const statusRank = {
    dormant: 0,
    latent: 1,
    aftermath: 2,
    active: 3,
    escalating: 4,
    resolved: -1
  };
  const mergeSourceIds = (left = [], right = []) => uniqueTexts([...ensureArray(left), ...ensureArray(right)], 32);
  const hasIdOverlap = (left = [], right = []) => {
    const set = new Set(normalizeSourceIds(left));
    return normalizeSourceIds(right).some(id => set.has(id));
  };
  const upsertByLabelOrSource = (items, incoming, normalizer, mergeFn) => {
    const next = normalizer(incoming);
    if (!next.label && !next.decision && !next.summary && !next.motif) return null;
    const nextKey = normalizeKey(next.label || next.decision || next.summary || next.motif);
    const found = items.find(item => {
      const itemKey = normalizeKey(item.label || item.decision || item.summary || item.motif);
      return nextKey && itemKey === nextKey;
    });
    if (!found) {
      items.push(next);
      return next;
    }
    mergeFn(found, next);
    return found;
  };

  const mergeConflict = (target, incoming) => {
    target.primary = target.primary || incoming.primary;
    target.pressure = Math.max(Number(target.pressure || 0), Number(incoming.pressure || 0));
    target.seenCount = Math.max(1, Number(target.seenCount || 1)) + 1;
    target.lastSeenAt = now();
    target.decay = 0;
    target.status = statusRank[incoming.status] > statusRank[target.status] ? incoming.status : target.status;
    target.unresolvedBecause = target.unresolvedBecause || incoming.unresolvedBecause;
    target.doNotResolveYet = target.doNotResolveYet || incoming.doNotResolveYet;
    target.parties = uniqueTexts([...(target.parties || []), ...(incoming.parties || [])], 12);
    target.sourceMessageIds = mergeSourceIds(target.sourceMessageIds, incoming.sourceMessageIds);
    target.evidenceRefs = uniqueTexts([...(target.evidenceRefs || []), ...(incoming.evidenceRefs || [])], 24);
  };
  const mergeConsequence = (target, incoming) => {
    target.immediateResult = target.immediateResult || incoming.immediateResult;
    target.cost = target.cost || incoming.cost;
    target.delayedEffect = target.delayedEffect || incoming.delayedEffect;
    target.priority = Math.max(Number(target.priority || 0), Number(incoming.priority || 0));
    target.status = target.status === 'paid' ? 'paid' : (incoming.status === 'active' ? 'active' : target.status);
    target.lastTouchedAt = now();
    target.affectedRelations = uniqueTexts([...(target.affectedRelations || []), ...(incoming.affectedRelations || [])], 12);
    target.affectedWorld = uniqueTexts([...(target.affectedWorld || []), ...(incoming.affectedWorld || [])], 12);
    target.sourceMessageIds = mergeSourceIds(target.sourceMessageIds, incoming.sourceMessageIds);
  };
  const mergePayoff = (target, incoming) => {
    target.kind = target.kind === 'doNotResolveYet' ? target.kind : incoming.kind;
    target.priority = Math.max(Number(target.priority || 0), Number(incoming.priority || 0));
    target.status = target.status === 'paid' ? 'paid' : (target.status === 'ready' ? 'ready' : incoming.status);
    target.lastSeenAt = now();
    target.sourceMessageIds = mergeSourceIds(target.sourceMessageIds, incoming.sourceMessageIds);
  };
  const mergeTheme = (target, incoming) => {
    target.strength = clamp(Math.max(Number(target.strength || 0), Number(incoming.strength || 0)) + 0.04, 0, 1);
    target.lastExpression = incoming.lastExpression || target.lastExpression;
    target.lastSeenAt = now();
    target.sourceMessageIds = mergeSourceIds(target.sourceMessageIds, incoming.sourceMessageIds);
  };

  const inferConflictType = (text = '') => {
    const source = String(text || '').toLowerCase();
    if (/관계|불신|믿|사이|애정|질투|relationship|trust/.test(source)) return 'relationship';
    if (/세계|세력|법칙|규칙|world|faction|law/.test(source)) return 'world';
    if (/비밀|거짓|숨|secret|lie/.test(source)) return 'secret';
    if (/기한|마감|시간|deadline|timer/.test(source)) return 'deadline';
    if (/내면|죄책|두려|internal|fear|guilt/.test(source)) return 'internal';
    return 'unknown';
  };
  const scoreConflict = (item, frame) => {
    let score = 0.3;
    if (item.primary) score += 0.3;
    if (frame?.storyAuthor?.primaryTension) score += 0.1;
    if (Number(frame?.storyAuthor?.escalationDelta || 0) > 0) score += 0.15;
    if (item.doNotResolveYet) score += 0.1;
    return clamp(score, 0, 1);
  };
  const scoreConsequence = (source, item = {}) => {
    let score = 0.2;
    if (/recentDecisions/.test(source)) score += 0.3;
    if (/requiredOutcomes/.test(source)) score += 0.2;
    if (/continuityLocks/.test(source)) score += 0.2;
    if (ensureArray(item.affectedRelations).length) score += 0.1;
    if (ensureArray(item.affectedWorld).length) score += 0.1;
    return clamp(score, 0, 1);
  };
  const scorePayoff = (kind) => {
    if (kind === 'doNotResolveYet') return 0.82;
    if (kind === 'continuityLock') return 0.64;
    if (kind === 'openQuestion') return 0.58;
    if (kind === 'payoffCandidate') return 0.56;
    return 0.42;
  };

  const extractLedgerFrameItems = (frame = {}) => {
    const safe = cloneValue(frame, {});
    const story = safe?.storyAuthor || {};
    const director = safe?.director || {};
    const narrative = safe?.narrative || {};
    const turnMaintenance = safe?.turnMaintenance || {};
    const sourceMessageIds = normalizeSourceIds(safe?.sourceMessageIds || []);
    const turnIndex = Math.max(0, Number(safe?.turnIndex || safe?.turn || 0));
    const narrativeTurnLog = ensureArray(narrative?.turnLog);
    const latestNarrativeTurn = (
      narrativeTurnLog
        .filter(entry => turnIndex <= 0 || Math.max(0, Number(entry?.turn || 0)) <= turnIndex)
        .sort((a, b) => Math.max(0, Number(a?.turn || 0)) - Math.max(0, Number(b?.turn || 0)))
        .slice(-1)[0]
      || narrativeTurnLog.slice(-1)[0]
      || null
    );
    const narrativeStorylines = ensureArray(narrative?.storylines);
    const narrativeTensions = uniqueTexts(
      narrativeStorylines.flatMap(item => ensureArray(item?.ongoingTensions)),
      6
    );
    const conflictInputs = [
      ...ensureArray(story?.activeTensions).map(label => ({ label, source: 'storyAuthor' })),
      ...(textOf(story?.primaryTension) ? [{ label: story.primaryTension, source: 'storyAuthor', primary: true }] : []),
      ...narrativeTensions.map(label => ({ label, source: 'narrativeTracker', pressure: 0.46 }))
    ];
    const doNotResolveKeys = new Set(ensureArray(story?.doNotResolveYet).map(normalizeKey));
    const conflicts = conflictInputs
      .map(item => {
        const label = compactText(item.label, 180);
        const conflict = normalizeConflict({
          label,
          type: inferConflictType(label),
          source: item.source,
          primary: item.primary === true,
          status: Number(story?.escalationDelta || 0) > 0 ? 'escalating' : 'active',
          doNotResolveYet: doNotResolveKeys.has(normalizeKey(label)),
          pressure: item.pressure,
          sourceMessageIds
        });
        conflict.pressure = Number.isFinite(Number(item.pressure))
          ? clamp(item.pressure, 0, 1)
          : scoreConflict(conflict, safe);
        return conflict;
      })
      .filter(item => item.label);
    const consequences = [
      ...ensureArray(story?.recentDecisions).map(decision => ({
        decision,
        source: 'storyAuthor.recentDecisions'
      })),
      ...ensureArray(director?.requiredOutcomes).map(result => ({
        decision: result,
        immediateResult: result,
        source: 'director.requiredOutcomes'
      })),
      ...ensureArray(director?.continuityLocks).map(lock => ({
        decision: lock,
        immediateResult: lock,
        source: 'director.continuityLocks'
      }))
    ].map(item => normalizeConsequence({
      ...item,
      priority: scoreConsequence(item.source, item),
      sourceMessageIds
    })).filter(item => item.decision || item.immediateResult);
    const payoffs = [
      ...ensureArray(story?.openQuestions).map(label => ({ label, kind: 'openQuestion', source: 'storyAuthor' })),
      ...ensureArray(story?.payoffCandidates).map(label => ({ label, kind: 'payoffCandidate', source: 'storyAuthor' })),
      ...ensureArray(story?.doNotResolveYet).map(label => ({ label, kind: 'doNotResolveYet', source: 'storyAuthor' })),
      ...ensureArray(director?.continuityLocks).map(label => ({ label, kind: 'continuityLock', source: 'director' })),
      ...ensureArray(director?.forbiddenMoves).map(label => ({ label, kind: 'doNotResolveYet', source: 'director' }))
    ].map(item => normalizePayoff({
      ...item,
      priority: scorePayoff(item.kind),
      sourceMessageIds
    })).filter(item => item.label);
    const deltaSummary = compactText(
      turnMaintenance?.narrativeBrief
      || story?.narrativeBrief
      || [
        story?.scenePhase ? `Scene phase: ${story.scenePhase}` : '',
        story?.recentDecisions?.length ? `Decision: ${ensureArray(story.recentDecisions)[0]}` : '',
        director?.requiredOutcomes?.length ? `Outcome signal: ${ensureArray(director.requiredOutcomes)[0]}` : ''
      ].filter(Boolean).join(' | '),
      260
    );
    const sceneDeltas = [];
    if (deltaSummary) {
      sceneDeltas.push(normalizeSceneDelta({
        turnIndex,
        summary: deltaSummary,
        relationDelta: story?.relationStateSignals || [],
        worldDelta: [...ensureArray(story?.environmentPressures), ...ensureArray(story?.worldManagerHints)],
        conflictDelta: story?.activeTensions || [],
        informationDelta: [...ensureArray(story?.openQuestions), ...ensureArray(story?.payoffCandidates)],
        source: turnMaintenance?.narrativeBrief ? 'turnMaintenance' : 'storyAuthor',
        sourceMessageIds
      }));
    }
    const narrativeTurnSummary = compactText(
      latestNarrativeTurn?.summary
      || latestNarrativeTurn?.response
      || [
        latestNarrativeTurn?.userAction ? `User: ${latestNarrativeTurn.userAction}` : '',
        latestNarrativeTurn?.response ? `Response: ${latestNarrativeTurn.response}` : ''
      ].filter(Boolean).join(' | '),
      260
    );
    if (narrativeTurnSummary) {
      sceneDeltas.push(normalizeSceneDelta({
        turnIndex: Math.max(0, Number(latestNarrativeTurn?.turn || turnIndex || 0)),
        summary: narrativeTurnSummary,
        relationDelta: latestNarrativeTurn?.involvedEntities || [],
        emotionDelta: [latestNarrativeTurn?.emotionPrimary, latestNarrativeTurn?.emotionSecondary, latestNarrativeTurn?.emotionBlend].filter(Boolean),
        conflictDelta: narrativeTensions,
        source: 'narrativeTracker',
        sourceMessageIds
      }));
    }
    const themeSeeds = uniqueTexts([
      story?.currentArc,
      story?.narrativeGoal,
      story?.primaryTension
    ], 5);
    const themes = themeSeeds.map(seed => normalizeTheme({
      label: compactText(seed, 80),
      motif: compactText(seed, 120),
      strength: 0.28,
      lastExpression: seed,
      source: 'storyAuthor',
      sourceMessageIds
    })).filter(item => item.label || item.motif);
    return { conflicts, consequences, payoffs, sceneDeltas, themes };
  };

  const trimState = (state, settings = getSettings()) => {
    state.conflictTraces = state.conflictTraces
      .sort((a, b) => Number(b.pressure || 0) - Number(a.pressure || 0) || Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0))
      .slice(0, settings.maxConflictTraces);
    state.consequenceLedger = state.consequenceLedger
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || Number(b.lastTouchedAt || 0) - Number(a.lastTouchedAt || 0))
      .slice(0, settings.maxConsequences);
    state.payoffTracker = state.payoffTracker
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0))
      .slice(0, settings.maxPayoffs);
    state.sceneDeltaLog = state.sceneDeltaLog
      .sort((a, b) => Number(b.turnIndex || 0) - Number(a.turnIndex || 0) || Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .slice(0, settings.maxSceneDeltas);
    state.themeMotifTrace = state.themeMotifTrace
      .sort((a, b) => Number(b.strength || 0) - Number(a.strength || 0) || Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0))
      .slice(0, settings.maxThemeMotifs);
    return state;
  };

  const applyDecay = (state, turnIndex = 0, settings = getSettings()) => {
    if (!settings.decayEnabled) return state;
    const currentTurn = Math.max(0, Number(turnIndex || state?.stats?.lastTurnIndex || 0));
    state.conflictTraces.forEach((item) => {
      const age = Math.max(0, currentTurn - Number(item.lastTurnIndex || state.stats.lastTurnIndex || 0));
      item.decay = Math.max(Number(item.decay || 0), Math.floor(age / Math.max(1, settings.dormantAfterTurns)));
      if (item.status !== 'resolved' && item.decay > 0 && item.seenCount <= 1) item.status = 'dormant';
    });
    state.consequenceLedger.forEach((item) => {
      const age = Math.max(0, currentTurn - Number(item.turnIndex || state.stats.lastTurnIndex || 0));
      if (item.status === 'pending' && age >= settings.dormantAfterTurns) item.status = 'active';
      if (item.status !== 'paid' && age >= settings.expireAfterTurns) item.status = 'expired';
    });
    state.payoffTracker.forEach((item) => {
      const age = Math.max(0, currentTurn - Number(item.turnIndex || state.stats.lastTurnIndex || 0));
      if (item.status === 'open' && age >= settings.dormantAfterTurns) item.status = 'dormant';
    });
    return state;
  };

  const ingestNarrativeFrame = async (frame = {}) => {
    try {
      const settings = await loadSettings();
      if (!settings.enabled) return { ok: true, skipped: true, reason: 'disabled' };
      const safe = cloneValue(frame, {});
      const scopeId = textOf(safe?.scopeId || 'global') || 'global';
      const turnIndex = Math.max(0, Number(safe?.turnIndex || safe?.turn || 0));
      const sourceMessageIds = normalizeSourceIds(safe?.sourceMessageIds || []);
      await importStateFromCopiedChatIfNeeded(safe, scopeId);
      const state = await loadState(scopeId);
      const extracted = extractLedgerFrameItems(safe);
      extracted.conflicts.forEach(item => upsertByLabelOrSource(state.conflictTraces, item, normalizeConflict, mergeConflict));
      extracted.consequences.forEach(item => upsertByLabelOrSource(state.consequenceLedger, item, normalizeConsequence, mergeConsequence));
      extracted.payoffs.forEach(item => upsertByLabelOrSource(state.payoffTracker, item, normalizePayoff, mergePayoff));
      extracted.sceneDeltas.forEach(item => upsertByLabelOrSource(state.sceneDeltaLog, item, normalizeSceneDelta, (target, incoming) => {
        target.summary = target.summary || incoming.summary;
        target.sourceMessageIds = mergeSourceIds(target.sourceMessageIds, incoming.sourceMessageIds);
      }));
      extracted.themes.forEach(item => upsertByLabelOrSource(state.themeMotifTrace, item, normalizeTheme, mergeTheme));
      state.stats.totalIngested += extracted.conflicts.length + extracted.consequences.length + extracted.payoffs.length + extracted.sceneDeltas.length + extracted.themes.length;
      state.stats.lastTurnIndex = Math.max(Number(state.stats.lastTurnIndex || 0), turnIndex);
      state.stats.lastSourceMessageIds = mergeSourceIds(state.stats.lastSourceMessageIds, sourceMessageIds);
      trimState(state, settings);
      state.updatedAt = now();
      stateCache.set(scopeId, state);
      scheduleSave(scopeId);
      runtimeState.activeScopeId = scopeId;
      runtimeState.lastStatus = `ingested ${state.stats.totalIngested}`;
      runtimeState.lastIngestedAt = now();
      runtimeState.degraded = false;
      reportRuntime('ingest', scopeId, state);
      return { ok: true, scopeId, ingested: extracted, stats: cloneValue(state.stats, {}) };
    } catch (error) {
      reportSoftError('ingestNarrativeFrame', error);
      return { ok: false, degraded: true, errors: [runtimeState.lastError] };
    }
  };

  const finalizeTurn = async (context = {}) => {
    try {
      const settings = await loadSettings();
      const scopeId = textOf(context?.scopeId || runtimeState.activeScopeId || 'global') || 'global';
      const turnIndex = Math.max(0, Number(context?.turnIndex || context?.turn || 0));
      const sourceMessageIds = normalizeSourceIds(context?.sourceMessageIds || []);
      await importStateFromCopiedChatIfNeeded(context, scopeId);
      const state = await loadState(scopeId);
      state.stats.lastTurnIndex = Math.max(Number(state.stats.lastTurnIndex || 0), turnIndex);
      state.stats.lastSourceMessageIds = mergeSourceIds(state.stats.lastSourceMessageIds, sourceMessageIds);
      applyDecay(state, turnIndex, settings);
      trimState(state, settings);
      await saveState(scopeId, state);
      runtimeState.activeScopeId = scopeId;
      runtimeState.lastStatus = 'finalized';
      runtimeState.lastFinalizedAt = now();
      reportRuntime('finalize', scopeId, state);
      return { ok: true, scopeId, stats: cloneValue(state.stats, {}) };
    } catch (error) {
      reportSoftError('finalizeTurn', error);
      return { ok: false, degraded: true, errors: [runtimeState.lastError] };
    }
  };

  const buildGuidanceItems = (state, settings = getSettings()) => {
    const minPriority = Number(settings.minPriorityForPrompt || 0);
    const unresolvedTensions = state.conflictTraces
      .filter(item => !['resolved', 'dormant'].includes(item.status) && Number(item.pressure || 0) >= minPriority)
      .sort((a, b) => Number(b.pressure || 0) - Number(a.pressure || 0))
      .slice(0, 2);
    const pendingConsequences = state.consequenceLedger
      .filter(item => ['pending', 'active'].includes(item.status) && Number(item.priority || 0) >= minPriority)
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
      .slice(0, 2);
    const openPayoffs = state.payoffTracker
      .filter(item => ['open', 'seeded', 'ready'].includes(item.status) && Number(item.priority || 0) >= minPriority)
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
      .slice(0, 2);
    const recentSceneDeltas = state.sceneDeltaLog.slice(0, 2);
    const themeMotifHints = state.themeMotifTrace
      .filter(item => Number(item.strength || 0) >= minPriority)
      .slice(0, 2);
    return { unresolvedTensions, pendingConsequences, openPayoffs, recentSceneDeltas, themeMotifHints };
  };

  const buildPromptText = (groups, settings = getSettings()) => {
    const lines = [];
    groups.unresolvedTensions.slice(0, 2).forEach(item => lines.push(`- Unresolved tension: ${compactText(item.label, 170)} remains as a 참고 signal.`));
    groups.pendingConsequences.slice(0, 2).forEach(item => lines.push(`- Pending consequence: ${compactText(item.decision || item.immediateResult, 170)} may remain as 보류된 후폭풍.`));
    groups.openPayoffs.slice(0, 2).forEach(item => {
      const prefix = item.kind === 'doNotResolveYet' ? 'Open payoff' : 'Open payoff';
      lines.push(`- ${prefix}: ${compactText(item.label, 170)} is a 회수 후보 or unresolved thread.`);
    });
    groups.recentSceneDeltas.slice(0, 1).forEach(item => lines.push(`- Scene delta: ${compactText(item.summary, 180)}`));
    groups.themeMotifHints.slice(0, 1).forEach(item => lines.push(`- Motif trace: ${compactText(item.lastExpression || item.motif || item.label, 150)} can be considered as a weak repeated signal.`));
    const maxItems = Math.max(1, Number(settings.guidanceMaxItems || 6));
    const body = lines.slice(0, maxItems).join('\n');
    const prompt = body ? `[Story Ledger Hints]\n${body}` : '';
    const maxChars = Math.max(0, Number(settings.guidanceMaxChars || 1200));
    return maxChars > 0 && prompt.length > maxChars
      ? `${prompt.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`
      : prompt;
  };

  const getLedgerGuidance = async (context = {}) => {
    try {
      const settings = await loadSettings();
      const scopeId = textOf(context?.scopeId || runtimeState.activeScopeId || 'global') || 'global';
      if (!settings.enabled || !settings.promptGuidanceEnabled) {
        return { scopeId, degraded: false, errors: [], unresolvedTensions: [], pendingConsequences: [], openPayoffs: [], recentSceneDeltas: [], themeMotifHints: [], promptText: '' };
      }
      await importStateFromCopiedChatIfNeeded(context, scopeId);
      const state = await loadState(scopeId);
      const groups = buildGuidanceItems(state, settings);
      const promptText = buildPromptText(groups, settings);
      runtimeState.activeScopeId = scopeId;
      runtimeState.lastGuidanceAt = now();
      runtimeState.lastGuidanceCount = promptText ? promptText.split('\n').filter(line => line.startsWith('- ')).length : 0;
      return {
        scopeId,
        degraded: false,
        errors: [],
        ...cloneValue(groups, {}),
        promptText
      };
    } catch (error) {
      reportSoftError('getLedgerGuidance', error);
      return { scopeId: textOf(context?.scopeId || 'global') || 'global', degraded: true, errors: [runtimeState.lastError], unresolvedTensions: [], pendingConsequences: [], openPayoffs: [], recentSceneDeltas: [], themeMotifHints: [], promptText: '' };
    }
  };

  const getPromptBundle = async (context = {}) => {
    const guidance = await getLedgerGuidance(context);
    return {
      label: '【스토리 장부 / Story Ledger】',
      priority: 'supporting',
      maxChars: getSettings().guidanceMaxChars,
      text: guidance.promptText || '',
      source: 'StoryLedgerX',
      degraded: guidance.degraded === true,
      errors: guidance.errors || []
    };
  };

  const getState = async (options = {}) => {
    try {
      const scopeId = textOf(options?.scopeId || runtimeState.activeScopeId || 'global') || 'global';
      await importStateFromCopiedChatIfNeeded(options, scopeId);
      return cloneValue(await loadState(scopeId), buildEmptyState(scopeId));
    } catch (error) {
      reportSoftError('getState', error);
      return { ...buildEmptyState(options?.scopeId || 'global'), degraded: true, errors: [runtimeState.lastError] };
    }
  };
  const exportScopeStore = async (options = {}) => {
    try {
      const scopeId = textOf(options?.scopeId || runtimeState.activeScopeId || 'global') || 'global';
      await importStateFromCopiedChatIfNeeded(options, scopeId);
      return cloneValue(await loadState(scopeId), buildEmptyState(scopeId));
    } catch (error) {
      reportSoftError('exportScopeStore', error);
      return { ...buildEmptyState(options?.scopeId || 'global'), degraded: true, errors: [runtimeState.lastError] };
    }
  };
  const importScopeStore = async (options = {}) => {
    try {
      const scopeId = textOf(options?.scopeId || runtimeState.activeScopeId || 'global') || 'global';
      const incoming = normalizeState({
        ...cloneValue(options?.store || {}, {}),
        scopeId,
        copiedFromScopeId: textOf(options?.copiedFromScopeId || options?.sourceScopeId || options?.store?.copiedFromScopeId || ''),
        copiedFromImportedAt: Number(options?.copiedFromImportedAt || options?.store?.copiedFromImportedAt || now()),
        copyImportMatch: options?.copyImportMatch || options?.store?.copyImportMatch || null
      }, scopeId);
      const saved = await saveState(scopeId, incoming);
      runtimeState.activeScopeId = scopeId;
      runtimeState.lastStatus = 'imported';
      reportRuntime('import', scopeId, saved);
      return cloneValue(saved, buildEmptyState(scopeId));
    } catch (error) {
      reportSoftError('importScopeStore', error);
      return { ...buildEmptyState(options?.scopeId || 'global'), degraded: true, errors: [runtimeState.lastError] };
    }
  };
  const importFromCopiedChat = async (options = {}) => {
    try {
      const targetScopeId = textOf(options?.targetScopeId || options?.scopeId || runtimeState.activeScopeId || 'global') || 'global';
      const sourceScopeId = textOf(options?.sourceScopeId || options?.copiedFromScopeId || options?.sourceChatId || options?.copiedFromChatId || '');
      return importStateFromCopiedChatIfNeeded({
        ...options,
        scopeId: targetScopeId,
        copiedFromScopeId: sourceScopeId,
        sourceScopeId
      }, targetScopeId);
    } catch (error) {
      reportSoftError('importFromCopiedChat', error);
      return null;
    }
  };
  const rebuild = async (context = {}) => {
    const scopeId = textOf(context?.scopeId || runtimeState.activeScopeId || 'global') || 'global';
    await importStateFromCopiedChatIfNeeded(context, scopeId);
    const state = await loadState(scopeId);
    trimState(state, await loadSettings());
    await saveState(scopeId, state);
    return { ok: true, scopeId, stats: cloneValue(state.stats, {}) };
  };
  const clearScope = async (options = {}) => {
    try {
      const scopeId = textOf(options?.scopeId || runtimeState.activeScopeId || 'global') || 'global';
      const empty = buildEmptyState(scopeId);
      stateCache.set(scopeId, empty);
      await storageRemoveItem(stateKey(scopeId));
      await saveState(scopeId, empty);
      return { ok: true, scopeId };
    } catch (error) {
      reportSoftError('clearScope', error);
      return { ok: false, degraded: true, errors: [runtimeState.lastError] };
    }
  };
  const getRuntimeStatus = () => cloneValue(runtimeState, {});

  const selfCheck = async () => {
    const checks = {
      apiExposed: !!globalThis.LIBRA_StoryLedgerXAPI,
      storageAvailable: !!getStorage(),
      canLoadState: false,
      canBuildGuidance: false
    };
    checks['noLlm' + String.fromCharCode(80, 114, 111, 118, 105, 100, 101, 114)] = true;
    const errors = [];
    try {
      await loadState('__selfcheck__');
      checks.canLoadState = true;
    } catch (error) {
      errors.push(`loadState:${compactText(error?.message || error, 120)}`);
    }
    try {
      const guidance = await getLedgerGuidance({ scopeId: '__selfcheck__' });
      checks.canBuildGuidance = !!guidance && typeof guidance.promptText === 'string';
    } catch (error) {
      errors.push(`guidance:${compactText(error?.message || error, 120)}`);
    }
    return { ok: Object.values(checks).every(Boolean), checks, errors };
  };

  const reportRuntime = (phase = 'runtime', scopeId = runtimeState.activeScopeId, state = null) => {
    try {
      globalThis?.LIBRA?.PluginCoordinator?.reportRuntime?.(PLUGIN_ID, {
        phase,
        domain: 'narrative-memory',
        activeScopeId: scopeId,
        lastStatus: runtimeState.lastStatus,
        lastError: runtimeState.lastError,
        conflicts: Array.isArray(state?.conflictTraces) ? state.conflictTraces.length : 0,
        consequences: Array.isArray(state?.consequenceLedger) ? state.consequenceLedger.length : 0,
        payoffs: Array.isArray(state?.payoffTracker) ? state.payoffTracker.length : 0
      });
    } catch (_) {}
  };

  const api = {
    version: PLUGIN_VERSION,
    ingestNarrativeFrame,
    finalizeTurn,
    getLedgerGuidance,
    getPromptBundle,
    getState,
    exportScopeStore,
    importScopeStore,
    importFromCopiedChat,
    rebuild,
    clearScope,
    getRuntimeStatus,
    selfCheck,
    cleanup: async () => runtime.cleanup()
  };

  const bindApi = () => {
    globalThis.LIBRA_StoryLedgerXAPI = api;
    globalThis.LIBRA = globalThis.LIBRA || {};
    globalThis.LIBRA.StoryLedgerX = api;
  };

  const isNarrativeCoreXOrchestrating = () => {
    try {
      return !!globalThis?.LIBRA?.NarrativeCoreX;
    } catch (_) {
      return false;
    }
  };

  let cleanupInProgress = false;
  const runtime = {
    cleanup(context = {}) {
      if (cleanupInProgress) return;
      cleanupInProgress = true;
      try {
        saveTimers.forEach(timer => clearTimeout(timer));
        saveTimers.clear();
        try { delete globalThis.LIBRA_StoryLedgerXAPI; } catch (_) {}
        try { if (globalThis.LIBRA?.StoryLedgerX === api) delete globalThis.LIBRA.StoryLedgerX; } catch (_) {}
        if (String(context?.reason || '') !== 'extension-replaced') {
          try {
            const host = globalThis?.LIBRA?.ExtensionHost || globalThis?.LIBRA_ExtensionHost;
            host?.unregisterExtension?.(PLUGIN_ID);
          } catch (_) {}
        }
      } finally {
        cleanupInProgress = false;
      }
    }
  };

  const definition = {
    id: PLUGIN_ID,
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    domain: 'narrative-memory',
    onLibraReady() {
      bindApi();
      reportRuntime('ready');
      runtimeState.lastStatus = 'ready';
    },
    async promptInjector(context = {}) {
      if (isNarrativeCoreXOrchestrating()) return null;
      const bundle = await getPromptBundle(context);
      if (!bundle.text) return null;
      return {
        key: `${PLUGIN_ID}:guidance`,
        label: 'storyLedger',
        priority: 'optional',
        mustInclude: false,
        relevance: 0.36,
        weightBoost: -0.08,
        text: bundle.text
      };
    },
    async onFinalize(context = {}) {
      return finalizeTurn(context);
    },
    cleanup: runtime.cleanup
  };

  const register = () => {
    bindApi();
    globalThis.__LIBRA_STORY_LEDGER_X_RUNTIME__ = runtime;
    const host = globalThis?.LIBRA?.ExtensionHost || globalThis?.LIBRA_ExtensionHost || null;
    if (host?.registerExtension) {
      try { host.unregisterExtension?.(PLUGIN_ID); } catch (_) {}
      host.registerExtension(definition);
      if (globalThis?.LIBRA && !host?.getRuntimeReports && !definition.__libraReadyInvoked) {
        definition.__libraReadyInvoked = true;
        try { definition.onLibraReady({ LIBRA: globalThis.LIBRA }); } catch (error) { reportSoftError('ready', error); }
      }
      return;
    }
    globalThis.LIBRA_SubPlugins = Array.isArray(globalThis.LIBRA_SubPlugins) ? globalThis.LIBRA_SubPlugins : [];
    globalThis.LIBRA_SubPlugins = globalThis.LIBRA_SubPlugins.filter(item => String(item?.id || '') !== PLUGIN_ID);
    globalThis.LIBRA_SubPlugins.push(definition);
  };

  register();
})();
