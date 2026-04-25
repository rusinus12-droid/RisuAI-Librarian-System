//@name libra_entity_core_x
//@display-name LIBRA Entity Core X
//@author rusinus12@gmail.com
//@api 3.0
//@version 0.2.0

(() => {
  'use strict';

  /**
   * LIBRA Entity Core X
   *
   * Entity continuity engine. Entity Core X is not a memory store.
   * DMA is the canonical raw/direct evidence preservation layer.
   * Entity Core X consumes DMA evidence and produces character continuity guidance,
   * branch state, emotion state, relation signals, genre affect signals, and patch proposals.
   * LIBRA World Manager / V4 Narrative Core X owns final orchestration and injection authority.
   */

  try {
    globalThis.__LIBRA_ENTITY_COREX_RUNTIME__?.cleanup?.();
  } catch (_) {}

  const PLUGIN_ID = 'libra.entity.corex';
  const PLUGIN_NAME = 'LIBRA Entity Core X';
  const PLUGIN_VERSION = '0.2.0';

  const LEGACY_PLUGIN_IDS = Object.freeze([
    'libra.memory.omniReinforcer',
    'libra.entity.entity_mindmap',
    'libra.entity.psychologyModule',
    'libra.subplugin.qna'
  ]);

  const STORAGE_KEYS = Object.freeze({
    settings: 'LIBRA_EntityCoreX_Settings_v1',
    entityStorePrefix: 'LIBRA_ENTITY_CORE_X_STORE_V1::',
    entityStoreIndex: 'LIBRA_ENTITY_CORE_X_STORE_V1::__index__',
    dmaPrefix: 'LIBRA_DIRECT_MEMORY_ARCHIVE_V1::',
    qnaArchivePrefix: 'LIBRA_SubPlugin_QnA_Archive_v1:',
    legacyOmniPrefix: 'LIBRA_SubPlugin_OmniMemoryReinforcer_Graph_v1:'
  });

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    promptInjectionEnabled: true,
    maxPromptEntities: 3,
    promptBudget: 1700,
    promptRecallHighlights: 3,
    promptContinuityLocks: 3,
    recallTopK: 4,
    recallHopDepth: 1,
    activationGain: 9,
    activationDecay: 7,
    highThreshold: 84,
    promoteAfterHits: 4,
    decayDeleteAfter: 10,
    maxDirectEntries: 240,
    maxPreviousEntries: 64,
    maxPendingCaptures: 64,
    maxRepairQueue: 96,
    archiveMinAgeTurns: 6,
    archiveGroupTurns: 4,
    archiveMinGroupSize: 2,
    qnaDirectLimit: 4,
    qnaPreviousLimit: 4,
    verifierHistoryLimit: 18,
    patchQueueLimit: 24,
    patchAutoApplyThreshold: 0.9,
    patchOverwriteThreshold: 0.97,
    analysisProvider: {
      enabled: false,
      autoRun: false,
      manualRun: true,
      allowGatedAutoRun: true,
      requireGovernorApproval: true,
      maxAutoCallsPerScene: 1,
      cooldownTurns: 6,
      onlyWhenDirty: true,
      minDirtySeverity: 'high',
      outputMode: 'proposal',
      stages: {
        finalize: true,
        rebuild: true,
        manual: true
      },
      provider: 'openai',
      url: '',
      key: '',
      model: 'gpt-4o-mini',
      temp: 0.2,
      timeout: 30000,
      reasoningPreset: 'auto',
      reasoningEffort: 'none',
      reasoningBudgetTokens: 0,
      maxCompletionTokens: 12000,
      responseMaxTokens: 3200,
      maxEvidenceRefs: 18,
      maxEvidenceSnippets: 8,
      maxDirectEntries: 6,
      maxPreviousEntries: 4,
      autoApply: false,
      debug: false
    }
  });

  const BRANCH_REGISTRY = Object.freeze({
    desire: Object.freeze({
      promptLabel: 'desire',
      keywords: ['want', 'need', 'wish', 'goal', 'desire', '갈망', '원해', '원한다', '원하', '바라', '갖고 싶', '목표', '열망']
    }),
    fear: Object.freeze({
      promptLabel: 'fear',
      keywords: ['fear', 'afraid', 'avoid', 'worry', 'anxious', '두려', '무서', '불안', '걱정', '피하', '겁', '공포']
    }),
    wound: Object.freeze({
      promptLabel: 'wound',
      keywords: ['hurt', 'scar', 'trauma', 'loss', 'betray', '상처', '트라우마', '배신', '잃', '후회', '원망']
    }),
    mask: Object.freeze({
      promptLabel: 'mask',
      keywords: ['mask', 'pretend', 'hide', 'conceal', 'act like', '숨기', '감추', '척', '태연', '연기', '아닌 척']
    }),
    bond: Object.freeze({
      promptLabel: 'bond',
      keywords: ['bond', 'trust', 'love', 'protect', 'care', 'attach', '신뢰', '믿', '애정', '사랑', '지키', '의지', '질투']
    }),
    fixation: Object.freeze({
      promptLabel: 'fixation',
      keywords: ['obsess', 'cling', 'fixate', 'compulsion', '집착', '매달', '놓지 못', '강박', '미련']
    })
  });

  const BRANCH_ORDER = Object.freeze(['desire', 'fear', 'wound', 'mask', 'bond', 'fixation']);
  const CORE_PRIORITY = Object.freeze(['desire', 'fear', 'wound', 'bond', 'fixation', 'mask']);
  const BODY_SIGNATURE_HINTS = Object.freeze([
    '숨', '숨결', '호흡', '시선', '눈빛', '입술', '턱', '어깨', '손', '손끝', '손가락', '자세', '발걸음',
    'breath', 'gaze', 'eyes', 'lips', 'jaw', 'shoulders', 'hands', 'fingers', 'posture', 'steps'
  ]);
  const ANALYSIS_PROVIDER_FAILURE_LIMIT = 10;

  const runtimeState = {
    activeScopeId: 'global',
    lastStatus: 'idle',
    lastError: '',
    lastPromptPreview: '',
    lastPromptCount: 0,
    lastFinalizedTurn: 0,
    analysisFailureCount: 0,
    analysisFailureLimit: ANALYSIS_PROVIDER_FAILURE_LIMIT,
    analysisFailureMessage: '',
    lastBootstrapSeed: null
  };

  const scopeRuntime = new Map();
  const storeCache = new Map();
  let settingsCache = { ...DEFAULT_SETTINGS };
  let settingsLoaded = false;
  let settingsLoadPromise = null;
  let settingsSaveTimer = null;
  let pluginStorageWaitPromise = null;
  let analysisPanelHandlersBound = false;
  let analysisPanelInputHandler = null;
  let analysisPanelChangeHandler = null;
  let analysisPanelClickHandler = null;
  let analysisPanelAutoSaveTimer = null;
  let coreSettingsPanelAutoSaveTimer = null;
  let corexDmaActionHandlersBound = false;
  let corexDmaActionClickHandler = null;

  const normalizeText = (value = '') => String(value ?? '').replace(/\s+/g, ' ').trim();
  const escHtml = (value = '') => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const normalizeLooseToken = (value = '') => String(value ?? '')
    .toLowerCase()
    .replace(/[\s_\-'"`’‘“”!?.,:;()[\]{}<>\\/|]+/g, '');
  const compactText = (value = '', maxLen = 0) => {
    const text = normalizeText(value);
    if (!text) return '';
    if (!maxLen || text.length <= maxLen) return text;
    const slice = text.slice(0, Math.max(0, maxLen - 1)).trim();
    const lastSpace = slice.lastIndexOf(' ');
    const safe = lastSpace > Math.floor(maxLen * 0.55) ? slice.slice(0, lastSpace) : slice;
    return `${safe.trim()}...`;
  };
  const clampInt = (value, fallback, min, max) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  };
  const clampNumber = (value, fallback, min, max) => {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  };
  const round3 = (value, fallback = 0) => Number(clampNumber(value, fallback, 0, 1).toFixed(3));
  const safeJsonParse = (raw, fallback = null) => {
    if (raw == null || raw === '') return fallback;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  };
  const cloneValue = (value, fallback = null) => {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return value ?? fallback;
    }
  };
  const simpleHash = (value = '') => {
    const text = String(value ?? '');
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  };
  const uniqueTexts = (items = [], limit = 12) => {
    const out = [];
    const seen = new Set();
    for (const item of (Array.isArray(items) ? items : [items])) {
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
  const ensureArray = (value) => Array.isArray(value) ? value : [];
  const nowIso = () => {
    try {
      return new Date().toISOString();
    } catch (_) {
      return '';
    }
  };
  const tokenize = (text = '') => {
    const cleaned = normalizeText(text).toLowerCase().replace(/[^a-z0-9가-힣_\-\s]/g, ' ');
    if (!cleaned) return [];
    const tokens = cleaned
      .split(/\s+/)
      .map(part => part.trim())
      .filter(part => part && part.length >= 2);
    return Array.from(new Set(tokens));
  };
  const tokenSimilarity = (left = [], right = []) => {
    const leftSet = new Set(ensureArray(left).filter(Boolean));
    const rightSet = new Set(ensureArray(right).filter(Boolean));
    if (!leftSet.size || !rightSet.size) return 0;
    let inter = 0;
    leftSet.forEach((token) => { if (rightSet.has(token)) inter += 1; });
    const union = leftSet.size + rightSet.size - inter;
    return union > 0 ? inter / union : 0;
  };

  const getRisuApi = () => {
    if (typeof globalThis === 'undefined') return null;
    return globalThis.Risuai || globalThis.risuai || null;
  };
  const waitForPluginStorage = async (timeoutMs = 2600, intervalMs = 120) => {
    if (pluginStorageWaitPromise) return pluginStorageWaitPromise;
    pluginStorageWaitPromise = (async () => {
      const started = Date.now();
      while ((Date.now() - started) < timeoutMs) {
        const storage = getRisuApi()?.pluginStorage;
        if (storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function') {
          return storage;
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
      return null;
    })();
    try {
      return await pluginStorageWaitPromise;
    } finally {
      pluginStorageWaitPromise = null;
    }
  };
  const storageGetItem = async (key = '') => {
    const storage = await waitForPluginStorage();
    if (!storage || !key) return null;
    try {
      return await storage.getItem(key);
    } catch (_) {
      return null;
    }
  };
  const storageSetItem = async (key = '', value = '') => {
    const storage = await waitForPluginStorage();
    if (!storage || !key) return false;
    try {
      await storage.setItem(key, value);
      return true;
    } catch (_) {
      return false;
    }
  };
  const getExtensionHost = () => {
    try {
      return globalThis?.LIBRA?.ExtensionHost || globalThis?.LIBRA_ExtensionHost || null;
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
  const getTimeEngine = () => {
    try {
      return globalThis?.LIBRA?.TimeEngine
        || globalThis?.LIBRA_TimeEngine
        || globalThis?.TimeEngine
        || null;
    } catch (_) {
      return null;
    }
  };
  const parseDateLike = (value = '') => {
    const text = compactText(value || '', 40);
    if (!text) return null;
    const match = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (!match) return null;
    const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const diffDaysBetween = (fromDateText = '', toDateText = '') => {
    const from = parseDateLike(fromDateText);
    const to = parseDateLike(toDateText);
    if (!from || !to) return null;
    return Math.max(0, Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
  };
  const getTimeProjectionForEntity = (entity = {}, context = {}) => {
    const projection = (() => {
      try {
        const engine = getTimeEngine();
        if (engine?.getProjection && (entity?.name || entity?.id)) {
          return engine.getProjection(entity.name || entity.id || '', entity) || null;
        }
      } catch (_) {}
      return entity?.timeProjection && typeof entity.timeProjection === 'object'
        ? entity.timeProjection
        : entity?.timeTracking && typeof entity.timeTracking === 'object'
          ? entity.timeTracking
          : null;
    })();
    const state = (() => {
      try {
        return getTimeEngine()?.getState?.() || {};
      } catch (_) {
        return {};
      }
    })();
    const currentDate = compactText(
      projection?.currentDate
      || entity?.status?.currentDate
      || state?.currentDate
      || '',
      40
    );
    const lastInteractionDate = compactText(
      projection?.lastInteractionDate
      || entity?.timeProjection?.lastInteractionDate
      || entity?.timeTracking?.lastInteractionDate
      || '',
      40
    );
    return {
      currentDate,
      lastInteractionDate,
      raw: projection && typeof projection === 'object' ? projection : {},
      state: state && typeof state === 'object' ? state : {}
    };
  };
  const dampToward = (value, target, days = 0, dailyRetention = 0.9, fallback = 0) => {
    const source = clampNumber(value, fallback, 0, 1);
    const anchor = clampNumber(target, fallback, 0, 1);
    const steps = Math.max(0, Number(days || 0));
    if (steps <= 0) return round3(source, fallback);
    const retention = Math.max(0.2, Math.min(0.999, Number(dailyRetention || 0.9)));
    return round3(anchor + ((source - anchor) * Math.pow(retention, steps)), anchor);
  };

  class EntityCoreXProviderError extends Error {
    constructor(message = 'Provider error', code = 'PROVIDER_ERROR', details = null) {
      super(String(message || 'Provider error'));
      this.name = 'EntityCoreXProviderError';
      this.code = String(code || 'PROVIDER_ERROR');
      this.details = details;
    }
  }

  const DEFAULT_PROVIDER_MAX_COMPLETION_TOKENS = 16000;
  const COPILOT_CODE_VERSION = '1.85.0';
  const COPILOT_CHAT_VERSION = '0.22.0';
  const COPILOT_USER_AGENT = `GitHubCopilotChat/${COPILOT_CHAT_VERSION}`;
  const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';
  const COPILOT_TOKEN_CACHE_KEY = 'entity_corex_copilot_tid_token';
  const COPILOT_TOKEN_EXPIRY_KEY = 'entity_corex_copilot_tid_token_expiry';

  const isGLMLikeConfig = (llmConfig = {}) => {
    const model = String(llmConfig?.model || '').trim().toLowerCase();
    const url = String(llmConfig?.url || '').trim().toLowerCase();
    const provider = String(llmConfig?.provider || '').trim().toLowerCase();
    return /^glm[-\d.]/i.test(model)
      || /(?:open\.)?bigmodel\.cn|zhipu/i.test(url)
      || (provider === 'custom' && /^glm/i.test(model));
  };
  const isClaudeLikeConfig = (llmConfig = {}) => {
    const model = String(llmConfig?.model || '').trim().toLowerCase();
    const url = String(llmConfig?.url || '').trim().toLowerCase();
    const provider = String(llmConfig?.provider || '').trim().toLowerCase();
    return /claude|anthropic/.test(model) || /anthropic|claude/.test(url) || provider === 'claude';
  };
  const isGeminiLikeConfig = (llmConfig = {}) => {
    const model = String(llmConfig?.model || '').trim().toLowerCase();
    const url = String(llmConfig?.url || '').trim().toLowerCase();
    const provider = String(llmConfig?.provider || '').trim().toLowerCase();
    return /gemini|google\/gemma|gemma/.test(model)
      || /generativelanguage|googleapis|gemini|vertex/.test(url)
      || provider === 'gemini'
      || provider === 'vertex';
  };
  const isDeepSeekLikeConfig = (llmConfig = {}) => {
    const model = String(llmConfig?.model || '').trim().toLowerCase();
    const url = String(llmConfig?.url || '').trim().toLowerCase();
    const provider = String(llmConfig?.provider || '').trim().toLowerCase();
    return /deepseek/.test(model) || /deepseek/.test(url) || provider === 'deepseek';
  };
  const isKimiLikeConfig = (llmConfig = {}) => {
    const model = String(llmConfig?.model || '').trim().toLowerCase();
    const url = String(llmConfig?.url || '').trim().toLowerCase();
    const provider = String(llmConfig?.provider || '').trim().toLowerCase();
    return /kimi|moonshot/.test(model) || /moonshot|kimi/.test(url) || provider === 'kimi';
  };
  const detectReasoningFamily = (llmConfig = {}) => {
    if (isGLMLikeConfig(llmConfig)) return 'glm';
    if (isClaudeLikeConfig(llmConfig)) return 'claude';
    if (isGeminiLikeConfig(llmConfig)) return 'gemini';
    if (isDeepSeekLikeConfig(llmConfig)) return 'deepseek';
    if (isKimiLikeConfig(llmConfig)) return 'kimi';
    return 'gpt';
  };
  const getEffectiveReasoningRuntimeFamily = (llmConfig = {}) => {
    const requested = String(llmConfig?.reasoningPreset || 'auto').trim().toLowerCase();
    if (['gpt', 'gemini', 'claude', 'deepseek', 'kimi', 'glm'].includes(requested)) return requested;
    return detectReasoningFamily(llmConfig);
  };
  const inferEffortFromBudget = (budgetTokens = 0, fallback = 'medium') => {
    const budget = Math.max(0, parseInt(budgetTokens, 10) || 0);
    if (budget >= 12000) return 'high';
    if (budget >= 4096) return 'medium';
    if (budget >= 1024) return 'low';
    return String(fallback || 'medium').toLowerCase() === 'none'
      ? 'medium'
      : String(fallback || 'medium').toLowerCase();
  };
  const resolveProviderBaseUrl = (provider, rawUrl, mode = 'llm') => {
    const normalizedProvider = String(provider || 'openai').toLowerCase();
    const normalizedRawUrl = String(rawUrl || '').trim();
    if (normalizedRawUrl) return normalizedRawUrl;
    if (normalizedProvider === 'openai') return 'https://api.openai.com';
    if (normalizedProvider === 'openrouter') return 'https://openrouter.ai/api';
    if (normalizedProvider === 'ollama_cloud' && mode === 'llm') return 'https://ollama.com/v1/chat/completions';
    if (normalizedProvider === 'ollama' && mode === 'llm') return 'https://ollama.com';
    if (normalizedProvider === 'copilot' && mode === 'llm') return 'https://api.githubcopilot.com';
    return normalizedRawUrl;
  };
  const isOpenAICompatibleOllamaChatEndpoint = (rawUrl = '') => /\/chat\/completions$/i.test(String(rawUrl || '').trim().replace(/\/$/, ''));
  const normalizeGeminiApiEndpoint = (rawUrl, model, action = 'generateContent') => {
    const normalizedAction = action === 'streamGenerateContent' ? 'streamGenerateContent' : action === 'embedContent' ? 'embedContent' : 'generateContent';
    const cleanedModel = String(model || '').trim();
    let baseUrl = String(rawUrl || '').trim();
    if (!baseUrl) baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    baseUrl = baseUrl.replace(/\/$/, '');
    if (!/generativelanguage\.googleapis\.com/i.test(baseUrl)) {
      return /:[a-zA-Z]+$/.test(baseUrl) ? baseUrl : `${baseUrl}/models/${cleanedModel}:${normalizedAction}`;
    }
    if (!/\/v[0-9][^/]*$/i.test(baseUrl) && !/\/v[0-9][^/]*\/models\//i.test(baseUrl)) {
      baseUrl += '/v1beta';
    }
    if (new RegExp(`:${normalizedAction}$`, 'i').test(baseUrl)) return baseUrl;
    if (/\/models\/[^/:]+$/i.test(baseUrl)) return `${baseUrl}:${normalizedAction}`;
    if (/\/models\//i.test(baseUrl)) return baseUrl;
    return `${baseUrl}/models/${cleanedModel}:${normalizedAction}`;
  };
  const normalizeOllamaApiEndpoint = (rawUrl, action = 'chat') => {
    const normalizedAction = action === 'generate' ? 'generate' : 'chat';
    let baseUrl = String(rawUrl || '').trim();
    if (!baseUrl) baseUrl = 'https://ollama.com';
    baseUrl = baseUrl.replace(/\/$/, '');
    if (normalizedAction === 'chat' && isOpenAICompatibleOllamaChatEndpoint(baseUrl)) return baseUrl;
    if (new RegExp(`/api/${normalizedAction}$`, 'i').test(baseUrl)) return baseUrl;
    if (/\/api$/i.test(baseUrl)) return `${baseUrl}/${normalizedAction}`;
    return `${baseUrl}/api/${normalizedAction}`;
  };

  class EntityCoreXBaseProvider {
    _checkKey(key) {
      if (!String(key || '').trim()) {
        throw new EntityCoreXProviderError('API Key is missing. Please check analysisProvider settings.', 'MISSING_KEY');
      }
    }
    _checkUrl(url, kind = 'API URL') {
      if (!String(url || '').trim()) {
        throw new EntityCoreXProviderError(`${kind} is missing. Please check analysisProvider settings.`, 'MISSING_URL');
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
    _extractTextParts(content) {
      const parts = Array.isArray(content?.parts) ? content.parts : [];
      return parts
        .filter(part => part && !part.thought)
        .map(part => String(part?.text || '').trim())
        .filter(Boolean)
        .join('\n\n');
    }
    _extractOpenAITextContent(content) {
      if (typeof content === 'string') return String(content || '').trim();
      if (Array.isArray(content)) {
        return content.map((item) => {
          if (!item) return '';
          if (typeof item === 'string') return item;
          if (typeof item?.text === 'string') return item.text;
          if (typeof item?.output_text === 'string') return item.output_text;
          if (typeof item?.reasoning_content === 'string') return item.reasoning_content;
          if (typeof item?.content === 'string') return item.content;
          if (item?.content && typeof item?.content === 'object') return this._extractOpenAITextContent(item.content);
          return '';
        }).map(text => String(text || '').trim()).filter(Boolean).join('\n\n');
      }
      if (content && typeof content === 'object') {
        if (typeof content.text === 'string') return String(content.text || '').trim();
        if (typeof content.output_text === 'string') return String(content.output_text || '').trim();
        if (typeof content.reasoning_content === 'string') return String(content.reasoning_content || '').trim();
        if (typeof content.content === 'string') return String(content.content || '').trim();
        if (content.content && typeof content.content === 'object') return this._extractOpenAITextContent(content.content);
      }
      return '';
    }
    _extractOpenAIResponsesOutputText(data) {
      const output = Array.isArray(data?.output) ? data.output : [];
      if (!output.length) return '';
      return output.map(item => this._extractOpenAITextContent(item?.content) || this._extractOpenAITextContent(item?.text) || this._extractOpenAITextContent(item?.output_text) || '').filter(Boolean).join('\n\n');
    }
    _extractOpenAIResponseText(data) {
      const choice = data?.choices?.[0] || null;
      const message = choice?.message || {};
      return String(
        this._extractOpenAITextContent(message?.content)
        || this._extractOpenAITextContent(choice?.text)
        || this._extractOpenAITextContent(message?.text)
        || this._extractOpenAIResponsesOutputText(data)
        || this._extractOpenAITextContent(data?.output_text)
        || this._extractOpenAITextContent(data?.response)
        || ''
      ).trim();
    }
    _extractOllamaResponseText(data) {
      return String(data?.message?.content ?? data?.response ?? '').trim();
    }
    _normalizeOllamaUsage(data) {
      const usage = data?.usage && typeof data.usage === 'object' ? data.usage : {};
      const input = Number(usage.prompt_tokens ?? data?.prompt_eval_count ?? data?.prompt_eval_tokens ?? 0);
      const output = Number(usage.completion_tokens ?? data?.eval_count ?? data?.completion_eval_count ?? data?.eval_tokens ?? 0);
      return {
        prompt_tokens: input,
        completion_tokens: output,
        total_tokens: Number(usage.total_tokens ?? (input + output))
      };
    }
    _ensureNonEmptyText(content, data, providerLabel = 'LLM') {
      const text = String(content || '').trim();
      if (text) return text;
      throw new EntityCoreXProviderError(`${providerLabel} returned no text content`, 'EMPTY_RESPONSE', data);
    }
    async _fetchRaw(url, requestInit, timeoutMs = 30000) {
      const risu = getRisuApi();
      let timeoutId = null;
      const controller = (typeof AbortController !== 'undefined' && !requestInit?.signal) ? new AbortController() : null;
      const nextInit = controller ? { ...requestInit, signal: controller.signal } : requestInit;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          try { controller?.abort?.(); } catch (_) {}
          reject(new EntityCoreXProviderError('API Request timed out', 'TIMEOUT'));
        }, timeoutMs);
      });
      const fetchPromise = (async () => {
        if (risu?.nativeFetch) {
          const res = await risu.nativeFetch(url, nextInit);
          if (!res) {
            return { ok: false, status: 500, text: async () => 'RisuAI internal fetch error (undefined response)' };
          }
          return res;
        }
        const webRequest = globalThis?.['fetch'];
        if (typeof webRequest === 'function') {
          return webRequest.call(globalThis, url, nextInit);
        }
        throw new EntityCoreXProviderError('No nativeFetch/fetch available for analysis provider.', 'NO_FETCH');
      })();
      try {
        return await Promise.race([fetchPromise, timeoutPromise]);
      } finally {
        if (timeoutId != null && typeof clearTimeout === 'function') clearTimeout(timeoutId);
      }
    }
    async _fetch(url, headers, body, timeoutMs = 30000) {
      const response = await this._fetchRaw(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      }, timeoutMs);
      if (!response || !response.ok) {
        const status = response?.status || 'Unknown';
        const errorBody = await response?.text?.().catch(() => 'No error body') || 'No response';
        throw new EntityCoreXProviderError(`API Error: ${status} - ${errorBody}`, 'API_ERROR');
      }
      return response.json();
    }
  }

  class EntityCoreXOpenAIProvider extends EntityCoreXBaseProvider {
    async _getCopilotBearerToken(rawToken) {
      const sourceToken = String(rawToken || '').replace(/[^\x20-\x7E]/g, '').trim();
      if (!sourceToken) return '';
      try {
        const cachedToken = String(await storageGetItem(COPILOT_TOKEN_CACHE_KEY) || '').trim();
        const cachedExpiry = Number(await storageGetItem(COPILOT_TOKEN_EXPIRY_KEY) || 0);
        if (cachedToken && Number.isFinite(cachedExpiry) && Date.now() < cachedExpiry - 60000) return cachedToken;
      } catch (_) {}
      try {
        const response = await this._fetchRaw(COPILOT_TOKEN_URL, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${sourceToken}`,
            Origin: 'vscode-file://vscode-app',
            'Editor-Version': `vscode/${COPILOT_CODE_VERSION}`,
            'Editor-Plugin-Version': `copilot-chat/${COPILOT_CHAT_VERSION}`,
            'Copilot-Integration-Id': 'vscode-chat',
            'User-Agent': COPILOT_USER_AGENT
          }
        }, 12000);
        if (!response?.ok) return sourceToken;
        const data = await response.json().catch(() => null);
        const token = String(data?.token || '').trim();
        const expiry = Number(data?.expires_at || 0) * 1000;
        if (!token) return sourceToken;
        await storageSetItem(COPILOT_TOKEN_CACHE_KEY, token);
        await storageSetItem(COPILOT_TOKEN_EXPIRY_KEY, String(expiry || (Date.now() + 30 * 60 * 1000)));
        return token;
      } catch (_) {
        return sourceToken;
      }
    }
    async callLLM(config, systemPrompt, userContent, options = {}) {
      this._checkKey(config?.llm?.key);
      const provider = String(config?.llm?.provider || 'openai').toLowerCase();
      const endpointSuffix = provider === 'copilot' || isGLMLikeConfig(config.llm) ? '/chat/completions' : '/v1/chat/completions';
      const url = this._normalizeUrl(resolveProviderBaseUrl(provider, config?.llm?.url, 'llm'), endpointSuffix);
      const authToken = provider === 'copilot' ? await this._getCopilotBearerToken(config.llm.key) : config.llm.key;
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`
      };
      if (provider === 'openrouter') {
        headers['HTTP-Referer'] = 'https://risuai.xyz';
        headers['X-Title'] = 'LIBRA Entity Core X';
      } else if (provider === 'copilot') {
        headers['Editor-Version'] = `vscode/${COPILOT_CODE_VERSION}`;
        headers['Editor-Plugin-Version'] = `copilot-chat/${COPILOT_CHAT_VERSION}`;
        headers['Copilot-Integration-Id'] = 'vscode-chat';
        headers['User-Agent'] = COPILOT_USER_AGENT;
      }
      const requestedTokens = Math.max(256, parseInt(options?.maxTokens, 10) || 1000);
      const configuredMaxCompletionTokens = Math.max(0, parseInt(config?.llm?.maxCompletionTokens, 10) || 0);
      const runtimeReasoningConfig = { ...config.llm, provider };
      const reasoningPresetKey = getEffectiveReasoningRuntimeFamily(runtimeReasoningConfig);
      const body = {
        model: String(config?.llm?.model || '').trim(),
        messages: [
          { role: 'system', content: String(systemPrompt || '') },
          { role: 'user', content: String(userContent || '') }
        ],
        temperature: Number(config?.llm?.temp ?? 0.3),
        max_tokens: requestedTokens,
        stream: false
      };
      const applyReasoningPayload = (targetBody, family) => {
        if (family === 'glm') {
          targetBody.max_tokens = Math.max(requestedTokens, configuredMaxCompletionTokens || DEFAULT_PROVIDER_MAX_COMPLETION_TOKENS);
          targetBody.thinking = { type: String(config.llm.glmThinkingType || 'enabled').toLowerCase() === 'disabled' ? 'disabled' : 'enabled' };
          return;
        }
        if (family === 'claude' && (config.llm.reasoningBudgetTokens || 0) >= 1024) {
          const thinkingBudget = Math.max(1024, parseInt(config.llm.reasoningBudgetTokens, 10) || 1024);
          targetBody.max_tokens = Math.max(requestedTokens, configuredMaxCompletionTokens || DEFAULT_PROVIDER_MAX_COMPLETION_TOKENS, thinkingBudget + 1024);
          targetBody.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
          delete targetBody.temperature;
          return;
        }
        if (family === 'deepseek' || family === 'kimi') {
          targetBody.max_tokens = Math.max(requestedTokens, configuredMaxCompletionTokens || 32768);
          targetBody.thinking = { type: 'enabled' };
          delete targetBody.temperature;
          return;
        }
        if (family === 'gemini') {
          targetBody.reasoning_effort = inferEffortFromBudget(config.llm.reasoningBudgetTokens, config.llm.reasoningEffort || 'medium');
          targetBody.max_completion_tokens = Math.max(requestedTokens, configuredMaxCompletionTokens || DEFAULT_PROVIDER_MAX_COMPLETION_TOKENS);
          delete targetBody.max_tokens;
          return;
        }
        if (config.llm.reasoningEffort && config.llm.reasoningEffort !== 'none') {
          targetBody.reasoning_effort = config.llm.reasoningEffort;
          targetBody.max_completion_tokens = Math.max(requestedTokens, configuredMaxCompletionTokens || DEFAULT_PROVIDER_MAX_COMPLETION_TOKENS);
          delete targetBody.max_tokens;
        }
      };
      applyReasoningPayload(body, reasoningPresetKey);
      const data = await this._fetch(url, headers, body, config.llm.timeout);
      const content = this._ensureNonEmptyText(this._extractOpenAIResponseText(data), data, provider);
      return {
        content,
        usage: data?.usage || {},
        streamMeta: { provider, streamIncomplete: false }
      };
    }
  }

  class EntityCoreXAnthropicProvider extends EntityCoreXBaseProvider {
    async callLLM(config, systemPrompt, userContent, options = {}) {
      this._checkKey(config?.llm?.key);
      let url = String(config?.llm?.url || '').trim();
      if (!url) url = 'https://api.anthropic.com';
      if (!url.includes('/v1/')) url = url.replace(/\/$/, '') + '/v1/messages';
      const headers = {
        'Content-Type': 'application/json',
        'x-api-key': config.llm.key,
        'anthropic-version': '2023-06-01'
      };
      const requestedTokens = Math.max(256, parseInt(options?.maxTokens, 10) || 1000);
      const configuredMaxCompletionTokens = Math.max(0, parseInt(config?.llm?.maxCompletionTokens, 10) || 0);
      const body = {
        model: config.llm.model,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
        max_tokens: Math.max(requestedTokens, configuredMaxCompletionTokens || 0),
        temperature: config.llm.temp || 0.3,
        stream: false
      };
      if ((config.llm.reasoningBudgetTokens || 0) >= 1024) {
        const thinkingBudget = Math.max(1024, parseInt(config.llm.reasoningBudgetTokens, 10) || 1024);
        body.max_tokens = Math.max(body.max_tokens, thinkingBudget + 1024);
        body.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
      }
      const data = await this._fetch(url, headers, body, config.llm.timeout);
      const content = Array.isArray(data?.content)
        ? data.content.filter(block => block && (block.type === 'text' || typeof block.text === 'string')).map(block => String(block.text || '').trim()).filter(Boolean).join('\n\n')
        : '';
      return {
        content: this._ensureNonEmptyText(content, data, 'anthropic'),
        usage: data?.usage || {},
        streamMeta: { provider: 'anthropic', streamIncomplete: false }
      };
    }
  }

  class EntityCoreXGeminiProvider extends EntityCoreXBaseProvider {
    async callLLM(config, systemPrompt, userContent, options = {}) {
      this._checkKey(config?.llm?.key);
      const model = String(config?.llm?.model || '').trim();
      const url = normalizeGeminiApiEndpoint(config?.llm?.url, model, 'generateContent');
      this._checkUrl(url);
      const isThinkingModel = /gemini-(3|2\.5)/i.test(model);
      const requestedTokens = Math.max(256, parseInt(options?.maxTokens, 10) || 1000);
      const configuredMaxCompletionTokens = Math.max(0, parseInt(config?.llm?.maxCompletionTokens, 10) || 0);
      const maxOutputTokens = isThinkingModel ? Math.max(requestedTokens, configuredMaxCompletionTokens || requestedTokens) : requestedTokens;
      const body = {
        contents: [{ role: 'user', parts: [{ text: userContent }] }],
        generationConfig: {
          temperature: config.llm.temp || 0.3,
          maxOutputTokens
        }
      };
      if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };
      if ((config.llm.reasoningBudgetTokens || 0) > 0) {
        body.generationConfig.thinkingConfig = isThinkingModel
          ? { includeThoughts: false, thinkingBudget: Math.max(0, parseInt(config.llm.reasoningBudgetTokens, 10) || 0) }
          : { thinkingBudget: Math.max(0, parseInt(config.llm.reasoningBudgetTokens, 10) || 0) };
      }
      const data = await this._fetch(url, { 'Content-Type': 'application/json', 'x-goog-api-key': config.llm.key }, body, config.llm.timeout);
      const content = this._extractTextParts(data?.candidates?.[0]?.content) || '';
      return {
        content: this._ensureNonEmptyText(content, data, 'gemini'),
        usage: data?.usageMetadata || data?.usage || {},
        streamMeta: { provider: 'gemini', streamIncomplete: false }
      };
    }
  }

  class EntityCoreXOllamaCloudProvider extends EntityCoreXBaseProvider {
    async callLLM(config, systemPrompt, userContent, options = {}) {
      this._checkKey(config?.llm?.key);
      const resolvedBaseUrl = resolveProviderBaseUrl(config?.llm?.provider || 'ollama_cloud', config?.llm?.url, 'llm');
      const url = normalizeOllamaApiEndpoint(resolvedBaseUrl, 'chat');
      const useOpenAICompatibleEndpoint = isOpenAICompatibleOllamaChatEndpoint(url);
      const requestedTokens = Math.max(1, parseInt(options?.maxTokens, 10) || 1000);
      const configuredMaxCompletionTokens = Math.max(0, parseInt(config?.llm?.maxCompletionTokens, 10) || 0);
      const numPredict = Math.max(1, Math.min(configuredMaxCompletionTokens || requestedTokens, requestedTokens));
      const messages = [];
      if (String(systemPrompt || '').trim()) messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: userContent });
      const body = useOpenAICompatibleEndpoint
        ? {
            model: String(config?.llm?.model || '').trim(),
            messages,
            temperature: Number(config?.llm?.temp ?? 0.3),
            max_tokens: numPredict,
            stream: false
          }
        : {
            model: String(config?.llm?.model || '').trim(),
            messages,
            stream: false,
            options: {
              temperature: Number(config?.llm?.temp ?? 0.3),
              num_predict: numPredict
            }
          };
      const data = await this._fetch(url, {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llm.key}`
      }, body, config.llm.timeout);
      const content = this._ensureNonEmptyText(
        useOpenAICompatibleEndpoint ? this._extractOpenAIResponseText(data) : this._extractOllamaResponseText(data),
        data,
        'Ollama Cloud'
      );
      return {
        content,
        usage: useOpenAICompatibleEndpoint ? (data?.usage || this._normalizeOllamaUsage(data)) : this._normalizeOllamaUsage(data),
        streamMeta: { provider: 'ollama', streamIncomplete: false }
      };
    }
  }

  class EntityCoreXVertexAIProvider extends EntityCoreXBaseProvider {
    static _tokenCache = new Map();
    static _str2ab(privateKey) {
      const binaryString = atob(String(privateKey || '').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\\n|\n/g, ''));
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i += 1) bytes[i] = binaryString.charCodeAt(i);
      return bytes.buffer;
    }
    static _base64url(source) {
      let binary = '';
      for (let i = 0; i < source.length; i += 1) binary += String.fromCharCode(source[i]);
      return btoa(binary).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    }
    static async _generateAccessToken(clientEmail, privateKey) {
      const risu = getRisuApi();
      const now = Math.floor(Date.now() / 1000);
      const header = { alg: 'RS256', typ: 'JWT' };
      const claimSet = {
        iss: clientEmail,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
      };
      const encodedHeader = EntityCoreXVertexAIProvider._base64url(new TextEncoder().encode(JSON.stringify(header)));
      const encodedClaimSet = EntityCoreXVertexAIProvider._base64url(new TextEncoder().encode(JSON.stringify(claimSet)));
      const key = await crypto.subtle.importKey('pkcs8', EntityCoreXVertexAIProvider._str2ab(privateKey), { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } }, false, ['sign']);
      const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${encodedHeader}.${encodedClaimSet}`));
      const jwt = `${encodedHeader}.${encodedClaimSet}.${EntityCoreXVertexAIProvider._base64url(new Uint8Array(signature))}`;
      if (risu?.nativeFetch) {
        const response = await risu.nativeFetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
        });
        if (!response?.ok) {
          const errText = await response?.text?.().catch(() => String(response?.status || 'Unknown')) || 'No response';
          throw new EntityCoreXProviderError(`Failed to get Vertex AI access token: ${errText}`, 'VERTEX_TOKEN_ERROR');
        }
        const data = await response.json();
        if (!data?.access_token) throw new EntityCoreXProviderError('No access token in Vertex AI token response', 'VERTEX_TOKEN_ERROR');
        return data.access_token;
      }
      throw new EntityCoreXProviderError('nativeFetch is required for Vertex token exchange.', 'NO_NATIVE_FETCH');
    }
    static async _getAccessToken(rawKey) {
      const cacheKey = String(rawKey || '').trim();
      const cached = EntityCoreXVertexAIProvider._tokenCache.get(cacheKey);
      if (cached?.token && Date.now() < cached.expiry) return cached.token;
      let clientEmail = '';
      let privateKey = '';
      try {
        const credentials = JSON.parse(cacheKey);
        clientEmail = credentials.client_email;
        privateKey = credentials.private_key;
      } catch (_) {
        throw new EntityCoreXProviderError('Vertex AI Key must be a JSON service account credential.', 'VERTEX_CREDENTIAL_ERROR');
      }
      if (!clientEmail || !privateKey) throw new EntityCoreXProviderError('Vertex AI credentials missing client_email or private_key.', 'VERTEX_CREDENTIAL_ERROR');
      const token = await EntityCoreXVertexAIProvider._generateAccessToken(clientEmail, privateKey);
      EntityCoreXVertexAIProvider._tokenCache.set(cacheKey, { token, expiry: Date.now() + 3500 * 1000 });
      return token;
    }
    async callLLM(config, systemPrompt, userContent, options = {}) {
      this._checkKey(config?.llm?.key);
      const baseUrl = String(config?.llm?.url || '').trim().replace(/\/$/, '');
      this._checkUrl(baseUrl);
      const model = String(config?.llm?.model || '').trim();
      const accessToken = await EntityCoreXVertexAIProvider._getAccessToken(config.llm.key);
      const isThinkingModel = /gemini-(3|2\.5)/i.test(model);
      const requestedTokens = Math.max(256, parseInt(options?.maxTokens, 10) || 1000);
      const configuredMaxCompletionTokens = Math.max(0, parseInt(config?.llm?.maxCompletionTokens, 10) || 0);
      const maxOutputTokens = isThinkingModel ? Math.max(requestedTokens, configuredMaxCompletionTokens || 8192) : requestedTokens;
      const body = {
        contents: [{ role: 'user', parts: [{ text: userContent }] }],
        generationConfig: { temperature: config.llm.temp || 0.3, maxOutputTokens }
      };
      if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };
      if ((config.llm.reasoningBudgetTokens || 0) > 0) {
        body.generationConfig.thinkingConfig = isThinkingModel
          ? { includeThoughts: false, thinkingBudget: Math.max(0, parseInt(config.llm.reasoningBudgetTokens, 10) || 0) }
          : { thinkingBudget: Math.max(0, parseInt(config.llm.reasoningBudgetTokens, 10) || 0) };
      }
      const url = baseUrl.includes(':generateContent') ? baseUrl : `${baseUrl}/${model}:generateContent`;
      const data = await this._fetch(url, { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body, config.llm.timeout);
      const content = this._extractTextParts(data?.candidates?.[0]?.content) || '';
      return {
        content: this._ensureNonEmptyText(content, data, 'vertex'),
        usage: data?.usageMetadata || data?.usage || {},
        streamMeta: { provider: 'vertex', streamIncomplete: false }
      };
    }
  }

  const EntityCoreXAutoProvider = (() => {
    const providers = {
      openai: new EntityCoreXOpenAIProvider(),
      openrouter: new EntityCoreXOpenAIProvider(),
      custom: new EntityCoreXOpenAIProvider(),
      copilot: new EntityCoreXOpenAIProvider(),
      anthropic: new EntityCoreXAnthropicProvider(),
      claude: new EntityCoreXAnthropicProvider(),
      gemini: new EntityCoreXGeminiProvider(),
      ollama_cloud: new EntityCoreXOllamaCloudProvider(),
      ollama: new EntityCoreXOllamaCloudProvider(),
      vertex: new EntityCoreXVertexAIProvider()
    };
    return {
      get: (name) => providers[String(name || 'openai').toLowerCase()] || providers.openai
    };
  })();

  const buildAnalysisProviderConfig = (settings = {}) => ({
    llm: {
      provider: String(settings?.provider || 'openai').toLowerCase(),
      url: String(settings?.url || ''),
      key: String(settings?.key || ''),
      model: String(settings?.model || 'gpt-4o-mini'),
      temp: Number(settings?.temp ?? 0.2),
      timeout: Math.max(3000, Number(settings?.timeout || 30000)),
      reasoningPreset: String(settings?.reasoningPreset || 'auto'),
      reasoningEffort: String(settings?.reasoningEffort || 'none'),
      reasoningBudgetTokens: Math.max(0, parseInt(settings?.reasoningBudgetTokens, 10) || 0),
      maxCompletionTokens: Math.max(256, parseInt(settings?.maxCompletionTokens, 10) || 12000),
      glmThinkingType: 'enabled'
    }
  });

  const reportCoordinatorRuntime = (payload = {}) => {
    try {
      return getPluginCoordinator()?.reportRuntime?.(PLUGIN_ID, {
        domain: 'entity',
        pluginName: PLUGIN_NAME,
        version: PLUGIN_VERSION,
        scopeId: runtimeState.activeScopeId,
        status: runtimeState.lastStatus,
        error: runtimeState.lastError,
        promptCount: runtimeState.lastPromptCount,
        finalizedTurn: runtimeState.lastFinalizedTurn,
        activeScopeId: runtimeState.activeScopeId,
        lastPromptCount: runtimeState.lastPromptCount,
        patchQueueCount: Number(payload?.patchQueueCount || runtimeState.patchQueueCount || 0),
        verifierStatus: payload?.verifierStatus || (runtimeState.lastError ? 'degraded' : 'ready'),
        evidenceSource: payload?.evidenceSource || 'dma/fallback',
        emotionStatus: payload?.emotionStatus || 'emotion_bridge',
        degradedEvidenceMode: payload?.degradedEvidenceMode === true,
        ...(payload && typeof payload === 'object' ? payload : {})
      }) || null;
    } catch (_) {
      return null;
    }
  };
  const reportCoordinatorPatchProposal = (entity = {}, patch = {}, core = {}) => {
    const normalizedPatch = normalizePatchItem(patch);
    try {
      return getPluginCoordinator()?.reportPatchProposal?.(PLUGIN_ID, {
        domain: 'entity',
        entityNames: [normalizeName(entity?.name || core?.identity?.name || '')].filter(Boolean),
        summary: compactText(normalizedPatch?.reason || normalizedPatch?.targetPath || 'Entity Core X patch proposal', 220),
        confidence: Number(normalizedPatch?.confidence || 0),
        patchConfidence: Number(normalizedPatch?.confidence || 0),
        evidenceRefs: ensureArray(normalizedPatch?.evidenceRefs || []).slice(0, 6),
        sourceKeys: [normalizeText(normalizedPatch?.sourceInvestigation || '')].filter(Boolean),
        autoApply: normalizedPatch?.safe !== false,
        patch: cloneValue(normalizedPatch, {}),
        commitAction: () => extension.applyEntityRepairPatch({
          entity,
          patch: cloneValue(normalizedPatch, {}),
          allowUnsafe: false
        })
      }) || null;
    } catch (_) {
      return null;
    }
  };
  const getRelationCacheRows = (context = {}) => {
    try {
      const cache = context?.EntityManager?.getRelationCache?.();
      if (cache instanceof Map) return Array.from(cache.values());
      return Array.isArray(cache) ? cache : [];
    } catch (_) {
      return [];
    }
  };

  const scheduleSaveSettings = () => {
    if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
    settingsSaveTimer = setTimeout(async () => {
      settingsSaveTimer = null;
      try {
        await storageSetItem(STORAGE_KEYS.settings, JSON.stringify(settingsCache));
      } catch (_) {}
    }, 80);
  };
  const isAnalysisProviderSuspended = () => (
    Number(runtimeState.analysisFailureCount || 0) >= Number(runtimeState.analysisFailureLimit || ANALYSIS_PROVIDER_FAILURE_LIMIT)
  );
  const resetAnalysisProviderFailureState = () => {
    runtimeState.analysisFailureCount = 0;
    runtimeState.analysisFailureMessage = '';
  };
  const recordAnalysisProviderFailure = (error = null) => {
    const nextCount = Math.min(
      Number(runtimeState.analysisFailureLimit || ANALYSIS_PROVIDER_FAILURE_LIMIT),
      Math.max(0, Number(runtimeState.analysisFailureCount || 0)) + 1
    );
    runtimeState.analysisFailureCount = nextCount;
    runtimeState.analysisFailureMessage = compactText(error?.message || String(error || ''), 160);
    return nextCount;
  };
  const normalizeAnalysisProviderSettings = (settings = {}) => {
    const source = settings && typeof settings === 'object' ? settings : {};
    const stages = source?.stages && typeof source.stages === 'object' ? source.stages : {};
    return {
      enabled: source?.enabled === true,
      autoRun: source?.autoRun === true,
      manualRun: source?.manualRun !== false,
      allowGatedAutoRun: source?.allowGatedAutoRun !== false,
      requireGovernorApproval: source?.requireGovernorApproval !== false,
      maxAutoCallsPerScene: clampInt(source?.maxAutoCallsPerScene, DEFAULT_SETTINGS.analysisProvider.maxAutoCallsPerScene, 1, 12),
      cooldownTurns: clampInt(source?.cooldownTurns, DEFAULT_SETTINGS.analysisProvider.cooldownTurns, 0, 120),
      onlyWhenDirty: source?.onlyWhenDirty !== false,
      minDirtySeverity: normalizeText(source?.minDirtySeverity || DEFAULT_SETTINGS.analysisProvider.minDirtySeverity).toLowerCase() || 'high',
      outputMode: normalizeText(source?.outputMode || DEFAULT_SETTINGS.analysisProvider.outputMode).toLowerCase() || 'proposal',
      stages: {
        finalize: stages?.finalize !== false,
        rebuild: stages?.rebuild !== false,
        manual: stages?.manual !== false
      },
      provider: normalizeText(source?.provider || DEFAULT_SETTINGS.analysisProvider.provider).toLowerCase() || DEFAULT_SETTINGS.analysisProvider.provider,
      url: compactText(source?.url || '', 300),
      key: String(source?.key || ''),
      model: compactText(source?.model || DEFAULT_SETTINGS.analysisProvider.model, 120),
      temp: clampNumber(source?.temp, DEFAULT_SETTINGS.analysisProvider.temp, 0, 1.5),
      timeout: clampInt(source?.timeout, DEFAULT_SETTINGS.analysisProvider.timeout, 3000, 180000),
      reasoningPreset: normalizeText(source?.reasoningPreset || DEFAULT_SETTINGS.analysisProvider.reasoningPreset).toLowerCase() || 'auto',
      reasoningEffort: normalizeText(source?.reasoningEffort || DEFAULT_SETTINGS.analysisProvider.reasoningEffort).toLowerCase() || 'none',
      reasoningBudgetTokens: clampInt(source?.reasoningBudgetTokens, DEFAULT_SETTINGS.analysisProvider.reasoningBudgetTokens, 0, 64000),
      maxCompletionTokens: clampInt(source?.maxCompletionTokens, DEFAULT_SETTINGS.analysisProvider.maxCompletionTokens, 256, 64000),
      responseMaxTokens: clampInt(source?.responseMaxTokens, DEFAULT_SETTINGS.analysisProvider.responseMaxTokens, 256, 12000),
      maxEvidenceRefs: clampInt(source?.maxEvidenceRefs, DEFAULT_SETTINGS.analysisProvider.maxEvidenceRefs, 4, 32),
      maxEvidenceSnippets: clampInt(source?.maxEvidenceSnippets, DEFAULT_SETTINGS.analysisProvider.maxEvidenceSnippets, 2, 16),
      maxDirectEntries: clampInt(source?.maxDirectEntries, DEFAULT_SETTINGS.analysisProvider.maxDirectEntries, 1, 12),
      maxPreviousEntries: clampInt(source?.maxPreviousEntries, DEFAULT_SETTINGS.analysisProvider.maxPreviousEntries, 1, 12),
      autoApply: source?.autoApply === true,
      debug: source?.debug === true
    };
  };
  const normalizeSettings = (settings = {}) => ({
    enabled: settings?.enabled !== false,
    promptInjectionEnabled: settings?.promptInjectionEnabled !== false,
    maxPromptEntities: clampInt(settings?.maxPromptEntities, DEFAULT_SETTINGS.maxPromptEntities, 1, 6),
    promptBudget: clampInt(settings?.promptBudget, DEFAULT_SETTINGS.promptBudget, 800, 4000),
    promptRecallHighlights: clampInt(settings?.promptRecallHighlights, DEFAULT_SETTINGS.promptRecallHighlights, 1, 6),
    promptContinuityLocks: clampInt(settings?.promptContinuityLocks, DEFAULT_SETTINGS.promptContinuityLocks, 1, 6),
    recallTopK: clampInt(settings?.recallTopK, DEFAULT_SETTINGS.recallTopK, 2, 10),
    recallHopDepth: clampInt(settings?.recallHopDepth, DEFAULT_SETTINGS.recallHopDepth, 1, 3),
    activationGain: clampInt(settings?.activationGain, DEFAULT_SETTINGS.activationGain, 1, 25),
    activationDecay: clampInt(settings?.activationDecay, DEFAULT_SETTINGS.activationDecay, 1, 25),
    highThreshold: clampInt(settings?.highThreshold, DEFAULT_SETTINGS.highThreshold, 60, 100),
    promoteAfterHits: clampInt(settings?.promoteAfterHits, DEFAULT_SETTINGS.promoteAfterHits, 2, 12),
    decayDeleteAfter: clampInt(settings?.decayDeleteAfter, DEFAULT_SETTINGS.decayDeleteAfter, 3, 32),
    maxDirectEntries: clampInt(settings?.maxDirectEntries, DEFAULT_SETTINGS.maxDirectEntries, 64, 600),
    maxPreviousEntries: clampInt(settings?.maxPreviousEntries, DEFAULT_SETTINGS.maxPreviousEntries, 16, 200),
    maxPendingCaptures: clampInt(settings?.maxPendingCaptures, DEFAULT_SETTINGS.maxPendingCaptures, 8, 128),
    maxRepairQueue: clampInt(settings?.maxRepairQueue, DEFAULT_SETTINGS.maxRepairQueue, 8, 160),
    archiveMinAgeTurns: clampInt(settings?.archiveMinAgeTurns, DEFAULT_SETTINGS.archiveMinAgeTurns, 2, 40),
    archiveGroupTurns: clampInt(settings?.archiveGroupTurns, DEFAULT_SETTINGS.archiveGroupTurns, 2, 12),
    archiveMinGroupSize: clampInt(settings?.archiveMinGroupSize, DEFAULT_SETTINGS.archiveMinGroupSize, 2, 8),
    qnaDirectLimit: clampInt(settings?.qnaDirectLimit, DEFAULT_SETTINGS.qnaDirectLimit, 1, 10),
    qnaPreviousLimit: clampInt(settings?.qnaPreviousLimit, DEFAULT_SETTINGS.qnaPreviousLimit, 1, 10),
    verifierHistoryLimit: clampInt(settings?.verifierHistoryLimit, DEFAULT_SETTINGS.verifierHistoryLimit, 4, 40),
    patchQueueLimit: clampInt(settings?.patchQueueLimit, DEFAULT_SETTINGS.patchQueueLimit, 4, 40),
    patchAutoApplyThreshold: clampNumber(settings?.patchAutoApplyThreshold, DEFAULT_SETTINGS.patchAutoApplyThreshold, 0.6, 0.99),
    patchOverwriteThreshold: clampNumber(settings?.patchOverwriteThreshold, DEFAULT_SETTINGS.patchOverwriteThreshold, 0.85, 1),
    analysisProvider: normalizeAnalysisProviderSettings(settings?.analysisProvider || {})
  });
  const loadSettings = async () => {
    if (settingsLoaded) return settingsCache;
    if (settingsLoadPromise) return settingsLoadPromise;
    settingsLoadPromise = (async () => {
      const raw = await storageGetItem(STORAGE_KEYS.settings);
      settingsCache = normalizeSettings({ ...DEFAULT_SETTINGS, ...(safeJsonParse(raw, {}) || {}) });
      settingsLoaded = true;
      return settingsCache;
    })();
    try {
      return await settingsLoadPromise;
    } finally {
      settingsLoadPromise = null;
    }
  };
  const getSettings = () => normalizeSettings(settingsCache);
  const setSettingsPatch = async (patch = {}) => {
    await loadSettings();
    settingsCache = normalizeSettings({ ...settingsCache, ...(patch || {}) });
    if (patch && typeof patch === 'object' && Object.prototype.hasOwnProperty.call(patch, 'analysisProvider')) {
      resetAnalysisProviderFailureState();
    }
    scheduleSaveSettings();
    return settingsCache;
  };

  const updateRuntimeStatus = (status = '', extra = {}) => {
    runtimeState.lastStatus = compactText(status, 180) || 'idle';
    runtimeState.lastError = compactText(extra?.error || '', 220);
    if (typeof extra?.scopeId === 'string' && extra.scopeId) runtimeState.activeScopeId = extra.scopeId;
    reportCoordinatorRuntime(extra);
    syncEntityCoreQuickPanelLive();
  };
  const formatPercent = (value = 0) => `${Math.round(clampNumber(value, 0, 0, 1) * 100)}%`;

  const getChatMessages = (chat = null) => {
    if (!chat || typeof chat !== 'object') return [];
    if (Array.isArray(chat.message)) return chat.message;
    if (Array.isArray(chat.messages)) return chat.messages;
    return [];
  };
  const getMessageText = (msg = {}) => {
    if (!msg || typeof msg !== 'object') return '';
    if (typeof msg.data === 'string') return msg.data;
    if (typeof msg.content === 'string') return msg.content;
    if (typeof msg.message === 'string') return msg.message;
    if (Array.isArray(msg.swipes) && Number.isFinite(Number(msg.swipe_id))) {
      return String(msg.swipes[Number(msg.swipe_id)] || '');
    }
    return '';
  };
  const isAssistantLikeMessage = (msg = {}) => {
    const role = String(msg?.role || msg?.name || '').toLowerCase();
    return role.includes('assistant') || role === 'char' || role === 'bot';
  };
  const isUserLikeMessage = (msg = {}) => {
    const role = String(msg?.role || msg?.name || '').toLowerCase();
    return role === 'user' || msg?.is_user === true;
  };
  const resolveScopeId = (context = {}) => {
    const candidates = [
      context?.scopeId,
      context?.requestOrigin?.chatId,
      context?.chat?.id,
      context?.chat?.chatId,
      context?.chatId,
      runtimeState.activeScopeId
    ];
    return candidates.map(item => normalizeText(item)).find(Boolean) || 'global';
  };
  const getLiveMessageId = (msg = {}) => normalizeText(msg?.id || msg?.messageId || msg?.m_id || msg?.mid || '');
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
    return { count: rows.length, chars: joined.length, hash: rows.length ? simpleHash(joined) : '' };
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
  const importStoreFromNativeCopiedChatIfNeeded = async (context = {}, targetScopeId = '') => {
    const normalizedTarget = normalizeText(targetScopeId) || resolveScopeId(context);
    if (!normalizedTarget || normalizedTarget === 'global') return null;
    const targetStore = await loadStore(normalizedTarget);
    if (getStoreEntryCount(targetStore || {}) > 0) return null;
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
    updateRuntimeStatus('native chat copy Entity Core X store imported', {
      scopeId: normalizedTarget,
      copiedFromScopeId: source.sourceScopeId
    });
    return { scopeId: normalizedTarget, store: committed, copiedFromScopeId: source.sourceScopeId, match: { mode: 'native-risu-chat-copy' } };
  };
  const getWorldCoreXApi = () => {
    try {
      return globalThis?.LIBRA?.WorldCoreX
        || globalThis?.LIBRA_WorldCoreXAPI
        || (typeof window !== 'undefined' ? window.LIBRA_WorldCoreXAPI : null)
        || null;
    } catch (_) {
      return null;
    }
  };
  const getWorldCoreXSnapshot = (context = {}) => {
    const api = getWorldCoreXApi();
    if (!api?.peekWorldSnapshot) return null;
    try {
      const snapshot = api.peekWorldSnapshot(context);
      return snapshot && typeof snapshot === 'object' ? snapshot : null;
    } catch (_) {
      return null;
    }
  };
  const extractUserText = (context = {}) => normalizeText(
    context?.userMessage
    || context?.userMsg
    || context?.userMsgForNarrative
    || context?.userMsgForMemory
    || context?.requestContainer?.messages?.slice?.(-1)?.[0]?.content
    || (() => {
      const messages = getChatMessages(context?.chat);
      const lastUser = [...messages].reverse().find(isUserLikeMessage);
      return getMessageText(lastUser);
    })()
    || ''
  );
  const extractAssistantText = (context = {}) => normalizeText(
    context?.assistantText
    || context?.aiResponse
    || context?.memorySourceText
    || context?.displayContent
    || context?.responsePayload?.content
    || context?.pendingResponseText
    || context?.aiResponseRaw
    || context?.resultText
    || context?.responseText
    || (() => {
      const messages = getChatMessages(context?.chat);
      const lastAssistant = [...messages].reverse().find(isAssistantLikeMessage);
      return getMessageText(lastAssistant);
    })()
    || ''
  );
  const collectRecentWindowText = (context = {}, count = 6) => getChatMessages(context?.chat)
    .slice(-Math.max(2, count))
    .map(getMessageText)
    .map(text => compactText(text, 220))
    .filter(Boolean)
    .join('\n');
  const buildTurnKey = (context = {}, scopeId = 'global') => normalizeText([
    scopeId,
    context?.latestMessageId,
    context?.sourceHash,
    context?.turn,
    simpleHash(`${extractUserText(context)}|${extractAssistantText(context)}`)
  ].join('|'));

  const normalizeName = (value = '') => normalizeText(value);
  const KOREAN_ENTITY_PARTICLE_SUFFIXES = [
    '으로부터', '에게서', '한테서', '에게는', '한테는', '으로는',
    '이라는', '라는', '에게', '한테', '께서', '께는', '에서', '부터', '까지',
    '처럼', '보다', '으로', '로서', '로써', '와는', '과는', '하고', '랑은',
    '이는', '가', '이', '은', '는', '을', '를', '의', '도', '만', '께', '와', '과', '랑', '로'
  ].sort((a, b) => b.length - a.length);
  const KOREAN_ENTITY_NOISE_WORDS = new Set([
    '그녀', '그녀가', '그녀는', '그녀의', '그녀를', '그녀에게', '그녀에게서',
    '그는', '그가', '그의', '그를', '그에게', '그에게서',
    '그들', '그들이', '그들은', '그들의', '그들을', '그들에게',
    '그것', '그건', '그게', '그걸', '그곳', '그때', '거기', '여기', '저기',
    '누군가', '누구', '무언가', '무엇', '무어라', '뭐라', '뭐라고', '어느새',
    '그리고', '그러나', '하지만', '그래서', '또한', '마치', '다시', '이미',
    '어쩌면', '아마', '그저', '그런데', '그러자', '그럼', '이제', '잠시'
  ]);
  const KOREAN_ENTITY_COMMON_NOUN_NOISE = new Set([
    '소리', '손끝', '고개', '어깨', '눈동자', '표정', '미소', '한숨', '침묵',
    '입술', '시선', '책상', '의자', '창가', '교실', '동아리방', '가방', '손가락',
    '얼굴', '귓불', '눈빛', '목소리', '호흡', '심장', '책장', '책', '방과후',
    '스륵', '수룩', '사락', '부스럭', '바스락', '덜컥', '흠칫', '힐끗', '살짝', '가만'
  ]);
  const stripKoreanParticleSuffix = (value = '') => {
    const name = normalizeName(value);
    if (!/^[가-힣]{2,10}$/.test(name)) return '';
    if (KOREAN_ENTITY_NOISE_WORDS.has(name) || KOREAN_ENTITY_COMMON_NOUN_NOISE.has(name)) return '';
    for (const suffix of KOREAN_ENTITY_PARTICLE_SUFFIXES) {
      if (!name.endsWith(suffix) || name.length <= suffix.length + 1) continue;
      const stem = name.slice(0, -suffix.length).trim();
      if (/^[가-힣]{2,6}$/.test(stem) && !KOREAN_ENTITY_NOISE_WORDS.has(stem) && !KOREAN_ENTITY_COMMON_NOUN_NOISE.has(stem)) return stem;
    }
    return '';
  };
  const isInvalidEntityNameToken = (value = '') => {
    const name = normalizeName(value);
    if (!name) return true;
    if (KOREAN_ENTITY_NOISE_WORDS.has(name) || KOREAN_ENTITY_COMMON_NOUN_NOISE.has(name)) return true;
    if (/^(?:someone|somebody|anyone|person|people|she|he|they|her|him|them|it|this|that|and|but|or|so|then|what|why|where|when|how)$/i.test(name)) return true;
    if (/^[0-9]+$/.test(name) || /^[가-힣]{1}$/.test(name)) return true;
    if (/^[가-힣]{2,10}$/.test(name) && stripKoreanParticleSuffix(name)) return true;
    return false;
  };
  const getEntityReferenceTokens = (entity = {}) => {
    if (isInvalidEntityNameToken(entity?.name || entity?.identity?.name || '')) return [];
    const aliases = [
      entity?.name,
      ...(Array.isArray(entity?.identity?.aliases) ? entity.identity.aliases : []),
      ...(Array.isArray(entity?.meta?.aliases) ? entity.meta.aliases : []),
      ...(Array.isArray(entity?.aliases) ? entity.aliases : [])
    ];
    return uniqueTexts(aliases, 16);
  };
  const mentionsEntity = (text = '', entity = {}) => {
    const source = String(text || '');
    if (!source) return false;
    return getEntityReferenceTokens(entity).some(token => token && source.includes(token));
  };
  const extractEntityNamesFromText = (text = '', entityCache = new Map()) => {
    if (!(entityCache instanceof Map)) return [];
    const found = [];
    entityCache.forEach((entity, rawName) => {
      const name = normalizeName(rawName || entity?.name || '');
      if (!name || isInvalidEntityNameToken(name)) return;
      if (mentionsEntity(text, entity)) found.push(name);
    });
    return uniqueTexts(found, 12);
  };
  const getEntityCache = (context = {}) => {
    const cache = context?.EntityManager?.getEntityCache?.();
    return cache instanceof Map ? cache : new Map();
  };
  const getFocusEntities = (context = {}, limit = 3) => {
    const entityCache = getEntityCache(context);
    if (!(entityCache instanceof Map) || entityCache.size === 0) return [];
    const requestText = [extractUserText(context), collectRecentWindowText(context, 4)].filter(Boolean).join('\n');
    const mentioned = [];
    const fallback = [];
    entityCache.forEach((entity, rawName) => {
      const name = normalizeName(rawName || entity?.name || '');
      if (!entity || !name || isInvalidEntityNameToken(name)) return;
      if (mentionsEntity(requestText, entity)) mentioned.push(entity);
      else fallback.push(entity);
    });
    return [...mentioned, ...fallback].slice(0, Math.max(1, limit));
  };

  const normalizeDirectEntry = (entry = {}) => {
    const entityNames = uniqueTexts(entry?.entityNames || [], 12);
    const assistantText = compactText(entry?.assistantText || entry?.text || '', 16000);
    const userText = compactText(entry?.userText || '', 5000);
    const preview = compactText(
      entry?.preview
      || entry?.episode
      || assistantText
      || userText,
      220
    );
    const turn = Math.max(0, Number(entry?.turn || 0));
    const signature = normalizeText(entry?.signature || entry?.sourceHash || `${turn}:${preview}`) || simpleHash(`${turn}|${preview}`);
    return {
      id: normalizeText(entry?.id || `direct:${simpleHash(`${signature}|${entry?.latestMessageId || ''}`)}`) || `direct:${simpleHash(signature)}`,
      signature,
      turn,
      createdAt: Number(entry?.createdAt || Date.now()),
      updatedAt: Number(entry?.updatedAt || Date.now()),
      phase: normalizeText(entry?.phase || 'finalize') || 'finalize',
      latestMessageId: normalizeText(entry?.latestMessageId || ''),
      sourceHash: normalizeText(entry?.sourceHash || simpleHash(`${userText}|${assistantText}`)),
      sourceMessageIds: uniqueTexts(entry?.sourceMessageIds || [], 16),
      userText,
      assistantText,
      episode: compactText(entry?.episode || assistantText || preview, 360),
      preview,
      entityNames,
      locations: uniqueTexts(entry?.locations || [], 6),
      moods: uniqueTexts(entry?.moods || [], 6),
      dialogue: uniqueTexts(entry?.dialogue || [], 6),
      continuityHints: uniqueTexts(entry?.continuityHints || [], 8),
      importance: clampInt(entry?.importance, 5, 1, 10),
      ttl: Number.isFinite(Number(entry?.ttl)) ? Number(entry.ttl) : -1,
      archived: entry?.archived === true
    };
  };

  const normalizePreviousEntry = (entry = {}) => ({
    id: normalizeText(entry?.id || entry?.archiveKey || `previous:${simpleHash(`${entry?.fromTurn || 0}|${entry?.toTurn || 0}|${entry?.summary || ''}`)}`) || `previous:${Date.now().toString(36)}`,
    archiveKey: normalizeText(entry?.archiveKey || entry?.id || ''),
    fromTurn: Math.max(0, Number(entry?.fromTurn || 0)),
    toTurn: Math.max(0, Number(entry?.toTurn || entry?.turn || 0)),
    createdAt: Number(entry?.createdAt || Date.now()),
    updatedAt: Number(entry?.updatedAt || Date.now()),
    title: compactText(entry?.title || '', 160),
    summary: compactText(entry?.summary || entry?.title || entry?.content || '', 320),
    content: compactText(entry?.content || entry?.summary || '', 5200),
    sourceEntryIds: uniqueTexts(entry?.sourceEntryIds || [], 32),
    entityNames: uniqueTexts(entry?.entityNames || [], 12),
    locations: uniqueTexts(entry?.locations || [], 8),
    moods: uniqueTexts(entry?.moods || [], 8),
    relationHighlights: uniqueTexts(entry?.relationHighlights || [], 8)
  });

  const normalizePendingCapture = (capture = {}) => {
    const assistantText = compactText(capture?.assistantText || capture?.text || '', 16000);
    const userText = compactText(capture?.userText || '', 5000);
    const sourceHash = normalizeText(capture?.sourceHash || simpleHash(`${userText}|${assistantText}`));
    return {
      id: normalizeText(capture?.id || `pending:${simpleHash(`${capture?.latestMessageId || ''}|${sourceHash}`)}`) || `pending:${Date.now().toString(36)}`,
      predictedTurn: Math.max(0, Number(capture?.predictedTurn || capture?.turn || 0)),
      createdAt: Number(capture?.createdAt || Date.now()),
      updatedAt: Number(capture?.updatedAt || Date.now()),
      latestMessageId: normalizeText(capture?.latestMessageId || ''),
      sourceHash,
      sourceMessageIds: uniqueTexts(capture?.sourceMessageIds || [], 16),
      userText,
      assistantText,
      entityNames: uniqueTexts(capture?.entityNames || [], 12),
      signature: normalizeText(capture?.signature || `${capture?.latestMessageId || ''}:${sourceHash}`),
      phase: normalizeText(capture?.phase || 'afterRequest') || 'afterRequest',
      reason: normalizeText(capture?.reason || capture?.phase || 'afterRequest') || 'afterRequest'
    };
  };

  const normalizeRepairItem = (item = {}) => ({
    id: normalizeText(item?.id || `repair:${simpleHash(`${item?.type || ''}|${item?.reason || ''}|${Date.now()}`)}`),
    type: normalizeText(item?.type || 'repair') || 'repair',
    reason: compactText(item?.reason || '', 220),
    confidence: clampNumber(item?.confidence, 0.7, 0, 1),
    directIds: uniqueTexts(item?.directIds || [], 24),
    previousIds: uniqueTexts(item?.previousIds || [], 24),
    pendingIds: uniqueTexts(item?.pendingIds || [], 24),
    createdAt: Number(item?.createdAt || Date.now()),
    updatedAt: Number(item?.updatedAt || Date.now())
  });

  const buildEmptyStore = (scopeId = 'global') => ({
    version: 2,
    scopeId,
    updatedAt: Date.now(),
    directEntries: [],
    previousEntries: [],
    pendingCaptures: [],
    repairQueue: []
  });

  const normalizeStore = (store = {}, scopeId = 'global') => {
    const settings = getSettings();
    const normalizedScopeId = normalizeText(scopeId || store?.scopeId || 'global') || 'global';
    return {
      version: 2,
      scopeId: normalizedScopeId,
      updatedAt: Number(store?.updatedAt || Date.now()),
      directEntries: ensureArray(store?.directEntries)
        .map(normalizeDirectEntry)
        .filter(entry => entry.preview)
        .sort((left, right) => Number(left.turn || 0) - Number(right.turn || 0) || Number(left.createdAt || 0) - Number(right.createdAt || 0))
        .slice(-settings.maxDirectEntries),
      previousEntries: ensureArray(store?.previousEntries)
        .map(normalizePreviousEntry)
        .filter(entry => entry.summary || entry.content)
        .sort((left, right) => Number(left.toTurn || 0) - Number(right.toTurn || 0) || Number(left.createdAt || 0) - Number(right.createdAt || 0))
        .slice(-settings.maxPreviousEntries),
      pendingCaptures: ensureArray(store?.pendingCaptures)
        .map(normalizePendingCapture)
        .filter(entry => entry.assistantText || entry.userText)
        .sort((left, right) => Number(left.predictedTurn || 0) - Number(right.predictedTurn || 0) || Number(left.createdAt || 0) - Number(right.createdAt || 0))
        .slice(-settings.maxPendingCaptures),
      repairQueue: ensureArray(store?.repairQueue)
        .map(normalizeRepairItem)
        .filter(entry => entry.type)
        .slice(-settings.maxRepairQueue)
    };
  };

  const getStoreKey = (scopeId = 'global') => `${STORAGE_KEYS.entityStorePrefix}${normalizeText(scopeId) || 'global'}`;
  const getStoreEntryCount = (store = {}) => (
    ensureArray(store?.directEntries).length
    + ensureArray(store?.previousEntries).length
    + ensureArray(store?.pendingCaptures).length
    + ensureArray(store?.repairQueue).length
  );
  const loadStoreIndex = async () => {
    const parsed = safeJsonParse(await storageGetItem(STORAGE_KEYS.entityStoreIndex), null);
    return {
      version: 1,
      updatedAt: Number(parsed?.updatedAt || 0),
      scopes: ensureArray(parsed?.scopes)
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
      const sourceRows = [...ensureArray(store?.directEntries), ...ensureArray(store?.pendingCaptures)];
      const nextEntry = {
        scopeId: normalizedScopeId,
        updatedAt: Number(store?.updatedAt || Date.now()),
        directEntries: ensureArray(store?.directEntries).length,
        previousEntries: ensureArray(store?.previousEntries).length,
        pendingCaptures: ensureArray(store?.pendingCaptures).length,
        sourceHashes: uniqueTexts(sourceRows.map(entry => entry?.sourceHash).filter(Boolean), 80),
        sourceMessageIds: uniqueTexts(sourceRows.flatMap(entry => entry?.sourceMessageIds || entry?.latestMessageId || []).filter(Boolean), 80)
      };
      const index = await loadStoreIndex();
      await storageSetItem(STORAGE_KEYS.entityStoreIndex, JSON.stringify({
        version: 1,
        updatedAt: Date.now(),
        scopes: [nextEntry, ...index.scopes.filter(entry => entry.scopeId !== normalizedScopeId)].slice(0, 240)
      }));
      return true;
    } catch (_) {
      return false;
    }
  };
  const importStoreFromCopiedChatIfNeeded = async (context = {}, targetScopeId = '') => {
    const normalizedTarget = normalizeText(targetScopeId) || resolveScopeId(context);
    if (!normalizedTarget || normalizedTarget === 'global') return null;
    const sourceScopeId = resolveExplicitCopySourceScopeId(context);
    if (!sourceScopeId || sourceScopeId === normalizedTarget || sourceScopeId === 'global') {
      return importStoreFromNativeCopiedChatIfNeeded(context, normalizedTarget);
    }
    const targetStore = await loadStore(normalizedTarget);
    if (getStoreEntryCount(targetStore || {}) > 0) return null;
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
    updateRuntimeStatus('chat copy Entity Core X store imported', {
      scopeId: normalizedTarget,
      copiedFromScopeId: sourceScopeId
    });
    return { scopeId: normalizedTarget, store: committed, copiedFromScopeId: sourceScopeId, match: { mode: 'explicit-source' } };
  };
  const loadStore = async (scopeId = 'global') => {
    const normalizedScopeId = normalizeText(scopeId) || 'global';
    if (storeCache.has(normalizedScopeId)) return storeCache.get(normalizedScopeId);
    let raw = await storageGetItem(getStoreKey(normalizedScopeId));
    let migratedFromLegacyDmaPrefix = false;
    if (!normalizeText(raw || '')) {
      const legacyRaw = await storageGetItem(`${STORAGE_KEYS.dmaPrefix}${normalizedScopeId}`);
      if (normalizeText(legacyRaw || '')) {
        raw = legacyRaw;
        migratedFromLegacyDmaPrefix = true;
      }
    }
    const normalized = normalizeStore(safeJsonParse(raw, buildEmptyStore(normalizedScopeId)), normalizedScopeId);
    storeCache.set(normalizedScopeId, normalized);
    if (migratedFromLegacyDmaPrefix) {
      try {
        await storageSetItem(getStoreKey(normalizedScopeId), JSON.stringify(normalized));
      } catch (error) {
        updateRuntimeStatus('Entity legacy store migration failed', {
          scopeId: normalizedScopeId,
          error: error?.message || String(error || 'migration_failed')
        });
      }
    }
    return normalized;
  };
  const commitStore = async (scopeId = 'global', store = {}) => {
    const normalizedScopeId = normalizeText(scopeId) || 'global';
    const normalized = normalizeStore(store, normalizedScopeId);
    normalized.updatedAt = Date.now();
    storeCache.set(normalizedScopeId, normalized);
    const saved = await storageSetItem(getStoreKey(normalizedScopeId), JSON.stringify(normalized));
    if (saved) void saveStoreIndexEntry(normalizedScopeId, normalized);
    return normalized;
  };

  const getLocalMessageId = (msg = {}, index = 0) => normalizeText(
    msg?.m_id
    || msg?.id
    || msg?.messageId
    || msg?.message_id
    || msg?.uuid
    || `${index}`
  );

  const buildLocalLiveTurnAlignmentPlanForChat = (chat = null) => {
    const messages = getChatMessages(chat);
    const turns = [];
    const messageIdToTurn = new Map();
    let pendingUser = null;
    let turn = 0;
    messages.forEach((msg, index) => {
      const text = normalizeText(getMessageText(msg));
      if (!text) return;
      const messageId = getLocalMessageId(msg, index);
      if (isUserLikeMessage(msg)) {
        pendingUser = { text, messageId, index };
        return;
      }
      if (!isAssistantLikeMessage(msg)) return;
      turn += 1;
      const userText = normalizeText(pendingUser?.text || '');
      const sourceMessageIds = uniqueTexts([pendingUser?.messageId, messageId].filter(Boolean), 8);
      const row = {
        turn,
        userText,
        assistantText: text,
        latestMessageId: messageId,
        sourceMessageIds,
        sourceHash: normalizeText(simpleHash(`${userText}|${text}`)),
        userTokens: tokenize(userText),
        assistantTokens: tokenize(text)
      };
      turns.push(row);
      sourceMessageIds.forEach((id) => messageIdToTurn.set(String(id), row));
      pendingUser = null;
    });
    return {
      liveTurnCount: turns.length,
      turns,
      messageIdToTurn
    };
  };

  const resolveCurrentChatLiveAnchor = (context = {}, scopeId = 'global') => {
    const chat = context?.chat;
    if (!chat || typeof chat !== 'object') return null;
    const sharedResolver = typeof globalThis?.resolveTargetedLiveTurnForChat === 'function'
      ? globalThis.resolveTargetedLiveTurnForChat
      : null;
    const source = {
      turn: context?.turn,
      latestMessageId: context?.latestMessageId,
      sourceMessageIds: context?.sourceMessageIds,
      sourceHash: context?.sourceHash,
      userText: extractUserText(context),
      assistantText: extractAssistantText(context)
    };
    if (sharedResolver) {
      try {
        const resolved = sharedResolver(chat, source, { scopeId });
        if (resolved && Number(resolved?.turn || 0) > 0) return resolved;
      } catch (_) {}
    }
    const plan = buildLocalLiveTurnAlignmentPlanForChat(chat);
    const latestMessageId = normalizeText(context?.latestMessageId || '');
    const sourceMessageIds = uniqueTexts(context?.sourceMessageIds || [], 12);
    if (latestMessageId && plan.messageIdToTurn.has(latestMessageId)) return plan.messageIdToTurn.get(latestMessageId);
    for (const messageId of sourceMessageIds) {
      const row = plan.messageIdToTurn.get(String(messageId || ''));
      if (row) return row;
    }
    const userTokens = tokenize(extractUserText(context));
    const assistantTokens = tokenize(extractAssistantText(context));
    let best = null;
    let bestScore = 0;
    plan.turns.forEach((row) => {
      const assistantScore = tokenSimilarity(assistantTokens, row.assistantTokens || []);
      const userScore = tokenSimilarity(userTokens, row.userTokens || []);
      const turnProximity = Math.max(0, 1 - (Math.abs(Number(context?.turn || 0) - Number(row.turn || 0)) / 8));
      const score = (assistantScore * 0.68) + (userScore * 0.24) + (turnProximity * 0.08);
      if (score > bestScore) {
        bestScore = score;
        best = row;
      }
    });
    return bestScore >= 0.4 ? { ...best, matched: true } : null;
  };

  const resolveDirectEntryLiveAnchor = (entry = {}, chat = null, scopeId = 'global') => {
    if (!chat || typeof chat !== 'object') return null;
    const sharedResolver = typeof globalThis?.resolveTargetedLiveTurnForChat === 'function'
      ? globalThis.resolveTargetedLiveTurnForChat
      : null;
    const source = {
      turn: entry?.turn,
      latestMessageId: entry?.latestMessageId,
      sourceMessageIds: entry?.sourceMessageIds,
      sourceHash: entry?.sourceHash,
      userText: entry?.userText,
      assistantText: entry?.assistantText,
      preview: entry?.preview
    };
    if (sharedResolver) {
      try {
        const resolved = sharedResolver(chat, source, { scopeId });
        if (resolved && Number(resolved?.turn || 0) > 0) return { ...resolved, matched: true };
      } catch (_) {}
    }
    const plan = buildLocalLiveTurnAlignmentPlanForChat(chat);
    const latestMessageId = normalizeText(entry?.latestMessageId || '');
    const sourceMessageIds = uniqueTexts(entry?.sourceMessageIds || [], 12);
    if (latestMessageId && plan.messageIdToTurn.has(latestMessageId)) return { ...plan.messageIdToTurn.get(latestMessageId), matched: true };
    for (const messageId of sourceMessageIds) {
      const row = plan.messageIdToTurn.get(String(messageId || ''));
      if (row) return { ...row, matched: true };
    }
    const userTokens = tokenize(entry?.userText || '');
    const assistantTokens = tokenize(entry?.assistantText || entry?.preview || '');
    let best = null;
    let bestScore = 0;
    plan.turns.forEach((row) => {
      const assistantScore = tokenSimilarity(assistantTokens, row.assistantTokens || []);
      const userScore = tokenSimilarity(userTokens, row.userTokens || []);
      const turnProximity = Math.max(0, 1 - (Math.abs(Number(entry?.turn || 0) - Number(row.turn || 0)) / 8));
      const score = (assistantScore * 0.68) + (userScore * 0.22) + (turnProximity * 0.1);
      if (score > bestScore) {
        bestScore = score;
        best = row;
      }
    });
    return bestScore >= 0.4 ? { ...best, matched: true } : null;
  };

  const remapPreviousEntriesFromDirectStore = (store = {}) => {
    const directById = new Map(ensureArray(store?.directEntries).map(entry => {
      const normalized = normalizeDirectEntry(entry);
      return [String(normalized.id || ''), normalized];
    }));
    store.previousEntries = ensureArray(store?.previousEntries).map((entry) => {
      const normalized = normalizePreviousEntry(entry);
      const sourceTurns = ensureArray(normalized?.sourceEntryIds)
        .map(id => Number(directById.get(String(id || ''))?.turn || 0))
        .filter(turn => Number.isFinite(turn) && turn > 0);
      if (!sourceTurns.length) return normalized;
      return normalizePreviousEntry({
        ...normalized,
        fromTurn: Math.min(...sourceTurns),
        toTurn: Math.max(...sourceTurns),
        updatedAt: Date.now()
      });
    });
  };

  const mergeDirectEntriesByLiveAnchor = (entries = []) => {
    const groups = new Map();
    const idRedirect = new Map();
    ensureArray(entries).map(normalizeDirectEntry).forEach((entry) => {
      const sourceIdsKey = uniqueTexts(entry?.sourceMessageIds || [], 12).join('|');
      const key = normalizeText([
        sourceIdsKey,
        entry?.latestMessageId,
        entry?.sourceHash,
        simpleHash(`${entry?.userText || ''}|${entry?.assistantText || entry?.preview || ''}`)
      ].join('|'));
      const group = groups.get(key) || [];
      group.push(entry);
      groups.set(key, group);
    });
    const merged = [];
    let mergedAway = 0;
    groups.forEach((group) => {
      if (!group.length) return;
      const ordered = group.slice().sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
      const keeper = { ...ordered[0] };
      for (let index = 1; index < ordered.length; index += 1) {
        const row = ordered[index];
        mergedAway += 1;
        idRedirect.set(String(row.id || ''), String(keeper.id || ''));
        keeper.turn = Math.min(Math.max(0, Number(keeper.turn || 0)), Math.max(0, Number(row.turn || 0))) || Math.max(0, Number(keeper.turn || 0)) || Math.max(0, Number(row.turn || 0));
        keeper.updatedAt = Math.max(Number(keeper.updatedAt || 0), Number(row.updatedAt || 0), Date.now());
        keeper.sourceMessageIds = uniqueTexts([...(keeper.sourceMessageIds || []), ...(row.sourceMessageIds || [])], 16);
        keeper.entityNames = uniqueTexts([...(keeper.entityNames || []), ...(row.entityNames || [])], 12);
        keeper.locations = uniqueTexts([...(keeper.locations || []), ...(row.locations || [])], 8);
        keeper.moods = uniqueTexts([...(keeper.moods || []), ...(row.moods || [])], 8);
        keeper.continuityHints = uniqueTexts([...(keeper.continuityHints || []), ...(row.continuityHints || [])], 8);
        keeper.importance = Math.max(Number(keeper.importance || 0), Number(row.importance || 0));
        if (!keeper.userText && row.userText) keeper.userText = row.userText;
        if (!keeper.assistantText && row.assistantText) keeper.assistantText = row.assistantText;
        if (!keeper.preview && row.preview) keeper.preview = row.preview;
        if (!keeper.episode && row.episode) keeper.episode = row.episode;
        if (!keeper.latestMessageId && row.latestMessageId) keeper.latestMessageId = row.latestMessageId;
        if (!keeper.sourceHash && row.sourceHash) keeper.sourceHash = row.sourceHash;
      }
      merged.push(normalizeDirectEntry(keeper));
    });
    return {
      entries: merged
        .sort((a, b) => Number(a.turn || 0) - Number(b.turn || 0) || Number(a.createdAt || 0) - Number(b.createdAt || 0)),
      mergedAway,
      idRedirect
    };
  };

  const reconcileStoreWithLiveChat = async (scopeId = 'global', store = {}, chat = null) => {
    if (!chat || typeof chat !== 'object') return { store, directTurnChanges: 0, pendingTurnChanges: 0, directMerged: 0, previousTurnChanges: 0, targetedMatches: 0 };
    let directTurnChanges = 0;
    let pendingTurnChanges = 0;
    let targetedMatches = 0;
    store.directEntries = ensureArray(store?.directEntries).map((entry) => {
      const normalized = normalizeDirectEntry(entry);
      const anchor = resolveDirectEntryLiveAnchor(normalized, chat, scopeId);
      if (!anchor || Number(anchor?.turn || 0) <= 0) return normalized;
      const nextSourceMessageIds = uniqueTexts(anchor?.sourceMessageIds || normalized?.sourceMessageIds || [], 16);
      const nextLatestMessageId = normalizeText(anchor?.latestMessageId || nextSourceMessageIds[0] || normalized?.latestMessageId || '');
      const nextSourceHash = normalizeText(anchor?.sourceHash || normalized?.sourceHash || '');
      const previousIdsKey = uniqueTexts(normalized?.sourceMessageIds || [], 16).join('|');
      const nextIdsKey = nextSourceMessageIds.join('|');
      const changed =
        Number(normalized?.turn || 0) !== Number(anchor?.turn || 0)
        || normalizeText(normalized?.latestMessageId || '') !== nextLatestMessageId
        || normalizeText(normalized?.sourceHash || '') !== nextSourceHash
        || previousIdsKey !== nextIdsKey;
      if (!changed) return normalized;
      directTurnChanges += 1;
      if (anchor?.matched) targetedMatches += 1;
      return normalizeDirectEntry({
        ...normalized,
        turn: Math.max(0, Number(anchor?.turn || 0)),
        latestMessageId: nextLatestMessageId,
        sourceHash: nextSourceHash,
        sourceMessageIds: nextSourceMessageIds,
        updatedAt: Date.now()
      });
    });
    store.pendingCaptures = ensureArray(store?.pendingCaptures).map((capture) => {
      const normalized = normalizePendingCapture(capture);
      const anchor = resolveDirectEntryLiveAnchor({
        turn: normalized?.predictedTurn,
        latestMessageId: normalized?.latestMessageId,
        sourceMessageIds: normalized?.sourceMessageIds,
        sourceHash: normalized?.sourceHash,
        userText: normalized?.userText,
        assistantText: normalized?.assistantText
      }, chat, scopeId);
      if (!anchor || Number(anchor?.turn || 0) <= 0) return normalized;
      const nextSourceMessageIds = uniqueTexts(anchor?.sourceMessageIds || normalized?.sourceMessageIds || [], 16);
      const nextLatestMessageId = normalizeText(anchor?.latestMessageId || nextSourceMessageIds[0] || normalized?.latestMessageId || '');
      const nextSourceHash = normalizeText(anchor?.sourceHash || normalized?.sourceHash || '');
      const previousIdsKey = uniqueTexts(normalized?.sourceMessageIds || [], 16).join('|');
      const nextIdsKey = nextSourceMessageIds.join('|');
      const changed =
        Number(normalized?.predictedTurn || 0) !== Number(anchor?.turn || 0)
        || normalizeText(normalized?.latestMessageId || '') !== nextLatestMessageId
        || normalizeText(normalized?.sourceHash || '') !== nextSourceHash
        || previousIdsKey !== nextIdsKey;
      if (!changed) return normalized;
      pendingTurnChanges += 1;
      return normalizePendingCapture({
        ...normalized,
        predictedTurn: Math.max(0, Number(anchor?.turn || 0)),
        latestMessageId: nextLatestMessageId,
        sourceHash: nextSourceHash,
        sourceMessageIds: nextSourceMessageIds,
        updatedAt: Date.now()
      });
    });
    const mergedDirect = mergeDirectEntriesByLiveAnchor(store.directEntries || []);
    store.directEntries = mergedDirect.entries;
    if (mergedDirect.idRedirect.size) {
      store.previousEntries = ensureArray(store?.previousEntries).map((entry) => normalizePreviousEntry({
        ...entry,
        sourceEntryIds: uniqueTexts(ensureArray(entry?.sourceEntryIds).map(id => mergedDirect.idRedirect.get(String(id || '')) || String(id || '')), 32)
      }));
    }
    remapPreviousEntriesFromDirectStore(store);
    archiveHistoricalDirectEntries(store, Math.max(0, ...ensureArray(store?.directEntries).map(entry => Number(entry?.turn || 0))));
    const committed = await commitStore(scopeId, store);
    return {
      store: committed,
      directTurnChanges,
      pendingTurnChanges,
      directMerged: mergedDirect.mergedAway,
      previousTurnChanges: ensureArray(committed?.previousEntries).length,
      targetedMatches
    };
  };

  const buildPreviousEntryFromDirectGroup = (entries = []) => {
    const list = ensureArray(entries).map(normalizeDirectEntry).filter(Boolean);
    if (list.length < Math.max(2, getSettings().archiveMinGroupSize)) return null;
    const fromTurn = Math.max(0, Number(list[0]?.turn || 0));
    const toTurn = Math.max(0, Number(list[list.length - 1]?.turn || 0));
    const sourceEntryIds = list.map(entry => String(entry.id || '')).filter(Boolean);
    const entityNames = uniqueTexts(list.flatMap(entry => entry.entityNames || []), 12);
    const summary = compactText(
      list.map(entry => entry.preview || entry.episode || '').filter(Boolean).join(' | '),
      320
    );
    return normalizePreviousEntry({
      id: `previous:${simpleHash(sourceEntryIds.join('|'))}`,
      archiveKey: `previous:${simpleHash(sourceEntryIds.join('|'))}`,
      fromTurn,
      toTurn,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      title: `Turns ${fromTurn}-${toTurn}`,
      summary,
      content: list.map(entry => `[T${entry.turn}] ${entry.episode || entry.preview || ''}`).join('\n'),
      sourceEntryIds,
      entityNames,
      locations: uniqueTexts(list.flatMap(entry => entry.locations || []), 8),
      moods: uniqueTexts(list.flatMap(entry => entry.moods || []), 8),
      relationHighlights: uniqueTexts(list.flatMap(entry => entry.continuityHints || []), 8)
    });
  };

  const archiveHistoricalDirectEntries = (store = {}, currentTurn = 0) => {
    const settings = getSettings();
    const directEntries = ensureArray(store?.directEntries).map(normalizeDirectEntry);
    const previousEntries = ensureArray(store?.previousEntries).map(normalizePreviousEntry);
    const alreadyArchivedIds = new Set(previousEntries.flatMap(entry => entry.sourceEntryIds || []).map(id => String(id || '')));
    const eligible = directEntries
      .filter(entry => !entry.archived && !alreadyArchivedIds.has(String(entry.id || '')))
      .filter(entry => (Math.max(0, Number(currentTurn || 0)) - Math.max(0, Number(entry.turn || 0))) >= settings.archiveMinAgeTurns);
    if (eligible.length < settings.archiveMinGroupSize) {
      store.directEntries = directEntries;
      store.previousEntries = previousEntries.slice(-settings.maxPreviousEntries);
      return store;
    }

    const groups = [];
    let buffer = [];
    let lastTurn = -1;
    for (const entry of eligible) {
      const turn = Math.max(0, Number(entry.turn || 0));
      if (!buffer.length) {
        buffer.push(entry);
        lastTurn = turn;
        continue;
      }
      if ((turn - lastTurn) <= settings.archiveGroupTurns) {
        buffer.push(entry);
        lastTurn = turn;
      } else {
        if (buffer.length >= settings.archiveMinGroupSize) groups.push(buffer);
        buffer = [entry];
        lastTurn = turn;
      }
    }
    if (buffer.length >= settings.archiveMinGroupSize) groups.push(buffer);

    const nextPrevious = previousEntries.slice();
    const archivedIds = new Set();
    groups.forEach((group) => {
      const previous = buildPreviousEntryFromDirectGroup(group);
      if (!previous) return;
      if (nextPrevious.some(entry => String(entry.archiveKey || entry.id || '') === String(previous.archiveKey || previous.id || ''))) return;
      nextPrevious.push(previous);
      group.forEach(entry => archivedIds.add(String(entry.id || '')));
    });

    store.directEntries = directEntries.map((entry) => (
      archivedIds.has(String(entry.id || ''))
        ? { ...entry, archived: true }
        : entry
    )).slice(-settings.maxDirectEntries);
    store.previousEntries = nextPrevious
      .sort((left, right) => Number(left.toTurn || 0) - Number(right.toTurn || 0) || Number(left.createdAt || 0) - Number(right.createdAt || 0))
      .slice(-settings.maxPreviousEntries);
    return store;
  };

  const buildCaptureSignature = (capture = {}) => normalizeText([
    capture?.latestMessageId,
    capture?.sourceHash,
    capture?.predictedTurn,
    simpleHash(`${capture?.userText || ''}|${capture?.assistantText || ''}`)
  ].join('|'));

  const upsertPendingCapture = (store = {}, capture = {}) => {
    const normalized = normalizePendingCapture(capture);
    const signature = buildCaptureSignature(normalized);
    const pending = ensureArray(store?.pendingCaptures).map(normalizePendingCapture);
    const index = pending.findIndex(entry => buildCaptureSignature(entry) === signature);
    if (index >= 0) {
      pending[index] = normalizePendingCapture({
        ...pending[index],
        ...normalized,
        sourceMessageIds: uniqueTexts([...(pending[index]?.sourceMessageIds || []), ...(normalized?.sourceMessageIds || [])], 16),
        entityNames: uniqueTexts([...(pending[index]?.entityNames || []), ...(normalized?.entityNames || [])], 12),
        updatedAt: Date.now()
      });
    } else {
      pending.push(normalized);
    }
    store.pendingCaptures = pending.slice(-getSettings().maxPendingCaptures);
    return {
      changed: true,
      entry: index >= 0 ? store.pendingCaptures[index] : normalized
    };
  };

  const upsertDirectEntry = (store = {}, entry = {}) => {
    const normalized = normalizeDirectEntry(entry);
    const directEntries = ensureArray(store?.directEntries).map(normalizeDirectEntry);
    const index = directEntries.findIndex((row) =>
      (normalized.latestMessageId && row.latestMessageId === normalized.latestMessageId)
      || (normalized.sourceHash && row.sourceHash === normalized.sourceHash && Number(row.turn || 0) === Number(normalized.turn || 0))
      || (normalized.signature && row.signature === normalized.signature)
    );
    if (index >= 0) {
      directEntries[index] = normalizeDirectEntry({
        ...directEntries[index],
        ...normalized,
        sourceMessageIds: uniqueTexts([...(directEntries[index]?.sourceMessageIds || []), ...(normalized?.sourceMessageIds || [])], 16),
        entityNames: uniqueTexts([...(directEntries[index]?.entityNames || []), ...(normalized?.entityNames || [])], 12),
        locations: uniqueTexts([...(directEntries[index]?.locations || []), ...(normalized?.locations || [])], 8),
        moods: uniqueTexts([...(directEntries[index]?.moods || []), ...(normalized?.moods || [])], 8),
        continuityHints: uniqueTexts([...(directEntries[index]?.continuityHints || []), ...(normalized?.continuityHints || [])], 8),
        updatedAt: Date.now()
      });
      store.directEntries = directEntries;
      return { changed: true, entry: directEntries[index] };
    }
    directEntries.push(normalized);
    store.directEntries = directEntries.slice(-getSettings().maxDirectEntries);
    return { changed: true, entry: normalized };
  };

  const buildDirectEntryFromContext = (context = {}, phase = 'finalize') => {
    const scopeId = resolveScopeId(context);
    const liveAnchor = resolveCurrentChatLiveAnchor(context, scopeId);
    const userText = extractUserText(context);
    const assistantText = extractAssistantText(context);
    const recentText = [userText, assistantText].filter(Boolean).join('\n');
    if (!recentText) return null;
    const turn = Math.max(0, Number(liveAnchor?.turn || context?.turn || 0));
    const entityCache = getEntityCache(context);
    const entityNames = extractEntityNamesFromText(recentText, entityCache);
    return normalizeDirectEntry({
      id: `direct:${simpleHash(`${scopeId}|${context?.latestMessageId || ''}|${context?.sourceHash || ''}|${turn}|${recentText}`)}`,
      signature: `${scopeId}|${context?.latestMessageId || ''}|${context?.sourceHash || ''}|${turn}`,
      turn,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      phase,
      latestMessageId: normalizeText(context?.latestMessageId || liveAnchor?.latestMessageId || ''),
      sourceHash: normalizeText(context?.sourceHash || liveAnchor?.sourceHash || simpleHash(recentText)),
      sourceMessageIds: uniqueTexts(context?.sourceMessageIds || liveAnchor?.sourceMessageIds || [], 16),
      userText,
      assistantText,
      episode: compactText(assistantText || userText, 360),
      preview: compactText(assistantText || userText, 220),
      entityNames,
      locations: uniqueTexts(context?.locations || [], 8),
      moods: uniqueTexts(context?.moods || [], 8),
      continuityHints: uniqueTexts(context?.continuityHints || [], 8),
      importance: 6
    });
  };

  const capturePendingObservation = async (context = {}, phase = 'afterRequest') => {
    const scopeId = resolveScopeId(context);
    const directEntry = buildDirectEntryFromContext(context, phase);
    if (!directEntry) return 0;
    await importStoreFromCopiedChatIfNeeded(context, scopeId);
    const store = await loadStore(scopeId);
    const result = upsertPendingCapture(store, {
      id: `pending:${directEntry.id}`,
      predictedTurn: directEntry.turn,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      latestMessageId: directEntry.latestMessageId,
      sourceHash: directEntry.sourceHash,
      sourceMessageIds: directEntry.sourceMessageIds,
      userText: directEntry.userText,
      assistantText: directEntry.assistantText,
      entityNames: directEntry.entityNames,
      signature: directEntry.signature,
      phase,
      reason: phase
    });
    await commitStore(scopeId, store);
    return result?.changed ? 1 : 0;
  };

  const finalizeDirectCapture = async (context = {}, phase = 'finalize') => {
    const scopeId = resolveScopeId(context);
    const directEntry = buildDirectEntryFromContext(context, phase);
    if (!directEntry) return { changed: 0, entry: null, store: await loadStore(scopeId) };
    await importStoreFromCopiedChatIfNeeded(context, scopeId);
    const store = await loadStore(scopeId);
    const result = upsertDirectEntry(store, directEntry);
    const entrySignature = buildCaptureSignature({
      latestMessageId: directEntry.latestMessageId,
      sourceHash: directEntry.sourceHash,
      predictedTurn: directEntry.turn,
      userText: directEntry.userText,
      assistantText: directEntry.assistantText
    });
    store.pendingCaptures = ensureArray(store.pendingCaptures)
      .map(normalizePendingCapture)
      .filter(row => buildCaptureSignature(row) !== entrySignature);
    archiveHistoricalDirectEntries(store, directEntry.turn);
    let committed = await commitStore(scopeId, store);
    if (context?.chat && typeof context.chat === 'object') {
      const reconciled = await reconcileStoreWithLiveChat(scopeId, cloneValue(committed, buildEmptyStore(scopeId)), context.chat);
      committed = reconciled?.store || committed;
      updateRuntimeStatus('Entity Core X DMA reconcile complete', {
        scopeId,
        directTurnChanges: reconciled?.directTurnChanges || 0,
        pendingTurnChanges: reconciled?.pendingTurnChanges || 0,
        directMerged: reconciled?.directMerged || 0,
        targetedMatches: reconciled?.targetedMatches || 0
      });
    }
    return {
      changed: result?.changed ? 1 : 0,
      entry: result?.entry || directEntry,
      store: committed
    };
  };

  const formatPreviousMemoriesWithEvidence = (entries = [], store = {}, options = {}) => {
    const previousEntries = ensureArray(entries).map(normalizePreviousEntry);
    const directEntries = ensureArray(store?.directEntries).map(normalizeDirectEntry);
    if (!previousEntries.length) return '';
    const includeEvidence = options?.includeEvidence !== false;
    const maxEvidencePerItem = Math.max(1, Number(options?.maxEvidencePerItem || 2));
    return previousEntries.map((entry, index) => {
      const lines = [`[Recall ${index + 1}] (T${entry.fromTurn}-${entry.toTurn}) ${compactText(entry.summary || entry.title || '', 260)}`];
      if (includeEvidence) {
        const supporting = directEntries
          .filter(row => ensureArray(entry.sourceEntryIds).includes(String(row.id || '')))
          .slice(0, maxEvidencePerItem);
        supporting.forEach((row, rowIndex) => {
          lines.push(`  - evidence ${rowIndex + 1} (T${row.turn}): ${compactText(row.episode || row.preview || '', 180)}`);
        });
      }
      return lines.join('\n');
    }).join('\n');
  };

  const buildRecentDirectPromptFromStore = (store = {}, limit = 5) => {
    const recentEntries = ensureArray(store?.directEntries).map(normalizeDirectEntry).slice(-Math.max(1, Number(limit || 0)));
    if (!recentEntries.length) return '';
    return [
      '[Recent DMA Direct Memory]',
      ...recentEntries.map(entry => `- [T${entry.turn}] ${compactText(entry.preview || entry.episode || '', 180)}`)
    ].join('\n');
  };

  const buildPreviousSummaryPromptFromStore = (store = {}, limit = 4) => {
    const previousEntries = ensureArray(store?.previousEntries).map(normalizePreviousEntry).slice(-Math.max(1, Number(limit || 0)));
    if (!previousEntries.length) return '';
    return [
      '[Archived Previous Summaries]',
      formatPreviousMemoriesWithEvidence(previousEntries, store, {
        includeEvidence: true,
        maxEvidencePerItem: 2
      })
    ].join('\n');
  };

  const scoreMemoryMatch = (entry = {}, queryTokens = [], entityTokens = [], currentTurn = 0, isPrevious = false) => {
    const entryTokens = tokenize([
      entry?.preview,
      entry?.episode,
      entry?.summary,
      entry?.content,
      ensureArray(entry?.entityNames).join(' '),
      ensureArray(entry?.locations).join(' '),
      ensureArray(entry?.continuityHints).join(' ')
    ].filter(Boolean).join(' '));
    const queryScore = tokenSimilarity(entryTokens, queryTokens);
    const entityScore = tokenSimilarity(entryTokens, entityTokens);
    const recencyAnchor = Math.max(0, Number(isPrevious ? entry?.toTurn : entry?.turn || 0));
    const dist = Math.max(0, Math.max(0, Number(currentTurn || 0)) - recencyAnchor);
    const recencyScore = Math.exp(-dist / (isPrevious ? 40 : 18));
    return (queryScore * 0.52) + (entityScore * 0.28) + (recencyScore * 0.2);
  };

  const getDmaApi = () => {
    try {
      return globalThis?.LIBRA_DirectMemoryArchiveAPI
        || globalThis?.LIBRA?.DirectMemoryArchive
        || globalThis?.LIBRA?.DMA
        || null;
    } catch (_) {
      return null;
    }
  };

  const normalizeDmaEvidenceForEntity = (entry = {}, type = 'direct', scopeId = 'global') => {
    const raw = cloneValue(entry, {});
    const source = raw?.raw && typeof raw.raw === 'object' ? raw.raw : raw;
    if (type === 'previous') {
      return normalizePreviousEntry({
        ...source,
        id: source?.id || raw?.id,
        archiveKey: source?.archiveKey || raw?.archiveKey || raw?.id,
        fromTurn: source?.fromTurn || raw?.fromTurn || raw?.turn,
        toTurn: source?.toTurn || raw?.toTurn || raw?.turn,
        summary: source?.summary || source?.content || raw?.preview || raw?.summary || raw?.text || '',
        content: source?.content || source?.summary || raw?.preview || raw?.text || '',
        sourceMessageIds: source?.sourceMessageIds || raw?.sourceMessageIds || [],
        entityNames: source?.entityNames || source?.participants || raw?.entityNames || raw?.participants || [],
        locations: source?.locations || (source?.location ? [source.location] : []) || raw?.locations || [],
        scopeId
      });
    }
    return normalizeDirectEntry({
      ...source,
      id: source?.id || raw?.id,
      turn: source?.turn || raw?.turn || raw?.finalizedTurn || raw?.predictedTurn,
      preview: source?.preview || source?.episode || raw?.preview || raw?.summary || raw?.text || '',
      episode: source?.episode || source?.preview || raw?.preview || raw?.summary || raw?.text || '',
      userText: source?.userText || raw?.userText || '',
      assistantText: source?.assistantText || raw?.assistantText || raw?.preview || raw?.text || '',
      latestMessageId: source?.latestMessageId || raw?.latestMessageId || '',
      sourceHash: source?.sourceHash || raw?.sourceHash || '',
      sourceMessageIds: source?.sourceMessageIds || raw?.sourceMessageIds || [],
      entityNames: source?.entityNames || source?.participants || raw?.entityNames || raw?.participants || [],
      locations: source?.locations || (source?.location ? [source.location] : []) || raw?.locations || [],
      continuityHints: source?.continuityHints || raw?.continuityHints || [],
      scopeId
    });
  };

  const buildDegradedDmaEvidenceBundle = (scopeId = 'global', error = null) => ({
    scopeId,
    directEntries: [],
    previousEntries: [],
    pendingCaptures: [],
    repairQueue: [],
    sourceMessageIds: [],
    stats: {
      directCount: 0,
      previousCount: 0,
      pendingCount: 0,
      repairQueueCount: 0
    },
    degraded: true,
    errors: [compactText(error?.message || String(error || 'dma_evidence_unavailable'), 240)]
  });

  const collectDmaEvidenceForEntity = async (scopeId = 'global', options = {}) => {
    const normalizedScopeId = normalizeText(scopeId) || 'global';
    const directLimit = Math.max(1, Number(options?.directLimit || getSettings().qnaDirectLimit));
    const previousLimit = Math.max(1, Number(options?.previousLimit || getSettings().qnaPreviousLimit));
    const pendingLimit = Math.max(1, Number(options?.pendingLimit || getSettings().maxPendingCaptures || 8));
    const api = getDmaApi();
    if (api?.getEvidenceBundle) {
      try {
        const bundle = await api.getEvidenceBundle({
          scopeId: normalizedScopeId,
          directLimit,
          previousLimit,
          pendingLimit,
          includePending: false
        });
        const directEntries = ensureArray(bundle?.directEntries || bundle?.direct || [])
          .map(entry => normalizeDmaEvidenceForEntity(entry, 'direct', normalizedScopeId));
        const previousEntries = ensureArray(bundle?.previousEntries || bundle?.previous || [])
          .map(entry => normalizeDmaEvidenceForEntity(entry, 'previous', normalizedScopeId));
        const pendingCaptures = ensureArray(bundle?.pendingCaptures || bundle?.pending || [])
          .map(entry => normalizeDmaEvidenceForEntity(entry, 'direct', normalizedScopeId));
        return {
          scopeId: normalizedScopeId,
          directEntries,
          previousEntries,
          pendingCaptures,
          repairQueue: ensureArray(bundle?.repairQueue || bundle?.repair || []).map(entry => cloneValue(entry, {})),
          sourceMessageIds: uniqueTexts([
            ...directEntries.flatMap(entry => ensureArray(entry?.sourceMessageIds)),
            ...previousEntries.flatMap(entry => ensureArray(entry?.sourceMessageIds)),
            ...ensureArray(bundle?.sourceMessageIds)
          ], 64),
          stats: {
            directCount: Number(bundle?.stats?.directCount ?? bundle?.counts?.directEntries ?? directEntries.length),
            previousCount: Number(bundle?.stats?.previousCount ?? bundle?.counts?.previousEntries ?? previousEntries.length),
            pendingCount: Number(bundle?.stats?.pendingCount ?? bundle?.counts?.pendingCaptures ?? pendingCaptures.length),
            repairQueueCount: Number(bundle?.stats?.repairQueueCount ?? bundle?.counts?.repairQueue ?? ensureArray(bundle?.repairQueue || bundle?.repair).length)
          },
          degraded: bundle?.degraded === true,
          errors: ensureArray(bundle?.errors).map(error => compactText(error?.message || error, 240)).filter(Boolean)
        };
      } catch (error) {
        return buildDegradedDmaEvidenceBundle(normalizedScopeId, error);
      }
    }
    try {
      const raw = await storageGetItem(`${STORAGE_KEYS.dmaPrefix}${normalizedScopeId}`);
      const store = safeJsonParse(raw, buildEmptyStore(normalizedScopeId));
      const directEntries = ensureArray(store?.directEntries)
        .slice(-directLimit)
        .map(entry => normalizeDmaEvidenceForEntity(entry, 'direct', normalizedScopeId));
      const previousEntries = ensureArray(store?.previousEntries)
        .slice(-previousLimit)
        .map(entry => normalizeDmaEvidenceForEntity(entry, 'previous', normalizedScopeId));
      const pendingCaptures = ensureArray(store?.pendingCaptures)
        .slice(-pendingLimit)
        .map(entry => normalizeDmaEvidenceForEntity(entry, 'direct', normalizedScopeId));
      return {
        scopeId: normalizedScopeId,
        directEntries,
        previousEntries,
        pendingCaptures,
        repairQueue: ensureArray(store?.repairQueue).map(entry => cloneValue(entry, {})),
        sourceMessageIds: uniqueTexts([
          ...directEntries.flatMap(entry => ensureArray(entry?.sourceMessageIds)),
          ...previousEntries.flatMap(entry => ensureArray(entry?.sourceMessageIds))
        ], 64),
        stats: {
          directCount: ensureArray(store?.directEntries).length,
          previousCount: ensureArray(store?.previousEntries).length,
          pendingCount: ensureArray(store?.pendingCaptures).length,
          repairQueueCount: ensureArray(store?.repairQueue).length
        },
        degraded: true,
        errors: ['dma_public_api_unavailable_readonly_fallback']
      };
    } catch (error) {
      return buildDegradedDmaEvidenceBundle(normalizedScopeId, error);
    }
  };

  const queryEntityMemoryBundle = async (scopeId = 'global', entity = {}, options = {}) => {
    const settings = getSettings();
    const store = await loadStore(scopeId);
    const dmaBundle = await collectDmaEvidenceForEntity(scopeId, options);
    const evidenceDirect = [
      ...ensureArray(dmaBundle?.directEntries),
      ...ensureArray(store?.directEntries).map(normalizeDirectEntry)
    ];
    const evidencePrevious = [
      ...ensureArray(dmaBundle?.previousEntries),
      ...ensureArray(store?.previousEntries).map(normalizePreviousEntry)
    ];
    const queryText = normalizeText(options?.queryText || options?.query || '');
    const queryTokens = tokenize(queryText);
    const entityTokens = tokenize(getEntityReferenceTokens(entity).join(' '));
    const currentTurn = Math.max(
      0,
      Number(options?.currentTurn || 0),
      ...evidenceDirect.map(entry => Number(entry?.turn || 0)),
      ...evidencePrevious.map(entry => Number(entry?.toTurn || 0))
    );
    const directEntries = evidenceDirect
      .map(normalizeDirectEntry)
      .map(entry => ({ entry, score: scoreMemoryMatch(entry, queryTokens, entityTokens, currentTurn, false) }))
      .filter(row => row.score > 0.08 || ensureArray(row.entry?.entityNames).some(name => getEntityReferenceTokens(entity).includes(name)))
      .sort((left, right) => right.score - left.score || Number(right.entry?.turn || 0) - Number(left.entry?.turn || 0))
      .slice(0, Math.max(2, Number(options?.directLimit || settings.qnaDirectLimit)))
      .map(row => row.entry);
    const previousEntries = evidencePrevious
      .map(normalizePreviousEntry)
      .map(entry => ({ entry, score: scoreMemoryMatch(entry, queryTokens, entityTokens, currentTurn, true) }))
      .filter(row => row.score > 0.06 || ensureArray(row.entry?.entityNames).some(name => getEntityReferenceTokens(entity).includes(name)))
      .sort((left, right) => right.score - left.score || Number(right.entry?.toTurn || 0) - Number(left.entry?.toTurn || 0))
      .slice(0, Math.max(1, Number(options?.previousLimit || settings.qnaPreviousLimit)))
      .map(row => row.entry);
    const textBlocks = [];
    if (directEntries.length) {
      textBlocks.push([
        '[DMA Direct Evidence]',
        ...directEntries.map(entry => `- [T${entry.turn}] ${compactText(entry.preview || entry.episode || '', 180)}`)
      ].join('\n'));
    }
    if (previousEntries.length) {
      textBlocks.push([
        '[DMA Previous Evidence]',
        formatPreviousMemoriesWithEvidence(previousEntries, store, {
          includeEvidence: true,
          maxEvidencePerItem: 2
        })
      ].join('\n'));
    }
    return {
      scopeId,
      store,
      queryText,
      currentTurn,
      directEntries,
      previousEntries,
      pendingCaptures: ensureArray(dmaBundle?.pendingCaptures),
      sourceMessageIds: ensureArray(dmaBundle?.sourceMessageIds),
      degraded: dmaBundle?.degraded === true,
      errors: ensureArray(dmaBundle?.errors),
      dmaRefs: {
        direct: directEntries.map(entry => `direct:${entry.id}`),
        previous: previousEntries.map(entry => `previous:${entry.id}`)
      },
      text: textBlocks.join('\n\n'),
      highlights: [
        ...directEntries.map(entry => compactText(entry.preview || entry.episode || '', 180)),
        ...previousEntries.map(entry => compactText(entry.summary || entry.title || '', 180))
      ].filter(Boolean)
    };
  };

  const buildQnaMemoryBundleFromStore = async (scopeId = 'global', options = {}) => {
    const store = await loadStore(scopeId);
    const directLimit = Math.max(1, Number(options?.directLimit || getSettings().qnaDirectLimit));
    const previousLimit = Math.max(1, Number(options?.previousLimit || getSettings().qnaPreviousLimit));
    const directEntries = ensureArray(store?.directEntries).map(normalizeDirectEntry).slice(-directLimit);
    const previousEntries = ensureArray(store?.previousEntries).map(normalizePreviousEntry).slice(-previousLimit);
    return {
      layerId: 'dma',
      memoryLayerId: 'dma',
      text: [
        directEntries.length ? ['[Plugin Direct Memory Evidence]', ...directEntries.map(entry => `- ${compactText(entry.preview || entry.episode || '', 220)}`)].join('\n') : '',
        previousEntries.length ? ['[Plugin Previous Summary Evidence]', formatPreviousMemoriesWithEvidence(previousEntries, store, {
          includeEvidence: true,
          maxEvidencePerItem: 2
        })].join('\n') : ''
      ].filter(Boolean).join('\n\n'),
      highlights: [
        ...directEntries.map(entry => ({ comment: 'plugin_direct_memory', text: compactText(entry.preview || entry.episode || '', 220) })),
        ...previousEntries.map(entry => ({ comment: 'plugin_previous', text: compactText(entry.summary || entry.title || '', 220) }))
      ].filter(row => row.text)
    };
  };

  const buildCoreMemorySnapshotSync = (store = {}, options = {}) => ({
    scopeId: normalizeText(options?.scopeId || store?.scopeId || 'global') || 'global',
    directEntries: ensureArray(store?.directEntries).map(normalizeDirectEntry),
    previousEntries: ensureArray(store?.previousEntries).map(normalizePreviousEntry),
    pendingCaptures: ensureArray(store?.pendingCaptures).map(normalizePendingCapture),
    repairQueue: ensureArray(store?.repairQueue).map(normalizeRepairItem),
    stats: {
      directEntries: ensureArray(store?.directEntries).length,
      previousEntries: ensureArray(store?.previousEntries).length,
      pendingCaptures: ensureArray(store?.pendingCaptures).length,
      maxTurn: Math.max(0, ...ensureArray(store?.directEntries).map(entry => Number(entry?.turn || 0)))
    }
  });

  const buildCoreMemorySnapshot = async (scopeId = 'global', options = {}) => {
    const store = await loadStore(scopeId);
    return buildCoreMemorySnapshotSync(store, { ...options, scopeId });
  };

  const MemoryStore = {
    async loadStore(options = {}) {
      const scopeId = resolveScopeId(options);
      return cloneValue(await loadStore(scopeId), buildEmptyStore(scopeId));
    },
    peekStore(options = {}) {
      const scopeId = resolveScopeId(options);
      return cloneValue(storeCache.get(scopeId) || buildEmptyStore(scopeId), buildEmptyStore(scopeId));
    },
    async exportStore(options = {}) {
      const scopeId = resolveScopeId(options);
      return cloneValue(await loadStore(scopeId), buildEmptyStore(scopeId));
    },
    async replaceStore(options = {}) {
      const scopeId = resolveScopeId(options);
      return cloneValue(await commitStore(scopeId, normalizeStore(options?.store || {}, scopeId)), buildEmptyStore(scopeId));
    },
    async clearStore(options = {}) {
      const scopeId = resolveScopeId(options);
      return cloneValue(await commitStore(scopeId, buildEmptyStore(scopeId)), buildEmptyStore(scopeId));
    },
    async getDirectEntries(options = {}) {
      const scopeId = resolveScopeId(options);
      const store = await loadStore(scopeId);
      return cloneValue(ensureArray(store?.directEntries).slice(-Math.max(1, Number(options?.limit || getSettings().qnaDirectLimit))), []);
    },
    async getPreviousEntries(options = {}) {
      const scopeId = resolveScopeId(options);
      const store = await loadStore(scopeId);
      return cloneValue(ensureArray(store?.previousEntries).slice(-Math.max(1, Number(options?.limit || getSettings().qnaPreviousLimit))), []);
    },
    formatPreviousMemoriesWithEvidence(entries = [], store = {}, options = {}) {
      return formatPreviousMemoriesWithEvidence(entries, store, options);
    },
    async buildPreviousSummaryPrompt(options = {}) {
      const scopeId = resolveScopeId(options);
      return buildPreviousSummaryPromptFromStore(await loadStore(scopeId), options?.limit);
    },
    async buildDirectMemoryPrompt(options = {}) {
      const scopeId = resolveScopeId(options);
      return buildRecentDirectPromptFromStore(await loadStore(scopeId), options?.limit);
    },
    async buildQnaMemoryBundle(options = {}) {
      return cloneValue(await buildQnaMemoryBundleFromStore(resolveScopeId(options), options), { text: '', highlights: [] });
    },
    async buildCoreMemorySnapshot(options = {}) {
      return cloneValue(await buildCoreMemorySnapshot(resolveScopeId(options), options), null);
    },
    buildCoreMemorySnapshotSync(options = {}) {
      const scopeId = resolveScopeId(options);
      return cloneValue(buildCoreMemorySnapshotSync(storeCache.get(scopeId) || buildEmptyStore(scopeId), { ...options, scopeId }), null);
    },
    async appendMemory(options = {}) {
      const scopeId = resolveScopeId(options);
      const store = await loadStore(scopeId);
      const entry = normalizeDirectEntry({
        id: options?.id,
        signature: options?.signature,
        turn: options?.turn,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        phase: options?.phase || 'manual',
        latestMessageId: options?.latestMessageId,
        sourceHash: options?.sourceHash,
        sourceMessageIds: options?.sourceMessageIds,
        userText: options?.userText,
        assistantText: options?.assistantText || options?.text || '',
        episode: options?.episode || options?.text || '',
        preview: options?.preview || options?.text || '',
        entityNames: options?.entityNames || [],
        locations: options?.locations || [],
        moods: options?.moods || [],
        continuityHints: options?.continuityHints || [],
        importance: options?.importance || 7,
        ttl: options?.ttl
      });
      upsertDirectEntry(store, entry);
      archiveHistoricalDirectEntries(store, entry.turn);
      await commitStore(scopeId, store);
      return cloneValue(entry, null);
    },
    async importStore(options = {}) {
      const scopeId = resolveScopeId(options);
      const current = await loadStore(scopeId);
      const incoming = normalizeStore(options?.store || {}, scopeId);
      incoming.directEntries.forEach(entry => upsertDirectEntry(current, entry));
      current.previousEntries = uniqueTexts([
        ...current.previousEntries.map(entry => JSON.stringify(normalizePreviousEntry(entry))),
        ...incoming.previousEntries.map(entry => JSON.stringify(normalizePreviousEntry(entry)))
      ], getSettings().maxPreviousEntries).map(raw => safeJsonParse(raw, {}));
      await commitStore(scopeId, current);
      return cloneValue(current, buildEmptyStore(scopeId));
    },
    async reconcileWithLiveChat(options = {}) {
      const scopeId = resolveScopeId(options);
      const store = await loadStore(scopeId);
      const chat = options?.chat && typeof options.chat === 'object' ? options.chat : null;
      if (!chat) {
        return {
          ok: false,
          reason: 'missing_chat_context',
          scopeId,
          store: cloneValue(store, buildEmptyStore(scopeId))
        };
      }
      const result = await reconcileStoreWithLiveChat(scopeId, cloneValue(store, buildEmptyStore(scopeId)), chat);
      return {
        ok: true,
        scopeId,
        ...result
      };
    },
    async inspectRepairs(options = {}) {
      const scopeId = resolveScopeId(options);
      const store = await loadStore(scopeId);
      const repairs = [];
      const bySignature = new Map();
      ensureArray(store?.directEntries).map(normalizeDirectEntry).forEach((entry) => {
        const key = normalizeText(entry.signature || entry.sourceHash || '');
        if (!key) return;
        const list = bySignature.get(key) || [];
        list.push(entry);
        bySignature.set(key, list);
      });
      bySignature.forEach((entries, key) => {
        if (entries.length < 2) return;
        repairs.push(normalizeRepairItem({
          type: 'duplicate_direct_merge',
          reason: `duplicate_direct_group:${key}`,
          confidence: 0.94,
          directIds: entries.map(entry => entry.id)
        }));
      });
      const pendingBySignature = new Map();
      ensureArray(store?.pendingCaptures).map(normalizePendingCapture).forEach((entry) => {
        const key = buildCaptureSignature(entry);
        const list = pendingBySignature.get(key) || [];
        list.push(entry);
        pendingBySignature.set(key, list);
      });
      pendingBySignature.forEach((entries, key) => {
        if (entries.length < 2) return;
        repairs.push(normalizeRepairItem({
          type: 'duplicate_pending_drop',
          reason: `duplicate_pending_group:${key}`,
          confidence: 0.96,
          pendingIds: entries.map(entry => entry.id)
        }));
      });
      if (ensureArray(store?.directEntries).length > getSettings().maxDirectEntries) {
        repairs.push(normalizeRepairItem({
          type: 'archive_rebuild',
          reason: 'direct_entries_exceed_limit',
          confidence: 0.82,
          directIds: ensureArray(store?.directEntries).map(entry => entry.id)
        }));
      }
      return repairs;
    },
    async enqueueRepairs(options = {}) {
      const scopeId = resolveScopeId(options);
      const store = await loadStore(scopeId);
      store.repairQueue = [
        ...ensureArray(store?.repairQueue).map(normalizeRepairItem),
        ...ensureArray(options?.repairs).map(normalizeRepairItem)
      ].slice(-getSettings().maxRepairQueue);
      await commitStore(scopeId, store);
      return {
        queued: ensureArray(options?.repairs).length,
        pending: store.repairQueue.length,
        repairs: cloneValue(store.repairQueue, [])
      };
    },
    async applyRepairQueue(options = {}) {
      const scopeId = resolveScopeId(options);
      const store = await loadStore(scopeId);
      let applied = 0;
      const queue = ensureArray(store?.repairQueue).map(normalizeRepairItem);
      queue.forEach((repair) => {
        if (repair.type === 'duplicate_direct_merge') {
          const seen = new Set();
          store.directEntries = ensureArray(store?.directEntries)
            .map(normalizeDirectEntry)
            .filter((entry) => {
              const key = normalizeText(entry.signature || entry.sourceHash || '');
              if (!key) return true;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          applied += 1;
        }
        if (repair.type === 'duplicate_pending_drop') {
          const seen = new Set();
          store.pendingCaptures = ensureArray(store?.pendingCaptures)
            .map(normalizePendingCapture)
            .filter((entry) => {
              const key = buildCaptureSignature(entry);
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          applied += 1;
        }
        if (repair.type === 'archive_rebuild') {
          archiveHistoricalDirectEntries(store, Math.max(0, ...ensureArray(store?.directEntries).map(entry => Number(entry?.turn || 0))));
          applied += 1;
        }
      });
      store.repairQueue = [];
      await commitStore(scopeId, store);
      return {
        applied,
        pending: 0,
        store: cloneValue(store, buildEmptyStore(scopeId))
      };
    },
    async clearRepairQueue(options = {}) {
      const scopeId = resolveScopeId(options);
      const store = await loadStore(scopeId);
      store.repairQueue = [];
      await commitStore(scopeId, store);
      return {
        pending: 0,
        store: cloneValue(store, buildEmptyStore(scopeId))
      };
    },
    async getRepairQueue(options = {}) {
      const scopeId = resolveScopeId(options);
      return cloneValue((await loadStore(scopeId)).repairQueue || [], []);
    },
    getProcessedMessageIdsSync(options = {}) {
      const scopeId = resolveScopeId(options);
      const store = storeCache.get(scopeId) || buildEmptyStore(scopeId);
      return uniqueTexts(
        ensureArray(store?.directEntries).flatMap((entry) => [entry?.latestMessageId, ...(entry?.sourceMessageIds || [])]),
        9999
      );
    },
    getProcessedSourceHashesSync(options = {}) {
      const scopeId = resolveScopeId(options);
      const store = storeCache.get(scopeId) || buildEmptyStore(scopeId);
      return uniqueTexts(
        ensureArray(store?.directEntries).map(entry => normalizeText(entry?.sourceHash || '')).filter(Boolean),
        9999
      );
    }
  };

  const createDefaultStable = () => ({
    closenessNeed: 0.5,
    autonomyNeed: 0.5,
    controlNeed: 0.5,
    threatSensitivity: 0.5,
    shameSensitivity: 0.5,
    angerReadiness: 0.35,
    guardedness: 0.5,
    resilience: 0.5,
    emotionalExpressiveness: 0.5
  });

  const createDefaultDynamic = () => ({
    trust: 0.5,
    fear: 0.15,
    anger: 0.1,
    shame: 0.1,
    sadness: 0.1,
    longing: 0.1,
    jealousy: 0.05,
    relief: 0.1,
    emotionalPressure: 0.15,
    maskStrength: 0.5,
    activeMode: 'steady',
    currentGoal: '',
    speechBias: '',
    responseStyle: {
      disclosure: 0.5,
      warmth: 0.5,
      directness: 0.5,
      aggression: 0.2,
      avoidance: 0.3,
      appeasement: 0.2
    }
  });

  const createEmptyMindBranch = () => ({
    summary: '',
    nodes: []
  });

  const createDefaultVoiceSignature = () => ({
    sentenceLength: 'medium',
    directnessBase: 0.5,
    formalityBase: 0.5,
    metaphorUsage: 0.2,
    hesitationUsage: 0.3,
    emotionalLeakage: 0.4
  });

  const createDefaultLexicalHabits = () => ({
    favoriteWords: [],
    avoidedWords: [],
    addressingStyle: [],
    fillerWords: [],
    recurringPhrases: []
  });

  const createDefaultDialogueRules = () => ({
    confessesDirectly: false,
    apologizesDirectly: true,
    namesEmotionDirectly: false,
    usesQuestionsToDeflect: false
  });

  const createDefaultEmbodimentBodySignature = () => ({
    gazePattern: '',
    posturePattern: '',
    handHabit: '',
    movementTempo: '',
    tensionSignal: '',
    comfortSignal: ''
  });

  const createDefaultProximityStyle = () => ({
    defaultDistance: 'mid',
    touchTolerance: 0.3,
    territoriality: 0.5
  });

  const createDefaultPersonaMode = () => ({
    summary: '',
    directness: 0.5,
    warmth: 0.5,
    guardedness: 0.5,
    disclosure: 0.5
  });

  const createDefaultPersonaModes = () => ({
    byRelation: {
      superiors: createDefaultPersonaMode(),
      subordinates: createDefaultPersonaMode(),
      peers: createDefaultPersonaMode(),
      intimates: createDefaultPersonaMode(),
      enemies: createDefaultPersonaMode(),
      strangers: createDefaultPersonaMode()
    },
    byScene: {
      public: createDefaultPersonaMode(),
      private: createDefaultPersonaMode(),
      conflict: createDefaultPersonaMode(),
      romance: createDefaultPersonaMode(),
      danger: createDefaultPersonaMode(),
      shame: createDefaultPersonaMode()
    }
  });

  const createDefaultNsfw = () => ({
    profile: {
      sexualAttitudes: '',
      sexualPreferences: [],
      virginStatus: '',
      firstPartner: '',
      sexualHistory: ''
    },
    physiology: {
      gender: '',
      genitalProfile: '',
      semenReserve: '',
      cycle: {
        menstrualCycle: '',
        menstruationStatus: '',
        cycleDay: 0,
        cycleLengthDays: 28
      },
      pregnancy: {
        chance: '',
        status: '',
        riskScore: 0
      },
      sensitivity: '',
      stamina: {
        text: '',
        score: 50
      }
    },
    dynamic: {
      arousal: 0.1,
      restraint: 0.5,
      receptivity: 0.3,
      initiative: 0.3,
      consentRisk: 0,
      vulnerability: 0.3
    },
    intimacy: {
      counterparts: [],
      comfortSignals: [],
      refusalSignals: [],
      escalationTriggers: [],
      collapseTriggers: []
    },
    verification: {
      recentSignals: [],
      locks: [],
      patchQueue: []
    }
  });

  const createDefaultContinuity = () => ({
    currentSummary: '',
    psychologySummary: '',
    emotionSummary: '',
    sexualSummary: '',
    recentHistory: []
  });

  const createDefaultRelationshipIdentity = () => ({
    type: 'peer',
    stage: 'aware',
    publicStatus: 'private',
    primaryDynamic: 'balanced'
  });

  const createDefaultRelationshipCoreState = () => ({
    trust: 0.5,
    affection: 0.5,
    tension: 0.1,
    respect: 0.5,
    attraction: 0.1,
    grievance: 0.1
  });

  const createDefaultRelationshipDynamics = () => ({
    dependency: 0.3,
    openness: 0.5,
    boundarySafety: 0.5,
    volatility: 0.2,
    powerBalance: 0.5
  });

  const createDefaultRelationshipContext = () => ({
    publicMode: '',
    privateMode: '',
    obligations: [],
    sharedSecrets: [],
    taboos: []
  });

  const createDefaultRelationshipHistory = () => ({
    anchorEvents: [],
    recentShifts: [],
    openLoops: []
  });

  const createDefaultRelationshipState = () => ({
    version: 'relationship-v2',
    identity: createDefaultRelationshipIdentity(),
    coreState: createDefaultRelationshipCoreState(),
    dynamics: createDefaultRelationshipDynamics(),
    context: createDefaultRelationshipContext(),
    history: createDefaultRelationshipHistory(),
    notes: ''
  });

  const createEmptyEntityCoreX = (entity = {}) => ({
    version: 'entity-core-x',
    identity: {
      name: normalizeName(entity?.name || ''),
      aliases: uniqueTexts(entity?.identity?.aliases || entity?.aliases || [], 12),
      role: compactText(entity?.role || entity?.identity?.role || '', 120),
      summary: compactText(entity?.summary || entity?.description || '', 220)
    },
    profile: {
      traits: [],
      values: [],
      taboos: [],
      likes: [],
      dislikes: []
    },
    memory: {
      dmaRefs: {
        direct: [],
        previous: []
      },
      recallGraph: {
        nodes: {},
        audit: {
          lastInjectedIds: [],
          lastWarnings: [],
          lastSuggestions: [],
          lastSelectedRefs: [],
          lastStatus: '',
          lastQuery: '',
          lastUpdated: 0
        }
      }
    },
    mind: {
      coreMind: '',
      branches: {
        desire: createEmptyMindBranch(),
        fear: createEmptyMindBranch(),
        wound: createEmptyMindBranch(),
        mask: createEmptyMindBranch(),
        bond: createEmptyMindBranch(),
        fixation: createEmptyMindBranch()
      },
      selfNarrative: '',
      valueFrame: '',
      bodySignature: []
    },
    psyche: {
      stable: createDefaultStable(),
      dynamic: createDefaultDynamic(),
      relationshipModelVersion: 'v2-hybrid',
      relationships: {},
      relations: {},
      evidence: {
        recent: []
      },
      emotionBridge: normalizeEmotionBridgeState({})
    },
    expression: {
      voiceSignature: createDefaultVoiceSignature(),
      lexicalHabits: createDefaultLexicalHabits(),
      dialogueRules: createDefaultDialogueRules()
    },
    embodiment: {
      bodySignature: createDefaultEmbodimentBodySignature(),
      stressResponses: [],
      comfortResponses: [],
      proximityStyle: createDefaultProximityStyle()
    },
    selfModel: {
      selfNarrative: '',
      selfImage: '',
      deepestFearInterpretation: '',
      justificationFrame: '',
      valuePriority: [],
      shameCore: '',
      prideCore: ''
    },
    personaModes: createDefaultPersonaModes(),
    development: {
      longTermGoals: [],
      mediumTermGoals: [],
      immediateGoals: [],
      forbiddenLines: [],
      collapseTriggers: [],
      growthRules: [],
      regressionRules: []
    },
    continuity: createDefaultContinuity(),
    nsfw: createDefaultNsfw(),
    verification: {
      recentInvestigations: [],
      continuityLocks: [],
      predictions: [],
      opportunities: [],
      patchQueue: []
    },
    meta: {
      lastTurnKey: '',
      lastUpdated: 0,
      lastTemporalDate: ''
    }
  });

  const normalizeMindNode = (node = {}) => {
    const source = typeof node === 'string' ? { text: node } : (node && typeof node === 'object' ? node : {});
    return {
      text: compactText(source.text || '', 180),
      source: compactText(source.source || '', 80),
      dmaRefs: uniqueTexts(source.dmaRefs || [], 12),
      updatedAt: compactText(source.updatedAt || '', 40)
    };
  };

  const normalizeMindBranch = (branch = {}) => ({
    summary: compactText(branch?.summary || '', 180),
    nodes: ensureArray(branch?.nodes)
      .map(normalizeMindNode)
      .filter(node => node.text)
      .slice(0, 6)
  });

  const normalizeRecallNode = (node = {}) => ({
    id: normalizeText(node?.id || `recall:${simpleHash(`${node?.name || ''}|${node?.preview || ''}`)}`) || `recall:${Date.now().toString(36)}`,
    type: normalizeText(node?.type || 'event') || 'event',
    name: compactText(node?.name || node?.title || node?.preview || '', 120) || 'untitled',
    preview: compactText(node?.preview || node?.content || node?.summary || '', 240),
    dmaRefs: uniqueTexts(node?.dmaRefs || node?.sourceRefs || [], 12),
    keywords: uniqueTexts(node?.keywords || tokenize(`${node?.name || ''} ${node?.preview || ''}`), 18),
    activationScore: clampInt(node?.activationScore, 50, 0, 100),
    relationships: ensureArray(node?.relationships)
      .map((rel) => ({
        targetId: normalizeText(rel?.targetId || ''),
        type: normalizeText(rel?.type || 'related') || 'related',
        weight: clampNumber(rel?.weight, 0.5, 0, 1)
      }))
      .filter(rel => rel.targetId),
    promoted: node?.promoted === true,
    hitCount: clampInt(node?.hitCount, 0, 0, 9999),
    createdTurn: Math.max(0, Number(node?.createdTurn || 0)),
    lastSeenTurn: Math.max(0, Number(node?.lastSeenTurn || node?.createdTurn || 0))
  });

  const normalizeRecallGraph = (graph = {}) => {
    const rawNodes = graph?.nodes && typeof graph.nodes === 'object' ? graph.nodes : {};
    const nodes = {};
    Object.keys(rawNodes).forEach((nodeId) => {
      const normalized = normalizeRecallNode({ ...rawNodes[nodeId], id: nodeId });
      nodes[normalized.id] = normalized;
    });
    return {
      nodes,
      audit: {
        lastInjectedIds: uniqueTexts(graph?.audit?.lastInjectedIds || [], 24),
        lastWarnings: uniqueTexts(graph?.audit?.lastWarnings || [], 8),
        lastSuggestions: uniqueTexts(graph?.audit?.lastSuggestions || [], 8),
        lastSelectedRefs: uniqueTexts(graph?.audit?.lastSelectedRefs || [], 24),
        lastStatus: compactText(graph?.audit?.lastStatus || '', 180),
        lastQuery: compactText(graph?.audit?.lastQuery || '', 220),
        lastUpdated: Number(graph?.audit?.lastUpdated || 0)
      }
    };
  };

  const normalizePsychEvidenceRow = (row = {}) => ({
    signal: compactText(row?.signal || '', 40),
    snippet: compactText(row?.snippet || '', 160),
    weight: round3(row?.weight, 0)
  });

  const normalizeEmotionBridgeState = (row = {}) => ({
    mood: compactText(row?.mood || '', 120),
    signature: compactText(row?.signature || '', 80),
    blend: compactText(row?.blend || '', 120),
    intensity: round3(row?.intensity, 0),
    valence: clampNumber(row?.valence, 0, -1, 1),
    arousal: round3(row?.arousal, 0),
    control: round3(row?.control, 0.5),
    flags: {
      fear: row?.flags?.fear === true,
      anger: row?.flags?.anger === true,
      shame: row?.flags?.shame === true,
      sadness: row?.flags?.sadness === true,
      longing: row?.flags?.longing === true,
      relief: row?.flags?.relief === true,
      joy: row?.flags?.joy === true
    },
    summary: compactText(row?.summary || '', 220)
  });

  const normalizeVoiceSignature = (row = {}) => ({
    sentenceLength: ['short', 'medium', 'long'].includes(normalizeText(row?.sentenceLength || ''))
      ? normalizeText(row?.sentenceLength || '')
      : 'medium',
    directnessBase: round3(row?.directnessBase, 0.5),
    formalityBase: round3(row?.formalityBase, 0.5),
    metaphorUsage: round3(row?.metaphorUsage, 0.2),
    hesitationUsage: round3(row?.hesitationUsage, 0.3),
    emotionalLeakage: round3(row?.emotionalLeakage, 0.4)
  });

  const normalizeLexicalHabits = (row = {}) => ({
    favoriteWords: uniqueTexts(row?.favoriteWords || [], 8),
    avoidedWords: uniqueTexts(row?.avoidedWords || [], 8),
    addressingStyle: uniqueTexts(row?.addressingStyle || [], 6),
    fillerWords: uniqueTexts(row?.fillerWords || [], 6),
    recurringPhrases: uniqueTexts(row?.recurringPhrases || [], 6)
  });

  const normalizeDialogueRules = (row = {}) => ({
    confessesDirectly: row?.confessesDirectly === true,
    apologizesDirectly: row?.apologizesDirectly !== false,
    namesEmotionDirectly: row?.namesEmotionDirectly === true,
    usesQuestionsToDeflect: row?.usesQuestionsToDeflect === true
  });

  const normalizeEmbodimentBodySignature = (row = {}) => ({
    gazePattern: compactText(row?.gazePattern || '', 120),
    posturePattern: compactText(row?.posturePattern || '', 120),
    handHabit: compactText(row?.handHabit || '', 120),
    movementTempo: compactText(row?.movementTempo || '', 80),
    tensionSignal: compactText(row?.tensionSignal || '', 120),
    comfortSignal: compactText(row?.comfortSignal || '', 120)
  });

  const normalizeProximityStyle = (row = {}) => ({
    defaultDistance: ['close', 'mid', 'far'].includes(normalizeText(row?.defaultDistance || ''))
      ? normalizeText(row?.defaultDistance || '')
      : 'mid',
    touchTolerance: round3(row?.touchTolerance, 0.3),
    territoriality: round3(row?.territoriality, 0.5)
  });

  const normalizePersonaMode = (row = {}) => ({
    summary: compactText(row?.summary || '', 180),
    directness: round3(row?.directness, 0.5),
    warmth: round3(row?.warmth, 0.5),
    guardedness: round3(row?.guardedness, 0.5),
    disclosure: round3(row?.disclosure, 0.5)
  });

  const normalizeNsfw = (row = {}) => {
    const source = row && typeof row === 'object' ? row : {};
    const patchQueue = ensureArray(source?.verification?.patchQueue).map(normalizePatchItem).slice(-8);
    return {
      profile: {
        sexualAttitudes: compactText(source?.profile?.sexualAttitudes || '', 180),
        sexualPreferences: uniqueTexts(source?.profile?.sexualPreferences || [], 8),
        virginStatus: compactText(source?.profile?.virginStatus || '', 40),
        firstPartner: compactText(source?.profile?.firstPartner || '', 120),
        sexualHistory: compactText(source?.profile?.sexualHistory || '', 220)
      },
      physiology: {
        gender: compactText(source?.physiology?.gender || '', 40),
        genitalProfile: compactText(source?.physiology?.genitalProfile || '', 120),
        semenReserve: compactText(source?.physiology?.semenReserve || '', 80),
        cycle: {
          menstrualCycle: compactText(source?.physiology?.cycle?.menstrualCycle || '', 80),
          menstruationStatus: compactText(source?.physiology?.cycle?.menstruationStatus || '', 80),
          cycleDay: Math.max(0, Math.round(Number(source?.physiology?.cycle?.cycleDay || 0) || 0)),
          cycleLengthDays: clampInt(source?.physiology?.cycle?.cycleLengthDays, 28, 20, 40)
        },
        pregnancy: {
          chance: compactText(source?.physiology?.pregnancy?.chance || '', 80),
          status: compactText(source?.physiology?.pregnancy?.status || '', 80),
          riskScore: clampInt(source?.physiology?.pregnancy?.riskScore, 0, 0, 100)
        },
        sensitivity: compactText(source?.physiology?.sensitivity || '', 180),
        stamina: {
          text: compactText(source?.physiology?.stamina?.text || '', 80),
          score: clampInt(source?.physiology?.stamina?.score, 50, 0, 100)
        }
      },
      dynamic: {
        arousal: round3(source?.dynamic?.arousal, 0.1),
        restraint: round3(source?.dynamic?.restraint, 0.5),
        receptivity: round3(source?.dynamic?.receptivity, 0.3),
        initiative: round3(source?.dynamic?.initiative, 0.3),
        consentRisk: round3(source?.dynamic?.consentRisk, 0),
        vulnerability: round3(source?.dynamic?.vulnerability, 0.3)
      },
      intimacy: {
        counterparts: uniqueTexts(source?.intimacy?.counterparts || [], 6),
        comfortSignals: uniqueTexts(source?.intimacy?.comfortSignals || [], 6),
        refusalSignals: uniqueTexts(source?.intimacy?.refusalSignals || [], 6),
        escalationTriggers: uniqueTexts(source?.intimacy?.escalationTriggers || [], 6),
        collapseTriggers: uniqueTexts(source?.intimacy?.collapseTriggers || [], 6)
      },
      verification: {
        recentSignals: uniqueTexts(source?.verification?.recentSignals || [], 8),
        locks: uniqueTexts(source?.verification?.locks || [], 8),
        patchQueue
      }
    };
  };

  const normalizeContinuityHistoryItem = (row = {}) => ({
    turn: Math.max(0, Number(row?.turn || 0)),
    date: compactText(row?.date || '', 40),
    tag: compactText(row?.tag || 'STATUS', 24) || 'STATUS',
    text: compactText(row?.text || '', 220),
    label: compactText(row?.label || '', 80)
  });

  const normalizeContinuity = (row = {}) => {
    const source = row && typeof row === 'object' ? row : {};
    return {
      currentSummary: compactText(source?.currentSummary || '', 260),
      psychologySummary: compactText(source?.psychologySummary || '', 220),
      emotionSummary: compactText(source?.emotionSummary || '', 180),
      sexualSummary: compactText(source?.sexualSummary || '', 220),
      recentHistory: ensureArray(source?.recentHistory)
        .map(normalizeContinuityHistoryItem)
        .filter(item => item.text)
        .slice(-12)
    };
  };

  const pushContinuityHistory = (items = [], payload = {}, maxItems = 12) => {
    const next = ensureArray(items).map(normalizeContinuityHistoryItem).filter(item => item.text);
    const normalized = normalizeContinuityHistoryItem(payload);
    if (!normalized.text) return next.slice(-maxItems);
    const last = next[next.length - 1];
    if (last && last.tag === normalized.tag && last.text === normalized.text) {
      next[next.length - 1] = {
        ...last,
        turn: Math.max(Number(last.turn || 0), Number(normalized.turn || 0)),
        date: normalized.date || last.date,
        label: normalized.label || last.label
      };
      return next.slice(-maxItems);
    }
    next.push(normalized);
    return next.slice(-maxItems);
  };

  const normalizeLegacyRelationState = (row = {}) => ({
    trust: round3(row?.trust, 0.5),
    attachment: round3(row?.attachment, 0.5),
    tension: round3(row?.tension, 0.1),
    avoidance: round3(row?.avoidance, 0.3),
    resentment: round3(row?.resentment, 0.1)
  });

  const normalizeLegacyRelationMap = (relations = {}) => {
    const source = relations && typeof relations === 'object' ? relations : {};
    const next = {};
    Object.entries(source).forEach(([name, row]) => {
      const key = compactText(name || '', 80);
      if (!key) return;
      next[key] = normalizeLegacyRelationState(row);
    });
    return next;
  };

  const looksLikeLegacyRelationState = (row = {}) => (
    !!row
    && typeof row === 'object'
    && !row?.coreState
    && !row?.dynamics
    && (
      Object.prototype.hasOwnProperty.call(row, 'trust')
      || Object.prototype.hasOwnProperty.call(row, 'attachment')
      || Object.prototype.hasOwnProperty.call(row, 'tension')
      || Object.prototype.hasOwnProperty.call(row, 'avoidance')
      || Object.prototype.hasOwnProperty.call(row, 'resentment')
    )
  );

  const inferRelationshipType = (coreState = {}, dynamics = {}) => {
    if (coreState.grievance >= 0.68 && coreState.trust <= 0.34) return 'enemy';
    if (coreState.tension >= 0.64 && coreState.affection <= 0.38) return 'rival';
    if (coreState.affection >= 0.74 && coreState.trust >= 0.68 && coreState.attraction >= 0.5) return 'intimate';
    if (coreState.affection >= 0.62 && coreState.attraction >= 0.42) return 'romantic_interest';
    if (coreState.affection >= 0.62 && coreState.trust >= 0.58) return 'friend';
    if (coreState.trust >= 0.6 && coreState.respect >= 0.58) return 'ally';
    if (coreState.tension >= 0.56 && coreState.affection >= 0.46 && coreState.trust >= 0.42) return 'entangled';
    if (dynamics.powerBalance >= 0.66 && coreState.respect >= 0.62) return 'mentor_line';
    return 'peer';
  };

  const inferRelationshipStage = (coreState = {}, dynamics = {}) => {
    if (coreState.grievance >= 0.62 && coreState.trust <= 0.34) return 'fractured';
    if (coreState.affection >= 0.72 && coreState.trust >= 0.72) return 'bonded';
    if (coreState.tension >= 0.6 && dynamics.volatility >= 0.58) return 'unstable';
    if (coreState.tension >= 0.54) return 'strained';
    if (coreState.affection >= 0.58 || coreState.trust >= 0.58) return 'warming';
    return 'aware';
  };

  const inferRelationshipPublicStatus = (identity = {}, context = {}) => {
    const explicit = compactText(identity?.publicStatus || '', 32);
    if (explicit) return explicit;
    if (ensureArray(context?.sharedSecrets || []).length) return 'hidden';
    if (compactText(context?.publicMode || '', 40)) return 'public';
    return 'private';
  };

  const inferRelationshipPrimaryDynamic = (coreState = {}, dynamics = {}) => {
    if (dynamics.volatility >= 0.6) return 'volatile';
    if (dynamics.dependency >= 0.62 && coreState.affection >= 0.56) return 'dependent';
    if (coreState.tension >= 0.56 && dynamics.openness <= 0.44) return 'guarded';
    if (Math.abs(dynamics.powerBalance - 0.5) >= 0.16) return 'asymmetric';
    if (dynamics.openness >= 0.62 && dynamics.boundarySafety >= 0.6) return 'candid';
    return 'balanced';
  };

  const pickDominantRelationshipAxis = (coreState = {}, dynamics = {}) => {
    const candidates = [
      ['trust', Number(coreState?.trust || 0)],
      ['affection', Number(coreState?.affection || 0)],
      ['tension', Number(coreState?.tension || 0)],
      ['respect', Number(coreState?.respect || 0)],
      ['attraction', Number(coreState?.attraction || 0)],
      ['grievance', Number(coreState?.grievance || 0)],
      ['dependency', Number(dynamics?.dependency || 0)],
      ['openness', Number(dynamics?.openness || 0)]
    ].sort((left, right) => right[1] - left[1]);
    return compactText(candidates[0]?.[0] || 'trust', 24) || 'trust';
  };

  const buildRelationshipStateFromLegacy = (row = {}, target = '') => {
    const legacy = normalizeLegacyRelationState(row);
    const coreState = {
      trust: legacy.trust,
      affection: round3((legacy.attachment * 0.72) + (legacy.trust * 0.12), 0.5),
      tension: legacy.tension,
      respect: round3((legacy.trust * 0.58) + ((1 - legacy.resentment) * 0.18), 0.5),
      attraction: round3((legacy.attachment * 0.22) + ((1 - legacy.avoidance) * 0.06), 0.1),
      grievance: legacy.resentment
    };
    const dynamics = {
      dependency: round3((legacy.attachment * 0.52) + (legacy.trust * 0.12), 0.3),
      openness: round3((legacy.trust * 0.54) + ((1 - legacy.avoidance) * 0.18), 0.5),
      boundarySafety: round3((legacy.trust * 0.48) + ((1 - legacy.tension) * 0.18) + ((1 - legacy.resentment) * 0.14), 0.5),
      volatility: round3((legacy.tension * 0.42) + (legacy.resentment * 0.24), 0.2),
      powerBalance: 0.5
    };
    return {
      version: 'relationship-v2',
      identity: {
        type: inferRelationshipType(coreState, dynamics),
        stage: inferRelationshipStage(coreState, dynamics),
        publicStatus: 'private',
        primaryDynamic: inferRelationshipPrimaryDynamic(coreState, dynamics)
      },
      coreState,
      dynamics,
      context: createDefaultRelationshipContext(),
      history: createDefaultRelationshipHistory(),
      notes: target ? `Upgraded from legacy relation metrics for ${compactText(target, 80)}.` : 'Upgraded from legacy relation metrics.'
    };
  };

  const normalizeRelationshipState = (row = {}, target = '') => {
    const source = row && typeof row === 'object' ? row : {};
    const raw = looksLikeLegacyRelationState(source) ? buildRelationshipStateFromLegacy(source, target) : source;
    const base = createDefaultRelationshipState();
    const coreState = {
      trust: round3(raw?.coreState?.trust, base.coreState.trust),
      affection: round3(raw?.coreState?.affection, base.coreState.affection),
      tension: round3(raw?.coreState?.tension, base.coreState.tension),
      respect: round3(raw?.coreState?.respect, base.coreState.respect),
      attraction: round3(raw?.coreState?.attraction, base.coreState.attraction),
      grievance: round3(raw?.coreState?.grievance, base.coreState.grievance)
    };
    const dynamics = {
      dependency: round3(raw?.dynamics?.dependency, base.dynamics.dependency),
      openness: round3(raw?.dynamics?.openness, base.dynamics.openness),
      boundarySafety: round3(raw?.dynamics?.boundarySafety, base.dynamics.boundarySafety),
      volatility: round3(raw?.dynamics?.volatility, base.dynamics.volatility),
      powerBalance: round3(raw?.dynamics?.powerBalance, base.dynamics.powerBalance)
    };
    const identitySource = raw?.identity && typeof raw.identity === 'object' ? raw.identity : {};
    const contextSource = raw?.context && typeof raw.context === 'object' ? raw.context : {};
    const historySource = raw?.history && typeof raw.history === 'object' ? raw.history : {};
    const type = compactText(identitySource?.type || '', 40) || inferRelationshipType(coreState, dynamics);
    const stage = compactText(identitySource?.stage || '', 40) || inferRelationshipStage(coreState, dynamics);
    const publicStatus = inferRelationshipPublicStatus(identitySource, contextSource);
    const primaryDynamic = compactText(identitySource?.primaryDynamic || '', 40) || inferRelationshipPrimaryDynamic(coreState, dynamics);
    return {
      version: 'relationship-v2',
      identity: {
        type,
        stage,
        publicStatus,
        primaryDynamic
      },
      coreState,
      dynamics,
      context: {
        publicMode: compactText(contextSource?.publicMode || '', 120),
        privateMode: compactText(contextSource?.privateMode || '', 120),
        obligations: uniqueTexts(contextSource?.obligations || [], 8),
        sharedSecrets: uniqueTexts(contextSource?.sharedSecrets || [], 8),
        taboos: uniqueTexts(contextSource?.taboos || [], 8)
      },
      history: {
        anchorEvents: uniqueTexts(historySource?.anchorEvents || [], 8),
        recentShifts: uniqueTexts(historySource?.recentShifts || [], 8),
        openLoops: uniqueTexts(historySource?.openLoops || [], 8)
      },
      notes: compactText(raw?.notes || '', 220)
    };
  };

  const normalizeRelationshipMap = (relationships = {}) => {
    const source = relationships && typeof relationships === 'object' ? relationships : {};
    const next = {};
    Object.entries(source).forEach(([name, row]) => {
      const key = compactText(name || '', 80);
      if (!key) return;
      next[key] = normalizeRelationshipState(row, key);
    });
    return next;
  };

  const projectRelationshipStateToLegacy = (relationship = {}) => {
    if (looksLikeLegacyRelationState(relationship)) return normalizeLegacyRelationState(relationship);
    const normalized = normalizeRelationshipState(relationship);
    const coreState = normalized.coreState || createDefaultRelationshipCoreState();
    const dynamics = normalized.dynamics || createDefaultRelationshipDynamics();
    return {
      trust: round3(coreState.trust, 0.5),
      attachment: round3(
        (coreState.affection * 0.46)
        + (dynamics.dependency * 0.22)
        + (coreState.attraction * 0.12)
        + (coreState.respect * 0.1)
        + (coreState.trust * 0.1),
        0.5
      ),
      tension: round3(
        (coreState.tension * 0.68)
        + (dynamics.volatility * 0.18)
        + (coreState.grievance * 0.14),
        0.1
      ),
      avoidance: round3(
        ((1 - dynamics.openness) * 0.34)
        + ((1 - dynamics.boundarySafety) * 0.24)
        + (coreState.tension * 0.22)
        + (coreState.grievance * 0.12),
        0.3
      ),
      resentment: round3(
        (coreState.grievance * 0.72)
        + (coreState.tension * 0.12)
        + ((1 - coreState.respect) * 0.16),
        0.1
      )
    };
  };

  const projectRelationshipMapToLegacy = (relationships = {}) => {
    const source = relationships && typeof relationships === 'object' ? relationships : {};
    const next = {};
    Object.entries(source).forEach(([name, row]) => {
      const key = compactText(name || '', 80);
      if (!key) return;
      next[key] = projectRelationshipStateToLegacy(row);
    });
    return next;
  };

  const normalizeRelationMap = (relations = {}) => projectRelationshipMapToLegacy(normalizeRelationshipMap(relations));

  const normalizePatchItem = (item = {}) => ({
    id: normalizeText(item?.id || `patch:${simpleHash(`${item?.targetPath || ''}|${item?.reason || ''}|${item?.createdAt || Date.now()}`)}`),
    type: normalizeText(item?.type || 'proposal') || 'proposal',
    targetPath: normalizeText(item?.targetPath || item?.path || ''),
    op: normalizeText(item?.op || 'set') || 'set',
    value: cloneValue(item?.value, null),
    confidence: clampNumber(item?.confidence, 0.5, 0, 1),
    safe: item?.safe !== false,
    reason: compactText(item?.reason || '', 220),
    evidenceRefs: uniqueTexts(item?.evidenceRefs || [], 8),
    sourceInvestigation: normalizeText(item?.sourceInvestigation || ''),
    status: normalizeText(item?.status || 'pending') || 'pending',
    conflict: compactText(item?.conflict || '', 220),
    createdAt: Number(item?.createdAt || Date.now()),
    updatedAt: Number(item?.updatedAt || Date.now())
  });

  const dedupePatchQueue = (items = [], limit = getSettings().patchQueueLimit) => {
    const byId = new Map();
    ensureArray(items).map(normalizePatchItem).forEach((item) => {
      const key = normalizeText(item?.id || '');
      if (!key) return;
      const existing = byId.get(key);
      if (!existing) {
        byId.set(key, item);
        return;
      }
      byId.set(key, normalizePatchItem({
        ...existing,
        ...item,
        confidence: Math.max(Number(existing?.confidence || 0), Number(item?.confidence || 0)),
        evidenceRefs: uniqueTexts([...(existing?.evidenceRefs || []), ...(item?.evidenceRefs || [])], 8),
        updatedAt: Math.max(Number(existing?.updatedAt || 0), Number(item?.updatedAt || 0))
      }));
    });
    return Array.from(byId.values())
      .sort((left, right) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0) || Number(right?.confidence || 0) - Number(left?.confidence || 0))
      .slice(0, Math.max(1, limit));
  };

  const normalizeInvestigation = (row = {}) => ({
    key: normalizeText(row?.key || 'investigation') || 'investigation',
    focus: normalizeText(row?.focus || 'general') || 'general',
    question: compactText(row?.question || '', 320),
    answer: compactText(row?.answer || '', 480),
    suspicion: compactText(row?.suspicion || '', 320),
    verification: compactText(row?.verification || '', 320),
    result: compactText(row?.result || row?.answer || '', 360),
    confidence: clampNumber(row?.confidence, 0.45, 0, 1),
    patchConfidence: clampNumber(row?.patchConfidence, 0, 0, 1),
    entityNames: uniqueTexts(row?.entityNames || [], 8),
    evidenceRefs: uniqueTexts(row?.evidenceRefs || [], 8),
    patchable: row?.patchable === true
  });

  const normalizeEntityCoreX = (entity = {}, value = null) => {
    const base = createEmptyEntityCoreX(entity);
    const source = value && typeof value === 'object' ? value : (entity?.entityCoreX && typeof entity.entityCoreX === 'object' ? entity.entityCoreX : {});
    const profileSource = source?.profile && typeof source.profile === 'object' ? source.profile : {};
    const psycheSource = source?.psyche && typeof source.psyche === 'object' ? source.psyche : {};
    const expressionSource = source?.expression && typeof source.expression === 'object' ? source.expression : {};
    const embodimentSource = source?.embodiment && typeof source.embodiment === 'object' ? source.embodiment : {};
    const selfModelSource = source?.selfModel && typeof source.selfModel === 'object' ? source.selfModel : {};
    const personaModesSource = source?.personaModes && typeof source.personaModes === 'object' ? source.personaModes : {};
    const developmentSource = source?.development && typeof source.development === 'object' ? source.development : {};
    const continuitySource = source?.continuity && typeof source.continuity === 'object' ? source.continuity : {};
    const nsfwSource = source?.nsfw && typeof source.nsfw === 'object' ? source.nsfw : {};
    const verificationSource = source?.verification && typeof source.verification === 'object' ? source.verification : {};
    const upgradedLegacyRelationships = normalizeRelationshipMap(psycheSource?.relations || {});
    const normalizedRelationships = {
      ...upgradedLegacyRelationships,
      ...normalizeRelationshipMap(psycheSource?.relationships || psycheSource?.relationModel || {})
    };
    const next = {
      version: 'entity-core-x',
      identity: {
        name: normalizeName(source?.identity?.name || entity?.name || base.identity.name),
        aliases: uniqueTexts(source?.identity?.aliases || entity?.identity?.aliases || entity?.aliases || [], 12),
        role: compactText(source?.identity?.role || entity?.role || entity?.identity?.role || '', 120),
        summary: compactText(source?.identity?.summary || entity?.summary || entity?.description || '', 220)
      },
      profile: {
        traits: uniqueTexts(profileSource?.traits || entity?.personality?.traits || [], 12),
        values: uniqueTexts(profileSource?.values || entity?.personality?.values || [], 12),
        taboos: uniqueTexts(profileSource?.taboos || entity?.personality?.taboos || [], 12),
        likes: uniqueTexts(profileSource?.likes || entity?.personality?.likes || [], 12),
        dislikes: uniqueTexts(profileSource?.dislikes || entity?.personality?.dislikes || [], 12)
      },
      memory: {
        dmaRefs: {
          direct: uniqueTexts(source?.memory?.dmaRefs?.direct || [], 64),
          previous: uniqueTexts(source?.memory?.dmaRefs?.previous || [], 64)
        },
        recallGraph: normalizeRecallGraph(source?.memory?.recallGraph || {})
      },
      mind: {
        coreMind: compactText(source?.mind?.coreMind || '', 180),
        branches: BRANCH_ORDER.reduce((acc, branchKey) => {
          acc[branchKey] = normalizeMindBranch(source?.mind?.branches?.[branchKey] || {});
          return acc;
        }, {}),
        selfNarrative: compactText(source?.mind?.selfNarrative || '', 220),
        valueFrame: compactText(source?.mind?.valueFrame || '', 220),
        bodySignature: uniqueTexts(source?.mind?.bodySignature || [], 8)
      },
      psyche: {
        stable: {
          ...createDefaultStable(),
          ...(psycheSource?.stable && typeof psycheSource.stable === 'object' ? psycheSource.stable : {})
        },
        dynamic: {
          ...createDefaultDynamic(),
          ...(psycheSource?.dynamic && typeof psycheSource.dynamic === 'object' ? psycheSource.dynamic : {}),
          responseStyle: {
            ...createDefaultDynamic().responseStyle,
            ...((psycheSource?.dynamic?.responseStyle && typeof psycheSource.dynamic.responseStyle === 'object')
              ? psycheSource.dynamic.responseStyle
              : {})
          }
        },
        relationshipModelVersion: compactText(psycheSource?.relationshipModelVersion || 'v2-hybrid', 24) || 'v2-hybrid',
        relationships: normalizedRelationships,
        relations: projectRelationshipMapToLegacy(normalizedRelationships),
        evidence: {
          recent: ensureArray(psycheSource?.evidence?.recent).map(normalizePsychEvidenceRow).filter(row => row.signal && row.snippet).slice(-6)
        },
        emotionBridge: normalizeEmotionBridgeState(psycheSource?.emotionBridge || {})
      },
      expression: {
        voiceSignature: normalizeVoiceSignature({
          ...createDefaultVoiceSignature(),
          ...(expressionSource?.voiceSignature && typeof expressionSource.voiceSignature === 'object' ? expressionSource.voiceSignature : {})
        }),
        lexicalHabits: normalizeLexicalHabits(expressionSource?.lexicalHabits || {}),
        dialogueRules: normalizeDialogueRules({
          ...createDefaultDialogueRules(),
          ...(expressionSource?.dialogueRules && typeof expressionSource.dialogueRules === 'object' ? expressionSource.dialogueRules : {})
        })
      },
      embodiment: {
        bodySignature: normalizeEmbodimentBodySignature({
          ...createDefaultEmbodimentBodySignature(),
          ...(embodimentSource?.bodySignature && typeof embodimentSource.bodySignature === 'object' ? embodimentSource.bodySignature : {})
        }),
        stressResponses: uniqueTexts(embodimentSource?.stressResponses || [], 8),
        comfortResponses: uniqueTexts(embodimentSource?.comfortResponses || [], 8),
        proximityStyle: normalizeProximityStyle({
          ...createDefaultProximityStyle(),
          ...(embodimentSource?.proximityStyle && typeof embodimentSource.proximityStyle === 'object' ? embodimentSource.proximityStyle : {})
        })
      },
      selfModel: {
        selfNarrative: compactText(selfModelSource?.selfNarrative || source?.mind?.selfNarrative || '', 220),
        selfImage: compactText(selfModelSource?.selfImage || '', 220),
        deepestFearInterpretation: compactText(selfModelSource?.deepestFearInterpretation || '', 220),
        justificationFrame: compactText(selfModelSource?.justificationFrame || source?.mind?.valueFrame || '', 220),
        valuePriority: uniqueTexts(selfModelSource?.valuePriority || profileSource?.values || [], 8),
        shameCore: compactText(selfModelSource?.shameCore || '', 180),
        prideCore: compactText(selfModelSource?.prideCore || '', 180)
      },
      personaModes: {
        byRelation: {
          superiors: normalizePersonaMode(personaModesSource?.byRelation?.superiors || {}),
          subordinates: normalizePersonaMode(personaModesSource?.byRelation?.subordinates || {}),
          peers: normalizePersonaMode(personaModesSource?.byRelation?.peers || {}),
          intimates: normalizePersonaMode(personaModesSource?.byRelation?.intimates || {}),
          enemies: normalizePersonaMode(personaModesSource?.byRelation?.enemies || {}),
          strangers: normalizePersonaMode(personaModesSource?.byRelation?.strangers || {})
        },
        byScene: {
          public: normalizePersonaMode(personaModesSource?.byScene?.public || {}),
          private: normalizePersonaMode(personaModesSource?.byScene?.private || {}),
          conflict: normalizePersonaMode(personaModesSource?.byScene?.conflict || {}),
          romance: normalizePersonaMode(personaModesSource?.byScene?.romance || {}),
          danger: normalizePersonaMode(personaModesSource?.byScene?.danger || {}),
          shame: normalizePersonaMode(personaModesSource?.byScene?.shame || {})
        }
      },
      development: {
        longTermGoals: uniqueTexts(developmentSource?.longTermGoals || [], 8),
        mediumTermGoals: uniqueTexts(developmentSource?.mediumTermGoals || [], 8),
        immediateGoals: uniqueTexts(developmentSource?.immediateGoals || [], 8),
        forbiddenLines: uniqueTexts(developmentSource?.forbiddenLines || [], 8),
        collapseTriggers: uniqueTexts(developmentSource?.collapseTriggers || [], 8),
        growthRules: uniqueTexts(developmentSource?.growthRules || [], 8),
        regressionRules: uniqueTexts(developmentSource?.regressionRules || [], 8)
      },
      continuity: normalizeContinuity({
        ...createDefaultContinuity(),
        ...continuitySource
      }),
      nsfw: normalizeNsfw({
        ...createDefaultNsfw(),
        ...nsfwSource
      }),
      verification: {
        recentInvestigations: ensureArray(verificationSource?.recentInvestigations).map(normalizeInvestigation).slice(-8),
        continuityLocks: uniqueTexts(verificationSource?.continuityLocks || [], 8),
        predictions: uniqueTexts(verificationSource?.predictions || [], 8),
        opportunities: uniqueTexts(verificationSource?.opportunities || [], 8),
        patchQueue: dedupePatchQueue(verificationSource?.patchQueue || [], getSettings().patchQueueLimit)
      },
      meta: {
        lastTurnKey: compactText(source?.meta?.lastTurnKey || '', 160),
        lastUpdated: Number(source?.meta?.lastUpdated || 0),
        lastTemporalDate: compactText(source?.meta?.lastTemporalDate || '', 40)
      }
    };
    return next;
  };

  const mergeUniqueAtPath = (target = {}, path = '', items = []) => {
    const segments = String(path || '').split('.').filter(Boolean);
    if (!segments.length) return target;
    let cursor = target;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i];
      if (!cursor[segment] || typeof cursor[segment] !== 'object') cursor[segment] = {};
      cursor = cursor[segment];
    }
    const leaf = segments[segments.length - 1];
    cursor[leaf] = uniqueTexts([...(Array.isArray(cursor[leaf]) ? cursor[leaf] : []), ...ensureArray(items)], 24);
    return target;
  };

  const loadLegacyOmniGraph = async (scopeId = 'global') => safeJsonParse(await storageGetItem(`${STORAGE_KEYS.legacyOmniPrefix}${normalizeText(scopeId) || 'global'}`), null);
  const loadLegacyVerifierArchive = async (scopeId = 'global') => ensureArray(
    safeJsonParse(await storageGetItem(`${STORAGE_KEYS.qnaArchivePrefix}${normalizeText(scopeId) || 'global'}`), [])
  );

  const buildLegacyMindmapProjection = (core = {}) => ({
    coreMind: compactText(core?.mind?.coreMind || '', 160),
    lastUpdatedAt: core?.meta?.lastUpdated ? String(core.meta.lastUpdated) : '',
    branches: BRANCH_ORDER.reduce((acc, branchKey) => {
      const branch = core?.mind?.branches?.[branchKey] || createEmptyMindBranch();
      acc[branchKey] = {
        summary: compactText(branch?.summary || '', 180),
        nodes: ensureArray(branch?.nodes).map(node => ({
          text: compactText(node?.text || '', 180),
          source: compactText(node?.source || '', 80),
          updatedAt: compactText(node?.updatedAt || '', 40)
        })).filter(node => node.text).slice(0, 5)
      };
      return acc;
    }, {})
  });

  const buildLegacyPsychologyModuleProjection = (core = {}) => ({
    mainPsychology: compactText(core?.mind?.coreMind || '', 180),
    counterPsychology: compactText(core?.mind?.branches?.mask?.summary || core?.mind?.branches?.wound?.summary || '', 180),
    anxietyConditions: uniqueTexts([core?.mind?.branches?.fear?.summary], 6),
    stabilityConditions: uniqueTexts([core?.mind?.branches?.bond?.summary, core?.mind?.valueFrame], 6),
    defenseBehaviors: uniqueTexts([core?.mind?.branches?.mask?.summary], 6),
    motivations: uniqueTexts([core?.mind?.branches?.desire?.summary, core?.mind?.branches?.fixation?.summary], 6),
    coreValues: uniqueTexts(core?.profile?.values || [], 8),
    likes: uniqueTexts(core?.profile?.likes || [], 8),
    dislikes: uniqueTexts(core?.profile?.dislikes || [], 8),
    desires: uniqueTexts([core?.mind?.branches?.desire?.summary], 6),
    aspirations: uniqueTexts([core?.psyche?.dynamic?.currentGoal || core?.mind?.selfNarrative], 6),
    taboos: uniqueTexts(core?.profile?.taboos || [], 8)
  });

  const buildLegacyPsychologyEngineProjection = (core = {}) => ({
    stable: cloneValue(core?.psyche?.stable || createDefaultStable(), createDefaultStable()),
    dynamic: cloneValue(core?.psyche?.dynamic || createDefaultDynamic(), createDefaultDynamic()),
    relationshipModelVersion: compactText(core?.psyche?.relationshipModelVersion || 'v2-hybrid', 24) || 'v2-hybrid',
    relationships: cloneValue(core?.psyche?.relationships || {}, {}),
    relations: cloneValue(core?.psyche?.relations || projectRelationshipMapToLegacy(core?.psyche?.relationships || {}), {}),
    evidence: {
      recent: cloneValue(core?.psyche?.evidence?.recent || [], [])
    },
    meta: {
      lastTurnKey: compactText(core?.meta?.lastTurnKey || '', 160),
      lastUpdated: Number(core?.meta?.lastUpdated || 0)
    }
  });

  const buildLegacyNsfwGenitalProfile = (tracker = {}) => compactText([
    compactText(tracker?.genitalSizeProfile || '', 120),
    uniqueTexts([
      tracker?.genitalSizeIdleCm ? `idle ${compactText(tracker.genitalSizeIdleCm, 20)}` : '',
      tracker?.genitalSizeErectionCm ? `erect ${compactText(tracker.genitalSizeErectionCm, 20)}` : '',
      tracker?.genitalSizeErectionMaxCm ? `max ${compactText(tracker.genitalSizeErectionMaxCm, 20)}` : ''
    ], 3).join(' / ')
  ].filter(Boolean).join(' | '), 120);

  const mergeLegacyMindmapIntoCore = (core = {}, legacy = {}) => {
    if (!legacy || typeof legacy !== 'object') return core;
    if (legacy?.coreMind && !core.mind.coreMind) core.mind.coreMind = compactText(legacy.coreMind, 180);
    BRANCH_ORDER.forEach((branchKey) => {
      const branch = legacy?.branches?.[branchKey];
      if (!branch || typeof branch !== 'object') return;
      if (branch?.summary) {
        core.mind.branches[branchKey].summary = compactText(core.mind.branches[branchKey].summary || branch.summary, 180);
      }
      const legacyNodes = ensureArray(branch?.nodes).map(normalizeMindNode);
      core.mind.branches[branchKey].nodes = [
        ...legacyNodes,
        ...ensureArray(core.mind.branches[branchKey].nodes).map(normalizeMindNode)
      ].filter(node => node.text).slice(0, 6);
    });
    return core;
  };

  const mergeLegacyPsychologyModuleIntoCore = (core = {}, legacy = {}) => {
    if (!legacy || typeof legacy !== 'object') return core;
    mergeUniqueAtPath(core, 'profile.values', legacy?.coreValues || []);
    mergeUniqueAtPath(core, 'profile.likes', legacy?.likes || []);
    mergeUniqueAtPath(core, 'profile.dislikes', legacy?.dislikes || []);
    mergeUniqueAtPath(core, 'profile.taboos', legacy?.taboos || []);
    if (!core.mind.coreMind && legacy?.mainPsychology) core.mind.coreMind = compactText(legacy.mainPsychology, 180);
    if (!core.mind.branches.mask.summary && legacy?.counterPsychology) core.mind.branches.mask.summary = compactText(legacy.counterPsychology, 180);
    if (!core.mind.branches.fear.summary && ensureArray(legacy?.anxietyConditions).length) core.mind.branches.fear.summary = compactText(legacy.anxietyConditions[0], 180);
    if (!core.mind.branches.bond.summary && ensureArray(legacy?.stabilityConditions).length) core.mind.branches.bond.summary = compactText(legacy.stabilityConditions[0], 180);
    if (!core.mind.branches.desire.summary && ensureArray(legacy?.desires).length) core.mind.branches.desire.summary = compactText(legacy.desires[0], 180);
    if (!core.mind.branches.fixation.summary && ensureArray(legacy?.motivations).length) core.mind.branches.fixation.summary = compactText(legacy.motivations[0], 180);
    if (!core.mind.selfNarrative && ensureArray(legacy?.aspirations).length) core.mind.selfNarrative = compactText(legacy.aspirations[0], 220);
    return core;
  };

  const mergeLegacyPsychologyEngineIntoCore = (core = {}, legacy = {}) => {
    if (!legacy || typeof legacy !== 'object') return core;
    core.psyche.stable = {
      ...core.psyche.stable,
      ...(legacy?.stable && typeof legacy.stable === 'object' ? legacy.stable : {})
    };
    core.psyche.dynamic = {
      ...core.psyche.dynamic,
      ...(legacy?.dynamic && typeof legacy.dynamic === 'object' ? legacy.dynamic : {}),
      responseStyle: {
        ...core.psyche.dynamic.responseStyle,
        ...((legacy?.dynamic?.responseStyle && typeof legacy.dynamic.responseStyle === 'object')
          ? legacy.dynamic.responseStyle
          : {})
      }
    };
    core.psyche.relationshipModelVersion = compactText(
      legacy?.relationshipModelVersion || core?.psyche?.relationshipModelVersion || 'v2-hybrid',
      24
    ) || 'v2-hybrid';
    core.psyche.relationships = {
      ...normalizeRelationshipMap(core?.psyche?.relationships || core?.psyche?.relations || {}),
      ...normalizeRelationshipMap(legacy?.relations || {}),
      ...normalizeRelationshipMap(legacy?.relationships || {})
    };
    core.psyche.relations = projectRelationshipMapToLegacy(core.psyche.relationships);
    core.psyche.evidence.recent = [
      ...ensureArray(core.psyche.evidence.recent).map(normalizePsychEvidenceRow),
      ...ensureArray(legacy?.evidence?.recent).map(normalizePsychEvidenceRow)
    ].filter(row => row.signal && row.snippet).slice(-6);
    return core;
  };

  const mergeLegacyNsfwTrackerIntoCore = (core = {}, entity = {}) => {
    const legacy = entity?.nsfwTracker && typeof entity.nsfwTracker === 'object' ? entity.nsfwTracker : {};
    const personality = entity?.personality && typeof entity.personality === 'object' ? entity.personality : {};
    const existing = normalizeNsfw(core?.nsfw || {});
    const cycleLengthDays = clampInt(
      legacy?.cycleLengthDays || existing?.physiology?.cycle?.cycleLengthDays,
      28,
      20,
      40
    );
    const cycleDay = Math.max(
      0,
      Math.round(Number(legacy?.cycleDay || existing?.physiology?.cycle?.cycleDay || 0) || 0)
    );
    const pregnancyRiskScore = clampInt(
      legacy?.pregnancyRiskScore || existing?.physiology?.pregnancy?.riskScore,
      0,
      0,
      100
    );
    core.nsfw = normalizeNsfw({
      ...existing,
      profile: {
        ...existing.profile,
        sexualAttitudes: compactText(
          existing?.profile?.sexualAttitudes
          || legacy?.sexualAttitudes
          || entity?.sexualAttitudes
          || personality?.sexualAttitudes
          || '',
          180
        ),
        sexualPreferences: uniqueTexts([
          ...ensureArray(existing?.profile?.sexualPreferences || []),
          ...ensureArray(legacy?.sexualPreferences || []),
          ...ensureArray(entity?.sexualPreferences || []),
          ...ensureArray(personality?.sexualPreferences || [])
        ], 8),
        virginStatus: compactText(existing?.profile?.virginStatus || legacy?.virginStatus || '', 40),
        firstPartner: compactText(existing?.profile?.firstPartner || legacy?.firstPartner || '', 120),
        sexualHistory: compactText(existing?.profile?.sexualHistory || legacy?.sexualHistory || '', 220)
      },
      physiology: {
        ...existing.physiology,
        gender: compactText(
          existing?.physiology?.gender
          || legacy?.gender
          || entity?.gender
          || '',
          40
        ),
        genitalProfile: compactText(
          existing?.physiology?.genitalProfile
          || buildLegacyNsfwGenitalProfile(legacy)
          || '',
          120
        ),
        semenReserve: compactText(existing?.physiology?.semenReserve || legacy?.semenReserve || '', 80),
        cycle: {
          ...existing.physiology.cycle,
          menstrualCycle: compactText(
            existing?.physiology?.cycle?.menstrualCycle
            || legacy?.menstrualCycle
            || (cycleDay > 0 ? `${cycleLengthDays} day cycle / day ${cycleDay}` : ''),
            80
          ),
          menstruationStatus: compactText(existing?.physiology?.cycle?.menstruationStatus || legacy?.menstruationStatus || '', 80),
          cycleDay,
          cycleLengthDays
        },
        pregnancy: {
          ...existing.physiology.pregnancy,
          chance: compactText(existing?.physiology?.pregnancy?.chance || legacy?.pregnancyChance || '', 80),
          status: compactText(existing?.physiology?.pregnancy?.status || legacy?.pregnancyStatus || '', 80),
          riskScore: pregnancyRiskScore
        },
        sensitivity: compactText(existing?.physiology?.sensitivity || legacy?.sensitivity || '', 180),
        stamina: {
          text: compactText(existing?.physiology?.stamina?.text || legacy?.sexualStamina || '', 80),
          score: clampInt(
            legacy?.sexualStaminaScore || existing?.physiology?.stamina?.score,
            50,
            0,
            100
          )
        }
      }
    });
    if (!core.nsfw.profile.virginStatus && core.nsfw.profile.firstPartner) {
      core.nsfw.profile.virginStatus = 'not-virgin';
    }
    return core;
  };

  const mapLegacyOmniNodeToDmaRefs = (node = {}, store = {}, entity = {}) => {
    const entityTokens = tokenize(getEntityReferenceTokens(entity).join(' '));
    const nodeTokens = tokenize(`${node?.name || ''} ${node?.content || ''} ${ensureArray(node?.keywords).join(' ')}`);
    const directRows = ensureArray(store?.directEntries).map(normalizeDirectEntry)
      .map((entry) => ({ entry, score: tokenSimilarity(nodeTokens, tokenize(`${entry.preview} ${entry.episode} ${entry.entityNames.join(' ')}`)) + tokenSimilarity(entityTokens, tokenize(entry.entityNames.join(' '))) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 2)
      .filter(row => row.score > 0.08)
      .map(row => `direct:${row.entry.id}`);
    const previousRows = ensureArray(store?.previousEntries).map(normalizePreviousEntry)
      .map((entry) => ({ entry, score: tokenSimilarity(nodeTokens, tokenize(`${entry.summary} ${entry.content} ${entry.entityNames.join(' ')}`)) + tokenSimilarity(entityTokens, tokenize(entry.entityNames.join(' '))) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 2)
      .filter(row => row.score > 0.05)
      .map(row => `previous:${row.entry.id}`);
    return uniqueTexts([...directRows, ...previousRows], 6);
  };

  const mergeLegacyOmniIntoCore = async (scopeId = 'global', entity = {}, core = {}) => {
    if (Object.keys(core?.memory?.recallGraph?.nodes || {}).length > 0) return core;
    const legacy = await loadLegacyOmniGraph(scopeId);
    if (!legacy || typeof legacy !== 'object') return core;
    const store = await loadStore(scopeId);
    const entityTokens = getEntityReferenceTokens(entity);
    const rawNodes = legacy?.nodes && typeof legacy.nodes === 'object' ? legacy.nodes : {};
    Object.keys(rawNodes).forEach((nodeId) => {
      const node = rawNodes[nodeId] || {};
      const haystack = `${node?.name || ''} ${node?.content || ''} ${ensureArray(node?.keywords).join(' ')}`;
      if (!entityTokens.some(token => token && haystack.includes(token))) return;
      const mapped = normalizeRecallNode({
        id: `recall:${nodeId}`,
        type: node?.type || 'event',
        name: node?.name || '',
        preview: node?.content || node?.summary || '',
        dmaRefs: mapLegacyOmniNodeToDmaRefs(node, store, entity),
        keywords: node?.keywords || tokenize(haystack),
        activationScore: node?.activationScore,
        relationships: node?.relationships || [],
        promoted: node?.promoted === true,
        hitCount: node?.highScoreTurns || 0,
        createdTurn: node?.creationTurn || 0,
        lastSeenTurn: node?.lastSeenTurn || 0
      });
      core.memory.recallGraph.nodes[mapped.id] = mapped;
    });
    return core;
  };

  const mergeLegacyQnaArchiveIntoCore = async (scopeId = 'global', entity = {}, core = {}) => {
    const entityName = normalizeName(entity?.name || '');
    if (!entityName) return core;
    const archive = await loadLegacyVerifierArchive(scopeId);
    if (!archive.length) return core;
    const locks = [];
    const predictions = [];
    const opportunities = [];
    const queue = [];
    archive.slice(-6).forEach((item) => {
      ensureArray(item?.locks).forEach((row) => {
        const text = compactText(row || '', 220);
        if (text && (text.includes(entityName) || !text.includes(':'))) locks.push(text);
      });
      ensureArray(item?.predictions).forEach((row) => {
        const text = compactText(row || '', 220);
        if (text && (text.includes(entityName) || !text.includes(':'))) predictions.push(text);
      });
      ensureArray(item?.opportunities).forEach((row) => {
        const text = compactText(row || '', 220);
        if (text && (text.includes(entityName) || !text.includes(':'))) opportunities.push(text);
      });
      ensureArray(item?.entityPatchCandidates).forEach((candidate) => {
        if (normalizeName(candidate?.entityName || '') !== entityName) return;
        queue.push(normalizePatchItem({
          id: `patch:qna:${simpleHash(`${entityName}|${candidate?.summary || ''}|${candidate?.patchConfidence || 0}`)}`,
          type: 'legacy-qna-import',
          targetPath: 'mind.selfNarrative',
          op: 'set',
          value: compactText(candidate?.summary || '', 220),
          confidence: clampNumber(candidate?.patchConfidence, 0.75, 0, 1),
          safe: false,
          reason: compactText(candidate?.summary || 'Imported from legacy LIBRA QnA archive.', 220),
          evidenceRefs: candidate?.evidenceRefs || [],
          sourceInvestigation: 'legacy-qna',
          status: 'pending'
        }));
      });
    });
    core.verification.continuityLocks = uniqueTexts([...(core.verification.continuityLocks || []), ...locks], 8);
    core.verification.predictions = uniqueTexts([...(core.verification.predictions || []), ...predictions], 8);
    core.verification.opportunities = uniqueTexts([...(core.verification.opportunities || []), ...opportunities], 8);
    core.verification.patchQueue = dedupePatchQueue([
      ...ensureArray(core.verification.patchQueue).map(normalizePatchItem),
      ...queue
    ], getSettings().patchQueueLimit);
    return core;
  };

  const deriveCoreMind = (core = {}) => {
    const direct = compactText(core?.mind?.coreMind || '', 180);
    if (direct) return direct;
    for (const branchKey of CORE_PRIORITY) {
      const summary = compactText(core?.mind?.branches?.[branchKey]?.summary || '', 180);
      if (summary) return summary;
      const nodeText = compactText(core?.mind?.branches?.[branchKey]?.nodes?.[0]?.text || '', 180);
      if (nodeText) return nodeText;
    }
    return '';
  };

  const refreshCompatibilityProjection = (entity = {}) => {
    const core = normalizeEntityCoreX(entity, entity?.entityCoreX || {});
    entity.entityCoreX = core;
    if (!String(entity?.gender || '').trim() && core?.nsfw?.physiology?.gender) {
      entity.gender = compactText(core.nsfw.physiology.gender, 40);
    }
    try { delete entity.mindmapModule; } catch (_) {}
    try { delete entity.psychologyModule; } catch (_) {}
    try { delete entity.psychologyEngine; } catch (_) {}
    try { delete entity.nsfwTracker; } catch (_) {}
    return entity;
  };

  const prepareEntityCore = async (entity = {}, context = {}, options = {}) => {
    const scopeId = normalizeText(options?.scopeId || resolveScopeId(context)) || 'global';
    let core = normalizeEntityCoreX(entity, entity?.entityCoreX || {});
    core.identity.name = normalizeName(entity?.name || core.identity.name);
    mergeLegacyMindmapIntoCore(core, entity?.mindmapModule || {});
    mergeLegacyPsychologyModuleIntoCore(core, entity?.psychologyModule || {});
    mergeLegacyPsychologyEngineIntoCore(core, entity?.psychologyEngine || {});
    mergeLegacyNsfwTrackerIntoCore(core, entity);
    core = await mergeLegacyOmniIntoCore(scopeId, entity, core);
    core = await mergeLegacyQnaArchiveIntoCore(scopeId, entity, core);
    core.mind.coreMind = deriveCoreMind(core);
    applyTemporalDecay(entity, core, context);
    applyEmotionBridgeToPsyche(entity, core, context);
    deriveContinuityDigestState(entity, core, context, {
      recentText: [extractUserText(context), extractAssistantText(context)].filter(Boolean).join('\n'),
      memory: {
        text: ''
      }
    });
    core.meta.lastUpdated = Math.max(Number(core?.meta?.lastUpdated || 0), Date.now());
    entity.entityCoreX = core;
    refreshCompatibilityProjection(entity);
    return entity.entityCoreX;
  };

  const syncHydrateEntityCore = (entity = {}) => {
    let core = normalizeEntityCoreX(entity, entity?.entityCoreX || {});
    core.identity.name = normalizeName(entity?.name || core.identity.name);
    mergeLegacyMindmapIntoCore(core, entity?.mindmapModule || {});
    mergeLegacyPsychologyModuleIntoCore(core, entity?.psychologyModule || {});
    mergeLegacyPsychologyEngineIntoCore(core, entity?.psychologyEngine || {});
    mergeLegacyNsfwTrackerIntoCore(core, entity);
    core.mind.coreMind = deriveCoreMind(core);
    core.mind.selfNarrative = core.mind.selfNarrative || deriveSelfNarrative(core);
    core.mind.valueFrame = core.mind.valueFrame || deriveValueFrame(core);
    applyTemporalDecay(entity, core, {});
    applyEmotionBridgeToPsyche(entity, core, {});
    deriveContinuityDigestState(entity, core, {}, {
      recentText: '',
      memory: {
        text: ''
      }
    });
    core.meta.lastUpdated = Date.now();
    entity.entityCoreX = core;
    refreshCompatibilityProjection(entity);
    return entity.entityCoreX;
  };

  const addRelationship = (graph = {}, sourceId = '', targetId = '', type = 'related', weight = 0.5) => {
    const source = graph?.nodes?.[sourceId];
    const target = graph?.nodes?.[targetId];
    if (!source || !target || !sourceId || !targetId || sourceId === targetId) return false;
    source.relationships = ensureArray(source.relationships);
    if (source.relationships.some(rel => rel.targetId === targetId && rel.type === type)) return false;
    source.relationships.push({
      targetId,
      type: normalizeText(type || 'related') || 'related',
      weight: clampNumber(weight, 0.5, 0, 1)
    });
    return true;
  };

  const upsertRecallNode = (graph = {}, node = {}) => {
    const normalized = normalizeRecallNode(node);
    const nodes = graph?.nodes && typeof graph.nodes === 'object' ? graph.nodes : {};
    const target = Object.values(nodes).find((row) => {
      if (!row) return false;
      const sameRef = ensureArray(row?.dmaRefs).some(ref => ensureArray(normalized?.dmaRefs).includes(ref));
      if (sameRef) return true;
      const sameName = normalizeLooseToken(row?.name || '') === normalizeLooseToken(normalized?.name || '');
      const similarPreview = tokenSimilarity(tokenize(row?.preview || ''), tokenize(normalized?.preview || '')) >= 0.58;
      return sameName && similarPreview;
    });
    if (!target) {
      nodes[normalized.id] = normalized;
      graph.nodes = nodes;
      return { id: normalized.id, created: true };
    }
    target.name = target.name.length >= normalized.name.length ? target.name : normalized.name;
    target.preview = compactText([target.preview, normalized.preview].filter(Boolean).join(' | '), 240);
    target.dmaRefs = uniqueTexts([...(target.dmaRefs || []), ...(normalized.dmaRefs || [])], 12);
    target.keywords = uniqueTexts([...(target.keywords || []), ...(normalized.keywords || [])], 18);
    target.activationScore = Math.max(target.activationScore, normalized.activationScore);
    target.promoted = target.promoted || normalized.promoted;
    target.hitCount = Math.max(Number(target.hitCount || 0), Number(normalized.hitCount || 0));
    target.lastSeenTurn = Math.max(Number(target.lastSeenTurn || 0), Number(normalized.lastSeenTurn || 0));
    return { id: target.id, created: false };
  };

  const extractBodySignature = (text = '') => {
    const normalized = String(text || '');
    const hits = [];
    BODY_SIGNATURE_HINTS.forEach((token) => {
      if (!token || !normalized.includes(token)) return;
      hits.push(token);
    });
    return uniqueTexts(hits, 6);
  };

  const scoreBranchForText = (text = '', branchKey = '') => {
    const branch = BRANCH_REGISTRY[branchKey];
    if (!branch) return 0;
    const lower = String(text || '').toLowerCase();
    return ensureArray(branch?.keywords).reduce((score, keyword) => (
      lower.includes(String(keyword || '').toLowerCase()) ? score + 1 : score
    ), 0);
  };

  const classifyTextToBranch = (text = '') => {
    let bestKey = '';
    let bestScore = 0;
    BRANCH_ORDER.forEach((branchKey) => {
      const score = scoreBranchForText(text, branchKey);
      if (score > bestScore) {
        bestScore = score;
        bestKey = branchKey;
      }
    });
    return bestScore > 0 ? bestKey : '';
  };

  const buildEvidenceLines = (bundle = {}) => {
    const recentText = normalizeText(bundle?.recentText || '');
    const lines = recentText
      ? recentText.split(/(?<=[.!?。！？])\s+|\n+/).map(text => compactText(text, 220)).filter(Boolean)
      : [];
    ensureArray(bundle?.memory?.directEntries).forEach((entry) => {
      const text = compactText(entry?.episode || entry?.preview || '', 220);
      if (text) lines.push(text);
    });
    ensureArray(bundle?.memory?.previousEntries).forEach((entry) => {
      const text = compactText(entry?.summary || entry?.content || '', 220);
      if (text) lines.push(text);
    });
    ensureArray(bundle?.recall?.nodes).forEach((node) => {
      const text = compactText(node?.preview || node?.name || '', 220);
      if (text) lines.push(text);
    });
    return uniqueTexts(lines, 24);
  };

  const collectCanonicalEvidenceRefs = (bundle = {}, limit = 8) => uniqueTexts([
    ...ensureArray(bundle?.memory?.dmaRefs?.direct),
    ...ensureArray(bundle?.memory?.dmaRefs?.previous),
    ...ensureArray(bundle?.recall?.refs),
    ...ensureArray(bundle?.recall?.nodes).flatMap(node => ensureArray(node?.dmaRefs))
  ], limit);

  const collectEvidenceSnippets = (bundle = {}, limit = 4) => uniqueTexts(
    buildEvidenceLines(bundle).slice(0, Math.max(1, Number(limit || 0))),
    Math.max(1, Number(limit || 0))
  );

  const buildVerificationEvidenceSummary = (bundle = {}, options = {}) => {
    const refs = collectCanonicalEvidenceRefs(bundle, Math.max(1, Number(options?.refLimit || 6)));
    const snippets = collectEvidenceSnippets(bundle, Math.max(1, Number(options?.snippetLimit || 3)));
    return compactText([
      refs.length ? `dmaRefs=${refs.join(' | ')}` : '',
      snippets.length ? `snippets=${snippets.join(' | ')}` : ''
    ].filter(Boolean).join(' || '), 320);
  };

  const extractJsonCandidate = (text = '') => {
    const source = String(text || '').trim();
    if (!source) return null;
    const attempts = [
      source,
      ...((source.match(/```(?:json)?\s*([\s\S]*?)```/ig) || []).map(block => String(block || '').replace(/```(?:json)?/ig, '').replace(/```/g, '').trim()))
    ];
    const firstBrace = source.indexOf('{');
    const lastBrace = source.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      attempts.push(source.slice(firstBrace, lastBrace + 1));
    }
    for (const candidate of attempts) {
      const parsed = safeJsonParse(candidate, null);
      if (parsed && typeof parsed === 'object') return parsed;
    }
    return null;
  };

  const buildAnalysisStateSnapshot = (entity = {}, core = {}, bundle = {}, context = {}, verificationSnapshot = {}) => {
    const relationFocus = deriveRelationFocus(core?.psyche?.relationships || core?.psyche?.relations || {});
    const worldSignals = getWorldSignalSnapshot(context, entity, core);
    return {
      entity: {
        name: normalizeName(entity?.name || core?.identity?.name || ''),
        role: compactText(core?.identity?.role || '', 120),
        summary: compactText(core?.identity?.summary || '', 220)
      },
      stage: compactText(context?.analysisStage || '', 40),
      turnKey: compactText(buildTurnKey(context, resolveScopeId(context)), 120),
      date: compactText(core?.meta?.lastTemporalDate || entity?.status?.currentDate || '', 40),
      mind: {
        coreMind: compactText(core?.mind?.coreMind || '', 220),
        branches: BRANCH_ORDER.reduce((acc, key) => {
          const summary = compactText(core?.mind?.branches?.[key]?.summary || '', 160);
          if (summary) acc[key] = summary;
          return acc;
        }, {}),
        selfNarrative: compactText(core?.mind?.selfNarrative || '', 220),
        valueFrame: compactText(core?.mind?.valueFrame || '', 220)
      },
      psyche: {
        activeMode: compactText(core?.psyche?.dynamic?.activeMode || '', 80),
        currentGoal: compactText(core?.psyche?.dynamic?.currentGoal || '', 180),
        responseStyle: compactText(core?.psyche?.dynamic?.responseStyle || '', 160),
        speechBias: compactText(core?.psyche?.dynamic?.speechBias || '', 180),
        trust: round3(core?.psyche?.dynamic?.trust, 0.5),
        fear: round3(core?.psyche?.dynamic?.fear, 0),
        anger: round3(core?.psyche?.dynamic?.anger, 0),
        shame: round3(core?.psyche?.dynamic?.shame, 0),
        longing: round3(core?.psyche?.dynamic?.longing, 0),
        emotionalPressure: round3(core?.psyche?.dynamic?.emotionalPressure, 0),
        relationFocus: relationFocus?.target
          ? `${relationFocus.target} (${relationFocus.type || relationFocus.axis}${relationFocus.stage ? `/${relationFocus.stage}` : ''})`
          : ''
      },
      expression: {
        voice: compactText([
          `len=${core?.expression?.voiceSignature?.sentenceLength || 'medium'}`,
          `direct=${Math.round(Number(core?.expression?.voiceSignature?.directnessBase || 0.5) * 100)}`,
          `formal=${Math.round(Number(core?.expression?.voiceSignature?.formalityBase || 0.5) * 100)}`,
          core?.expression?.lexicalHabits?.addressingStyle?.[0] ? `address=${core.expression.lexicalHabits.addressingStyle[0]}` : '',
          core?.expression?.lexicalHabits?.recurringPhrases?.[0] ? `phrase=${compactText(core.expression.lexicalHabits.recurringPhrases[0], 50)}` : ''
        ].filter(Boolean).join(', '), 220),
        lexical: {
          favoriteWords: ensureArray(core?.expression?.lexicalHabits?.favoriteWords || []).slice(0, 6),
          avoidedWords: ensureArray(core?.expression?.lexicalHabits?.avoidedWords || []).slice(0, 6),
          recurringPhrases: ensureArray(core?.expression?.lexicalHabits?.recurringPhrases || []).slice(0, 4)
        }
      },
      embodiment: {
        body: compactText([
          core?.embodiment?.bodySignature?.tensionSignal || '',
          core?.embodiment?.bodySignature?.comfortSignal || '',
          core?.embodiment?.bodySignature?.movementTempo ? `tempo=${core.embodiment.bodySignature.movementTempo}` : ''
        ].filter(Boolean).join(' | '), 220),
        stressResponses: ensureArray(core?.embodiment?.stressResponses || []).slice(0, 4),
        comfortResponses: ensureArray(core?.embodiment?.comfortResponses || []).slice(0, 4)
      },
      selfModel: {
        selfNarrative: compactText(core?.selfModel?.selfNarrative || '', 220),
        selfImage: compactText(core?.selfModel?.selfImage || '', 180),
        deepestFearInterpretation: compactText(core?.selfModel?.deepestFearInterpretation || '', 180),
        justificationFrame: compactText(core?.selfModel?.justificationFrame || '', 180),
        shameCore: compactText(core?.selfModel?.shameCore || '', 180),
        prideCore: compactText(core?.selfModel?.prideCore || '', 180)
      },
      development: {
        immediateGoals: ensureArray(core?.development?.immediateGoals || []).slice(0, 4),
        mediumTermGoals: ensureArray(core?.development?.mediumTermGoals || []).slice(0, 4),
        longTermGoals: ensureArray(core?.development?.longTermGoals || []).slice(0, 4),
        forbiddenLines: ensureArray(core?.development?.forbiddenLines || []).slice(0, 4),
        collapseTriggers: ensureArray(core?.development?.collapseTriggers || []).slice(0, 4)
      },
      continuity: {
        summary: compactText(core?.continuity?.currentSummary || '', 220),
        psychology: compactText(core?.continuity?.psychologySummary || '', 220),
        emotion: compactText(core?.continuity?.emotionSummary || '', 220),
        sexual: compactText(core?.continuity?.sexualSummary || '', 220),
        recentHistory: ensureArray(core?.continuity?.recentHistory || []).slice(-4).map(item => compactText(item?.text || '', 180)).filter(Boolean)
      },
      world: {
        summary: worldSignals.summary,
        scenePressures: worldSignals.scenePressures.slice(0, 4),
        storylineCarryoverSignals: worldSignals.storylineCarryoverSignals.slice(0, 4),
        relationStateSignals: worldSignals.relationStateSignals.slice(0, 4),
        worldLimits: worldSignals.worldLimits.slice(0, 4),
        worldCodexSignals: worldSignals.worldCodexSignals.slice(0, 4),
        entityContextHints: worldSignals.entityContextHints.slice(0, 4)
      },
      nsfw: {
        summary: summarizeNsfwState(core),
        recentSignals: ensureArray(core?.nsfw?.verification?.recentSignals || []).slice(0, 6)
      },
      verification: {
        locks: ensureArray(verificationSnapshot?.continuityLocks || core?.verification?.continuityLocks || []).slice(0, 6),
        predictions: ensureArray(verificationSnapshot?.predictions || core?.verification?.predictions || []).slice(0, 6),
        opportunities: ensureArray(verificationSnapshot?.opportunities || core?.verification?.opportunities || []).slice(0, 6),
        investigations: ensureArray(verificationSnapshot?.recentInvestigations || core?.verification?.recentInvestigations || []).slice(0, 6).map((row) => ({
          key: row?.key,
          result: compactText(row?.result || row?.answer || '', 180),
          confidence: round3(row?.confidence, 0)
        }))
      },
      evidence: {
        canonicalRefs: collectCanonicalEvidenceRefs(bundle, 18),
        recallHighlights: ensureArray(bundle?.recall?.highlights || []).slice(0, 6),
        snippets: collectEvidenceSnippets(bundle, 8),
        directEntries: ensureArray(bundle?.memory?.directEntries || []).slice(0, 6).map(entry => ({
          id: entry?.id,
          turn: entry?.turn,
          preview: compactText(entry?.episode || entry?.preview || '', 220)
        })),
        previousEntries: ensureArray(bundle?.memory?.previousEntries || []).slice(0, 4).map(entry => ({
          id: entry?.id,
          fromTurn: entry?.fromTurn,
          toTurn: entry?.toTurn,
          summary: compactText(entry?.summary || entry?.content || '', 220)
        })),
        recentText: compactText(bundle?.recentText || '', 1200),
        responseText: compactText(bundle?.responseText || '', 1200)
      }
    };
  };

  const buildAnalysisProviderPrompt = (entity = {}, core = {}, bundle = {}, context = {}, verificationSnapshot = {}) => {
    const snapshot = buildAnalysisStateSnapshot(entity, core, bundle, context, verificationSnapshot);
    const settings = getSettings().analysisProvider;
    return {
      system: [
        'You are the analysis coprocessor for LIBRA Entity Core X.',
        'Your job is to inspect canonical DMA-backed evidence and propose conservative continuity repairs.',
        'DMA refs are the only canonical memory evidence. Do not invent unsupported facts.',
        'Return strict JSON only. No markdown. No prose outside JSON.',
        'Prefer concise investigations and patch proposals.',
        'Patch proposals are suggestions only and may be rejected by threshold checks.',
        'Use targetPath values that match Entity Core X schema.',
        'Allowed ops are: set, appendUnique.',
        'If evidence is weak, lower confidence and avoid overwriting established values.'
      ].join('\n'),
      user: JSON.stringify({
        task: 'Analyze this entity state and return structured continuity findings.',
        outputSchema: {
          summary: 'string',
          continuityLocks: ['string'],
          predictions: ['string'],
          opportunities: ['string'],
          investigations: [{
            key: 'string',
            focus: 'string',
            question: 'string',
            answer: 'string',
            result: 'string',
            confidence: 0.0,
            patchConfidence: 0.0,
            evidenceRefs: ['direct:...'],
            patchable: true
          }],
          patches: [{
            targetPath: 'string',
            op: 'set|appendUnique',
            value: 'any',
            confidence: 0.0,
            safe: false,
            reason: 'string',
            evidenceRefs: ['direct:...'],
            sourceInvestigation: 'string'
          }]
        },
        constraints: {
          stage: compactText(context?.analysisStage || 'manual', 40),
          maxEvidenceRefs: settings.maxEvidenceRefs,
          maxEvidenceSnippets: settings.maxEvidenceSnippets,
          preferCanonicalRefs: true,
          conservativeOverwrite: true
        },
        snapshot
      }, null, 2)
    };
  };

  const normalizeAnalysisProviderResult = (raw = {}, fallbackRefs = []) => {
    const summary = compactText(raw?.summary || raw?.analysisSummary || '', 220);
    const continuityLocks = uniqueTexts(raw?.continuityLocks || raw?.locks || [], 8);
    const predictions = uniqueTexts(raw?.predictions || [], 8);
    const opportunities = uniqueTexts(raw?.opportunities || [], 8);
    const investigations = ensureArray(raw?.investigations || []).map((row) => normalizeInvestigation({
      ...row,
      evidenceRefs: uniqueTexts([...(ensureArray(row?.evidenceRefs || [])), ...fallbackRefs], 8)
    })).filter(row => row.result || row.question);
    const summaryInvestigation = summary
      ? normalizeInvestigation({
        key: 'analysis_provider',
        focus: 'entity',
        question: 'What continuity pressure is most important right now?',
        answer: summary,
        result: summary,
        confidence: 0.72,
        patchConfidence: 0,
        evidenceRefs: fallbackRefs,
        patchable: false
      })
      : null;
    const patchQueue = dedupePatchQueue(ensureArray(raw?.patches || raw?.patchQueue).map((patch, index) => normalizePatchItem({
      id: normalizeText(patch?.id || `patch:analysis:${index}:${simpleHash(JSON.stringify(patch || {}))}`),
      type: normalizeText(patch?.type || 'analysis-provider-proposal') || 'analysis-provider-proposal',
      targetPath: patch?.targetPath || patch?.path || '',
      op: normalizeText(patch?.op || 'set') || 'set',
      value: cloneValue(patch?.value, null),
      confidence: clampNumber(patch?.confidence, 0.55, 0, 1),
      safe: patch?.safe === true && /^verification\./.test(String(patch?.targetPath || patch?.path || '')),
      reason: compactText(patch?.reason || summary || 'Analysis provider proposal.', 220),
      evidenceRefs: uniqueTexts([...(ensureArray(patch?.evidenceRefs || [])), ...fallbackRefs], 8),
      sourceInvestigation: normalizeText(patch?.sourceInvestigation || 'analysis_provider') || 'analysis_provider',
      status: 'pending'
    })), getSettings().patchQueueLimit);
    return {
      investigations: summaryInvestigation ? [summaryInvestigation, ...investigations] : investigations,
      continuityLocks,
      predictions,
      opportunities,
      patchQueue,
      summary
    };
  };

  const approveEntityAnalysisProviderCall = (stage = 'manual', settings = {}, context = {}) => {
    const normalizedStage = normalizeText(stage || 'manual').toLowerCase() || 'manual';
    if (!settings?.enabled) return { approved: false, reason: 'provider_disabled', stage: normalizedStage };
    if (settings?.stages?.[normalizedStage] !== true) return { approved: false, reason: 'stage_disabled', stage: normalizedStage };
    if (normalizedStage === 'manual' || context?.manualAnalysis === true || context?.forceAnalysisProvider === true) {
      if (settings?.manualRun === false && context?.forceAnalysisProvider !== true) {
        return { approved: false, reason: 'manual_run_disabled', stage: normalizedStage };
      }
      return { approved: true, reason: 'manual_or_forced', stage: normalizedStage };
    }
    const dirtyReasons = ensureArray(context?.dirtyReasons || context?.analysisDirtyReasons || []);
    const hasDirtyReason = dirtyReasons.length > 0
      || context?.dirty === true
      || context?.newEntityDetected === true
      || context?.relationStateChanged === true
      || context?.userCorrectionDetected === true
      || context?.patchProposalCandidate === true
      || context?.dmaEvidenceAccumulated === true;
    if (settings?.autoRun !== true && (!settings?.allowGatedAutoRun || !hasDirtyReason)) {
      return { approved: false, reason: 'auto_run_disabled_or_clean_domain', stage: normalizedStage };
    }
    if (settings?.onlyWhenDirty !== false && !hasDirtyReason) {
      return { approved: false, reason: 'clean_domain_cache_preferred', stage: normalizedStage };
    }
    try {
      const sharedApproval = globalThis?.LIBRA?.AnalysisProviderClient?.approveCall?.('entity', {
        enabled: settings?.enabled,
        autoRun: settings?.autoRun,
        dirty: hasDirtyReason,
        dirtyDomains: context?.dirtyDomains,
        manual: false,
        callBudgetRemaining: context?.callBudgetRemaining
      });
      if (sharedApproval && sharedApproval.approved === false) {
        return { approved: false, reason: sharedApproval.reason || 'governor_denied', stage: normalizedStage };
      }
    } catch (_) {}
    return {
      approved: true,
      reason: hasDirtyReason ? 'dirty_entity_guidance' : 'gated_auto',
      stage: normalizedStage,
      dirtyReasons
    };
  };

  const maybeRunAnalysisProvider = async (stage = 'manual', entity = {}, core = {}, context = {}, bundle = {}, verificationSnapshot = {}) => {
    const settings = getSettings().analysisProvider;
    const approval = approveEntityAnalysisProviderCall(stage, settings, context);
    reportCoordinatorRuntime({
      phase: `analysis-provider-${approval.approved ? 'approved' : 'skipped'}`,
      lastProviderGate: approval,
      evidenceSource: getDirectMemoryArchiveApi() ? 'dma' : 'fallback',
      degradedEvidenceMode: !getDirectMemoryArchiveApi()
    });
    if (!approval.approved) return null;
    if (isAnalysisProviderSuspended()) {
      updateRuntimeStatus(`analysis provider suspended after ${runtimeState.analysisFailureCount}/${runtimeState.analysisFailureLimit} failures`, {
        scopeId: runtimeState.activeScopeId,
        error: runtimeState.analysisFailureMessage || 'analysis_provider_suspended'
      });
      return null;
    }
    if (!String(settings?.key || '').trim()) return null;
    try {
      const providerConfig = buildAnalysisProviderConfig(settings);
      const prompt = buildAnalysisProviderPrompt(entity, core, bundle, { ...context, analysisStage: stage }, verificationSnapshot);
      const provider = EntityCoreXAutoProvider.get(settings.provider || 'openai');
      const result = await provider.callLLM(providerConfig, prompt.system, prompt.user, {
        forceNonStreaming: true,
        maxTokens: settings.responseMaxTokens
      });
      const parsed = extractJsonCandidate(result?.content || '');
      if (!parsed) {
        throw new EntityCoreXProviderError('Analysis provider returned non-JSON output.', 'INVALID_ANALYSIS_JSON', result?.content || '');
      }
      resetAnalysisProviderFailureState();
      return normalizeAnalysisProviderResult(parsed, collectCanonicalEvidenceRefs(bundle, settings.maxEvidenceRefs));
    } catch (error) {
      const failureCount = recordAnalysisProviderFailure(error);
      if (failureCount >= Number(runtimeState.analysisFailureLimit || ANALYSIS_PROVIDER_FAILURE_LIMIT)) {
        updateRuntimeStatus(`analysis provider suspended after ${failureCount}/${runtimeState.analysisFailureLimit} failures`, {
          scopeId: runtimeState.activeScopeId,
          error: error?.message || String(error)
        });
        return null;
      }
      throw error;
    }
  };

  const findBestStatementMatch = (statements = [], text = '') => {
    const sourceTokens = tokenize(text);
    let best = { statement: '', score: 0 };
    if (!sourceTokens.length) return best;
    ensureArray(statements).forEach((statement) => {
      const normalized = compactText(statement || '', 220);
      if (!normalized) return;
      const score = tokenSimilarity(sourceTokens, tokenize(normalized));
      if (score > best.score) {
        best = {
          statement: normalized,
          score: round3(score, 0)
        };
      }
    });
    return best;
  };

  const inferResponseMode = (text = '') => {
    const source = normalizeText(text);
    const registry = {
      open: [/(고마워|믿어|믿는다|괜찮아|함께|안심|의지|trust|safe|thank|stay|together|open up|honest)/i],
      guarded: [/(괜찮아|아무것도 아니|말하기 싫|묻지 마|신경 쓰지 마|그만|됐어|fine|leave me|don't ask|nothing|stop it)/i],
      confront: [/(그만해|멈춰|하지 마|들어|경고|명령|listen|stop|must|warning|don't do that)/i],
      pursuit: [/(반드시|놓지 않|찾아낼|잡을 거|끝까지|need you|won't let go|keep going|follow through|hold on)/i],
      confessional: [/(사실은|솔직히|고백|말할게|truth is|honestly|to be honest|I admit)/i]
    };
    const scoreGroup = (patterns = []) => patterns.reduce((sum, pattern) => (
      source.match(pattern) ? sum + 1 : sum
    ), 0);
    const scores = {
      open: scoreGroup(registry.open),
      guarded: scoreGroup(registry.guarded),
      confront: scoreGroup(registry.confront),
      pursuit: scoreGroup(registry.pursuit),
      confessional: scoreGroup(registry.confessional)
    };
    let mode = 'steady';
    if ((scores.open > 0 || scores.confessional > 0) && scores.guarded > 0) mode = 'push-pull';
    else if (scores.confront > 0 && scores.confront >= scores.open && scores.confront >= scores.pursuit) mode = 'confrontational-control';
    else if (scores.guarded > 0 && scores.guarded >= scores.open) mode = 'guarded-withdrawal';
    else if (scores.pursuit > 0 && scores.pursuit >= scores.open) mode = 'locked-pursuit';
    else if ((scores.open + scores.confessional) > 0) mode = 'open-connection';
    const dominant = Math.max(scores.open, scores.guarded, scores.confront, scores.pursuit, scores.confessional, 0);
    return {
      mode,
      confidence: dominant > 0 ? round3(Math.min(0.92, 0.42 + (dominant * 0.14)), 0.42) : 0,
      markers: uniqueTexts([
        scores.open > 0 ? 'open' : '',
        scores.guarded > 0 ? 'guarded' : '',
        scores.confront > 0 ? 'confront' : '',
        scores.pursuit > 0 ? 'pursuit' : '',
        scores.confessional > 0 ? 'confessional' : ''
      ], 5),
      scores
    };
  };

  const mergeVerificationResultIntoCore = (core = {}, result = {}, options = {}) => {
    const keepApplied = options?.keepApplied === true;
    const existingInvestigations = ensureArray(core?.verification?.recentInvestigations).map(normalizeInvestigation);
    const incomingInvestigations = ensureArray(result?.investigations || result?.recentInvestigations).map(normalizeInvestigation);
    core.verification.recentInvestigations = [...existingInvestigations, ...incomingInvestigations].slice(-8);
    core.verification.continuityLocks = uniqueTexts([
      ...ensureArray(core?.verification?.continuityLocks),
      ...ensureArray(result?.continuityLocks)
    ], 8);
    core.verification.predictions = uniqueTexts([
      ...ensureArray(core?.verification?.predictions),
      ...ensureArray(result?.predictions)
    ], 8);
    core.verification.opportunities = uniqueTexts([
      ...ensureArray(core?.verification?.opportunities),
      ...ensureArray(result?.opportunities)
    ], 8);
    core.verification.patchQueue = dedupePatchQueue([
      ...ensureArray(core?.verification?.patchQueue).map(normalizePatchItem).filter(item => keepApplied || item.status !== 'applied'),
      ...ensureArray(result?.patchQueue).map(normalizePatchItem)
    ], getSettings().patchQueueLimit);
    return core.verification;
  };

  const updatePatchQueueItem = (core = {}, patch = {}, updates = {}) => {
    const normalized = normalizePatchItem(patch);
    const patchId = normalizeText(normalized?.id || '');
    let found = false;
    const nextQueue = ensureArray(core?.verification?.patchQueue).map((item) => {
      const row = normalizePatchItem(item);
      if (!patchId || row.id !== patchId) return row;
      found = true;
      return normalizePatchItem({
        ...row,
        ...updates,
        updatedAt: Date.now()
      });
    });
    if (!found && patchId) {
      nextQueue.push(normalizePatchItem({
        ...normalized,
        ...updates,
        updatedAt: Date.now()
      }));
    }
    core.verification.patchQueue = dedupePatchQueue(nextQueue, getSettings().patchQueueLimit);
    return core.verification.patchQueue.find(item => item.id === patchId) || null;
  };

  const upsertMindNode = (branch = {}, text = '', meta = {}) => {
    const normalizedText = compactText(text, 180);
    if (!normalizedText) return false;
    const token = normalizeLooseToken(normalizedText);
    const nodes = ensureArray(branch?.nodes).map(normalizeMindNode);
    const existingIndex = nodes.findIndex(node => normalizeLooseToken(node?.text || '') === token);
    const nextNode = normalizeMindNode({
      text: normalizedText,
      source: meta?.source || '',
      dmaRefs: meta?.dmaRefs || [],
      updatedAt: meta?.updatedAt || nowIso()
    });
    if (existingIndex >= 0) nodes.splice(existingIndex, 1);
    nodes.unshift(nextNode);
    branch.nodes = nodes.slice(0, 6);
    if (!branch.summary) branch.summary = nextNode.text;
    return true;
  };

  const deriveSelfNarrative = (core = {}) => compactText([
    core?.mind?.coreMind ? `Core: ${core.mind.coreMind}` : '',
    core?.mind?.branches?.mask?.summary ? `Mask: ${core.mind.branches.mask.summary}` : '',
    core?.mind?.branches?.wound?.summary ? `Wound: ${core.mind.branches.wound.summary}` : '',
    core?.mind?.branches?.desire?.summary ? `Drive: ${core.mind.branches.desire.summary}` : ''
  ].filter(Boolean).join(' | '), 220);

  const deriveValueFrame = (core = {}) => compactText([
    ...(ensureArray(core?.profile?.values || []).slice(0, 3)),
    core?.mind?.branches?.bond?.summary || ''
  ].filter(Boolean).join(' | '), 220);

  const collectNestedStrings = (value, depth = 0) => {
    if (depth > 3 || value == null) return [];
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(item => collectNestedStrings(item, depth + 1));
    if (typeof value === 'object') {
      return Object.entries(value).flatMap(([key, item]) => [
        key,
        ...collectNestedStrings(item, depth + 1)
      ]);
    }
    return [];
  };

  const getSpeechSurfaceText = (entity = {}) => compactText([
    ...collectNestedStrings(entity?.speech || {}),
    ...collectNestedStrings(entity?.speechStyle || {}),
    ...collectNestedStrings(entity?.dialogueStyle || {})
  ].filter(Boolean).join('\n'), 2200);

  const extractPromptSignalLines = (text = '', matcher = null, limit = 6) => {
    const source = String(text || '').trim();
    if (!source) return [];
    return uniqueTexts(
      source
        .split(/\n+/)
        .map(line => compactText(line || '', 180))
        .filter(Boolean)
        .filter(line => !matcher || matcher.test(String(line || ''))),
      limit
    );
  };

  const getWorldSignalSnapshot = (context = {}, entity = {}, core = {}) => {
    const entityDossier = context?.entityDossier && typeof context.entityDossier === 'object' ? context.entityDossier : {};
    const worldManagerDossier = context?.worldManagerDossier && typeof context.worldManagerDossier === 'object' ? context.worldManagerDossier : {};
    const sectionWorldMeta = context?.sectionWorldMeta && typeof context.sectionWorldMeta === 'object' ? context.sectionWorldMeta : {};
    const worldManagerInputs = context?.worldManagerInputs && typeof context.worldManagerInputs === 'object' ? context.worldManagerInputs : {};
    const worldCoreSnapshot = getWorldCoreXSnapshot(context);
    const worldPrompt = compactText(
      context?.worldPrompt
      || context?.sectionWorldPrompt
      || context?.HierarchicalWorldManager?.formatForPrompt?.()
      || '',
      3200
    );
    const worldStatePrompt = compactText(
      context?.worldStatePrompt
      || context?.WorldStateTracker?.formatForPrompt?.()
      || '',
      2800
    );
    const narrativePrompt = compactText(
      context?.narrativePrompt
      || context?.NarrativeTracker?.formatForPrompt?.()
      || '',
      2800
    );
    const scenePressures = uniqueTexts([
      ...ensureArray(context?.environmentPressures || []),
      ...ensureArray(context?.scenePressures || []),
      ...ensureArray(worldCoreSnapshot?.scenePressures || []),
      ...ensureArray(sectionWorldMeta?.scenePressures || []),
      ...ensureArray(worldManagerDossier?.scenePressures || []),
      ...ensureArray(worldManagerInputs?.scenePressures || []),
      ...extractPromptSignalLines(worldStatePrompt, /scene pressures?|pressure|긴장|압박|threat|deadline|danger|public/i, 6)
    ], 8);
    const storylineCarryoverSignals = uniqueTexts([
      ...ensureArray(context?.storylineCarryoverSignals || []),
      ...ensureArray(worldCoreSnapshot?.carryoverSignals || []),
      ...ensureArray(sectionWorldMeta?.storylineCarryoverSignals || []),
      ...ensureArray(worldManagerDossier?.storylineCarryoverSignals || []),
      ...ensureArray(worldManagerInputs?.storylineCarryoverSignals || []),
      ...extractPromptSignalLines(narrativePrompt, /storyline carryover|carryover|ongoing|off-?screen|background|여파|후속|진행/i, 6)
    ], 8);
    const relationStateSignals = uniqueTexts([
      ...ensureArray(context?.relationStateSignals || []),
      ...ensureArray(worldCoreSnapshot?.relationSignals || []),
      ...ensureArray(sectionWorldMeta?.relationStateSignals || []),
      ...ensureArray(entityDossier?.relationStateSignals || []),
      ...ensureArray(worldManagerInputs?.relationStateSignals || []),
      ...extractPromptSignalLines(worldStatePrompt, /relationship state|relation|trust|tension|attachment|resentment|관계|신뢰|긴장/i, 6)
    ], 8);
    const worldLimits = uniqueTexts([
      ...ensureArray(worldCoreSnapshot?.worldLimits || []),
      ...ensureArray(sectionWorldMeta?.worldLimits || []),
      ...ensureArray(worldManagerDossier?.worldLimits || []),
      ...ensureArray(worldManagerInputs?.worldLimits || []),
      ...extractPromptSignalLines(worldPrompt, /world limits?|law|rule|forbidden|ban|limit|규칙|법칙|금지|제약/i, 6)
    ], 8);
    const worldCodexSignals = uniqueTexts([
      ...ensureArray(context?.worldCodexSignals || []),
      ...ensureArray(worldCoreSnapshot?.codexSignals || []),
      ...ensureArray(worldManagerDossier?.worldCodexSignals || []),
      ...ensureArray(worldManagerInputs?.worldCodexSignals || []),
      worldCoreSnapshot?.systemFocus ? `world focus ${compactText(worldCoreSnapshot.systemFocus, 120)}` : '',
      ...extractPromptSignalLines(worldPrompt, /organization|faction|setting|codex|world|지역|조직|세력|배경|도시/i, 6)
    ], 8);
    const entityContextHints = uniqueTexts([
      ...ensureArray(context?.entityContextHints || []),
      ...ensureArray(worldCoreSnapshot?.entityDossierHints || []),
      ...ensureArray(entityDossier?.entitySummaries || []),
      ...ensureArray(entityDossier?.worldManagerHints || []),
      ...ensureArray(context?.focusedEntities || []).map(name => compactText(`focus ${name}`, 80)),
      worldCoreSnapshot?.sceneSummary ? `world scene ${compactText(worldCoreSnapshot.sceneSummary, 120)}` : '',
      entity?.status?.currentLocation ? `entity location ${entity.status.currentLocation}` : '',
      core?.identity?.role ? `entity role ${core.identity.role}` : ''
    ], 8);
    return {
      scenePressures,
      storylineCarryoverSignals,
      relationStateSignals,
      worldLimits,
      worldCodexSignals,
      entityContextHints,
      summary: compactText([
        scenePressures[0] ? `scene=${scenePressures[0]}` : '',
        storylineCarryoverSignals[0] ? `carryover=${storylineCarryoverSignals[0]}` : '',
        relationStateSignals[0] ? `relation=${relationStateSignals[0]}` : '',
        worldLimits[0] ? `limit=${worldLimits[0]}` : ''
      ].filter(Boolean).join(' | '), 220)
    };
  };

  const averageSentenceLength = (text = '') => {
    const sentences = normalizeText(text)
      .split(/(?<=[.!?。！？])\s+|\n+/)
      .map(row => row.trim())
      .filter(Boolean);
    if (!sentences.length) return 0;
    const total = sentences.reduce((sum, row) => sum + tokenize(row).length, 0);
    return total / sentences.length;
  };

  const bucketSentenceLength = (text = '', fallback = 'medium') => {
    const avg = averageSentenceLength(text);
    if (!avg) return fallback;
    if (avg <= 8) return 'short';
    if (avg >= 17) return 'long';
    return 'medium';
  };

  const extractFrequentTokens = (text = '', limit = 5) => {
    const stop = new Set([
      'the', 'and', 'that', 'with', 'from', 'this', 'have', 'will', 'your', 'you', 'are', 'for', 'not',
      'but', 'about', 'what', 'when', 'then', 'they', 'them', 'into', 'just', 'like', 'really', 'very',
      '그', '그리고', '하지만', '정말', '진짜', '너', '나', '내가', '네가', '이건', '저건', '그건', '있어', '없어'
    ]);
    const counts = new Map();
    tokenize(text).forEach((token) => {
      if (stop.has(token) || token.length < 2) return;
      counts.set(token, Number(counts.get(token) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, Math.max(1, Number(limit || 0)))
      .map(([token]) => token);
  };

  const extractAddressingStyle = (text = '') => {
    const patterns = [
      /(sir|ma'am|captain|chief|boss)/ig,
      /(님|씨|선배|형|언니|누나|오빠|선생)/g
    ];
    const hits = [];
    patterns.forEach((pattern) => {
      const matched = String(text || '').match(pattern) || [];
      hits.push(...matched);
    });
    return uniqueTexts(hits, 4);
  };

  const extractRecurringPhrases = (text = '', limit = 4) => {
    const segments = normalizeText(text)
      .split(/(?<=[.!?。！？])\s+|\n+/)
      .map(row => compactText(row, 80))
      .filter(Boolean);
    const counts = new Map();
    segments.forEach((segment) => {
      counts.set(segment, Number(counts.get(segment) || 0) + 1);
    });
    return Array.from(counts.entries())
      .filter(([, count]) => count >= 2)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, Math.max(1, Number(limit || 0)))
      .map(([segment]) => segment);
  };

  const inferSceneCategory = (text = '', core = {}) => {
    const source = normalizeText(text);
    if (!source) return core?.psyche?.dynamic?.activeMode === 'guarded-withdrawal' ? 'shame' : 'private';
    if (/(everyone|crowd|public|people|hall|ceremony|audience|광장|사람들|공개|공공)/i.test(source)) return 'public';
    if (/(danger|weapon|blood|threat|run|죽|위협|위기|위험|도망)/i.test(source)) return 'danger';
    if (/(kiss|love|touch|embrace|romance|사랑|입맞춤|껴안)/i.test(source)) return 'romance';
    if (/(sorry|shame|embarrass|humiliat|부끄|수치|창피)/i.test(source)) return 'shame';
    if (/(stop|argue|fight|angry|대립|싸움|분노|언쟁)/i.test(source) || core?.psyche?.dynamic?.activeMode === 'confrontational-control') return 'conflict';
    return 'private';
  };

  const pickCurrentPersonaModeSummary = (core = {}, context = {}) => {
    const relationFocus = deriveRelationFocus(core?.psyche?.relationships || core?.psyche?.relations || {});
    const worldSignals = getWorldSignalSnapshot(context, {}, core);
    const scene = inferSceneCategory([extractUserText(context), extractAssistantText(context), collectRecentWindowText(context, 3)].filter(Boolean).join('\n'), core);
    const relationMode = relationFocus?.target
      ? (
        relationFocus.attachment >= 0.62 || relationFocus.trust >= 0.68 ? core?.personaModes?.byRelation?.intimates
          : (relationFocus.tension >= 0.72 && relationFocus.trust <= 0.42) ? core?.personaModes?.byRelation?.enemies
            : relationFocus.trust >= 0.56 ? core?.personaModes?.byRelation?.peers
              : core?.personaModes?.byRelation?.strangers
      )
      : core?.personaModes?.byRelation?.strangers;
    const sceneMode = core?.personaModes?.byScene?.[scene] || createDefaultPersonaMode();
    return compactText([
      relationFocus?.target ? `relation=${relationFocus.target}` : '',
      relationMode?.summary || '',
      sceneMode?.summary ? `scene=${sceneMode.summary}` : '',
      worldSignals.summary ? `pressure=${worldSignals.summary}` : ''
    ].filter(Boolean).join(' | '), 220);
  };

  const summarizeDevelopmentGoals = (core = {}) => compactText([
    ensureArray(core?.development?.immediateGoals || []).slice(0, 1).map(item => `now=${item}`).join(' | '),
    ensureArray(core?.development?.mediumTermGoals || []).slice(0, 1).map(item => `mid=${item}`).join(' | '),
    ensureArray(core?.development?.longTermGoals || []).slice(0, 1).map(item => `long=${item}`).join(' | ')
  ].filter(Boolean).join(' | '), 220);

  const summarizeWorldPressure = (context = {}, entity = {}, core = {}) => {
    const worldSignals = getWorldSignalSnapshot(context, entity, core);
    return compactText([
      worldSignals.scenePressures[0] ? `scene=${worldSignals.scenePressures[0]}` : '',
      worldSignals.storylineCarryoverSignals[0] ? `carryover=${worldSignals.storylineCarryoverSignals[0]}` : '',
      worldSignals.relationStateSignals[0] ? `relation=${worldSignals.relationStateSignals[0]}` : '',
      worldSignals.worldLimits[0] ? `limit=${worldSignals.worldLimits[0]}` : ''
    ].filter(Boolean).join(' | '), 220);
  };

  const collectNsfwCounterparts = (entity = {}, core = {}, context = {}, text = '') => {
    const names = [];
    const relationFocus = deriveRelationFocus(core?.psyche?.relations || {});
    if (relationFocus?.target) names.push(relationFocus.target);
    const cache = getEntityCache(context);
    if (cache instanceof Map) {
      cache.forEach((candidate) => {
        if (!candidate || typeof candidate !== 'object') return;
        const name = compactText(candidate?.name || '', 80);
        if (!name || name === compactText(entity?.name || '', 80)) return;
        if (mentionsEntity(text, candidate)) names.push(name);
      });
    }
    return uniqueTexts(names, 4);
  };

  const deriveNsfwAttitude = (core = {}, existing = {}) => {
    if (existing?.profile?.sexualAttitudes) return compactText(existing.profile.sexualAttitudes, 180);
    const combined = compactText([
      core?.mind?.branches?.mask?.summary || '',
      core?.mind?.branches?.bond?.summary || '',
      core?.mind?.branches?.fear?.summary || '',
      ensureArray(core?.profile?.taboos || []).join(' | ')
    ].filter(Boolean).join(' | '), 260);
    if (/(purity|taboo|strict|restraint|금기|절제|보수|조심)/i.test(combined)) return 'guarded, selective, restraint-forward';
    if (/(playful|tease|seductive|curious|유혹|장난|능숙|호기심)/i.test(combined)) return 'curious, responsive, emotionally contingent';
    if (core?.psyche?.dynamic?.trust >= 0.62 && core?.psyche?.dynamic?.longing >= 0.34) return 'bond-driven, trust-dependent openness';
    return '';
  };

  const deriveNsfwPreferences = (core = {}, evidenceText = '', existing = {}) => uniqueTexts([
    ...ensureArray(existing?.profile?.sexualPreferences || []),
    /(gentle|soft|slow|careful|부드|천천히|다정)/i.test(evidenceText) ? 'gentle pace' : '',
    /(control|command|order|주도|통제)/i.test(evidenceText) ? 'control dynamic' : '',
    /(praise|reassur|확인|안심|칭찬)/i.test(evidenceText) ? 'verbal reassurance' : '',
    /(close|hold|embrace|안기|품|밀착)/i.test(evidenceText) ? 'close contact' : ''
  ], 8);

  const extractFirstPartnerCandidate = (text = '', counterparts = []) => {
    const source = String(text || '');
    if (!/(first time|first partner|첫 경험|처음.*(잤|관계|동침|성관계)|처녀|동정)/i.test(source)) return '';
    const lowered = source.toLowerCase();
    const explicit = ensureArray(counterparts).find(name => lowered.includes(String(name || '').toLowerCase()));
    return compactText(explicit || counterparts[0] || '', 120);
  };

  const summarizeNsfwState = (core = {}) => compactText([
    ensureArray(core?.nsfw?.intimacy?.counterparts || []).length ? `with=${ensureArray(core.nsfw.intimacy.counterparts).slice(0, 2).join('/')}` : '',
    Number(core?.nsfw?.dynamic?.arousal || 0) >= 0.18 ? `arousal=${Math.round(Number(core.nsfw.dynamic.arousal || 0) * 100)}` : '',
    Number(core?.nsfw?.dynamic?.restraint || 0.5) >= 0.58 ? `restraint=${Math.round(Number(core.nsfw.dynamic.restraint || 0.5) * 100)}` : '',
    core?.nsfw?.physiology?.cycle?.menstruationStatus ? `cycle=${compactText(core.nsfw.physiology.cycle.menstruationStatus, 40)}` : '',
    core?.nsfw?.physiology?.pregnancy?.status ? `preg=${compactText(core.nsfw.physiology.pregnancy.status, 40)}` : '',
    core?.nsfw?.verification?.locks?.[0] ? `lock=${compactText(core.nsfw.verification.locks[0], 60)}` : ''
  ].filter(Boolean).join(' | '), 220);

  const getEmotionBridgeState = (entity = {}) => {
    const status = entity?.status && typeof entity.status === 'object' ? entity.status : {};
    const mood = compactText(status?.currentMood || '', 120);
    const signature = compactText(status?.emotionSignature || '', 80);
    const blend = compactText(status?.emotionBlend || '', 120);
    const intensity = clampNumber(status?.emotionIntensity, 0, 0, 1);
    const sourceText = [mood, signature, blend].filter(Boolean).join(' | ');
    const fearHit = /(fear|anxious|distress|uneasy|불안|공포|긴장|초조|위협)/i.test(sourceText);
    const angerHit = /(anger|resent|hostile|irritat|분노|적개|짜증|원망)/i.test(sourceText);
    const shameHit = /(shame|embarrass|humiliat|부끄|수치|창피)/i.test(sourceText);
    const sadnessHit = /(sad|grief|hurt|loss|슬픔|상실|우울|아픔)/i.test(sourceText);
    const longingHit = /(affection|love|yearning|attached|miss|애정|애착|그리움|원해|좋아)/i.test(sourceText);
    const reliefHit = /(relief|calm|safe|warm|안도|안심|안정|편안)/i.test(sourceText);
    const joyHit = /(joy|happy|delight|행복|기쁨|들뜸)/i.test(sourceText);
    const controlLowHit = /(overwhelm|shaking|panic|can't|무너|압도|패닉|통제 안)/i.test(sourceText);
    const controlHighHit = /(steady|controlled|contained|calm|침착|차분|억눌|정리)/i.test(sourceText);
    const valence = clampNumber(
      (joyHit ? 0.34 : 0)
      + (reliefHit ? 0.28 : 0)
      + (longingHit ? 0.16 : 0)
      - (fearHit ? 0.24 : 0)
      - (angerHit ? 0.3 : 0)
      - (shameHit ? 0.22 : 0)
      - (sadnessHit ? 0.2 : 0),
      0,
      -1,
      1
    );
    const arousal = clampNumber(
      (fearHit ? 0.34 : 0)
      + (angerHit ? 0.34 : 0)
      + (joyHit ? 0.18 : 0)
      + (longingHit ? 0.12 : 0)
      + (intensity * 0.42),
      0,
      0,
      1
    );
    const control = clampNumber(
      0.54
      + (controlHighHit ? 0.2 : 0)
      - (controlLowHit ? 0.26 : 0)
      - (fearHit ? 0.08 : 0)
      - (angerHit ? 0.08 : 0)
      - (intensity * 0.14),
      0.5,
      0,
      1
    );
    return {
      mood,
      signature,
      blend,
      intensity,
      valence,
      arousal,
      control,
      flags: {
        fear: fearHit,
        anger: angerHit,
        shame: shameHit,
        sadness: sadnessHit,
        longing: longingHit,
        relief: reliefHit,
        joy: joyHit
      },
      summary: compactText([
        mood ? `mood ${mood}` : '',
        signature ? `emotion ${signature}` : '',
        blend ? `blend ${blend}` : '',
        intensity > 0 ? `intensity ${Math.round(intensity * 100)}%` : '',
        `control ${Math.round(control * 100)}%`
      ].filter(Boolean).join(' | '), 220)
    };
  };

  const applyEmotionBridgeToPsyche = (entity = {}, core = {}, context = {}) => {
    const emotion = getEmotionBridgeState(entity);
    if (!emotion.mood && !emotion.signature && !emotion.blend && emotion.intensity <= 0) {
      return emotion;
    }
    core.psyche = core?.psyche && typeof core.psyche === 'object' ? core.psyche : {};
    core.psyche.stable = {
      ...createDefaultStable(),
      ...(core?.psyche?.stable && typeof core.psyche.stable === 'object' ? core.psyche.stable : {})
    };
    core.psyche.dynamic = {
      ...createDefaultDynamic(),
      ...(core?.psyche?.dynamic && typeof core.psyche.dynamic === 'object' ? core.psyche.dynamic : {})
    };
    const stable = core.psyche.stable;
    const dynamic = core.psyche.dynamic;

    dynamic.fear = round3(dynamic.fear + (emotion.flags.fear ? (0.12 + (emotion.intensity * 0.32)) : 0), dynamic.fear);
    dynamic.anger = round3(dynamic.anger + (emotion.flags.anger ? (0.12 + (emotion.intensity * 0.34)) : 0), dynamic.anger);
    dynamic.shame = round3(dynamic.shame + (emotion.flags.shame ? (0.1 + (emotion.intensity * 0.28)) : 0), dynamic.shame);
    dynamic.sadness = round3(dynamic.sadness + (emotion.flags.sadness ? (0.1 + (emotion.intensity * 0.26)) : 0), dynamic.sadness);
    dynamic.longing = round3(dynamic.longing + (emotion.flags.longing ? (0.08 + (emotion.intensity * 0.2)) : 0), dynamic.longing);
    dynamic.relief = round3(dynamic.relief + (emotion.flags.relief || emotion.flags.joy ? (0.1 + (emotion.intensity * 0.18)) : 0), dynamic.relief);
    dynamic.trust = round3(
      dynamic.trust
      + ((emotion.valence > 0 ? emotion.valence * 0.16 : 0))
      + (emotion.flags.relief ? 0.06 : 0)
      - (emotion.flags.fear ? 0.08 : 0)
      - (emotion.flags.anger ? 0.06 : 0),
      dynamic.trust
    );
    dynamic.emotionalPressure = round3(
      dynamic.emotionalPressure
      + (emotion.intensity * 0.34)
      + (emotion.arousal * 0.18)
      - (emotion.control * 0.08),
      dynamic.emotionalPressure
    );
    dynamic.maskStrength = round3(
      dynamic.maskStrength
      + ((emotion.flags.shame || emotion.flags.fear) ? 0.08 : 0)
      + ((emotion.control >= 0.62 && emotion.intensity >= 0.35) ? 0.06 : 0)
      - (emotion.flags.relief ? 0.04 : 0),
      dynamic.maskStrength
    );

    stable.emotionalExpressiveness = round3(
      stable.emotionalExpressiveness
      + ((emotion.intensity >= 0.5 && emotion.control < 0.45) ? 0.1 : 0)
      - ((emotion.flags.shame && emotion.control >= 0.52) ? 0.04 : 0),
      stable.emotionalExpressiveness
    );
    stable.threatSensitivity = round3(
      stable.threatSensitivity
      + (emotion.flags.fear ? 0.06 : 0)
      + (emotion.flags.anger ? 0.04 : 0),
      stable.threatSensitivity
    );
    stable.shameSensitivity = round3(
      stable.shameSensitivity
      + (emotion.flags.shame ? 0.08 : 0),
      stable.shameSensitivity
    );

    if (emotion.flags.fear && emotion.intensity >= 0.5 && emotion.control < 0.44) dynamic.activeMode = 'guarded-withdrawal';
    else if (emotion.flags.anger && emotion.intensity >= 0.48 && stable.controlNeed >= 0.52) dynamic.activeMode = 'confrontational-control';
    else if (emotion.flags.longing && emotion.flags.fear && emotion.intensity >= 0.44) dynamic.activeMode = 'push-pull';
    else if ((emotion.flags.relief || emotion.flags.joy) && dynamic.trust >= 0.56) dynamic.activeMode = 'open-connection';

    if (!dynamic.currentGoal && emotion.flags.longing && core?.mind?.branches?.bond?.summary) {
      dynamic.currentGoal = compactText(core.mind.branches.bond.summary, 160);
    } else if (!dynamic.currentGoal && emotion.flags.fear && core?.mind?.branches?.fear?.summary) {
      dynamic.currentGoal = compactText(core.mind.branches.fear.summary, 160);
    }

    const relationFocus = deriveRelationFocus(core?.psyche?.relations || {});
    dynamic.responseStyle = deriveResponseStyle(stable, dynamic);
    dynamic.speechBias = compactText([
      deriveSpeechBias(dynamic, stable, relationFocus),
      emotion.summary ? `emotion bridge: ${emotion.summary}` : ''
    ].filter(Boolean).join(' | '), 220);
    core.psyche.evidence = core?.psyche?.evidence && typeof core.psyche.evidence === 'object'
      ? core.psyche.evidence
      : { recent: [] };
    core.psyche.evidence.recent = [
      normalizePsychEvidenceRow({
        signal: 'emotion',
        snippet: emotion.summary || compactText([emotion.mood, emotion.signature, emotion.blend].filter(Boolean).join(' | '), 160),
        weight: Math.max(0.55, Number(emotion.intensity || 0))
      }),
      ...ensureArray(core?.psyche?.evidence?.recent || []).map(normalizePsychEvidenceRow)
    ].filter(row => row.signal && row.snippet).slice(0, 6);
    core.psyche.emotionBridge = cloneValue(emotion, {});
    return emotion;
  };

  const summarizeContinuityCarryover = (core = {}) => compactText([
    core?.continuity?.currentSummary || '',
    ensureArray(core?.continuity?.recentHistory || []).slice(-1)[0]?.text || ''
  ].filter(Boolean).join(' | '), 220);

  const summarizeCorePsychologyDigest = (core = {}) => compactText([
    core?.mind?.coreMind ? `major ${core.mind.coreMind}` : '',
    core?.mind?.branches?.mask?.summary ? `counter ${core.mind.branches.mask.summary}` : '',
    core?.mind?.branches?.desire?.summary ? `desire ${core.mind.branches.desire.summary}` : '',
    core?.psyche?.dynamic?.activeMode ? `mode ${core.psyche.dynamic.activeMode}` : '',
    core?.psyche?.dynamic?.currentGoal ? `goal ${core.psyche.dynamic.currentGoal}` : '',
    deriveRelationFocus(core?.psyche?.relations || {})?.target
      ? `relation ${deriveRelationFocus(core?.psyche?.relations || {}).target}`
      : ''
  ].filter(Boolean).join(' | '), 220);

  const summarizeCoreEmotionDigest = (entity = {}, core = {}) => {
    const status = entity?.status && typeof entity.status === 'object' ? entity.status : {};
    return compactText([
      status?.currentMood ? `mood ${status.currentMood}` : '',
      status?.emotionSignature ? `emotion ${status.emotionSignature}` : '',
      status?.emotionBlend ? `blend ${status.emotionBlend}` : '',
      Number.isFinite(Number(status?.emotionIntensity))
        && Number(status?.emotionIntensity || 0) > 0
        ? `intensity ${Math.round(Number(status.emotionIntensity || 0) * 100)}%`
        : '',
      !status?.currentMood && core?.psyche?.dynamic?.activeMode
        ? `mode ${core.psyche.dynamic.activeMode}`
        : '',
      Number(core?.psyche?.dynamic?.emotionalPressure || 0) > 0.2
        ? `pressure ${Math.round(Number(core.psyche.dynamic.emotionalPressure || 0) * 100)}%`
        : ''
    ].filter(Boolean).join(' | '), 180);
  };

  const deriveContinuitySummary = (entity = {}, core = {}, context = {}) => {
    const identity = entity?.identity && typeof entity.identity === 'object' ? entity.identity : {};
    const status = entity?.status && typeof entity.status === 'object' ? entity.status : {};
    const background = entity?.background && typeof entity.background === 'object' ? entity.background : {};
    return compactText([
      identity?.role || core?.identity?.role || background?.occupation || '',
      entity?.gender || core?.nsfw?.physiology?.gender || '',
      compactText(entity?.intent || '', 100) ? `intent ${compactText(entity.intent, 100)}` : '',
      compactText(entity?.action || '', 100) ? `action ${compactText(entity.action, 100)}` : '',
      compactText(entity?.belongsTo || '', 100) ? `belongs ${compactText(entity.belongsTo, 100)}` : '',
      status?.location ? `location ${status.location}` : '',
      core?.mind?.coreMind ? `mind ${core.mind.coreMind}` : '',
      summarizeCoreEmotionDigest(entity, core)
    ].filter(Boolean).join(' | '), 260);
  };

  const deriveExpressionState = (entity = {}, core = {}, context = {}, recallBundle = {}) => {
    const speechSurface = getSpeechSurfaceText(entity);
    const recentText = compactText([
      extractAssistantText(context),
      recallBundle?.recentText || '',
      recallBundle?.memory?.text || '',
      speechSurface
    ].filter(Boolean).join('\n'), 2600);
    const responseStyle = core?.psyche?.dynamic?.responseStyle || createDefaultDynamic().responseStyle;
    const voiceSignature = normalizeVoiceSignature({
      sentenceLength: bucketSentenceLength(recentText, core?.expression?.voiceSignature?.sentenceLength || 'medium'),
      directnessBase: round3(0.2 + (Number(responseStyle?.directness || 0.5) * 0.46) + (Number(core?.psyche?.stable?.controlNeed || 0.5) * 0.08) - ((/\?/.test(recentText) || /(\.\.\.|…|\bum\b|\buh\b|음|어)/i.test(recentText)) ? 0.06 : 0), 0.5),
      formalityBase: round3(
        /(sir|ma'am|please|regret|apolog|드립니다|습니다|입니다|님)/i.test(recentText)
          ? 0.72
          : (/(hey|yeah|gonna|wanna|야|너|됐어)/i.test(recentText) ? 0.34 : 0.5),
        0.5
      ),
      metaphorUsage: round3((/(like|as if|as though|마치|처럼|같은)/i.test(recentText) ? 0.54 : 0.18), 0.2),
      hesitationUsage: round3((/(\.\.\.|…|\bum\b|\buh\b|maybe|perhaps|음|어|글쎄)/i.test(recentText) ? 0.58 : 0.22), 0.3),
      emotionalLeakage: round3(((Number(responseStyle?.disclosure || 0.5) * 0.45) + (Number(core?.psyche?.dynamic?.longing || 0.1) * 0.16) + ((1 - Number(core?.psyche?.dynamic?.maskStrength || 0.5)) * 0.18)), 0.4)
    });
    const lexicalHabits = normalizeLexicalHabits({
      favoriteWords: extractFrequentTokens(recentText, 5),
      avoidedWords: uniqueTexts([
        ...ensureArray(core?.profile?.taboos || []).slice(0, 2),
        core?.expression?.dialogueRules?.namesEmotionDirectly === false ? 'emotion-labeling' : ''
      ], 6),
      addressingStyle: extractAddressingStyle(recentText),
      fillerWords: uniqueTexts((String(recentText || '').match(/\b(um|uh|well|like|maybe)\b|[음어글쎄흠]+/ig) || []), 5),
      recurringPhrases: uniqueTexts([
        ...extractRecurringPhrases(recentText, 4),
        ...ensureArray(core?.expression?.lexicalHabits?.recurringPhrases || []).slice(0, 2)
      ], 6)
    });
    const dialogueRules = normalizeDialogueRules({
      confessesDirectly: /(\btruth is\b|\bhonestly\b|솔직히|사실은|고백)/i.test(recentText) || Number(voiceSignature.emotionalLeakage || 0) >= 0.62,
      apologizesDirectly: (/\bsorry\b|\bapolog/i.test(recentText) || /미안|죄송/.test(recentText)) || Number(voiceSignature.formalityBase || 0.5) >= 0.58,
      namesEmotionDirectly: /(\bangry\b|\bafraid\b|\bsad\b|\bhurt\b|화나|불안|슬퍼|상처)/i.test(recentText),
      usesQuestionsToDeflect: /\?/.test(recentText) && Number(core?.psyche?.dynamic?.maskStrength || 0.5) >= 0.56
    });
    core.expression = {
      voiceSignature,
      lexicalHabits,
      dialogueRules
    };
    return core.expression;
  };

  const deriveEmbodimentState = (entity = {}, core = {}, context = {}, recallBundle = {}) => {
    const evidenceText = compactText([
      recallBundle?.recentText || '',
      recallBundle?.memory?.text || '',
      ensureArray(recallBundle?.recall?.highlights || []).join('\n'),
      ensureArray(core?.mind?.bodySignature || []).join(' ')
    ].filter(Boolean).join('\n'), 2600);
    const bodyHints = uniqueTexts([
      ...extractBodySignature(evidenceText),
      ...ensureArray(core?.mind?.bodySignature || [])
    ], 8);
    const dynamic = core?.psyche?.dynamic || createDefaultDynamic();
    const relationFocus = deriveRelationFocus(core?.psyche?.relations || {});
    const bodySignature = normalizeEmbodimentBodySignature({
      gazePattern: /(시선|눈빛|gaze|eyes)/i.test(evidenceText)
        ? compactText(bodyHints.find(item => /(시선|눈빛|gaze|eyes)/i.test(item)) || 'eyes hold and check the other person before commitment', 120)
        : (Number(dynamic?.maskStrength || 0.5) >= 0.58 ? 'gaze breaks when pressure rises' : 'gaze stays on the target when engaged'),
      posturePattern: Number(dynamic?.maskStrength || 0.5) >= 0.6 ? 'shoulders stay guarded and closed' : 'posture opens as trust rises',
      handHabit: /(손|손끝|손가락|hands|fingers)/i.test(evidenceText) ? 'hands betray tension before words do' : 'hands stay controlled until emotion leaks',
      movementTempo: Number(dynamic?.emotionalPressure || 0.15) >= 0.5 ? 'tight-fast' : (Number(dynamic?.trust || 0.5) >= 0.58 ? 'measured-soft' : 'measured'),
      tensionSignal: Number(dynamic?.fear || 0.15) >= 0.5 ? 'breath shortens and gaze hardens' : (Number(dynamic?.anger || 0.1) >= 0.5 ? 'jaw and shoulders tighten' : 'small muscular holds appear under strain'),
      comfortSignal: Number(dynamic?.relief || 0.1) >= 0.42 || Number(dynamic?.trust || 0.5) >= 0.6
        ? 'breathing settles and distance softens'
        : 'comfort shows as stillness rather than overt ease'
    });
    core.embodiment = {
      bodySignature,
      stressResponses: uniqueTexts([
        Number(dynamic?.fear || 0) >= 0.48 ? 'withdraws eye contact and compresses posture' : '',
        Number(dynamic?.anger || 0) >= 0.46 ? 'voice edges sharpen and movement becomes clipped' : '',
        Number(dynamic?.shame || 0) >= 0.42 ? 'self-protective stillness replaces open movement' : ''
      ], 6),
      comfortResponses: uniqueTexts([
        Number(dynamic?.trust || 0) >= 0.58 ? 'allows closer distance and steadier gaze' : '',
        Number(dynamic?.relief || 0) >= 0.42 ? 'breathing lengthens and hands loosen' : '',
        relationFocus?.target && relationFocus.trust >= 0.6 ? `body softens first around ${relationFocus.target}` : ''
      ], 6),
      proximityStyle: normalizeProximityStyle({
        defaultDistance: Number(dynamic?.trust || 0.5) >= 0.62 ? 'close' : (Number(dynamic?.maskStrength || 0.5) >= 0.62 ? 'far' : 'mid'),
        touchTolerance: round3((Number(dynamic?.trust || 0.5) * 0.36) + (Number(dynamic?.longing || 0.1) * 0.22) - (Number(dynamic?.fear || 0.15) * 0.18), 0.3),
        territoriality: round3((Number(core?.psyche?.stable?.controlNeed || 0.5) * 0.32) + (Number(dynamic?.anger || 0.1) * 0.18) + (Number(dynamic?.maskStrength || 0.5) * 0.12), 0.5)
      })
    };
    return core.embodiment;
  };

  const deriveSelfModelState = (entity = {}, core = {}, context = {}, recallBundle = {}, verificationSnapshot = {}) => {
    const previousSummary = compactText(ensureArray(recallBundle?.memory?.previousEntries || []).map(entry => entry?.summary || entry?.title || '').filter(Boolean).slice(0, 2).join(' | '), 220);
    const topVerification = compactText([
      ensureArray(verificationSnapshot?.continuityLocks || [])[0] || '',
      ensureArray(verificationSnapshot?.predictions || [])[0] || ''
    ].filter(Boolean).join(' | '), 220);
    const selfNarrative = compactText(
      core?.mind?.selfNarrative || deriveSelfNarrative(core) || core?.mind?.coreMind || topVerification || previousSummary,
      220
    );
    core.selfModel = {
      selfNarrative,
      selfImage: compactText([
        core?.mind?.coreMind ? `self as ${core.mind.coreMind}` : '',
        core?.mind?.branches?.mask?.summary ? `while appearing ${core.mind.branches.mask.summary}` : '',
        previousSummary ? `shaped by ${previousSummary}` : ''
      ].filter(Boolean).join(' | '), 220),
      deepestFearInterpretation: compactText(
        core?.mind?.branches?.fear?.summary || core?.mind?.branches?.wound?.summary || ensureArray(verificationSnapshot?.continuityLocks || [])[0] || '',
        220
      ),
      justificationFrame: compactText([
        core?.mind?.valueFrame || deriveValueFrame(core),
        topVerification
      ].filter(Boolean).join(' | '), 220),
      valuePriority: uniqueTexts([
        ...ensureArray(core?.profile?.values || []).slice(0, 4),
        core?.mind?.branches?.bond?.summary || '',
        core?.mind?.branches?.desire?.summary || ''
      ], 6),
      shameCore: compactText(core?.mind?.branches?.wound?.summary || core?.mind?.branches?.mask?.summary || '', 180),
      prideCore: compactText(core?.mind?.branches?.desire?.summary || core?.mind?.coreMind || core?.mind?.branches?.bond?.summary || '', 180)
    };
    return core.selfModel;
  };

  const buildPersonaModeFromNumbers = (summary = '', directness = 0.5, warmth = 0.5, guardedness = 0.5, disclosure = 0.5) => normalizePersonaMode({
    summary,
    directness,
    warmth,
    guardedness,
    disclosure
  });

  const mergeStyleHintIntoPersonaMode = (mode = {}, hintSource = null) => {
    const hintText = compactText(collectNestedStrings(hintSource).join(' | '), 180);
    if (!hintText) return normalizePersonaMode(mode);
    return normalizePersonaMode({
      ...mode,
      summary: compactText([mode?.summary || '', hintText].filter(Boolean).join(' | '), 180)
    });
  };

  const derivePersonaModes = (entity = {}, core = {}, context = {}) => {
    const dynamic = core?.psyche?.dynamic || createDefaultDynamic();
    const stable = core?.psyche?.stable || createDefaultStable();
    const style = entity?.speechStyle && typeof entity.speechStyle === 'object' ? entity.speechStyle : {};
    const worldSignals = getWorldSignalSnapshot(context, entity, core);
    const baseDisclosure = Number(dynamic?.responseStyle?.disclosure || 0.5);
    const baseDirectness = Number(dynamic?.responseStyle?.directness || 0.5);
    const publicHints = uniqueTexts([
      ...worldSignals.scenePressures.filter(item => /(public|crowd|audience|hall|ceremony|witness|공개|군중|청중|사람들)/i.test(item)),
      ...worldSignals.worldLimits.filter(item => /(reputation|status|protocol|organization|예절|체면|규율)/i.test(item))
    ], 3);
    const conflictHints = uniqueTexts([
      ...worldSignals.scenePressures.filter(item => /(conflict|fight|argument|pressure|언쟁|대립|충돌|압박)/i.test(item)),
      ...worldSignals.relationStateSignals.slice(0, 2)
    ], 3);
    const dangerHints = uniqueTexts([
      ...worldSignals.scenePressures.filter(item => /(danger|threat|weapon|escape|blood|위험|위협|도주|피)/i.test(item)),
      ...worldSignals.worldLimits.filter(item => /(law|rule|ban|forbidden|규칙|금지|법)/i.test(item))
    ], 3);
    const privateHints = uniqueTexts([
      ...worldSignals.storylineCarryoverSignals.slice(0, 2),
      ...worldSignals.entityContextHints.slice(0, 1)
    ], 3);
    const romanceHints = uniqueTexts([
      ...worldSignals.storylineCarryoverSignals.filter(item => /(romance|intimacy|desire|attachment|사랑|애정|친밀)/i.test(item)),
      ...worldSignals.relationStateSignals.filter(item => /(attachment|trust|bond|질투|애착|신뢰)/i.test(item))
    ], 3);
    const shameHints = uniqueTexts([
      ...worldSignals.scenePressures.filter(item => /(shame|humiliat|embarrass|부끄|수치|창피)/i.test(item)),
      ...worldSignals.worldLimits.filter(item => /(forbidden|taboo|ban|금지|체면)/i.test(item))
    ], 3);
    core.personaModes = {
      byRelation: {
        superiors: mergeStyleHintIntoPersonaMode(buildPersonaModeFromNumbers(
          'more formal, guarded, deferential but observant',
          baseDirectness - 0.08,
          Number(dynamic?.trust || 0.5) * 0.82,
          Number(stable?.guardedness || 0.5) + 0.12,
          baseDisclosure - 0.1
        ), style?.superiors || style?.authority),
        subordinates: mergeStyleHintIntoPersonaMode(buildPersonaModeFromNumbers(
          'more directive and organizing in tone',
          baseDirectness + 0.1,
          Number(dynamic?.trust || 0.5),
          Number(stable?.guardedness || 0.5) - 0.06,
          baseDisclosure
        ), style?.subordinates),
        peers: mergeStyleHintIntoPersonaMode(buildPersonaModeFromNumbers(
          'balanced, responsive, testing for reciprocity',
          baseDirectness,
          Number(dynamic?.trust || 0.5),
          Number(stable?.guardedness || 0.5),
          baseDisclosure
        ), style?.peers),
        intimates: mergeStyleHintIntoPersonaMode(buildPersonaModeFromNumbers(
          'warmer, more revealing, emotionally looser',
          baseDirectness,
          Number(dynamic?.trust || 0.5) + 0.14,
          Number(stable?.guardedness || 0.5) - 0.14,
          baseDisclosure + 0.16
        ), style?.intimates || style?.lovers),
        enemies: mergeStyleHintIntoPersonaMode(buildPersonaModeFromNumbers(
          'hard edged, defensive, ready to press or deflect',
          baseDirectness + 0.16,
          Number(dynamic?.trust || 0.5) - 0.22,
          Number(stable?.guardedness || 0.5) + 0.2,
          baseDisclosure - 0.14
        ), style?.enemies),
        strangers: mergeStyleHintIntoPersonaMode(buildPersonaModeFromNumbers(
          'cautious, information-light, testing distance first',
          baseDirectness - 0.04,
          Number(dynamic?.trust || 0.5) - 0.08,
          Number(stable?.guardedness || 0.5) + 0.1,
          baseDisclosure - 0.08
        ), [style?.strangers, worldSignals.entityContextHints.slice(0, 1)])
      },
      byScene: {
        public: mergeStyleHintIntoPersonaMode(buildPersonaModeFromNumbers('presentation tightens and personal leakage drops', baseDirectness, Number(dynamic?.warmth || dynamic?.trust || 0.5), Number(stable?.guardedness || 0.5) + 0.12, baseDisclosure - 0.12), publicHints),
        private: mergeStyleHintIntoPersonaMode(buildPersonaModeFromNumbers('private space allows more texture and guarded honesty', baseDirectness, Number(dynamic?.trust || 0.5) + 0.08, Number(stable?.guardedness || 0.5) - 0.08, baseDisclosure + 0.1), privateHints),
        conflict: mergeStyleHintIntoPersonaMode(buildPersonaModeFromNumbers('conflict sharpens control and trims softness', baseDirectness + 0.16, Number(dynamic?.trust || 0.5) - 0.16, Number(stable?.guardedness || 0.5) + 0.16, baseDisclosure - 0.08), conflictHints),
        romance: mergeStyleHintIntoPersonaMode(buildPersonaModeFromNumbers('romance increases leakage, caution, and desire at once', baseDirectness - 0.02, Number(dynamic?.trust || 0.5) + 0.14, Number(stable?.guardedness || 0.5) - 0.06, baseDisclosure + 0.18), romanceHints),
        danger: mergeStyleHintIntoPersonaMode(buildPersonaModeFromNumbers('danger compresses speech into survival-focused choices', baseDirectness + 0.12, Number(dynamic?.trust || 0.5) - 0.08, Number(stable?.guardedness || 0.5) + 0.18, baseDisclosure - 0.12), dangerHints),
        shame: mergeStyleHintIntoPersonaMode(buildPersonaModeFromNumbers('shame pulls inward and reduces explicit self-exposure', baseDirectness - 0.08, Number(dynamic?.trust || 0.5) - 0.1, Number(stable?.guardedness || 0.5) + 0.2, baseDisclosure - 0.16), shameHints)
      }
    };
    return core.personaModes;
  };

  const deriveDevelopmentState = (entity = {}, core = {}, context = {}, verificationSnapshot = {}) => {
    const desire = compactText(core?.mind?.branches?.desire?.summary || '', 160);
    const bond = compactText(core?.mind?.branches?.bond?.summary || '', 160);
    const fixation = compactText(core?.mind?.branches?.fixation?.summary || '', 160);
    const fear = compactText(core?.mind?.branches?.fear?.summary || '', 160);
    const wound = compactText(core?.mind?.branches?.wound?.summary || '', 160);
    const worldSignals = getWorldSignalSnapshot(context, entity, core);
    core.development = {
      longTermGoals: uniqueTexts([
        core?.mind?.coreMind || core?.selfModel?.selfNarrative || '',
        ensureArray(core?.profile?.values || [])[0] || '',
        desire ? `Sustain identity axis: ${desire}` : '',
        worldSignals.worldCodexSignals[0] ? `Stay inside world frame: ${compactText(worldSignals.worldCodexSignals[0], 120)}` : ''
      ], 5),
      mediumTermGoals: uniqueTexts([
        desire ? `Advance motive: ${desire}` : (core?.mind?.coreMind || ''),
        bond ? `Stabilize bond axis: ${bond}` : '',
        ensureArray(verificationSnapshot?.predictions || [])[0] || '',
        worldSignals.storylineCarryoverSignals[0] ? `Carry storyline pressure: ${compactText(worldSignals.storylineCarryoverSignals[0], 120)}` : ''
      ], 6),
      immediateGoals: uniqueTexts([
        core?.psyche?.dynamic?.currentGoal || core?.mind?.coreMind || '',
        ensureArray(verificationSnapshot?.opportunities || [])[0] || '',
        fixation ? `Immediate pull: ${fixation}` : '',
        worldSignals.scenePressures[0] ? `Answer scene pressure: ${compactText(worldSignals.scenePressures[0], 120)}` : ''
      ], 6),
      forbiddenLines: uniqueTexts([
        ...ensureArray(core?.profile?.taboos || []).slice(0, 4),
        ensureArray(verificationSnapshot?.continuityLocks || []).find(row => /Taboo pressure:/i.test(row)) || '',
        ...ensureArray(worldSignals.worldLimits || []).slice(0, 2)
      ], 6),
      collapseTriggers: uniqueTexts([
        fear,
        wound,
        Number(core?.psyche?.dynamic?.maskStrength || 0) >= 0.62 ? 'sustained emotional exposure without control' : '',
        ensureArray(verificationSnapshot?.recentInvestigations || []).find(row => row?.key === 'contradiction_guard')?.result || '',
        worldSignals.scenePressures.find(item => /(danger|threat|corner|expose|public shame|위험|폭로|수치)/i.test(item)) || ''
      ], 6),
      growthRules: uniqueTexts([
        bond ? `Growth through reciprocal bond pressure: ${bond}` : '',
        ensureArray(verificationSnapshot?.opportunities || []).find(row => /reveal|bond|reconnect/i.test(row)) || '',
        core?.mind?.valueFrame ? `Growth should preserve ${core.mind.valueFrame}` : '',
        worldSignals.relationStateSignals[0] ? `Growth must respect relation pressure: ${compactText(worldSignals.relationStateSignals[0], 120)}` : ''
      ], 6),
      regressionRules: uniqueTexts([
        fear ? `Regression under fear: ${fear}` : '',
        fixation ? `Regression loops around fixation: ${fixation}` : '',
        Number(core?.psyche?.dynamic?.maskStrength || 0) >= 0.62 ? 'regresses into guarded-withdrawal when pressure spikes' : '',
        worldSignals.storylineCarryoverSignals[0] ? `Regression risk if carryover is ignored: ${compactText(worldSignals.storylineCarryoverSignals[0], 120)}` : ''
      ], 6)
    };
    return core.development;
  };

  const deriveNsfwState = (entity = {}, core = {}, context = {}, recallBundle = {}, verificationSnapshot = {}) => {
    const existing = normalizeNsfw(core?.nsfw || {});
    const evidenceText = compactText([
      extractUserText(context),
      extractAssistantText(context),
      recallBundle?.recentText || '',
      recallBundle?.memory?.text || '',
      ensureArray(recallBundle?.recall?.highlights || []).join('\n'),
      ensureArray(recallBundle?.memory?.previousEntries || []).map(entry => entry?.summary || '').join('\n')
    ].filter(Boolean).join('\n'), 3200);
    const counterparts = collectNsfwCounterparts(entity, core, context, evidenceText);
    const trust = Number(core?.psyche?.dynamic?.trust || 0.5);
    const fear = Number(core?.psyche?.dynamic?.fear || 0.15);
    const shame = Number(core?.psyche?.dynamic?.shame || 0.1);
    const longing = Number(core?.psyche?.dynamic?.longing || 0.1);
    const pressure = Number(core?.psyche?.dynamic?.emotionalPressure || 0.15);
    const mask = Number(core?.psyche?.dynamic?.maskStrength || 0.5);
    const relationFocus = deriveRelationFocus(core?.psyche?.relations || {});
    const intimacyCue = /(kiss|touch|embrace|desire|want you|romance|키스|입맞춤|안기|껴안|끌리|원해)/i.test(evidenceText);
    const sexCue = /(sex|intercourse|slept with|inside|동침|삽입|성관계|잤다|관계를 가졌다)/i.test(evidenceText);
    const stimulationCue = /(caress|stroke|rub|lick|suck|touch|애무|만지|문지|핥|빨|자극)/i.test(evidenceText);
    const refusalCue = /(stop|don't|no more|not now|싫어|하지 마|멈춰|안 돼|거부)/i.test(evidenceText);
    const coercionCue = /(force|forced|held down|threat|억지|강제로|위협|강압)/i.test(evidenceText);
    const periodStartCue = /(period started|on my period|생리\s*(시작|중|왔다)|월경\s*(시작|중))/i.test(evidenceText);
    const periodEndCue = /(period ended|생리\s*(끝|끝났)|월경\s*(끝|종료))/i.test(evidenceText);
    const pregnantCue = /(pregnant|임신(이다|했다|중|상태)|positive test|양성)/i.test(evidenceText);
    const notPregnantCue = /(not pregnant|비임신|임신 아님|negative test|음성)/i.test(evidenceText);
    const firstTimeCue = /(first time|first partner|첫 경험|처녀|동정|virgin)/i.test(evidenceText);
    const arousal = clampNumber(
      (Number(existing?.dynamic?.arousal || 0.1) * 0.42)
      + (intimacyCue ? 0.14 : 0)
      + (sexCue ? 0.2 : 0)
      + (stimulationCue ? 0.16 : 0)
      + (longing * 0.24)
      + (trust * 0.08)
      - (fear * 0.08)
      - (refusalCue ? 0.18 : 0),
      0.1,
      0,
      1
    );
    const restraint = clampNumber(
      (mask * 0.4)
      + (fear * 0.2)
      + (shame * 0.18)
      + (ensureArray(core?.profile?.taboos || []).length ? 0.08 : 0)
      + (refusalCue ? 0.18 : 0)
      - (trust * 0.08),
      0.5,
      0,
      1
    );
    const receptivity = clampNumber(
      (trust * 0.34)
      + (longing * 0.22)
      + (intimacyCue ? 0.14 : 0)
      - (fear * 0.14)
      - (refusalCue ? 0.22 : 0),
      0.3,
      0,
      1
    );
    const initiative = clampNumber(
      (Number(core?.psyche?.stable?.controlNeed || 0.5) * 0.16)
      + (Number(core?.psyche?.dynamic?.desire || longing || 0.1) * 0.24)
      + (sexCue ? 0.08 : 0)
      - (shame * 0.12)
      - (fear * 0.12),
      0.3,
      0,
      1
    );
    const consentRisk = clampNumber(
      (coercionCue ? 0.74 : 0)
      + (refusalCue ? 0.34 : 0)
      + ((sexCue || stimulationCue) && trust <= 0.35 ? 0.16 : 0)
      + (relationFocus?.tension >= 0.72 ? 0.12 : 0),
      0,
      0,
      1
    );
    const vulnerability = clampNumber(
      (shame * 0.28)
      + (fear * 0.22)
      + (pressure * 0.16)
      + ((intimacyCue || sexCue) ? 0.08 : 0)
      - (trust * 0.08),
      0.3,
      0,
      1
    );
    const gender = compactText(existing?.physiology?.gender || entity?.gender || '', 40);
    const cycleDay = Math.max(0, Number(existing?.physiology?.cycle?.cycleDay || 0) || 0);
    const cycleLengthDays = clampInt(existing?.physiology?.cycle?.cycleLengthDays, 28, 20, 40);
    const nextCycleStatus = periodStartCue
      ? 'menstruating'
      : (periodEndCue ? 'post-menstruation' : compactText(existing?.physiology?.cycle?.menstruationStatus || '', 80));
    const nextPregnancyRisk = pregnantCue
      ? 96
      : (notPregnantCue ? 8 : clampInt(existing?.physiology?.pregnancy?.riskScore, 0, 0, 100));
    const nextPregnancyStatus = pregnantCue
      ? 'pregnancy confirmed'
      : (notPregnantCue ? 'not pregnant' : compactText(existing?.physiology?.pregnancy?.status || '', 80));
    const nextVirginStatus = firstTimeCue
      ? (sexCue ? 'not-virgin' : 'virgin')
      : (sexCue || existing?.profile?.firstPartner ? compactText(existing?.profile?.virginStatus || 'not-virgin', 40) : compactText(existing?.profile?.virginStatus || '', 40));
    const firstPartner = compactText(
      existing?.profile?.firstPartner || extractFirstPartnerCandidate(evidenceText, counterparts),
      120
    );
    const recentSignals = uniqueTexts([
      intimacyCue ? 'intimacy cue detected' : '',
      sexCue ? 'explicit sexual event cue' : '',
      stimulationCue ? 'stimulation cue detected' : '',
      refusalCue ? 'refusal/boundary cue detected' : '',
      coercionCue ? 'coercion cue detected' : '',
      periodStartCue ? 'menstruation cue detected' : '',
      pregnantCue ? 'pregnancy cue detected' : '',
      notPregnantCue ? 'not-pregnant cue detected' : '',
      counterparts[0] ? `counterpart ${counterparts[0]}` : ''
    ], 8);
    const locks = uniqueTexts([
      consentRisk >= 0.42 ? 'Do not override refusal, coercion, or low-trust intimacy boundaries.' : '',
      nextVirginStatus ? `Virgin status anchor: ${nextVirginStatus}` : '',
      nextPregnancyStatus ? `Pregnancy anchor: ${nextPregnancyStatus}` : '',
      nextCycleStatus ? `Cycle anchor: ${nextCycleStatus}` : ''
    ], 6);
    const evidenceRefs = collectCanonicalEvidenceRefs(recallBundle, 6);
    const nsfwPatchQueue = [
      !existing?.profile?.sexualAttitudes && deriveNsfwAttitude(core, existing)
        ? normalizePatchItem({
          id: `patch:${simpleHash(`${entity?.name || ''}|nsfw.profile.sexualAttitudes`)}`,
          type: 'nsfw-attitude',
          targetPath: 'nsfw.profile.sexualAttitudes',
          op: 'set',
          value: deriveNsfwAttitude(core, existing),
          confidence: 0.72,
          safe: true,
          reason: 'NSFW attitude can be compressed from stable taboo, trust, and bond cues.',
          evidenceRefs,
          sourceInvestigation: 'nsfw_state'
        })
        : null,
      !existing?.profile?.firstPartner && firstPartner && firstTimeCue
        ? normalizePatchItem({
          id: `patch:${simpleHash(`${entity?.name || ''}|nsfw.profile.firstPartner|${firstPartner}`)}`,
          type: 'nsfw-first-partner',
          targetPath: 'nsfw.profile.firstPartner',
          op: 'set',
          value: firstPartner,
          confidence: 0.84,
          safe: true,
          reason: 'Current evidence names a likely first partner during a first-time cue.',
          evidenceRefs,
          sourceInvestigation: 'nsfw_state'
        })
        : null,
      !existing?.profile?.virginStatus && nextVirginStatus
        ? normalizePatchItem({
          id: `patch:${simpleHash(`${entity?.name || ''}|nsfw.profile.virginStatus|${nextVirginStatus}`)}`,
          type: 'nsfw-virgin-status',
          targetPath: 'nsfw.profile.virginStatus',
          op: 'set',
          value: nextVirginStatus,
          confidence: sexCue || firstTimeCue ? 0.86 : 0.68,
          safe: true,
          reason: 'Virgin-status anchor can be inferred from explicit first-time or sexual-event wording.',
          evidenceRefs,
          sourceInvestigation: 'nsfw_state'
        })
        : null
    ].filter(Boolean);

    core.nsfw = normalizeNsfw({
      ...existing,
      profile: {
        ...existing.profile,
        sexualAttitudes: deriveNsfwAttitude(core, existing),
        sexualPreferences: deriveNsfwPreferences(core, evidenceText, existing),
        virginStatus: nextVirginStatus,
        firstPartner,
        sexualHistory: compactText(
          existing?.profile?.sexualHistory
          || (sexCue ? compactText(`sexual history references ${counterparts[0] || 'an established counterpart'}`, 220) : ''),
          220
        )
      },
      physiology: {
        ...existing.physiology,
        gender,
        cycle: {
          ...existing.physiology.cycle,
          menstrualCycle: compactText(
            existing?.physiology?.cycle?.menstrualCycle
            || (cycleDay > 0 ? `${cycleLengthDays} day cycle / day ${cycleDay}` : ''),
            80
          ),
          menstruationStatus: nextCycleStatus,
          cycleDay,
          cycleLengthDays
        },
        pregnancy: {
          ...existing.physiology.pregnancy,
          chance: compactText(
            pregnantCue ? '96/100'
              : (notPregnantCue ? '8/100' : existing?.physiology?.pregnancy?.chance || ''),
            80
          ),
          status: nextPregnancyStatus,
          riskScore: nextPregnancyRisk
        },
        sensitivity: compactText(
          existing?.physiology?.sensitivity
          || (stimulationCue ? 'heightened under direct touch and emotional pressure' : ''),
          180
        ),
        stamina: {
          text: compactText(
            existing?.physiology?.stamina?.text
            || ((sexCue || stimulationCue) ? (arousal >= 0.62 ? 'highly activated' : 'engaged but controlled') : ''),
            80
          ),
          score: clampInt(
            existing?.physiology?.stamina?.score
            || Math.round(48 + (trust * 18) + (pressure * 8) - (fear * 10)),
            50,
            0,
            100
          )
        }
      },
      dynamic: {
        arousal,
        restraint,
        receptivity,
        initiative,
        consentRisk,
        vulnerability
      },
      intimacy: {
        counterparts,
        comfortSignals: uniqueTexts([
          ...ensureArray(existing?.intimacy?.comfortSignals || []),
          trust >= 0.62 ? 'opens to closer contact under trust' : '',
          Number(core?.embodiment?.proximityStyle?.touchTolerance || 0) >= 0.46 ? 'touch becomes more acceptable after reassurance' : '',
          relationFocus?.target && trust >= 0.6 ? `comfort rises first around ${relationFocus.target}` : ''
        ], 6),
        refusalSignals: uniqueTexts([
          ...ensureArray(existing?.intimacy?.refusalSignals || []),
          refusalCue ? 'explicit refusal wording detected' : '',
          restraint >= 0.68 ? 'high restraint means escalation needs explicit trust' : '',
          consentRisk >= 0.42 ? 'pressure or coercion language requires hard stop' : ''
        ], 6),
        escalationTriggers: uniqueTexts([
          ...ensureArray(existing?.intimacy?.escalationTriggers || []),
          intimacyCue && trust >= 0.56 ? 'reciprocal affection lowers distance' : '',
          longing >= 0.34 ? 'longing increases initiative when safety is present' : '',
          relationFocus?.target && trust >= 0.62 ? `${relationFocus.target} can trigger faster intimacy escalation` : ''
        ], 6),
        collapseTriggers: uniqueTexts([
          ...ensureArray(existing?.intimacy?.collapseTriggers || []),
          refusalCue ? 'boundary violation language' : '',
          shame >= 0.46 ? 'shame spikes collapse openness quickly' : '',
          fear >= 0.48 ? 'fear rapidly shuts down contact' : '',
          ...ensureArray(core?.development?.collapseTriggers || []).slice(0, 2)
        ], 6)
      },
      verification: {
        recentSignals,
        locks,
        patchQueue: dedupePatchQueue([
          ...ensureArray(existing?.verification?.patchQueue || []),
          ...nsfwPatchQueue
        ], 8)
      }
    });

    core.verification.patchQueue = dedupePatchQueue([
      ...ensureArray(core?.verification?.patchQueue || []),
      ...ensureArray(core?.nsfw?.verification?.patchQueue || [])
    ], getSettings().patchQueueLimit);
    return core.nsfw;
  };

  const deriveContinuityDigestState = (entity = {}, core = {}, context = {}, recallBundle = {}) => {
    const existing = normalizeContinuity(core?.continuity || {});
    const turn = Math.max(0, Number(context?.turn || context?.chat?.turn || 0));
    const liveDate = compactText(
      entity?.status?.currentDate
      || recallBundle?.memory?.directEntries?.slice?.(-1)?.[0]?.timestamp
      || '',
      40
    );
    const currentSummary = compactText([
      deriveContinuitySummary(entity, core, context),
      summarizeWorldPressure(context, entity, core) ? `world ${summarizeWorldPressure(context, entity, core)}` : ''
    ].filter(Boolean).join(' | '), 260);
    const psychologySummary = summarizeCorePsychologyDigest(core);
    const emotionSummary = summarizeCoreEmotionDigest(entity, core);
    const sexualSummary = summarizeNsfwState(core);
    let recentHistory = ensureArray(existing?.recentHistory || []).map(normalizeContinuityHistoryItem).filter(item => item.text);

    const registerChange = (tag, nextText, label = '') => {
      if (!nextText) return;
      const previous = compactText(existing?.[{
        STATUS: 'currentSummary',
        PSYCHOLOGY: 'psychologySummary',
        EMOTION: 'emotionSummary',
        NSFW: 'sexualSummary'
      }[tag] || ''] || '', 260);
      if (nextText !== previous) {
        recentHistory = pushContinuityHistory(recentHistory, {
          turn,
          date: liveDate,
          tag,
          text: tag === 'STATUS' ? nextText : `${label || tag} · ${nextText}`,
          label
        }, 12);
      }
    };

    registerChange('STATUS', currentSummary, 'Status');
    registerChange('PSYCHOLOGY', psychologySummary, 'Psychology');
    registerChange('EMOTION', emotionSummary, 'Emotion');
    registerChange('NSFW', sexualSummary, 'NSFW');

    if (!recentHistory.length) {
      ensureArray(entity?.eventLog || []).slice(-4).forEach((event) => {
        if (!event || typeof event !== 'object') return;
        recentHistory = pushContinuityHistory(recentHistory, {
          turn: Number(event?.turn || 0),
          date: compactText(event?.time || '', 40),
          tag: compactText(event?.tag || 'ACT', 24) || 'ACT',
          text: compactText(event?.description || '', 220),
          label: compactText(event?.source || '', 80)
        }, 12);
      });
    }

    if (
      !recentHistory.length
      && mentionsEntity(compactText(recallBundle?.recentText || '', 1600), entity)
      && compactText(recallBundle?.recentText || '', 180)
    ) {
      recentHistory = pushContinuityHistory(recentHistory, {
        turn,
        date: liveDate,
        tag: 'ACT',
        text: compactText(recallBundle.recentText, 180),
        label: 'Recent turn'
      }, 12);
    }

    core.continuity = normalizeContinuity({
      currentSummary,
      psychologySummary,
      emotionSummary,
      sexualSummary,
      recentHistory
    });
    return core.continuity;
  };

  const applyRecallTemporalDecay = (core = {}, elapsedDays = 0) => {
    const graph = normalizeRecallGraph(core?.memory?.recallGraph || {});
    const days = Math.max(0, Math.min(45, Number(elapsedDays || 0)));
    if (!days) return graph;
    const nextNodes = {};
    Object.values(graph.nodes || {}).forEach((node) => {
      const dailyLoss = node?.promoted ? 1 : 2;
      const faded = clampInt(
        Number(node?.activationScore || 0) - (dailyLoss * days),
        Number(node?.activationScore || 0),
        0,
        100
      );
      node.activationScore = faded;
      if (faded > 0 || node.promoted === true) {
        nextNodes[node.id] = node;
      }
    });
    graph.nodes = nextNodes;
    graph.audit.lastWarnings = uniqueTexts([
      ...ensureArray(graph?.audit?.lastWarnings || []),
      days > 0 ? `temporal decay applied (${days}d)` : ''
    ], 8);
    graph.audit.lastUpdated = Date.now();
    core.memory.recallGraph = graph;
    return graph;
  };

  const applyPsycheTemporalDecay = (core = {}, elapsedDays = 0) => {
    const stable = core?.psyche?.stable || createDefaultStable();
    const dynamic = core?.psyche?.dynamic || createDefaultDynamic();
    const days = Math.max(0, Math.min(45, Number(elapsedDays || 0)));
    if (!days) return dynamic;
    const relationFocus = deriveRelationFocus(core?.psyche?.relations || {});
    dynamic.trust = dampToward(dynamic.trust, relationFocus?.trust ?? 0.5, days, 0.97, 0.5);
    dynamic.fear = dampToward(dynamic.fear, 0.15, days, 0.84, 0.15);
    dynamic.anger = dampToward(dynamic.anger, 0.1, days, 0.82, 0.1);
    dynamic.shame = dampToward(dynamic.shame, 0.1, days, 0.86, 0.1);
    dynamic.sadness = dampToward(dynamic.sadness, 0.1, days, 0.9, 0.1);
    dynamic.longing = dampToward(dynamic.longing, 0.1, days, 0.94, 0.1);
    dynamic.jealousy = dampToward(dynamic.jealousy, 0.05, days, 0.86, 0.05);
    dynamic.relief = dampToward(dynamic.relief, 0.1, days, 0.78, 0.1);
    dynamic.emotionalPressure = dampToward(dynamic.emotionalPressure, 0.15, days, 0.8, 0.15);
    dynamic.maskStrength = dampToward(dynamic.maskStrength, Math.max(0.42, Number(stable?.guardedness || 0.5)), days, 0.92, 0.5);
    if (dynamic.emotionalPressure <= 0.22 && dynamic.fear <= 0.22 && dynamic.anger <= 0.18) {
      dynamic.activeMode = 'steady';
    }
    dynamic.responseStyle = deriveResponseStyle(stable, dynamic);
    dynamic.speechBias = deriveSpeechBias(dynamic, stable, relationFocus);
    core.psyche.dynamic = dynamic;

    const emotion = normalizeEmotionBridgeState(core?.psyche?.emotionBridge || {});
    if (emotion.summary || emotion.intensity > 0) {
      emotion.intensity = dampToward(emotion.intensity, 0, days, 0.76, 0);
      emotion.arousal = dampToward(emotion.arousal, 0, days, 0.8, 0);
      const rawValence = Number(emotion.valence || 0);
      emotion.valence = Number((rawValence * Math.pow(0.88, days)).toFixed(3));
      emotion.control = dampToward(emotion.control, 0.5, days, 0.92, 0.5);
      if (emotion.intensity <= 0.08) {
        emotion.flags = {
          fear: false,
          anger: false,
          shame: false,
          sadness: false,
          longing: false,
          relief: false,
          joy: false
        };
      }
      emotion.summary = compactText([
        emotion.mood ? `mood ${emotion.mood}` : '',
        emotion.signature ? `emotion ${emotion.signature}` : '',
        emotion.blend ? `blend ${emotion.blend}` : '',
        emotion.intensity > 0.02 ? `intensity ${Math.round(emotion.intensity * 100)}%` : '',
        `control ${Math.round(Number(emotion.control || 0.5) * 100)}%`
      ].filter(Boolean).join(' | '), 220);
      core.psyche.emotionBridge = emotion;
    }
    return dynamic;
  };

  const applyNsfwTemporalDecay = (core = {}, elapsedDays = 0) => {
    const nsfw = normalizeNsfw(core?.nsfw || {});
    const days = Math.max(0, Math.min(45, Number(elapsedDays || 0)));
    if (!days) return nsfw;
    nsfw.dynamic.arousal = dampToward(nsfw.dynamic.arousal, 0.1, days, 0.72, 0.1);
    nsfw.dynamic.restraint = dampToward(nsfw.dynamic.restraint, 0.5, days, 0.94, 0.5);
    nsfw.dynamic.receptivity = dampToward(nsfw.dynamic.receptivity, 0.3, days, 0.9, 0.3);
    nsfw.dynamic.initiative = dampToward(nsfw.dynamic.initiative, 0.3, days, 0.9, 0.3);
    nsfw.dynamic.consentRisk = dampToward(nsfw.dynamic.consentRisk, 0, days, 0.66, 0);
    nsfw.dynamic.vulnerability = dampToward(nsfw.dynamic.vulnerability, 0.3, days, 0.86, 0.3);
    core.nsfw = nsfw;
    return nsfw;
  };

  const applyContinuityTemporalDecay = (core = {}, currentDate = '', elapsedDays = 0) => {
    const continuity = normalizeContinuity(core?.continuity || {});
    const days = Math.max(0, Math.min(365, Number(elapsedDays || 0)));
    if (days > 0) {
      continuity.recentHistory = ensureArray(continuity?.recentHistory || [])
        .map(normalizeContinuityHistoryItem)
        .filter((item) => {
          if (!item?.date) return true;
          const age = diffDaysBetween(item.date, currentDate);
          if (!Number.isFinite(age)) return true;
          return age <= 90;
        })
        .slice(-10);
    }
    core.continuity = continuity;
    return continuity;
  };

  const applyTemporalDecay = (entity = {}, core = {}, context = {}, options = {}) => {
    const projection = getTimeProjectionForEntity(entity, context);
    const currentDate = compactText(projection?.currentDate || entity?.status?.currentDate || '', 40);
    if (!currentDate) return { applied: false, elapsedDays: 0, currentDate: '' };
    const lastTemporalDate = compactText(core?.meta?.lastTemporalDate || '', 40);
    if (!options?.force && lastTemporalDate && lastTemporalDate === currentDate) {
      return { applied: false, elapsedDays: 0, currentDate };
    }
    if (!lastTemporalDate) {
      core.meta.lastTemporalDate = currentDate;
      return { applied: false, elapsedDays: 0, currentDate };
    }
    const elapsedDays = diffDaysBetween(lastTemporalDate, currentDate);
    if (!Number.isFinite(elapsedDays) || elapsedDays <= 0) {
      core.meta.lastTemporalDate = currentDate;
      return { applied: false, elapsedDays: 0, currentDate };
    }
    applyRecallTemporalDecay(core, elapsedDays);
    applyPsycheTemporalDecay(core, elapsedDays);
    applyNsfwTemporalDecay(core, elapsedDays);
    applyContinuityTemporalDecay(core, currentDate, elapsedDays);
    core.meta.lastTemporalDate = currentDate;
    core.meta.lastUpdated = Date.now();
    return { applied: true, elapsedDays, currentDate };
  };

  const runCharacterAlivenessPass = (entity = {}, core = {}, context = {}, recallBundle = {}, verificationSnapshot = {}) => {
    applyEmotionBridgeToPsyche(entity, core, context);
    deriveExpressionState(entity, core, context, recallBundle);
    deriveEmbodimentState(entity, core, context, recallBundle);
    deriveSelfModelState(entity, core, context, recallBundle, verificationSnapshot);
    derivePersonaModes(entity, core, context);
    deriveDevelopmentState(entity, core, context, verificationSnapshot);
    deriveNsfwState(entity, core, context, recallBundle, verificationSnapshot);
    deriveContinuityDigestState(entity, core, context, recallBundle);
    return core;
  };

  const scoreBranchIntensity = (branch = {}) => {
    const summary = compactText(branch?.summary || '', 180);
    const nodeCount = ensureArray(branch?.nodes).length;
    return Math.max(0, Math.min(1, (summary ? 0.45 : 0) + (nodeCount * 0.1)));
  };

  const RecallGraph = {
    select(core = {}, queryText = '', options = {}) {
      const settings = getSettings();
      const graph = normalizeRecallGraph(core?.memory?.recallGraph || {});
      const queryTokens = tokenize(queryText);
      if (!queryTokens.length) {
        return { ids: [], nodes: [], highlights: [], refs: [] };
      }
      const scored = Object.values(graph.nodes || {})
        .map((node) => {
          const nodeTokens = tokenize(`${node.name} ${node.preview} ${(node.keywords || []).join(' ')}`);
          const score = (tokenSimilarity(queryTokens, nodeTokens) * 0.62) + ((Number(node.activationScore || 0) / 100) * 0.38);
          return { node, score };
        })
        .filter(row => row.score > 0.08)
        .sort((left, right) => right.score - left.score)
        .slice(0, Math.max(2, Number(options?.topK || settings.recallTopK)));
      const visited = new Set(scored.map(row => row.node.id));
      let frontier = scored.map(row => row.node.id);
      for (let hop = 0; hop < Math.max(1, Number(options?.hopDepth || settings.recallHopDepth)); hop += 1) {
        const nextFrontier = [];
        frontier.forEach((nodeId) => {
          const node = graph.nodes[nodeId];
          ensureArray(node?.relationships).forEach((rel) => {
            if (!rel?.targetId || visited.has(rel.targetId)) return;
            visited.add(rel.targetId);
            nextFrontier.push(rel.targetId);
          });
        });
        if (!nextFrontier.length) break;
        frontier = nextFrontier;
      }
      const selectedIds = Array.from(visited).slice(0, Math.max(2, Number(options?.topK || settings.recallTopK) + 2));
      const nodes = selectedIds.map(id => graph.nodes[id]).filter(Boolean);
      return {
        ids: selectedIds,
        nodes,
        highlights: uniqueTexts(
          nodes.map(node => compactText(node.preview || node.name || '', 180)).filter(Boolean),
          settings.promptRecallHighlights
        ),
        refs: uniqueTexts(nodes.flatMap(node => node.dmaRefs || []), 24)
      };
    },
    ingest(core = {}, entity = {}, directEntry = null, previousEntries = []) {
      const graph = normalizeRecallGraph(core?.memory?.recallGraph || {});
      const inserted = [];
      const currentTurn = Math.max(0, Number(directEntry?.turn || core?.meta?.lastTurnKey || 0));
      if (directEntry) {
        const eventResult = upsertRecallNode(graph, {
          id: `recall:event:${directEntry.id}`,
          type: 'event',
          name: compactText(directEntry.preview || directEntry.episode || `Turn ${directEntry.turn}`, 120),
          preview: compactText(directEntry.preview || directEntry.episode || '', 220),
          dmaRefs: [`direct:${directEntry.id}`],
          keywords: uniqueTexts([
            ...ensureArray(directEntry.entityNames),
            ...ensureArray(directEntry.locations),
            ...ensureArray(directEntry.continuityHints),
            ...tokenize(directEntry.preview || directEntry.episode || '')
          ], 18),
          activationScore: 68,
          promoted: false,
          hitCount: 1,
          createdTurn: currentTurn,
          lastSeenTurn: currentTurn
        });
        inserted.push(eventResult.id);

        if (ensureArray(directEntry.entityNames).length >= 2) {
          const relationResult = upsertRecallNode(graph, {
            id: `recall:relation:${simpleHash(directEntry.entityNames.join('|'))}`,
            type: 'relation',
            name: compactText(directEntry.entityNames.join(' - '), 120),
            preview: compactText(directEntry.preview || directEntry.episode || '', 200),
            dmaRefs: [`direct:${directEntry.id}`],
            keywords: uniqueTexts([
              ...ensureArray(directEntry.entityNames),
              ...tokenize(directEntry.preview || '')
            ], 18),
            activationScore: 62,
            hitCount: 1,
            createdTurn: currentTurn,
            lastSeenTurn: currentTurn
          });
          inserted.push(relationResult.id);
          addRelationship(graph, eventResult.id, relationResult.id, 'related', 0.72);
          addRelationship(graph, relationResult.id, eventResult.id, 'related', 0.72);
        }

        if (ensureArray(directEntry.locations).length || ensureArray(directEntry.continuityHints).length) {
          const worldResult = upsertRecallNode(graph, {
            id: `recall:world:${simpleHash(`${directEntry.locations.join('|')}|${directEntry.continuityHints.join('|')}`)}`,
            type: 'world',
            name: compactText(directEntry.locations[0] || directEntry.continuityHints[0] || 'World anchor', 120),
            preview: compactText([
              ensureArray(directEntry.locations).join(', '),
              ensureArray(directEntry.continuityHints).join(' | ')
            ].filter(Boolean).join(' | '), 220),
            dmaRefs: [`direct:${directEntry.id}`],
            keywords: uniqueTexts([
              ...ensureArray(directEntry.locations),
              ...ensureArray(directEntry.continuityHints)
            ], 18),
            activationScore: 58,
            hitCount: 1,
            createdTurn: currentTurn,
            lastSeenTurn: currentTurn
          });
          inserted.push(worldResult.id);
          addRelationship(graph, eventResult.id, worldResult.id, 'context', 0.61);
          addRelationship(graph, worldResult.id, eventResult.id, 'context', 0.61);
        }
      }

      ensureArray(previousEntries).map(normalizePreviousEntry).slice(-2).forEach((entry) => {
        const result = upsertRecallNode(graph, {
          id: `recall:previous:${entry.id}`,
          type: 'event',
          name: compactText(entry.summary || entry.title || 'Previous arc', 120),
          preview: compactText(entry.summary || entry.content || '', 220),
          dmaRefs: [`previous:${entry.id}`],
          keywords: uniqueTexts([
            ...ensureArray(entry.entityNames),
            ...ensureArray(entry.locations),
            ...tokenize(entry.summary || entry.content || '')
          ], 18),
          activationScore: 52,
          createdTurn: Number(entry.toTurn || 0),
          lastSeenTurn: Number(entry.toTurn || 0)
        });
        inserted.push(result.id);
      });

      core.memory.recallGraph = graph;
      return {
        insertedIds: uniqueTexts(inserted, 16)
      };
    },
    decay(core = {}, selectedIds = []) {
      const settings = getSettings();
      const graph = normalizeRecallGraph(core?.memory?.recallGraph || {});
      const selected = new Set(ensureArray(selectedIds));
      const warnings = [];
      Object.values(graph.nodes || {}).forEach((node) => {
        if (selected.has(node.id)) {
          node.activationScore = clampInt(Number(node.activationScore || 0) + settings.activationGain, Number(node.activationScore || 0), 0, 100);
          node.hitCount = clampInt(Number(node.hitCount || 0) + 1, 0, 0, 9999);
        } else {
          node.activationScore = clampInt(Number(node.activationScore || 0) - settings.activationDecay, Number(node.activationScore || 0), 0, 100);
        }
        if (node.activationScore >= settings.highThreshold) node.promoted = true;
        if (node.hitCount >= settings.promoteAfterHits) node.promoted = true;
      });
      const nextNodes = {};
      Object.values(graph.nodes || {}).forEach((node) => {
        if (Number(node.activationScore || 0) <= 0 && !node.promoted) return;
        nextNodes[node.id] = node;
      });
      graph.nodes = nextNodes;
      if (Object.keys(graph.nodes).length === 0) warnings.push('recall graph became empty after decay');
      graph.audit.lastWarnings = uniqueTexts([...(graph.audit.lastWarnings || []), ...warnings], 8);
      graph.audit.lastUpdated = Date.now();
      core.memory.recallGraph = graph;
      return graph;
    }
  };

  const MindEngine = {
    update(core = {}, entity = {}, bundle = {}) {
      const lines = buildEvidenceLines(bundle);
      let touched = false;
      lines.forEach((line) => {
        const branchKey = classifyTextToBranch(line);
        if (!branchKey) return;
        const changed = upsertMindNode(core.mind.branches[branchKey], line, {
          source: 'evidence',
          dmaRefs: ensureArray(bundle?.memory?.dmaRefs?.direct).slice(0, 3),
          updatedAt: nowIso()
        });
        touched = touched || changed;
      });
      BRANCH_ORDER.forEach((branchKey) => {
        const branch = core.mind.branches[branchKey];
        if (!branch.summary && ensureArray(branch.nodes).length) {
          branch.summary = compactText(branch.nodes[0].text || '', 180);
        }
      });
      if (touched || !core.mind.coreMind) core.mind.coreMind = deriveCoreMind(core);
      core.mind.selfNarrative = deriveSelfNarrative(core);
      core.mind.valueFrame = deriveValueFrame(core);
      core.mind.bodySignature = uniqueTexts([
        ...(ensureArray(core?.mind?.bodySignature || [])),
        ...extractBodySignature(bundle?.recentText || '')
      ], 8);
      return core;
    }
  };

  const deriveRelationFocus = (relations = {}) => {
    const rows = Object.entries(relations && typeof relations === 'object' ? relations : {})
      .map(([target, relation]) => {
        const normalized = normalizeRelationshipState(relation, target);
        const legacy = projectRelationshipStateToLegacy(normalized);
        return {
          target: compactText(target || '', 80),
          trust: round3(legacy?.trust, 0.5),
          attachment: round3(legacy?.attachment, 0.5),
          tension: round3(legacy?.tension, 0.1),
          avoidance: round3(legacy?.avoidance, 0.3),
          resentment: round3(legacy?.resentment, 0.1),
          affection: round3(normalized?.coreState?.affection, 0.5),
          respect: round3(normalized?.coreState?.respect, 0.5),
          attraction: round3(normalized?.coreState?.attraction, 0.1),
          grievance: round3(normalized?.coreState?.grievance, 0.1),
          dependency: round3(normalized?.dynamics?.dependency, 0.3),
          openness: round3(normalized?.dynamics?.openness, 0.5),
          boundarySafety: round3(normalized?.dynamics?.boundarySafety, 0.5),
          volatility: round3(normalized?.dynamics?.volatility, 0.2),
          powerBalance: round3(normalized?.dynamics?.powerBalance, 0.5),
          type: compactText(normalized?.identity?.type || '', 40),
          stage: compactText(normalized?.identity?.stage || '', 40),
          publicStatus: compactText(normalized?.identity?.publicStatus || '', 32),
          primaryDynamic: compactText(normalized?.identity?.primaryDynamic || '', 40),
          axis: pickDominantRelationshipAxis(normalized?.coreState || {}, normalized?.dynamics || {})
        };
      })
      .filter(row => row.target);
    if (!rows.length) return null;
    rows.sort((left, right) => (
      ((right.attachment * 0.45) + (right.tension * 0.35) + (right.resentment * 0.2))
      - ((left.attachment * 0.45) + (left.tension * 0.35) + (left.resentment * 0.2))
    ));
    return rows[0];
  };

  const scoreSignal = (text = '', patterns = []) => {
    const source = String(text || '');
    return patterns.reduce((score, pattern) => (
      source.match(pattern) ? score + 0.12 : score
    ), 0);
  };

  const deriveResponseStyle = (stable = {}, dynamic = {}) => ({
    disclosure: round3((stable.emotionalExpressiveness * 0.46) + (dynamic.trust * 0.18) - (dynamic.maskStrength * 0.22) - (dynamic.shame * 0.16), 0.5),
    warmth: round3((dynamic.trust * 0.38) + (dynamic.longing * 0.18) + (dynamic.relief * 0.12) - (dynamic.anger * 0.18), 0.5),
    directness: round3((stable.controlNeed * 0.22) + (dynamic.activeMode === 'confrontational-control' ? 0.18 : 0.04) - (dynamic.fear * 0.16), 0.5),
    aggression: round3((dynamic.anger * 0.48) + (stable.angerReadiness * 0.2) - (dynamic.relief * 0.08), 0.2),
    avoidance: round3((dynamic.fear * 0.26) + (dynamic.shame * 0.18) + (stable.guardedness * 0.24), 0.3),
    appeasement: round3((dynamic.longing * 0.18) + (dynamic.trust * 0.14) + ((1 - dynamic.anger) * 0.08), 0.2)
  });

  const deriveSpeechBias = (dynamic = {}, stable = {}, relationFocus = null) => {
    const parts = [];
    if (Number(dynamic.maskStrength || 0) > 0.62) parts.push('shorter, guarded, selective disclosure');
    else if (Number(dynamic.trust || 0) > 0.62) parts.push('warmer, more open, less defensive');

    if (Number(dynamic.fear || 0) > 0.56) parts.push('checks threat before committing');
    if (Number(dynamic.anger || 0) > 0.52) parts.push('sharper edges under pressure');
    if (Number(stable.controlNeed || 0) > 0.62) parts.push('tries to steer the exchange');
    if (relationFocus?.target) {
      if (relationFocus.tension >= 0.55) parts.push(`speaks with tension around ${relationFocus.target}`);
      else if (relationFocus.trust >= 0.62) parts.push(`speaks more easily around ${relationFocus.target}`);
    }
    return compactText(parts.join(' | '), 220);
  };

  const PsycheEngine = {
    update(core = {}, entity = {}, bundle = {}, context = {}) {
      const desire = scoreBranchIntensity(core?.mind?.branches?.desire);
      const fear = scoreBranchIntensity(core?.mind?.branches?.fear);
      const wound = scoreBranchIntensity(core?.mind?.branches?.wound);
      const mask = scoreBranchIntensity(core?.mind?.branches?.mask);
      const bond = scoreBranchIntensity(core?.mind?.branches?.bond);
      const fixation = scoreBranchIntensity(core?.mind?.branches?.fixation);
      const recentText = normalizeText(bundle?.recentText || '');

      core.psyche.stable = {
        closenessNeed: round3(0.42 + (bond * 0.26) + (desire * 0.08) - (mask * 0.06), 0.5),
        autonomyNeed: round3(0.42 + (mask * 0.18) + (fear * 0.08), 0.5),
        controlNeed: round3(0.4 + (mask * 0.18) + (fixation * 0.16) + (fear * 0.06), 0.5),
        threatSensitivity: round3(0.34 + (fear * 0.34) + (wound * 0.14), 0.5),
        shameSensitivity: round3(0.3 + (wound * 0.28) + (mask * 0.12), 0.5),
        angerReadiness: round3(0.22 + (wound * 0.12) + (fixation * 0.1) + scoreSignal(recentText, [/(분노|짜증|resent|anger|hostile)/i]), 0.35),
        guardedness: round3(0.34 + (mask * 0.34) + (fear * 0.14), 0.5),
        resilience: round3(0.42 + (bond * 0.12) + ((ensureArray(core?.profile?.values).length > 0) ? 0.08 : 0) - (wound * 0.08), 0.5),
        emotionalExpressiveness: round3(0.42 + (bond * 0.18) - (mask * 0.18), 0.5)
      };

      const dynamic = {
        trust: round3(0.42 + (bond * 0.26) + scoreSignal(recentText, [/(안심|편안|trust|safe|reassur)/i]) - (fear * 0.14), 0.5),
        fear: round3(0.12 + (fear * 0.46) + scoreSignal(recentText, [/(불안|초조|fear|anxious|worry|위협)/i]), 0.15),
        anger: round3(0.08 + (wound * 0.14) + (fixation * 0.08) + scoreSignal(recentText, [/(분노|짜증|anger|hostile|resent|대립)/i]), 0.1),
        shame: round3(0.08 + (wound * 0.2) + (mask * 0.16) + scoreSignal(recentText, [/(수치|부끄|shame|embarrass)/i]), 0.1),
        sadness: round3(0.08 + (wound * 0.2) + scoreSignal(recentText, [/(슬픔|상실|grief|sad|hurt)/i]), 0.1),
        longing: round3(0.08 + (desire * 0.18) + (bond * 0.18) + scoreSignal(recentText, [/(그리움|애정|yearn|long|miss)/i]), 0.1),
        jealousy: round3(0.04 + (fixation * 0.14) + scoreSignal(recentText, [/(질투|jealous)/i]), 0.05),
        relief: round3(0.08 + (bond * 0.12) + scoreSignal(recentText, [/(안도|안심|relief|calm)/i]) - scoreSignal(recentText, [/(불안|fear|worry)/i]) * 0.4, 0.1),
        emotionalPressure: 0,
        maskStrength: round3((mask * 0.34) + (fear * 0.12) + (wound * 0.1) + (1 - (0.42 + (bond * 0.26) - (fear * 0.14))) * 0.1, 0.5),
        activeMode: 'steady',
        currentGoal: compactText(core?.mind?.branches?.desire?.summary || core?.mind?.branches?.fixation?.summary || '', 160),
        speechBias: '',
        responseStyle: createDefaultDynamic().responseStyle
      };
      dynamic.emotionalPressure = round3(
        (dynamic.fear * 0.24)
        + (dynamic.anger * 0.2)
        + (dynamic.shame * 0.16)
        + (dynamic.longing * 0.12)
        - (dynamic.relief * 0.14),
        0.15
      );

      if (dynamic.fear >= 0.56 && dynamic.longing >= 0.5 && core.psyche.stable.guardedness >= 0.56) dynamic.activeMode = 'push-pull';
      else if (dynamic.anger >= 0.54 && core.psyche.stable.controlNeed >= 0.56) dynamic.activeMode = 'confrontational-control';
      else if (dynamic.maskStrength >= 0.6 && dynamic.emotionalPressure >= 0.48) dynamic.activeMode = 'guarded-withdrawal';
      else if (fixation >= 0.54 && desire >= 0.46) dynamic.activeMode = 'locked-pursuit';
      else if (dynamic.relief >= 0.45 && dynamic.trust >= 0.55) dynamic.activeMode = 'open-connection';

      const relationCacheRows = getRelationCacheRows(context);
      const entityName = normalizeName(entity?.name || '');
      const existingRelationships = normalizeRelationshipMap(core?.psyche?.relationships || core?.psyche?.relations || {});
      const nextRelationships = {};
      const mentionedPeers = [];
      getEntityCache(context).forEach((peer, rawName) => {
        const peerName = normalizeName(rawName || peer?.name || '');
        if (!peerName || peerName === entityName) return;
        if (!mentionsEntity(recentText, peer)) return;
        mentionedPeers.push(peerName);
      });

      relationCacheRows.forEach((row) => {
        const a = normalizeName(row?.entityA || '');
        const b = normalizeName(row?.entityB || '');
        if (!entityName || (!a || !b)) return;
        const peerName = a === entityName ? b : (b === entityName ? a : '');
        if (!peerName || (!mentionedPeers.includes(peerName) && !mentionsEntity(recentText, { name: peerName }))) return;
        const closeness = Number(row?.details?.closeness);
        const trustMetric = Number(row?.details?.trust);
        const tensionMetric = Number(row?.sentiments?.currentTension);
        const existing = normalizeRelationshipState(existingRelationships[peerName] || {}, peerName);
        const trustValue = round3(Number.isFinite(trustMetric) ? trustMetric : dynamic.trust, existing?.coreState?.trust || 0.5);
        const affectionValue = round3(Number.isFinite(closeness) ? closeness : dynamic.longing, existing?.coreState?.affection || 0.5);
        const tensionValue = round3(Number.isFinite(tensionMetric) ? tensionMetric : dynamic.emotionalPressure * 0.6, existing?.coreState?.tension || 0.1);
        const grievanceValue = round3(
          (dynamic.anger * 0.28)
          + (dynamic.shame * 0.08)
          + (Math.max(0, tensionValue - trustValue) * 0.12),
          existing?.coreState?.grievance || 0.1
        );
        nextRelationships[peerName] = normalizeRelationshipState({
          ...existing,
          coreState: {
            ...existing.coreState,
            trust: trustValue,
            affection: affectionValue,
            tension: tensionValue,
            respect: round3((trustValue * 0.54) + ((1 - grievanceValue) * 0.18) + (affectionValue * 0.08), existing?.coreState?.respect || 0.5),
            attraction: round3((dynamic.longing * 0.38) + (affectionValue * 0.22) + (dynamic.jealousy * 0.08), existing?.coreState?.attraction || 0.1),
            grievance: grievanceValue
          },
          dynamics: {
            ...existing.dynamics,
            dependency: round3((affectionValue * 0.32) + (trustValue * 0.14) + (dynamic.longing * 0.16), existing?.dynamics?.dependency || 0.3),
            openness: round3((trustValue * 0.52) + ((1 - dynamic.maskStrength) * 0.18) - (dynamic.fear * 0.14), existing?.dynamics?.openness || 0.5),
            boundarySafety: round3((trustValue * 0.46) + ((1 - tensionValue) * 0.18) + ((1 - grievanceValue) * 0.14), existing?.dynamics?.boundarySafety || 0.5),
            volatility: round3((tensionValue * 0.46) + (grievanceValue * 0.22) + (dynamic.emotionalPressure * 0.12), existing?.dynamics?.volatility || 0.2),
            powerBalance: round3(existing?.dynamics?.powerBalance, 0.5)
          },
          context: {
            ...existing.context,
            publicMode: compactText(existing?.context?.publicMode || '', 120),
            privateMode: compactText(existing?.context?.privateMode || '', 120)
          },
          history: {
            ...existing.history,
            anchorEvents: uniqueTexts(existing?.history?.anchorEvents || [], 8),
            recentShifts: uniqueTexts([
              ...(existing?.history?.recentShifts || []),
              row?.relationType ? `Relation hint: ${compactText(row.relationType, 120)}` : '',
              `Turn-linked relation cache sync for ${peerName}`
            ], 8),
            openLoops: uniqueTexts(existing?.history?.openLoops || [], 8)
          }
        }, peerName);
      });

      mentionedPeers.forEach((peerName) => {
        if (nextRelationships[peerName]) return;
        const existing = normalizeRelationshipState(existingRelationships[peerName] || {}, peerName);
        const trustValue = round3(dynamic.trust, existing?.coreState?.trust || 0.5);
        const affectionValue = round3(dynamic.longing, existing?.coreState?.affection || 0.5);
        const tensionValue = round3(dynamic.emotionalPressure * 0.58, existing?.coreState?.tension || 0.1);
        const grievanceValue = round3(dynamic.anger * 0.28, existing?.coreState?.grievance || 0.1);
        nextRelationships[peerName] = normalizeRelationshipState({
          ...existing,
          coreState: {
            ...existing.coreState,
            trust: trustValue,
            affection: affectionValue,
            tension: tensionValue,
            respect: round3((trustValue * 0.5) + ((1 - grievanceValue) * 0.18), existing?.coreState?.respect || 0.5),
            attraction: round3((dynamic.longing * 0.34) + (dynamic.jealousy * 0.08), existing?.coreState?.attraction || 0.1),
            grievance: grievanceValue
          },
          dynamics: {
            ...existing.dynamics,
            dependency: round3((affectionValue * 0.28) + (trustValue * 0.16), existing?.dynamics?.dependency || 0.3),
            openness: round3((trustValue * 0.46) + ((1 - dynamic.maskStrength) * 0.18), existing?.dynamics?.openness || 0.5),
            boundarySafety: round3((trustValue * 0.42) + ((1 - tensionValue) * 0.2), existing?.dynamics?.boundarySafety || 0.5),
            volatility: round3((tensionValue * 0.44) + (dynamic.emotionalPressure * 0.14), existing?.dynamics?.volatility || 0.2),
            powerBalance: round3(existing?.dynamics?.powerBalance, 0.5)
          },
          history: {
            ...existing.history,
            anchorEvents: uniqueTexts(existing?.history?.anchorEvents || [], 8),
            recentShifts: uniqueTexts([
              ...(existing?.history?.recentShifts || []),
              `Turn-linked mention sync for ${peerName}`
            ], 8),
            openLoops: uniqueTexts(existing?.history?.openLoops || [], 8)
          }
        }, peerName);
      });

      core.psyche.relationshipModelVersion = 'v2-hybrid';
      core.psyche.relationships = nextRelationships;
      core.psyche.relations = projectRelationshipMapToLegacy(nextRelationships);
      const relationFocus = deriveRelationFocus(nextRelationships);
      dynamic.responseStyle = deriveResponseStyle(core.psyche.stable, dynamic);
      dynamic.speechBias = deriveSpeechBias(dynamic, core.psyche.stable, relationFocus);
      core.psyche.dynamic = dynamic;
      core.psyche.evidence.recent = uniqueTexts([
        ...ensureArray(core?.psyche?.evidence?.recent || []).map(row => `${row.signal}:${row.snippet}`),
        ...buildEvidenceLines(bundle).slice(0, 4).map(text => `evidence:${text}`)
      ], 6).map((text) => {
        const parts = text.split(':');
        return normalizePsychEvidenceRow({
          signal: compactText(parts.shift() || 'evidence', 40),
          snippet: compactText(parts.join(':') || '', 160),
          weight: 0.6
        });
      });
      return core;
    }
  };

  const getPathValue = (target = {}, path = '') => String(path || '').split('.').filter(Boolean).reduce((cursor, segment) => (
    cursor && typeof cursor === 'object' ? cursor[segment] : undefined
  ), target);
  const setPathValue = (target = {}, path = '', value = null, op = 'set') => {
    const segments = String(path || '').split('.').filter(Boolean);
    if (!segments.length) return false;
    let cursor = target;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i];
      if (!cursor[segment] || typeof cursor[segment] !== 'object') cursor[segment] = {};
      cursor = cursor[segment];
    }
    const leaf = segments[segments.length - 1];
    if (op === 'appendUnique') {
      cursor[leaf] = uniqueTexts([...(Array.isArray(cursor[leaf]) ? cursor[leaf] : []), ...ensureArray(value)], 24);
      return true;
    }
    cursor[leaf] = cloneValue(value, null);
    return true;
  };

  const buildPatchExampleMachine = (core = {}, patch = {}) => ({
    entityCoreX: {
      verification: {
        patchQueue: [normalizePatchItem(patch)]
      }
    },
    psychology: {
      want: compactText(core?.mind?.branches?.desire?.summary || '', 180),
      tension: compactText(core?.mind?.branches?.fear?.summary || core?.mind?.branches?.wound?.summary || '', 180)
    },
    status: {
      notes: compactText(patch?.reason || 'Entity Core X patch proposal', 220)
    }
  });

  const Verifier = {
    investigate(core = {}, entity = {}, bundle = {}) {
      const relationFocus = deriveRelationFocus(core?.psyche?.relations || {});
      const worldSignals = getWorldSignalSnapshot(bundle?.context || {}, entity, core);
      const evidenceRefs = collectCanonicalEvidenceRefs(bundle, 8);
      const verificationSummary = buildVerificationEvidenceSummary(bundle);
      const responseText = normalizeText(bundle?.responseText || '');
      const activeText = responseText || normalizeText(bundle?.recentText || '');
      const responseMode = inferResponseMode(activeText);
      const currentGoal = compactText(core?.psyche?.dynamic?.currentGoal || core?.mind?.branches?.desire?.summary || '', 180);
      const goalAlignment = currentGoal ? tokenSimilarity(tokenize(activeText), tokenize(currentGoal)) : 0;
      const tabooHits = ensureArray(core?.profile?.taboos)
        .map(row => compactText(row || '', 120))
        .filter(Boolean)
        .filter(row => activeText.includes(row) || tokenSimilarity(tokenize(activeText), tokenize(row)) >= 0.18)
        .slice(0, 2);
      const continuityMatch = responseText
        ? findBestStatementMatch(core?.verification?.continuityLocks || [], responseText)
        : { statement: '', score: 0 };
      const contradictionSignals = [];
      if (tabooHits.length) contradictionSignals.push(`response touched taboo pressure: ${tabooHits.join(' | ')}`);
      if (responseText && currentGoal && goalAlignment < 0.08) contradictionSignals.push('response did not clearly reinforce the active goal');
      if (responseText && continuityMatch.statement && continuityMatch.score < 0.08) contradictionSignals.push('response did not visibly reinforce the strongest continuity lock');
      if (
        responseText
        && responseMode.confidence >= 0.56
        && responseMode.mode !== 'steady'
        && core?.psyche?.dynamic?.activeMode
        && responseMode.mode !== core.psyche.dynamic.activeMode
      ) {
        contradictionSignals.push(`response mode drifted toward ${responseMode.mode} from ${core.psyche.dynamic.activeMode}`);
      }
      const investigations = [
        normalizeInvestigation({
          key: 'continuity_lock',
          focus: 'continuity',
          question: 'What established continuity should remain fixed for this entity right now?',
          answer: compactText([
            core?.mind?.coreMind ? `core mind: ${core.mind.coreMind}` : '',
            ensureArray(bundle?.recall?.highlights || []).slice(0, 2).join(' | ')
          ].filter(Boolean).join(' | '), 360),
          verification: compactText([
            ensureArray(core?.verification?.continuityLocks || []).slice(0, 2).join(' | '),
            verificationSummary
          ].filter(Boolean).join(' || '), 320),
          result: compactText(core?.mind?.coreMind || ensureArray(bundle?.recall?.highlights || [])[0] || '', 220),
          confidence: evidenceRefs.length >= 2 ? 0.84 : 0.7,
          evidenceRefs,
          entityNames: [entity?.name].filter(Boolean),
          patchable: false
        }),
        normalizeInvestigation({
          key: 'motive_axis',
          focus: 'entity',
          question: 'What motive is most active after this turn?',
          answer: compactText(core?.psyche?.dynamic?.currentGoal || core?.mind?.branches?.desire?.summary || '', 320),
          suspicion: compactText(core?.mind?.branches?.fixation?.summary || core?.mind?.branches?.fear?.summary || '', 220),
          verification: verificationSummary,
          result: compactText(core?.psyche?.dynamic?.currentGoal || core?.mind?.branches?.desire?.summary || '', 220),
          confidence: core?.mind?.branches?.desire?.summary ? 0.82 : 0.62,
          patchConfidence: core?.psyche?.dynamic?.currentGoal ? 0.72 : 0.84,
          evidenceRefs,
          entityNames: [entity?.name].filter(Boolean),
          patchable: true
        }),
        normalizeInvestigation({
          key: 'relation_pressure',
          focus: relationFocus?.target ? 'relation' : 'entity',
          question: 'Who or what relational pressure is shaping the response style?',
          answer: compactText(relationFocus
            ? `${relationFocus.target} | trust ${Math.round(relationFocus.trust * 100)} | tension ${Math.round(relationFocus.tension * 100)}`
            : core?.mind?.branches?.bond?.summary || 'no dominant relation focus'
          , 320),
          verification: verificationSummary,
          result: compactText(relationFocus?.target || core?.mind?.branches?.bond?.summary || '', 220),
          confidence: relationFocus?.target ? 0.78 : 0.6,
          evidenceRefs,
          entityNames: [entity?.name].filter(Boolean),
          patchable: false
        }),
        normalizeInvestigation({
          key: 'contradiction_guard',
          focus: 'continuity',
          question: 'What continuity or motivation drift risk is visible in the current evidence?',
          answer: compactText(
            contradictionSignals.length
              ? contradictionSignals.join(' | ')
              : 'No strong contradiction signal is visible in the current evidence bundle.',
            320
          ),
          suspicion: compactText([
            tabooHits.length ? `taboo=${tabooHits.join(' | ')}` : '',
            responseText && currentGoal && goalAlignment < 0.08 ? `goalAlignment=${goalAlignment.toFixed(2)}` : '',
            responseText && continuityMatch.statement ? `lockMatch=${continuityMatch.score.toFixed(2)}` : ''
          ].filter(Boolean).join(' | '), 220),
          verification: verificationSummary,
          result: compactText(
            contradictionSignals[0] || 'No immediate contradiction guard escalation is required.',
            220
          ),
          confidence: contradictionSignals.length ? 0.78 : 0.62,
          patchConfidence: contradictionSignals.length ? 0.74 : 0,
          evidenceRefs,
          entityNames: [entity?.name].filter(Boolean),
          patchable: contradictionSignals.length > 0
        }),
        normalizeInvestigation({
          key: 'mask_integrity',
          focus: 'entity',
          question: 'How much is the current response filtered through the entity mask, and where might it leak?',
          answer: compactText([
            `mask=${Math.round(Number(core?.psyche?.dynamic?.maskStrength || 0.5) * 100)}`,
            core?.mind?.branches?.mask?.summary ? `mask branch: ${core.mind.branches.mask.summary}` : '',
            responseMode.markers.includes('confessional') ? 'response shows confessional leakage' : '',
            responseMode.markers.includes('guarded') ? 'response remains guarded' : ''
          ].filter(Boolean).join(' | '), 320),
          suspicion: compactText(
            Number(core?.psyche?.dynamic?.maskStrength || 0) >= 0.62 && responseMode.markers.includes('confessional')
              ? 'high mask strength but the response leaked vulnerable content'
              : 'mask integrity appears consistent with the current mode',
            220
          ),
          verification: verificationSummary,
          result: compactText(
            responseMode.markers.includes('confessional')
              ? 'A small reveal is available without fully breaking the mask.'
              : (core?.mind?.branches?.mask?.summary || 'Mask remains the current defensive layer.'),
            220
          ),
          confidence: 0.72,
          evidenceRefs,
          entityNames: [entity?.name].filter(Boolean),
          patchable: false
        }),
        normalizeInvestigation({
          key: 'scene_opportunity',
          focus: 'scene',
          question: 'What is the next high-value scene opportunity that stays continuity-safe?',
          answer: compactText([
            core?.mind?.branches?.desire?.summary ? `push desire: ${core.mind.branches.desire.summary}` : '',
            core?.mind?.branches?.bond?.summary ? `touch bond: ${core.mind.branches.bond.summary}` : '',
            core?.mind?.branches?.fixation?.summary ? `tighten fixation: ${core.mind.branches.fixation.summary}` : ''
          ].filter(Boolean).join(' | '), 320),
          result: compactText([
            core?.mind?.branches?.desire?.summary || '',
            core?.mind?.branches?.bond?.summary || ''
          ].filter(Boolean).join(' | '), 220),
          verification: verificationSummary,
          confidence: 0.7,
          evidenceRefs,
          entityNames: [entity?.name].filter(Boolean),
          patchable: false
        }),
        normalizeInvestigation({
          key: 'world_pressure',
          focus: 'world',
          question: 'What world, scene, or storyline pressure must the entity stay aligned with right now?',
          answer: compactText([
            worldSignals.scenePressures[0] ? `scene=${worldSignals.scenePressures[0]}` : '',
            worldSignals.storylineCarryoverSignals[0] ? `carryover=${worldSignals.storylineCarryoverSignals[0]}` : '',
            worldSignals.relationStateSignals[0] ? `relation=${worldSignals.relationStateSignals[0]}` : '',
            worldSignals.worldLimits[0] ? `limit=${worldSignals.worldLimits[0]}` : ''
          ].filter(Boolean).join(' | '), 320),
          verification: verificationSummary,
          result: compactText(
            worldSignals.summary || 'No strong external world pressure is currently attached to the entity context.',
            220
          ),
          confidence: worldSignals.summary ? 0.76 : 0.58,
          evidenceRefs,
          entityNames: [entity?.name].filter(Boolean),
          patchable: worldSignals.scenePressures.length > 0 || worldSignals.storylineCarryoverSignals.length > 0
        })
      ];

      const continuityLocks = uniqueTexts([
        ...ensureArray(core?.verification?.continuityLocks || []),
        core?.mind?.coreMind ? `Core mind remains: ${core.mind.coreMind}` : '',
        ensureArray(core?.profile?.taboos || []).length ? `Taboo pressure: ${core.profile.taboos[0]}` : '',
        relationFocus?.target ? `${relationFocus.target} relation remains active (trust ${Math.round(relationFocus.trust * 100)} / tension ${Math.round(relationFocus.tension * 100)})` : '',
        ensureArray(bundle?.recall?.highlights || []).length ? `Recall anchor: ${bundle.recall.highlights[0]}` : '',
        worldSignals.scenePressures[0] ? `Scene pressure remains: ${compactText(worldSignals.scenePressures[0], 140)}` : '',
        worldSignals.worldLimits[0] ? `World limit remains: ${compactText(worldSignals.worldLimits[0], 140)}` : ''
      ], 8).filter(Boolean);

      const predictions = uniqueTexts([
        core?.mind?.branches?.desire?.summary ? `Likely to pursue: ${compactText(core.mind.branches.desire.summary, 120)}` : '',
        core?.psyche?.dynamic?.activeMode ? `Behavior mode may stay ${core.psyche.dynamic.activeMode}` : '',
        relationFocus?.target && relationFocus.tension >= 0.5 ? `Pressure around ${relationFocus.target} may sharpen the next exchange.` : '',
        core?.mind?.branches?.fixation?.summary ? 'Fixation could narrow attention unless interrupted.' : '',
        responseMode.mode !== 'steady' ? `Response texture is leaning ${responseMode.mode}.` : '',
        worldSignals.storylineCarryoverSignals[0] ? `Carryover pressure may surface: ${compactText(worldSignals.storylineCarryoverSignals[0], 120)}` : ''
      ], 8);

      const opportunities = uniqueTexts([
        core?.mind?.branches?.bond?.summary ? `Use bond cue: ${compactText(core.mind.branches.bond.summary, 120)}` : '',
        core?.mind?.branches?.mask?.summary ? `Expose or crack the mask through a small reveal.` : '',
        core?.mind?.branches?.wound?.summary ? `Echo the wound indirectly instead of stating it outright.` : '',
        ensureArray(bundle?.recall?.highlights || []).length ? `Reconnect to recall: ${bundle.recall.highlights[0]}` : '',
        contradictionSignals.length ? `Repair drift pressure: ${compactText(contradictionSignals[0], 100)}` : '',
        worldSignals.scenePressures[0] ? `Answer scene pressure: ${compactText(worldSignals.scenePressures[0], 120)}` : ''
      ], 8);

      const patchQueue = [
        !core?.psyche?.dynamic?.currentGoal && core?.mind?.branches?.desire?.summary
          ? normalizePatchItem({
            type: 'goal-alignment',
            targetPath: 'psyche.dynamic.currentGoal',
            op: 'set',
            value: compactText(core.mind.branches.desire.summary, 160),
            confidence: 0.88,
            safe: true,
            reason: 'Current goal is missing while desire evidence is strong.',
            evidenceRefs,
            sourceInvestigation: 'motive_axis'
          })
          : null,
        !core?.mind?.selfNarrative && core?.mind?.coreMind
          ? normalizePatchItem({
            type: 'self-narrative',
            targetPath: 'mind.selfNarrative',
            op: 'set',
            value: deriveSelfNarrative(core),
            confidence: 0.9,
            safe: true,
            reason: 'Self narrative can be compressed from established core mind and branch state.',
            evidenceRefs,
            sourceInvestigation: 'continuity_lock'
          })
          : null,
        !core?.mind?.valueFrame && (ensureArray(core?.profile?.values).length || core?.mind?.coreMind)
          ? normalizePatchItem({
            type: 'value-frame',
            targetPath: 'mind.valueFrame',
            op: 'set',
            value: deriveValueFrame(core),
            confidence: 0.84,
            safe: true,
            reason: 'Value frame can be compressed from profile values and current core mind.',
            evidenceRefs,
            sourceInvestigation: 'continuity_lock'
          })
          : null,
        extractBodySignature(activeText).length
          ? normalizePatchItem({
            type: 'body-signature',
            targetPath: 'mind.bodySignature',
            op: 'appendUnique',
            value: extractBodySignature(activeText).slice(0, 4),
            confidence: 0.86,
            safe: true,
            reason: 'Body signature cues were detected in current evidence.',
            evidenceRefs,
            sourceInvestigation: 'mask_integrity'
          })
          : null,
        ensureArray(core?.verification?.continuityLocks || []).length === 0 && continuityLocks.length
          ? normalizePatchItem({
            type: 'continuity-lock',
            targetPath: 'verification.continuityLocks',
            op: 'appendUnique',
            value: continuityLocks.slice(0, 2),
            confidence: 0.92,
            safe: true,
            reason: 'Continuity locks are empty despite strong recall and psyche evidence.',
            evidenceRefs,
            sourceInvestigation: 'continuity_lock'
          })
          : null,
        contradictionSignals.length > 0 && responseMode.confidence >= 0.56 && responseMode.mode !== 'steady'
          ? normalizePatchItem({
            type: 'mode-realignment',
            targetPath: 'psyche.dynamic.activeMode',
            op: 'set',
            value: responseMode.mode,
            confidence: 0.78,
            safe: false,
            reason: compactText(`Recent response evidence suggests active mode drift toward ${responseMode.mode}.`, 220),
            evidenceRefs,
            sourceInvestigation: 'contradiction_guard'
          })
          : null,
        worldSignals.scenePressures[0] && ensureArray(core?.development?.immediateGoals || []).length === 0
          ? normalizePatchItem({
            type: 'scene-pressure-goal',
            targetPath: 'development.immediateGoals',
            op: 'appendUnique',
            value: [`Answer scene pressure: ${compactText(worldSignals.scenePressures[0], 140)}`],
            confidence: 0.83,
            safe: true,
            reason: 'External scene pressure exists but immediate goals are under-specified.',
            evidenceRefs,
            sourceInvestigation: 'world_pressure'
          })
          : null
      ].filter(Boolean);

      return {
        investigations,
        continuityLocks,
        predictions,
        opportunities,
        patchQueue
      };
    },
    compareAgainstResponse(core = {}, entity = {}, options = {}) {
      const responseText = normalizeText(options?.responseText || options?.assistantText || '');
      if (!responseText) {
        return {
          investigations: [],
          continuityLocks: [],
          predictions: [],
          opportunities: [],
          patchQueue: []
        };
      }
      const relationFocus = deriveRelationFocus(core?.psyche?.relations || {});
      const worldSignals = getWorldSignalSnapshot(options?.context || {}, entity, core);
      const bundle = {
        ...options,
        responseText,
        recentText: normalizeText(options?.recentText || responseText)
      };
      const evidenceRefs = collectCanonicalEvidenceRefs(bundle, 8);
      const verificationSummary = buildVerificationEvidenceSummary(bundle);
      const predictionMatch = findBestStatementMatch(core?.verification?.predictions || [], responseText);
      const lockMatch = findBestStatementMatch(core?.verification?.continuityLocks || [], responseText);
      const currentGoal = compactText(core?.psyche?.dynamic?.currentGoal || core?.mind?.branches?.desire?.summary || '', 180);
      const goalMatch = currentGoal ? tokenSimilarity(tokenize(responseText), tokenize(currentGoal)) : 0;
      const responseMode = inferResponseMode(responseText);
      const tabooHits = ensureArray(core?.profile?.taboos)
        .map(row => compactText(row || '', 120))
        .filter(Boolean)
        .filter(row => responseText.includes(row) || tokenSimilarity(tokenize(responseText), tokenize(row)) >= 0.18)
        .slice(0, 2);
      const driftSignals = [];
      if (ensureArray(core?.verification?.predictions).length && predictionMatch.score < 0.08) {
        driftSignals.push('actual response did not clearly express the active prediction');
      }
      if (ensureArray(core?.verification?.continuityLocks).length && lockMatch.score < 0.08) {
        driftSignals.push('actual response did not clearly reinforce the active continuity lock');
      }
      if (currentGoal && goalMatch < 0.08) {
        driftSignals.push('actual response drifted away from the current goal signal');
      }
      if (
        responseMode.confidence >= 0.56
        && responseMode.mode !== 'steady'
        && core?.psyche?.dynamic?.activeMode
        && responseMode.mode !== core.psyche.dynamic.activeMode
      ) {
        driftSignals.push(`actual response moved toward ${responseMode.mode} instead of ${core.psyche.dynamic.activeMode}`);
      }
      if (tabooHits.length) driftSignals.push(`actual response brushed taboo pressure: ${tabooHits.join(' | ')}`);
      if (worldSignals.scenePressures[0] && tokenSimilarity(tokenize(responseText), tokenize(worldSignals.scenePressures[0])) < 0.06) {
        driftSignals.push('actual response did not visibly answer the active scene pressure');
      }

      const investigations = [
        normalizeInvestigation({
          key: 'response_alignment',
          focus: 'response',
          question: 'How well did the actual assistant response stay aligned with the prepared entity state?',
          answer: compactText([
            predictionMatch.statement ? `predictionHit=${predictionMatch.statement}` : 'predictionHit=none',
            lockMatch.statement ? `lockHit=${lockMatch.statement}` : 'lockHit=none',
            currentGoal ? `goalMatch=${goalMatch.toFixed(2)}` : '',
            `responseMode=${responseMode.mode}`
          ].filter(Boolean).join(' | '), 320),
          suspicion: compactText(driftSignals.join(' | ') || 'no major post-response drift detected', 320),
          verification: verificationSummary,
          result: compactText(
            driftSignals[0]
              ? `Drift watch: ${driftSignals[0]}`
              : `Response stayed broadly aligned with ${core?.psyche?.dynamic?.activeMode || 'steady'} mode.`,
            220
          ),
          confidence: driftSignals.length ? 0.8 : 0.72,
          patchConfidence: driftSignals.length ? 0.76 : 0,
          evidenceRefs,
          entityNames: [entity?.name].filter(Boolean),
          patchable: driftSignals.length > 0
        })
      ];

      const continuityLocks = uniqueTexts([
        driftSignals.length ? `Response drift watch: ${compactText(driftSignals[0], 160)}` : '',
        tabooHits.length ? `Keep taboo pressure explicit: ${tabooHits[0]}` : ''
      ], 4);

      const predictions = uniqueTexts([
        responseMode.mode !== 'steady' ? `Next response may continue in ${responseMode.mode} mode unless repaired.` : '',
        relationFocus?.target ? `Next exchange may orbit ${relationFocus.target}.` : ''
      ], 4);

      const opportunities = uniqueTexts([
        driftSignals.length && relationFocus?.target ? `Re-anchor the next reply around ${relationFocus.target} to repair continuity.` : '',
        responseMode.markers.includes('confessional') ? 'There is an opening for a deeper reveal next turn.' : '',
        predictionMatch.statement ? `Reinforce the missed prediction axis: ${compactText(predictionMatch.statement, 100)}` : '',
        worldSignals.scenePressures[0] ? `Next reply can explicitly answer scene pressure: ${compactText(worldSignals.scenePressures[0], 120)}` : ''
      ], 4);

      const patchQueue = [
        driftSignals.length > 0 && responseMode.confidence >= 0.56 && responseMode.mode !== 'steady'
          ? normalizePatchItem({
            type: 'post-response-mode-drift',
            targetPath: 'psyche.dynamic.activeMode',
            op: 'set',
            value: responseMode.mode,
            confidence: 0.79,
            safe: false,
            reason: compactText(`Post-response comparison suggests mode drift toward ${responseMode.mode}.`, 220),
            evidenceRefs,
            sourceInvestigation: 'response_alignment'
          })
          : null,
        driftSignals.length > 0 && currentGoal
          ? normalizePatchItem({
            type: 'goal-lock-reinforcement',
            targetPath: 'verification.continuityLocks',
            op: 'appendUnique',
            value: [`Current goal remains: ${currentGoal}`],
            confidence: 0.84,
            safe: true,
            reason: 'Response drift suggests the goal should be re-locked explicitly.',
            evidenceRefs,
            sourceInvestigation: 'response_alignment'
          })
          : null
      ].filter(Boolean);

      return {
        investigations,
        continuityLocks,
        predictions,
        opportunities,
        patchQueue
      };
    },
    evaluatePatch(core = {}, patch = {}, options = {}) {
      const settings = getSettings();
      const normalized = normalizePatchItem(patch);
      const currentValue = getPathValue(core, normalized.targetPath);
      const hasCurrent = Array.isArray(currentValue)
        ? currentValue.length > 0
        : (currentValue != null && normalizeText(currentValue) !== '');
      const sameValue = JSON.stringify(cloneValue(currentValue, null)) === JSON.stringify(cloneValue(normalized.value, null));
      if (sameValue) {
        return { apply: false, reason: 'already-equal' };
      }
      if (normalized.confidence < Number(options?.autoApplyThreshold || settings.patchAutoApplyThreshold)) {
        return { apply: false, reason: 'below-threshold' };
      }
      if (hasCurrent && normalized.op === 'set' && normalized.confidence < Number(options?.overwriteThreshold || settings.patchOverwriteThreshold)) {
        return { apply: false, reason: 'existing-value-conflict' };
      }
      if (normalized.safe === false && options?.allowUnsafe !== true) {
        return { apply: false, reason: 'unsafe-patch' };
      }
      return { apply: true, reason: 'threshold-pass' };
    },
    applyPatch(core = {}, patch = {}) {
      const normalized = normalizePatchItem(patch);
      setPathValue(core, normalized.targetPath, normalized.value, normalized.op);
      normalized.status = 'applied';
      normalized.updatedAt = Date.now();
      return normalized;
    }
  };

  const buildUnifiedPromptSection = (rows = []) => {
    if (!rows.length) return null;
    const settings = getSettings();
    const header = ['[Entity Core X]', 'Use this as the single continuity bundle for entity memory, mind, psyche, and verification.'];
    const body = [];
    let used = header.join('\n').length + 2;
    rows.forEach((row) => {
      const lines = [
        { text: `Name: ${row.name}`, optional: false },
        { text: row.coreMind ? `Core Mind: ${row.coreMind}` : '', optional: false },
        { text: row.branches ? `Desire/Fear/Wound/Mask/Bond/Fixation: ${row.branches}` : '', optional: false },
        { text: row.psyche ? `Current Psyche: ${row.psyche}` : '', optional: false },
        { text: row.goals ? `Goal Layers: ${row.goals}` : '', optional: false },
        { text: row.world ? `World Pressure: ${row.world}` : '', optional: false },
        { text: row.continuity ? `Continuity Digest: ${row.continuity}` : '', optional: false },
        { text: row.voice ? `Voice Signature: ${row.voice}` : '', optional: true },
        { text: row.body ? `Active Body Signal: ${row.body}` : '', optional: true },
        { text: row.selfModel ? `Self Narrative: ${row.selfModel}` : '', optional: true },
        { text: row.persona ? `Current Persona Mode: ${row.persona}` : '', optional: true },
        { text: row.nsfw ? `NSFW State: ${row.nsfw}` : '', optional: true },
        { text: row.relation ? `Relation Focus: ${row.relation}` : '', optional: true },
        { text: row.recall ? `Recall Highlights: ${row.recall}` : '', optional: true },
        { text: row.locks ? `Continuity Locks: ${row.locks}` : '', optional: true },
        { text: row.hints ? `Verification Hints: ${row.hints}` : '', optional: true }
      ].filter(item => item.text);
      if (!lines.length) return;
      let chosen = lines.slice();
      let block = chosen.map(item => item.text).join('\n');
      while ((used + block.length + 2) > settings.promptBudget) {
        const dropIndex = chosen.map((item, index) => ({ ...item, index })).reverse().find(item => item.optional)?.index;
        if (dropIndex == null) break;
        chosen.splice(dropIndex, 1);
        block = chosen.map(item => item.text).join('\n');
      }
      if (!block || (used + block.length + 2) > settings.promptBudget) return;
      body.push(block);
      used += block.length + 2;
    });
    if (!body.length) return null;
    return {
      key: `${PLUGIN_ID}:prompt`,
      priority: 'required',
      mustInclude: true,
      relevance: 0.96,
      weightBoost: 0.28,
      label: 'entityCoreX',
      text: [...header, ...body].join('\n\n')
    };
  };

  const buildPromptRowForEntity = (entity = {}, core = {}, recall = {}, context = {}) => {
    const relationFocus = deriveRelationFocus(core?.psyche?.relations || {});
    const world = summarizeWorldPressure(context, entity, core);
    return {
      name: normalizeName(entity?.name || core?.identity?.name || 'Unknown'),
      coreMind: compactText(core?.mind?.coreMind || '', 160),
      branches: BRANCH_ORDER.map((branchKey) => {
        const value = core?.mind?.branches?.[branchKey]?.summary || core?.mind?.branches?.[branchKey]?.nodes?.[0]?.text || '';
        if (!value) return '';
        return `${BRANCH_REGISTRY[branchKey].promptLabel}=${compactText(value, 60)}`;
      }).filter(Boolean).join(' | '),
      psyche: compactText([
        `activeMode=${core?.psyche?.dynamic?.activeMode || 'steady'}`,
        core?.psyche?.dynamic?.currentGoal ? `goal=${compactText(core.psyche.dynamic.currentGoal, 80)}` : '',
        entity?.status?.currentMood ? `mood=${compactText(entity.status.currentMood, 50)}` : '',
        `trust=${Math.round(Number(core?.psyche?.dynamic?.trust || 0.5) * 100)}`,
        `pressure=${Math.round(Number(core?.psyche?.dynamic?.emotionalPressure || 0.15) * 100)}`,
        `mask=${Math.round(Number(core?.psyche?.dynamic?.maskStrength || 0.5) * 100)}`
      ].filter(Boolean).join(', '), 220),
      voice: compactText([
        `len=${core?.expression?.voiceSignature?.sentenceLength || 'medium'}`,
        `direct=${Math.round(Number(core?.expression?.voiceSignature?.directnessBase || 0.5) * 100)}`,
        `formal=${Math.round(Number(core?.expression?.voiceSignature?.formalityBase || 0.5) * 100)}`,
        core?.expression?.lexicalHabits?.addressingStyle?.[0] ? `address=${core.expression.lexicalHabits.addressingStyle[0]}` : '',
        core?.expression?.lexicalHabits?.recurringPhrases?.[0] ? `phrase=${compactText(core.expression.lexicalHabits.recurringPhrases[0], 50)}` : ''
      ].filter(Boolean).join(', '), 220),
      body: compactText([
        core?.embodiment?.bodySignature?.tensionSignal || '',
        core?.embodiment?.bodySignature?.comfortSignal || '',
        core?.embodiment?.bodySignature?.movementTempo ? `tempo=${core.embodiment.bodySignature.movementTempo}` : ''
      ].filter(Boolean).join(' | '), 220),
      selfModel: compactText(core?.selfModel?.selfNarrative || core?.selfModel?.selfImage || '', 180),
      persona: pickCurrentPersonaModeSummary(core, context),
      goals: summarizeDevelopmentGoals(core),
      world,
      continuity: summarizeContinuityCarryover(core),
      nsfw: summarizeNsfwState(core),
      relation: relationFocus
        ? compactText([
          relationFocus.target,
          relationFocus.type ? `${relationFocus.type}${relationFocus.stage ? `/${relationFocus.stage}` : ''}` : '',
          `trust ${Math.round(relationFocus.trust * 100)}`,
          `affection ${Math.round((relationFocus.affection || relationFocus.attachment || 0.5) * 100)}`,
          `tension ${Math.round(relationFocus.tension * 100)}`
        ].filter(Boolean).join(' | '), 180)
        : '',
      recall: ensureArray(recall?.highlights || []).slice(0, getSettings().promptRecallHighlights).join(' | '),
      locks: ensureArray(core?.verification?.continuityLocks || []).slice(0, getSettings().promptContinuityLocks).join(' | '),
      hints: compactText([
        compactText(core?.psyche?.emotionBridge?.summary || '', 120),
        ensureArray(core?.verification?.predictions || [])[0] || '',
        ensureArray(core?.verification?.opportunities || [])[0] || ''
      ].filter(Boolean).join(' | '), 220)
    };
  };

  const buildArchiveItemFromVerification = (entity = {}, core = {}, verification = {}, turn = 0, promptBundle = null) => {
    const patchCandidates = ensureArray(verification?.patchQueue || []).map(normalizePatchItem).slice(0, 4);
    return {
      id: `corex:${simpleHash(`${entity?.name || ''}|${turn}|${verification?.continuityLocks?.join('|') || ''}`)}`,
      turn: Math.max(0, Number(turn || 0)),
      createdAt: Date.now(),
      promptMode: 'entity-core-x',
      userInput: '',
      summary: compactText(core?.continuity?.currentSummary || core?.mind?.coreMind || core?.mind?.selfNarrative || '', 320),
      locks: uniqueTexts(verification?.continuityLocks || [], 8),
      predictions: uniqueTexts(verification?.predictions || [], 8),
      opportunities: uniqueTexts(verification?.opportunities || [], 8),
      investigations: ensureArray(verification?.recentInvestigations || []).map(normalizeInvestigation),
      patchCandidates: patchCandidates.map((patch) => ({
        id: patch.id,
        targetPath: patch.targetPath,
        op: patch.op,
        confidence: patch.confidence,
        reason: patch.reason,
        evidenceRefs: ensureArray(patch.evidenceRefs || []).slice(0, 5),
        source: normalizeText(patch.sourceInvestigation || '')
      })),
      promptPreview: compactText(promptBundle?.text || '', 320)
    };
  };

  const buildVerificationArchiveProjection = async (context = {}, options = {}) => {
    const scopeId = normalizeText(options?.scopeId || resolveScopeId(context)) || 'global';
    const rows = [];
    if (options?.entity && typeof options.entity === 'object') {
      const entity = options.entity;
      const core = await prepareEntityCore(entity, context, { scopeId });
      rows.push(buildArchiveItemFromVerification(
        entity,
        core,
        core?.verification || {},
        Math.max(0, Number(context?.turn || 0)),
        scopeRuntime.get(scopeId)?.promptSection || null
      ));
    } else {
      const entityCache = getEntityCache(context);
      entityCache.forEach((entity) => {
        if (!entity || typeof entity !== 'object') return;
        const core = normalizeEntityCoreX(entity, entity?.entityCoreX || {});
        rows.push(buildArchiveItemFromVerification(
          entity,
          core,
          core?.verification || {},
          Math.max(0, Number(context?.turn || 0)),
          scopeRuntime.get(scopeId)?.promptSection || null
        ));
      });
    }

    const synthesized = rows
      .filter(Boolean)
      .sort((left, right) => Number(right?.createdAt || 0) - Number(left?.createdAt || 0))
      .slice(0, getSettings().verifierHistoryLimit);

    if (synthesized.length > 0) return synthesized;
    return cloneValue(await loadLegacyVerifierArchive(scopeId), []);
  };

  const syncChangedEntitiesToLorebook = async (context = {}, changedNames = []) => {
    const targetNames = new Set(ensureArray(changedNames).map(name => normalizeName(name)).filter(Boolean));
    if (!targetNames.size) return 0;
    const entityCache = getEntityCache(context);
    if (!(entityCache instanceof Map)) return 0;
    const memoryEngine = context?.MemoryEngine || getMemoryEngine();
    const activeChar = context?.char || null;
    const activeChat = context?.chat || null;
    const baseLore = Array.isArray(context?.lore)
      ? context.lore
      : memoryEngine?.getLorebook?.(activeChar, activeChat);
    if (!Array.isArray(baseLore) || typeof memoryEngine?.setLorebook !== 'function' || !activeChar || !activeChat) {
      return 0;
    }
    let changed = 0;
    const nextLore = baseLore.map((entry) => {
      if (!entry || entry.comment !== 'lmai_entity') return entry;
      const content = safeJsonParse(typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content || {}), null);
      if (!content || typeof content !== 'object') return entry;
      const name = normalizeName(content?.name || '');
      if (!targetNames.has(name)) return entry;
      const cacheEntity = entityCache.get(name);
      if (!cacheEntity) return entry;
      refreshCompatibilityProjection(cacheEntity);
      changed += 1;
      return {
        ...entry,
        content: JSON.stringify(cacheEntity)
      };
    });
    if (changed > 0) {
      memoryEngine.setLorebook(activeChar, activeChat, nextLore);
      context?.EntityManager?.rebuildCache?.(nextLore);
    }
    return changed;
  };

  const renderEntityCoreCreateSection = () => ({
    key: `${PLUGIN_ID}:create`,
    name: 'Entity Core X',
    order: 55,
    html: `
      <div class="scope-section-card" style="margin-top:8px">
        <div class="insp-section-title">Entity Core X</div>
        <div class="scope-section-note" style="margin-top:6px">
          This entity will be normalized into <strong>entity.entityCoreX</strong> on save and used as the single integrated runtime core.
        </div>
        <div class="scope-section-note" style="margin-top:6px">
          Canonical long-term memory remains DMA direct/previous memory. Recall, mind, psyche, and verification derive from that layer.
        </div>
      </div>
    `
  });

  const renderEntityCorePillRow = (items = [], options = {}) => {
    const html = ensureArray(items)
      .filter(Boolean)
      .map(item => `<span class="scope-inline-pill" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:999px;border:1px solid rgba(148,163,184,0.24);background:rgba(255,255,255,0.06);font-size:12px;line-height:1.2;white-space:nowrap">${escHtml(item)}</span>`)
      .join('');
    if (!html) return '';
    return `<div class="scope-inline-list" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:${Math.max(0, Number(options.marginTop || 8))}px">${html}</div>`;
  };

  const humanizeEntityCoreLabel = (value = '') => {
    const source = String(value || '').trim();
    if (!source) return '';
    const normalized = source
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const lower = normalized.toLowerCase();
    const special = {
      activemode: 'Active Mode',
      currentgoal: 'Current Goal',
      direct: 'Directness',
      formal: 'Formality',
      len: 'Length',
      dma: 'DMA',
      nsfw: 'NSFW'
    };
    if (special[lower.replace(/\s+/g, '')]) return special[lower.replace(/\s+/g, '')];
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  };

  const splitEntityCoreSummaryText = (text = '', options = {}) => {
    const source = compactText(String(text || '').replace(/\s+/g, ' ').trim(), Number(options.maxLength || 360), '');
    if (!source) return [];
    const separator = options.separator || 'pipe';
    const regex = separator === 'comma'
      ? /\s*,\s*/
      : (separator instanceof RegExp ? separator : /\s*\|\s*/);
    return source.split(regex).map(item => compactText(item || '', Number(options.itemLength || 180), '')).filter(Boolean);
  };

  const renderEntityCoreMetricGrid = (items = [], options = {}) => {
    const cells = ensureArray(items)
      .filter(item => item && `${item.value ?? ''}`.trim() !== '')
      .map((item) => `
        <div style="padding:8px 10px;border-radius:10px;border:1px solid rgba(148,163,184,0.22);background:rgba(15,23,42,0.06)">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.02em;text-transform:uppercase;opacity:0.7">${escHtml(humanizeEntityCoreLabel(item.label || 'Metric'))}</div>
          <div style="margin-top:4px;font-size:13px;font-weight:700;line-height:1.35">${escHtml(String(item.value || '').trim())}</div>
        </div>
      `)
      .join('');
    if (!cells) return '';
    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(${Math.max(120, Number(options.minWidth || 120))}px,1fr));gap:8px;margin-top:${Math.max(0, Number(options.marginTop || 8))}px">
        ${cells}
      </div>
    `;
  };

  const renderEntityCoreListSection = (title = '', text = '', options = {}) => {
    const items = Array.isArray(text) ? text.filter(Boolean) : splitEntityCoreSummaryText(text, options);
    if (!items.length) return '';
    const rows = items
      .map(item => `<div style="padding:6px 8px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(148,163,184,0.14);line-height:1.45">${escHtml(item)}</div>`)
      .join('');
    return `
      <div style="margin-top:${Math.max(0, Number(options.marginTop || 8))}px">
        <div style="font-size:12px;font-weight:800;letter-spacing:0.02em;text-transform:uppercase;opacity:0.82">${escHtml(title)}</div>
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">${rows}</div>
      </div>
    `;
  };

  const renderEntityCoreSectionPanel = (title = '', innerHtml = '', options = {}) => {
    if (!String(innerHtml || '').trim()) return '';
    return `
      <div style="margin-top:${Math.max(0, Number(options.marginTop || 8))}px;padding:10px 12px;border-radius:12px;border:1px solid rgba(148,163,184,0.2);background:${options.background || 'rgba(15,23,42,0.05)'}">
        <div style="font-size:12px;font-weight:800;letter-spacing:0.02em;text-transform:uppercase;opacity:0.82">${escHtml(title)}</div>
        ${innerHtml}
      </div>
    `;
  };

  const renderEntityCoreMindMap = (core = {}) => {
    const branchRows = BRANCH_ORDER.map((branchKey) => {
      const branch = core?.mind?.branches?.[branchKey] || {};
      const summary = compactText(branch?.summary || branch?.nodes?.[0]?.text || '', 72);
      const label = BRANCH_REGISTRY[branchKey]?.promptLabel || branchKey;
      const hasValue = !!summary;
      return `
        <div style="min-height:66px;padding:10px;border-radius:13px;border:1px solid ${hasValue ? 'rgba(15,118,110,0.28)' : 'rgba(148,163,184,0.20)'};background:${hasValue ? 'linear-gradient(180deg,#f0fdfa,#ecfeff)' : 'rgba(248,250,252,0.88)'}">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <div style="font-size:11px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:${hasValue ? '#0f766e' : '#64748b'}">${escHtml(label)}</div>
            <div style="width:8px;height:8px;border-radius:999px;background:${hasValue ? '#0f766e' : '#cbd5e1'}"></div>
          </div>
          <div style="margin-top:7px;font-size:12px;line-height:1.45;color:#334155">${escHtml(summary || '관찰 대기')}</div>
        </div>
      `;
    }).join('');
    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px;margin-top:8px">
        ${branchRows}
      </div>
    `;
  };

  const renderEntityCorePressureBars = (core = {}) => {
    const dynamic = core?.psyche?.dynamic || {};
    const rows = [
      ['trust', Number(dynamic.trust ?? 0.5), '#2563eb'],
      ['pressure', Number(dynamic.emotionalPressure ?? 0.15), '#dc2626'],
      ['mask', Number(dynamic.maskStrength ?? 0.5), '#7c3aed'],
      ['stability', 1 - Number(dynamic.emotionalPressure ?? 0.15), '#0f766e']
    ];
    return rows.map(([label, rawValue, color]) => {
      const value = clampNumber(rawValue, 0, 0, 1);
      return `
        <div style="margin-top:8px">
          <div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;font-weight:800;color:#475569">
            <span>${escHtml(humanizeEntityCoreLabel(label))}</span><span>${Math.round(value * 100)}%</span>
          </div>
          <div style="height:8px;border-radius:999px;background:#e2e8f0;overflow:hidden;margin-top:5px">
            <div style="height:100%;width:${Math.round(value * 100)}%;border-radius:999px;background:${color}"></div>
          </div>
        </div>
      `;
    }).join('');
  };

  const buildEntityCoreDisplaySnapshot = (context = {}, entity = {}, core = {}, recall = null) => {
    const row = buildPromptRowForEntity(entity, core, recall || {}, context);
    const relationFocus = deriveRelationFocus(core?.psyche?.relationships || core?.psyche?.relations || {});
    const historyText = ensureArray(core?.continuity?.recentHistory || [])
      .slice(-2)
      .map(item => item.text)
      .filter(Boolean)
      .join(' | ');
    const recallCount = Object.keys(core?.memory?.recallGraph?.nodes || {}).length;
    const dmaCount = ensureArray(core?.memory?.dmaRefs?.direct || []).length + ensureArray(core?.memory?.dmaRefs?.previous || []).length;
    const lockCount = ensureArray(core?.verification?.continuityLocks || []).length;
    const pendingPatchCount = ensureArray(core?.verification?.patchQueue || [])
      .map(normalizePatchItem)
      .filter(item => item.status !== 'applied' && item.status !== 'rejected')
      .length;
    const promptPsycheMetrics = [
      { label: 'activeMode', value: core?.psyche?.dynamic?.activeMode || 'steady' },
      { label: 'mood', value: compactText(entity?.status?.currentMood || '', 50) },
      { label: 'trust', value: `${Math.round(Number(core?.psyche?.dynamic?.trust || 0.5) * 100)}%` },
      { label: 'pressure', value: `${Math.round(Number(core?.psyche?.dynamic?.emotionalPressure || 0.15) * 100)}%` },
      { label: 'mask', value: `${Math.round(Number(core?.psyche?.dynamic?.maskStrength || 0.5) * 100)}%` }
    ].filter(item => item.value);
    const voiceMetrics = [
      { label: 'length', value: core?.expression?.voiceSignature?.sentenceLength || 'medium' },
      { label: 'directness', value: `${Math.round(Number(core?.expression?.voiceSignature?.directnessBase || 0.5) * 100)}%` },
      { label: 'formality', value: `${Math.round(Number(core?.expression?.voiceSignature?.formalityBase || 0.5) * 100)}%` },
      { label: 'address', value: ensureArray(core?.expression?.lexicalHabits?.addressingStyle || [])[0] || '' }
    ].filter(item => item.value);
    const diagnosticMetrics = [
      { label: 'DMA refs', value: String(dmaCount) },
      { label: 'Recall nodes', value: String(recallCount) },
      { label: 'Locks', value: String(lockCount) },
      { label: 'Pending patches', value: pendingPatchCount ? String(pendingPatchCount) : '' },
      { label: 'Relation type', value: relationFocus?.type || '' },
      { label: 'Relation stage', value: relationFocus?.stage || '' }
    ].filter(item => item.value);
    const relationMetrics = relationFocus ? [
      { label: 'target', value: relationFocus.target },
      { label: 'trust', value: `${Math.round(Number(relationFocus.trust || 0) * 100)}%` },
      { label: 'affection', value: `${Math.round(Number((relationFocus.affection ?? relationFocus.attachment) || 0) * 100)}%` },
      { label: 'tension', value: `${Math.round(Number(relationFocus.tension || 0) * 100)}%` },
      { label: 'dynamic', value: relationFocus.primaryDynamic || '' }
    ].filter(item => item.value) : [];
    return {
      row,
      relationFocus,
      historyText,
      recallCount,
      dmaCount,
      lockCount,
      pendingPatchCount,
      branchText: BRANCH_ORDER.map((branchKey) => {
        const value = core?.mind?.branches?.[branchKey]?.summary || core?.mind?.branches?.[branchKey]?.nodes?.[0]?.text || '';
        if (!value) return '';
        return `${BRANCH_REGISTRY[branchKey].promptLabel}: ${compactText(value, 48)}`;
      }).filter(Boolean).join(' | '),
      topLockText: ensureArray(core?.verification?.continuityLocks || []).slice(0, 2).join(' | '),
      nsfwText: summarizeNsfwState(core),
      continuityText: summarizeContinuityCarryover(core),
      worldText: summarizeWorldPressure(context, entity, core),
      modeText: core?.psyche?.dynamic?.activeMode || 'steady',
      goalText: compactText(core?.psyche?.dynamic?.currentGoal || '', 90),
      emotionText: compactText(core?.psyche?.emotionBridge?.summary || '', 140),
      voiceText: row.voice,
      bodyText: row.body,
      selfText: row.selfModel,
      personaText: row.persona,
      goalsText: row.goals,
      relationText: row.relation,
      recallText: row.recall,
      hintsText: row.hints,
      promptPsycheMetrics,
      voiceMetrics,
      diagnosticMetrics,
      relationMetrics
    };
  };

  const renderEntityCoreCardSection = (context = {}) => {
    const entity = context?.entity && typeof context.entity === 'object' ? context.entity : {};
    const idx = Number.isFinite(Number(context?.entityIndex)) ? Number(context.entityIndex) : -1;
    const core = syncHydrateEntityCore(cloneValue(entity, {}));
    const snapshot = buildEntityCoreDisplaySnapshot(context, entity, core);
    const summaryLabel = [
      entity?.name || core?.identity?.name || 'Entity',
      snapshot.modeText,
      snapshot.goalText || snapshot.row.coreMind || 'continuity snapshot'
    ].filter(Boolean).join(' · ');
    const heroPills = renderEntityCorePillRow([
      `mode ${snapshot.modeText}`,
      snapshot.goalText ? `goal ${snapshot.goalText}` : '',
      snapshot.relationFocus?.target ? `relation ${snapshot.relationFocus.target}` : '',
      snapshot.worldText ? `world linked` : '',
      `recall ${snapshot.recallCount}`,
      `locks ${snapshot.lockCount}`,
      snapshot.pendingPatchCount ? `patches ${snapshot.pendingPatchCount}` : ''
    ], { marginTop: 8 });
    const diagnosticPills = renderEntityCorePillRow([
      `dma ${snapshot.dmaCount}`,
      `trust ${formatPercent(core?.psyche?.dynamic?.trust || 0.5)}`,
      `pressure ${formatPercent(core?.psyche?.dynamic?.emotionalPressure || 0.15)}`,
      `mask ${formatPercent(core?.psyche?.dynamic?.maskStrength || 0.5)}`
    ], { marginTop: 8 });
    const overviewPanel = [
      renderEntityCoreSectionPanel('Mind Map', renderEntityCoreMindMap(core), { marginTop: 8, background: 'linear-gradient(180deg,rgba(240,253,250,0.64),rgba(255,255,255,0.72))' }),
      renderEntityCoreSectionPanel('Psychology Pressure', renderEntityCorePressureBars(core), { marginTop: 8, background: 'rgba(255,255,255,0.68)' }),
      renderEntityCoreMetricGrid(snapshot.promptPsycheMetrics, { marginTop: 8, minWidth: 120 }),
      renderEntityCoreListSection('Continuity', snapshot.continuityText, { separator: 'pipe', marginTop: 10 }),
      snapshot.worldText ? renderEntityCoreListSection('World Pressure', snapshot.worldText, { separator: 'pipe', marginTop: 10 }) : '',
      renderEntityCoreMetricGrid(snapshot.voiceMetrics, { marginTop: 10, minWidth: 120 }),
      renderEntityCoreListSection('Body Signal', snapshot.bodyText, { separator: 'pipe', marginTop: 10 }),
      renderEntityCoreListSection('Self Narrative', snapshot.selfText, { separator: 'pipe', marginTop: 10 }),
      renderEntityCoreListSection('Goal Layers', snapshot.goalsText, { separator: 'pipe', marginTop: 10 })
    ].join('');
    const diagnosticPanel = [
      diagnosticPills,
      renderEntityCoreMetricGrid(snapshot.diagnosticMetrics, { marginTop: 10, minWidth: 110 }),
      renderEntityCoreListSection('Emotion Bridge', snapshot.emotionText, { separator: 'pipe', marginTop: 10 }),
      renderEntityCoreMetricGrid(snapshot.relationMetrics, { marginTop: 10, minWidth: 110 }),
      renderEntityCoreListSection('Persona', snapshot.personaText, { separator: 'pipe', marginTop: 10 }),
      renderEntityCoreListSection('NSFW', snapshot.nsfwText, { separator: 'pipe', marginTop: 10 }),
      renderEntityCoreListSection('Branches', snapshot.branchText, { separator: 'pipe', marginTop: 10 }),
      renderEntityCoreListSection('Locks', snapshot.topLockText, { separator: 'pipe', marginTop: 10 }),
      renderEntityCoreListSection('Recall Highlights', snapshot.recallText, { separator: 'pipe', marginTop: 10 }),
      renderEntityCoreListSection('Verification Hints', snapshot.hintsText, { separator: 'pipe', marginTop: 10 }),
      renderEntityCoreListSection('Recent History', snapshot.historyText, { separator: 'pipe', marginTop: 10 })
    ].join('');
    return {
      key: `${PLUGIN_ID}:card:${idx >= 0 ? idx : normalizeLooseToken(entity?.name || 'entity')}`,
      name: 'Entity Core X',
      order: 55,
      html: `
        <details class="speech-dd entity-corex-card" style="margin-top:6px"${core?.mind?.coreMind ? ' open' : ''}>
          <summary>${escHtml(summaryLabel)}</summary>
          ${core?.mind?.coreMind ? `<div class="hint" style="margin:8px 0 6px 0"><strong>Core Mind</strong> ${escHtml(core.mind.coreMind)}</div>` : ''}
          ${heroPills}
          ${renderEntityCoreSectionPanel('Overview', overviewPanel, { marginTop: 8 })}
          <details class="speech-dd" style="margin-top:8px">
            <summary>Diagnostics</summary>
            ${renderEntityCoreSectionPanel('Diagnostics Snapshot', diagnosticPanel, { marginTop: 8, background: 'rgba(15,23,42,0.04)' })}
          </details>
        </details>
      `
    };
  };

  const notifyEntityCoreXToast = (message) => {
    const text = String(message || '').trim();
    if (!text) return;
    try {
      const toastApi = globalThis?.LMAI_GUI?.toast || globalThis?.window?.LMAI_GUI?.toast;
      if (typeof toastApi === 'function') {
        toastApi(text);
        return;
      }
    } catch (_) {}
  };

  const syncEntityCoreQuickPanelLive = () => {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('[data-corex-runtime-status]').forEach((node) => {
      node.textContent = runtimeState.lastStatus || 'idle';
    });
    document.querySelectorAll('[data-corex-runtime-error]').forEach((node) => {
      const hasError = !!runtimeState.lastError;
      node.textContent = runtimeState.lastError || '';
      node.style.display = hasError ? 'block' : 'none';
    });
    document.querySelectorAll('[data-corex-prompt-preview]').forEach((node) => {
      node.textContent = runtimeState.lastPromptPreview || '아직 프롬프트 미리보기가 없습니다.';
    });
    document.querySelectorAll('[data-corex-active-scope]').forEach((node) => {
      node.textContent = runtimeState.activeScopeId || 'global';
    });
    document.querySelectorAll('[data-corex-settings-live]').forEach((node) => {
      node.innerHTML = buildCoreSettingsPanelPreviewHtml(getSettings());
    });
  };

  const getCoreSettingsPanelRoot = (trigger) => trigger?.closest?.('.entity-corex-core-settings-panel') || null;
  const buildCoreSettingsPanelPreviewHtml = (settings = {}) => {
    const s = normalizeSettings(settings);
    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px">
        <div style="padding:8px 10px;border-radius:12px;background:#fff;border:1px solid rgba(148,163,184,0.22)">
          <div style="font-size:10px;font-weight:900;letter-spacing:.09em;text-transform:uppercase;color:#64748b">Core</div>
          <div style="margin-top:4px;font-size:13px;font-weight:900;color:#0f172a">${s.enabled ? 'enabled' : 'disabled'}</div>
          <div style="margin-top:3px;font-size:11px;color:#64748b">prompt ${s.promptInjectionEnabled ? 'on' : 'off'}</div>
        </div>
        <div style="padding:8px 10px;border-radius:12px;background:#fff;border:1px solid rgba(148,163,184,0.22)">
          <div style="font-size:10px;font-weight:900;letter-spacing:.09em;text-transform:uppercase;color:#64748b">Prompt</div>
          <div style="margin-top:4px;font-size:13px;font-weight:900;color:#0f172a">${escHtml(String(s.maxPromptEntities))} ent · ${escHtml(String(s.promptBudget))}t</div>
          <div style="margin-top:3px;font-size:11px;color:#64748b">recall ${escHtml(String(s.promptRecallHighlights))} · locks ${escHtml(String(s.promptContinuityLocks))}</div>
        </div>
        <div style="padding:8px 10px;border-radius:12px;background:#fff;border:1px solid rgba(148,163,184,0.22)">
          <div style="font-size:10px;font-weight:900;letter-spacing:.09em;text-transform:uppercase;color:#64748b">Recall</div>
          <div style="margin-top:4px;font-size:13px;font-weight:900;color:#0f172a">top ${escHtml(String(s.recallTopK))} · hop ${escHtml(String(s.recallHopDepth))}</div>
          <div style="margin-top:3px;font-size:11px;color:#64748b">direct ${escHtml(String(s.qnaDirectLimit))} · previous ${escHtml(String(s.qnaPreviousLimit))}</div>
        </div>
        <div style="padding:8px 10px;border-radius:12px;background:#fff;border:1px solid rgba(148,163,184,0.22)">
          <div style="font-size:10px;font-weight:900;letter-spacing:.09em;text-transform:uppercase;color:#64748b">Patch Gate</div>
          <div style="margin-top:4px;font-size:13px;font-weight:900;color:#0f172a">${Math.round(Number(s.patchAutoApplyThreshold || 0) * 100)}% / ${Math.round(Number(s.patchOverwriteThreshold || 0) * 100)}%</div>
          <div style="margin-top:3px;font-size:11px;color:#64748b">queue ${escHtml(String(s.patchQueueLimit))}</div>
        </div>
      </div>
    `;
  };
  const readCoreSettingsFromPanel = (root) => {
    const current = getSettings();
    if (!root || typeof root.querySelector !== 'function') return current;
    const getValue = (name) => root.querySelector(`[data-corex-core-setting="${name}"]`);
    const getBool = (name, fallback) => {
      const node = getValue(name);
      return node ? Boolean(node.checked) : fallback;
    };
    const getNumber = (name, fallback) => {
      const node = getValue(name);
      return node ? Number(node.value) : fallback;
    };
    return normalizeSettings({
      ...current,
      enabled: getBool('enabled', current.enabled),
      promptInjectionEnabled: getBool('promptInjectionEnabled', current.promptInjectionEnabled),
      maxPromptEntities: getNumber('maxPromptEntities', current.maxPromptEntities),
      promptBudget: getNumber('promptBudget', current.promptBudget),
      promptRecallHighlights: getNumber('promptRecallHighlights', current.promptRecallHighlights),
      promptContinuityLocks: getNumber('promptContinuityLocks', current.promptContinuityLocks),
      recallTopK: getNumber('recallTopK', current.recallTopK),
      recallHopDepth: getNumber('recallHopDepth', current.recallHopDepth),
      qnaDirectLimit: getNumber('qnaDirectLimit', current.qnaDirectLimit),
      qnaPreviousLimit: getNumber('qnaPreviousLimit', current.qnaPreviousLimit),
      patchQueueLimit: getNumber('patchQueueLimit', current.patchQueueLimit),
      patchAutoApplyThreshold: getNumber('patchAutoApplyThreshold', current.patchAutoApplyThreshold),
      patchOverwriteThreshold: getNumber('patchOverwriteThreshold', current.patchOverwriteThreshold)
    });
  };
  const writeCoreSettingsToPanel = (root, settings = {}) => {
    if (!root || typeof root.querySelectorAll !== 'function') return false;
    const s = normalizeSettings(settings);
    const valueMap = {
      maxPromptEntities: s.maxPromptEntities,
      promptBudget: s.promptBudget,
      promptRecallHighlights: s.promptRecallHighlights,
      promptContinuityLocks: s.promptContinuityLocks,
      recallTopK: s.recallTopK,
      recallHopDepth: s.recallHopDepth,
      qnaDirectLimit: s.qnaDirectLimit,
      qnaPreviousLimit: s.qnaPreviousLimit,
      patchQueueLimit: s.patchQueueLimit,
      patchAutoApplyThreshold: s.patchAutoApplyThreshold,
      patchOverwriteThreshold: s.patchOverwriteThreshold
    };
    Object.entries(valueMap).forEach(([key, value]) => {
      root.querySelectorAll(`[data-corex-core-setting="${key}"]`).forEach((node) => { node.value = String(value); });
    });
    root.querySelectorAll('[data-corex-core-setting="enabled"]').forEach((node) => { node.checked = s.enabled !== false; });
    root.querySelectorAll('[data-corex-core-setting="promptInjectionEnabled"]').forEach((node) => { node.checked = s.promptInjectionEnabled !== false; });
    return true;
  };
  const saveCoreSettingsFromPanel = async (trigger, explicitSave = false) => {
    const root = getCoreSettingsPanelRoot(trigger);
    if (!root) return getSettings();
    const next = readCoreSettingsFromPanel(root);
    const saved = await setSettingsPatch(next);
    writeCoreSettingsToPanel(root, saved);
    const live = root.querySelector('[data-corex-settings-live]');
    if (live) live.innerHTML = buildCoreSettingsPanelPreviewHtml(saved);
    if (explicitSave) notifyEntityCoreXToast('Entity Core X core settings saved');
    return saved;
  };
  const queueCoreSettingsAutoSave = (trigger, delay = 180) => {
    if (coreSettingsPanelAutoSaveTimer) clearTimeout(coreSettingsPanelAutoSaveTimer);
    coreSettingsPanelAutoSaveTimer = setTimeout(() => {
      coreSettingsPanelAutoSaveTimer = null;
      try { saveCoreSettingsFromPanel(trigger, false); } catch (_) {}
    }, Math.max(60, Number(delay) || 180));
  };
  const renderCoreSettingsPanelHtml = (options = {}) => {
    const s = getSettings();
    const open = options?.open === true;
    return `
      <details class="speech-dd entity-corex-core-settings-panel" style="margin-top:10px"${open ? ' open' : ''}>
        <summary>Entity Core X 운용 토글</summary>
        <div style="margin-top:8px;padding:12px 14px;border-radius:16px;border:1px solid rgba(20,184,166,0.24);background:linear-gradient(180deg,rgba(240,253,250,0.92),rgba(248,250,252,0.96))">
          <div data-corex-settings-live>${buildCoreSettingsPanelPreviewHtml(s)}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;margin-top:12px">
            <label style="display:flex;align-items:center;gap:8px;padding:10px;border-radius:12px;background:#fff;border:1px solid rgba(148,163,184,0.20);font-size:12px;font-weight:800;color:#334155"><input type="checkbox" data-corex-core-setting="enabled"${s.enabled ? ' checked' : ''}> Entity Core X 활성</label>
            <label style="display:flex;align-items:center;gap:8px;padding:10px;border-radius:12px;background:#fff;border:1px solid rgba(148,163,184,0.20);font-size:12px;font-weight:800;color:#334155"><input type="checkbox" data-corex-core-setting="promptInjectionEnabled"${s.promptInjectionEnabled ? ' checked' : ''}> 프롬프트 주입</label>
            <label class="scope-section-note">프롬프트 인물 수<input data-corex-core-setting="maxPromptEntities" type="number" min="1" max="6" value="${escHtml(String(s.maxPromptEntities))}" style="width:100%;margin-top:4px"></label>
            <label class="scope-section-note">프롬프트 예산<input data-corex-core-setting="promptBudget" type="number" min="800" max="4000" value="${escHtml(String(s.promptBudget))}" style="width:100%;margin-top:4px"></label>
            <label class="scope-section-note">회상 하이라이트<input data-corex-core-setting="promptRecallHighlights" type="number" min="1" max="6" value="${escHtml(String(s.promptRecallHighlights))}" style="width:100%;margin-top:4px"></label>
            <label class="scope-section-note">Continuity Lock<input data-corex-core-setting="promptContinuityLocks" type="number" min="1" max="6" value="${escHtml(String(s.promptContinuityLocks))}" style="width:100%;margin-top:4px"></label>
            <label class="scope-section-note">Recall Top K<input data-corex-core-setting="recallTopK" type="number" min="2" max="10" value="${escHtml(String(s.recallTopK))}" style="width:100%;margin-top:4px"></label>
            <label class="scope-section-note">Recall Hop<input data-corex-core-setting="recallHopDepth" type="number" min="1" max="3" value="${escHtml(String(s.recallHopDepth))}" style="width:100%;margin-top:4px"></label>
            <label class="scope-section-note">DMA Direct 읽기<input data-corex-core-setting="qnaDirectLimit" type="number" min="1" max="10" value="${escHtml(String(s.qnaDirectLimit))}" style="width:100%;margin-top:4px"></label>
            <label class="scope-section-note">DMA Previous 읽기<input data-corex-core-setting="qnaPreviousLimit" type="number" min="1" max="10" value="${escHtml(String(s.qnaPreviousLimit))}" style="width:100%;margin-top:4px"></label>
            <label class="scope-section-note">Patch Queue<input data-corex-core-setting="patchQueueLimit" type="number" min="4" max="40" value="${escHtml(String(s.patchQueueLimit))}" style="width:100%;margin-top:4px"></label>
            <label class="scope-section-note">Auto Apply Threshold<input data-corex-core-setting="patchAutoApplyThreshold" type="number" min="0.6" max="0.99" step="0.01" value="${escHtml(String(s.patchAutoApplyThreshold))}" style="width:100%;margin-top:4px"></label>
            <label class="scope-section-note">Overwrite Threshold<input data-corex-core-setting="patchOverwriteThreshold" type="number" min="0.85" max="1" step="0.01" value="${escHtml(String(s.patchOverwriteThreshold))}" style="width:100%;margin-top:4px"></label>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
            <button type="button" data-corex-core-action="save" style="padding:10px 14px;border-radius:10px;border:1px solid rgba(15,118,110,.24);background:#0f766e;color:#fff;font-size:12px;font-weight:900;cursor:pointer">운용 설정 저장</button>
            <button type="button" data-corex-core-action="reset" style="padding:10px 14px;border-radius:10px;border:1px solid rgba(148,163,184,.28);background:#fff;color:#334155;font-size:12px;font-weight:900;cursor:pointer">기본값 복원</button>
          </div>
          <div style="margin-top:10px;font-size:12px;line-height:1.55;color:#64748b">Entity Core X는 원문 메모리를 소유하지 않고 DMA 증거를 읽어 인격, 심리, 관계 압력과 패치 제안을 생성합니다.</div>
        </div>
      </details>
    `;
  };

  const summarizeDmaActionLabel = (action = '') => {
    const key = String(action || '').trim();
    if (key === 'open-viewer') return 'DMA 메모리 보기';
    if (key === 'align-livechat') return 'DMA 라이브챗 정렬';
    if (key === 'merge-livechat') return 'DMA 라이브챗 병합';
    return 'DMA 작업';
  };

  const getAnalysisProviderPanelRoot = (trigger) => trigger?.closest?.('.entity-corex-analysis-panel') || null;
  const queueAnalysisPanelAutoSave = (trigger, delay = 180) => {
    if (analysisPanelAutoSaveTimer) clearTimeout(analysisPanelAutoSaveTimer);
    analysisPanelAutoSaveTimer = setTimeout(() => {
      analysisPanelAutoSaveTimer = null;
      try { globalThis.LIBRA_EntityCoreX?.saveAnalysisProviderFromPanel?.(trigger); } catch (_) {}
    }, Math.max(60, Number(delay) || 180));
  };
  const buildAnalysisProviderPanelPreviewHtml = (settings = {}, status = '') => {
    const analysis = normalizeAnalysisProviderSettings(settings);
    const stageLines = [
      analysis?.stages?.finalize ? '최종 반영' : '',
      analysis?.stages?.rebuild ? '리빌드' : '',
      analysis?.stages?.manual ? '수동 실행' : ''
    ].filter(Boolean);
    const stageHtml = stageLines.length
      ? stageLines.map(item => `<span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;border:1px solid rgba(148,163,184,0.22);background:#ffffff;font-size:11px;font-weight:700;color:#334155">${escHtml(item)}</span>`).join('')
      : '<span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;border:1px solid rgba(148,163,184,0.22);background:#ffffff;font-size:11px;font-weight:700;color:#64748b">비활성</span>';
    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px">
        <div style="padding:8px 10px;border-radius:10px;border:1px solid rgba(148,163,184,0.2);background:#ffffff">
          <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.02em;color:#64748b">Runtime</div>
          <div style="margin-top:4px;font-size:13px;font-weight:800;color:#0f172a">${escHtml(analysis.enabled ? `${analysis.provider}/${analysis.model}` : 'disabled')}</div>
        </div>
        <div style="padding:8px 10px;border-radius:10px;border:1px solid rgba(148,163,184,0.2);background:#ffffff">
          <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.02em;color:#64748b">Timeout</div>
          <div style="margin-top:4px;font-size:13px;font-weight:800;color:#0f172a">${escHtml(String(analysis.timeout))}ms</div>
        </div>
        <div style="padding:8px 10px;border-radius:10px;border:1px solid rgba(148,163,184,0.2);background:#ffffff">
          <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.02em;color:#64748b">Response Max</div>
          <div style="margin-top:4px;font-size:13px;font-weight:800;color:#0f172a">${escHtml(String(analysis.responseMaxTokens))}</div>
        </div>
        <div style="padding:8px 10px;border-radius:10px;border:1px solid rgba(148,163,184,0.2);background:#ffffff">
          <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.02em;color:#64748b">Evidence Refs</div>
          <div style="margin-top:4px;font-size:13px;font-weight:800;color:#0f172a">${escHtml(String(analysis.maxEvidenceRefs))}</div>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">${stageHtml}</div>
      <div style="margin-top:8px;font-size:12px;color:#475569">자동 적용 <strong>${escHtml(analysis.autoApply ? '켜짐' : '꺼짐')}</strong> · 추론 <strong>${escHtml(`${analysis.reasoningPreset}/${analysis.reasoningEffort}`)}</strong></div>
      ${status ? `<div style="margin-top:8px;padding:8px 10px;border-radius:10px;background:rgba(219,234,254,0.5);border:1px solid rgba(96,165,250,0.25);font-size:12px;font-weight:700;color:#1d4ed8">${escHtml(status)}</div>` : ''}
    `;
  };
  const readAnalysisProviderSettingsFromPanel = (root) => {
    if (!root || typeof root.querySelector !== 'function') {
      return normalizeAnalysisProviderSettings(getSettings().analysisProvider || {});
    }
    const getValue = (name) => root.querySelector(`[data-corex-analysis-setting="${name}"]`);
    return normalizeAnalysisProviderSettings({
      enabled: Boolean(getValue('enabled')?.checked),
      provider: getValue('provider')?.value || 'openai',
      url: getValue('url')?.value || '',
      key: getValue('key')?.value || '',
      model: getValue('model')?.value || 'gpt-4o-mini',
      temp: getValue('temp')?.value,
      timeout: getValue('timeout')?.value,
      reasoningPreset: getValue('reasoningPreset')?.value || 'auto',
      reasoningEffort: getValue('reasoningEffort')?.value || 'none',
      reasoningBudgetTokens: getValue('reasoningBudgetTokens')?.value,
      maxCompletionTokens: getValue('maxCompletionTokens')?.value,
      responseMaxTokens: getValue('responseMaxTokens')?.value,
      maxEvidenceRefs: getValue('maxEvidenceRefs')?.value,
      maxEvidenceSnippets: getValue('maxEvidenceSnippets')?.value,
      maxDirectEntries: getValue('maxDirectEntries')?.value,
      maxPreviousEntries: getValue('maxPreviousEntries')?.value,
      autoApply: Boolean(getValue('autoApply')?.checked),
      debug: Boolean(getValue('debug')?.checked),
      stages: {
        finalize: Boolean(getValue('stageFinalize')?.checked),
        rebuild: Boolean(getValue('stageRebuild')?.checked),
        manual: Boolean(getValue('stageManual')?.checked)
      }
    });
  };
  const writeAnalysisProviderSettingsToPanel = (root, settings = {}) => {
    if (!root || typeof root.querySelectorAll !== 'function') return false;
    const analysis = normalizeAnalysisProviderSettings(settings);
    const valueMap = {
      provider: analysis.provider,
      url: analysis.url,
      key: analysis.key,
      model: analysis.model,
      temp: String(analysis.temp),
      timeout: String(analysis.timeout),
      reasoningPreset: analysis.reasoningPreset,
      reasoningEffort: analysis.reasoningEffort,
      reasoningBudgetTokens: String(analysis.reasoningBudgetTokens),
      maxCompletionTokens: String(analysis.maxCompletionTokens),
      responseMaxTokens: String(analysis.responseMaxTokens),
      maxEvidenceRefs: String(analysis.maxEvidenceRefs),
      maxEvidenceSnippets: String(analysis.maxEvidenceSnippets),
      maxDirectEntries: String(analysis.maxDirectEntries),
      maxPreviousEntries: String(analysis.maxPreviousEntries)
    };
    Object.entries(valueMap).forEach(([key, value]) => {
      root.querySelectorAll(`[data-corex-analysis-setting="${key}"]`).forEach((node) => {
        node.value = value;
      });
    });
    const checkMap = {
      enabled: analysis.enabled,
      autoApply: analysis.autoApply,
      debug: analysis.debug,
      stageFinalize: analysis.stages.finalize,
      stageRebuild: analysis.stages.rebuild,
      stageManual: analysis.stages.manual
    };
    Object.entries(checkMap).forEach(([key, value]) => {
      root.querySelectorAll(`[data-corex-analysis-setting="${key}"]`).forEach((node) => {
        node.checked = Boolean(value);
      });
    });
    return true;
  };
  const syncAnalysisProviderPanelPreview = (root, settings = {}, status = '') => {
    if (!root || typeof root.querySelector !== 'function') return false;
    const live = root.querySelector('[data-corex-analysis-live]');
    if (!live) return false;
    live.innerHTML = buildAnalysisProviderPanelPreviewHtml(settings, status);
    return true;
  };
  const renderAnalysisProviderSettingsPanelHtml = (options = {}) => {
    const analysis = getSettings().analysisProvider;
    const open = options?.open === true;
    return `
      <details class="speech-dd entity-corex-analysis-panel" style="margin-top:10px"${open ? ' open' : ''}>
        <summary>분석 제공자 설정</summary>
        <div style="margin-top:8px;padding:12px 14px;border-radius:14px;border:1px solid rgba(148,163,184,0.22);background:rgba(15,23,42,0.08)">
          <div data-corex-analysis-live>
            ${buildAnalysisProviderPanelPreviewHtml(analysis)}
          </div>
          <div style="margin-top:12px;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,0.7);border:1px solid rgba(148,163,184,0.18)">
            <div style="font-size:12px;font-weight:800;letter-spacing:0.02em;text-transform:uppercase;color:#475569">실행 범위</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:10px">
              <label class="scope-section-note"><input type="checkbox" data-corex-analysis-setting="enabled"${analysis.enabled ? ' checked' : ''}> 분석 사용</label>
              <label class="scope-section-note"><input type="checkbox" data-corex-analysis-setting="stageFinalize"${analysis.stages.finalize ? ' checked' : ''}> finalize 단계</label>
              <label class="scope-section-note"><input type="checkbox" data-corex-analysis-setting="stageRebuild"${analysis.stages.rebuild ? ' checked' : ''}> rebuild 단계</label>
              <label class="scope-section-note"><input type="checkbox" data-corex-analysis-setting="stageManual"${analysis.stages.manual ? ' checked' : ''}> manual 단계</label>
              <label class="scope-section-note"><input type="checkbox" data-corex-analysis-setting="autoApply"${analysis.autoApply ? ' checked' : ''}> 결과 자동 반영</label>
              <label class="scope-section-note"><input type="checkbox" data-corex-analysis-setting="debug"${analysis.debug ? ' checked' : ''}> 디버그 로그</label>
            </div>
          </div>
          <div style="margin-top:12px;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,0.7);border:1px solid rgba(148,163,184,0.18)">
            <div style="font-size:12px;font-weight:800;letter-spacing:0.02em;text-transform:uppercase;color:#475569">모델 / 추론</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-top:10px">
            <label class="scope-section-note">provider
              <select data-corex-analysis-setting="provider" style="width:100%;margin-top:4px">
                ${['openai','openrouter','claude','gemini','vertex','ollama_cloud','copilot','custom'].map(item => `<option value="${escHtml(item)}"${analysis.provider === item ? ' selected' : ''}>${escHtml(item)}</option>`).join('')}
              </select>
            </label>
            <label class="scope-section-note">model
              <input data-corex-analysis-setting="model" type="text" value="${escHtml(analysis.model)}" style="width:100%;margin-top:4px">
            </label>
            <label class="scope-section-note">temperature
              <input data-corex-analysis-setting="temp" type="number" step="0.05" min="0" max="1.5" value="${escHtml(String(analysis.temp))}" style="width:100%;margin-top:4px">
            </label>
            <label class="scope-section-note">timeout ms
              <input data-corex-analysis-setting="timeout" type="number" min="3000" max="180000" value="${escHtml(String(analysis.timeout))}" style="width:100%;margin-top:4px">
            </label>
            <label class="scope-section-note">reasoning preset
              <select data-corex-analysis-setting="reasoningPreset" style="width:100%;margin-top:4px">
                ${['auto','gpt','claude','gemini','deepseek','kimi','glm'].map(item => `<option value="${escHtml(item)}"${analysis.reasoningPreset === item ? ' selected' : ''}>${escHtml(item)}</option>`).join('')}
              </select>
            </label>
            <label class="scope-section-note">reasoning effort
              <select data-corex-analysis-setting="reasoningEffort" style="width:100%;margin-top:4px">
                ${['none','low','medium','high'].map(item => `<option value="${escHtml(item)}"${analysis.reasoningEffort === item ? ' selected' : ''}>${escHtml(item)}</option>`).join('')}
              </select>
            </label>
            <label class="scope-section-note">reasoning budget
              <input data-corex-analysis-setting="reasoningBudgetTokens" type="number" min="0" max="64000" value="${escHtml(String(analysis.reasoningBudgetTokens))}" style="width:100%;margin-top:4px">
            </label>
            <label class="scope-section-note">max completion
              <input data-corex-analysis-setting="maxCompletionTokens" type="number" min="256" max="64000" value="${escHtml(String(analysis.maxCompletionTokens))}" style="width:100%;margin-top:4px">
            </label>
            <label class="scope-section-note">response max
              <input data-corex-analysis-setting="responseMaxTokens" type="number" min="256" max="12000" value="${escHtml(String(analysis.responseMaxTokens))}" style="width:100%;margin-top:4px">
            </label>
            <label class="scope-section-note">evidence refs
              <input data-corex-analysis-setting="maxEvidenceRefs" type="number" min="4" max="32" value="${escHtml(String(analysis.maxEvidenceRefs))}" style="width:100%;margin-top:4px">
            </label>
            <label class="scope-section-note">evidence snippets
              <input data-corex-analysis-setting="maxEvidenceSnippets" type="number" min="2" max="16" value="${escHtml(String(analysis.maxEvidenceSnippets))}" style="width:100%;margin-top:4px">
            </label>
            <label class="scope-section-note">direct entries
              <input data-corex-analysis-setting="maxDirectEntries" type="number" min="1" max="12" value="${escHtml(String(analysis.maxDirectEntries))}" style="width:100%;margin-top:4px">
            </label>
            <label class="scope-section-note">previous entries
              <input data-corex-analysis-setting="maxPreviousEntries" type="number" min="1" max="12" value="${escHtml(String(analysis.maxPreviousEntries))}" style="width:100%;margin-top:4px">
            </label>
            </div>
          </div>
          <div style="margin-top:12px;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,0.7);border:1px solid rgba(148,163,184,0.18)">
            <div style="font-size:12px;font-weight:800;letter-spacing:0.02em;text-transform:uppercase;color:#475569">엔드포인트</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
            <label class="scope-section-note">base url
              <input data-corex-analysis-setting="url" type="text" value="${escHtml(analysis.url)}" placeholder="https://api.openai.com" style="width:100%;margin-top:4px">
            </label>
            <label class="scope-section-note">api key
              <input data-corex-analysis-setting="key" type="password" value="${escHtml(analysis.key)}" placeholder="provider key" style="width:100%;margin-top:4px">
            </label>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
            <button type="button" data-corex-analysis-action="save">분석 설정 저장</button>
            <button type="button" data-corex-analysis-action="reset">기본값 복원</button>
            <button type="button" data-corex-analysis-action="audit">Entity 데이터 감사</button>
          </div>
        </div>
      </details>
    `;
  };
  const bindAnalysisProviderPanelHandlers = () => {
    if (analysisPanelHandlersBound || typeof document === 'undefined') return;
    analysisPanelClickHandler = async (event) => {
      const target = event?.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest('button');
      if (!button) return;
      const root = getAnalysisProviderPanelRoot(button);
      const coreRoot = getCoreSettingsPanelRoot(button);
      if (!root && !coreRoot) return;
      const action = String(
        button.getAttribute('data-corex-analysis-action')
        || button.getAttribute('data-corex-core-action')
        || ''
      ).trim();
      if (!action) return;
      try {
        event.preventDefault?.();
        event.stopPropagation?.();
      } catch (_) {}
      if (coreRoot) {
        if (action === 'save') {
          try { await saveCoreSettingsFromPanel(button, true); } catch (_) {}
          return;
        }
        if (action === 'reset') {
          const saved = await setSettingsPatch({ ...DEFAULT_SETTINGS, analysisProvider: getSettings().analysisProvider });
          const coreRoot = getCoreSettingsPanelRoot(button);
          writeCoreSettingsToPanel(coreRoot, saved);
          const live = coreRoot?.querySelector?.('[data-corex-settings-live]');
          if (live) live.innerHTML = buildCoreSettingsPanelPreviewHtml(saved);
          notifyEntityCoreXToast('Entity Core X core settings reset');
          return;
        }
      }
      if (action === 'save') {
        try { await globalThis.LIBRA_EntityCoreX?.saveAnalysisProviderFromPanel?.(button, true); } catch (_) {}
        return;
      }
      if (action === 'reset') {
        try { await globalThis.LIBRA_EntityCoreX?.resetAnalysisProviderPanel?.(button); } catch (_) {}
        return;
      }
      if (action === 'audit') {
        try {
          const report = await globalThis.LIBRA_EntityCoreX?.runAudit?.({});
          const warnings = Number(report?.contradictionWarnings?.length || 0)
            + Number(report?.unsafePatchProposals?.length || 0)
            + Number(report?.evidenceGaps?.length || 0);
          syncAnalysisProviderPanelPreview(root, getSettings().analysisProvider || {}, `Entity audit complete · checked ${Number(report?.checkedEntities || 0)} · warnings ${warnings}`);
          notifyEntityCoreXToast(`Entity audit complete · ${Number(report?.checkedEntities || 0)} entities`);
        } catch (error) {
          const message = compactText(error?.message || String(error || 'audit_failed'), 180);
          syncAnalysisProviderPanelPreview(root, getSettings().analysisProvider || {}, `Entity audit failed: ${message}`);
          notifyEntityCoreXToast(`Entity audit failed: ${message}`);
        }
      }
    };
    analysisPanelChangeHandler = async (event) => {
      const target = event?.target;
      if (!(target instanceof HTMLElement)) return;
      const root = getAnalysisProviderPanelRoot(target);
      const coreRoot = getCoreSettingsPanelRoot(target);
      if (coreRoot && target.matches('[data-corex-core-setting]')) {
        try { await saveCoreSettingsFromPanel(target, false); } catch (_) {}
        return;
      }
      if (!root) return;
      if (target.matches('[data-corex-analysis-setting]')) {
        try { await globalThis.LIBRA_EntityCoreX?.saveAnalysisProviderFromPanel?.(target, false); } catch (_) {}
      }
    };
    analysisPanelInputHandler = (event) => {
      const target = event?.target;
      if (!(target instanceof HTMLElement)) return;
      const root = getAnalysisProviderPanelRoot(target);
      const coreRoot = getCoreSettingsPanelRoot(target);
      if (coreRoot && target.matches('input[data-corex-core-setting][type="number"], input[data-corex-core-setting][type="text"]')) {
        queueCoreSettingsAutoSave(target, 220);
        return;
      }
      if (!root) return;
      if (target.matches('input[data-corex-analysis-setting][type="text"], input[data-corex-analysis-setting][type="password"], input[data-corex-analysis-setting][type="number"]')) {
        queueAnalysisPanelAutoSave(target, 220);
      }
    };
    document.addEventListener('click', analysisPanelClickHandler, true);
    document.addEventListener('change', analysisPanelChangeHandler, true);
    document.addEventListener('input', analysisPanelInputHandler, true);
    analysisPanelHandlersBound = true;
  };

  const getDirectMemoryArchiveApi = () => getDmaApi();

  const bindCorexDmaActionHandlers = () => {
    if (corexDmaActionHandlersBound || typeof document === 'undefined') return;
    corexDmaActionClickHandler = async (event) => {
      const target = event?.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest('[data-corex-dma-action]');
      if (!button) return;
      const api = getDirectMemoryArchiveApi();
      if (!api) {
        updateRuntimeStatus('DMA API unavailable', { error: 'dma_api_unavailable' });
        notifyEntityCoreXToast('DMA API unavailable');
        return;
      }
      const action = String(button.getAttribute('data-corex-dma-action') || '').trim();
      const scopeId = String(button.getAttribute('data-corex-dma-scope') || runtimeState.activeScopeId || 'global').trim() || 'global';
      const tab = String(button.getAttribute('data-corex-dma-tab') || 'direct').trim() === 'previous' ? 'previous' : 'direct';
      try {
        event.preventDefault?.();
        event.stopPropagation?.();
      } catch (_) {}
      const actionLabel = summarizeDmaActionLabel(action);
      try {
        updateRuntimeStatus(`${actionLabel} 실행 중`, { scopeId });
        notifyEntityCoreXToast(`${actionLabel} 실행 중`);
        if (action === 'open-viewer') {
          const result = await api.openMemoryViewer?.({ scopeId, tab });
          await new Promise(resolve => setTimeout(resolve, 0));
          const modalOpen = typeof document !== 'undefined' && !!document.querySelector('[data-libra-dma-memory-modal] [data-dma-modal-shell="1"]');
          if (!modalOpen && !result) {
            throw new Error('dma_memory_viewer_not_opened');
          }
          updateRuntimeStatus(`DMA viewer opened (${tab})`, { scopeId });
          notifyEntityCoreXToast(`DMA ${tab === 'previous' ? 'previous' : 'memory'} viewer opened`);
          return;
        }
        if (action === 'align-livechat') {
          const result = await api.alignToLiveChatTurns?.({ scopeId });
          if (result?.ok === false) throw new Error(result?.reason || 'dma_livechat_align_failed');
          updateRuntimeStatus(`DMA livechat alignment complete (${result?.directTurnChanges ?? 0} direct / ${result?.previousTurnChanges ?? 0} previous)`, { scopeId });
          notifyEntityCoreXToast('DMA livechat alignment complete');
          return;
        }
        if (action === 'merge-livechat') {
          const result = await api.mergeByLiveChatTurns?.({ scopeId });
          if (result?.ok === false) throw new Error(result?.reason || 'dma_livechat_merge_failed');
          updateRuntimeStatus(`DMA livechat merge complete (${result?.directMerged ?? 0} direct / ${result?.previousMerged ?? 0} previous)`, { scopeId });
          notifyEntityCoreXToast('DMA livechat merge complete');
        }
      } catch (error) {
        const message = compactText(error?.message || String(error || 'dma_action_failed'), 180) || 'dma_action_failed';
        updateRuntimeStatus(`${actionLabel} failed`, { scopeId, error: message });
        notifyEntityCoreXToast(`${actionLabel} failed: ${message}`);
      }
    };
    document.addEventListener('click', corexDmaActionClickHandler, true);
    corexDmaActionHandlersBound = true;
  };

  const renderQuickControlPanel = (context = {}) => {
    const scopeId = normalizeText(resolveScopeId(context) || runtimeState.activeScopeId || 'global') || 'global';
    runtimeState.activeScopeId = scopeId;
    return ({
    key: `${PLUGIN_ID}:quick`,
    name: 'Entity Core X',
    order: 55,
      html: `
      <div class="scope-section-card" style="margin-top:8px;border:1px solid rgba(20,184,166,0.22);background:linear-gradient(180deg,rgba(240,253,250,0.72),rgba(255,255,255,0.96))">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
          <div>
            <div class="insp-section-title">Entity Core X</div>
            <div class="scope-section-note" style="margin-top:5px">인격, 심리, 감정, 관계 압력, DMA 증거 기반 patch proposal을 관리합니다.</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
            <span style="display:inline-flex;padding:5px 9px;border-radius:999px;background:#ecfeff;border:1px solid rgba(14,116,144,0.18);font-size:11px;font-weight:900;color:#0f766e">guidance only</span>
            <span style="display:inline-flex;padding:5px 9px;border-radius:999px;background:#eff6ff;border:1px solid rgba(37,99,235,0.18);font-size:11px;font-weight:900;color:#1d4ed8">DMA evidence</span>
            <span style="display:inline-flex;padding:5px 9px;border-radius:999px;background:#fef3c7;border:1px solid rgba(217,119,6,0.18);font-size:11px;font-weight:900;color:#92400e">patch proposal</span>
          </div>
        </div>
        ${renderEntityCoreSectionPanel('현재 상태', [
          renderEntityCoreMetricGrid([
            { label: 'Scope', value: scopeId },
            { label: 'Prompt rows', value: String(runtimeState.lastPromptCount || 0) },
            { label: 'Last finalize', value: String(runtimeState.lastFinalizedTurn || 0) },
            { label: 'Analysis', value: getSettings().analysisProvider.enabled ? `${getSettings().analysisProvider.provider}/${getSettings().analysisProvider.model}` : 'disabled' }
          ], { marginTop: 8, minWidth: 120 }),
          `<div style="margin-top:10px;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,0.72);border:1px solid rgba(148,163,184,0.2)">
            <div style="font-size:12px;font-weight:800;letter-spacing:0.02em;text-transform:uppercase;color:#475569">Runtime Status</div>
            <div data-corex-runtime-status style="margin-top:6px;font-size:13px;font-weight:700;color:#0f172a">${escHtml(runtimeState.lastStatus || 'idle')}</div>
            <div data-corex-runtime-error style="margin-top:6px;font-size:12px;font-weight:700;color:#dc2626;${runtimeState.lastError ? '' : 'display:none;'}">${escHtml(runtimeState.lastError || '')}</div>
            <div style="margin-top:8px;font-size:12px;color:#64748b"><strong>Active scope:</strong> <span data-corex-active-scope>${escHtml(scopeId)}</span></div>
          </div>`,
          `<div style="margin-top:10px;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,0.72);border:1px solid rgba(148,163,184,0.2)">
            <div style="font-size:12px;font-weight:800;letter-spacing:0.02em;text-transform:uppercase;color:#475569">Prompt Preview</div>
            <div data-corex-prompt-preview style="margin-top:6px;font-size:12px;line-height:1.6;color:#334155;white-space:pre-wrap">${escHtml(runtimeState.lastPromptPreview || '아직 프롬프트 미리보기가 없습니다.')}</div>
          </div>`
        ].join(''), { marginTop: 8 })}
        ${renderCoreSettingsPanelHtml({ open: true })}
        ${renderEntityCoreSectionPanel('DMA 도구', `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:8px">
            <div style="padding:12px;border-radius:12px;background:#ffffff;border:1px solid rgba(96,165,250,0.22)">
              <div style="font-size:12px;font-weight:800;color:#1d4ed8">DMA 메모리 보기</div>
              <div style="margin-top:6px;font-size:12px;line-height:1.55;color:#475569">현재 scope의 DMA direct / previous 메모리를 팝업 뷰어로 엽니다.</div>
              <button type="button" data-corex-dma-action="open-viewer" data-corex-dma-scope="${escHtml(scopeId)}" data-corex-dma-tab="direct" style="margin-top:10px;padding:10px 14px;border-radius:10px;border:1px solid rgba(37,99,235,0.24);background:#eff6ff;color:#1d4ed8;font-size:12px;font-weight:800;cursor:pointer">뷰어 열기</button>
            </div>
            <div style="padding:12px;border-radius:12px;background:#ffffff;border:1px solid rgba(45,212,191,0.22)">
              <div style="font-size:12px;font-weight:800;color:#0f766e">DMA 라이브챗 정렬</div>
              <div style="margin-top:6px;font-size:12px;line-height:1.55;color:#475569">DMA 메모리의 턴 번호와 소스 앵커를 현재 라이브챗 순서에 다시 맞춥니다.</div>
              <button type="button" data-corex-dma-action="align-livechat" data-corex-dma-scope="${escHtml(scopeId)}" style="margin-top:10px;padding:10px 14px;border-radius:10px;border:1px solid rgba(14,116,144,0.24);background:#ecfeff;color:#0f766e;font-size:12px;font-weight:800;cursor:pointer">정렬 실행</button>
            </div>
            <div style="padding:12px;border-radius:12px;background:#ffffff;border:1px solid rgba(20,184,166,0.22)">
              <div style="font-size:12px;font-weight:800;color:#0f766e">DMA 라이브챗 병합</div>
              <div style="margin-top:6px;font-size:12px;line-height:1.55;color:#475569">라이브챗 기준으로 중복 DMA 메모리를 병합하고 previous 엔트리까지 다시 맞춥니다.</div>
              <button type="button" data-corex-dma-action="merge-livechat" data-corex-dma-scope="${escHtml(scopeId)}" style="margin-top:10px;padding:10px 14px;border-radius:10px;border:1px solid rgba(13,148,136,0.24);background:#f0fdfa;color:#0f766e;font-size:12px;font-weight:800;cursor:pointer">병합 실행</button>
            </div>
          </div>
          <div style="margin-top:10px;font-size:12px;color:#64748b">각 버튼은 실행 즉시 상태 문구와 토스트 알림을 남깁니다. 뷰어가 열리지 않으면 실패 사유도 함께 표시됩니다.</div>
        `, { marginTop: 10 })}
        ${renderAnalysisProviderSettingsPanelHtml({ open: false })}
      </div>
    `
  });
  };

  const renderInspectorPanel = (context = {}) => {
    const entityRows = [];
    let totalRecall = 0;
    let totalLocks = 0;
    let totalPendingPatches = 0;
    getEntityCache(context).forEach((entity) => {
      if (!entity || typeof entity !== 'object') return;
      const core = normalizeEntityCoreX(entity, entity?.entityCoreX || {});
      const snapshot = buildEntityCoreDisplaySnapshot(context, entity, core);
      totalRecall += snapshot.recallCount;
      totalLocks += snapshot.lockCount;
      totalPendingPatches += snapshot.pendingPatchCount;
      entityRows.push(`
        <details class="speech-dd" style="margin-top:8px"${entityRows.length === 0 ? ' open' : ''}>
          <summary>${escHtml((entity?.name || 'Unknown'))} · ${escHtml(snapshot.modeText)}${snapshot.goalText ? ` · ${escHtml(snapshot.goalText)}` : ''}</summary>
          <div style="margin-top:8px;padding:10px 12px;border-radius:10px;border:1px solid rgba(148,163,184,0.26);background:rgba(15,23,42,0.08)">
            ${snapshot.row.coreMind ? `<div class="scope-section-note"><strong>Core Mind</strong> ${escHtml(snapshot.row.coreMind)}</div>` : ''}
            ${renderEntityCorePillRow([
              `recall ${snapshot.recallCount}`,
              `dma ${snapshot.dmaCount}`,
              `locks ${snapshot.lockCount}`,
              snapshot.pendingPatchCount ? `patches ${snapshot.pendingPatchCount}` : '',
              snapshot.relationFocus?.target ? `relation ${snapshot.relationFocus.target}` : ''
            ], { marginTop: 8 })}
            ${renderEntityCoreSectionPanel('Overview', [
              renderEntityCoreSectionPanel('Mind Map', renderEntityCoreMindMap(core), { marginTop: 8, background: 'linear-gradient(180deg,rgba(240,253,250,0.64),rgba(255,255,255,0.72))' }),
              renderEntityCoreSectionPanel('Psychology Pressure', renderEntityCorePressureBars(core), { marginTop: 8, background: 'rgba(255,255,255,0.68)' }),
              renderEntityCoreMetricGrid(snapshot.promptPsycheMetrics, { marginTop: 8, minWidth: 120 }),
              renderEntityCoreListSection('Continuity', snapshot.continuityText, { separator: 'pipe', marginTop: 10 }),
              snapshot.worldText ? renderEntityCoreListSection('World Pressure', snapshot.worldText, { separator: 'pipe', marginTop: 10 }) : '',
              renderEntityCoreMetricGrid(snapshot.voiceMetrics, { marginTop: 10, minWidth: 120 }),
              renderEntityCoreListSection('Body', snapshot.bodyText, { separator: 'pipe', marginTop: 10 }),
              renderEntityCoreListSection('Self Model', snapshot.selfText, { separator: 'pipe', marginTop: 10 }),
              renderEntityCoreListSection('Goal Layers', snapshot.goalsText, { separator: 'pipe', marginTop: 10 })
            ].join(''), { marginTop: 8 })}
            <details class="speech-dd" style="margin-top:8px">
              <summary>Diagnostics</summary>
              ${renderEntityCoreSectionPanel('Diagnostics Snapshot', [
                renderEntityCoreMetricGrid(snapshot.diagnosticMetrics, { marginTop: 8, minWidth: 110 }),
                renderEntityCoreListSection('Emotion Bridge', snapshot.emotionText, { separator: 'pipe', marginTop: 10 }),
                renderEntityCoreMetricGrid(snapshot.relationMetrics, { marginTop: 10, minWidth: 110 }),
                renderEntityCoreListSection('Persona', snapshot.personaText, { separator: 'pipe', marginTop: 10 }),
                renderEntityCoreListSection('Branches', snapshot.branchText, { separator: 'pipe', marginTop: 10 }),
                renderEntityCoreListSection('Locks', snapshot.topLockText, { separator: 'pipe', marginTop: 10 }),
                renderEntityCoreListSection('NSFW', snapshot.nsfwText, { separator: 'pipe', marginTop: 10 }),
                renderEntityCoreListSection('Recall Highlights', snapshot.recallText, { separator: 'pipe', marginTop: 10 }),
                renderEntityCoreListSection('Verification Hints', snapshot.hintsText, { separator: 'pipe', marginTop: 10 }),
                renderEntityCoreListSection('Recent History', snapshot.historyText, { separator: 'pipe', marginTop: 10 })
              ].join(''), { marginTop: 8, background: 'rgba(15,23,42,0.04)' })}
            </details>
          </div>
        </details>
      `);
    });
    return {
      key: `${PLUGIN_ID}:inspector`,
      name: 'Entity Core X',
      order: 55,
      html: `
        <div class="scope-section-card">
          <div class="insp-section-title">Entity Core X Inspector</div>
          <div class="scope-section-note">리브라 본체는 quick panel, inspector, entity card를 그대로 쌓아 보여줍니다. 그래서 여기서는 프롬프트에 가까운 요약을 먼저, 깊은 진단은 접이식으로 배치합니다.</div>
          ${renderEntityCorePillRow([
            `scope ${runtimeState.activeScopeId}`,
            `entities ${entityRows.length}`,
            `recall ${totalRecall}`,
            `locks ${totalLocks}`,
            totalPendingPatches ? `pending patches ${totalPendingPatches}` : '',
            getSettings().analysisProvider.enabled ? `analysis ${getSettings().analysisProvider.provider}` : 'analysis disabled'
          ], { marginTop: 8 })}
          <div class="scope-section-note" style="margin-top:6px"><strong>Prompt Preview</strong> ${escHtml(runtimeState.lastPromptPreview || '-')}</div>
          ${entityRows.length ? entityRows.join('') : '<div class="scope-section-note" style="margin-top:8px">No entity cache is currently available.</div>'}
        </div>
      `
    };
  };

  const buildPromptBundleForScope = async (context = {}, options = {}) => {
    const scopeId = normalizeText(options?.scopeId || resolveScopeId(context)) || 'global';
    const focusEntities = getFocusEntities(context, getSettings().maxPromptEntities);
    const rows = [];
    const touchedNames = [];
    for (const entity of focusEntities) {
      const core = await prepareEntityCore(entity, context, { scopeId });
      const memoryBundle = await queryEntityMemoryBundle(scopeId, entity, {
        queryText: [extractUserText(context), collectRecentWindowText(context, 4)].filter(Boolean).join('\n'),
        currentTurn: context?.turn || 0
      });
      const recall = RecallGraph.select(core, memoryBundle.queryText || extractUserText(context), {});
      core.memory.recallGraph.audit.lastInjectedIds = ensureArray(recall.ids).slice(0, 16);
      core.memory.recallGraph.audit.lastSelectedRefs = ensureArray(recall.refs).slice(0, 16);
      core.memory.recallGraph.audit.lastQuery = compactText(memoryBundle.queryText || extractUserText(context), 220);
      core.memory.recallGraph.audit.lastStatus = recall.ids.length ? `selected ${recall.ids.length} recall node(s)` : 'no recall hit';
      core.memory.recallGraph.audit.lastUpdated = Date.now();
      MindEngine.update(core, entity, {
        recentText: [extractUserText(context), collectRecentWindowText(context, 3)].filter(Boolean).join('\n'),
        memory: memoryBundle,
        recall
      });
      PsycheEngine.update(core, entity, {
        recentText: [extractUserText(context), collectRecentWindowText(context, 3)].filter(Boolean).join('\n'),
        memory: memoryBundle,
        recall
      }, context);
      const previewVerification = Verifier.investigate(core, entity, {
        recentText: [extractUserText(context), collectRecentWindowText(context, 3)].filter(Boolean).join('\n'),
        memory: memoryBundle,
        recall,
        context
      });
      core.verification.continuityLocks = uniqueTexts([
        ...ensureArray(core?.verification?.continuityLocks),
        ...ensureArray(previewVerification?.continuityLocks)
      ], 8);
      core.verification.predictions = uniqueTexts([
        ...ensureArray(core?.verification?.predictions),
        ...ensureArray(previewVerification?.predictions)
      ], 8);
      core.verification.opportunities = uniqueTexts([
        ...ensureArray(core?.verification?.opportunities),
        ...ensureArray(previewVerification?.opportunities)
      ], 8);
      runCharacterAlivenessPass(entity, core, context, {
        recentText: [extractUserText(context), collectRecentWindowText(context, 3)].filter(Boolean).join('\n'),
        memory: memoryBundle,
        recall
      }, core?.verification || {});
      refreshCompatibilityProjection(entity);
      rows.push(buildPromptRowForEntity(entity, core, recall, context));
      touchedNames.push(normalizeName(entity?.name || ''));
    }
    const section = buildUnifiedPromptSection(rows);
    const runtime = scopeRuntime.get(scopeId) || {};
    runtime.promptSection = section;
    runtime.promptRows = rows;
    runtime.promptBuiltAt = Date.now();
    runtime.promptTurnKey = buildTurnKey(context, scopeId);
    scopeRuntime.set(scopeId, runtime);
    runtimeState.lastPromptPreview = compactText(section?.text || '', 320);
    runtimeState.lastPromptCount = rows.length;
    return {
      scopeId,
      section,
      rows,
      touchedNames
    };
  };

  const finalizeEntityForTurn = async (scopeId = 'global', entity = {}, context = {}, directEntry = null, store = null) => {
    const core = await prepareEntityCore(entity, context, { scopeId });
    const recentText = [extractUserText(context), extractAssistantText(context), collectRecentWindowText(context, 4)].filter(Boolean).join('\n');
    const memoryBundle = await queryEntityMemoryBundle(scopeId, entity, {
      queryText: recentText,
      currentTurn: directEntry?.turn || context?.turn || 0
    });
    if (directEntry && mentionsEntity([directEntry.userText, directEntry.assistantText].filter(Boolean).join('\n'), entity)) {
      core.memory.dmaRefs.direct = uniqueTexts([...(core.memory.dmaRefs.direct || []), `direct:${directEntry.id}`], 64);
    }
    ensureArray(memoryBundle?.dmaRefs?.previous || []).forEach(ref => {
      core.memory.dmaRefs.previous = uniqueTexts([...(core.memory.dmaRefs.previous || []), ref], 64);
    });
    const recallIngest = RecallGraph.ingest(core, entity, directEntry, memoryBundle.previousEntries || []);
    const recall = RecallGraph.select(core, recentText, {});
    RecallGraph.decay(core, recall.ids || recallIngest.insertedIds || []);
    MindEngine.update(core, entity, {
      recentText,
      memory: memoryBundle,
      recall
    });
    PsycheEngine.update(core, entity, {
      recentText,
      memory: memoryBundle,
      recall
    }, context);
    mergeVerificationResultIntoCore(core, Verifier.investigate(core, entity, {
      recentText,
      memory: memoryBundle,
      recall,
      context
    }));
    mergeVerificationResultIntoCore(core, Verifier.compareAgainstResponse(core, entity, {
      responseText: extractAssistantText(context),
      recentText,
      memory: memoryBundle,
      recall,
      context
    }));
    try {
      const analysisResult = await maybeRunAnalysisProvider('finalize', entity, core, {
        ...context,
        analysisStage: 'finalize'
      }, {
        recentText,
        responseText: extractAssistantText(context),
        memory: memoryBundle,
        recall
      }, core?.verification || {});
      if (analysisResult) {
        mergeVerificationResultIntoCore(core, analysisResult);
      }
    } catch (error) {
      updateRuntimeStatus('analysis provider finalize pass failed', {
        scopeId,
        error: error?.message || String(error)
      });
    }
    runCharacterAlivenessPass(entity, core, context, {
      recentText,
      memory: memoryBundle,
      recall,
      responseText: extractAssistantText(context)
    }, core?.verification || {});
    const nextQueue = dedupePatchQueue(
      ensureArray(core?.verification?.patchQueue || []).map(normalizePatchItem).filter(item => item.status !== 'applied'),
      getSettings().patchQueueLimit
    );
    core.verification.patchQueue = nextQueue;
    const allowAutoApply = context?.autoApplyEntityCoreXPatches === true
      || getPluginCoordinator()?.getMode?.() === 'auto'
      || getSettings().analysisProvider.autoApply === true;
    if (allowAutoApply) {
      core.verification.patchQueue = nextQueue.map((patch) => {
        const verdict = Verifier.evaluatePatch(core, patch, {
          allowUnsafe: false
        });
        if (!verdict.apply) {
          return normalizePatchItem({
            ...patch,
            status: 'pending',
            conflict: verdict.reason,
            updatedAt: Date.now()
          });
        }
        return Verifier.applyPatch(core, patch);
      });
    }
    core.meta.lastTurnKey = buildTurnKey(context, scopeId);
    core.meta.lastUpdated = Date.now();
    entity.entityCoreX = normalizeEntityCoreX(entity, core);
    refreshCompatibilityProjection(entity);

    return entity.entityCoreX;
  };

  const runManualEntityAnalysis = async (entity = {}, context = {}, options = {}) => {
    const scopeId = normalizeText(options?.scopeId || resolveScopeId(context)) || 'global';
    const core = await prepareEntityCore(entity, context, { scopeId });
    const recentText = [
      extractUserText(context),
      extractAssistantText(context),
      collectRecentWindowText(context, 4),
      compactText(options?.recentText || '', 1200)
    ].filter(Boolean).join('\n');
    const memoryBundle = await queryEntityMemoryBundle(scopeId, entity, {
      queryText: recentText || [core?.identity?.name, core?.mind?.coreMind].filter(Boolean).join('\n'),
      currentTurn: context?.turn || 0,
      directLimit: options?.directLimit,
      previousLimit: options?.previousLimit
    });
    const recall = RecallGraph.select(core, recentText || memoryBundle.text || core?.identity?.name || '', {});
    MindEngine.update(core, entity, {
      recentText,
      memory: memoryBundle,
      recall
    });
    PsycheEngine.update(core, entity, {
      recentText,
      memory: memoryBundle,
      recall
    }, context);
    mergeVerificationResultIntoCore(core, Verifier.investigate(core, entity, {
      recentText,
      memory: memoryBundle,
      recall,
      context
    }));
    const analysisResult = await maybeRunAnalysisProvider('manual', entity, core, {
      ...context,
      analysisStage: 'manual'
    }, {
      recentText,
      responseText: extractAssistantText(context),
      memory: memoryBundle,
      recall
    }, core?.verification || {});
    if (analysisResult) mergeVerificationResultIntoCore(core, analysisResult);
    runCharacterAlivenessPass(entity, core, context, {
      recentText,
      responseText: extractAssistantText(context),
      memory: memoryBundle,
      recall
    }, core?.verification || {});
    core.verification.patchQueue = dedupePatchQueue(
      ensureArray(core?.verification?.patchQueue || []).map(normalizePatchItem).filter(item => item.status !== 'applied'),
      getSettings().patchQueueLimit
    );
    core.meta.lastUpdated = Date.now();
    entity.entityCoreX = normalizeEntityCoreX(entity, core);
    refreshCompatibilityProjection(entity);
    return {
      scopeId,
      core: cloneValue(entity.entityCoreX, createEmptyEntityCoreX(entity)),
      verification: cloneValue(core?.verification || {}, {}),
      analysisApplied: !!analysisResult
    };
  };

  const buildRepairPreviewMachine = (entity = {}, core = {}, patch = {}) => {
    const preview = cloneValue(entity, {});
    const previewCore = normalizeEntityCoreX(preview, preview?.entityCoreX || {});
    Verifier.applyPatch(previewCore, patch);
    preview.entityCoreX = previewCore;
    refreshCompatibilityProjection(preview);
    return preview;
  };

  const extension = {
    id: PLUGIN_ID,
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,

    async onLibraReady(context = {}) {
      const scopeId = resolveScopeId(context);
      runtimeState.activeScopeId = scopeId;
      await loadSettings();
      bindAnalysisProviderPanelHandlers();
      const host = getExtensionHost();
      if (host?.unregisterExtension) {
        LEGACY_PLUGIN_IDS.forEach((legacyId) => {
          try { host.unregisterExtension(legacyId); } catch (_) {}
        });
      }
      bindGlobalApis();
      updateRuntimeStatus('Entity Core X ready', { scopeId });
      try { console.log('[LIBRA SubPlugin: Entity Core X] ready'); } catch (_) {}
      return true;
    },

    entityCreateSection() {
      return renderEntityCoreCreateSection();
    },

    entityCardSection(context = {}) {
      return renderEntityCoreCardSection(context);
    },

    entityCreateMutator(context = {}) {
      const draft = context?.entityDraft && typeof context.entityDraft === 'object'
        ? context.entityDraft
        : {};
      syncHydrateEntityCore(draft);
      context.entityDraft = draft;
      return context.entityDraft;
    },

    entitySaveMutator(context = {}) {
      const draft = context?.entityDraft && typeof context.entityDraft === 'object'
        ? context.entityDraft
        : {};
      syncHydrateEntityCore(draft);
      context.entityDraft = draft;
      return context.entityDraft;
    },

    async beforeRequest(context = {}) {
      if (!getSettings().enabled) return 0;
      const scopeId = resolveScopeId(context);
      runtimeState.activeScopeId = scopeId;
      const bundle = await buildPromptBundleForScope(context, { scopeId });
      updateRuntimeStatus(`beforeRequest prompt prepared for ${bundle.rows.length} entit${bundle.rows.length === 1 ? 'y' : 'ies'}`, { scopeId });
      return bundle.rows.length;
    },

    async beforeRequestResponse(context = {}) {
      return capturePendingObservation(context, 'beforeRequestResponse');
    },

    async afterRequest(context = {}) {
      if (!getSettings().enabled) return 0;
      const scopeId = resolveScopeId(context);
      const runtime = scopeRuntime.get(scopeId) || {};
      runtime.observedTurnKey = buildTurnKey(context, scopeId);
      runtime.observedUserText = extractUserText(context);
      runtime.observedAssistantText = extractAssistantText(context);
      runtime.observedAt = Date.now();
      scopeRuntime.set(scopeId, runtime);
      await capturePendingObservation(context, 'afterRequest');
      updateRuntimeStatus('afterRequest observation captured', { scopeId });
      return 0;
    },

    async onFinalize(context = {}) {
      if (!getSettings().enabled) return 0;
      const scopeId = resolveScopeId(context);
      runtimeState.activeScopeId = scopeId;
      const finalized = await finalizeDirectCapture(context, 'finalize');
      const entityCache = getEntityCache(context);
      if (!(entityCache instanceof Map) || entityCache.size === 0) {
        runtimeState.lastFinalizedTurn = Math.max(0, Number(finalized?.entry?.turn || 0));
        updateRuntimeStatus('finalize committed to DMA store without entity cache', { scopeId });
        return finalized?.changed || 0;
      }
      const recentText = [extractUserText(context), extractAssistantText(context), collectRecentWindowText(context, 4)].filter(Boolean).join('\n');
      const focusEntities = [];
      entityCache.forEach((entity) => {
        if (!entity || typeof entity !== 'object') return;
        if (mentionsEntity(recentText, entity)) focusEntities.push(entity);
      });
      if (!focusEntities.length) focusEntities.push(...getFocusEntities(context, getSettings().maxPromptEntities));
      const changedNames = [];
      for (const entity of focusEntities) {
        await finalizeEntityForTurn(scopeId, entity, context, finalized?.entry || null, finalized?.store || null);
        changedNames.push(normalizeName(entity?.name || ''));
      }
      await syncChangedEntitiesToLorebook(context, changedNames);
      runtimeState.lastFinalizedTurn = Math.max(0, Number(finalized?.entry?.turn || 0));
      updateRuntimeStatus(`finalize committed for ${changedNames.length} entit${changedNames.length === 1 ? 'y' : 'ies'}`, { scopeId });
      return changedNames.length;
    },

    async onRecovery(context = {}) {
      return extension.rebuildExtensionState(context);
    },

    async onColdStart(context = {}) {
      return extension.rebuildExtensionState(context);
    },

    async onReanalyze(context = {}) {
      return extension.rebuildExtensionState(context);
    },

    async rebuildExtensionState(context = {}) {
      if (!getSettings().enabled) return 0;
      const scopeId = resolveScopeId(context);
      runtimeState.activeScopeId = scopeId;
      const entityCache = getEntityCache(context);
      if (!(entityCache instanceof Map) || entityCache.size === 0) return 0;
      const changedNames = [];
      for (const entity of Array.from(entityCache.values())) {
        if (!entity || typeof entity !== 'object') continue;
        const before = JSON.stringify(entity?.entityCoreX || {});
        const core = await prepareEntityCore(entity, context, { scopeId });
        const memoryBundle = await queryEntityMemoryBundle(scopeId, entity, {
          queryText: [core?.identity?.name, core?.mind?.coreMind].filter(Boolean).join('\n'),
          currentTurn: context?.turn || 0
        });
        RecallGraph.ingest(core, entity, null, memoryBundle.previousEntries || []);
        MindEngine.update(core, entity, {
          recentText: memoryBundle.text || '',
          memory: memoryBundle,
          recall: RecallGraph.select(core, memoryBundle.text || core?.identity?.name || '', {})
        });
        PsycheEngine.update(core, entity, {
          recentText: memoryBundle.text || '',
          memory: memoryBundle,
          recall: RecallGraph.select(core, memoryBundle.text || core?.identity?.name || '', {})
        }, context);
        mergeVerificationResultIntoCore(core, Verifier.investigate(core, entity, {
          recentText: memoryBundle.text || '',
          memory: memoryBundle,
          recall: RecallGraph.select(core, memoryBundle.text || core?.identity?.name || '', {}),
          context
        }));
        try {
          const rebuildRecall = RecallGraph.select(core, memoryBundle.text || core?.identity?.name || '', {});
          const analysisResult = await maybeRunAnalysisProvider('rebuild', entity, core, {
            ...context,
            analysisStage: 'rebuild'
          }, {
            recentText: memoryBundle.text || '',
            responseText: '',
            memory: memoryBundle,
            recall: rebuildRecall
          }, core?.verification || {});
          if (analysisResult) {
            mergeVerificationResultIntoCore(core, analysisResult);
          }
        } catch (error) {
          updateRuntimeStatus('analysis provider rebuild pass failed', {
            scopeId,
            error: error?.message || String(error)
          });
        }
        runCharacterAlivenessPass(entity, core, context, {
          recentText: memoryBundle.text || '',
          memory: memoryBundle,
          recall: RecallGraph.select(core, memoryBundle.text || core?.identity?.name || '', {})
        }, core?.verification || {});
        core.verification.patchQueue = dedupePatchQueue(
          ensureArray(core?.verification?.patchQueue || []).map(normalizePatchItem).filter(item => item.status !== 'applied'),
          getSettings().patchQueueLimit
        );
        core.meta.lastUpdated = Date.now();
        entity.entityCoreX = core;
        refreshCompatibilityProjection(entity);
        const after = JSON.stringify(entity?.entityCoreX || {});
        if (before !== after) changedNames.push(normalizeName(entity?.name || ''));
      }
      await syncChangedEntitiesToLorebook(context, changedNames);
      updateRuntimeStatus(`rebuild completed for ${changedNames.length} entit${changedNames.length === 1 ? 'y' : 'ies'}`, { scopeId });
      return changedNames.length;
    },

    async promptInjector(context = {}) {
      if (!getSettings().enabled || !getSettings().promptInjectionEnabled) return null;
      const scopeId = resolveScopeId(context);
      const runtime = scopeRuntime.get(scopeId) || {};
      if (runtime?.promptSection) return runtime.promptSection;
      const bundle = await buildPromptBundleForScope(context, { scopeId });
      return bundle.section || null;
    },

    async entityRepairProvider(context = {}) {
      const entity = context?.entity || null;
      if (!entity || typeof entity !== 'object') return null;
      const core = await prepareEntityCore(entity, context, { scopeId: resolveScopeId(context) });
      const recentText = [extractUserText(context), extractAssistantText(context), collectRecentWindowText(context, 4)].filter(Boolean).join('\n');
      if (recentText) {
        deriveNsfwState(entity, core, context, {
          recentText,
          memory: {
            text: recentText,
            previousEntries: []
          },
          recall: {
            highlights: []
          }
        }, core?.verification || {});
      }
      const patch = dedupePatchQueue([
        ...ensureArray(core?.verification?.patchQueue || []),
        ...ensureArray(core?.nsfw?.verification?.patchQueue || [])
      ], getSettings().patchQueueLimit)
        .map(normalizePatchItem)
        .sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0))[0];
      if (!patch) return null;
      const coordinatorProposal = reportCoordinatorPatchProposal(entity, patch, core);
      return {
        moduleId: PLUGIN_ID,
        title: 'LIBRA Entity Core X Patch Proposal',
        summary: compactText(patch.reason || 'Entity Core X patch proposal', 220),
        confidence: Number(patch.confidence || 0),
        patchConfidence: Number(patch.confidence || 0),
        evidenceRefs: ensureArray(patch.evidenceRefs || []).slice(0, 5),
        sourceKeys: [normalizeText(patch.sourceInvestigation || '')].filter(Boolean),
        patch: cloneValue(patch, {}),
        patchExampleMachine: buildPatchExampleMachine(core, patch),
        previewExampleMachine: buildRepairPreviewMachine(entity, core, patch),
        previewExampleSummary: compactText(patch.reason || 'Entity Core X preview', 220),
        coordinatorProposalId: normalizeText(coordinatorProposal?.proposalId || '')
      };
    },

    applyEntityRepairPatch(context = {}) {
      const entity = context?.entity || null;
      if (!entity || typeof entity !== 'object') return false;
      const core = normalizeEntityCoreX(entity, entity?.entityCoreX || {});
      const patch = context?.patch || context?.proposal?.patch || context?.report?.patch || null;
      if (!patch || typeof patch !== 'object') return false;
      const verdict = Verifier.evaluatePatch(core, patch, {
        allowUnsafe: context?.allowUnsafe === true
      });
      if (!verdict.apply) {
        updatePatchQueueItem(core, patch, {
          status: 'rejected',
          conflict: verdict.reason
        });
        entity.entityCoreX = normalizeEntityCoreX(entity, core);
        refreshCompatibilityProjection(entity);
        reportCoordinatorRuntime({
          status: `patch rejected:${verdict.reason}`,
          entityName: normalizeName(entity?.name || ''),
          domain: 'entity'
        });
        return false;
      }
      const applied = Verifier.applyPatch(core, patch);
      updatePatchQueueItem(core, applied, {
        status: 'applied',
        conflict: ''
      });
      entity.entityCoreX = normalizeEntityCoreX(entity, core);
      refreshCompatibilityProjection(entity);
      reportCoordinatorRuntime({
        status: 'patch applied',
        entityName: normalizeName(entity?.name || ''),
        domain: 'entity',
        targetPath: normalizeText(applied?.targetPath || '')
      });
      return true;
    },

    quickControlPanel(context = {}) {
      return renderQuickControlPanel(context);
    },

    inspectorPanel(context = {}) {
      return renderInspectorPanel(context);
    },

    async cleanup() {
      scopeRuntime.clear();
      storeCache.clear();
      if (typeof document !== 'undefined' && analysisPanelHandlersBound) {
        try { document.removeEventListener('click', analysisPanelClickHandler, true); } catch (_) {}
        try { document.removeEventListener('change', analysisPanelChangeHandler, true); } catch (_) {}
        try { document.removeEventListener('input', analysisPanelInputHandler, true); } catch (_) {}
      }
      analysisPanelHandlersBound = false;
      analysisPanelInputHandler = null;
      analysisPanelChangeHandler = null;
      analysisPanelClickHandler = null;
      if (coreSettingsPanelAutoSaveTimer) clearTimeout(coreSettingsPanelAutoSaveTimer);
      coreSettingsPanelAutoSaveTimer = null;
      if (typeof document !== 'undefined' && corexDmaActionHandlersBound) {
        try { document.removeEventListener('click', corexDmaActionClickHandler, true); } catch (_) {}
      }
      corexDmaActionHandlersBound = false;
      corexDmaActionClickHandler = null;
      try { getPluginCoordinator()?.clearPlugin?.(PLUGIN_ID); } catch (_) {}
      try { delete globalThis.LIBRA_EntityCoreX; } catch (_) {}
      try { delete globalThis.LIBRA_EntityCoreXAPI; } catch (_) {}
      try { delete globalThis.LIBRA_EntityCoreX_SubPlugin; } catch (_) {}
    }
  };

  const bindGlobalApis = () => {
    const buildStandardEntityGuidance = (entity = {}, core = {}, context = {}) => {
      const normalizedCore = normalizeEntityCoreX(entity, core || {});
      const dynamic = normalizedCore?.psyche?.dynamic || {};
      const emotionBridge = normalizeEmotionBridgeState(normalizedCore?.psyche?.emotionBridge || {});
      const relationFocus = deriveRelationFocus(normalizedCore?.psyche?.relations || {});
      const emotionIntensity = clampNumber(emotionBridge?.intensity || dynamic?.emotionalPressure, 0.15, 0, 1);
      const confidence = clampNumber(
        Math.max(
          Number(emotionBridge?.confidence || 0),
          Number(relationFocus?.confidence || 0),
          Number(normalizedCore?.memory?.confidence || 0.62)
        ),
        0.62,
        0,
        1
      );
      return {
        entityDossier: {
          entityId: normalizeName(entity?.id || entity?.name || normalizedCore?.identity?.name || ''),
          name: normalizeName(entity?.name || normalizedCore?.identity?.name || ''),
          summary: compactText(normalizedCore?.mind?.coreMind || normalizedCore?.identity?.summary || '', 420)
        },
        continuityLocks: ensureArray(normalizedCore?.verification?.continuityLocks || []).slice(0, 6),
        recallHighlights: ensureArray(normalizedCore?.memory?.recallHighlights || normalizedCore?.memory?.evidenceRefs || []).slice(0, 6),
        branchState: cloneValue(normalizedCore?.mind?.branches || {}, {}),
        emotionState: {
          entityId: normalizeName(entity?.name || normalizedCore?.identity?.name || ''),
          turn: Number(context?.turn || context?.currentTurn || 0),
          surface: {
            primary: compactText(emotionBridge?.mood || emotionBridge?.signature || dynamic?.activeMode || '', 80),
            secondary: compactText(emotionBridge?.blend || '', 120),
            intensity: emotionIntensity,
            confidence
          },
          latent: {
            primary: compactText(dynamic?.activeMode || '', 80),
            secondary: compactText(normalizedCore?.continuity?.emotionSummary || '', 120),
            intensity: clampNumber(dynamic?.emotionalPressure, emotionIntensity, 0, 1),
            confidence
          },
          trigger: {
            source: compactText(emotionBridge?.source || '', 80),
            text: compactText(emotionBridge?.summary || summarizeCoreEmotionDigest(entity, normalizedCore), 220),
            relatedBranch: ''
          },
          defense: {
            type: compactText(dynamic?.activeMode || '', 80),
            mask: compactText(normalizedCore?.mind?.branches?.mask?.summary || '', 120),
            strength: clampNumber(dynamic?.maskStrength, 0.5, 0, 1)
          },
          regulation: {
            state: dynamic?.emotionalPressure >= 0.7 ? 'strained' : 'regulated',
            stability: clampNumber(1 - Number(dynamic?.emotionalPressure || 0.15), 0.65, 0, 1),
            collapseRisk: clampNumber((Number(dynamic?.fear || 0) + Number(dynamic?.anger || 0) + Number(dynamic?.shame || 0)) / 3, 0, 0, 1)
          },
          expression: {
            channels: uniqueTexts([emotionBridge?.signature, dynamic?.activeMode, normalizedCore?.expression?.styleSummary], 5),
            actorHints: uniqueTexts([normalizedCore?.expression?.actorHints, normalizedCore?.continuity?.emotionSummary], 5)
          },
          relationshipPressure: {
            attraction: clampNumber(dynamic?.longing || 0, 0, 0, 1),
            distrust: clampNumber(1 - Number(dynamic?.trust || 0.5), 0.5, 0, 1),
            attachment: clampNumber(dynamic?.trust || 0.5, 0.5, 0, 1),
            avoidance: clampNumber(dynamic?.fear || dynamic?.maskStrength || 0, 0, 0, 1),
            jealousy: clampNumber(dynamic?.jealousy || 0, 0, 0, 1),
            fearOfLoss: clampNumber(dynamic?.fear || 0, 0, 0, 1)
          },
          genreAffectSignals: {
            romance: clampNumber(dynamic?.longing || 0, 0, 0, 1),
            psychological: emotionIntensity,
            relationship_drama: clampNumber((emotionIntensity + Math.abs(Number(dynamic?.trust || 0.5) - 0.5)) / 1.5, 0, 0, 1),
            tragedy: clampNumber((Number(dynamic?.shame || 0) + Number(dynamic?.sadness || 0)) / 2, 0, 0, 1),
            comedy: clampNumber(emotionBridge?.flags?.joy ? emotionIntensity : 0, 0, 0, 1),
            mystery: 0,
            thriller: clampNumber(Number(dynamic?.fear || 0), 0, 0, 1),
            confrontation: clampNumber(Number(dynamic?.anger || 0), 0, 0, 1)
          },
          styleAffectSignals: {
            emotionalIntensity: emotionIntensity,
            introspection: clampNumber(emotionIntensity * 0.8, 0, 0, 1),
            darkness: clampNumber((Number(dynamic?.fear || 0) + Number(dynamic?.shame || 0)) / 2, 0, 0, 1),
            humor: clampNumber(emotionBridge?.flags?.joy ? 0.35 : 0, 0, 0, 1),
            actionPace: clampNumber(Number(emotionBridge?.arousal || 0) * 0.6, 0, 0, 1)
          },
          confidence
        },
        relationshipPressure: relationFocus || {},
        patchProposals: ensureArray(normalizedCore?.verification?.patchQueue || []).filter(item => item?.status !== 'applied').slice(0, 8),
        contradictionWarnings: ensureArray(normalizedCore?.verification?.recentInvestigations || []).filter(item => /conflict|contradict|충돌|모순/i.test(String(item?.result || item?.answer || ''))).slice(0, 6),
        genreAffectSignals: {
          romance: clampNumber(dynamic?.longing || 0, 0, 0, 1),
          psychological: emotionIntensity,
          relationship_drama: clampNumber((emotionIntensity + Math.abs(Number(dynamic?.trust || 0.5) - 0.5)) / 1.5, 0, 0, 1),
          tragedy: clampNumber((Number(dynamic?.shame || 0) + Number(dynamic?.sadness || 0)) / 2, 0, 0, 1),
          comedy: clampNumber(emotionBridge?.flags?.joy ? emotionIntensity : 0, 0, 0, 1),
          mystery: 0,
          thriller: clampNumber(Number(dynamic?.fear || 0), 0, 0, 1),
          confrontation: clampNumber(Number(dynamic?.anger || 0), 0, 0, 1)
        },
        styleAffectSignals: {
          emotionalIntensity: emotionIntensity,
          introspection: clampNumber(emotionIntensity * 0.8, 0, 0, 1),
          darkness: clampNumber((Number(dynamic?.fear || 0) + Number(dynamic?.shame || 0)) / 2, 0, 0, 1),
          humor: clampNumber(emotionBridge?.flags?.joy ? 0.35 : 0, 0, 0, 1),
          actionPace: clampNumber(Number(emotionBridge?.arousal || 0) * 0.6, 0, 0, 1)
        },
        confidence
      };
    };
    const buildEntityAuditReport = async (context = {}) => {
      const scopeId = resolveScopeId(context);
      await importStoreFromCopiedChatIfNeeded(context, scopeId);
      const store = await loadStore(scopeId);
      const entityRows = [];
      const staleDossiers = [];
      const evidenceGaps = [];
      const contradictionWarnings = [];
      const unsafePatchProposals = [];
      const lowConfidenceInjections = [];
      const legacyOnlyFacts = [];
      let dmaLinkedFacts = 0;
      getEntityCache(context).forEach((entity) => {
        if (!entity || typeof entity !== 'object') return;
        const name = normalizeName(entity?.name || entity?.id || '');
        const core = normalizeEntityCoreX(entity, entity?.entityCoreX || {});
        const refs = uniqueTexts([
          ...(ensureArray(core?.memory?.evidenceRefs || [])),
          ...(ensureArray(core?.memory?.dmaRefs?.direct || [])),
          ...(ensureArray(core?.memory?.dmaRefs?.previous || [])),
          ...(ensureArray(core?.verification?.evidenceRefs || []))
        ], 24);
        const directRefs = refs.filter(ref => /^direct[:/]/i.test(String(ref || '')));
        const previousRefs = refs.filter(ref => /^previous[:/]/i.test(String(ref || '')));
        const hasDmaRefs = directRefs.length > 0 || previousRefs.length > 0;
        const confidence = clampNumber(
          Math.max(
            Number(core?.memory?.confidence || 0),
            Number(core?.verification?.confidence || 0),
            Number(core?.psyche?.emotionBridge?.confidence || 0)
          ),
          0,
          0,
          1
        );
        const patchQueue = ensureArray(core?.verification?.patchQueue || []);
        const unsafePatches = patchQueue.filter((patch) => {
          const status = normalizeText(patch?.status || '').toLowerCase();
          const action = normalizeText(patch?.action || patch?.mode || '').toLowerCase();
          const score = Number(patch?.confidence || patch?.score || 0);
          return status === 'applied' || action.includes('overwrite') || score >= 0.92;
        });
        const conflicts = ensureArray(core?.verification?.recentInvestigations || [])
          .filter(item => /conflict|contradict|retcon|모순|충돌|정정|overwrite/i.test(String(item?.result || item?.answer || item?.status || item || '')));
        if (!hasDmaRefs && (core?.mind?.coreMind || core?.continuity?.summary || core?.psyche?.dynamic?.currentGoal)) {
          evidenceGaps.push({ entity: name, reason: 'entity_guidance_without_dma_refs' });
          legacyOnlyFacts.push({ entity: name, reason: 'legacy_or_inferred_only' });
        }
        if (!core?.mind?.coreMind && !core?.identity?.summary) {
          staleDossiers.push({ entity: name, reason: 'missing_compact_dossier' });
        }
        if (confidence > 0 && confidence < 0.45) {
          lowConfidenceInjections.push({ entity: name, confidence });
        }
        unsafePatches.forEach(patch => unsafePatchProposals.push({
          entity: name,
          targetPath: compactText(patch?.targetPath || patch?.path || '', 120),
          status: compactText(patch?.status || '', 40),
          confidence: Number(patch?.confidence || patch?.score || 0)
        }));
        conflicts.forEach(item => contradictionWarnings.push({
          entity: name,
          summary: compactText(item?.result || item?.answer || item?.status || String(item || ''), 180)
        }));
        if (hasDmaRefs) dmaLinkedFacts += refs.length;
        entityRows.push({
          name,
          confidence,
          dmaRefs: refs.length,
          directRefs: directRefs.length,
          previousRefs: previousRefs.length,
          patchQueue: patchQueue.length,
          conflicts: conflicts.length
        });
      });
      const report = {
        ok: true,
        source: 'entity_core_x_audit',
        scopeId,
        checkedEntities: entityRows.length,
        staleDossiers,
        evidenceGaps,
        contradictionWarnings,
        unsafePatchProposals,
        lowConfidenceInjections,
        dmaLinkedFacts,
        legacyOnlyFacts,
        recommendedRepairs: uniqueTexts([
          evidenceGaps.length ? 'rebuild_entity_dossier_from_dma_evidence' : '',
          unsafePatchProposals.length ? 'route_patch_queue_through_canon_change_gate' : '',
          contradictionWarnings.length ? 'keep_conflicts_as_warnings_until_v4_arbitration' : '',
          staleDossiers.length ? 'refresh_compact_entity_dossier' : ''
        ], 8),
        degradedEvidenceMode: !getDirectMemoryArchiveApi(),
        storeCounts: {
          directEntries: ensureArray(store?.directEntries || []).length,
          previousEntries: ensureArray(store?.previousEntries || []).length,
          pendingCaptures: ensureArray(store?.pendingCaptures || []).length,
          repairQueue: ensureArray(store?.repairQueue || []).length
        },
        entities: entityRows.slice(0, 24),
        confidence: entityRows.length > 0
          ? clampNumber(1 - ((evidenceGaps.length + contradictionWarnings.length + unsafePatchProposals.length) / Math.max(1, entityRows.length * 3)), 0.72, 0, 1)
          : 0.35,
        ranAt: Date.now()
      };
      updateRuntimeStatus(`Entity audit complete · checked ${report.checkedEntities} · warnings ${report.evidenceGaps.length + report.contradictionWarnings.length + report.unsafePatchProposals.length}`, {
        scopeId,
        audit: report
      });
      reportCoordinatorRuntime({
        status: 'entity audit complete',
        domain: 'entity',
        activeScopeId: scopeId,
        evidenceSource: getDirectMemoryArchiveApi() ? 'dma' : 'fallback',
        degradedEvidenceMode: !getDirectMemoryArchiveApi(),
        verifierStatus: contradictionWarnings.length ? 'warnings' : 'ok',
        patchQueueCount: unsafePatchProposals.length,
        emotionStatus: lowConfidenceInjections.length ? 'low_confidence' : 'ok'
      });
      return report;
    };

    globalThis.LIBRA_EntityCoreX = {
      version: PLUGIN_VERSION,
      settings: () => cloneValue(getSettings(), DEFAULT_SETTINGS),
      async setSettings(patch = {}) {
        return cloneValue(await setSettingsPatch(patch), DEFAULT_SETTINGS);
      },
      async configureAnalysisProvider(config = {}) {
        const current = getSettings().analysisProvider || normalizeAnalysisProviderSettings({});
        return cloneValue(await setSettingsPatch({
          analysisProvider: {
            ...current,
            ...(config || {})
          }
        }), DEFAULT_SETTINGS);
      },
      async saveAnalysisProviderFromPanel(trigger = null, explicitSave = false) {
        const root = getAnalysisProviderPanelRoot(trigger);
        if (!root) return false;
        const analysisProvider = readAnalysisProviderSettingsFromPanel(root);
        const saved = await setSettingsPatch({ analysisProvider });
        writeAnalysisProviderSettingsToPanel(root, saved.analysisProvider || {});
        syncAnalysisProviderPanelPreview(root, saved.analysisProvider || {}, 'Analysis provider settings saved.');
        if (explicitSave) notifyEntityCoreXToast('💾 Entity Core X analysis settings saved');
        return cloneValue(saved, DEFAULT_SETTINGS);
      },
      async resetAnalysisProviderPanel(trigger = null) {
        const root = getAnalysisProviderPanelRoot(trigger);
        const defaults = normalizeAnalysisProviderSettings(DEFAULT_SETTINGS.analysisProvider || {});
        const saved = await setSettingsPatch({ analysisProvider: defaults });
        if (root) {
          writeAnalysisProviderSettingsToPanel(root, saved.analysisProvider || defaults);
          syncAnalysisProviderPanelPreview(root, saved.analysisProvider || defaults, 'Analysis provider reset to defaults.');
        }
        notifyEntityCoreXToast('Entity Core X analysis settings reset');
        return cloneValue(saved, DEFAULT_SETTINGS);
      },
      async rebuildScope(context = {}) {
        return extension.rebuildExtensionState(context);
      },
      async ensureEntity(entity = {}, context = {}) {
        return cloneValue(await prepareEntityCore(entity, context, { scopeId: resolveScopeId(context) }), createEmptyEntityCoreX(entity));
      },
      async getGuidance(entity = {}, context = {}) {
        const core = await prepareEntityCore(entity, context, { scopeId: resolveScopeId(context) });
        return cloneValue(buildStandardEntityGuidance(entity, core, context), null);
      },
      async buildPromptBundle(context = {}) {
        return cloneValue(await buildPromptBundleForScope(context, { scopeId: resolveScopeId(context) }), null);
      },
      async loadVerifierArchive(options = {}) {
        return cloneValue(await buildVerificationArchiveProjection(options?.context || options, options), []);
      },
      async loadStore(options = {}) {
        const scopeId = resolveScopeId(options);
        await importStoreFromCopiedChatIfNeeded(options, scopeId);
        return cloneValue(await loadStore(scopeId), buildEmptyStore(scopeId));
      },
      async exportScopeStore(options = {}) {
        const scopeId = resolveScopeId(options);
        await importStoreFromCopiedChatIfNeeded(options, scopeId);
        return cloneValue(await loadStore(scopeId), buildEmptyStore(scopeId));
      },
      async importFromCopiedChat(options = {}) {
        const targetScopeId = normalizeText(options?.targetScopeId || options?.scopeId || options?.chat?.id || runtimeState.activeScopeId || 'global') || 'global';
        const sourceScopeId = normalizeText(options?.sourceScopeId || options?.copiedFromScopeId || options?.sourceChatId || options?.copiedFromChatId || '');
        return importStoreFromCopiedChatIfNeeded({
          ...options,
          scopeId: targetScopeId,
          copiedFromScopeId: sourceScopeId,
          sourceScopeId
        }, targetScopeId);
      },
      async importScopeStore(options = {}) {
        const scopeId = resolveScopeId(options);
        const mode = normalizeText(options?.mode || 'merge').toLowerCase();
        if (mode === 'replace') {
          return cloneValue(await commitStore(scopeId, normalizeStore(options?.store || {}, scopeId)), buildEmptyStore(scopeId));
        }
        const current = await loadStore(scopeId);
        const incoming = normalizeStore(options?.store || {}, scopeId);
        const mergeByKey = (items = [], keyFn = null) => {
          const map = new Map();
          ensureArray(items).forEach((item) => {
            const key = normalizeText(typeof keyFn === 'function' ? keyFn(item) : JSON.stringify(item));
            if (!key) return;
            map.set(key, item);
          });
          return Array.from(map.values());
        };
        current.directEntries = mergeByKey([
          ...ensureArray(current.directEntries),
          ...ensureArray(incoming.directEntries)
        ], entry => normalizeText(entry?.id || entry?.signature || entry?.sourceHash || JSON.stringify(entry))).slice(-getSettings().maxDirectEntries);
        current.previousEntries = mergeByKey([
          ...ensureArray(current.previousEntries),
          ...ensureArray(incoming.previousEntries)
        ], entry => normalizeText(entry?.id || entry?.archiveKey || JSON.stringify(entry))).slice(-getSettings().maxPreviousEntries);
        current.pendingCaptures = mergeByKey([
          ...ensureArray(current.pendingCaptures),
          ...ensureArray(incoming.pendingCaptures)
        ], entry => normalizeText(entry?.id || entry?.signature || JSON.stringify(entry))).slice(-getSettings().maxPendingCaptures);
        current.repairQueue = mergeByKey([
          ...ensureArray(current.repairQueue),
          ...ensureArray(incoming.repairQueue)
        ], entry => normalizeText(entry?.id || entry?.targetPath || JSON.stringify(entry))).slice(-getSettings().maxRepairQueue);
        updateRuntimeStatus(`Scope store imported · ${scopeId}`, { scopeId, mode });
        return cloneValue(await commitStore(scopeId, current), buildEmptyStore(scopeId));
      },
      async ingestTurn(context = {}) {
        const scopeId = resolveScopeId(context);
        const finalized = await finalizeDirectCapture(context, 'manual-ingest');
        return {
          scopeId,
          changed: finalized?.changed || 0,
          entry: cloneValue(finalized?.entry || null, null)
        };
      },
      async analyzeEntity(entity = {}, context = {}, options = {}) {
        return cloneValue(await runManualEntityAnalysis(entity, context, options), null);
      },
      async receiveBootstrapSeed(bundle = {}, context = {}) {
        const scopeId = resolveScopeId(context || bundle || {});
        const entitySeeds = ensureArray(bundle?.entitySeedProposals || []);
        const relationSeeds = ensureArray(bundle?.relationSeedProposals || []);
        runtimeState.lastBootstrapSeed = {
          source: normalizeText(bundle?.source || 'bootstrap'),
          scopeId,
          entitySeedProposals: entitySeeds.length,
          relationSeedProposals: relationSeeds.length,
          confidence: clampNumber(bundle?.confidence, 0.55, 0, 1),
          receivedAt: Date.now()
        };
        updateRuntimeStatus(`Bootstrap seed received · entities ${entitySeeds.length} · relations ${relationSeeds.length}`, {
          scopeId,
          bootstrapSeed: runtimeState.lastBootstrapSeed
        });
        reportCoordinatorRuntime({
          status: 'bootstrap seed received',
          domain: 'entity',
          activeScopeId: scopeId,
          evidenceSource: 'bootstrap_seed',
          degradedEvidenceMode: !getDirectMemoryArchiveApi(),
          patchQueueCount: entitySeeds.length + relationSeeds.length,
          emotionStatus: 'seed_only'
        });
        return cloneValue({
          ok: true,
          scopeId,
          acceptedAs: 'seed_proposal',
          entitySeedProposals: entitySeeds.length,
          relationSeedProposals: relationSeeds.length
        }, null);
      },
      async runAudit(context = {}) {
        return cloneValue(await buildEntityAuditReport(context), null);
      },
      async selfCheck() {
        const scopeId = normalizeText(runtimeState.activeScopeId || 'global') || 'global';
        return {
          ok: true,
          api: 'LIBRA_EntityCoreXAPI',
          entityStoreKey: getStoreKey(scopeId),
          dmaOwnership: 'consumer-readonly',
          dmaApiAvailable: !!getDmaApi(),
          writesDmaStorage: false,
          runtime: cloneValue(runtimeState, {})
        };
      },
      async getScopeDebugSnapshot(context = {}) {
        const scopeId = resolveScopeId(context);
        const store = await loadStore(scopeId);
        const entities = [];
        getEntityCache(context).forEach((entity) => {
          if (!entity || typeof entity !== 'object') return;
          const core = normalizeEntityCoreX(entity, entity?.entityCoreX || {});
          const relationFocus = deriveRelationFocus(core?.psyche?.relations || {});
          entities.push({
            name: normalizeName(entity?.name || ''),
            coreMind: compactText(core?.mind?.coreMind || '', 120),
            currentGoal: compactText(core?.psyche?.dynamic?.currentGoal || '', 120),
            activeMode: compactText(core?.psyche?.dynamic?.activeMode || '', 60),
            recallNodes: Object.keys(core?.memory?.recallGraph?.nodes || {}).length,
            relationFocus: relationFocus?.target || ''
          });
        });
        return {
          scopeId,
          store: buildCoreMemorySnapshotSync(store, { scopeId }),
          entities
        };
      }
    };
    globalThis.LIBRA_EntityCoreXAPI = globalThis.LIBRA_EntityCoreX;
    globalThis.LIBRA_EntityCoreX_SubPlugin = extension;
    globalThis.__LIBRA_ENTITY_COREX_RUNTIME__ = extension;
    globalThis.LIBRA = globalThis.LIBRA || {};
    globalThis.LIBRA.EntityCoreX = globalThis.LIBRA_EntityCoreX;
  };

  const register = () => {
    try {
      globalThis.__LIBRA_ENTITY_COREX_RUNTIME__?.cleanup?.();
    } catch (_) {}
    bindGlobalApis();
    bindCorexDmaActionHandlers();
    const host = getExtensionHost();
    if (host?.unregisterExtension) {
      try { host.unregisterExtension(PLUGIN_ID); } catch (_) {}
    }
    if (host?.registerExtension) host.registerExtension(extension);
    else {
      globalThis.LIBRA_SubPlugins = Array.isArray(globalThis.LIBRA_SubPlugins) ? globalThis.LIBRA_SubPlugins : [];
      globalThis.LIBRA_SubPlugins = globalThis.LIBRA_SubPlugins.filter(item => String(item?.id || '') !== PLUGIN_ID);
      globalThis.LIBRA_SubPlugins.push(extension);
    }
  };

  register();
})();
