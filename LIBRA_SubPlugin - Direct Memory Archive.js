(async () => {
  'use strict';

  /**
   * Direct Memory Archive
   *
   * Canonical raw/direct evidence preservation archive, independent from legacy memory.
   * DMA owns direct entries, previous archive entries, pending captures, repair queues,
   * sourceMessageIds lineage, and evidence APIs for other LIBRA modules.
   * Legacy memory remains a compatibility, migration, and fallback layer.
   */

  try {
    await globalThis.__LIBRA_DMA_RUNTIME__?.cleanup?.();
  } catch (_) {}

  const PLUGIN_ID = 'libra.directMemoryArchive';
  const PLUGIN_NAME = 'Direct Memory Archive';
  const STORAGE_PREFIX = 'LIBRA_DIRECT_MEMORY_ARCHIVE_V1::';
  const STORAGE_INDEX_KEY = `${STORAGE_PREFIX}__index__`;
  const CONFIG = {
    directPromptLimit: 5,
    previousPromptLimit: 4,
    qnaDirectLimit: 4,
    qnaPreviousLimit: 4,
    maxDirectEntries: 240,
    maxPreviousEntries: 48,
    maxPendingCaptures: 64,
    maxRepairQueue: 96,
    maxDeletedTurnTombstones: 240,
    autoMergeDirectEntriesByTurn: true,
    pendingMaxAgeMs: 1000 * 60 * 60 * 6,
    repairMaxAgeMs: 1000 * 60 * 60 * 24 * 14,
    archiveMinAgeTurns: 6,
    archiveGroupTurns: 4,
    archiveMinGroupSize: 2,
    previousEvidencePerItem: 2
  };

  const TEXT_LIMITS = {
    userText: 5000,
    assistantText: 16000,
    manualText: 8000,
    summaryText: 240,
    guiBodyResponse: 16000,
    guiBodyUser: 1200
  };

  const runtimeState = {
    activeScopeId: 'global',
    lastStatus: 'idle',
    lastError: '',
    lastSavedAt: 0,
    lastArchiveAt: 0,
    lastDirectCount: 0,
    lastPreviousCount: 0,
    lastPendingCount: 0,
    lastRepairQueueCount: 0,
    lastPreview: '',
    lastAlignedAt: 0,
    lastMergedAt: 0
  };

  const storeCache = new Map();
  const storeLoadPromises = new Map();
  const storeSaveTimers = new Map();
  let panelHandlersBound = false;
  let dmaPanelClickHandler = null;
  let dmaMemoryModalRoot = null;
  const dmaViewerState = {
    scopeId: 'global',
    tab: 'direct'
  };

  const normalizeText = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();
  const escHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const showDmaNotice = (message = '') => {
    if (typeof document === 'undefined') return;
    const root = document.createElement('div');
    root.setAttribute('data-libra-dma-notice', '1');
    root.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;max-width:min(420px,calc(100vw - 36px));padding:14px 16px;border-radius:14px;border:1px solid rgba(191,219,254,0.8);background:#ffffff;box-shadow:0 18px 44px rgba(15,23,42,0.18);color:#0f172a;font:13px/1.5 system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;font-weight:750';
    root.textContent = String(message || '');
    document.body?.appendChild(root);
    setTimeout(() => {
      try { root.remove(); } catch (_) {}
    }, 3600);
  };

  const confirmDmaAction = (message = '') => new Promise((resolve) => {
    if (typeof document === 'undefined' || !document.body) {
      resolve(true);
      return;
    }
    const overlay = document.createElement('div');
    overlay.setAttribute('data-libra-dma-confirm', '1');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(15,23,42,0.34);backdrop-filter:blur(3px)';
    overlay.innerHTML = `
      <div style="width:min(460px,94vw);border-radius:18px;border:1px solid rgba(191,219,254,0.9);background:#fff;box-shadow:0 24px 70px rgba(15,23,42,0.28);overflow:hidden">
        <div style="padding:18px 20px;border-bottom:1px solid #e2e8f0">
          <div style="font-size:13px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Direct Memory Archive</div>
          <div style="margin-top:6px;font-size:18px;font-weight:950;color:#0f172a">턴 메모리 삭제 확인</div>
        </div>
        <div style="padding:18px 20px;color:#334155;font-size:14px;line-height:1.55">${escHtml(message)}</div>
        <div style="display:flex;gap:10px;justify-content:flex-end;padding:14px 20px 18px;background:#f8fafc">
          <button type="button" data-dma-confirm-result="cancel" style="padding:10px 14px;border-radius:11px;border:1px solid #cbd5e1;background:#fff;color:#334155;font-weight:850;cursor:pointer">취소</button>
          <button type="button" data-dma-confirm-result="ok" style="padding:10px 14px;border-radius:11px;border:1px solid rgba(220,38,38,0.35);background:#fff1f2;color:#be123c;font-weight:950;cursor:pointer">삭제</button>
        </div>
      </div>
    `;
    const finish = (ok) => {
      try { overlay.remove(); } catch (_) {}
      resolve(!!ok);
    };
    overlay.addEventListener('click', (event) => {
      const resultNode = event.target?.closest?.('[data-dma-confirm-result]');
      if (resultNode) {
        finish(String(resultNode.getAttribute('data-dma-confirm-result') || '') === 'ok');
        return;
      }
      if (event.target === overlay) finish(false);
    }, true);
    document.body.appendChild(overlay);
  });

  const compactText = (value = '', maxLen = 0) => {
    const text = normalizeText(value);
    if (!text) return '';
    if (!maxLen || text.length <= maxLen) return text;
    const slice = text.slice(0, maxLen);
    const lastSpace = slice.lastIndexOf(' ');
    const safe = lastSpace > Math.floor(maxLen * 0.6) ? slice.slice(0, lastSpace) : slice;
    return `${safe.trim()}…`;
  };

  const safeJsonParse = (raw, fallback = null) => {
    if (raw == null || raw === '') return fallback;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  };

  const simpleHash = (value = '') => {
    const text = String(value || '');
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  };

  const uniqueTexts = (items = [], limit = 8) => {
    const out = [];
    const seen = new Set();
    for (const item of (Array.isArray(items) ? items : [])) {
      const text = normalizeText(item);
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(text);
      if (out.length >= Math.max(1, Number(limit || 0))) break;
    }
    return out;
  };

  const getRisuApi = () => {
    if (typeof globalThis === 'undefined') return null;
    return globalThis.Risuai || globalThis.risuai || null;
  };

  const getRuntimeBridge = () => {
    try {
      return globalThis?.LIBRA?.RuntimeBridge || globalThis?.LIBRA_RuntimeBridge || null;
    } catch (_) {
      return null;
    }
  };

  const getPluginCoordinator = () => {
    try {
      return globalThis?.LIBRA?.PluginCoordinator || globalThis?.LIBRA_SubPluginCoordinator || null;
    } catch (_) {
      return null;
    }
  };

  const getMemoryEngine = () => {
    try {
      return globalThis?.LIBRA?.MemoryEngine || null;
    } catch (_) {
      return null;
    }
  };
  const getSharedRuntimeHelpers = () => {
    try {
      return globalThis?.LIBRA_SharedRuntimeHelpers || null;
    } catch (_) {
      return null;
    }
  };

  const getChatMessages = (chat) => {
    if (!chat || typeof chat !== 'object') return [];
    return chat.msgs || chat.messages || chat.message || chat.log || chat.mes || chat.chat || [];
  };

  const getMessageText = (msg) => {
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

  const normalizeCanonicalMessageIds = (value) => {
    const candidates = Array.isArray(value)
      ? value
      : [
          value,
          value?.id,
          value?.messageId,
          value?.m_id,
          ...(Array.isArray(value?.sourceMessageIds) ? value.sourceMessageIds : []),
          ...(Array.isArray(value?.m_ids) ? value.m_ids : []),
          ...(Array.isArray(value?.liveMessageIds) ? value.liveMessageIds : [])
        ];
    return [...new Set(
      candidates
        .flatMap(item => Array.isArray(item) ? item : [item])
        .map(item => String(item || '').trim())
        .filter(Boolean)
    )];
  };

  const getLiveMessageId = (msg) => String(normalizeCanonicalMessageIds(msg)[0] || '').trim();

  const resolveContextScope = async (context = {}) => {
    const runtimeBridge = getRuntimeBridge();
    let bridged = null;
    if (runtimeBridge?.getActiveChatContext) {
      try {
        bridged = await runtimeBridge.getActiveChatContext(context?.chat || null);
      } catch (_) {
        bridged = null;
      }
    }
    const chat = context?.chat || bridged?.chat || null;
    const char = context?.char || bridged?.char || null;
    const lorebook = Array.isArray(context?.lore)
      ? context.lore
      : (Array.isArray(bridged?.lore)
        ? bridged.lore
        : (() => {
            try {
              return getMemoryEngine()?.getLorebook?.(char, chat) || [];
            } catch (_) {
              return [];
            }
          })());
    const scopeId = resolveScopeId({
      ...context,
      chat,
      scopeId: context?.scopeId || bridged?.scopeId || chat?.id || context?.chat?.id || runtimeState.activeScopeId
    });
    runtimeState.activeScopeId = scopeId;
    return { chat, char, lorebook, scopeId, bridged };
  };

  const cloneValue = (value, fallback = null) => {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return fallback;
    }
  };

  const waitForPluginStorage = async (timeoutMs = 2600, intervalMs = 120) => {
    const started = Date.now();
    while ((Date.now() - started) < timeoutMs) {
      const storage = getRisuApi()?.pluginStorage;
      if (storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function') {
        return storage;
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return null;
  };

  const storageGetItem = async (key) => {
    const runtimeBridge = getRuntimeBridge();
    if (runtimeBridge?.storageGetItem) {
      try {
        return await runtimeBridge.storageGetItem(key);
      } catch (_) {}
    }
    const storage = await waitForPluginStorage();
    if (!storage?.getItem) return null;
    return storage.getItem(key);
  };

  const storageSetItem = async (key, value) => {
    const runtimeBridge = getRuntimeBridge();
    if (runtimeBridge?.storageSetItem) {
      try {
        return await runtimeBridge.storageSetItem(key, value);
      } catch (_) {}
    }
    const storage = await waitForPluginStorage();
    if (!storage?.setItem) return false;
    await storage.setItem(key, value);
    return true;
  };

  const reportCoordinatorRuntime = (extra = {}) => {
    try {
      const coordinator = getPluginCoordinator();
      if (!coordinator?.reportRuntime) return null;
      return coordinator.reportRuntime(PLUGIN_ID, {
        domain: 'memory',
        activeChatId: runtimeState.activeScopeId,
        lastStatus: runtimeState.lastStatus,
        lastError: runtimeState.lastError,
        directEntries: runtimeState.lastDirectCount,
        previousEntries: runtimeState.lastPreviousCount,
        pendingCaptures: runtimeState.lastPendingCount,
        repairQueue: runtimeState.lastRepairQueueCount,
        lastArchiveAt: runtimeState.lastArchiveAt,
        ...(extra && typeof extra === 'object' ? extra : {})
      });
    } catch (_) {
      return null;
    }
  };

  const updateRuntimeStatus = (status = '', extra = {}) => {
    runtimeState.lastStatus = normalizeText(status) || 'idle';
    if (extra?.error) runtimeState.lastError = normalizeText(extra.error);
    if (typeof extra?.preview === 'string') runtimeState.lastPreview = String(extra.preview || '').trim();
    reportCoordinatorRuntime(extra);
    syncPanelValues?.();
  };

  const resolveScopeId = (context = {}) => {
    const chat = context?.chat || null;
    const bridged = getRuntimeBridge()?.getCurrentChat?.() || {};
    const candidates = [
      context?.scopeId,
      chat?.id,
      chat?.chatroom_id,
      chat?.chatId,
      bridged?.chatId,
      `${bridged?.charIdx ?? ''}:${bridged?.chatIndex ?? ''}`,
      runtimeState.activeScopeId,
      'global'
    ];
    for (const raw of candidates) {
      const value = normalizeText(raw);
      if (value && value !== ':') {
        runtimeState.activeScopeId = value;
        return value;
      }
    }
    runtimeState.activeScopeId = 'global';
    return 'global';
  };

  const getStoreKey = (scopeId = 'global') => `${STORAGE_PREFIX}${normalizeText(scopeId) || 'global'}`;

  const loadStoreIndex = async () => {
    const parsed = safeJsonParse(await storageGetItem(STORAGE_INDEX_KEY), null);
    const scopes = Array.isArray(parsed?.scopes) ? parsed.scopes : [];
    return {
      version: 1,
      updatedAt: Number(parsed?.updatedAt || 0),
      scopes: scopes
        .map(item => ({
          scopeId: normalizeText(item?.scopeId),
          updatedAt: Number(item?.updatedAt || 0),
          directEntries: Math.max(0, Number(item?.directEntries || 0)),
          previousEntries: Math.max(0, Number(item?.previousEntries || 0)),
          pendingCaptures: Math.max(0, Number(item?.pendingCaptures || 0)),
          sourceHashes: uniqueTexts(item?.sourceHashes || [], 80),
          sourceMessageIds: uniqueTexts(item?.sourceMessageIds || [], 80)
        }))
        .filter(item => item.scopeId)
    };
  };

  const saveStoreIndexEntry = async (scopeId = 'global', store = {}) => {
    const normalizedScopeId = normalizeText(scopeId) || 'global';
    if (!normalizedScopeId) return false;
    try {
      const directEntries = Array.isArray(store?.directEntries) ? store.directEntries : [];
      const pendingCaptures = Array.isArray(store?.pendingCaptures) ? store.pendingCaptures : [];
      const previousEntries = Array.isArray(store?.previousEntries) ? store.previousEntries : [];
      const sourceRows = [...directEntries, ...pendingCaptures];
      const nextEntry = {
        scopeId: normalizedScopeId,
        updatedAt: Number(store?.updatedAt || Date.now()),
        directEntries: directEntries.length,
        previousEntries: previousEntries.length,
        pendingCaptures: pendingCaptures.length,
        sourceHashes: uniqueTexts(sourceRows.map(entry => entry?.sourceHash).filter(Boolean), 80),
        sourceMessageIds: uniqueTexts(sourceRows.flatMap(entry => entry?.sourceMessageIds || entry?.latestMessageId || []).filter(Boolean), 80)
      };
      const index = await loadStoreIndex();
      const nextScopes = [
        nextEntry,
        ...index.scopes.filter(entry => entry.scopeId !== normalizedScopeId)
      ].slice(0, 240);
      await storageSetItem(STORAGE_INDEX_KEY, JSON.stringify({
        version: 1,
        updatedAt: Date.now(),
        scopes: nextScopes
      }));
      return true;
    } catch (_) {
      return false;
    }
  };

  const getStoreEntryCount = (store = {}) => (
    (Array.isArray(store?.directEntries) ? store.directEntries.length : 0)
    + (Array.isArray(store?.previousEntries) ? store.previousEntries.length : 0)
    + (Array.isArray(store?.pendingCaptures) ? store.pendingCaptures.length : 0)
    + (Array.isArray(store?.repairQueue) ? store.repairQueue.length : 0)
  );

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

  const stripNativeCopySuffix = (value = '') => {
    let text = normalizeText(value);
    for (let i = 0; i < 4; i += 1) {
      const next = normalizeText(text
        .replace(/\s*[\[(](?:copy|copy\s*\d+|copied|사본|복사본)[\])]\s*$/i, '')
        .replace(/\s*[-_:–—]?\s*(?:copy|copy\s*\d+|copied|사본|복사본)\s*$/i, ''));
      if (!next || next === text) break;
      text = next;
    }
    return text;
  };

  const hasNativeCopyNameSignal = (value = '') => /\bcopy\b|copied|복사|사본/i.test(normalizeText(value));

  const buildNativeChatContentSignature = (chat = {}) => {
    const rows = getChatMessages(chat)
      .filter(msg => msg && typeof msg === 'object')
      .map((msg) => {
        const role = normalizeText(msg?.role || (msg?.is_user ? 'user' : 'assistant')).toLowerCase();
        const text = normalizeText(getMessageText(msg));
        return text ? `${role}:${text}` : '';
      })
      .filter(Boolean);
    const joined = rows.join('\n');
    return {
      count: rows.length,
      chars: joined.length,
      hash: rows.length ? simpleHash(joined) : ''
    };
  };

  const isNativeCopiedChatPair = (targetChat = {}, sourceChat = {}) => {
    const targetId = normalizeText(targetChat?.id || targetChat?.chatId || targetChat?.chatroom_id);
    const sourceId = normalizeText(sourceChat?.id || sourceChat?.chatId || sourceChat?.chatroom_id);
    if (!targetId || !sourceId || targetId === sourceId) return false;

    const targetName = normalizeText(targetChat?.name || targetChat?.title || '');
    const sourceName = normalizeText(sourceChat?.name || sourceChat?.title || '');
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

  const findNativeCopiedChatSourceForScope = async (targetScopeId = '') => {
    const normalizedTarget = normalizeText(targetScopeId);
    if (!normalizedTarget || normalizedTarget === 'global') return null;
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

    const activeChat = chats.find(chat => normalizeText(chat?.id || chat?.chatId || chat?.chatroom_id) === normalizedTarget)
      || chats[Math.max(0, Number(character?.chatPage || 0))]
      || null;
    if (!activeChat) return null;

    const candidates = [];
    for (const chat of chats) {
      const sourceScopeId = normalizeText(chat?.id || chat?.chatId || chat?.chatroom_id);
      if (!sourceScopeId || sourceScopeId === normalizedTarget) continue;
      if (!isNativeCopiedChatPair(activeChat, chat)) continue;
      const sourceStore = await loadStore(sourceScopeId);
      const count = getStoreEntryCount(sourceStore);
      if (count <= 0) continue;
      candidates.push({
        sourceScopeId,
        sourceStore,
        count,
        sourceName: normalizeText(chat?.name || chat?.title || '')
      });
    }

    candidates.sort((a, b) => b.count - a.count || a.sourceScopeId.localeCompare(b.sourceScopeId));
    return candidates[0] || null;
  };

  const importStoreFromCopiedChatIfNeeded = async (context = {}, targetScopeId = '') => {
    const normalizedTarget = normalizeText(targetScopeId) || resolveScopeId(context);
    if (!normalizedTarget || normalizedTarget === 'global') return null;
    const sourceScopeId = resolveExplicitCopySourceScopeId(context);
    if (!sourceScopeId || sourceScopeId === normalizedTarget || sourceScopeId === 'global') return null;
    const targetStore = await loadStore(normalizedTarget);
    if (getStoreEntryCount(targetStore) > 0) return null;
    if (Array.isArray(targetStore?.deletedTurns) && targetStore.deletedTurns.length > 0) return null;
    if (targetStore?.copiedFromScopeId || targetStore?.copiedFromImportedAt) return null;
    const sourceStore = await loadStore(sourceScopeId);
    if (getStoreEntryCount(sourceStore) <= 0) return null;
    const cloned = normalizeStore({
      ...cloneValue(sourceStore, {}),
      scopeId: normalizedTarget,
      copiedFromScopeId: sourceScopeId,
      copiedFromImportedAt: Date.now(),
      copyImportMatch: { mode: 'explicit-source' }
    }, normalizedTarget);
    const committed = await commitStore(normalizedTarget, cloned);
    updateRuntimeStatus('chat copy DMA imported', {
      scopeId: normalizedTarget,
      copiedFromScopeId: sourceScopeId,
      directEntries: Array.isArray(committed.directEntries) ? committed.directEntries.length : 0,
      previousEntries: Array.isArray(committed.previousEntries) ? committed.previousEntries.length : 0
    });
    return { scopeId: normalizedTarget, store: committed, copiedFromScopeId: sourceScopeId, match: { mode: 'explicit-source' } };
  };

  const importStoreFromNativeCopiedChatIfNeeded = async (context = {}, targetScopeId = '') => {
    const normalizedTarget = normalizeText(targetScopeId) || resolveScopeId(context);
    if (!normalizedTarget || normalizedTarget === 'global') return null;
    const targetStore = await loadStore(normalizedTarget);
    if (getStoreEntryCount(targetStore) > 0) return null;
    if (Array.isArray(targetStore?.deletedTurns) && targetStore.deletedTurns.length > 0) return null;
    if (targetStore?.copiedFromScopeId || targetStore?.copiedFromImportedAt) return null;

    const source = await findNativeCopiedChatSourceForScope(normalizedTarget);
    if (!source?.sourceScopeId || !source?.sourceStore) return null;
    const cloned = normalizeStore({
      ...cloneValue(source.sourceStore, {}),
      scopeId: normalizedTarget,
      copiedFromScopeId: source.sourceScopeId,
      copiedFromImportedAt: Date.now(),
      copyImportMatch: {
        mode: 'native-risu-chat-copy',
        sourceName: source.sourceName || '',
        entryCount: source.count
      }
    }, normalizedTarget);
    const committed = await commitStore(normalizedTarget, cloned);
    updateRuntimeStatus('native chat copy DMA imported', {
      scopeId: normalizedTarget,
      copiedFromScopeId: source.sourceScopeId,
      directEntries: Array.isArray(committed.directEntries) ? committed.directEntries.length : 0,
      previousEntries: Array.isArray(committed.previousEntries) ? committed.previousEntries.length : 0,
      preview: `DMA copied from native source scope ${source.sourceScopeId}.`
    });
    return {
      scopeId: normalizedTarget,
      store: committed,
      copiedFromScopeId: source.sourceScopeId,
      match: { mode: 'native-risu-chat-copy' }
    };
  };

  const loadScopedVisibleStore = async (context = {}, primaryScopeId = '') => {
    const scopeId = normalizeText(primaryScopeId) || resolveScopeId(context);
    const explicitCopied = await importStoreFromCopiedChatIfNeeded(context, scopeId);
    if (explicitCopied?.store) return explicitCopied;
    const nativeCopied = await importStoreFromNativeCopiedChatIfNeeded(context, scopeId);
    if (nativeCopied?.store) return nativeCopied;
    runtimeState.activeScopeId = scopeId;
    const store = await loadStore(scopeId);
    const autoMerged = mergeStoreDirectEntriesByTurn(store);
    if (autoMerged.mergedAway > 0) {
      trimStore(store);
      return { scopeId, store: await commitStore(scopeId, store), directMerged: autoMerged.mergedAway };
    }
    return { scopeId, store };
  };

  const LOCATION_PATTERN = /(옥상|교실|복도|계단|교무실|운동장|급식실|정문|후문|주차장|도서관|보건실|상담실|체육관|동아리실|강당|지하|샬레|트리니티|총학생회|rooftop|classroom|hallway|corridor|stairs?|office|cafeteria|library|parking|gym|infirmary|auditorium|basement)/gi;
  const CONTINUITY_PATTERNS = [
    /(아직|여전히|계속|이후|다음|남아|미해결|경고|약속|의심|오해|비밀|추적|후폭풍)/i,
    /(still|remain|continue|afterward|next|unresolved|warning|promise|suspicion|misunderstand|secret|trace|aftermath)/i
  ];
  const USER_PATTERNS = [
    /(질문|요청|부탁|확인|설명|거절|선택|이동|호출|경고|속삭|붙잡|놓아)/i,
    /(ask|request|confirm|explain|refus|choose|move|call|warn|whisper|grab|release)/i
  ];
  const AI_PATTERNS = [
    /(반응|해명|설득|경고|오해|대치|합류|결정|전환|추적|목격|폭로|수습)/i,
    /(react|clarif|persuade|warn|misunderstand|standoff|join|decide|shift|trace|witness|reveal|resolve)/i
  ];
  const IMPACT_PATTERNS = [
    /(충돌|갈등|결정|거절|경고|고백|폭로|도망|쫓|합류|배신|구조|붕괴|버리)/i,
    /(conflict|clash|decide|refus|warn|confess|reveal|escape|chase|join|betray|rescue|collapse|abandon)/i
  ];
  const MOOD_PATTERNS = [
    { key: '긴장', regex: /(긴장|불안|경계|압박|초조|tension|anxious|pressure|strain)/i },
    { key: '충돌', regex: /(충돌|갈등|대치|거절|반발|conflict|clash|standoff|resist)/i },
    { key: '흔들림', regex: /(혼란|망설|당황|흔들|머뭇|confus|hesitat|fluster|shaken)/i },
    { key: '유대', regex: /(신뢰|화해|협력|합류|보호|trust|reconcile|cooperat|join|protect)/i }
  ];

  const splitSentences = (text = '') => {
    const normalized = String(text || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/<[^>\n]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return [];
    const parts = normalized
      .replace(/([.!?。！？])/g, '$1|')
      .replace(/(다\.)/g, '$1|')
      .replace(/(요\.)/g, '$1|')
      .split('|')
      .map(part => normalizeText(part))
      .filter(part => part.length >= 8);
    if (parts.length > 0) return parts;
    return normalized
      .split(/[,/]/)
      .map(part => normalizeText(part))
      .filter(part => part.length >= 8);
  };

  const pickSentence = (text = '', patterns = []) => {
    const sentences = splitSentences(text);
    if (!sentences.length) return '';
    const scored = sentences.map((sentence, index) => {
      let score = 0;
      if (patterns.some(pattern => pattern.test(sentence))) score += 4;
      if (/[?!]/.test(sentence)) score += 0.4;
      if (sentence.length >= 18 && sentence.length <= 96) score += 1;
      if (sentence.length > 120) score -= 0.7;
      return { sentence, index, score };
    }).sort((a, b) => b.score - a.score || a.index - b.index);
    return normalizeText(scored[0]?.sentence || sentences[0] || '');
  };

  const extractQuotedDialogue = (text = '', limit = 2) => {
    const found = [];
    const patterns = [
      /"([^"\n]{6,120})"/g,
      /'([^'\n]{6,120})'/g,
      /“([^”\n]{6,120})”/g,
      /‘([^’\n]{6,120})’/g
    ];
    for (const regex of patterns) {
      let match;
      while ((match = regex.exec(String(text || ''))) !== null && found.length < limit) {
        const line = normalizeText(match[1]);
        if (!line || line.length < 6) continue;
        if (!found.includes(line)) found.push(line);
      }
      if (found.length >= limit) break;
    }
    return found;
  };

  const extractLocations = (text = '', limit = 3) => {
    const found = [];
    let match;
    const source = String(text || '');
    while ((match = LOCATION_PATTERN.exec(source)) !== null && found.length < limit) {
      const value = normalizeText(match[0]);
      if (!value || found.includes(value)) continue;
      found.push(value);
    }
    LOCATION_PATTERN.lastIndex = 0;
    return found;
  };

  const extractContinuityHints = (text = '', limit = 3) => {
    const hints = [];
    for (const sentence of splitSentences(text)) {
      if (!CONTINUITY_PATTERNS.some(pattern => pattern.test(sentence))) continue;
      hints.push(compactText(sentence, 96));
      if (hints.length >= limit) break;
    }
    return uniqueTexts(hints, limit);
  };

  const detectMoodTags = (text = '', limit = 4) => {
    const tags = [];
    for (const { key, regex } of MOOD_PATTERNS) {
      if (regex.test(text)) tags.push(key);
      if (tags.length >= limit) break;
    }
    return tags;
  };

  const buildNameVariants = (value = '') => {
    const raw = normalizeText(value);
    if (!raw) return [];
    const variants = new Set([raw]);
    const noParen = normalizeText(raw.replace(/\s*\([^)]*\)\s*/g, ' '));
    if (noParen) variants.add(noParen);
    const paren = raw.match(/\(([^)]+)\)/);
    if (paren?.[1]) variants.add(normalizeText(paren[1]));
    return Array.from(variants).filter(Boolean);
  };

  const extractEntityNames = (text = '', entityManager = null, limit = 8) => {
    const normalized = String(text || '');
    if (!normalized || !entityManager?.getEntityCache) return [];
    const out = [];
    const cache = entityManager.getEntityCache();
    const entities = cache instanceof Map ? Array.from(cache.values()) : [];
    for (const entity of entities) {
      const name = normalizeText(entity?.name || '');
      if (!name) continue;
      let matched = false;
      if (typeof entityManager?.mentionsEntity === 'function') {
        try {
          matched = entityManager.mentionsEntity(normalized, entity) === true;
        } catch (_) {}
      }
      if (!matched) {
        matched = buildNameVariants(name).some(variant => variant && normalized.includes(variant));
      }
      if (!matched) continue;
      if (!out.includes(name)) out.push(name);
      if (out.length >= limit) break;
    }
    return out;
  };

  const buildEpisode = (userText = '', assistantText = '') => {
    const userCue = compactText(
      pickSentence(userText, [...IMPACT_PATTERNS, ...USER_PATTERNS]) || userText,
      52
    );
    const assistantCue = compactText(
      pickSentence(assistantText, [...IMPACT_PATTERNS, ...AI_PATTERNS]) || assistantText,
      72
    );
    if (userCue && assistantCue) return `${userCue} -> ${assistantCue}`;
    return assistantCue || userCue || '';
  };

  const buildEntryPreview = (entry = {}) => {
    if (entry?.manualText) {
      return normalizeText(`${`T${Math.max(0, Number(entry?.turn || 0))}`} ${compactText(entry.manualText, 150)}`);
    }
    const head = `T${Math.max(0, Number(entry?.turn || 0))}`;
    const entities = Array.isArray(entry?.entityNames) && entry.entityNames.length
      ? ` | ${entry.entityNames.slice(0, 3).join(', ')}`
      : '';
    const body = compactText(entry?.episode || entry?.assistantText || entry?.userText || '', 150);
    return normalizeText(`${head}${entities} ${body}`);
  };

  const clampNumber = (value, fallback = 0, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
  };

  const inferTtlFromImportance = (importance = 5) => {
    const normalized = clampNumber(importance, 5, 1, 10);
    if (normalized >= 9) return -1;
    if (normalized >= 7) return 60;
    return 30;
  };

  const CAPTURE_STAGE_PRIORITY = {
    beforeRequestResponse: 1,
    afterRequest: 2,
    finalize: 3,
    recovery: 4,
    manual: 5
  };

  const normalizeCapturePhase = (value = '') => {
    const normalized = normalizeText(value);
    return normalized || 'unknown';
  };

  const getCaptureStagePriority = (phase = '') => CAPTURE_STAGE_PRIORITY[normalizeCapturePhase(phase)] || 0;

  const isCommittedCapturePhase = (phase = '') => {
    const normalized = normalizeCapturePhase(phase);
    return normalized === 'finalize' || normalized === 'recovery' || normalized === 'manual';
  };

  const isTextCompatible = (left = '', right = '') => {
    const a = normalizeText(left);
    const b = normalizeText(right);
    if (!a || !b) return true;
    if (a === b) return true;
    if (a.includes(b) || b.includes(a)) return true;
    const shortA = compactText(a, 120);
    const shortB = compactText(b, 120);
    return !!shortA && shortA === shortB;
  };

  const pickPreferredStageText = (baseText = '', incomingText = '', basePhase = '', incomingPhase = '') => {
    const base = normalizeText(baseText);
    const incoming = normalizeText(incomingText);
    if (!incoming) return base;
    if (!base) return incoming;
    const basePriority = getCaptureStagePriority(basePhase);
    const incomingPriority = getCaptureStagePriority(incomingPhase);
    if (isTextCompatible(base, incoming)) {
      return incoming.length >= base.length ? incoming : base;
    }
    if (incomingPriority > basePriority) return incoming;
    if (incomingPriority === basePriority && incoming.length > base.length) return incoming;
    return base;
  };

  const normalizeDmaTurnAnchor = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0 || num >= 1000000) return 0;
    return Math.floor(num);
  };

  const earliestPositiveTurn = (...values) => {
    const turns = values.map(normalizeDmaTurnAnchor).filter(turn => turn > 0);
    return turns.length ? Math.min(...turns) : 0;
  };

  const getDmaDirectTurnAnchor = (entry = {}) => {
    if (!entry || typeof entry !== 'object') return 0;
    const candidates = [
      entry.lockedTurn,
      entry.turnAnchorTurn,
      entry.finalizedTurn,
      entry.firstTurn,
      entry.originalTurn,
      entry.turnLocked === true ? entry.turn : 0
    ];
    for (const value of candidates) {
      const turn = normalizeDmaTurnAnchor(value);
      if (turn > 0) return turn;
    }
    return 0;
  };

  const chooseEarliestDmaTurnAnchor = (...entries) => {
    const turns = entries
      .flatMap(entry => [
        getDmaDirectTurnAnchor(entry),
        normalizeDmaTurnAnchor(entry?.turn)
      ])
      .filter(turn => turn > 0);
    return turns.length ? Math.min(...turns) : 0;
  };

  const applyDmaDirectTurnAnchor = (entry = {}, turn = 0, reason = '') => {
    if (!entry || typeof entry !== 'object') return entry;
    const anchorTurn = normalizeDmaTurnAnchor(turn || getDmaDirectTurnAnchor(entry) || entry.turn);
    if (anchorTurn <= 0) return entry;
    entry.turn = anchorTurn;
    entry.firstTurn = anchorTurn;
    entry.originalTurn = anchorTurn;
    entry.lockedTurn = anchorTurn;
    entry.finalizedTurn = anchorTurn;
    entry.turnAnchorTurn = anchorTurn;
    entry.turnLocked = true;
    entry.turnAnchor = normalizeText(entry.turnAnchor || 'dma-finalized-direct');
    if (reason) entry.turnAnchorReason = normalizeText(reason);
    return entry;
  };

  const normalizeDirectEntry = (entry = {}) => {
    const importance = clampNumber(entry.importance ?? entry.imp, 5, 1, 10);
    const ttl = Number.isFinite(Number(entry.ttl))
      ? Math.trunc(Number(entry.ttl))
      : inferTtlFromImportance(importance);
    const rawTurn = Math.max(0, Number(entry.turn || 0));
    const lockedTurn = getDmaDirectTurnAnchor(entry) || rawTurn;
    const normalized = {
      id: normalizeText(entry.id),
      signature: normalizeText(entry.signature),
      turn: lockedTurn,
      createdAt: Number(entry.createdAt || Date.now()),
      updatedAt: Number(entry.updatedAt || entry.createdAt || Date.now()),
      phase: normalizeText(entry.phase) || 'finalize',
      runtimeMode: normalizeText(entry.runtimeMode),
      reason: normalizeText(entry.reason),
      latestMessageId: normalizeText(entry.latestMessageId),
      sourceHash: normalizeText(entry.sourceHash),
      captureStages: uniqueTexts(entry.captureStages, 8),
      captureVerification: normalizeText(entry.captureVerification),
      importance,
      ttl,
      source: normalizeText(entry.source || 'narrative_source_record') || 'narrative_source_record',
      sourceHint: compactText(entry.sourceHint || 'Used as source evidence for narrative summaries.', 180),
      sourceMessageIds: uniqueTexts(entry.sourceMessageIds || entry.messageIds || [entry.m_id, entry.latestMessageId], 12),
      memoryCaptureMode: normalizeText(entry.memoryCaptureMode),
      memoryCaptureSource: normalizeText(entry.memoryCaptureSource),
      manualText: compactText(entry.manualText, TEXT_LIMITS.manualText),
      userText: compactText(entry.userText, TEXT_LIMITS.userText),
      assistantText: compactText(entry.assistantText, TEXT_LIMITS.assistantText),
      rawAssistantText: compactText(entry.rawAssistantText, TEXT_LIMITS.assistantText),
      displayContent: compactText(entry.displayContent, TEXT_LIMITS.assistantText),
      pendingResponseText: compactText(entry.pendingResponseText, TEXT_LIMITS.assistantText),
      episode: compactText(entry.episode, 240),
      preview: compactText(entry.preview, 240),
      entityNames: uniqueTexts(entry.entityNames, 8),
      locations: uniqueTexts(entry.locations, 4),
      moods: uniqueTexts(entry.moods, 4),
      dialogue: uniqueTexts(entry.dialogue, 4),
      continuityHints: uniqueTexts(entry.continuityHints, 4),
      archived: entry.archived === true
    };
    applyDmaDirectTurnAnchor(normalized, lockedTurn, 'normalize-direct-entry');
    if (!normalized.id) {
      normalized.id = `dm_${Math.max(0, normalized.turn)}_${simpleHash([
        normalized.signature,
        normalized.latestMessageId,
        normalized.sourceHash,
        normalized.userText,
        normalized.assistantText
      ].join('|'))}`;
    }
    if (!normalized.signature) {
      normalized.signature = normalizeText(normalized.latestMessageId || normalized.sourceHash || normalized.id);
    }
    if (!normalized.latestMessageId && normalized.sourceMessageIds.length > 0) {
      normalized.latestMessageId = String(normalized.sourceMessageIds[0] || '').trim();
    }
    if (normalized.sourceMessageIds.length === 0 && normalized.latestMessageId) {
      normalized.sourceMessageIds = [normalized.latestMessageId];
    }
    if (!normalized.preview) normalized.preview = buildEntryPreview(normalized);
    if (!normalized.episode) normalized.episode = compactText(normalized.preview, 180);
    return normalized;
  };

  const normalizePreviousEntry = (entry = {}) => {
    const fromTurn = Math.max(0, Number(entry.fromTurn || 0));
    const toTurn = Math.max(fromTurn, Number(entry.toTurn || fromTurn));
    const normalized = {
      id: normalizeText(entry.id),
      archiveKey: normalizeText(entry.archiveKey),
      fromTurn,
      toTurn,
      createdAt: Number(entry.createdAt || Date.now()),
      updatedAt: Number(entry.updatedAt || entry.createdAt || Date.now()),
      title: compactText(entry.title, 120),
      summary: compactText(entry.summary, 260),
      content: String(entry.content || '').trim(),
      entityNames: uniqueTexts(entry.entityNames, 8),
      locations: uniqueTexts(entry.locations, 4),
      moods: uniqueTexts(entry.moods, 4),
      relationHighlights: uniqueTexts(entry.relationHighlights, 4),
      sourceEntryIds: uniqueTexts(entry.sourceEntryIds, 80)
    };
    if (!normalized.archiveKey) {
      normalized.archiveKey = `prev_${fromTurn}_${toTurn}_${simpleHash([
        normalized.summary,
        normalized.title,
        normalized.sourceEntryIds.join('|')
      ].join('|'))}`;
    }
    if (!normalized.id) normalized.id = normalized.archiveKey;
    return normalized;
  };

  const normalizePendingCapture = (entry = {}) => {
    const phaseTrail = uniqueTexts(entry.phaseTrail || [entry.phase], 8).map(normalizeCapturePhase);
    const preferredAssistantPhase = normalizeCapturePhase(entry.preferredAssistantPhase || phaseTrail[phaseTrail.length - 1] || entry.phase);
    const preferredUserPhase = normalizeCapturePhase(entry.preferredUserPhase || phaseTrail[0] || entry.phase);
    const pending = {
      id: normalizeText(entry.id),
      signature: normalizeText(entry.signature),
      predictedTurn: Math.max(0, Number(entry.predictedTurn || entry.turnHint || 0)),
      finalizedTurn: Math.max(0, Number(entry.finalizedTurn || entry.turn || 0)),
      firstTurn: Math.max(0, Number(entry.firstTurn || entry.originalTurn || entry.lockedTurn || entry.finalizedTurn || entry.turn || 0)),
      originalTurn: Math.max(0, Number(entry.originalTurn || entry.firstTurn || entry.lockedTurn || entry.finalizedTurn || entry.turn || 0)),
      lockedTurn: Math.max(0, Number(entry.lockedTurn || entry.firstTurn || entry.originalTurn || entry.finalizedTurn || entry.turn || 0)),
      turnAnchorTurn: Math.max(0, Number(entry.turnAnchorTurn || entry.lockedTurn || entry.firstTurn || entry.originalTurn || entry.finalizedTurn || entry.turn || 0)),
      turnLocked: entry.turnLocked === true || Number(entry.lockedTurn || entry.firstTurn || entry.originalTurn || entry.finalizedTurn || entry.turn || 0) > 0,
      turnAnchor: normalizeText(entry.turnAnchor || ''),
      turnAnchorReason: normalizeText(entry.turnAnchorReason || ''),
      exactTurn: entry.exactTurn === true || Number(entry.finalizedTurn || entry.turn || 0) > 0,
      createdAt: Number(entry.createdAt || Date.now()),
      updatedAt: Number(entry.updatedAt || entry.createdAt || Date.now()),
      latestMessageId: normalizeText(entry.latestMessageId),
      sourceHash: normalizeText(entry.sourceHash),
      sourceMessageIds: uniqueTexts(entry.sourceMessageIds || entry.messageIds || [entry.latestMessageId], 12),
      importance: clampNumber(entry.importance ?? entry.imp, 5, 1, 10),
      ttl: Number.isFinite(Number(entry.ttl))
        ? Math.trunc(Number(entry.ttl))
        : inferTtlFromImportance(clampNumber(entry.importance ?? entry.imp, 5, 1, 10)),
      source: normalizeText(entry.source || 'narrative_source_record') || 'narrative_source_record',
      sourceHint: compactText(entry.sourceHint || 'Used as source evidence for narrative summaries.', 180),
      runtimeMode: normalizeText(entry.runtimeMode),
      runtimeReliability: normalizeText(entry.runtimeReliability),
      memoryCaptureMode: normalizeText(entry.memoryCaptureMode),
      memoryCaptureSource: normalizeText(entry.memoryCaptureSource),
      reason: normalizeText(entry.reason),
      userText: compactText(entry.userText, TEXT_LIMITS.userText),
      assistantText: compactText(entry.assistantText, TEXT_LIMITS.assistantText),
      rawAssistantText: compactText(entry.rawAssistantText, TEXT_LIMITS.assistantText),
      displayContent: compactText(entry.displayContent, TEXT_LIMITS.assistantText),
      pendingResponseText: compactText(entry.pendingResponseText, TEXT_LIMITS.assistantText),
      episode: compactText(entry.episode, 240),
      preview: compactText(entry.preview, 240),
      entityNames: uniqueTexts(entry.entityNames, 8),
      locations: uniqueTexts(entry.locations, 4),
      moods: uniqueTexts(entry.moods, 4),
      dialogue: uniqueTexts(entry.dialogue, 4),
      continuityHints: uniqueTexts(entry.continuityHints, 4),
      phaseTrail,
      preferredAssistantPhase,
      preferredUserPhase,
      captureVerification: normalizeText(entry.captureVerification),
      stagePayloads: {}
    };
    if (!pending.id) {
      pending.id = `pc_${simpleHash([
        pending.signature,
        pending.latestMessageId,
        pending.sourceHash,
        pending.predictedTurn,
        pending.assistantText
      ].join('|'))}`;
    }
    if (!pending.signature) {
      pending.signature = normalizeText(pending.latestMessageId || pending.sourceHash || pending.id);
    }
    if (!pending.sourceMessageIds.length && pending.latestMessageId) {
      pending.sourceMessageIds = [pending.latestMessageId];
    }
    const stagePayloads = entry?.stagePayloads && typeof entry.stagePayloads === 'object' ? entry.stagePayloads : {};
    Object.entries(stagePayloads).forEach(([phase, payload]) => {
      const normalizedPhase = normalizeCapturePhase(phase);
      pending.stagePayloads[normalizedPhase] = {
        phase: normalizedPhase,
        at: Number(payload?.at || pending.updatedAt || Date.now()),
        assistantText: compactText(payload?.assistantText, TEXT_LIMITS.assistantText),
        userText: compactText(payload?.userText, TEXT_LIMITS.userText),
        latestMessageId: normalizeText(payload?.latestMessageId),
        sourceHash: normalizeText(payload?.sourceHash),
        predictedTurn: Math.max(0, Number(payload?.predictedTurn || payload?.turn || 0)),
        runtimeMode: normalizeText(payload?.runtimeMode),
        runtimeReliability: normalizeText(payload?.runtimeReliability),
        memoryCaptureMode: normalizeText(payload?.memoryCaptureMode),
        memoryCaptureSource: normalizeText(payload?.memoryCaptureSource)
      };
    });
    if (!pending.preview) {
      pending.preview = buildEntryPreview({
        turn: pending.exactTurn ? pending.finalizedTurn : pending.predictedTurn,
        entityNames: pending.entityNames,
        episode: pending.episode || pending.assistantText || pending.rawAssistantText
      });
    }
    if (!pending.episode) {
      pending.episode = buildEpisode(pending.userText, pending.assistantText || pending.rawAssistantText || pending.displayContent)
        || compactText(pending.assistantText || pending.rawAssistantText || pending.displayContent, 180);
    }
    return pending;
  };

  const normalizeRepairItem = (item = {}) => {
    const type = normalizeText(item?.type || item?.kind || '').toLowerCase() || 'unknown';
    const pendingIds = uniqueTexts(item?.pendingIds || item?.targets?.pendingIds || [], 96);
    const directIds = uniqueTexts(item?.directIds || item?.targets?.directIds || [], 240);
    const previousIds = uniqueTexts(item?.previousIds || item?.targets?.previousIds || [], 96);
    const confidenceRaw = Number(item?.confidence);
    const normalized = {
      id: normalizeText(item?.id),
      type,
      pendingIds,
      directIds,
      previousIds,
      targetTurn: Math.max(0, Number(item?.targetTurn || item?.currentTurn || item?.turn || 0)),
      reason: compactText(item?.reason, 220),
      note: compactText(item?.note || item?.summary || '', 320),
      confidence: Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0.5,
      safeAutoApply: item?.safeAutoApply !== false,
      suggestedBy: normalizeText(item?.suggestedBy || item?.source || 'unknown') || 'unknown',
      createdAt: Number(item?.createdAt || Date.now()),
      updatedAt: Number(item?.updatedAt || item?.createdAt || Date.now())
    };
    if (!normalized.id) {
      normalized.id = `rq_${simpleHash([
        normalized.type,
        normalized.pendingIds.join('|'),
        normalized.directIds.join('|'),
        normalized.previousIds.join('|'),
        normalized.targetTurn,
        normalized.reason
      ].join('::'))}`;
    }
    return normalized;
  };

  const normalizeDeletedTurnTombstone = (item = {}) => {
    const turn = Math.max(0, Number(
      typeof item === 'number' || typeof item === 'string'
        ? item
        : (item?.turn || item?.targetTurn || item?.deletedTurn || 0)
    ));
    const deletedAt = Number(item?.deletedAt || item?.updatedAt || item?.createdAt || Date.now());
    const sourceHashes = Array.isArray(item?.sourceHashes)
      ? item.sourceHashes
      : [item?.sourceHashes].filter(Boolean);
    const normalized = {
      id: normalizeText(item?.id),
      turn,
      deletedAt: Number.isFinite(deletedAt) ? deletedAt : Date.now(),
      reason: compactText(item?.reason || 'manual-delete', 220),
      directIds: uniqueTexts(item?.directIds || [], 240),
      pendingIds: uniqueTexts(item?.pendingIds || [], 96),
      previousIds: uniqueTexts(item?.previousIds || [], 96),
      sourceMessageIds: uniqueTexts(item?.sourceMessageIds || item?.messageIds || [], 128),
      sourceHashes: uniqueTexts([item?.sourceHash, ...sourceHashes], 128)
    };
    if (!normalized.id) {
      normalized.id = `deleted_turn_${turn}_${simpleHash([
        turn,
        normalized.directIds.join('|'),
        normalized.pendingIds.join('|'),
        normalized.previousIds.join('|'),
        normalized.sourceMessageIds.join('|')
      ].join('::'))}`;
    }
    return normalized;
  };

  const normalizeDeletedTurnList = (items = []) => {
    const byTurn = new Map();
    (Array.isArray(items) ? items : [])
      .map(normalizeDeletedTurnTombstone)
      .filter(item => Number(item?.turn || 0) > 0)
      .forEach((item) => {
        const key = Number(item.turn || 0);
        const existing = byTurn.get(key);
        if (!existing) {
          byTurn.set(key, item);
          return;
        }
        byTurn.set(key, normalizeDeletedTurnTombstone({
          ...existing,
          deletedAt: Math.max(Number(existing?.deletedAt || 0), Number(item?.deletedAt || 0), Date.now()),
          reason: normalizeText(item?.reason || existing?.reason || 'manual-delete'),
          directIds: uniqueTexts([...(existing?.directIds || []), ...(item?.directIds || [])], 240),
          pendingIds: uniqueTexts([...(existing?.pendingIds || []), ...(item?.pendingIds || [])], 96),
          previousIds: uniqueTexts([...(existing?.previousIds || []), ...(item?.previousIds || [])], 96),
          sourceMessageIds: uniqueTexts([...(existing?.sourceMessageIds || []), ...(item?.sourceMessageIds || [])], 128),
          sourceHashes: uniqueTexts([...(existing?.sourceHashes || []), ...(item?.sourceHashes || [])], 128)
        }));
      });
    return Array.from(byTurn.values())
      .sort((a, b) => Number(a.turn || 0) - Number(b.turn || 0))
      .slice(-(CONFIG.maxDeletedTurnTombstones));
  };

  const getPendingCaptureTurn = (entry = {}) => Math.max(0, Number(entry?.finalizedTurn || entry?.turn || entry?.predictedTurn || 0));
  const isTurnDeletedInStore = (store = {}, turn = 0) => {
    const normalizedTurn = Math.max(0, Number(turn || 0));
    if (!normalizedTurn) return false;
    return (Array.isArray(store?.deletedTurns) ? store.deletedTurns : [])
      .some(item => Number(item?.turn || item || 0) === normalizedTurn);
  };

  const doesPreviousEntryOverlapTurn = (entry = {}, turn = 0) => {
    const normalizedTurn = Math.max(0, Number(turn || 0));
    if (!normalizedTurn) return false;
    const fromTurn = Math.max(0, Number(entry?.fromTurn || 0));
    const toTurn = Math.max(fromTurn, Number(entry?.toTurn || fromTurn || 0));
    return fromTurn > 0 && toTurn > 0 && normalizedTurn >= fromTurn && normalizedTurn <= toTurn;
  };

  const doesPreviousEntryOverlapDeletedTurns = (entry = {}, deletedTurnSet = new Set()) => {
    if (!deletedTurnSet?.size) return false;
    const fromTurn = Math.max(0, Number(entry?.fromTurn || 0));
    const toTurn = Math.max(fromTurn, Number(entry?.toTurn || fromTurn || 0));
    if (!fromTurn || !toTurn) return false;
    for (let turn = fromTurn; turn <= toTurn; turn += 1) {
      if (deletedTurnSet.has(String(turn))) return true;
    }
    return false;
  };

  const buildRepairIdentityKey = (repair = {}) => [
    normalizeText(repair?.type || '').toLowerCase(),
    uniqueTexts(repair?.pendingIds || [], 96).slice().sort().join('|'),
    uniqueTexts(repair?.directIds || [], 240).slice().sort().join('|'),
    uniqueTexts(repair?.previousIds || [], 96).slice().sort().join('|'),
    Math.max(0, Number(repair?.targetTurn || 0))
  ].join('::');

  const mergeRepairItems = (base = {}, incoming = {}) => normalizeRepairItem({
    ...base,
    ...incoming,
    pendingIds: uniqueTexts([...(base?.pendingIds || []), ...(incoming?.pendingIds || [])], 96),
    directIds: uniqueTexts([...(base?.directIds || []), ...(incoming?.directIds || [])], 240),
    previousIds: uniqueTexts([...(base?.previousIds || []), ...(incoming?.previousIds || [])], 96),
    targetTurn: Math.max(0, Number(base?.targetTurn || 0), Number(incoming?.targetTurn || 0)),
    confidence: Math.max(Number(base?.confidence || 0), Number(incoming?.confidence || 0), 0.5),
    safeAutoApply: base?.safeAutoApply !== false && incoming?.safeAutoApply !== false,
    reason: normalizeText(incoming?.reason || base?.reason || ''),
    note: normalizeText(incoming?.note || base?.note || ''),
    suggestedBy: normalizeText(incoming?.suggestedBy || base?.suggestedBy || 'unknown') || 'unknown',
    createdAt: Math.min(Number(base?.createdAt || Infinity), Number(incoming?.createdAt || Infinity), Date.now()),
    updatedAt: Math.max(Number(base?.updatedAt || 0), Number(incoming?.updatedAt || 0), Date.now())
  });
  const resolveContextAssistantPayload = (context = {}) => {
    const captureMode = normalizeText(context?.memoryCaptureMode || '');
    const captureSource = normalizeText(context?.memoryCaptureSource || '');
    const preferredMemory = normalizeText(
      context?.memorySourceText
      || context?.aiResponseRaw
      || context?.aiResponse
      || context?.displayContent
      || context?.pendingResponseText
      || context?.responsePayload?.content
      || ''
    );
    const preferredDisplay = normalizeText(
      context?.displayContent
      || context?.responsePayload?.content
      || context?.pendingResponseText
      || context?.aiResponse
      || context?.aiResponseRaw
      || preferredMemory
      || ''
    );
    const preferredPending = normalizeText(
      context?.pendingResponseText
      || context?.aiResponse
      || context?.displayContent
      || context?.responsePayload?.content
      || preferredMemory
      || ''
    );
    const rawAssistantText = normalizeText(
      context?.aiResponseRaw
      || context?.memorySourceText
      || preferredPending
      || preferredDisplay
      || ''
    );
    const assistantText = normalizeText(preferredMemory || rawAssistantText || preferredDisplay || preferredPending || '');
    return {
      assistantText,
      rawAssistantText,
      displayContent: preferredDisplay || assistantText,
      pendingResponseText: preferredPending || assistantText,
      memoryCaptureMode: captureMode || 'unknown',
      memoryCaptureSource: captureSource || 'context'
    };
  };

  const buildCaptureVerificationState = (capture = {}) => {
    const phases = new Set(Array.isArray(capture?.phaseTrail) ? capture.phaseTrail : []);
    const early = capture?.stagePayloads?.beforeRequestResponse?.assistantText || '';
    const middle = capture?.stagePayloads?.afterRequest?.assistantText || '';
    const late = capture?.stagePayloads?.finalize?.assistantText || capture?.stagePayloads?.recovery?.assistantText || '';
    if (late && (early || middle)) {
      return isTextCompatible(late, middle || early) ? 'verified-final' : 'final-overrode-stage';
    }
    if (early && middle) {
      return isTextCompatible(early, middle) ? 'verified' : 'diverged';
    }
    if (phases.size >= 2) return 'multi-stage';
    return 'single-stage';
  };

  const CAPTURE_VERIFICATION_PRIORITY = {
    '': 0,
    'single-stage': 1,
    'multi-stage': 2,
    'diverged': 3,
    'verified': 4,
    'final-overrode-stage': 5,
    'verified-final': 6,
    'manual': 7
  };

  const sortCapturePhases = (items = []) => uniqueTexts(
    (Array.isArray(items) ? items : []).map(normalizeCapturePhase),
    8
  ).sort((left, right) => getCaptureStagePriority(left) - getCaptureStagePriority(right));

  const mergeCaptureVerification = (base = '', incoming = '') => {
    const left = normalizeText(base);
    const right = normalizeText(incoming);
    const leftPriority = CAPTURE_VERIFICATION_PRIORITY[left] || 0;
    const rightPriority = CAPTURE_VERIFICATION_PRIORITY[right] || 0;
    if (rightPriority > leftPriority) return right;
    return left || right;
  };

  const collectStagePayloadMessageIds = (stagePayloads = {}) => {
    const ids = [];
    Object.values(stagePayloads || {}).forEach((payload) => {
      const id = normalizeText(payload?.latestMessageId || '');
      if (id) ids.push(id);
    });
    return uniqueTexts(ids, 12);
  };

  const mergeStagePayloads = (base = {}, incoming = {}) => {
    const merged = {};
    const phases = sortCapturePhases([
      ...Object.keys(base || {}),
      ...Object.keys(incoming || {})
    ]);
    phases.forEach((phase) => {
      const left = base?.[phase] || {};
      const right = incoming?.[phase] || {};
      merged[phase] = {
        phase,
        at: Math.max(Number(left?.at || 0), Number(right?.at || 0), Date.now()),
        assistantText: pickPreferredStageText(left?.assistantText, right?.assistantText, phase, phase),
        userText: pickPreferredStageText(left?.userText, right?.userText, phase, phase),
        latestMessageId: normalizeText(right?.latestMessageId || left?.latestMessageId),
        sourceHash: normalizeText(right?.sourceHash || left?.sourceHash),
        predictedTurn: Math.max(0, Number(right?.predictedTurn || left?.predictedTurn || 0)),
        runtimeMode: normalizeText(right?.runtimeMode || left?.runtimeMode),
        runtimeReliability: normalizeText(right?.runtimeReliability || left?.runtimeReliability),
        memoryCaptureMode: normalizeText(right?.memoryCaptureMode || left?.memoryCaptureMode),
        memoryCaptureSource: normalizeText(right?.memoryCaptureSource || left?.memoryCaptureSource)
      };
    });
    return merged;
  };

  const selectPreferredStagePayload = (stagePayloads = {}, field = 'assistantText', fallbackPhase = '') => {
    let selectedPhase = normalizeCapturePhase(fallbackPhase);
    let selectedText = '';
    const ordered = Object.entries(stagePayloads || {})
      .sort((left, right) => getCaptureStagePriority(left[0]) - getCaptureStagePriority(right[0]));
    ordered.forEach(([phase, payload]) => {
      const candidate = normalizeText(payload?.[field] || '');
      if (!candidate) return;
      const next = pickPreferredStageText(selectedText, candidate, selectedPhase, phase);
      if (next && next !== selectedText) {
        selectedText = next;
        selectedPhase = phase;
      }
    });
    return {
      phase: selectedPhase,
      text: selectedText
    };
  };

  const hasListOverlap = (left = [], right = []) => {
    const leftSet = new Set(uniqueTexts(left, 24));
    return uniqueTexts(right, 24).some(item => leftSet.has(item));
  };

  const extractCaptureTurnNumber = (entry = {}) => Math.max(
    0,
    Number(entry?.turn || entry?.finalizedTurn || entry?.predictedTurn || 0)
  );

  const isSameCaptureIdentity = (left = {}, right = {}) => {
    if (!left || !right) return false;
    if (left?.signature && right?.signature && left.signature === right.signature) return true;
    if (left?.latestMessageId && right?.latestMessageId && left.latestMessageId === right.latestMessageId) return true;
    if (hasListOverlap(left?.sourceMessageIds || [], right?.sourceMessageIds || [])) return true;
    if (left?.sourceHash && right?.sourceHash && left.sourceHash === right.sourceHash) {
      const leftTurn = extractCaptureTurnNumber(left);
      const rightTurn = extractCaptureTurnNumber(right);
      return !leftTurn || !rightTurn || leftTurn === rightTurn;
    }
    return false;
  };

  const buildPendingCaptureFromContext = (context = {}, phase = 'afterRequest') => {
    const normalizedPhase = normalizeCapturePhase(phase);
    const assistantPayload = resolveContextAssistantPayload(context);
    const assistantText = assistantPayload.assistantText;
    const userText = normalizeText(
      context?.userMsgForMemory
      || context?.userMessage
      || context?.userMsg
      || context?.userMsgForNarrative
      || ''
    );
    if (!assistantText) return null;
    const entityManager = context?.EntityManager || globalThis?.LIBRA?.EntityManager || null;
    const combined = [userText, assistantText].filter(Boolean).join('\n');
    const exactTurn = isCommittedCapturePhase(normalizedPhase)
      ? Math.max(0, Number(context?.turn || context?.currentTurn || 0))
      : 0;
    const predictedTurn = Math.max(
      0,
      Number(
        context?.predictedTurn
        || exactTurn
        || context?.turn
        || context?.currentTurn
        || getMemoryEngine()?.getCurrentTurn?.()
        || 0
      )
    );
    const latestMessageId = normalizeText(context?.latestMessageId || '');
    const sourceHash = normalizeText(context?.sourceHash || context?.turnState?.sourceHash || simpleHash(assistantText));
    const signature = normalizeText(
      context?.signature
      || latestMessageId
      || sourceHash
      || simpleHash([
        compactText(userText, 120),
        compactText(assistantText, 240)
      ].join('|'))
    );
    const importance = clampNumber(context?.memoryImportance ?? context?.importance, 5, 1, 10);
    const episode = buildEpisode(userText, assistantText) || compactText(assistantText || userText, 180);
    const entityNames = extractEntityNames(combined, entityManager, 8);
    return normalizePendingCapture({
      id: `pc_${simpleHash([signature, predictedTurn, normalizedPhase].join('|'))}`,
      signature,
      predictedTurn,
      finalizedTurn: exactTurn,
      exactTurn: exactTurn > 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      latestMessageId,
      sourceHash,
      sourceMessageIds: uniqueTexts(context?.sourceMessageIds || [latestMessageId], 12),
      importance,
      ttl: Number.isFinite(Number(context?.memoryTtl))
        ? Number(context.memoryTtl)
        : inferTtlFromImportance(importance),
      source: normalizeText(context?.memorySource || 'narrative_source_record') || 'narrative_source_record',
      sourceHint: normalizeText(context?.memorySourceHint || 'Used as source evidence for narrative summaries.')
        || 'Used as source evidence for narrative summaries.',
      runtimeMode: normalizeText(context?.runtimeMode || normalizedPhase),
      runtimeReliability: normalizeText(context?.runtimeReliability),
      memoryCaptureMode: assistantPayload.memoryCaptureMode,
      memoryCaptureSource: assistantPayload.memoryCaptureSource,
      reason: normalizeText(context?.reason || normalizedPhase),
      userText,
      assistantText,
      rawAssistantText: assistantPayload.rawAssistantText,
      displayContent: assistantPayload.displayContent,
      pendingResponseText: assistantPayload.pendingResponseText,
      episode,
      preview: buildEntryPreview({
        turn: exactTurn || predictedTurn,
        entityNames,
        episode
      }),
      entityNames,
      locations: extractLocations(combined, 4),
      moods: detectMoodTags(combined, 4),
      dialogue: uniqueTexts([
        ...extractQuotedDialogue(userText, 2),
        ...extractQuotedDialogue(assistantText, 2)
      ], 4),
      continuityHints: extractContinuityHints(combined, 4),
      phaseTrail: [normalizedPhase],
      preferredAssistantPhase: normalizedPhase,
      preferredUserPhase: normalizedPhase,
      captureVerification: isCommittedCapturePhase(normalizedPhase) ? 'verified-final' : 'single-stage',
      stagePayloads: {
        [normalizedPhase]: {
          phase: normalizedPhase,
          at: Date.now(),
          assistantText,
          userText,
          latestMessageId,
          sourceHash,
          predictedTurn: exactTurn || predictedTurn,
          runtimeMode: normalizeText(context?.runtimeMode || normalizedPhase),
          runtimeReliability: normalizeText(context?.runtimeReliability),
          memoryCaptureMode: assistantPayload.memoryCaptureMode,
          memoryCaptureSource: assistantPayload.memoryCaptureSource
        }
      }
    });
  };

  const mergePendingCaptures = (base = {}, incoming = {}) => {
    const stagePayloads = mergeStagePayloads(base?.stagePayloads || {}, incoming?.stagePayloads || {});
    const assistantSelection = selectPreferredStagePayload(
      stagePayloads,
      'assistantText',
      incoming?.preferredAssistantPhase || base?.preferredAssistantPhase
    );
    const userSelection = selectPreferredStagePayload(
      stagePayloads,
      'userText',
      incoming?.preferredUserPhase || base?.preferredUserPhase
    );
    const predictedTurn = Math.max(
      0,
      Number(base?.predictedTurn || 0),
      Number(incoming?.predictedTurn || 0),
      ...Object.values(stagePayloads).map(payload => Number(payload?.predictedTurn || 0))
    );
    const finalizedTurn = Math.max(0, Number(base?.finalizedTurn || 0), Number(incoming?.finalizedTurn || 0));
    const exactTurn = base?.exactTurn === true || incoming?.exactTurn === true || finalizedTurn > 0;
    const entityNames = uniqueTexts([...(base?.entityNames || []), ...(incoming?.entityNames || [])], 8);
    const assistantText = normalizeText(assistantSelection.text || incoming?.assistantText || base?.assistantText || '');
    const userText = normalizeText(userSelection.text || incoming?.userText || base?.userText || '');
    const latestMessageId = normalizeText(
      incoming?.latestMessageId
      || base?.latestMessageId
      || stagePayloads?.[assistantSelection.phase]?.latestMessageId
      || ''
    );
    const sourceHash = normalizeText(
      incoming?.sourceHash
      || base?.sourceHash
      || stagePayloads?.[assistantSelection.phase]?.sourceHash
      || ''
    );
    const merged = normalizePendingCapture({
      ...base,
      ...incoming,
      predictedTurn,
      finalizedTurn,
      firstTurn: earliestPositiveTurn(base?.firstTurn, base?.originalTurn, base?.lockedTurn, incoming?.firstTurn, incoming?.originalTurn, incoming?.lockedTurn, finalizedTurn),
      originalTurn: earliestPositiveTurn(base?.originalTurn, base?.firstTurn, base?.lockedTurn, incoming?.originalTurn, incoming?.firstTurn, incoming?.lockedTurn, finalizedTurn),
      lockedTurn: earliestPositiveTurn(base?.lockedTurn, base?.firstTurn, base?.originalTurn, incoming?.lockedTurn, incoming?.firstTurn, incoming?.originalTurn, finalizedTurn),
      exactTurn,
      createdAt: Math.min(Number(base?.createdAt || Infinity), Number(incoming?.createdAt || Infinity), Date.now()),
      updatedAt: Math.max(Number(base?.updatedAt || 0), Number(incoming?.updatedAt || 0), Date.now()),
      latestMessageId,
      sourceHash,
      sourceMessageIds: uniqueTexts([
        ...(base?.sourceMessageIds || []),
        ...(incoming?.sourceMessageIds || []),
        ...collectStagePayloadMessageIds(stagePayloads),
        latestMessageId
      ], 12),
      importance: Math.max(
        clampNumber(base?.importance ?? base?.imp, 5, 1, 10),
        clampNumber(incoming?.importance ?? incoming?.imp, 5, 1, 10)
      ),
      ttl: (() => {
        const values = [base?.ttl, incoming?.ttl]
          .map(value => Number(value))
          .filter(value => Number.isFinite(value));
        if (values.includes(-1)) return -1;
        if (!values.length) return undefined;
        return Math.max(...values);
      })(),
      source: normalizeText(incoming?.source || base?.source || 'narrative_source_record') || 'narrative_source_record',
      sourceHint: normalizeText(incoming?.sourceHint || base?.sourceHint || 'Used as source evidence for narrative summaries.')
        || 'Used as source evidence for narrative summaries.',
      runtimeMode: normalizeText(
        incoming?.runtimeMode
        || base?.runtimeMode
        || stagePayloads?.[assistantSelection.phase]?.runtimeMode
        || ''
      ),
      runtimeReliability: normalizeText(
        incoming?.runtimeReliability
        || base?.runtimeReliability
        || stagePayloads?.[assistantSelection.phase]?.runtimeReliability
        || ''
      ),
      reason: normalizeText(incoming?.reason || base?.reason || ''),
      userText,
      assistantText,
      rawAssistantText: pickPreferredStageText(
        base?.rawAssistantText || base?.assistantText,
        incoming?.rawAssistantText || incoming?.assistantText,
        base?.preferredAssistantPhase,
        incoming?.preferredAssistantPhase
      ),
      displayContent: pickPreferredStageText(
        base?.displayContent || base?.assistantText,
        incoming?.displayContent || incoming?.assistantText,
        base?.preferredAssistantPhase,
        incoming?.preferredAssistantPhase
      ),
      pendingResponseText: pickPreferredStageText(
        base?.pendingResponseText || base?.assistantText,
        incoming?.pendingResponseText || incoming?.assistantText,
        base?.preferredAssistantPhase,
        incoming?.preferredAssistantPhase
      ),
      episode: buildEpisode(userText, assistantText) || incoming?.episode || base?.episode,
      preview: buildEntryPreview({
        turn: exactTurn ? finalizedTurn : predictedTurn,
        entityNames,
        episode: buildEpisode(userText, assistantText) || incoming?.episode || base?.episode || ''
      }),
      entityNames,
      locations: uniqueTexts([...(base?.locations || []), ...(incoming?.locations || [])], 4),
      moods: uniqueTexts([...(base?.moods || []), ...(incoming?.moods || [])], 4),
      dialogue: uniqueTexts([...(base?.dialogue || []), ...(incoming?.dialogue || [])], 4),
      continuityHints: uniqueTexts([...(base?.continuityHints || []), ...(incoming?.continuityHints || [])], 4),
      phaseTrail: sortCapturePhases([
        ...(base?.phaseTrail || []),
        ...(incoming?.phaseTrail || [])
      ]),
      preferredAssistantPhase: assistantSelection.phase,
      preferredUserPhase: userSelection.phase,
      captureVerification: mergeCaptureVerification(base?.captureVerification, incoming?.captureVerification),
      stagePayloads
    });
    merged.captureVerification = buildCaptureVerificationState(merged);
    return merged;
  };

  const findPendingCaptureIndex = (store = {}, capture = {}) => {
    const pendingCaptures = Array.isArray(store?.pendingCaptures) ? store.pendingCaptures : [];
    return pendingCaptures.findIndex(entry => isSameCaptureIdentity(entry, capture));
  };

  const hasCommittedDirectEntryForCapture = (store = {}, capture = {}) => {
    const directEntries = Array.isArray(store?.directEntries) ? store.directEntries : [];
    return directEntries.some(entry => isSameCaptureIdentity(entry, capture));
  };

  const prunePendingCaptures = (store = {}) => {
    const directEntries = Array.isArray(store?.directEntries) ? store.directEntries : [];
    const current = (Array.isArray(store?.pendingCaptures) ? store.pendingCaptures : [])
      .map(normalizePendingCapture)
      .filter((entry) => {
        if (!entry?.assistantText) return false;
        if ((Date.now() - Number(entry?.updatedAt || 0)) > CONFIG.pendingMaxAgeMs) return false;
        return !directEntries.some(direct => isSameCaptureIdentity(direct, entry));
      })
      .sort((left, right) =>
        Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0)
        || Number(right?.predictedTurn || 0) - Number(left?.predictedTurn || 0)
      )
      .slice(0, CONFIG.maxPendingCaptures)
      .sort((left, right) =>
        Number(left?.predictedTurn || 0) - Number(right?.predictedTurn || 0)
        || Number(left?.createdAt || 0) - Number(right?.createdAt || 0)
      );
    store.pendingCaptures = current;
    return store;
  };

  const upsertPendingCapture = (store = {}, capture = {}) => {
    const pendingCaptures = Array.isArray(store?.pendingCaptures) ? store.pendingCaptures.slice() : [];
    const normalized = normalizePendingCapture(capture);
    if (isTurnDeletedInStore(store, getPendingCaptureTurn(normalized))) {
      store.pendingCaptures = pendingCaptures.filter(entry => !isSameCaptureIdentity(entry, normalized));
      prunePendingCaptures(store);
      return { changed: false, entry: null, skipped: 'deleted-turn' };
    }
    if (hasCommittedDirectEntryForCapture(store, normalized)) {
      store.pendingCaptures = pendingCaptures.filter(entry => !isSameCaptureIdentity(entry, normalized));
      prunePendingCaptures(store);
      return { changed: false, entry: null, skipped: 'already-committed' };
    }
    const index = findPendingCaptureIndex({ pendingCaptures }, normalized);
    let nextEntry = normalized;
    if (index >= 0) {
      nextEntry = mergePendingCaptures(pendingCaptures[index], normalized);
      pendingCaptures[index] = nextEntry;
    } else {
      pendingCaptures.push(nextEntry);
    }
    store.pendingCaptures = pendingCaptures;
    prunePendingCaptures(store);
    const refreshedIndex = findPendingCaptureIndex(store, nextEntry);
    return {
      changed: true,
      entry: refreshedIndex >= 0 ? store.pendingCaptures[refreshedIndex] : nextEntry
    };
  };

  const buildCommittedEntryFromPending = (pending = {}, context = {}, phase = 'finalize') => {
    const normalizedPhase = normalizeCapturePhase(phase);
    const turn = Math.max(
      0,
      Number(context?.turn || pending?.finalizedTurn || pending?.predictedTurn || 0)
    );
    const sourceMessageIds = uniqueTexts([
      ...(pending?.sourceMessageIds || []),
      ...(context?.sourceMessageIds || []),
      normalizeText(context?.latestMessageId || pending?.latestMessageId || '')
    ], 12);
    const assistantPayload = resolveContextAssistantPayload(context);
    const assistantText = normalizeText(
      pending?.assistantText
      || pending?.rawAssistantText
      || pending?.displayContent
      || pending?.pendingResponseText
      || assistantPayload.assistantText
      || ''
    );
    const userText = normalizeText(
      pending?.userText
      || context?.userMsgForMemory
      || context?.userMsgForNarrative
      || context?.userMessage
      || ''
    );
    const phaseTrail = sortCapturePhases([...(pending?.phaseTrail || []), normalizedPhase]);
    const stagePayloads = mergeStagePayloads(pending?.stagePayloads || {}, {
      [normalizedPhase]: {
        phase: normalizedPhase,
        at: Date.now(),
        assistantText,
        userText,
        latestMessageId: normalizeText(context?.latestMessageId || pending?.latestMessageId || ''),
        sourceHash: normalizeText(context?.sourceHash || pending?.sourceHash || ''),
        predictedTurn: turn,
        runtimeMode: normalizeText(context?.runtimeMode || pending?.runtimeMode || normalizedPhase),
        runtimeReliability: normalizeText(context?.runtimeReliability || pending?.runtimeReliability),
        memoryCaptureMode: normalizeText(context?.memoryCaptureMode || pending?.memoryCaptureMode || assistantPayload.memoryCaptureMode),
        memoryCaptureSource: normalizeText(context?.memoryCaptureSource || pending?.memoryCaptureSource || assistantPayload.memoryCaptureSource)
      }
    });
    const directEntry = buildCaptureEntry({
      ...context,
      turn,
      latestMessageId: normalizeText(context?.latestMessageId || pending?.latestMessageId || ''),
      sourceHash: normalizeText(context?.sourceHash || pending?.sourceHash || ''),
      sourceMessageIds,
      memorySourceText: assistantText,
      aiResponseRaw: normalizeText(pending?.rawAssistantText || assistantPayload.rawAssistantText || assistantText),
      aiResponse: assistantText,
      displayContent: normalizeText(pending?.displayContent || assistantPayload.displayContent || assistantText),
      pendingResponseText: normalizeText(pending?.pendingResponseText || assistantPayload.pendingResponseText || assistantText),
      userMsg: userText,
      userMessage: userText,
      userMsgForNarrative: normalizeText(context?.userMsgForNarrative || userText),
      userMsgForMemory: userText,
      memoryImportance: pending?.importance,
      memoryTtl: pending?.ttl,
      memorySource: pending?.source,
      memorySourceHint: pending?.sourceHint,
      memoryCaptureMode: normalizeText(context?.memoryCaptureMode || pending?.memoryCaptureMode || assistantPayload.memoryCaptureMode),
      memoryCaptureSource: normalizeText(context?.memoryCaptureSource || pending?.memoryCaptureSource || assistantPayload.memoryCaptureSource),
      runtimeMode: normalizeText(context?.runtimeMode || pending?.runtimeMode || normalizedPhase),
      reason: normalizeText(context?.reason || pending?.reason || normalizedPhase)
    }, normalizedPhase);
    return normalizeDirectEntry({
      ...directEntry,
      firstTurn: earliestPositiveTurn(pending?.firstTurn, pending?.originalTurn, pending?.lockedTurn, pending?.finalizedTurn, directEntry?.firstTurn, directEntry?.lockedTurn, turn),
      originalTurn: earliestPositiveTurn(pending?.originalTurn, pending?.firstTurn, pending?.lockedTurn, pending?.finalizedTurn, directEntry?.originalTurn, directEntry?.lockedTurn, turn),
      lockedTurn: earliestPositiveTurn(pending?.lockedTurn, pending?.firstTurn, pending?.originalTurn, pending?.finalizedTurn, directEntry?.lockedTurn, directEntry?.firstTurn, turn),
      finalizedTurn: earliestPositiveTurn(pending?.finalizedTurn, directEntry?.finalizedTurn, turn),
      turnAnchorTurn: earliestPositiveTurn(pending?.turnAnchorTurn, pending?.lockedTurn, pending?.firstTurn, directEntry?.turnAnchorTurn, directEntry?.lockedTurn, turn),
      turnLocked: true,
      turnAnchor: normalizeText(pending?.turnAnchor || directEntry?.turnAnchor || 'dma-pending-finalized'),
      turnAnchorReason: 'pending-finalized-direct',
      phase: normalizedPhase,
      captureStages: phaseTrail,
      captureVerification: buildCaptureVerificationState({
        ...pending,
        phaseTrail,
        stagePayloads
      }),
      sourceMessageIds,
      latestMessageId: normalizeText(context?.latestMessageId || pending?.latestMessageId || directEntry?.latestMessageId || ''),
      sourceHash: normalizeText(context?.sourceHash || pending?.sourceHash || directEntry?.sourceHash || ''),
      runtimeMode: normalizeText(context?.runtimeMode || pending?.runtimeMode || directEntry?.runtimeMode || ''),
      memoryCaptureMode: normalizeText(context?.memoryCaptureMode || pending?.memoryCaptureMode || directEntry?.memoryCaptureMode || ''),
      memoryCaptureSource: normalizeText(context?.memoryCaptureSource || pending?.memoryCaptureSource || directEntry?.memoryCaptureSource || ''),
      reason: normalizeText(context?.reason || pending?.reason || directEntry?.reason || ''),
      importance: Math.max(
        clampNumber(directEntry?.importance ?? directEntry?.imp, 5, 1, 10),
        clampNumber(pending?.importance ?? pending?.imp, 5, 1, 10)
      ),
      ttl: (() => {
        const values = [directEntry?.ttl, pending?.ttl]
          .map(value => Number(value))
          .filter(value => Number.isFinite(value));
        if (values.includes(-1)) return -1;
        if (!values.length) return undefined;
        return Math.max(...values);
      })(),
      entityNames: uniqueTexts([...(directEntry?.entityNames || []), ...(pending?.entityNames || [])], 8),
      locations: uniqueTexts([...(directEntry?.locations || []), ...(pending?.locations || [])], 4),
      moods: uniqueTexts([...(directEntry?.moods || []), ...(pending?.moods || [])], 4),
      dialogue: uniqueTexts([...(directEntry?.dialogue || []), ...(pending?.dialogue || [])], 4),
      continuityHints: uniqueTexts([...(directEntry?.continuityHints || []), ...(pending?.continuityHints || [])], 4)
    });
  };

  const normalizeStore = (store = {}, scopeId = 'global') => {
    const normalizedScopeId = normalizeText(scopeId || store?.scopeId || 'global') || 'global';
    const deletedTurns = normalizeDeletedTurnList(store?.deletedTurns || store?.turnDeletionTombstones || []);
    const deletedTurnSet = new Set(deletedTurns.map(item => String(Number(item?.turn || 0))));
    const deletedDirectIdSet = new Set(deletedTurns.flatMap(item => item?.directIds || []).map(id => String(id || '')).filter(Boolean));
    const deletedPendingIdSet = new Set(deletedTurns.flatMap(item => item?.pendingIds || []).map(id => String(id || '')).filter(Boolean));
    const deletedPreviousIdSet = new Set(deletedTurns.flatMap(item => item?.previousIds || []).map(id => String(id || '')).filter(Boolean));
    const deletedSourceMessageIdSet = new Set(deletedTurns.flatMap(item => item?.sourceMessageIds || []).map(id => String(id || '')).filter(Boolean));
    const deletedSourceHashSet = new Set(deletedTurns.flatMap(item => item?.sourceHashes || []).map(hash => String(hash || '')).filter(Boolean));
    const directEntries = (Array.isArray(store?.directEntries) ? store.directEntries : [])
      .map(normalizeDirectEntry)
      .filter((entry) => {
        if (!(entry.assistantText || entry.userText)) return false;
        if (deletedTurnSet.has(String(Number(entry?.turn || 0)))) return false;
        if (deletedDirectIdSet.has(String(entry?.id || ''))) return false;
        if (entry?.sourceHash && deletedSourceHashSet.has(String(entry.sourceHash))) return false;
        const sourceIds = uniqueTexts([...(entry?.sourceMessageIds || []), entry?.latestMessageId], 16);
        return !sourceIds.some(id => deletedSourceMessageIdSet.has(String(id || '')));
      })
      .sort((a, b) => Number(a.turn || 0) - Number(b.turn || 0) || Number(a.createdAt || 0) - Number(b.createdAt || 0));
    const previousEntries = (Array.isArray(store?.previousEntries) ? store.previousEntries : [])
      .map(normalizePreviousEntry)
      .filter((entry) => {
        if (!(entry.content || entry.summary)) return false;
        if (doesPreviousEntryOverlapDeletedTurns(entry, deletedTurnSet)) return false;
        if (deletedPreviousIdSet.has(String(entry?.id || '')) || deletedPreviousIdSet.has(String(entry?.archiveKey || ''))) return false;
        const sourceIds = Array.isArray(entry?.sourceEntryIds) ? entry.sourceEntryIds : [];
        return !sourceIds.some(id => deletedDirectIdSet.has(String(id || '')));
      })
      .sort((a, b) => Number(a.toTurn || 0) - Number(b.toTurn || 0) || Number(a.createdAt || 0) - Number(b.createdAt || 0));
    const pendingCaptures = (Array.isArray(store?.pendingCaptures) ? store.pendingCaptures : [])
      .map(normalizePendingCapture)
      .filter((entry) => {
        if (!entry.assistantText) return false;
        if (deletedTurnSet.has(String(getPendingCaptureTurn(entry)))) return false;
        if (deletedPendingIdSet.has(String(entry?.id || ''))) return false;
        if (entry?.sourceHash && deletedSourceHashSet.has(String(entry.sourceHash))) return false;
        const sourceIds = uniqueTexts([...(entry?.sourceMessageIds || []), entry?.latestMessageId], 16);
        return !sourceIds.some(id => deletedSourceMessageIdSet.has(String(id || '')));
      })
      .sort((a, b) => Number(a.predictedTurn || 0) - Number(b.predictedTurn || 0) || Number(a.createdAt || 0) - Number(b.createdAt || 0));
    const repairQueue = (Array.isArray(store?.repairQueue) ? store.repairQueue : [])
      .map(normalizeRepairItem)
      .filter((entry) => {
        if (!entry.type) return false;
        if (deletedTurnSet.has(String(Number(entry?.targetTurn || 0)))) return false;
        if ((entry?.directIds || []).some(id => deletedDirectIdSet.has(String(id || '')))) return false;
        if ((entry?.pendingIds || []).some(id => deletedPendingIdSet.has(String(id || '')))) return false;
        if ((entry?.previousIds || []).some(id => deletedPreviousIdSet.has(String(id || '')))) return false;
        return entry.pendingIds.length || entry.directIds.length || entry.previousIds.length || entry.reason;
      })
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0) || Number(a.updatedAt || 0) - Number(b.updatedAt || 0));
    return {
      ...(store && typeof store === 'object' ? cloneValue(store, {}) : {}),
      version: 1,
      scopeId: normalizedScopeId,
      updatedAt: Number(store?.updatedAt || Date.now()),
      directEntries,
      previousEntries,
      pendingCaptures,
      repairQueue,
      deletedTurns
    };
  };

  const persistCachedStore = async (scopeId = 'global') => {
    const normalizedScopeId = normalizeText(scopeId) || 'global';
    const store = storeCache.get(normalizedScopeId);
    if (!store) return false;
    store.updatedAt = Date.now();
    runtimeState.lastSavedAt = store.updatedAt;
    runtimeState.lastDirectCount = Array.isArray(store.directEntries) ? store.directEntries.length : 0;
    runtimeState.lastPreviousCount = Array.isArray(store.previousEntries) ? store.previousEntries.length : 0;
    runtimeState.lastPendingCount = Array.isArray(store.pendingCaptures) ? store.pendingCaptures.length : 0;
    runtimeState.lastRepairQueueCount = Array.isArray(store.repairQueue) ? store.repairQueue.length : 0;
    const saved = await storageSetItem(getStoreKey(normalizedScopeId), JSON.stringify(store));
    if (saved) void saveStoreIndexEntry(normalizedScopeId, store);
    return saved;
  };

  const flushStoreSave = async (scopeId = 'global') => {
    const normalizedScopeId = normalizeText(scopeId) || 'global';
    const existing = storeSaveTimers.get(normalizedScopeId);
    if (existing) {
      clearTimeout(existing);
      storeSaveTimers.delete(normalizedScopeId);
    }
    try {
      return await persistCachedStore(normalizedScopeId);
    } catch (error) {
      runtimeState.lastError = String(error?.message || error || 'store_save_failed');
      try { console.warn('[LIBRA DMA] store save failed:', runtimeState.lastError); } catch (_) {}
      return false;
    }
  };

  const flushAllStoreSaves = async () => {
    const scopeIds = new Set([
      ...Array.from(storeSaveTimers.keys()),
      ...Array.from(storeCache.keys())
    ]);
    await Promise.all(Array.from(scopeIds).map(scopeId => flushStoreSave(scopeId)));
  };

  const scheduleStoreSave = (scopeId = 'global') => {
    const normalizedScopeId = normalizeText(scopeId) || 'global';
    const existing = storeSaveTimers.get(normalizedScopeId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(async () => {
      storeSaveTimers.delete(normalizedScopeId);
      await flushStoreSave(normalizedScopeId);
    }, 80);
    storeSaveTimers.set(normalizedScopeId, timer);
  };

  const loadStore = async (scopeId = 'global') => {
    const normalizedScopeId = normalizeText(scopeId) || 'global';
    if (storeCache.has(normalizedScopeId)) return storeCache.get(normalizedScopeId);
    if (storeLoadPromises.has(normalizedScopeId)) return storeLoadPromises.get(normalizedScopeId);
    const promise = (async () => {
      const raw = await storageGetItem(getStoreKey(normalizedScopeId));
      const parsed = safeJsonParse(raw, {});
      const store = normalizeStore(parsed, normalizedScopeId);
      storeCache.set(normalizedScopeId, store);
      return store;
    })();
    storeLoadPromises.set(normalizedScopeId, promise);
    try {
      return await promise;
    } finally {
      storeLoadPromises.delete(normalizedScopeId);
    }
  };

  const commitStore = async (scopeId = 'global', store = {}) => {
    const normalizedScopeId = normalizeText(scopeId) || 'global';
    const normalized = normalizeStore(store, normalizedScopeId);
    runtimeState.lastDirectCount = Array.isArray(normalized.directEntries) ? normalized.directEntries.length : 0;
    runtimeState.lastPreviousCount = Array.isArray(normalized.previousEntries) ? normalized.previousEntries.length : 0;
    runtimeState.lastPendingCount = Array.isArray(normalized.pendingCaptures) ? normalized.pendingCaptures.length : 0;
    runtimeState.lastRepairQueueCount = Array.isArray(normalized.repairQueue) ? normalized.repairQueue.length : 0;
    storeCache.set(normalizedScopeId, normalized);
    await flushStoreSave(normalizedScopeId);
    return normalized;
  };

  const peekStore = (scopeId = 'global') => {
    const normalizedScopeId = normalizeText(scopeId) || 'global';
    const cached = storeCache.get(normalizedScopeId);
    return normalizeStore(cloneValue(cached, { scopeId: normalizedScopeId }), normalizedScopeId);
  };

  const mergeDirectEntries = (base = {}, incoming = {}) => {
    const anchorTurn = chooseEarliestDmaTurnAnchor(base, incoming);
    const merged = normalizeDirectEntry({
      ...base,
      ...incoming,
      turn: anchorTurn || incoming?.turn || base?.turn,
      firstTurn: anchorTurn || incoming?.firstTurn || base?.firstTurn,
      originalTurn: anchorTurn || incoming?.originalTurn || base?.originalTurn,
      lockedTurn: anchorTurn || incoming?.lockedTurn || base?.lockedTurn,
      finalizedTurn: anchorTurn || incoming?.finalizedTurn || base?.finalizedTurn,
      turnAnchorTurn: anchorTurn || incoming?.turnAnchorTurn || base?.turnAnchorTurn,
      turnLocked: anchorTurn > 0 || base?.turnLocked === true || incoming?.turnLocked === true,
      turnAnchor: normalizeText(base?.turnAnchor || incoming?.turnAnchor || 'dma-merge-preserve'),
      turnAnchorReason: anchorTurn > 0 ? 'merge-earliest-turn' : normalizeText(incoming?.turnAnchorReason || base?.turnAnchorReason || ''),
      createdAt: Math.min(Number(base?.createdAt || Infinity), Number(incoming?.createdAt || Infinity), Date.now()),
      updatedAt: Math.max(Number(base?.updatedAt || 0), Number(incoming?.updatedAt || 0), Date.now()),
      importance: Math.max(
        clampNumber(base?.importance ?? base?.imp, 5, 1, 10),
        clampNumber(incoming?.importance ?? incoming?.imp, 5, 1, 10)
      ),
      ttl: (() => {
        const values = [base?.ttl, incoming?.ttl]
          .map(value => Number(value))
          .filter(value => Number.isFinite(value));
        if (values.includes(-1)) return -1;
        if (!values.length) return undefined;
        return Math.max(...values);
      })(),
      source: normalizeText(incoming?.source || base?.source || 'narrative_source_record'),
      sourceHint: normalizeText(incoming?.sourceHint || base?.sourceHint || 'Used as source evidence for narrative summaries.'),
      sourceMessageIds: uniqueTexts([...(base?.sourceMessageIds || []), ...(incoming?.sourceMessageIds || [])], 12),
      phase: (() => {
        const basePhase = normalizeCapturePhase(base?.phase || '');
        const incomingPhase = normalizeCapturePhase(incoming?.phase || '');
        return getCaptureStagePriority(incomingPhase) >= getCaptureStagePriority(basePhase)
          ? incomingPhase || basePhase
          : basePhase || incomingPhase;
      })(),
      captureStages: sortCapturePhases([
        ...(base?.captureStages || []),
        ...(incoming?.captureStages || []),
        base?.phase,
        incoming?.phase
      ]),
      captureVerification: mergeCaptureVerification(base?.captureVerification, incoming?.captureVerification),
      manualText: normalizeText(incoming?.manualText || base?.manualText || ''),
      userText: normalizeText(incoming?.userText || base?.userText || ''),
      assistantText: normalizeText(incoming?.assistantText || base?.assistantText || ''),
      episode: normalizeText(incoming?.episode || base?.episode || ''),
      preview: normalizeText(incoming?.preview || base?.preview || ''),
      entityNames: uniqueTexts([...(base?.entityNames || []), ...(incoming?.entityNames || [])], 8),
      locations: uniqueTexts([...(base?.locations || []), ...(incoming?.locations || [])], 4),
      moods: uniqueTexts([...(base?.moods || []), ...(incoming?.moods || [])], 4),
      dialogue: uniqueTexts([...(base?.dialogue || []), ...(incoming?.dialogue || [])], 4),
      continuityHints: uniqueTexts([...(base?.continuityHints || []), ...(incoming?.continuityHints || [])], 4),
      archived: base?.archived === true || incoming?.archived === true
    });
    applyDmaDirectTurnAnchor(merged, anchorTurn, 'merge-direct-entry');
    return merged;
  };

  const upsertDirectEntry = (store = {}, entry = {}) => {
    const directEntries = Array.isArray(store?.directEntries) ? store.directEntries.slice() : [];
    const normalized = normalizeDirectEntry(entry);
    if (isTurnDeletedInStore(store, normalized.turn)) {
      store.directEntries = directEntries.filter(item => Number(item?.turn || 0) !== Number(normalized.turn || 0));
      return { changed: false, entry: null, skipped: 'deleted-turn' };
    }
    const index = directEntries.findIndex((item) => {
      if (!item) return false;
      if (normalized.signature && item.signature === normalized.signature) return true;
      if (normalized.latestMessageId && item.latestMessageId === normalized.latestMessageId) return true;
      return normalized.sourceHash && item.sourceHash === normalized.sourceHash && Number(item.turn || 0) === Number(normalized.turn || 0);
    });
    if (index >= 0) {
      directEntries[index] = mergeDirectEntries(directEntries[index], normalized);
      store.directEntries = directEntries;
      return { changed: true, entry: directEntries[index] };
    }
    directEntries.push(normalized);
    store.directEntries = directEntries;
    return { changed: true, entry: normalized };
  };

  const collectProtectedDirectIds = (store = {}) => {
    const protectedIds = new Set();
    const directEntries = Array.isArray(store?.directEntries) ? store.directEntries : [];
    directEntries.slice(-24).forEach(entry => protectedIds.add(String(entry?.id || '')));
    (Array.isArray(store?.previousEntries) ? store.previousEntries : []).forEach((entry) => {
      (Array.isArray(entry?.sourceEntryIds) ? entry.sourceEntryIds : []).forEach(id => protectedIds.add(String(id || '')));
    });
    return protectedIds;
  };

  const pruneRepairQueue = (store = {}) => {
    const now = Date.now();
    const merged = new Map();
    (Array.isArray(store?.repairQueue) ? store.repairQueue : [])
      .map(normalizeRepairItem)
      .forEach((repair) => {
        if ((now - Number(repair?.updatedAt || repair?.createdAt || 0)) > CONFIG.repairMaxAgeMs) return;
        const key = buildRepairIdentityKey(repair);
        if (!key) return;
        const existing = merged.get(key);
        merged.set(key, existing ? mergeRepairItems(existing, repair) : repair);
      });
    store.repairQueue = Array.from(merged.values())
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
      .slice(-(CONFIG.maxRepairQueue))
      .map(normalizeRepairItem);
    return store;
  };

  const trimStore = (store = {}) => {
    store.previousEntries = (Array.isArray(store?.previousEntries) ? store.previousEntries : []).slice(-CONFIG.maxPreviousEntries);
    prunePendingCaptures(store);
    pruneRepairQueue(store);
    let directEntries = Array.isArray(store?.directEntries) ? store.directEntries.slice() : [];
    if (directEntries.length <= CONFIG.maxDirectEntries) {
      store.directEntries = directEntries;
      return store;
    }
    const protectedIds = collectProtectedDirectIds(store);
    let overflow = directEntries.length - CONFIG.maxDirectEntries;
    if (overflow > 0) {
      const removable = [];
      directEntries.forEach((entry, index) => {
        if (protectedIds.has(String(entry?.id || ''))) return;
        removable.push(index);
      });
      while (overflow > 0 && removable.length > 0) {
        const index = removable.shift();
        directEntries.splice(index, 1);
        overflow -= 1;
        for (let i = 0; i < removable.length; i += 1) {
          if (removable[i] > index) removable[i] -= 1;
        }
      }
    }
    if (directEntries.length > CONFIG.maxDirectEntries) {
      directEntries = directEntries.slice(-(CONFIG.maxDirectEntries));
    }
    store.directEntries = directEntries;
    return store;
  };

  const groupIdentityClusters = (entries = [], comparator = isSameCaptureIdentity) => {
    const list = (Array.isArray(entries) ? entries : []).filter(Boolean);
    const visited = new Set();
    const groups = [];
    for (let i = 0; i < list.length; i += 1) {
      if (visited.has(i)) continue;
      const queue = [i];
      const group = [];
      visited.add(i);
      while (queue.length > 0) {
        const index = queue.shift();
        const current = list[index];
        group.push(current);
        for (let j = 0; j < list.length; j += 1) {
          if (visited.has(j)) continue;
          if (!comparator(current, list[j])) continue;
          visited.add(j);
          queue.push(j);
        }
      }
      if (group.length > 1) groups.push(group);
    }
    return groups;
  };

  const dedupeDirectEntries = (entries = []) => {
    const next = [];
    let mergedAway = 0;
    const sorted = (Array.isArray(entries) ? entries : [])
      .map(normalizeDirectEntry)
      .sort((a, b) => Number(a.turn || 0) - Number(b.turn || 0) || Number(a.createdAt || 0) - Number(b.createdAt || 0));
    for (const entry of sorted) {
      const index = next.findIndex(item => isSameCaptureIdentity(item, entry));
      if (index >= 0) {
        next[index] = mergeDirectEntries(next[index], entry);
        mergedAway += 1;
      } else {
        next.push(entry);
      }
    }
    return {
      entries: next.map(normalizeDirectEntry),
      mergedAway
    };
  };

  const collapsePendingGroup = (entries = []) => {
    const list = (Array.isArray(entries) ? entries : []).map(normalizePendingCapture);
    if (!list.length) return null;
    return list.slice(1).reduce((merged, entry) => mergePendingCaptures(merged, entry), list[0]);
  };

  const getArchiveEligibleDirectIds = (store = {}, currentTurn = 0) => {
    const directEntries = Array.isArray(store?.directEntries) ? store.directEntries : [];
    const existingSourceIds = new Set(
      (Array.isArray(store?.previousEntries) ? store.previousEntries : [])
        .flatMap(entry => Array.isArray(entry?.sourceEntryIds) ? entry.sourceEntryIds : [])
        .map(id => String(id || ''))
    );
    return directEntries
      .filter((entry) => {
        const turn = Number(entry?.turn || 0);
        if (!Number.isFinite(turn) || turn <= 0) return false;
        if (entry?.archived === true) return false;
        if ((Number(currentTurn || 0) - turn) < CONFIG.archiveMinAgeTurns) return false;
        return !existingSourceIds.has(String(entry?.id || ''));
      })
      .map(entry => String(entry?.id || ''))
      .filter(Boolean);
  };

  const inspectRepairNeedsFromStore = (store = {}, options = {}) => {
    const normalized = normalizeStore(store, options?.scopeId || store?.scopeId || 'global');
    const currentTurn = Math.max(
      0,
      Number(options?.currentTurn || 0),
      ...normalized.directEntries.map(entry => Number(entry?.turn || 0)),
      ...normalized.previousEntries.map(entry => Number(entry?.toTurn || 0)),
      ...normalized.pendingCaptures.map(entry => Number(entry?.finalizedTurn || entry?.predictedTurn || 0))
    );
    const repairs = [];

    const stalePendingIds = normalized.pendingCaptures
      .filter((entry) =>
        ((Date.now() - Number(entry?.updatedAt || 0)) > CONFIG.pendingMaxAgeMs)
        || normalized.directEntries.some(direct => isSameCaptureIdentity(direct, entry))
      )
      .map(entry => String(entry?.id || ''))
      .filter(Boolean);
    if (stalePendingIds.length > 0) {
      repairs.push(normalizeRepairItem({
        type: 'stale_pending_drop',
        pendingIds: stalePendingIds,
        targetTurn: currentTurn,
        reason: `stale_or_committed_pending:${stalePendingIds.length}`,
        confidence: 0.98,
        safeAutoApply: true,
        suggestedBy: options?.suggestedBy || options?.source || 'audit'
      }));
    }

    const duplicatePendingGroups = groupIdentityClusters(normalized.pendingCaptures);
    duplicatePendingGroups.forEach((group) => {
      const ids = group.map(entry => String(entry?.id || '')).filter(Boolean);
      if (ids.length < 2) return;
      repairs.push(normalizeRepairItem({
        type: 'duplicate_pending_drop',
        pendingIds: ids,
        targetTurn: currentTurn,
        reason: `duplicate_pending_group:${ids.length}`,
        confidence: 0.96,
        safeAutoApply: true,
        suggestedBy: options?.suggestedBy || options?.source || 'audit'
      }));
    });

    const duplicateDirectGroups = groupIdentityClusters(normalized.directEntries);
    duplicateDirectGroups.forEach((group) => {
      const ids = group.map(entry => String(entry?.id || '')).filter(Boolean);
      if (ids.length < 2) return;
      repairs.push(normalizeRepairItem({
        type: 'duplicate_direct_merge',
        directIds: ids,
        targetTurn: currentTurn,
        reason: `duplicate_direct_group:${ids.length}`,
        confidence: 0.95,
        safeAutoApply: true,
        suggestedBy: options?.suggestedBy || options?.source || 'audit'
      }));
    });

    const archiveEligibleDirectIds = getArchiveEligibleDirectIds(normalized, currentTurn);
    if (archiveEligibleDirectIds.length >= CONFIG.archiveMinGroupSize) {
      repairs.push(normalizeRepairItem({
        type: 'archive_rebuild',
        directIds: archiveEligibleDirectIds,
        targetTurn: currentTurn,
        reason: `archive_candidates:${archiveEligibleDirectIds.length}`,
        confidence: 0.88,
        safeAutoApply: true,
        suggestedBy: options?.suggestedBy || options?.source || 'audit'
      }));
    }

    return repairs.map(normalizeRepairItem);
  };

  const enqueueRepairItems = (store = {}, repairs = []) => {
    const merged = new Map(
      (Array.isArray(store?.repairQueue) ? store.repairQueue : [])
        .map(normalizeRepairItem)
        .map(repair => [buildRepairIdentityKey(repair), repair])
    );
    (Array.isArray(repairs) ? repairs : []).map(normalizeRepairItem).forEach((repair) => {
      const key = buildRepairIdentityKey(repair);
      if (!key) return;
      const existing = merged.get(key);
      merged.set(key, existing ? mergeRepairItems(existing, repair) : repair);
    });
    store.repairQueue = Array.from(merged.values()).map(normalizeRepairItem);
    pruneRepairQueue(store);
    return store.repairQueue;
  };

  const applySingleRepairToStore = (store = {}, repair = {}, options = {}) => {
    const normalized = normalizeRepairItem(repair);
    const type = normalized.type;
    if (!type) return { changed: false, type: 'unknown' };
    if (type === 'stale_pending_drop') {
      const before = Array.isArray(store?.pendingCaptures) ? store.pendingCaptures.length : 0;
      const targetIds = new Set(normalized.pendingIds.map(id => String(id || '')));
      if (targetIds.size > 0) {
        store.pendingCaptures = (Array.isArray(store?.pendingCaptures) ? store.pendingCaptures : [])
          .filter(entry => !targetIds.has(String(entry?.id || '')));
      }
      prunePendingCaptures(store);
      const after = Array.isArray(store?.pendingCaptures) ? store.pendingCaptures.length : 0;
      return { changed: before !== after, type };
    }
    if (type === 'duplicate_pending_drop') {
      const allPending = (Array.isArray(store?.pendingCaptures) ? store.pendingCaptures : []).map(normalizePendingCapture);
      const targetIds = new Set(normalized.pendingIds.map(id => String(id || '')));
      const targeted = allPending.filter(entry => targetIds.has(String(entry?.id || '')));
      const untouched = allPending.filter(entry => !targetIds.has(String(entry?.id || '')));
      if (targeted.length < 2) return { changed: false, type };
      const consumed = new Set();
      const rebuilt = [];
      const groups = groupIdentityClusters(targeted);
      groups.forEach((group) => {
        group.forEach(entry => consumed.add(String(entry?.id || '')));
        const merged = collapsePendingGroup(group);
        if (merged) rebuilt.push(merged);
      });
      targeted.forEach((entry) => {
        const id = String(entry?.id || '');
        if (consumed.has(id)) return;
        rebuilt.push(entry);
      });
      store.pendingCaptures = untouched.concat(rebuilt).map(normalizePendingCapture);
      prunePendingCaptures(store);
      return { changed: true, type };
    }
    if (type === 'duplicate_direct_merge') {
      const before = Array.isArray(store?.directEntries) ? store.directEntries.length : 0;
      const deduped = dedupeDirectEntries(store?.directEntries || []);
      store.directEntries = deduped.entries;
      return { changed: deduped.mergedAway > 0 || before !== store.directEntries.length, type };
    }
    if (type === 'archive_rebuild') {
      const beforePrevious = Array.isArray(store?.previousEntries) ? store.previousEntries.length : 0;
      const beforeArchived = (Array.isArray(store?.directEntries) ? store.directEntries : []).filter(entry => entry?.archived === true).length;
      archiveHistoricalDirectEntries(store, Math.max(0, Number(normalized.targetTurn || options?.currentTurn || 0)), options?.context || options);
      const afterPrevious = Array.isArray(store?.previousEntries) ? store.previousEntries.length : 0;
      const afterArchived = (Array.isArray(store?.directEntries) ? store.directEntries : []).filter(entry => entry?.archived === true).length;
      return { changed: beforePrevious !== afterPrevious || beforeArchived !== afterArchived, type };
    }
    return { changed: false, type };
  };

  const applyRepairQueueToStore = (store = {}, options = {}) => {
    const safeOnly = options?.safeOnly === true;
    const queue = (Array.isArray(store?.repairQueue) ? store.repairQueue : []).map(normalizeRepairItem);
    const remaining = [];
    let processed = 0;
    let applied = 0;
    const results = [];
    for (const repair of queue) {
      if (safeOnly && repair.safeAutoApply !== true) {
        remaining.push(repair);
        continue;
      }
      processed += 1;
      const result = applySingleRepairToStore(store, repair, options);
      if (result?.changed) applied += 1;
      results.push({
        id: repair.id,
        type: repair.type,
        changed: result?.changed === true
      });
    }
    store.repairQueue = remaining;
    trimStore(store);
    return {
      processed,
      applied,
      remaining: Array.isArray(store?.repairQueue) ? store.repairQueue.length : 0,
      results
    };
  };

  const sortDirectEntriesByPriority = (entries = []) => (Array.isArray(entries) ? entries : [])
    .slice()
    .sort((a, b) =>
      (Number(b?.importance || 0) - Number(a?.importance || 0))
      || (Number(b?.turn || 0) - Number(a?.turn || 0))
      || (Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0))
    );

  const sortPreviousEntriesByPriority = (entries = []) => (Array.isArray(entries) ? entries : [])
    .slice()
    .sort((a, b) =>
      (Number(b?.toTurn || 0) - Number(a?.toTurn || 0))
      || (Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0))
    );

  const resolveOptionsScopeId = (options = {}) => (typeof options === 'string'
    ? normalizeText(options) || 'global'
    : resolveScopeId(options?.context || { scopeId: options?.scopeId, chat: options?.chat }));

  const buildDirectEntryBody = (entry = {}) => {
    if (entry?.manualText) return compactText(entry.manualText, TEXT_LIMITS.manualText);
    const lines = [];
    if (entry?.userText) lines.push(`[사용자] ${compactText(entry.userText, TEXT_LIMITS.guiBodyUser)}`);
    if (entry?.assistantText || entry?.episode || entry?.preview) {
      lines.push(`[응답] ${compactText(entry.assistantText || entry.episode || entry.preview || '', TEXT_LIMITS.guiBodyResponse)}`);
    }
    if (Array.isArray(entry?.entityNames) && entry.entityNames.length) {
      lines.push(`[인물] ${entry.entityNames.join(', ')}`);
    }
    if (Array.isArray(entry?.locations) && entry.locations.length) {
      lines.push(`[위치] ${entry.locations.join(' / ')}`);
    }
    if (Array.isArray(entry?.continuityHints) && entry.continuityHints.length) {
      lines.push(`[연속성] ${entry.continuityHints.join(' / ')}`);
    }
    return lines.filter(Boolean).join('\n').trim();
  };

  const buildPreviousEntryBody = (entry = {}) => [
    `[과거 요약 T${Math.max(0, Number(entry?.fromTurn || 0))}-${Math.max(0, Number(entry?.toTurn || entry?.fromTurn || 0))}] ${compactText(entry?.summary || entry?.title || '', 220)}`,
    Array.isArray(entry?.entityNames) && entry.entityNames.length ? `핵심 인물: ${entry.entityNames.join(', ')}` : '',
    Array.isArray(entry?.locations) && entry.locations.length ? `장소: ${entry.locations.join(' / ')}` : '',
    Array.isArray(entry?.relationHighlights) && entry.relationHighlights.length ? `관계 변화: ${entry.relationHighlights.join(' / ')}` : '',
    Array.isArray(entry?.moods) && entry.moods.length ? `감정 축: ${entry.moods.join(' / ')}` : '',
    compactText(entry?.content || '', 640)
  ].filter(Boolean).join('\n').trim();

  const buildSyntheticMeta = (entry = {}, options = {}) => {
    const archived = options?.archived === true;
    const turn = archived
      ? Math.max(0, Number(entry?.toTurn || entry?.turn || 0))
      : Math.max(0, Number(entry?.turn || 0));
    const importance = clampNumber(entry?.importance ?? entry?.imp, archived ? 6 : 5, 1, 10);
    const sourceMessageIds = uniqueTexts(entry?.sourceMessageIds || entry?.messageIds || [entry?.m_id, entry?.latestMessageId], 12);
    return {
      t: turn,
      ttl: archived ? -1 : (Number.isFinite(Number(entry?.ttl)) ? Number(entry.ttl) : inferTtlFromImportance(importance)),
      imp: importance,
      type: 'context',
      cat: archived ? 'archive' : 'personal',
      ent: uniqueTexts(entry?.entityNames || [], 8),
      summary: compactText(archived ? (entry?.summary || entry?.title || '') : (entry?.episode || entry?.preview || ''), 220),
      source: archived
        ? 'plugin_direct_memory_archive'
        : (normalizeText(entry?.source || 'narrative_source_record') || 'narrative_source_record'),
      sourceHint: archived
        ? 'Archived direct-memory summary stored in plugin storage.'
        : (normalizeText(entry?.sourceHint || 'Used as source evidence for narrative summaries.') || 'Used as source evidence for narrative summaries.'),
      sourceMessageIds,
      m_id: String(sourceMessageIds[0] || entry?.latestMessageId || '').trim(),
      sourceHash: normalizeText(entry?.sourceHash || entry?.archiveKey || ''),
      archived,
      memoryLayer: 'dma',
      memoryLayerId: 'dma',
      memoryLayerMode: 'parallel',
      coexistsWithLegacyMemory: true,
      excludeFromLiveChatAudit: true
    };
  };

  const buildSyntheticMemoryEntryFromDirect = (entry = {}, options = {}) => {
    const normalized = normalizeDirectEntry(entry);
    const archived = options?.archived === true || normalized.archived === true;
    const content = buildDirectEntryBody(normalized);
    if (!content) return null;
    return {
      id: normalized.id,
      key: normalized.id,
      comment: archived ? 'lmai_old_memory' : 'lmai_memory',
      content: `[META:${JSON.stringify(buildSyntheticMeta(normalized, { archived }))}]\n${content}\n`,
      mode: 'normal',
      insertorder: 100,
      alwaysActive: false
    };
  };

  const buildSyntheticMemoryEntryFromPrevious = (entry = {}) => {
    const normalized = normalizePreviousEntry(entry);
    const content = buildPreviousEntryBody(normalized);
    if (!content) return null;
    return {
      id: normalized.id,
      key: normalized.archiveKey || normalized.id,
      comment: 'lmai_old_memory',
      content: `[META:${JSON.stringify(buildSyntheticMeta({
        ...normalized,
        importance: 6,
        sourceHash: normalized.archiveKey || normalized.id
      }, { archived: true }))}]\n${content}\n`,
      mode: 'normal',
      insertorder: 100,
      alwaysActive: false
    };
  };

  const formatMemoryCandidates = (entries = [], options = {}) => {
    const memoryEngine = getMemoryEngine();
    if (memoryEngine?.formatMemories) {
      try {
        return memoryEngine.formatMemories(entries, options);
      } catch (_) {}
    }
    return (Array.isArray(entries) ? entries : []).map((entry, index) => {
      const body = String(entry?.content || '').replace(/\[META:(\{[^}]+\})\]\s*/g, '').trim();
      const label = options?.archived === true ? '과거 보관 기억' : '원문 기억';
      return `[${index + 1}] (${label}) ${compactText(body, 140)}`;
    }).join('\n');
  };

  const buildFallbackRetrievalDebug = (candidates = [], selected = [], queryText = '') => ({
    originalCandidates: Array.isArray(candidates) ? candidates.length : 0,
    filteredCandidates: Array.isArray(candidates) ? candidates.length : 0,
    selectedCount: Array.isArray(selected) ? selected.length : 0,
    belowThresholdCount: 0,
    threshold: 0,
    simThreshold: queryText ? 0.25 : 0,
    weights: { plugin: 1 },
    topEntries: (Array.isArray(selected) ? selected : []).slice(0, 5).map((entry, index) => {
      const direct = normalizeDirectEntry(entry);
      const meta = buildSyntheticMeta(direct);
      return {
        importance: meta.imp,
        similarity: queryText ? Number((1 - (index * 0.05)).toFixed(2)) : 0,
        recency: meta.t,
        finalScore: meta.imp,
        turn: meta.t,
        preview: compactText(direct.preview || direct.episode || direct.assistantText || '', 120)
      };
    })
  });

  const buildCoreMemorySnapshotSyncFromStore = (store = {}, options = {}) => {
    const directLimit = Math.max(1, Number(options?.limit || 6));
    const previousLimit = Math.max(0, Number(options?.archivedLimit || 4));
    const activeDirectEntries = sortDirectEntriesByPriority(
      (Array.isArray(store?.directEntries) ? store.directEntries : []).filter(entry => entry?.archived !== true)
    );
    const archivedPreviousEntries = sortPreviousEntriesByPriority(Array.isArray(store?.previousEntries) ? store.previousEntries : []);
    const selectedDirectEntries = activeDirectEntries.slice(0, directLimit);
    const selectedPreviousEntries = archivedPreviousEntries.slice(0, previousLimit);
    const memoryCandidates = activeDirectEntries.map(entry => buildSyntheticMemoryEntryFromDirect(entry)).filter(Boolean);
    const archivedMemoryCandidates = selectedPreviousEntries
      .map(entry => buildSyntheticMemoryEntryFromPrevious(entry))
      .filter(Boolean);
    const memories = selectedDirectEntries.map(entry => buildSyntheticMemoryEntryFromDirect(entry)).filter(Boolean);
    const archivedMemories = archivedMemoryCandidates.slice();
    const memoryEntries = selectedDirectEntries
      .map(entry => compactText(buildDirectEntryBody(entry), 180))
      .filter(Boolean);
    const archivedEntries = selectedPreviousEntries
      .map(entry => compactText(buildPreviousEntryBody(entry), 180))
      .filter(Boolean);
    return {
      layerId: 'dma',
      layerMode: 'parallel',
      memoryLayerId: 'dma',
      memoryLayerMode: 'parallel',
      coexistsWithLegacyMemory: true,
      replacesLegacyMemory: false,
      excludeFromLiveChatAudit: true,
      scopeId: normalizeText(store?.scopeId || options?.scopeId || runtimeState.activeScopeId) || 'global',
      store: cloneValue(store, { scopeId: normalizeText(store?.scopeId || options?.scopeId || runtimeState.activeScopeId) || 'global' }),
      memoryCandidates,
      archivedMemoryCandidates,
      memories,
      archivedMemories,
      memoryText: formatMemoryCandidates(memories),
      archivedMemoryText: formatMemoryCandidates(archivedMemories, { archived: true }),
      memoryEntries,
      archivedEntries,
      activeDebug: buildFallbackRetrievalDebug(selectedDirectEntries, selectedDirectEntries, ''),
      stats: {
        activeCandidates: memoryCandidates.length,
        archivedCandidates: archivedMemoryCandidates.length,
        selectedActive: memories.length,
        selectedArchived: archivedMemories.length,
        pendingCaptures: Array.isArray(store?.pendingCaptures) ? store.pendingCaptures.length : 0,
        maxTurn: Math.max(0, ...activeDirectEntries.map(entry => Number(entry?.turn || 0)))
      }
    };
  };

  const buildCoreMemorySnapshotFromStore = async (store = {}, options = {}) => {
    const snapshot = buildCoreMemorySnapshotSyncFromStore(store, options);
    const memoryEngine = getMemoryEngine();
    const queryText = String(options?.queryText || options?.query || '').trim();
    const currentTurn = Math.max(0, Number(options?.currentTurn || memoryEngine?.getCurrentTurn?.() || snapshot?.stats?.maxTurn || 0));
    if (!memoryEngine?.retrieveMemories || !queryText) {
      return snapshot;
    }
    const memoryCandidates = Array.isArray(snapshot?.memoryCandidates) ? snapshot.memoryCandidates : [];
    const archivedMemoryCandidates = Array.isArray(snapshot?.archivedMemoryCandidates) ? snapshot.archivedMemoryCandidates : [];
    const memories = memoryCandidates.length > 0
      ? await memoryEngine.retrieveMemories(
        queryText,
        currentTurn,
        memoryCandidates,
        options?.retrievalOptions || {},
        Math.max(1, Number(options?.limit || 10))
      )
      : [];
    const activeDebug = memoryEngine?.getLastRetrievalDebug?.() || buildFallbackRetrievalDebug(memoryCandidates, memories, queryText);
    const archivedMemories = archivedMemoryCandidates.length > 0
      ? await memoryEngine.retrieveMemories(
        queryText,
        currentTurn,
        archivedMemoryCandidates,
        options?.archivedOptions || {},
        Math.max(1, Number(options?.archivedLimit || 4))
      )
      : [];
    return {
      ...snapshot,
      memoryCandidates,
      archivedMemoryCandidates,
      memories,
      archivedMemories,
      memoryText: formatMemoryCandidates(memories),
      archivedMemoryText: formatMemoryCandidates(archivedMemories, { archived: true }),
      memoryEntries: memories
        .map(entry => compactText(String(entry?.content || '').replace(/\[META:(\{[^}]+\})\]\s*/g, '').trim(), 180))
        .filter(Boolean),
      archivedEntries: archivedMemories
        .map(entry => compactText(String(entry?.content || '').replace(/\[META:(\{[^}]+\})\]\s*/g, '').trim(), 180))
        .filter(Boolean),
      activeDebug,
      stats: {
        ...(snapshot?.stats || {}),
        activeCandidates: memoryCandidates.length,
        archivedCandidates: archivedMemoryCandidates.length,
        selectedActive: memories.length,
        selectedArchived: archivedMemories.length,
        pendingCaptures: Array.isArray(store?.pendingCaptures) ? store.pendingCaptures.length : 0,
        currentTurn
      }
    };
  };

  const getProcessedMessageIdsFromStore = (store = {}) => {
    const ids = new Set();
    const directEntries = Array.isArray(store?.directEntries) ? store.directEntries : [];
    directEntries.forEach((entry) => {
      uniqueTexts([...(entry?.sourceMessageIds || []), entry?.latestMessageId], 12).forEach(id => ids.add(id));
    });
    return ids;
  };

  const getProcessedSourceHashesFromStore = (store = {}) => {
    const hashes = new Set();
    const directEntries = Array.isArray(store?.directEntries) ? store.directEntries : [];
    directEntries.forEach((entry) => {
      const sourceHash = normalizeText(entry?.sourceHash || '');
      if (sourceHash) hashes.add(sourceHash);
    });
    return hashes;
  };

  const mergeImportedStore = (targetStore = {}, sourceStore = {}) => {
    const next = normalizeStore(cloneValue(targetStore, {}), targetStore?.scopeId || sourceStore?.scopeId || 'global');
    const imported = normalizeStore(cloneValue(sourceStore, {}), next.scopeId);
    (Array.isArray(imported?.directEntries) ? imported.directEntries : []).forEach((entry) => {
      upsertDirectEntry(next, entry);
    });
    const previousByKey = new Map(
      (Array.isArray(next?.previousEntries) ? next.previousEntries : []).map(entry => [String(entry?.archiveKey || entry?.id || ''), normalizePreviousEntry(entry)])
    );
    const deletedTurnSet = new Set((Array.isArray(next?.deletedTurns) ? next.deletedTurns : []).map(item => String(Number(item?.turn || item || 0))));
    (Array.isArray(imported?.previousEntries) ? imported.previousEntries : []).forEach((entry) => {
      const normalized = normalizePreviousEntry(entry);
      if (doesPreviousEntryOverlapDeletedTurns(normalized, deletedTurnSet)) return;
      const key = String(normalized?.archiveKey || normalized?.id || '');
      if (!key || previousByKey.has(key)) return;
      previousByKey.set(key, normalized);
    });
    next.previousEntries = Array.from(previousByKey.values()).map(normalizePreviousEntry);
    mergeStoreDirectEntriesByTurn(next);
    return trimStore(next);
  };

  const buildTransitionSummaryEntry = (summary = '', options = {}) => {
    const text = String(summary || '').trim();
    if (!text) return null;
    const toTurn = Math.max(0, Number(options?.currentTurn || options?.toTurn || 0));
    return normalizePreviousEntry({
      archiveKey: `transition_${simpleHash(`${options?.scopeId || runtimeState.activeScopeId}:${text}`)}`,
      fromTurn: Math.max(0, Number(options?.fromTurn || 0)),
      toTurn,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      title: '직전 상황 요약',
      summary: compactText(text, 220),
      content: text,
      entityNames: extractEntityNames(text, options?.EntityManager || globalThis?.LIBRA?.EntityManager || null, 8),
      locations: extractLocations(text, 4),
      moods: detectMoodTags(text, 4),
      relationHighlights: [],
      sourceEntryIds: []
    });
  };

  const appendMemory = async (options = {}) => {
    const scopeId = resolveOptionsScopeId(options);
    const text = normalizeText(options?.text || options?.assistantText || '');
    if (!text) return null;
    const now = Date.now();
    const entityManager = options?.EntityManager || globalThis?.LIBRA?.EntityManager || null;
    const userText = normalizeText(options?.userText || '');
    const assistantText = normalizeText(options?.assistantText || text);
    const combined = [userText, assistantText].filter(Boolean).join('\n');
    const store = await loadStore(scopeId);
    const entry = normalizeDirectEntry({
      id: options?.id || `dm_manual_${simpleHash(`${scopeId}:${now}:${text}`)}`,
      signature: options?.signature || `manual:${simpleHash([scopeId, text, options?.turn || 0].join('|'))}`,
      turn: Math.max(0, Number(options?.turn || getMemoryEngine()?.getCurrentTurn?.() || 0)),
      createdAt: now,
      updatedAt: now,
      phase: normalizeText(options?.phase || 'manual') || 'manual',
      runtimeMode: normalizeText(options?.runtimeMode || 'manual') || 'manual',
      reason: normalizeText(options?.reason || 'manual') || 'manual',
      latestMessageId: normalizeText(options?.latestMessageId || ''),
      sourceHash: normalizeText(options?.sourceHash || simpleHash(text)),
      importance: clampNumber(options?.importance, 8, 1, 10),
      ttl: Number.isFinite(Number(options?.ttl)) ? Number(options.ttl) : -1,
      source: normalizeText(options?.source || 'user_manual_injection') || 'user_manual_injection',
      sourceHint: normalizeText(options?.sourceHint || 'Manual Fact Injection') || 'Manual Fact Injection',
      sourceMessageIds: uniqueTexts(options?.sourceMessageIds || [], 12),
      captureStages: ['manual'],
      captureVerification: 'manual',
      userText,
      assistantText,
      episode: normalizeText(options?.episode || text) || compactText(text, 180),
      preview: normalizeText(options?.preview || ''),
      entityNames: uniqueTexts(options?.entityNames || extractEntityNames(combined, entityManager, 8), 8),
      locations: uniqueTexts(options?.locations || extractLocations(combined, 4), 4),
      moods: uniqueTexts(options?.moods || detectMoodTags(combined, 4), 4),
      dialogue: uniqueTexts(options?.dialogue || extractQuotedDialogue(combined, 2), 4),
      continuityHints: uniqueTexts(options?.continuityHints || extractContinuityHints(combined, 4), 4)
    });
    upsertDirectEntry(store, entry);
    mergeStoreDirectEntriesByTurn(store);
    archiveHistoricalDirectEntries(store, Math.max(0, Number(entry?.turn || 0)), options?.context || options);
    trimStore(store);
    await commitStore(scopeId, store);
    return cloneValue(entry, null);
  };

  const importStore = async (options = {}) => {
    const scopeId = resolveOptionsScopeId(options);
    const targetStore = await loadStore(scopeId);
    const importedStore = cloneValue(options?.store || {}, {});
    if (options?.resetCaptureIdentity === true && Array.isArray(importedStore?.directEntries)) {
      importedStore.directEntries = importedStore.directEntries.map((entry) => ({
        ...entry,
        latestMessageId: '',
        sourceMessageIds: [],
        sourceHash: '',
        reason: normalizeText(entry?.reason || 'carryover') || 'carryover'
      }));
    }
    const merged = mergeImportedStore(targetStore, importedStore);
    const transitionEntry = buildTransitionSummaryEntry(options?.sceneSummary || '', {
      scopeId,
      currentTurn: Number(options?.currentTurn || options?.toTurn || 0),
      fromTurn: Number(options?.fromTurn || 0),
      EntityManager: options?.EntityManager || globalThis?.LIBRA?.EntityManager || null
    });
    if (transitionEntry) {
      const previousByKey = new Map(
        (Array.isArray(merged?.previousEntries) ? merged.previousEntries : []).map(entry => [String(entry?.archiveKey || entry?.id || ''), normalizePreviousEntry(entry)])
      );
      const key = String(transitionEntry?.archiveKey || transitionEntry?.id || '');
      if (key && !previousByKey.has(key)) previousByKey.set(key, transitionEntry);
      merged.previousEntries = Array.from(previousByKey.values()).map(normalizePreviousEntry);
    }
    mergeStoreDirectEntriesByTurn(merged);
    trimStore(merged);
    await commitStore(scopeId, merged);
    return cloneValue(merged, { scopeId, directEntries: [], previousEntries: [], pendingCaptures: [], repairQueue: [] });
  };

  const collectRelationHighlights = (entityNames = [], fromTurn = 0, toTurn = 0, entityManager = null) => {
    if (!Array.isArray(entityNames) || !entityNames.length || typeof entityManager?.getAllRelations !== 'function') return [];
    const highlights = [];
    for (const relation of entityManager.getAllRelations()) {
      if (!relation) continue;
      const entityA = normalizeText(relation.entityA);
      const entityB = normalizeText(relation.entityB);
      if (!entityNames.includes(entityA) && !entityNames.includes(entityB)) continue;
      const changes = Array.isArray(relation?.meta?.recentChanges) ? relation.meta.recentChanges : [];
      for (const change of changes) {
        const turn = Number(change?.turn || 0);
        if (turn < fromTurn || turn > toTurn) continue;
        const text = compactText(change?.summary || '', 92);
        if (!text) continue;
        highlights.push(text);
        if (highlights.length >= 4) return uniqueTexts(highlights, 4);
      }
    }
    return uniqueTexts(highlights, 4);
  };

  const buildBulletSection = (title, items = []) => {
    const rows = uniqueTexts(items, 6).map(item => compactText(item, 180)).filter(Boolean);
    if (!rows.length) return [];
    return [`# ${title}`, ...rows.map(item => `- ${item}`), ''];
  };

  const buildPreviousMemorySummaryText = (entries = [], currentTurn = 0, context = {}) => {
    const list = Array.isArray(entries) ? entries.slice().sort((a, b) => Number(a.turn || 0) - Number(b.turn || 0)) : [];
    if (!list.length) return null;
    const fromTurn = Math.max(0, Number(list[0]?.turn || 0));
    const toTurn = Math.max(fromTurn, Number(list[list.length - 1]?.turn || fromTurn));
    const entityNames = uniqueTexts(list.flatMap(entry => entry?.entityNames || []), 8);
    const locations = uniqueTexts(list.flatMap(entry => entry?.locations || []), 4);
    const moods = uniqueTexts(list.flatMap(entry => entry?.moods || []), 4);
    const dialogue = uniqueTexts(list.flatMap(entry => entry?.dialogue || []), 4);
    const continuityHints = uniqueTexts(list.flatMap(entry => entry?.continuityHints || []), 4);
    const keyDetails = uniqueTexts(list.map(entry => entry?.preview || entry?.episode || buildEntryPreview(entry)), 4);
    const relationHighlights = collectRelationHighlights(entityNames, fromTurn, toTurn, context?.EntityManager || null);
    const coreEvent = compactText(
      list[list.length - 1]?.episode || keyDetails[0] || continuityHints[0] || list[list.length - 1]?.assistantText || '',
      160
    );
    const psychology = [
      moods.includes('긴장') ? '긴장과 경계가 이어짐' : '',
      moods.includes('충돌') ? '대치와 반발이 표면화됨' : '',
      moods.includes('흔들림') ? '판단과 감정이 흔들리는 구간이 있음' : '',
      moods.includes('유대') ? '보호와 신뢰 신호가 일부 강화됨' : ''
    ].filter(Boolean).join(' / ');
    const title = compactText([
      locations[0] || '',
      moods[0] || '',
      coreEvent || `과거 요약 T${fromTurn}-${toTurn}`
    ].filter(Boolean).join(' · '), 56) || `과거 요약 T${fromTurn}-${toTurn}`;
    const keywords = uniqueTexts([
      ...entityNames,
      ...locations,
      ...moods,
      ...relationHighlights
    ], 10);
    const importance = Math.max(1, Math.min(5, Math.round(1 + (Math.min(list.length, 6) * 0.45) + (relationHighlights.length * 0.4) + (moods.length * 0.2))));
    const operationalNotes = [
      relationHighlights.length ? `관계 변화 힌트 ${relationHighlights.length}건 확보` : '',
      continuityHints.length ? `연속성 고정점 ${continuityHints.length}건 압축` : '',
      moods.length ? `감정 결: ${moods.join(' -> ')}` : '',
      currentTurn > 0 ? `현재 기준 T${currentTurn}에서 과거 구간으로 분리` : '현재 턴 직접 증거가 아닌 과거 구간으로 분리'
    ].filter(Boolean);
    const headerLines = [
      '---',
      `message_index: ${toTurn}`,
      `range_start: ${fromTurn}`,
      `importance: ${importance}`,
      `title: ${title}`,
      `timeline: T${fromTurn}~T${toTurn}`,
      keywords.length ? `keywords: ${keywords.join(';')}` : '',
      locations.length ? `location: ${locations.join(' | ')}` : '',
      entityNames.length ? `characters: ${entityNames.join(', ')}` : '',
      '---',
      ''
    ].filter(Boolean);
    const lines = [
      ...headerLines,
      '# Core Event',
      coreEvent || '유의미한 핵심 사건 추출 실패',
      '',
      ...buildBulletSection('Key Details', keyDetails),
      ...buildBulletSection('Character Psychology', psychology ? [psychology] : []),
      ...buildBulletSection('Critical Dialogue', dialogue),
      ...buildBulletSection('Relationship Shifts', relationHighlights),
      ...buildBulletSection('Continuity Anchors', continuityHints),
      '# Operational Notes',
      ...operationalNotes.map(item => `- ${item}`),
      '',
      `현재 기준 T${Math.max(0, Number(currentTurn || 0))}에서 완료된 과거 회상본이며, 최신 턴 증거로 직접 사용하지 않습니다.`
    ];
    return {
      fromTurn,
      toTurn,
      title,
      summary: coreEvent,
      content: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
      entityNames,
      locations,
      moods,
      relationHighlights
    };
  };

  const buildPreviousSummaryEntries = (entries = [], currentTurn = 0, context = {}) => {
    const sorted = Array.isArray(entries) ? entries.slice().sort((a, b) => Number(a.turn || 0) - Number(b.turn || 0)) : [];
    if (!sorted.length) return [];
    const groups = [];
    let current = [];
    let groupStartTurn = null;
    for (const entry of sorted) {
      const turn = Number(entry?.turn || 0);
      if (groupStartTurn == null) groupStartTurn = turn;
      if (current.length > 0 && (turn - groupStartTurn) >= CONFIG.archiveGroupTurns) {
        groups.push(current);
        current = [];
        groupStartTurn = turn;
      }
      current.push(entry);
    }
    if (current.length) groups.push(current);
    return groups
      .filter(group => group.length >= CONFIG.archiveMinGroupSize)
      .map((group) => {
        const summary = buildPreviousMemorySummaryText(group, currentTurn, context);
        if (!summary?.content) return null;
        return normalizePreviousEntry({
          archiveKey: `prev_${summary.fromTurn}_${summary.toTurn}_${simpleHash(group.map(entry => entry.id).join('|'))}`,
          fromTurn: summary.fromTurn,
          toTurn: summary.toTurn,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          title: summary.title,
          summary: summary.summary,
          content: summary.content,
          entityNames: summary.entityNames,
          locations: summary.locations,
          moods: summary.moods,
          relationHighlights: summary.relationHighlights,
          sourceEntryIds: group.map(entry => String(entry?.id || '')).filter(Boolean)
        });
      })
      .filter(Boolean);
  };

  const archiveHistoricalDirectEntries = (store = {}, currentTurn = 0, context = {}) => {
    const directEntries = Array.isArray(store?.directEntries) ? store.directEntries.slice() : [];
    if (!directEntries.length) return store;
    const existingSourceIds = new Set(
      (Array.isArray(store?.previousEntries) ? store.previousEntries : []).flatMap(entry => Array.isArray(entry?.sourceEntryIds) ? entry.sourceEntryIds : [])
    );
    const candidates = directEntries.filter((entry) => {
      const turn = Number(entry?.turn || 0);
      if (!Number.isFinite(turn) || turn <= 0) return false;
      if (entry?.archived === true) return false;
      if ((Number(currentTurn || 0) - turn) < CONFIG.archiveMinAgeTurns) return false;
      return !existingSourceIds.has(String(entry?.id || ''));
    });
    if (candidates.length < CONFIG.archiveMinGroupSize) return store;
    const generated = buildPreviousSummaryEntries(candidates, currentTurn, context);
    if (!generated.length) return store;
    const previousByKey = new Map((Array.isArray(store?.previousEntries) ? store.previousEntries : []).map(entry => [String(entry?.archiveKey || entry?.id || ''), entry]));
    generated.forEach((entry) => {
      const key = String(entry?.archiveKey || entry?.id || '');
      if (!key || previousByKey.has(key)) return;
      previousByKey.set(key, entry);
    });
    const archivedIds = new Set(generated.flatMap(entry => entry?.sourceEntryIds || []).map(id => String(id || '')));
    store.previousEntries = Array.from(previousByKey.values()).map(normalizePreviousEntry);
    store.directEntries = directEntries.map((entry) => archivedIds.has(String(entry?.id || ''))
      ? normalizeDirectEntry({ ...entry, archived: true, updatedAt: Date.now() })
      : normalizeDirectEntry(entry));
    runtimeState.lastArchiveAt = Date.now();
    return trimStore(store);
  };

  const buildCaptureEntry = (context = {}, phase = 'finalize') => {
    const assistantPayload = resolveContextAssistantPayload(context);
    const assistantText = assistantPayload.assistantText;
    const userText = normalizeText(
      context?.userMsgForMemory
      || context?.userMessage
      || context?.userMsg
      || context?.userMsgForNarrative
      || ''
    );
    if (!assistantText) return null;
    const entityManager = context?.EntityManager || globalThis?.LIBRA?.EntityManager || null;
    const combined = [userText, assistantText].filter(Boolean).join('\n');
    const episode = buildEpisode(userText, assistantText) || compactText(assistantText || userText, 140);
    const latestMessageId = normalizeText(context?.latestMessageId || '');
    const sourceHash = normalizeText(context?.sourceHash || context?.turnState?.sourceHash || '');
    const sourceMessageIds = uniqueTexts(context?.sourceMessageIds || [latestMessageId], 12);
    const importance = clampNumber(context?.memoryImportance ?? context?.importance, 5, 1, 10);
    const signature = latestMessageId || sourceHash || simpleHash([context?.turn, userText, assistantText].join('|'));
    const lockedTurn = normalizeDmaTurnAnchor(context?.lockedTurn || context?.finalizedTurn || context?.firstTurn || context?.originalTurn || context?.turn);
    return normalizeDirectEntry({
      id: `dm_${Math.max(0, Number(context?.turn || 0))}_${simpleHash(signature)}`,
      signature,
      turn: lockedTurn || Math.max(0, Number(context?.turn || 0)),
      firstTurn: lockedTurn,
      originalTurn: lockedTurn,
      lockedTurn,
      finalizedTurn: lockedTurn,
      turnAnchorTurn: lockedTurn,
      turnLocked: lockedTurn > 0,
      turnAnchor: lockedTurn > 0 ? 'dma-finalized-direct' : '',
      turnAnchorReason: lockedTurn > 0 ? 'build-capture-entry' : '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      phase,
      runtimeMode: normalizeText(context?.runtimeMode || phase),
      memoryCaptureMode: assistantPayload.memoryCaptureMode,
      memoryCaptureSource: assistantPayload.memoryCaptureSource,
      reason: normalizeText(context?.reason || ''),
      latestMessageId,
      sourceHash,
      importance,
      ttl: Number.isFinite(Number(context?.memoryTtl)) ? Number(context.memoryTtl) : inferTtlFromImportance(importance),
      source: normalizeText(context?.memorySource || 'narrative_source_record') || 'narrative_source_record',
      sourceHint: normalizeText(context?.memorySourceHint || 'Used as source evidence for narrative summaries.') || 'Used as source evidence for narrative summaries.',
      sourceMessageIds,
      userText,
      assistantText,
      rawAssistantText: assistantPayload.rawAssistantText,
      displayContent: assistantPayload.displayContent,
      pendingResponseText: assistantPayload.pendingResponseText,
      episode,
      preview: buildEntryPreview({
        turn: context?.turn,
        entityNames: extractEntityNames(combined, entityManager, 8),
        episode
      }),
      entityNames: extractEntityNames(combined, entityManager, 8),
      locations: extractLocations(combined, 4),
      moods: detectMoodTags(combined, 4),
      dialogue: uniqueTexts([
        ...extractQuotedDialogue(userText, 2),
        ...extractQuotedDialogue(assistantText, 2)
      ], 4),
      continuityHints: extractContinuityHints(combined, 4)
    });
  };

  const formatPreviousMemoriesWithEvidence = (entries = [], store = {}, options = {}) => {
    const previousEntries = Array.isArray(entries) ? entries : [];
    const directEntries = Array.isArray(store?.directEntries) ? store.directEntries : [];
    if (!previousEntries.length) return '';
    const includeEvidence = options?.includeEvidence !== false;
    const maxEvidencePerItem = Math.max(1, Number(options?.maxEvidencePerItem || CONFIG.previousEvidencePerItem));
    return previousEntries.map((entry, index) => {
      const lines = [`[회상 ${index + 1}] (T${Number(entry?.fromTurn || 0)}-${Number(entry?.toTurn || 0)}) ${compactText(entry?.summary || entry?.title || '', 320)}`];
      if (includeEvidence) {
        const sourceIds = Array.isArray(entry?.sourceEntryIds) ? entry.sourceEntryIds : [];
        const supporting = directEntries.filter(row => sourceIds.includes(String(row?.id || ''))).slice(0, maxEvidencePerItem);
        supporting.forEach((row, evidenceIndex) => {
          lines.push(`  - 직접증거 ${evidenceIndex + 1} (T${Math.max(0, Number(row?.turn || 0))}): ${compactText(row?.episode || row?.assistantText || row?.preview || '', 220)}`);
        });
      }
      return lines.join('\n');
    }).join('\n');
  };

  const buildPreviousSummaryPromptFromStore = (store = {}, limit = CONFIG.previousPromptLimit) => {
    const previousEntries = (Array.isArray(store?.previousEntries) ? store.previousEntries : [])
      .slice()
      .sort((a, b) => Number(a?.toTurn || 0) - Number(b?.toTurn || 0))
      .slice(-Math.max(1, Number(limit || 0)));
    if (!previousEntries.length) return '';
    const text = formatPreviousMemoriesWithEvidence(previousEntries, store, {
      includeEvidence: true,
      maxEvidencePerItem: CONFIG.previousEvidencePerItem
    });
    if (!text) return '';
    return [
      '[과거 요약 보존본 / Archived Past Summaries]',
      '아래 항목은 로어북이 아니라 플러그인 스토리지에 보존된 과거 direct memory 압축본입니다.',
      '현재 턴의 직접 증거가 아니라 이미 지난 사건의 요약 맥락으로 취급하세요.',
      '판단 근거가 필요하면 각 회상 아래의 direct memory 증거 줄을 참고해 압축 요약을 검증하세요.',
      text
    ].join('\n');
  };

  const buildRecentDirectPromptFromStore = (store = {}, limit = CONFIG.directPromptLimit) => {
    const recentEntries = (Array.isArray(store?.directEntries) ? store.directEntries : [])
      .slice(-Math.max(1, Number(limit || 0)));
    if (!recentEntries.length) return '';
    const lines = recentEntries.map((entry) => {
      const entityLabel = Array.isArray(entry?.entityNames) && entry.entityNames.length
        ? ` | ${entry.entityNames.slice(0, 3).join(', ')}`
        : '';
      return `- [T${Math.max(0, Number(entry?.turn || 0))}]${entityLabel} ${compactText(entry?.episode || entry?.assistantText || entry?.preview || '', 180)}`;
    });
    return [
      '[최근 Direct Memory / Plugin Storage]',
      '아래 항목은 로어북이 아니라 플러그인 스토리지에 저장된 최신 직접 기억입니다.',
      ...lines
    ].join('\n');
  };

  const buildQnaMemoryBundleFromStore = (store = {}, options = {}) => {
    const directLimit = Math.max(1, Number(options?.directLimit || CONFIG.qnaDirectLimit));
    const previousLimit = Math.max(1, Number(options?.previousLimit || CONFIG.qnaPreviousLimit));
    const recentDirect = (Array.isArray(store?.directEntries) ? store.directEntries : []).slice(-directLimit);
    const recentPrevious = (Array.isArray(store?.previousEntries) ? store.previousEntries : []).slice(-previousLimit);
    const blocks = [];
    if (recentDirect.length) {
      blocks.push([
        '[Plugin Direct Memory Evidence]',
        ...recentDirect.map(entry => `- ${compactText(entry?.preview || entry?.episode || entry?.assistantText || '', 220)}`)
      ].join('\n'));
    }
    if (recentPrevious.length) {
      blocks.push([
        '[Plugin Previous Summary Evidence]',
        formatPreviousMemoriesWithEvidence(recentPrevious, store, {
          includeEvidence: true,
          maxEvidencePerItem: CONFIG.previousEvidencePerItem
        })
      ].join('\n'));
    }
    return {
      layerId: 'dma',
      layerMode: 'parallel',
      memoryLayerId: 'dma',
      memoryLayerMode: 'parallel',
      coexistsWithLegacyMemory: true,
      replacesLegacyMemory: false,
      text: blocks.join('\n\n'),
      highlights: [
        ...recentDirect.map(entry => ({ comment: 'plugin_direct_memory', text: compactText(entry?.preview || entry?.episode || '', 220) })),
        ...recentPrevious.map(entry => ({ comment: 'plugin_previous', text: compactText(entry?.summary || entry?.title || '', 220) }))
      ].filter(row => row.text)
    };
  };

  const formatDateTime = (value = 0) => {
    const ts = Number(value || 0);
    if (!Number.isFinite(ts) || ts <= 0) return '시간 정보 없음';
    try {
      return new Date(ts).toLocaleString();
    } catch (_) {
      return String(ts);
    }
  };

  const buildFallbackLiveTurnPlan = (chat = null) => {
    const messages = getChatMessages(chat).filter(msg => msg && typeof msg === 'object');
    const messageIdToTurn = new Map();
    const sourceHashToTurn = new Map();
    let turn = 0;
    for (const msg of messages) {
      const isUser = msg?.role === 'user' || msg?.is_user;
      const text = normalizeText(getMessageText(msg));
      if (!text || isUser) continue;
      turn += 1;
      normalizeCanonicalMessageIds(msg).forEach((id) => {
        if (id) messageIdToTurn.set(id, turn);
      });
      sourceHashToTurn.set(simpleHash(text), turn);
    }
    return {
      replayableTurns: [],
      liveTurnCount: turn,
      currentTurnCount: turn,
      messageIdToTurn,
      sourceHashToTurn,
      oldTurnToNewTurn: new Map(),
      changedCount: 0
    };
  };

  const buildLiveTurnPlanForChat = (chat = null, lorebook = []) => {
    const helpers = getSharedRuntimeHelpers();
    if (typeof helpers?.buildLiveTurnAlignmentPlan === 'function') {
      try {
        return helpers.buildLiveTurnAlignmentPlan(Array.isArray(lorebook) ? lorebook : [], chat) || buildFallbackLiveTurnPlan(chat);
      } catch (_) {}
    }
    if (typeof globalThis?.buildLiveTurnAlignmentPlan === 'function') {
      try {
        return globalThis.buildLiveTurnAlignmentPlan(Array.isArray(lorebook) ? lorebook : [], chat) || buildFallbackLiveTurnPlan(chat);
      } catch (_) {}
    }
    return buildFallbackLiveTurnPlan(chat);
  };

  const getDirectEntrySourceHashes = (entry = {}) => uniqueTexts([
    normalizeText(entry?.sourceHash),
    normalizeText(simpleHash(normalizeText(entry?.assistantText || ''))),
    normalizeText(simpleHash(normalizeText(entry?.episode || ''))),
    normalizeText(simpleHash(normalizeText(entry?.preview || '')))
  ], 8);

  const resolveDirectEntryLiveTurn = (entry = {}, plan = null) => {
    const helpers = getSharedRuntimeHelpers();
    const currentTurn = Math.max(0, Number(entry?.turn || 0));
    const messageIds = normalizeCanonicalMessageIds(entry?.sourceMessageIds || entry?.latestMessageId || entry?.m_id);
    const hashes = getDirectEntrySourceHashes(entry);
    if (typeof helpers?.resolveLiveTurnNumber === 'function') {
      for (const hash of hashes) {
        try {
          const resolved = Math.max(0, Number(helpers.resolveLiveTurnNumber(currentTurn, messageIds, hash, plan) || 0));
          if (resolved > 0) return resolved;
        } catch (_) {}
      }
    }
    if (typeof globalThis?.resolveLiveTurnNumber === 'function') {
      for (const hash of hashes) {
        try {
          const resolved = Math.max(0, Number(globalThis.resolveLiveTurnNumber(currentTurn, messageIds, hash, plan) || 0));
          if (resolved > 0) return resolved;
        } catch (_) {}
      }
    }
    let resolved = 0;
    messageIds.forEach((id) => {
      const nextTurn = Number(plan?.messageIdToTurn?.get?.(id) || 0);
      if (nextTurn > resolved) resolved = nextTurn;
    });
    if (!resolved) {
      hashes.forEach((hash) => {
        const nextTurn = Number(plan?.sourceHashToTurn?.get?.(hash) || 0);
        if (nextTurn > resolved) resolved = nextTurn;
      });
    }
    if (!resolved) {
      const remapped = Number(plan?.oldTurnToNewTurn?.get?.(currentTurn) || 0);
      if (remapped > 0) resolved = remapped;
    }
    return Math.max(0, resolved || currentTurn);
  };
  const buildDirectEntryTargetedMemorySource = (entry = {}) => {
    const normalized = normalizeDirectEntry(entry);
    const userText = normalizeText(normalized?.userText || '');
    const assistantText = normalizeText(
      normalized?.assistantText
      || normalized?.rawAssistantText
      || normalized?.displayContent
      || normalized?.pendingResponseText
      || normalized?.episode
      || normalized?.preview
      || ''
    );
    if (!userText && !assistantText) return '';
    return [
      `[사용자] ${userText}`.trim(),
      `[응답] ${assistantText}`.trim()
    ].filter(Boolean).join('\n');
  };
  const resolveDirectEntryLiveAnchor = (entry = {}, chat = null, lorebook = [], plan = null) => {
    const normalized = normalizeDirectEntry(entry);
    const helpers = getSharedRuntimeHelpers();
    const messageIds = normalizeCanonicalMessageIds(normalized?.sourceMessageIds || normalized?.latestMessageId || normalized?.m_id);
    const currentTurn = Math.max(0, Number(normalized?.turn || 0));
    const targetedMeta = {
      t: currentTurn,
      lastScoredTurn: currentTurn,
      sourceHash: normalizeText(normalized?.sourceHash || ''),
      liveMessageIds: messageIds,
      sourceMessageIds: messageIds,
      messageId: normalizeText(normalized?.latestMessageId || normalized?.m_id || '')
    };
    const targetedRawContent = buildDirectEntryTargetedMemorySource(normalized);
    const targetedResolver = helpers?.resolveTargetedLiveTurnForChat || globalThis?.resolveTargetedLiveTurnForChat || null;
    if (typeof targetedResolver === 'function' && chat) {
      try {
        const targeted = targetedResolver(chat, targetedMeta, {
          rawContent: targetedRawContent,
          pairWindow: 4,
          allowFullFallback: true
        });
        if (targeted && targeted.matched) {
          const targetedIds = normalizeCanonicalMessageIds(targeted?.sourceMessageIds || targeted?.latestMessageId);
          return {
            matched: true,
            turn: Math.max(0, Number(targeted?.turn || currentTurn)),
            sourceHash: normalizeText(targeted?.sourceHash || normalized?.sourceHash || ''),
            sourceMessageIds: targetedIds.length ? targetedIds : messageIds,
            latestMessageId: normalizeText(targeted?.latestMessageId || targetedIds[0] || normalized?.latestMessageId || ''),
            resolutionMode: normalizeText(targeted?.resolutionMode || 'targeted-window') || 'targeted-window'
          };
        }
      } catch (_) {}
    }
    return {
      matched: false,
      turn: resolveDirectEntryLiveTurn(normalized, plan || buildLiveTurnPlanForChat(chat, lorebook)),
      sourceHash: normalizeText(normalized?.sourceHash || ''),
      sourceMessageIds: messageIds,
      latestMessageId: normalizeText(normalized?.latestMessageId || messageIds[0] || ''),
      resolutionMode: 'plan-fallback'
    };
  };

  const rewritePreviousContentTurnHeader = (content = '', fromTurn = 0, toTurn = 0) => {
    const text = String(content || '').trim();
    if (!text) return '';
    const nextHeader = `[과거 요약 T${Math.max(0, Number(fromTurn || 0))}-${Math.max(0, Number(toTurn || fromTurn || 0))}]`;
    if (/^\[과거 요약 T\d+-\d+\]/.test(text)) {
      return text.replace(/^\[과거 요약 T\d+-\d+\]/, nextHeader);
    }
    return `${nextHeader}\n${text}`;
  };

  const mergeTextBlocks = (left = '', right = '', maxLen = 5200) => {
    const parts = [];
    const seen = new Set();
    const push = (value) => {
      String(value || '')
        .split(/\n+/)
        .map(line => normalizeText(line))
        .filter(Boolean)
        .forEach((line) => {
          const key = line.toLowerCase();
          if (seen.has(key)) return;
          seen.add(key);
          parts.push(line);
        });
    };
    push(left);
    push(right);
    const joined = parts.join('\n').trim();
    return joined.length > maxLen ? `${joined.slice(0, Math.max(0, maxLen - 1)).trim()}…` : joined;
  };

  const selectPreferredCompactText = (base = '', incoming = '', maxLen = 260) => {
    const left = normalizeText(base);
    const right = normalizeText(incoming);
    if (!left) return compactText(right, maxLen);
    if (!right) return compactText(left, maxLen);
    if (isTextCompatible(left, right)) {
      return compactText(left.length >= right.length ? left : right, maxLen);
    }
    return compactText(`${left} / ${right}`, maxLen);
  };

  const mergePreviousEntries = (base = {}, incoming = {}) => {
    const fromTurnCandidates = [base?.fromTurn, incoming?.fromTurn]
      .map(value => Math.max(0, Number(value || 0)))
      .filter(value => value > 0);
    const nextFromTurn = fromTurnCandidates.length ? Math.min(...fromTurnCandidates) : 0;
    const nextToTurn = Math.max(Math.max(0, Number(base?.toTurn || base?.fromTurn || 0)), Math.max(0, Number(incoming?.toTurn || incoming?.fromTurn || 0)));
    const archiveKey = normalizeText(base?.archiveKey || incoming?.archiveKey)
      || `prev_${nextFromTurn}_${nextToTurn}_${simpleHash(uniqueTexts([...(base?.sourceEntryIds || []), ...(incoming?.sourceEntryIds || [])], 120).join('|'))}`;
    return normalizePreviousEntry({
      ...base,
      ...incoming,
      id: normalizeText(base?.id || incoming?.id || archiveKey),
      archiveKey,
      fromTurn: nextFromTurn,
      toTurn: nextToTurn,
      createdAt: Math.min(Number(base?.createdAt || Infinity), Number(incoming?.createdAt || Infinity), Date.now()),
      updatedAt: Math.max(Number(base?.updatedAt || 0), Number(incoming?.updatedAt || 0), Date.now()),
      title: selectPreferredCompactText(base?.title, incoming?.title, 120),
      summary: selectPreferredCompactText(base?.summary, incoming?.summary, 260),
      content: rewritePreviousContentTurnHeader(
        mergeTextBlocks(base?.content, incoming?.content, 5200),
        nextFromTurn,
        nextToTurn
      ),
      entityNames: uniqueTexts([...(base?.entityNames || []), ...(incoming?.entityNames || [])], 8),
      locations: uniqueTexts([...(base?.locations || []), ...(incoming?.locations || [])], 4),
      moods: uniqueTexts([...(base?.moods || []), ...(incoming?.moods || [])], 4),
      relationHighlights: uniqueTexts([...(base?.relationHighlights || []), ...(incoming?.relationHighlights || [])], 6),
      sourceEntryIds: uniqueTexts([...(base?.sourceEntryIds || []), ...(incoming?.sourceEntryIds || [])], 120)
    });
  };

  const shouldMergePreviousEntries = (left = {}, right = {}) => {
    if (!left || !right) return false;
    if (String(left?.archiveKey || '').trim() && String(left?.archiveKey || '').trim() === String(right?.archiveKey || '').trim()) return true;
    if (hasListOverlap(left?.sourceEntryIds || [], right?.sourceEntryIds || [])) return true;
    const leftFrom = Math.max(0, Number(left?.fromTurn || 0));
    const leftTo = Math.max(leftFrom, Number(left?.toTurn || leftFrom));
    const rightFrom = Math.max(0, Number(right?.fromTurn || 0));
    const rightTo = Math.max(rightFrom, Number(right?.toTurn || rightFrom));
    const overlaps = Math.max(leftFrom, rightFrom) <= Math.min(leftTo, rightTo);
    return overlaps && isTextCompatible(left?.summary, right?.summary);
  };

  const mergePreviousEntriesByTurn = (entries = []) => {
    const sorted = (Array.isArray(entries) ? entries : [])
      .map(normalizePreviousEntry)
      .sort((a, b) => Number(a.fromTurn || 0) - Number(b.fromTurn || 0) || Number(a.toTurn || 0) - Number(b.toTurn || 0) || Number(a.createdAt || 0) - Number(b.createdAt || 0));
    const next = [];
    let mergedAway = 0;
    for (const entry of sorted) {
      const index = next.findIndex(existing => shouldMergePreviousEntries(existing, entry));
      if (index >= 0) {
        next[index] = mergePreviousEntries(next[index], entry);
        mergedAway += 1;
      } else {
        next.push(entry);
      }
    }
    return {
      entries: next.map(normalizePreviousEntry),
      mergedAway
    };
  };

  const mergeDirectEntriesByTurn = (entries = []) => {
    const sorted = (Array.isArray(entries) ? entries : [])
      .map(normalizeDirectEntry)
      .sort((a, b) => Number(a.turn || 0) - Number(b.turn || 0) || Number(a.createdAt || 0) - Number(b.createdAt || 0));
    const mergedByTurn = new Map();
    const unresolved = [];
    sorted.forEach((entry) => {
      const turn = Math.max(0, Number(entry?.turn || 0));
      if (!turn) {
        unresolved.push(entry);
        return;
      }
      const existing = mergedByTurn.get(turn);
      mergedByTurn.set(turn, existing ? mergeDirectEntries(existing, entry) : entry);
    });
    const unresolvedDedupe = dedupeDirectEntries(unresolved);
    const entriesByTurn = Array.from(mergedByTurn.values()).map(normalizeDirectEntry);
    const nextEntries = entriesByTurn.concat(unresolvedDedupe.entries).sort((a, b) => Number(a.turn || 0) - Number(b.turn || 0) || Number(a.createdAt || 0) - Number(b.createdAt || 0));
    return {
      entries: nextEntries,
      mergedAway: Math.max(0, sorted.length - nextEntries.length)
    };
  };

  const mergeStoreDirectEntriesByTurn = (store = {}) => {
    if (CONFIG.autoMergeDirectEntriesByTurn === false) return { mergedAway: 0, idRemap: new Map() };
    const directEntries = (Array.isArray(store?.directEntries) ? store.directEntries : [])
      .map(normalizeDirectEntry)
      .sort((a, b) => Number(a.turn || 0) - Number(b.turn || 0) || Number(a.createdAt || 0) - Number(b.createdAt || 0));
    if (directEntries.length <= 1) return { mergedAway: 0, idRemap: new Map() };
    const mergedByTurn = new Map();
    const unresolved = [];
    const idRemap = new Map();
    let mergedAway = 0;
    directEntries.forEach((entry) => {
      const turn = Math.max(0, Number(entry?.turn || 0));
      if (!turn) {
        unresolved.push(entry);
        return;
      }
      const existing = mergedByTurn.get(turn);
      if (!existing) {
        mergedByTurn.set(turn, entry);
        return;
      }
      const stableId = normalizeText(existing?.id || entry?.id || '');
      const anchorTurn = chooseEarliestDmaTurnAnchor(existing, entry) || turn;
      const merged = normalizeDirectEntry({
        ...mergeDirectEntries(existing, entry),
        id: stableId || undefined,
        turn: anchorTurn,
        firstTurn: anchorTurn,
        originalTurn: anchorTurn,
        lockedTurn: anchorTurn,
        finalizedTurn: anchorTurn,
        turnAnchorTurn: anchorTurn,
        turnLocked: true,
        turnAnchor: 'dma-turn-merge',
        turnAnchorReason: 'merge-store-direct-entries',
        sourceMessageIds: uniqueTexts([
          ...(existing?.sourceMessageIds || []),
          ...(entry?.sourceMessageIds || []),
          existing?.latestMessageId,
          entry?.latestMessageId
        ], 12)
      });
      [existing?.id, entry?.id].forEach((id) => {
        const key = normalizeText(id || '');
        if (key && merged?.id) idRemap.set(key, merged.id);
      });
      mergedByTurn.set(turn, merged);
      mergedAway += 1;
    });
    if (!mergedAway) {
      store.directEntries = directEntries;
      return { mergedAway: 0, idRemap };
    }
    const remapIds = (items = [], limit = 96) => uniqueTexts(
      (Array.isArray(items) ? items : [])
        .map(id => idRemap.get(normalizeText(id || '')) || normalizeText(id || ''))
        .filter(Boolean),
      limit
    );
    store.directEntries = Array.from(mergedByTurn.values())
      .concat(unresolved)
      .map(normalizeDirectEntry)
      .sort((a, b) => Number(a.turn || 0) - Number(b.turn || 0) || Number(a.createdAt || 0) - Number(b.createdAt || 0));
    store.previousEntries = (Array.isArray(store?.previousEntries) ? store.previousEntries : [])
      .map(entry => normalizePreviousEntry({
        ...entry,
        sourceEntryIds: remapIds(entry?.sourceEntryIds || [], 80)
      }));
    store.repairQueue = (Array.isArray(store?.repairQueue) ? store.repairQueue : [])
      .map(entry => normalizeRepairItem({
        ...entry,
        directIds: remapIds(entry?.directIds || [], 240)
      }));
    return { mergedAway, idRemap };
  };

  const refreshPreviousEntryTurnsFromSources = (store = {}) => {
    const directById = new Map(
      (Array.isArray(store?.directEntries) ? store.directEntries : [])
        .map(normalizeDirectEntry)
        .map(entry => [String(entry?.id || '').trim(), entry])
    );
    let changed = 0;
    store.previousEntries = (Array.isArray(store?.previousEntries) ? store.previousEntries : []).map((entry) => {
      const normalized = normalizePreviousEntry(entry);
      const sourceTurns = (Array.isArray(normalized?.sourceEntryIds) ? normalized.sourceEntryIds : [])
        .map(id => Number(directById.get(String(id || '').trim())?.turn || 0))
        .filter(turn => Number.isFinite(turn) && turn > 0);
      if (!sourceTurns.length) return normalized;
      const nextFrom = Math.min(...sourceTurns);
      const nextTo = Math.max(...sourceTurns);
      if (nextFrom === Number(normalized?.fromTurn || 0) && nextTo === Number(normalized?.toTurn || 0)) return normalized;
      changed += 1;
      return normalizePreviousEntry({
        ...normalized,
        fromTurn: nextFrom,
        toTurn: nextTo,
        updatedAt: Date.now(),
        content: rewritePreviousContentTurnHeader(normalized?.content || '', nextFrom, nextTo)
      });
    });
    return changed;
  };

  const applyLiveChatTurnAlignmentToStore = (store = {}, chat = null, lorebook = []) => {
    const plan = buildLiveTurnPlanForChat(chat, lorebook);
    const liveTurnCount = Math.max(0, Number(plan?.liveTurnCount || 0));
    let directTurnChanges = 0;
    let directRetargeted = 0;
    let targetedMatches = 0;
    store.directEntries = (Array.isArray(store?.directEntries) ? store.directEntries : []).map((entry) => {
      const normalized = normalizeDirectEntry(entry);
      const anchor = resolveDirectEntryLiveAnchor(normalized, chat, lorebook, plan);
      const nextTurn = Math.max(0, Number(anchor?.turn || 0));
      const lockedTurn = getDmaDirectTurnAnchor(normalized);
      const preservedTurn = lockedTurn || Number(normalized?.turn || 0);
      const nextSourceMessageIds = uniqueTexts(anchor?.sourceMessageIds || normalized?.sourceMessageIds || [], 12);
      const nextLatestMessageId = normalizeText(anchor?.latestMessageId || nextSourceMessageIds[0] || normalized?.latestMessageId || '');
      const nextSourceHash = normalizeText(anchor?.sourceHash || normalized?.sourceHash || '');
      const turnChanged = !lockedTurn && !!nextTurn && nextTurn !== Number(normalized?.turn || 0);
      const previousIdsKey = uniqueTexts(normalized?.sourceMessageIds || [], 12).join('|');
      const nextIdsKey = nextSourceMessageIds.join('|');
      const targetChanged =
        nextLatestMessageId !== normalizeText(normalized?.latestMessageId || '')
        || nextSourceHash !== normalizeText(normalized?.sourceHash || '')
        || nextIdsKey !== previousIdsKey;
      if (!turnChanged && !targetChanged) return normalized;
      if (turnChanged) directTurnChanges += 1;
      if (anchor?.matched) targetedMatches += 1;
      if (targetChanged) directRetargeted += 1;
      return normalizeDirectEntry({
        ...normalized,
        turn: preservedTurn || nextTurn || Number(normalized?.turn || 0),
        firstTurn: lockedTurn || normalized?.firstTurn || preservedTurn,
        originalTurn: lockedTurn || normalized?.originalTurn || preservedTurn,
        lockedTurn: lockedTurn || normalized?.lockedTurn || preservedTurn,
        finalizedTurn: lockedTurn || normalized?.finalizedTurn || preservedTurn,
        turnAnchorTurn: lockedTurn || normalized?.turnAnchorTurn || preservedTurn,
        turnLocked: !!(lockedTurn || normalized?.turnLocked),
        turnAnchorReason: lockedTurn ? 'live-alignment-preserved-anchor' : normalized?.turnAnchorReason,
        latestMessageId: nextLatestMessageId || normalized?.latestMessageId || '',
        sourceHash: nextSourceHash || normalized?.sourceHash || '',
        sourceMessageIds: nextSourceMessageIds.length ? nextSourceMessageIds : normalized?.sourceMessageIds || [],
        updatedAt: Date.now()
      });
    });
    const previousTurnChanges = refreshPreviousEntryTurnsFromSources(store);
    store.directEntries = (Array.isArray(store?.directEntries) ? store.directEntries : [])
      .map(normalizeDirectEntry)
      .sort((a, b) => Number(a.turn || 0) - Number(b.turn || 0) || Number(a.createdAt || 0) - Number(b.createdAt || 0));
    store.previousEntries = (Array.isArray(store?.previousEntries) ? store.previousEntries : [])
      .map(normalizePreviousEntry)
      .sort((a, b) => Number(a.toTurn || 0) - Number(b.toTurn || 0) || Number(a.createdAt || 0) - Number(b.createdAt || 0));
    return {
      store,
      plan,
      liveTurnCount,
      directTurnChanges,
      previousTurnChanges,
      directRetargeted,
      targetedMatches
    };
  };

  const summarizeStoreCounts = (scopeId = 'global', store = null) => {
    const directCount = Array.isArray(store?.directEntries) ? store.directEntries.length : runtimeState.lastDirectCount;
    const previousCount = Array.isArray(store?.previousEntries) ? store.previousEntries.length : runtimeState.lastPreviousCount;
    const pendingCount = Array.isArray(store?.pendingCaptures) ? store.pendingCaptures.length : runtimeState.lastPendingCount;
    return `scope=${scopeId} | direct=${directCount} | previous=${previousCount} | pending=${pendingCount}`;
  };

  const runLiveChatTurnAlignmentForScope = async (context = {}) => {
    const resolved = await resolveContextScope(context);
    const store = cloneValue(await loadStore(resolved.scopeId), null) || normalizeStore({}, resolved.scopeId);
    if (!resolved?.chat) {
      updateRuntimeStatus('livechat turn sort skipped', {
        error: 'missing_chat_context',
        preview: '활성 채팅 컨텍스트를 찾지 못해 DMA 라이브챗 정렬을 건너뛰었습니다.'
      });
      return { ok: false, reason: 'missing_chat_context', scopeId: resolved.scopeId };
    }
    const result = applyLiveChatTurnAlignmentToStore(store, resolved.chat, resolved.lorebook || []);
    trimStore(result.store);
    await commitStore(resolved.scopeId, result.store);
    runtimeState.lastAlignedAt = Date.now();
    updateRuntimeStatus('livechat turn sort complete', {
      scopeId: resolved.scopeId,
      liveTurnCount: result.liveTurnCount,
      directTurnChanges: result.directTurnChanges,
      previousTurnChanges: result.previousTurnChanges,
      directRetargeted: result.directRetargeted,
      targetedMatches: result.targetedMatches,
      preview: `라이브챗 턴 정렬 완료 · direct ${result.directTurnChanges}건 · retarget ${result.directRetargeted}건 · matched ${result.targetedMatches}건 · previous ${result.previousTurnChanges}건 · live turns ${result.liveTurnCount}`
    });
    return {
      ok: true,
      scopeId: resolved.scopeId,
      ...result
    };
  };

  const runLiveChatTurnMergeForScope = async (context = {}) => {
    const resolved = await resolveContextScope(context);
    const store = cloneValue(await loadStore(resolved.scopeId), null) || normalizeStore({}, resolved.scopeId);
    if (!resolved?.chat) {
      updateRuntimeStatus('livechat turn merge skipped', {
        error: 'missing_chat_context',
        preview: '활성 채팅 컨텍스트를 찾지 못해 DMA 라이브챗 병합을 건너뛰었습니다.'
      });
      return { ok: false, reason: 'missing_chat_context', scopeId: resolved.scopeId };
    }
    const aligned = applyLiveChatTurnAlignmentToStore(store, resolved.chat, resolved.lorebook || []);
    const mergedDirect = mergeStoreDirectEntriesByTurn(aligned.store);
    const previousTurnChanges = refreshPreviousEntryTurnsFromSources(aligned.store);
    const mergedPrevious = mergePreviousEntriesByTurn(aligned.store.previousEntries || []);
    aligned.store.previousEntries = mergedPrevious.entries;
    trimStore(aligned.store);
    await commitStore(resolved.scopeId, aligned.store);
    runtimeState.lastMergedAt = Date.now();
    updateRuntimeStatus('livechat turn merge complete', {
      scopeId: resolved.scopeId,
      liveTurnCount: aligned.liveTurnCount,
      directTurnChanges: aligned.directTurnChanges,
      previousTurnChanges: aligned.previousTurnChanges + previousTurnChanges,
      directRetargeted: aligned.directRetargeted,
      targetedMatches: aligned.targetedMatches,
      directMerged: mergedDirect.mergedAway,
      previousMerged: mergedPrevious.mergedAway,
      preview: `라이브챗 턴 병합 완료 · direct merge ${mergedDirect.mergedAway}건 · previous merge ${mergedPrevious.mergedAway}건 · retarget ${aligned.directRetargeted}건 · matched ${aligned.targetedMatches}건`
    });
    return {
      ok: true,
      scopeId: resolved.scopeId,
      liveTurnCount: aligned.liveTurnCount,
      directTurnChanges: aligned.directTurnChanges,
      previousTurnChanges: aligned.previousTurnChanges + previousTurnChanges,
      directRetargeted: aligned.directRetargeted,
      targetedMatches: aligned.targetedMatches,
      directMerged: mergedDirect.mergedAway,
      previousMerged: mergedPrevious.mergedAway
    };
  };

  const deleteDmaTurnFromScope = async (options = {}) => {
    const scopeId = resolveOptionsScopeId(options);
    const turn = Math.max(0, Number(options?.turn || options?.targetTurn || options?.deleteTurn || 0));
    if (!turn) {
      return { ok: false, scopeId, reason: 'missing_turn', deleted: false };
    }
    const store = cloneValue(await loadStore(scopeId), null) || normalizeStore({}, scopeId);
    const directEntries = (Array.isArray(store?.directEntries) ? store.directEntries : []).map(normalizeDirectEntry);
    const pendingCaptures = (Array.isArray(store?.pendingCaptures) ? store.pendingCaptures : []).map(normalizePendingCapture);
    const previousEntries = (Array.isArray(store?.previousEntries) ? store.previousEntries : []).map(normalizePreviousEntry);
    const repairQueue = (Array.isArray(store?.repairQueue) ? store.repairQueue : []).map(normalizeRepairItem);

    const removedDirect = directEntries.filter(entry => Number(entry?.turn || 0) === turn);
    const removedPending = pendingCaptures.filter(entry => getPendingCaptureTurn(entry) === turn);
    const removedDirectIds = new Set(removedDirect.map(entry => String(entry?.id || '')).filter(Boolean));
    const removedPendingIds = new Set(removedPending.map(entry => String(entry?.id || '')).filter(Boolean));
    const removedSourceMessageIds = uniqueTexts([
      ...removedDirect.flatMap(entry => [...(entry?.sourceMessageIds || []), entry?.latestMessageId]),
      ...removedPending.flatMap(entry => [...(entry?.sourceMessageIds || []), entry?.latestMessageId])
    ], 128);
    const removedSourceHashes = uniqueTexts([
      ...removedDirect.map(entry => entry?.sourceHash || ''),
      ...removedPending.map(entry => entry?.sourceHash || '')
    ], 128);
    const removedPrevious = previousEntries.filter((entry) => {
      if (doesPreviousEntryOverlapTurn(entry, turn)) return true;
      const sourceIds = Array.isArray(entry?.sourceEntryIds) ? entry.sourceEntryIds : [];
      return sourceIds.some(id => removedDirectIds.has(String(id || '')));
    });
    const removedPreviousIds = new Set(
      removedPrevious
        .flatMap(entry => [entry?.id, entry?.archiveKey])
        .map(id => String(id || ''))
        .filter(Boolean)
    );

    store.directEntries = directEntries.filter(entry => Number(entry?.turn || 0) !== turn);
    store.pendingCaptures = pendingCaptures.filter(entry => getPendingCaptureTurn(entry) !== turn);
    store.previousEntries = previousEntries
      .filter((entry) => {
        const id = String(entry?.id || '');
        const archiveKey = String(entry?.archiveKey || '');
        return !removedPreviousIds.has(id) && !removedPreviousIds.has(archiveKey);
      })
      .map((entry) => normalizePreviousEntry({
        ...entry,
        sourceEntryIds: (Array.isArray(entry?.sourceEntryIds) ? entry.sourceEntryIds : [])
          .filter(id => !removedDirectIds.has(String(id || '')))
      }));
    let removedRepairs = 0;
    store.repairQueue = repairQueue.filter((repair) => {
      const impacted = Number(repair?.targetTurn || 0) === turn
        || (repair?.directIds || []).some(id => removedDirectIds.has(String(id || '')))
        || (repair?.pendingIds || []).some(id => removedPendingIds.has(String(id || '')))
        || (repair?.previousIds || []).some(id => removedPreviousIds.has(String(id || '')));
      if (impacted) removedRepairs += 1;
      return !impacted;
    });
    store.deletedTurns = normalizeDeletedTurnList([
      ...(Array.isArray(store?.deletedTurns) ? store.deletedTurns : []),
      {
        turn,
        deletedAt: Date.now(),
        reason: normalizeText(options?.reason || 'manual-delete') || 'manual-delete',
        directIds: Array.from(removedDirectIds),
        pendingIds: Array.from(removedPendingIds),
        previousIds: Array.from(removedPreviousIds),
        sourceMessageIds: removedSourceMessageIds,
        sourceHashes: removedSourceHashes
      }
    ]);
    trimStore(store);
    const committed = await commitStore(scopeId, store);
    const result = {
      ok: true,
      deleted: true,
      scopeId,
      turn,
      directDeleted: removedDirect.length,
      pendingDeleted: removedPending.length,
      previousDeleted: removedPrevious.length,
      repairDeleted: removedRepairs,
      remaining: {
        directEntries: Array.isArray(committed?.directEntries) ? committed.directEntries.length : 0,
        previousEntries: Array.isArray(committed?.previousEntries) ? committed.previousEntries.length : 0,
        pendingCaptures: Array.isArray(committed?.pendingCaptures) ? committed.pendingCaptures.length : 0,
        repairQueue: Array.isArray(committed?.repairQueue) ? committed.repairQueue.length : 0
      }
    };
    updateRuntimeStatus(`deleted turn ${turn}`, {
      scopeId,
      activeChatId: scopeId,
      directEntries: result.remaining.directEntries,
      previousEntries: result.remaining.previousEntries,
      pendingCaptures: result.remaining.pendingCaptures,
      repairQueue: result.remaining.repairQueue,
      preview: `DMA T${turn} 삭제 완료 · direct ${result.directDeleted} · pending ${result.pendingDeleted} · previous ${result.previousDeleted} · repair ${result.repairDeleted}`
    });
    return result;
  };

  const renderViewerTextBlock = (title = '', text = '') => {
    const normalized = String(text || '').trim();
    if (!normalized) return '';
    return `
      <div style="margin-top:8px">
        <div style="font-size:11px;font-weight:800;color:#0f172a">${escHtml(title)}</div>
        <div style="margin-top:4px;padding:10px 11px;border-radius:12px;background:#f8fafc;border:1px solid rgba(148,163,184,0.24);font-size:12px;line-height:1.72;color:#334155;white-space:pre-wrap">${escHtml(normalized)}</div>
      </div>
    `;
  };

  const buildDirectEntryViewerHtml = (entries = [], scopeId = 'global') => {
    const sorted = (Array.isArray(entries) ? entries : [])
      .map(normalizeDirectEntry)
      .slice()
      .sort((a, b) => Number(b.turn || 0) - Number(a.turn || 0) || Number(b.createdAt || 0) - Number(a.createdAt || 0));
    if (!sorted.length) {
      return `<div style="padding:22px;border-radius:16px;border:1px dashed rgba(148,163,184,0.36);background:#ffffff;font-size:13px;color:#64748b;text-align:center">아직 저장된 Memory Entry가 없습니다.</div>`;
    }
    return sorted.map((entry, index) => `
      <details ${index === 0 ? 'open' : ''} style="border:1px solid rgba(148,163,184,0.22);border-radius:16px;background:#ffffff;box-shadow:0 14px 32px rgba(15,23,42,0.08);overflow:hidden">
        <summary style="list-style:auto;cursor:pointer;padding:14px 16px;background:linear-gradient(180deg,#f8fbff 0%,#f1f5f9 100%);color:#0f172a">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding-right:8px">
            <div style="min-width:0">
              <div style="font-size:11px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Memory Entry #${sorted.length - index}</div>
              <div style="margin-top:4px;font-size:15px;font-weight:800;color:#0f172a">T${escHtml(String(entry?.turn || 0))} · ${escHtml(entry?.preview || entry?.episode || 'preview 없음')}</div>
              <div style="margin-top:5px;font-size:11px;color:#64748b">phase ${escHtml(entry?.phase || 'finalize')} · verification ${escHtml(entry?.captureVerification || 'single-stage')} · updated ${escHtml(formatDateTime(entry?.updatedAt || 0))}</div>
              <div style="margin-top:6px;font-size:11px;font-weight:800;color:#2563eb">클릭해서 턴 메모리를 펼치거나 접을 수 있습니다.</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end;padding-top:2px;font-size:11px;font-weight:800;color:#475569;white-space:nowrap">
              <div>imp ${escHtml(String(entry?.importance || 0))} · ttl ${escHtml(String(entry?.ttl || 0))}</div>
              <button type="button" data-dma-action="delete-turn" data-dma-scope="${escHtml(scopeId)}" data-dma-turn="${escHtml(String(entry?.turn || 0))}" style="padding:7px 10px;border-radius:10px;border:1px solid rgba(220,38,38,0.22);background:#fff1f2;color:#be123c;font-size:11px;font-weight:900;cursor:pointer">턴 삭제</button>
            </div>
          </div>
        </summary>
        <div style="padding:14px 16px;max-height:min(58vh,720px);overflow-y:scroll;overflow-x:hidden;scrollbar-width:thin;scrollbar-gutter:stable both-edges;overscroll-behavior:contain;background:#ffffff">
          ${renderViewerTextBlock('Episode', entry?.episode || entry?.preview || '요약 없음')}
          ${renderViewerTextBlock('User', entry?.userText || '기록 없음')}
          ${renderViewerTextBlock('Assistant', entry?.assistantText || entry?.manualText || '기록 없음')}
          ${Array.isArray(entry?.continuityHints) && entry.continuityHints.length ? renderViewerTextBlock('Continuity Hints', entry.continuityHints.map((row) => `- ${row}`).join('\n')) : ''}
          ${Array.isArray(entry?.entityNames) && entry.entityNames.length ? renderViewerTextBlock('Entity Names', entry.entityNames.join(', ')) : ''}
          ${Array.isArray(entry?.locations) && entry.locations.length ? renderViewerTextBlock('Locations', entry.locations.join(' / ')) : ''}
          ${Array.isArray(entry?.moods) && entry.moods.length ? renderViewerTextBlock('Moods', entry.moods.join(' / ')) : ''}
          ${renderViewerTextBlock('Source', [
            entry?.source ? `source=${entry.source}` : '',
            entry?.sourceHint ? `hint=${entry.sourceHint}` : '',
            entry?.latestMessageId ? `latestMessageId=${entry.latestMessageId}` : '',
            Array.isArray(entry?.sourceMessageIds) && entry.sourceMessageIds.length ? `messageIds=${entry.sourceMessageIds.join(', ')}` : '',
            entry?.sourceHash ? `sourceHash=${entry.sourceHash}` : ''
          ].filter(Boolean).join('\n'))}
        </div>
      </details>
    `).join('');
  };

  const buildPreviousEntryViewerHtml = (entries = []) => {
    const sorted = (Array.isArray(entries) ? entries : [])
      .map(normalizePreviousEntry)
      .slice()
      .sort((a, b) => Number(b.toTurn || 0) - Number(a.toTurn || 0) || Number(b.createdAt || 0) - Number(a.createdAt || 0));
    if (!sorted.length) {
      return `<div style="padding:22px;border-radius:16px;border:1px dashed rgba(148,163,184,0.36);background:#ffffff;font-size:13px;color:#64748b;text-align:center">아직 저장된 Previous Entry가 없습니다.</div>`;
    }
    return sorted.map((entry, index) => `
      <details ${index === 0 ? 'open' : ''} style="border:1px solid rgba(148,163,184,0.22);border-radius:16px;background:#ffffff;box-shadow:0 14px 32px rgba(15,23,42,0.08);overflow:hidden">
        <summary style="list-style:auto;cursor:pointer;padding:14px 16px;background:linear-gradient(180deg,#fffdf8 0%,#f8fafc 100%);color:#0f172a">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding-right:8px">
            <div style="min-width:0">
              <div style="font-size:11px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Previous Entry #${sorted.length - index}</div>
              <div style="margin-top:4px;font-size:15px;font-weight:800;color:#0f172a">T${escHtml(String(entry?.fromTurn || 0))}-${escHtml(String(entry?.toTurn || 0))} · ${escHtml(entry?.title || entry?.summary || 'summary 없음')}</div>
              <div style="margin-top:5px;font-size:11px;color:#64748b">updated ${escHtml(formatDateTime(entry?.updatedAt || 0))} · sourceEntries ${escHtml(String((entry?.sourceEntryIds || []).length || 0))}</div>
              <div style="margin-top:6px;font-size:11px;font-weight:800;color:#d97706">클릭해서 턴 묶음 메모리를 펼치거나 접을 수 있습니다.</div>
            </div>
            <div style="padding-top:2px;font-size:11px;font-weight:800;color:#475569;white-space:nowrap">${escHtml(entry?.archiveKey || entry?.id || '')}</div>
          </div>
        </summary>
        <div style="padding:14px 16px;max-height:min(58vh,720px);overflow-y:scroll;overflow-x:hidden;scrollbar-width:thin;scrollbar-gutter:stable both-edges;overscroll-behavior:contain;background:#ffffff">
          ${renderViewerTextBlock('Summary', entry?.summary || '요약 없음')}
          ${renderViewerTextBlock('Content', entry?.content || '본문 없음')}
          ${Array.isArray(entry?.entityNames) && entry.entityNames.length ? renderViewerTextBlock('Entity Names', entry.entityNames.join(', ')) : ''}
          ${Array.isArray(entry?.locations) && entry.locations.length ? renderViewerTextBlock('Locations', entry.locations.join(' / ')) : ''}
          ${Array.isArray(entry?.moods) && entry.moods.length ? renderViewerTextBlock('Moods', entry.moods.join(' / ')) : ''}
          ${Array.isArray(entry?.relationHighlights) && entry.relationHighlights.length ? renderViewerTextBlock('Relation Highlights', entry.relationHighlights.join(' / ')) : ''}
          ${Array.isArray(entry?.sourceEntryIds) && entry.sourceEntryIds.length ? renderViewerTextBlock('Source Entry IDs', entry.sourceEntryIds.join('\n')) : ''}
        </div>
      </details>
    `).join('');
  };

  const buildMemoryViewerHtml = (scopeId = 'global', store = {}, activeTab = 'direct') => {
    const directEntries = Array.isArray(store?.directEntries) ? store.directEntries : [];
    const previousEntries = Array.isArray(store?.previousEntries) ? store.previousEntries : [];
    const tab = String(activeTab || 'direct').trim() === 'previous' ? 'previous' : 'direct';
    return `
      <div data-dma-action="close-viewer" style="position:fixed;inset:0;background:rgba(15,23,42,0.5);backdrop-filter:blur(6px);z-index:2147482400;padding:28px 20px;display:flex;justify-content:center;align-items:flex-start;overflow-y:scroll;overflow-x:hidden;scrollbar-width:thin;scrollbar-gutter:stable both-edges;overscroll-behavior:contain">
        <div data-dma-modal-shell="1" style="width:min(1200px,96vw);margin:auto 0;background:linear-gradient(180deg,#f8fbff 0%,#eef5fb 100%);border:1px solid rgba(191,219,254,0.55);border-radius:24px;box-shadow:0 28px 80px rgba(15,23,42,0.24);overflow:hidden">
          <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:18px 20px 16px;border-bottom:1px solid rgba(226,232,240,0.9);background:rgba(255,255,255,0.78)">
            <div>
              <div style="font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Direct Memory Archive Viewer</div>
              <div style="margin-top:4px;font-size:22px;font-weight:900;color:#0f172a">DMA 전체 메모리 보기</div>
              <div style="margin-top:6px;font-size:12px;line-height:1.6;color:#475569">DMA 메모리는 라이브챗 감사 범위에서 제외되며, 여기서 별도의 라이브챗 턴 정렬/병합을 수동 실행할 수 있습니다.</div>
              <div style="margin-top:8px;font-size:11px;color:#64748b">${escHtml(summarizeStoreCounts(scopeId, store))}</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
              <button type="button" data-dma-action="align-livechat" data-dma-scope="${escHtml(scopeId)}" style="padding:10px 14px;border-radius:12px;border:1px solid rgba(37,99,235,0.24);background:#eff6ff;color:#1d4ed8;font-size:12px;font-weight:800;cursor:pointer">라이브챗 정렬</button>
              <button type="button" data-dma-action="merge-livechat" data-dma-scope="${escHtml(scopeId)}" style="padding:10px 14px;border-radius:12px;border:1px solid rgba(14,116,144,0.24);background:#ecfeff;color:#0f766e;font-size:12px;font-weight:800;cursor:pointer">라이브챗 병합</button>
              <div style="display:flex;gap:6px;align-items:center;padding:4px;border-radius:12px;border:1px solid rgba(220,38,38,0.18);background:#fff7f7">
                <input type="number" min="1" step="1" data-dma-delete-turn-input="1" data-dma-scope="${escHtml(scopeId)}" placeholder="턴" style="width:78px;padding:8px 10px;border-radius:10px;border:1px solid rgba(148,163,184,0.32);background:#ffffff;color:#0f172a;font-size:12px;font-weight:800;outline:none" />
                <button type="button" data-dma-action="delete-turn" data-dma-scope="${escHtml(scopeId)}" style="padding:9px 12px;border-radius:10px;border:1px solid rgba(220,38,38,0.24);background:#fff1f2;color:#be123c;font-size:12px;font-weight:900;cursor:pointer">턴 삭제</button>
              </div>
              <button type="button" data-dma-action="refresh-viewer" data-dma-scope="${escHtml(scopeId)}" data-dma-tab="${escHtml(tab)}" style="padding:10px 14px;border-radius:12px;border:1px solid rgba(148,163,184,0.34);background:#ffffff;color:#334155;font-size:12px;font-weight:800;cursor:pointer">새로고침</button>
              <button type="button" data-dma-action="close-viewer" style="padding:10px 14px;border-radius:12px;border:1px solid rgba(148,163,184,0.34);background:#ffffff;color:#334155;font-size:12px;font-weight:800;cursor:pointer">닫기</button>
            </div>
          </div>
          <div style="padding:16px 20px 20px;display:flex;flex-direction:column;gap:14px;height:min(80vh,1000px);overflow:hidden">
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button type="button" data-dma-action="switch-tab" data-dma-scope="${escHtml(scopeId)}" data-dma-tab="direct" style="padding:10px 14px;border-radius:999px;border:1px solid ${tab === 'direct' ? 'rgba(37,99,235,0.36)' : 'rgba(148,163,184,0.28)'};background:${tab === 'direct' ? '#dbeafe' : '#ffffff'};color:${tab === 'direct' ? '#1d4ed8' : '#334155'};font-size:12px;font-weight:800;cursor:pointer">Memory Entries (${directEntries.length})</button>
              <button type="button" data-dma-action="switch-tab" data-dma-scope="${escHtml(scopeId)}" data-dma-tab="previous" style="padding:10px 14px;border-radius:999px;border:1px solid ${tab === 'previous' ? 'rgba(217,119,6,0.34)' : 'rgba(148,163,184,0.28)'};background:${tab === 'previous' ? '#ffedd5' : '#ffffff'};color:${tab === 'previous' ? '#c2410c' : '#334155'};font-size:12px;font-weight:800;cursor:pointer">Previous Entries (${previousEntries.length})</button>
            </div>
            <div style="padding:0 2px 2px;font-size:11px;color:#64748b">활성 탭: <strong style="color:#0f172a">${escHtml(tab === 'direct' ? 'Memory Entries' : 'Previous Entries')}</strong></div>
            <div style="flex:1;overflow-y:scroll;overflow-x:hidden;scrollbar-width:thin;scrollbar-gutter:stable both-edges;overscroll-behavior:contain;padding-right:2px;display:flex;flex-direction:column;gap:14px">
              ${tab === 'direct' ? buildDirectEntryViewerHtml(directEntries, scopeId) : buildPreviousEntryViewerHtml(previousEntries)}
            </div>
          </div>
        </div>
      </div>
    `;
  };

  const closeMemoryViewer = () => {
    try {
      if (dmaMemoryModalRoot?.parentNode) {
        dmaMemoryModalRoot.parentNode.removeChild(dmaMemoryModalRoot);
      }
    } catch (_) {}
    dmaMemoryModalRoot = null;
  };

  const openMemoryViewer = async (scopeId = 'global', tab = 'direct') => {
    if (typeof document === 'undefined') return false;
    const requestedScopeId = String(scopeId || runtimeState.activeScopeId || 'global').trim() || 'global';
    const visible = await loadScopedVisibleStore({}, requestedScopeId);
    const key = visible.scopeId;
    const store = visible.store;
    dmaViewerState.scopeId = key;
    dmaViewerState.tab = String(tab || 'direct').trim() === 'previous' ? 'previous' : 'direct';
    if (!dmaMemoryModalRoot) {
      dmaMemoryModalRoot = document.createElement('div');
      dmaMemoryModalRoot.setAttribute('data-libra-dma-memory-modal', '1');
      document.body.appendChild(dmaMemoryModalRoot);
    }
    dmaMemoryModalRoot.innerHTML = buildMemoryViewerHtml(key, store, dmaViewerState.tab);
    updateRuntimeStatus('memory viewer opened', {
      activeChatId: key,
      preview: `${dmaViewerState.tab === 'previous' ? 'Previous Entries' : 'Memory Entries'} viewer opened for scope ${key}.`
    });
    return {
      ok: true,
      opened: true,
      scopeId: key,
      tab: dmaViewerState.tab
    };
  };

  const syncPanelValues = () => {
    if (typeof document === 'undefined') return;
    const summary = summarizeStoreCounts(runtimeState.activeScopeId || 'global');
    document.querySelectorAll('[data-dma-status]').forEach((node) => {
      node.textContent = runtimeState.lastStatus || 'idle';
    });
    document.querySelectorAll('[data-dma-summary]').forEach((node) => {
      node.textContent = summary;
    });
    document.querySelectorAll('[data-dma-preview]').forEach((node) => {
      node.textContent = runtimeState.lastPreview || 'DMA는 레거시 메모리와 분리된 병렬 메모리 층으로 동작합니다.';
    });
  };

  const bindPanelHandlers = () => {
    if (panelHandlersBound || typeof document === 'undefined') return;
    dmaPanelClickHandler = async (event) => {
      const target = event?.target;
      if (!target || typeof target.closest !== 'function') return;
      const actionNode = target.closest('[data-dma-action]');
      if (!actionNode) return;
      const action = String(actionNode.getAttribute('data-dma-action') || '').trim();
      const scopeId = String(actionNode.getAttribute('data-dma-scope') || dmaViewerState.scopeId || runtimeState.activeScopeId || 'global').trim() || 'global';
      if (action === 'close-viewer') {
        const tagName = String(actionNode?.tagName || '').toUpperCase();
        if (tagName !== 'BUTTON' && target.closest('[data-dma-modal-shell]')) return;
      }
      event?.preventDefault?.();
      event?.stopPropagation?.();
      if (action === 'open-viewer') {
        const tab = String(actionNode.getAttribute('data-dma-tab') || 'direct').trim();
        await openMemoryViewer(scopeId, tab);
        return;
      }
      if (action === 'refresh-viewer') {
        const tab = String(actionNode.getAttribute('data-dma-tab') || dmaViewerState.tab || 'direct').trim();
        await openMemoryViewer(scopeId, tab);
        return;
      }
      if (action === 'switch-tab') {
        const tab = String(actionNode.getAttribute('data-dma-tab') || 'direct').trim();
        await openMemoryViewer(scopeId, tab);
        return;
      }
      if (action === 'close-viewer') {
        closeMemoryViewer();
        return;
      }
      if (action === 'align-livechat') {
        updateRuntimeStatus('livechat turn sort running', {
          preview: 'DMA 메모리를 현재 라이브챗 턴 순서에 맞춰 정렬 중입니다.'
        });
        await runLiveChatTurnAlignmentForScope({ scopeId });
        if (dmaMemoryModalRoot) await openMemoryViewer(scopeId, dmaViewerState.tab || 'direct');
        return;
      }
      if (action === 'merge-livechat') {
        updateRuntimeStatus('livechat turn merge running', {
          preview: 'DMA 메모리를 라이브챗 턴 기준으로 병합 중입니다.'
        });
        await runLiveChatTurnMergeForScope({ scopeId });
        if (dmaMemoryModalRoot) await openMemoryViewer(scopeId, dmaViewerState.tab || 'direct');
        return;
      }
      if (action === 'delete-turn') {
        const shell = actionNode.closest('[data-dma-modal-shell]');
        const input = shell?.querySelector?.('[data-dma-delete-turn-input]');
        const turn = Math.max(0, Number(actionNode.getAttribute('data-dma-turn') || input?.value || 0));
        if (!turn) {
          showDmaNotice('삭제할 DMA 턴 번호를 입력해 주세요.');
          return;
        }
        const ok = await confirmDmaAction(`DMA scope ${scopeId}에서 T${turn} 메모리를 실제 삭제합니다. 이 턴은 삭제 tombstone 때문에 자동 복구되지 않습니다. 진행할까요?`);
        if (!ok) return;
        updateRuntimeStatus('turn delete running', {
          activeChatId: scopeId,
          preview: `DMA T${turn} 삭제 중입니다.`
        });
        const result = await deleteDmaTurnFromScope({ scopeId, turn, reason: 'manual-viewer-delete' });
        if (!result?.ok) {
          showDmaNotice(`DMA 턴 삭제 실패: ${result?.reason || 'unknown'}`);
          return;
        }
        if (dmaMemoryModalRoot) await openMemoryViewer(scopeId, dmaViewerState.tab || 'direct');
      }
    };
    document.addEventListener('click', dmaPanelClickHandler, true);
    panelHandlersBound = true;
  };

  const renderQuickControlPanel = async (context = {}) => {
    const resolved = await resolveContextScope(context);
    const visible = await loadScopedVisibleStore({ ...context, chat: resolved.chat, char: resolved.char }, resolved.scopeId);
    const store = visible.store;
    const panelScopeId = visible.scopeId;
    bindPanelHandlers();
    const directCount = Array.isArray(store?.directEntries) ? store.directEntries.length : 0;
    const previousCount = Array.isArray(store?.previousEntries) ? store.previousEntries.length : 0;
    const pendingCount = Array.isArray(store?.pendingCaptures) ? store.pendingCaptures.length : 0;
    const repairCount = Array.isArray(store?.repairQueue) ? store.repairQueue.length : 0;
    return {
      key: `${PLUGIN_ID}:quick`,
      name: 'DMA 메모리',
      order: 54,
      html: `
        <div class="scope-block" style="padding:12px;border:1px solid rgba(148,163,184,0.28);border-radius:12px;background:linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.95));box-shadow:0 14px 34px rgba(15,23,42,0.08)">
          <div style="font-size:15px;font-weight:800;color:#0f172a">Direct Memory Archive</div>
          <div style="margin-top:6px;font-size:12px;color:#475569;line-height:1.6">DMA 메모리는 레거시 lore memory와 별개로 유지되는 병렬 메모리 층입니다. 라이브챗 감사의 감시/보정 범위에는 포함되지 않으며, 이 패널에서 전용 라이브챗 턴 정렬과 병합을 수동 실행할 수 있습니다.</div>
          <div style="margin-top:10px;font-size:12px;font-weight:700;color:#2563eb" data-dma-status>${escHtml(runtimeState.lastStatus || 'idle')}</div>
          <div style="margin-top:4px;font-size:11px;color:#64748b" data-dma-summary>${escHtml(summarizeStoreCounts(panelScopeId, store))}</div>
          <div style="margin-top:12px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
            <div style="padding:10px 12px;border-radius:12px;background:#ffffff;border:1px solid rgba(148,163,184,0.22)">
              <div style="font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Memory Entries</div>
              <div style="margin-top:4px;font-size:18px;font-weight:900;color:#0f172a">${directCount}</div>
              <div style="margin-top:3px;font-size:11px;color:#64748b">직접 캡처된 DMA 메모리</div>
            </div>
            <div style="padding:10px 12px;border-radius:12px;background:#ffffff;border:1px solid rgba(148,163,184,0.22)">
              <div style="font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Previous Entries</div>
              <div style="margin-top:4px;font-size:18px;font-weight:900;color:#0f172a">${previousCount}</div>
              <div style="margin-top:3px;font-size:11px;color:#64748b">이전 턴 요약 아카이브</div>
            </div>
            <div style="padding:10px 12px;border-radius:12px;background:#ffffff;border:1px solid rgba(148,163,184,0.22)">
              <div style="font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Pending</div>
              <div style="margin-top:4px;font-size:18px;font-weight:900;color:#0f172a">${pendingCount}</div>
              <div style="margin-top:3px;font-size:11px;color:#64748b">캡처 대기 중인 stage</div>
            </div>
            <div style="padding:10px 12px;border-radius:12px;background:#ffffff;border:1px solid rgba(148,163,184,0.22)">
              <div style="font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Repair Queue</div>
              <div style="margin-top:4px;font-size:18px;font-weight:900;color:#0f172a">${repairCount}</div>
              <div style="margin-top:3px;font-size:11px;color:#64748b">스토어 복구 제안</div>
            </div>
          </div>
          <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" data-dma-action="open-viewer" data-dma-scope="${escHtml(panelScopeId)}" data-dma-tab="direct" style="padding:10px 16px;border-radius:10px;border:1px solid rgba(148,163,184,0.3);background:#ffffff;color:#334155;font-weight:700;cursor:pointer">전체 메모리 보기</button>
            <button type="button" data-dma-action="align-livechat" data-dma-scope="${escHtml(panelScopeId)}" style="padding:10px 16px;border-radius:10px;border:1px solid rgba(37,99,235,0.24);background:#eff6ff;color:#1d4ed8;font-weight:700;cursor:pointer">라이브챗 정렬</button>
            <button type="button" data-dma-action="merge-livechat" data-dma-scope="${escHtml(panelScopeId)}" style="padding:10px 16px;border-radius:10px;border:1px solid rgba(14,116,144,0.24);background:#ecfeff;color:#0f766e;font-weight:700;cursor:pointer">라이브챗 병합</button>
          </div>
          <div style="margin-top:12px;padding:10px;border-radius:10px;background:rgba(226,232,240,0.78);font-size:11px;line-height:1.6;color:#334155;white-space:pre-wrap;border:1px solid rgba(148,163,184,0.24)" data-dma-preview>${escHtml(runtimeState.lastPreview || 'DMA는 레거시 메모리와 분리된 병렬 메모리 층입니다. Memory Entry와 Previous Entry는 팝업에서 별도 탭으로 확인할 수 있습니다.')}</div>
        </div>
      `
    };
  };

  const renderInspectorPanel = async (context = {}) => {
    const resolved = await resolveContextScope(context);
    const visible = await loadScopedVisibleStore({ ...context, chat: resolved.chat, char: resolved.char }, resolved.scopeId);
    const store = visible.store;
    const panelScopeId = visible.scopeId;
    const latestDirect = Array.isArray(store?.directEntries) && store.directEntries.length
      ? normalizeDirectEntry(store.directEntries[store.directEntries.length - 1])
      : null;
    const latestPrevious = Array.isArray(store?.previousEntries) && store.previousEntries.length
      ? normalizePreviousEntry(store.previousEntries[store.previousEntries.length - 1])
      : null;
    return {
      key: `${PLUGIN_ID}:inspector`,
      name: 'DMA Inspector',
      order: 54,
      html: `
        <div style="padding:10px;border:1px solid rgba(255,255,255,0.08);border-radius:10px;background:rgba(255,255,255,0.03)">
          <div style="font-size:13px;font-weight:800;color:#f1f7ff">Direct Memory Archive Inspector</div>
          <div style="margin-top:6px;font-size:11px;color:rgba(190,214,236,0.82)">scope=${escHtml(panelScopeId)} · direct=${Array.isArray(store?.directEntries) ? store.directEntries.length : 0} · previous=${Array.isArray(store?.previousEntries) ? store.previousEntries.length : 0} · pending=${Array.isArray(store?.pendingCaptures) ? store.pendingCaptures.length : 0}</div>
          ${latestDirect ? `<div style="margin-top:10px;padding:10px;border:1px solid rgba(255,255,255,0.06);border-radius:10px;background:rgba(255,255,255,0.025)">
            <div style="font-size:11px;font-weight:800;color:#e9f3ff">Latest Memory Entry · T${escHtml(String(latestDirect.turn || 0))}</div>
            <div style="margin-top:4px;font-size:12px;color:rgba(231,239,250,0.92);line-height:1.65">${escHtml(latestDirect.preview || latestDirect.episode || 'preview 없음')}</div>
          </div>` : '<div style="margin-top:10px;font-size:12px;color:rgba(231,239,250,0.82)">최근 Memory Entry가 없습니다.</div>'}
          ${latestPrevious ? `<div style="margin-top:10px;padding:10px;border:1px solid rgba(255,255,255,0.06);border-radius:10px;background:rgba(255,255,255,0.025)">
            <div style="font-size:11px;font-weight:800;color:#e9f3ff">Latest Previous Entry · T${escHtml(String(latestPrevious.fromTurn || 0))}-${escHtml(String(latestPrevious.toTurn || 0))}</div>
            <div style="margin-top:4px;font-size:12px;color:rgba(231,239,250,0.92);line-height:1.65">${escHtml(latestPrevious.summary || latestPrevious.title || 'summary 없음')}</div>
          </div>` : '<div style="margin-top:10px;font-size:12px;color:rgba(231,239,250,0.82)">최근 Previous Entry가 없습니다.</div>'}
        </div>
      `
    };
  };

  const bindGlobalApi = () => {
    const buildEmptyStore = (scopeId = 'global') => ({
      scopeId,
      directEntries: [],
      previousEntries: [],
      pendingCaptures: [],
      repairQueue: [],
      deletedTurns: []
    });

    const cloneStoreForScope = (store, scopeId = 'global') =>
      cloneValue(store, buildEmptyStore(scopeId));

    const normalizeEvidenceEntryForApi = (entry = {}, evidenceType = 'direct', scopeId = 'global') => {
      const type = String(evidenceType || 'direct');
      const sourceMessageIds = uniqueTexts(entry?.sourceMessageIds || entry?.messageIds || [entry?.m_id, entry?.latestMessageId], 12);
      const turn = Number(entry?.turn || entry?.finalizedTurn || entry?.predictedTurn || entry?.fromTurn || entry?.toTurn || 0);
      const locations = uniqueTexts(entry?.locations || entry?.location ? [entry?.location, ...(entry?.locations || [])] : [], 4);
      const participants = uniqueTexts([
        ...(entry?.participants || []),
        ...(entry?.entityNames || []),
        ...(entry?.actors || [])
      ], 12);
      return {
        id: String(entry?.id || entry?.memoryId || entry?.pendingId || `${scopeId}:${type}:${turn}:${sourceMessageIds[0] || ''}`),
        turn,
        fromTurn: Number(entry?.fromTurn || turn || 0),
        toTurn: Number(entry?.toTurn || turn || 0),
        sceneId: String(entry?.sceneId || entry?.sceneKey || entry?.scene || ''),
        scopeId: String(entry?.scopeId || scopeId || 'global'),
        createdAt: Number(entry?.createdAt || 0) || 0,
        sceneTime: String(entry?.sceneTime || entry?.timeState || ''),
        fuzzyTime: String(entry?.fuzzyTime || entry?.timeHint || ''),
        participants,
        location: locations[0] || '',
        sourceMessageIds,
        confidence: clampNumber(entry?.confidence, type === 'direct' ? 0.92 : 0.72, 0, 1),
        evidenceType: type,
        preview: compactText(entry?.preview || entry?.summary || entry?.episode || entry?.text || '', 260),
        raw: cloneValue(entry, {})
      };
    };

    const buildEvidenceBundleFromStore = (store = {}, options = {}) => {
      const scopeId = String(store?.scopeId || resolveOptionsScopeId(options) || 'global');
      const directLimit = Math.max(1, Number(options?.directLimit || options?.limit || CONFIG.directPromptLimit));
      const previousLimit = Math.max(1, Number(options?.previousLimit || CONFIG.previousPromptLimit));
      const pendingLimit = Math.max(1, Number(options?.pendingLimit || CONFIG.qnaDirectLimit));
      const repairLimit = Math.max(1, Number(options?.repairLimit || CONFIG.qnaPreviousLimit));
      const direct = (Array.isArray(store?.directEntries) ? store.directEntries : [])
        .slice(-directLimit)
        .map(entry => normalizeEvidenceEntryForApi(entry, 'direct', scopeId));
      const previous = (Array.isArray(store?.previousEntries) ? store.previousEntries : [])
        .slice(-previousLimit)
        .map(entry => normalizeEvidenceEntryForApi(entry, 'previous', scopeId));
      const pending = (Array.isArray(store?.pendingCaptures) ? store.pendingCaptures : [])
        .slice(-pendingLimit)
        .map(entry => normalizeEvidenceEntryForApi(entry, 'pending', scopeId));
      const repair = (Array.isArray(store?.repairQueue) ? store.repairQueue : [])
        .slice(-repairLimit)
        .map(entry => normalizeEvidenceEntryForApi(entry, 'repair', scopeId));
      return {
        scopeId,
        memoryLayerId: 'dma',
        replacesLegacyMemory: false,
        coexistsWithLegacyMemory: true,
        directEntries: direct,
        previousEntries: previous,
        pendingCaptures: pending,
        repairQueue: repair,
        direct,
        previous,
        pending,
        repair,
        sourceMessageIds: uniqueTexts([...direct, ...previous, ...pending].flatMap(entry => entry.sourceMessageIds || []), 128),
        evidenceRefs: [...direct, ...previous, ...pending, ...repair].map(entry => ({
          id: entry.id,
          turn: entry.turn,
          sceneId: entry.sceneId,
          sourceMessageIds: entry.sourceMessageIds,
          confidence: entry.confidence,
          evidenceType: entry.evidenceType
        })),
        counts: {
          directEntries: Array.isArray(store?.directEntries) ? store.directEntries.length : 0,
          previousEntries: Array.isArray(store?.previousEntries) ? store.previousEntries.length : 0,
          pendingCaptures: Array.isArray(store?.pendingCaptures) ? store.pendingCaptures.length : 0,
          repairQueue: Array.isArray(store?.repairQueue) ? store.repairQueue.length : 0
        },
        stats: {
          directCount: Array.isArray(store?.directEntries) ? store.directEntries.length : 0,
          previousCount: Array.isArray(store?.previousEntries) ? store.previousEntries.length : 0,
          pendingCount: Array.isArray(store?.pendingCaptures) ? store.pendingCaptures.length : 0,
          repairQueueCount: Array.isArray(store?.repairQueue) ? store.repairQueue.length : 0
        },
        degraded: false,
        errors: []
      };
    };

    const loadVisibleStoreForOptions = async (options = {}) => {
      const scopeId = resolveOptionsScopeId(options);
      const context = options?.context && typeof options.context === 'object'
        ? { ...options.context, scopeId: options?.scopeId || options.context.scopeId || scopeId }
        : (options && typeof options === 'object' ? { ...options, scopeId } : { scopeId });
      const visible = await loadScopedVisibleStore(context, scopeId);
      return {
        scopeId: visible?.scopeId || scopeId,
        store: visible?.store || await loadStore(scopeId)
      };
    };

    const publicApi = {
      version: '0.6.0',
      access: 'rw-evidence-api',
      replacesLegacyMemory: false,
      coexistsWithLegacyMemory: true,
      separateMemoryLayer: true,
      memoryLayerId: 'dma',
      memoryLayerMode: 'parallel',
      legacyMemoryMode: 'coexist',
      excludeFromLiveChatAudit: true,
      liveChatAuditIsolation: 'excluded',
      ownsLiveChatTurnAlignment: true,
      loadStore: async (options = {}) => {
        const visible = await loadVisibleStoreForOptions(options);
        return cloneStoreForScope(visible.store, visible.scopeId);
      },
      getStore: async (options = {}) => {
        const visible = await loadVisibleStoreForOptions(options);
        return cloneStoreForScope(visible.store, visible.scopeId);
      },
      peekStore: (options = {}) => {
        const scopeId = resolveOptionsScopeId(options);
        return cloneStoreForScope(peekStore(scopeId), scopeId);
      },
      exportStore: async (options = {}) => {
        const visible = await loadVisibleStoreForOptions(options);
        return cloneStoreForScope(visible.store, visible.scopeId);
      },
      importStore: async (options = {}) => importStore(options),
      importFromCopiedChat: async (options = {}) => {
        const targetScopeId = normalizeText(options?.targetScopeId || options?.scopeId || options?.chat?.id || runtimeState.activeScopeId || 'global') || 'global';
        const sourceScopeId = normalizeText(options?.sourceScopeId || options?.copiedFromScopeId || options?.sourceChatId || options?.copiedFromChatId || '');
        return importStoreFromCopiedChatIfNeeded({
          ...options,
          scopeId: targetScopeId,
          copiedFromScopeId: sourceScopeId,
          sourceScopeId
        }, targetScopeId);
      },
      getRepairQueue: async (options = {}) => {
        const scopeId = resolveOptionsScopeId(options);
        const store = await loadStore(scopeId);
        return cloneValue(Array.isArray(store?.repairQueue) ? store.repairQueue : [], []);
      },
      getPendingCaptures: async (options = {}) => {
        const scopeId = resolveOptionsScopeId(options);
        const store = await loadStore(scopeId);
        const limit = Math.max(1, Number(options?.limit || CONFIG.qnaDirectLimit));
        return cloneValue((Array.isArray(store?.pendingCaptures) ? store.pendingCaptures : []).slice(-limit), []);
      },
      enqueueRepair: async (options = {}) => {
        const scopeId = resolveOptionsScopeId(options);
        const store = await loadStore(scopeId);
        const repairs = Array.isArray(options?.repairs) ? options.repairs : [options?.item || options?.repair].filter(Boolean);
        enqueueRepairItems(store, repairs);
        trimStore(store);
        await commitStore(scopeId, store);
        return {
          pending: Array.isArray(store?.repairQueue) ? store.repairQueue.length : 0,
          repairs: cloneValue(Array.isArray(store?.repairQueue) ? store.repairQueue : [], [])
        };
      },
      inspectRepairs: async (options = {}) => {
        const visible = await loadVisibleStoreForOptions(options);
        const scopeId = visible.scopeId;
        const store = visible.store;
        return cloneValue(inspectRepairNeedsFromStore(store, { ...options, scopeId }), []);
      },
      getDirectEntries: async (options = {}) => {
        const visible = await loadVisibleStoreForOptions(options);
        const store = visible.store;
        const limit = Math.max(1, Number(options?.limit || CONFIG.qnaDirectLimit));
        return cloneValue((Array.isArray(store?.directEntries) ? store.directEntries : []).slice(-limit), []);
      },
      getPreviousEntries: async (options = {}) => {
        const visible = await loadVisibleStoreForOptions(options);
        const store = visible.store;
        const limit = Math.max(1, Number(options?.limit || CONFIG.qnaPreviousLimit));
        return cloneValue((Array.isArray(store?.previousEntries) ? store.previousEntries : []).slice(-limit), []);
      },
      formatPreviousMemoriesWithEvidence,
      buildPreviousSummaryPrompt: async (options = {}) => {
        const visible = await loadVisibleStoreForOptions(options);
        return buildPreviousSummaryPromptFromStore(visible.store, options?.limit);
      },
      buildDirectMemoryPrompt: async (options = {}) => {
        const visible = await loadVisibleStoreForOptions(options);
        return buildRecentDirectPromptFromStore(visible.store, options?.limit);
      },
      buildQnaMemoryBundle: async (options = {}) => {
        const visible = await loadVisibleStoreForOptions(options);
        return cloneValue(buildQnaMemoryBundleFromStore(visible.store, options), { text: '', highlights: [] });
      },
      getEvidenceBundle: async (options = {}) => {
        const visible = await loadVisibleStoreForOptions(options);
        const scopeId = visible.scopeId;
        try {
          return cloneValue(buildEvidenceBundleFromStore(visible.store, { ...options, scopeId }), null);
        } catch (error) {
          const message = normalizeText(error?.message || error || 'dma_evidence_bundle_failed');
          runtimeState.lastError = message;
          return {
            scopeId,
            directEntries: [],
            previousEntries: [],
            pendingCaptures: [],
            repairQueue: [],
            direct: [],
            previous: [],
            pending: [],
            repair: [],
            sourceMessageIds: [],
            evidenceRefs: [],
            counts: {
              directEntries: 0,
              previousEntries: 0,
              pendingCaptures: 0,
              repairQueue: 0
            },
            stats: {
              directCount: 0,
              previousCount: 0,
              pendingCount: 0,
              repairQueueCount: 0
            },
            degraded: true,
            errors: [compactText(message, 240)]
          };
        }
      },
      captureTurn: async (context = {}, phase = 'afterRequest') => capturePendingDirectMemory(context, phase),
      deleteTurn: async (options = {}) => deleteDmaTurnFromScope(options),
      deleteDmaTurn: async (options = {}) => deleteDmaTurnFromScope(options),
      openMemoryViewer: async (options = {}) => {
        const scopeId = resolveOptionsScopeId(options);
        const tab = String(options?.tab || 'direct').trim() === 'previous' ? 'previous' : 'direct';
        return openMemoryViewer(scopeId, tab);
      },
      alignToLiveChatTurns: async (options = {}) => runLiveChatTurnAlignmentForScope(options),
      alignWithRuntime: async (scopeId = 'global', context = {}) => runLiveChatTurnAlignmentForScope({
        ...(context && typeof context === 'object' ? context : {}),
        scopeId: typeof scopeId === 'string' ? scopeId : resolveOptionsScopeId(scopeId)
      }),
      mergeByLiveChatTurns: async (options = {}) => runLiveChatTurnMergeForScope(options),
      archiveNow: async (options = {}) => {
        const scopeId = resolveOptionsScopeId(options);
        const store = await loadStore(scopeId);
        mergeStoreDirectEntriesByTurn(store);
        archiveHistoricalDirectEntries(store, Math.max(0, Number(options?.currentTurn || options?.turn || 0)), options?.context || options);
        trimStore(store);
        await commitStore(scopeId, store);
        return cloneStoreForScope(store, scopeId);
      },
      getRuntimeState: () => cloneValue(runtimeState, {}),
      getRuntimeStatus: () => cloneValue(runtimeState, {}),
      cleanup: async () => extension?.cleanup?.(),
      selfCheck: async () => ({
        ok: true,
        api: 'LIBRA_DirectMemoryArchiveAPI',
        methods: ['getEvidenceBundle', 'getDirectEntries', 'getPreviousEntries', 'getPendingCaptures', 'getRuntimeStatus', 'captureTurn', 'deleteTurn', 'archiveNow', 'cleanup'],
        runtime: cloneValue(runtimeState, {})
      }),
      buildCoreMemorySnapshot: async (options = {}) => {
        const scopeId = resolveOptionsScopeId(options);
        const store = await loadStore(scopeId);
        return cloneValue(await buildCoreMemorySnapshotFromStore(store, { ...options, scopeId }), null);
      },
      buildCoreMemorySnapshotSync: (options = {}) => {
        const scopeId = resolveOptionsScopeId(options);
        const store = peekStore(scopeId);
        return cloneValue(buildCoreMemorySnapshotSyncFromStore(store, { ...options, scopeId }), null);
      },
      getProcessedMessageIdsSync: (options = {}) => {
        const scopeId = resolveOptionsScopeId(options);
        return Array.from(getProcessedMessageIdsFromStore(peekStore(scopeId)));
      },
      getProcessedSourceHashesSync: (options = {}) => {
        const scopeId = resolveOptionsScopeId(options);
        return Array.from(getProcessedSourceHashesFromStore(peekStore(scopeId)));
      }
    };

    const adminApi = {
      ...publicApi,
      access: 'admin',
      replaceStore: async (options = {}) => {
        const scopeId = resolveOptionsScopeId(options);
        return cloneStoreForScope(
          await commitStore(scopeId, normalizeStore(options?.store || {}, scopeId)),
          scopeId
        );
      },
      clearStore: async (options = {}) => {
        const scopeId = resolveOptionsScopeId(options);
        return cloneStoreForScope(
          await commitStore(scopeId, normalizeStore(buildEmptyStore(scopeId), scopeId)),
          scopeId
        );
      },
      enqueueRepairs: async (options = {}) => {
        const scopeId = resolveOptionsScopeId(options);
        const store = await loadStore(scopeId);
        const beforeKeys = new Set(
          (Array.isArray(store?.repairQueue) ? store.repairQueue : [])
            .map(normalizeRepairItem)
            .map(buildRepairIdentityKey)
        );
        const repairs = Array.isArray(options?.repairs) ? options.repairs : [];
        enqueueRepairItems(store, repairs);
        trimStore(store);
        await commitStore(scopeId, store);
        const queued = (Array.isArray(store?.repairQueue) ? store.repairQueue : [])
          .map(normalizeRepairItem)
          .filter(repair => !beforeKeys.has(buildRepairIdentityKey(repair)))
          .length;
        return {
          queued,
          pending: Array.isArray(store?.repairQueue) ? store.repairQueue.length : 0,
          repairs: cloneValue(Array.isArray(store?.repairQueue) ? store.repairQueue : [], [])
        };
      },
      applyRepairQueue: async (options = {}) => {
        const scopeId = resolveOptionsScopeId(options);
        const store = await loadStore(scopeId);
        const result = applyRepairQueueToStore(store, options);
        await commitStore(scopeId, store);
        return {
          ...result,
          store: cloneStoreForScope(store, scopeId)
        };
      },
      clearRepairQueue: async (options = {}) => {
        const scopeId = resolveOptionsScopeId(options);
        const store = await loadStore(scopeId);
        store.repairQueue = [];
        await commitStore(scopeId, store);
        return {
          pending: 0,
          store: cloneStoreForScope(store, scopeId)
        };
      },
      importStore: async (options = {}) => importStore(options),
      appendMemory: async (options = {}) => appendMemory(options)
    };

    globalThis.LIBRA_DirectMemoryArchiveAPI = publicApi;
    globalThis.LIBRA_DirectMemoryArchive = publicApi;
    globalThis.LIBRA = globalThis.LIBRA || {};
    globalThis.LIBRA.DirectMemoryArchive = publicApi;
    try {
      const binder = globalThis?.__LIBRA_BIND_DIRECT_MEMORY_ADMIN_API__;
      if (typeof binder === 'function') binder(adminApi);
    } catch (_) {}
  };

  const capturePendingDirectMemory = async (context = {}, phase = 'afterRequest') => {
    const scopeId = resolveScopeId(context);
    const pendingCapture = buildPendingCaptureFromContext(context, phase);
    if (!pendingCapture) return 0;
    await importStoreFromCopiedChatIfNeeded(context, scopeId);
    const store = await loadStore(scopeId);
    const result = upsertPendingCapture(store, pendingCapture);
    trimStore(store);
    await commitStore(scopeId, store);
    updateRuntimeStatus(`captured ${phase}`, {
      phase,
      activeChatId: scopeId,
      directEntries: store.directEntries.length,
      previousEntries: store.previousEntries.length,
      pendingCaptures: Array.isArray(store.pendingCaptures) ? store.pendingCaptures.length : 0,
      repairQueue: Array.isArray(store.repairQueue) ? store.repairQueue.length : 0
    });
    return result?.changed ? 1 : 0;
  };

  const finalizeDirectMemoryCapture = async (context = {}, phase = 'finalize') => {
    const scopeId = resolveScopeId(context);
    await importStoreFromCopiedChatIfNeeded(context, scopeId);
    const store = await loadStore(scopeId);
    const staged = buildPendingCaptureFromContext(context, phase);
    let pending = null;
    if (staged) {
      const result = upsertPendingCapture(store, staged);
      pending = result?.entry || staged;
    }
    if (!pending) {
      const fallbackIndex = findPendingCaptureIndex(store, {
        signature: normalizeText(context?.signature || ''),
        latestMessageId: normalizeText(context?.latestMessageId || ''),
        sourceHash: normalizeText(context?.sourceHash || '')
      });
      pending = fallbackIndex >= 0 ? store.pendingCaptures[fallbackIndex] : null;
    }
    if (!pending) return 0;
    const directEntry = buildCommittedEntryFromPending(pending, context, phase);
    if (!directEntry) return 0;
    const result = upsertDirectEntry(store, directEntry);
    store.pendingCaptures = (Array.isArray(store?.pendingCaptures) ? store.pendingCaptures : [])
      .filter(entry => String(entry?.id || '') !== String(pending?.id || ''));
    const autoMerged = mergeStoreDirectEntriesByTurn(store);
    archiveHistoricalDirectEntries(store, Math.max(0, Number(directEntry?.turn || context?.turn || 0)), context);
    trimStore(store);
    await commitStore(scopeId, store);
    updateRuntimeStatus(`captured ${phase}`, {
      phase,
      activeChatId: scopeId,
      directEntries: store.directEntries.length,
      previousEntries: store.previousEntries.length,
      pendingCaptures: Array.isArray(store.pendingCaptures) ? store.pendingCaptures.length : 0,
      repairQueue: Array.isArray(store.repairQueue) ? store.repairQueue.length : 0,
      directMerged: autoMerged.mergedAway
    });
    return result?.changed ? 1 : 0;
  };

  const extension = {
    id: PLUGIN_ID,
    name: PLUGIN_NAME,
    version: '0.6.0',
    async onLibraReady(context = {}) {
      const scopeId = resolveScopeId(context);
      bindGlobalApi();
      bindPanelHandlers();
      const store = await loadStore(scopeId);
      const autoMerged = mergeStoreDirectEntriesByTurn(store);
      if (autoMerged.mergedAway > 0) {
        trimStore(store);
        await commitStore(scopeId, store);
      }
      runtimeState.lastDirectCount = Array.isArray(store?.directEntries) ? store.directEntries.length : 0;
      runtimeState.lastPreviousCount = Array.isArray(store?.previousEntries) ? store.previousEntries.length : 0;
      runtimeState.lastPendingCount = Array.isArray(store?.pendingCaptures) ? store.pendingCaptures.length : 0;
      runtimeState.lastRepairQueueCount = Array.isArray(store?.repairQueue) ? store.repairQueue.length : 0;
      updateRuntimeStatus('ready', {
        activeChatId: scopeId,
        directEntries: runtimeState.lastDirectCount,
        previousEntries: runtimeState.lastPreviousCount,
        pendingCaptures: runtimeState.lastPendingCount,
        repairQueue: runtimeState.lastRepairQueueCount,
        directMerged: autoMerged.mergedAway,
        preview: autoMerged.mergedAway > 0
          ? `DMA 런타임 준비 완료. 같은 턴 direct memory ${autoMerged.mergedAway}건을 자동 병합했습니다.`
          : 'DMA 런타임 준비 완료. 라이브챗 감사와 분리된 병렬 메모리 레이어로 동작합니다.'
      });
      try { console.log('[LIBRA SubPlugin: Direct Memory Archive] ready'); } catch (_) {}
    },
    async beforeRequestResponse(context = {}) {
      if (context?.allowMemoryCapture === false) return 0;
      return capturePendingDirectMemory(context, 'beforeRequestResponse');
    },
    async afterRequest(context = {}) {
      if (context?.allowMemoryCapture === false) return 0;
      return capturePendingDirectMemory(context, 'afterRequest');
    },
    async onRecovery(context = {}) {
      if (context?.allowMemoryCapture === false) return 0;
      return finalizeDirectMemoryCapture(context, 'recovery');
    },
    async onFinalize(context = {}) {
      if (context?.allowMemoryCapture === false) return 0;
      return finalizeDirectMemoryCapture(context, 'finalize');
    },
    async promptInjector(context = {}) {
      if (getMemoryEngine()) return null;
      const scopeId = resolveScopeId(context);
      const store = await loadStore(scopeId);
      const directText = buildRecentDirectPromptFromStore(store, CONFIG.directPromptLimit);
      const previousText = buildPreviousSummaryPromptFromStore(store, CONFIG.previousPromptLimit);
      const text = [directText, previousText].filter(Boolean).join('\n\n').trim();
      if (!text) return null;
      return {
        key: `${PLUGIN_ID}:memory`,
        label: 'directMemoryArchive',
        priority: 'conditional',
        mustInclude: false,
        relevance: 0.9,
        weightBoost: 0.18,
        text
      };
    },
    async quickControlPanel(context = {}) {
      return renderQuickControlPanel(context);
    },
    async inspectorPanel(context = {}) {
      return renderInspectorPanel(context);
    },
    async cleanup() {
      await flushAllStoreSaves();
      try {
        if (typeof document !== 'undefined' && panelHandlersBound && dmaPanelClickHandler) {
          document.removeEventListener('click', dmaPanelClickHandler, true);
        }
      } catch (_) {}
      closeMemoryViewer();
      panelHandlersBound = false;
      dmaPanelClickHandler = null;
      try { delete globalThis.LIBRA_DirectMemoryArchiveAPI; } catch (_) {}
      try { delete globalThis.LIBRA_DirectMemoryArchive; } catch (_) {}
      try { if (globalThis.LIBRA?.DirectMemoryArchive) delete globalThis.LIBRA.DirectMemoryArchive; } catch (_) {}
    }
  };

  const register = async () => {
    bindGlobalApi();
    bindPanelHandlers();
    const host = globalThis?.LIBRA?.ExtensionHost || globalThis?.LIBRA_ExtensionHost;
    if (host?.unregisterExtension) {
      try { host.unregisterExtension(PLUGIN_ID); } catch (_) {}
    }
    if (host?.registerExtension) host.registerExtension(extension);
    else {
      globalThis.LIBRA_SubPlugins = Array.isArray(globalThis.LIBRA_SubPlugins) ? globalThis.LIBRA_SubPlugins : [];
      globalThis.LIBRA_SubPlugins = globalThis.LIBRA_SubPlugins.filter(item => String(item?.id || '') !== PLUGIN_ID);
      globalThis.LIBRA_SubPlugins.push(extension);
    }
    try {
      globalThis.__LIBRA_DMA_RUNTIME__ = extension;
      globalThis.LIBRA_DirectMemoryArchiveRuntime = extension;
    } catch (_) {}
  };

  await register();
})();
