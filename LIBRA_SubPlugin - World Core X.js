//@name libra_world_core_x
//@display-name LIBRA World Core X
//@author rusinus12@gmail.com
//@api 3.0
//@version 0.2.0

(function () {
  /**
   * LIBRA World Core X
   *
   * World continuity coprocessor. Observes and compresses setting ontology,
   * world rules, factions, regions, offscreen threads, genre/tone weights,
   * and propagation risks. It recommends world pressure hints only.
   * LIBRA World Manager / V4 Narrative Core X remains the final orchestration
   * and injection authority.
   */

  try {
    window.__LIBRA_WORLD_CORE_X_RUNTIME__?.cleanup?.();
  } catch (_) {}
  try {
    if (typeof window !== 'undefined') {
      delete window.LIBRA_WorldCoreXAPI;
      delete window.LIBRA_DyListCoreAPI;
      if (window.LIBRA?.WorldCoreX) delete window.LIBRA.WorldCoreX;
    }
  } catch (_) {}
  const PLUGIN_ID = 'libra.world.corex';
  const PLUGIN_NAME = 'LIBRA World Core X';
  const PLUGIN_VERSION = '0.2.0';
  const LOG_PREFIX = '[LIBRA SubPlugin: World Core X]';
  const STORAGE_KEY = 'LIBRA_SubPlugin_WorldCoreX_v1';
  let dylistPanelClickHandler = null;
  let dylistPanelChangeHandler = null;
  let dylistPanelInputHandler = null;
  let analysisPanelClickHandler = null;
  let analysisPanelChangeHandler = null;
  let analysisPanelInputHandler = null;
  let analysisPanelHandlersBound = false;
  let analysisPanelAutoSaveTimer = null;
  const dylistFallbackPopoverStates = new Map();
  const COPILOT_CODE_VERSION = '1.85.0';
  const COPILOT_CHAT_VERSION = '0.22.0';
  const COPILOT_USER_AGENT = `GitHubCopilotChat/${COPILOT_CHAT_VERSION}`;
  const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';
  let copilotTokenCache = '';
  let copilotTokenExpiry = 0;

  let storagePromise = null;
  let persistedState = null;
  let persistScheduled = false;
  const ANALYSIS_PROVIDER_FAILURE_LIMIT = 10;
  const runtimeState = {
    activeChatId: 'global',
    lastStatus: '대기 중',
    lastChangedCount: 0,
    analysisFailureCount: 0,
    analysisFailureLimit: ANALYSIS_PROVIDER_FAILURE_LIMIT,
    analysisFailureMessage: '',
    lastBootstrapSeed: null
  };

  const DEFAULT_SETTINGS = {
    maxHistoryItems: 18,
    maxDisplayHistory: 6,
    maxRecentHistory: 12,
    maxWorldHistoryItems: 10,
    maxWorldSignalItems: 4,
    showGroupAxisDescriptions: true,
    dlMaleTrack: true,
    dlCharTrackLimit: 0,
    bgListMode: 'off',
    bgScope: 'recently_exited',
    bgContextMode: 'indirect',
    worldPromptMode: 'balanced',
    worldPromptDensity: 'balanced',
    worldDossierMode: 'focused',
    trackWorldSignals: true,
    trackStructuralWorld: true,
    offscreenThreadStrength: 'balanced',
    factionEmphasis: 'balanced',
    regionAwareness: true,
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
      maxEvidenceRefs: 16,
      maxEvidenceSnippets: 8,
      autoApply: false,
      debug: false
    },
    historyTemplates: {
      REGISTER: '⌂HISLABEL⌂ · ⌂HISDESC⌂',
      STATUS: '⌂HISLABEL⌂ · ⌂HISDESC⌂',
      ACT: '⌂HISDESC⌂',
      GROUPSET: '⌂HISLABEL⌂ · ⌂HISROLE⌂ · ⌂HISSTYLE⌂ · ⌂HISMEMBERS⌂',
      GROUPCHANGE: '⌂HISLABEL⌂ · ⌂HISROLE⌂ · ⌂HISSTYLE⌂ · ⌂HISMEMBERS⌂'
    },
    groupAxisDescriptions: {
      SYSTEM: ['의사결정 중심성', '통제 밀도', '내부 전달력'],
      CAPABILITIES: ['정보 수집력', '행동 수행력', '상황 장악력'],
      LIFESPAN: ['도덕 유지력', '내부 결속력', '장기 지속성'],
      SIZE: ['규모 체감치', '영향력 범위', '팽창 가능성'],
      MEMBERSHIP: ['소속 응집력', '개별 자율성', '구성 안정성']
    }
  };
  const HISTORY_PROFILES = {
    compact: {
      maxHistoryItems: 12,
      maxDisplayHistory: 4,
      maxRecentHistory: 8
    },
    standard: {
      maxHistoryItems: 18,
      maxDisplayHistory: 6,
      maxRecentHistory: 12
    },
    expanded: {
      maxHistoryItems: 24,
      maxDisplayHistory: 8,
      maxRecentHistory: 16
    }
  };
  const TRACK_LIMIT_PRESETS = {
    unlimited: 0,
    focused: 4,
    tight: 2
  };
  const HISTORY_PROFILE_DESCRIPTIONS = {
    compact: '히스토리 버퍼와 표시 수를 줄여서 더 가볍게 추적합니다.',
    standard: '기본 균형형 설정입니다. 대부분의 장면에서 무난하게 동작합니다.',
    expanded: '최근 기록과 표시 범위를 넓혀 더 많은 흐름을 붙잡습니다.',
    custom: '프리셋이 아닌 수동 수치가 적용된 상태입니다.'
  };
  const TRACK_SCOPE_DESCRIPTIONS = {
    unlimited: '등장 인물 수를 제한하지 않고 가능한 범위를 모두 추적합니다.',
    focused: '중요 인물 위주로 적당히 압축해서 추적합니다.',
    tight: '핵심 인물만 아주 좁게 추적해 노이즈를 줄입니다.',
    custom: '프리셋이 아닌 수동 추적 수가 적용된 상태입니다.'
  };
  const QUICK_TOGGLE_DESCRIPTIONS = {
    showGroupAxisDescriptions: '단체/세력 축 설명을 함께 보여줘 해석을 쉽게 합니다.',
    dlMaleTrack: '남성 캐릭터도 중요 대상으로 적극 포함해 인물 추적 범위를 넓힙니다.'
  };
  const BG_MODE_DESCRIPTIONS = {
    off: '장면 밖 인물/그룹을 별도로 추적하지 않습니다.',
    main: '장면 밖 후보를 메인 continuity 힌트처럼 강하게 주입합니다.',
    aux: '장면 밖 후보를 보조 continuity 힌트로 가볍게 주입합니다.'
  };
  const BG_SCOPE_DESCRIPTIONS = {
    mentioned_untracked: '현재 장면에서 언급됐지만 아직 DyList에 충분히 잡히지 않은 후보를 우선 봅니다.',
    recently_exited: '직전 장면까지 등장했지만 이번 장면에 없는 인물/그룹을 우선 추적합니다.',
    current_location: '현재 장소와 같은 범위에 있다고 볼 수 있는 장면 밖 후보를 우선 추적합니다.',
    current_country: '현재 국가/권역이 같아 보이는 장면 밖 후보를 우선 추적합니다.',
    unrestricted: '장소 제한 없이 장면 밖 후보를 넓게 추적합니다.',
    random: '장면 밖 후보 중 일부를 무작위에 가깝게 고릅니다.'
  };
  const BG_CONTEXT_DESCRIPTIONS = {
    direct: '현재 장면과 직접 이어질 만한 오프스크린 상황만 우선 다룹니다.',
    indirect: '현재 장면과 간접적으로 연결되는 장면 밖 상황까지 포함합니다.',
    time_shared: '현재와 같은 시간대이지만 전혀 다른 맥락의 장면 밖 상황도 허용합니다.',
    random: '맥락 연결보다 다양성을 우선해 장면 밖 후보를 고릅니다.'
  };
  const WORLD_PROMPT_MODE_DESCRIPTIONS = {
    light: '월드 압력은 짧은 보조 힌트로만 넣고, 인물 요약을 우선합니다.',
    balanced: '장면 압력, carryover, world limits를 균형 있게 함께 넣습니다.',
    heavy: '월드 압력과 장면 밖 흐름을 강하게 강조해 서사 continuity를 우선합니다.'
  };
  const WORLD_DOSSIER_MODE_DESCRIPTIONS = {
    off: '엔티티 dossier / codex 류 신호를 별도로 추적하지 않습니다.',
    focused: '가장 중요한 scene pressure / carryover / world limit 위주로 압축합니다.',
    expanded: 'dossier, codex, relation, carryover 신호를 더 넓게 수집합니다.'
  };
  const WORLD_PROMPT_DENSITY_DESCRIPTIONS = {
    light: '기존 월드 continuity 수준을 크게 넘기지 않고 핵심 구조 신호만 짧게 넣습니다.',
    balanced: '구조/세력/지역/오프스크린 진행 중 중요도가 높은 신호만 균형 있게 넣습니다.',
    heavy: '월드 구조와 오프스크린 진행선을 더 적극적으로 노출하되, 상위 신호 중심으로 압축합니다.'
  };
  const OFFSCREEN_THREAD_STRENGTH_DESCRIPTIONS = {
    light: '장면과 강하게 연결된 오프스크린 진행선만 남깁니다.',
    balanced: '중요도와 긴급도를 함께 보고 대표 진행선을 유지합니다.',
    heavy: '느리게 움직이는 배경선까지 더 넓게 보존합니다.'
  };
  const FACTION_EMPHASIS_DESCRIPTIONS = {
    light: '세력은 장면 압력에 직접 연결된 경우에만 강조합니다.',
    balanced: '현재 장면과 연결되는 세력과 지역 통제 흐름을 함께 봅니다.',
    heavy: '세력 목표, 통제권, 적대/동맹, 장기 위험까지 더 적극적으로 반영합니다.'
  };
  const BG_REASON_LABELS = {
    mentioned_untracked: '언급됐지만 미등록',
    recently_exited: '직전 장면 퇴장',
    current_location: '현재 장소 범위',
    current_country: '현재 국가 범위',
    unrestricted: '장면 밖 일반',
    random: '랜덤 선택'
  };

  const escHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const compactText = (value, maxLen = 220) => {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > maxLen ? `${text.slice(0, Math.max(0, maxLen - 1)).trim()}...` : text;
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
  const uniqueTexts = (rows = [], limit = 8) => {
    const seen = new Set();
    const output = [];
    const maxItems = Math.max(0, Number(limit || 0) || 0);
    (Array.isArray(rows) ? rows : [rows]).forEach((row) => {
      const text = compactText(row || '', 220);
      if (!text) return;
      const key = text.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      output.push(text);
    });
    return maxItems > 0 ? output.slice(0, maxItems) : output;
  };

  const normalizeName = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const normalizeLooseToken = (value) => String(value ?? '').toLowerCase().replace(/[\s_\-'"`’‘“”]+/g, '');
  const parseDateLike = (value) => {
    const text = String(value ?? '').trim();
    if (!text) return null;
    const match = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (!match) return null;
    const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const formatDateKST = (date = new Date()) => {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(date);
      const read = (type) => parts.find(part => part.type === type)?.value || '';
      return `${read('year')}-${read('month')}-${read('day')}`;
    } catch (_) {
      return new Date().toISOString().slice(0, 10);
    }
  };
  const getProjectedTimeTracking = (entity = {}) => {
    try {
      if (typeof globalThis !== 'undefined' && typeof globalThis.LIBRA_getEntityTimeProjection === 'function') {
        const projected = globalThis.LIBRA_getEntityTimeProjection(entity);
        if (projected && typeof projected === 'object') return projected;
      }
    } catch (_) {}
    if (entity?.timeProjection && typeof entity.timeProjection === 'object') return entity.timeProjection;
    return entity?.timeTracking && typeof entity.timeTracking === 'object' ? entity.timeTracking : {};
  };
  const getTimeEngineState = () => {
    try {
      if (typeof globalThis !== 'undefined' && globalThis?.LIBRA_TimeEngine?.getState) {
        const state = globalThis.LIBRA_TimeEngine.getState();
        return (state && typeof state === 'object') ? state : {};
      }
    } catch (_) {}
    return {};
  };
  const getTimeEngineAnchor = (engineState = {}, entityName = '') => {
    const anchors = engineState?.entityAnchors;
    if (!anchors || typeof anchors !== 'object') return null;
    const normalized = normalizeName(entityName);
    if (!normalized) return null;
    const lowered = normalized.toLowerCase();
    const candidates = [
      normalized,
      lowered,
      lowered.replace(/\s+/g, '_'),
      lowered.replace(/\s+/g, '')
    ];
    for (const key of candidates) {
      const anchor = anchors?.[key];
      if (anchor && typeof anchor === 'object') return anchor;
    }
    for (const [key, anchor] of Object.entries(anchors)) {
      if (!anchor || typeof anchor !== 'object') continue;
      if (String(key || '').toLowerCase() === lowered) return anchor;
      const alias = String(anchor?.name || anchor?.entity || anchor?.entityName || '').trim().toLowerCase();
      if (alias && alias === lowered) return anchor;
    }
    return null;
  };
  const getLatestDateText = (...values) => {
    let latest = null;
    let latestText = '';
    values.flat().forEach((value) => {
      const text = String(value ?? '').trim();
      if (!text) return;
      const parsed = parseDateLike(text);
      if (!parsed) return;
      if (!latest || parsed.getTime() > latest.getTime()) {
        latest = parsed;
        latestText = formatDateKST(parsed);
      }
    });
    return latestText;
  };
  const getEntityCoreXBridge = (entity = {}) => {
    const direct = entity?.entityCoreX && typeof entity.entityCoreX === 'object'
      ? entity.entityCoreX
      : {};
    const snapshot = entity?.entitySnapshot?.entityCoreX && typeof entity.entitySnapshot.entityCoreX === 'object'
      ? entity.entitySnapshot.entityCoreX
      : {};
    return Object.keys(direct).length ? direct : snapshot;
  };
  const getEntityCoreXRuntimeApi = () => {
    try {
      return globalThis?.LIBRA_EntityCoreX || globalThis?.LIBRA?.EntityCoreX || null;
    } catch (_) {
      return null;
    }
  };
  const inferEntityCoreXRelationType = (metrics = {}) => {
    const trust = clamp01(metrics?.trust, 0.5);
    const attachment = clamp01(metrics?.attachment, 0.5);
    const tension = clamp01(metrics?.tension, 0.1);
    const grievance = clamp01(metrics?.grievance, 0.1);
    const affection = clamp01(metrics?.affection, attachment);
    if (grievance >= 0.68 && trust <= 0.34) return 'enemy';
    if (tension >= 0.64 && affection <= 0.38) return 'rival';
    if (affection >= 0.74 && trust >= 0.68) return 'intimate';
    if (affection >= 0.62 && trust >= 0.58) return 'friend';
    if (trust >= 0.6 && attachment >= 0.58) return 'ally';
    if (tension >= 0.56 && affection >= 0.46 && trust >= 0.42) return 'entangled';
    return 'peer';
  };
  const inferEntityCoreXRelationStage = (metrics = {}) => {
    const trust = clamp01(metrics?.trust, 0.5);
    const affection = clamp01(metrics?.affection, 0.5);
    const tension = clamp01(metrics?.tension, 0.1);
    const grievance = clamp01(metrics?.grievance, 0.1);
    const volatility = clamp01(metrics?.volatility, 0.2);
    if (grievance >= 0.62 && trust <= 0.34) return 'fractured';
    if (affection >= 0.72 && trust >= 0.72) return 'bonded';
    if (tension >= 0.6 && volatility >= 0.58) return 'unstable';
    if (tension >= 0.54) return 'strained';
    if (affection >= 0.58 || trust >= 0.58) return 'warming';
    return 'aware';
  };
  const normalizeEntityCoreXRelationFocus = (relation = {}, target = '') => {
    const source = relation && typeof relation === 'object' ? relation : {};
    const targetName = compactText(target || '', 80);
    if (!targetName) return null;
    const coreState = source?.coreState && typeof source.coreState === 'object' ? source.coreState : null;
    const dynamics = source?.dynamics && typeof source.dynamics === 'object' ? source.dynamics : null;
    const identity = source?.identity && typeof source.identity === 'object' ? source.identity : {};
    const trust = clamp01(coreState ? coreState.trust : source?.trust, 0.5);
    const affection = clamp01(coreState ? coreState.affection : source?.attachment, 0.5);
    const tension = clamp01(coreState ? coreState.tension : source?.tension, 0.1);
    const respect = clamp01(coreState ? coreState.respect : trust, 0.5);
    const attraction = clamp01(coreState ? coreState.attraction : (Number(source?.attachment || 0.5) * 0.22), 0.1);
    const grievance = clamp01(coreState ? coreState.grievance : source?.resentment, 0.1);
    const dependency = clamp01(dynamics ? dynamics.dependency : (Number(source?.attachment || 0.5) * 0.52), 0.3);
    const volatility = clamp01(dynamics ? dynamics.volatility : ((tension * 0.42) + (grievance * 0.24)), 0.2);
    const attachment = clamp01(
      coreState
        ? ((affection * 0.46) + (dependency * 0.22) + (attraction * 0.12) + (respect * 0.1) + (trust * 0.1))
        : source?.attachment,
      0.5
    );
    const type = compactText(identity?.type || inferEntityCoreXRelationType({
      trust,
      attachment,
      tension,
      grievance,
      affection
    }), 40);
    const stage = compactText(identity?.stage || inferEntityCoreXRelationStage({
      trust,
      affection,
      tension,
      grievance,
      volatility
    }), 40);
    return {
      target: targetName,
      trust,
      affection,
      attachment,
      tension,
      grievance,
      volatility,
      type,
      stage,
      score: (attachment * 0.45) + (tension * 0.35) + (grievance * 0.2)
    };
  };
  const pickEntityCoreXRelationFocus = (corex = {}) => {
    const source = corex?.psyche?.relationships && typeof corex.psyche.relationships === 'object'
      ? corex.psyche.relationships
      : (corex?.psyche?.relations && typeof corex.psyche.relations === 'object' ? corex.psyche.relations : {});
    const rows = Object.entries(source)
      .map(([target, relation]) => normalizeEntityCoreXRelationFocus(relation, target))
      .filter(Boolean)
      .sort((left, right) => Number(right?.score || 0) - Number(left?.score || 0));
    return rows[0] || null;
  };
  const describeEntityCoreXRelationKeyword = (focus = {}) => {
    const type = normalizeLooseToken(focus?.type || '');
    if (type.includes('enemy')) return 'enemy';
    if (type.includes('rival')) return 'hostile';
    if (type.includes('ally') || type.includes('friend') || type.includes('mentorline')) return 'ally';
    if (type.includes('intimate') || type.includes('romanticinterest') || type.includes('entangled')) return 'bonded';
    if (Number(focus?.tension || 0) >= 0.66 && Number(focus?.trust || 0) <= 0.42) return 'hostile';
    if (Number(focus?.trust || 0) >= 0.62 && Number(focus?.attachment || 0) >= 0.58) return 'ally';
    return 'connected';
  };
  const collectEntityCoreXRelationSignals = (context = {}, settings = getSettings()) => {
    let entityCache = context?.EntityManager?.getEntityCache?.();
    const lore = getContextLorebook(context);
    if (Array.isArray(lore) && lore.length > 0 && getMapLikeValues(entityCache).length === 0 && typeof context?.EntityManager?.rebuildCache === 'function') {
      try {
        context.EntityManager.rebuildCache(lore);
        entityCache = context?.EntityManager?.getEntityCache?.();
      } catch (_) {}
    }
    const entityMap = buildEntityIterationMap(context, entityCache);
    const limit = String(settings.worldDossierMode || 'focused') === 'expanded'
      ? 8
      : Math.max(2, Number(settings.maxWorldSignalItems || 4));
    const rows = [];
    entityMap.forEach((entity) => {
      const name = normalizeName(entity?.name || '');
      const corex = getEntityCoreXBridge(entity);
      const focus = pickEntityCoreXRelationFocus(corex);
      if (!name || !focus?.target || normalizeName(focus.target) === name) return;
      const signalWord = describeEntityCoreXRelationKeyword(focus);
      const typeLabel = compactText([focus.type, focus.stage].filter(Boolean).join('/'), 48);
      rows.push(compactText([
        `${name} ${signalWord} ${focus.target}`,
        typeLabel ? `type ${typeLabel}` : '',
        `trust ${Math.round(Number(focus.trust || 0) * 100)}%`,
        `tension ${Math.round(Number(focus.tension || 0) * 100)}%`
      ].filter(Boolean).join(' | '), 180));
    });
    return uniqueTexts(rows, limit);
  };
  const loadEntityCoreXDmaInsights = async (context = {}, settings = getSettings()) => {
    const fallbackScopeId = getRuntimeChatId(context);
    const empty = {
      available: false,
      scopeId: fallbackScopeId,
      summary: '',
      hints: [],
      stats: {
        directEntries: 0,
        previousEntries: 0,
        totalEntries: 0
      }
    };
    const api = getEntityCoreXRuntimeApi();
    if (!api?.loadStore) return empty;
    try {
      const store = await api.loadStore(context);
      const directAll = normalizeArrayItems(store?.directEntries || []);
      const previousAll = normalizeArrayItems(store?.previousEntries || []);
      const limit = String(settings.worldDossierMode || 'focused') === 'expanded' ? 4 : 3;
      const directEntries = directAll.slice(-Math.max(1, Math.min(3, limit)));
      const previousEntries = previousAll.slice(-Math.max(1, Math.min(2, limit)));
      const hints = uniqueTexts([
        ...directEntries.map((entry) => buildStructuredSummary([
          Number(entry?.turn || 0) > 0 ? `DMA direct T${entry.turn}` : 'DMA direct',
          normalizeArrayItems(entry?.locations || [])[0] ? `loc ${normalizeArrayItems(entry.locations || [])[0]}` : '',
          normalizeArrayItems(entry?.continuityHints || [])[0] ? `hint ${normalizeArrayItems(entry.continuityHints || [])[0]}` : '',
          compactText(entry?.preview || entry?.episode || '', 120)
        ], 180)),
        ...previousEntries.map((entry) => buildStructuredSummary([
          Number(entry?.fromTurn || 0) || Number(entry?.toTurn || 0)
            ? `DMA previous T${Number(entry?.fromTurn || 0)}-${Number(entry?.toTurn || 0)}`
            : 'DMA previous',
          normalizeArrayItems(entry?.locations || [])[0] ? `loc ${normalizeArrayItems(entry.locations || [])[0]}` : '',
          normalizeArrayItems(entry?.relationHighlights || [])[0] ? `relation ${normalizeArrayItems(entry.relationHighlights || [])[0]}` : '',
          compactText(entry?.summary || entry?.title || '', 120)
        ], 180))
      ], limit);
      const summary = compactText([
        directEntries[0]
          ? buildStructuredSummary([
            'direct',
            compactText(directEntries[0]?.preview || directEntries[0]?.episode || '', 110),
            normalizeArrayItems(directEntries[0]?.locations || [])[0] ? `loc ${normalizeArrayItems(directEntries[0].locations || [])[0]}` : ''
          ], 140)
          : '',
        previousEntries[0]
          ? buildStructuredSummary([
            'previous',
            compactText(previousEntries[0]?.summary || previousEntries[0]?.title || '', 110),
            normalizeArrayItems(previousEntries[0]?.relationHighlights || [])[0] ? `relation ${normalizeArrayItems(previousEntries[0].relationHighlights || [])[0]}` : ''
          ], 140)
          : ''
      ].filter(Boolean).join(' | '), 220);
      return {
        available: Boolean(directAll.length || previousAll.length || hints.length),
        scopeId: compactText(store?.scopeId || fallbackScopeId, 80) || fallbackScopeId,
        summary,
        hints,
        stats: {
          directEntries: directAll.length,
          previousEntries: previousAll.length,
          totalEntries: directAll.length + previousAll.length
        }
      };
    } catch (_) {
      return empty;
    }
  };
  const diffDaysBetween = (fromDateText, toDateText) => {
    const from = parseDateLike(fromDateText);
    const to = parseDateLike(toDateText);
    if (!from || !to) return null;
    return Math.max(0, Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
  };
  const safeJsonParse = (value, fallback) => {
    try {
      return typeof value === 'string' ? JSON.parse(value) : (value ?? fallback);
    } catch (_) {
      return fallback;
    }
  };
  const getPluginCoordinator = () => {
    try {
      return globalThis?.LIBRA?.PluginCoordinator || globalThis?.LIBRA_SubPluginCoordinator || null;
    } catch (_) {
      return null;
    }
  };
  const getRuntimeChatId = (context = {}) =>
    String(context?.chat?.id || context?.chatId || runtimeState.activeChatId || 'global').trim() || 'global';
  const updateRuntimeStatus = (status = '') => {
    runtimeState.lastStatus = String(status || '').trim() || '대기 중';
  };
  const reportCoordinatorRuntime = (extra = {}) => {
    try {
      const coordinator = getPluginCoordinator();
      if (!coordinator?.reportRuntime) return null;
      return coordinator.reportRuntime(PLUGIN_ID, {
        domain: 'world',
        activeChatId: runtimeState.activeChatId,
        lastStatus: runtimeState.lastStatus,
        lastChangedCount: runtimeState.lastChangedCount,
        worldSignals: Number(extra?.worldSignals || runtimeState.lastChangedCount || 0),
        offscreenThreads: Number(extra?.offscreenThreads || 0),
        factionSignals: Number(extra?.factionSignals || 0),
        settingOntologyStatus: extra?.settingOntologyStatus || 'projection',
        genreWeightStatus: extra?.genreWeightStatus || 'projection',
        analysisFailureCount: runtimeState.analysisFailureCount,
        settings: getSettings(),
        ...(extra && typeof extra === 'object' ? extra : {})
      });
    } catch (_) {
      return null;
    }
  };
  const withPhaseContext = (context = {}, phase = 'runtime') => ({
    ...(context && typeof context === 'object' ? context : {}),
    capturePhase: String(context?.capturePhase || phase).trim() || phase
  });
  const ensureStateCommitAllowed = (context = {}, phase = 'runtime') => {
    const options = {
      phase,
      capturePhase: String(context?.capturePhase || phase).trim() || phase
    };
    if (typeof context?.assertStateCommitAllowed === 'function') {
      try {
        context.assertStateCommitAllowed(options);
        return true;
      } catch (error) {
        const detail = String(error?.message || error || 'state commit blocked').trim();
        updateRuntimeStatus(`state commit 차단 · ${detail}`);
        reportCoordinatorRuntime({ phase: `${phase}-blocked`, changedCount: 0, blockReason: detail });
        console.warn(`${LOG_PREFIX} state commit blocked:`, detail);
        return false;
      }
    }
    if (typeof context?.canCommitState === 'function' && context.canCommitState(options) === false) {
      const detail = String(context?.stateCommitPolicy?.reason || 'state commit blocked').trim();
      updateRuntimeStatus(`state commit 차단 · ${detail}`);
      reportCoordinatorRuntime({ phase: `${phase}-blocked`, changedCount: 0, blockReason: detail });
      console.warn(`${LOG_PREFIX} state commit blocked:`, detail);
      return false;
    }
    return true;
  };

  const getChatMessages = (chat) => {
    if (!chat || typeof chat !== 'object') return [];
    if (Array.isArray(chat.message)) return chat.message;
    if (Array.isArray(chat.messages)) return chat.messages;
    return [];
  };
  const getMessageText = (msg) => {
    if (!msg || typeof msg !== 'object') return '';
    if (typeof msg.data === 'string') return msg.data;
    if (typeof msg.content === 'string') return msg.content;
    if (typeof msg.message === 'string') return msg.message;
    if (Array.isArray(msg.swipes) && Number.isFinite(Number(msg.swipe_id))) {
      return String(msg.swipes[Number(msg.swipe_id)] || '');
    }
    return '';
  };
  const getHypaSummaries = (context = {}) =>
    Array.isArray(context?.chat?.hypaV3Data?.summaries) ? context.chat.hypaV3Data.summaries : [];
  const stringifyHypaSummary = (summary = {}) => {
    if (!summary || typeof summary !== 'object') return '';
    const parts = [
      summary.title,
      summary.topic,
      summary.category,
      summary.key,
      summary.secondkey,
      summary.summary,
      summary.description,
      summary.content,
      summary.text,
      Array.isArray(summary.keys) ? summary.keys.join(', ') : '',
      Array.isArray(summary.tags) ? summary.tags.join(', ') : ''
    ];
    return String(parts.filter(Boolean).join(' | ')).replace(/\s+/g, ' ').trim();
  };
  const collectHypaContextText = (context = {}, limit = 6) => {
    return getHypaSummaries(context)
      .map(stringifyHypaSummary)
      .filter(Boolean)
      .slice(0, limit)
      .join('\n');
  };
  const getEvidenceBridge = () => {
    try {
      if (typeof globalThis !== 'undefined' && globalThis?.LIBRA?.EvidenceBridge) return globalThis.LIBRA.EvidenceBridge;
      if (typeof globalThis !== 'undefined' && globalThis?.LIBRA_EvidenceBridge) return globalThis.LIBRA_EvidenceBridge;
    } catch (_) {}
    return null;
  };
  const collectUnifiedContextEvidenceText = async (context = {}, options = {}) => {
    const bridge = getEvidenceBridge();
    if (bridge?.collectEvidenceText) {
      try {
        const text = await bridge.collectEvidenceText(context, {
          scope: options?.scope || 'dylist',
          entityNames: Array.isArray(options?.entityNames) ? options.entityNames : [],
          queryText: options?.queryText || 'character relation history continuity world narrative planner',
          maxLen: options?.maxLen || 7000
        });
        if (String(text || '').trim()) return String(text).trim();
      } catch (_) {}
    }
    return collectHypaContextText(context, 4);
  };
  const getTurn = (context = {}) => {
    const memoryTurn = Number(context?.MemoryState?.currentTurn || 0);
    const narrativeTurnLog = context?.NarrativeTracker?.getState?.()?.turnLog;
    const narrativeTurn = Array.isArray(narrativeTurnLog) ? narrativeTurnLog.length : 0;
    return Math.max(memoryTurn, narrativeTurn, 1);
  };
  const clamp01 = (value, fallback = 0) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return Math.max(0, Math.min(1, Number(fallback) || 0));
    return Math.max(0, Math.min(1, num));
  };
  const getRisuApi = () => {
    if (typeof globalThis === 'undefined') return null;
    return globalThis.Risuai || globalThis.risuai || null;
  };

  const waitForPluginStorage = async (timeoutMs = 2500, intervalMs = 100) => {
    if (storagePromise) return storagePromise;

    const pending = (async () => {
      const startedAt = Date.now();
      while (true) {
        const api = getRisuApi();
        const storage = api?.pluginStorage;
        if (storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function') {
          return storage;
        }
        if ((Date.now() - startedAt) >= timeoutMs) return null;
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    })();

    storagePromise = pending;
    let storage;
    try {
      storage = await pending;
    } catch (error) {
      storagePromise = null;
      throw error;
    }
    if (!storage) storagePromise = null;
    return storage;
  };

  const loadState = async () => {
    if (persistedState) return persistedState;
    const storage = await waitForPluginStorage();
    if (!storage) {
      persistedState = { version: 2, chats: {} };
      return persistedState;
    }
    const raw = await storage.getItem(STORAGE_KEY);
    const parsed = safeJsonParse(raw, null);
    persistedState = (parsed && typeof parsed === 'object')
      ? {
        version: 2,
        chats: parsed.chats && typeof parsed.chats === 'object' ? parsed.chats : {},
        settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {}
      }
      : { version: 2, chats: {}, settings: {} };
    return persistedState;
  };

  const schedulePersist = async () => {
    if (persistScheduled) return;
    persistScheduled = true;
    queueMicrotask(async () => {
      persistScheduled = false;
      const storage = await waitForPluginStorage();
      if (!storage || !persistedState) return;
      try {
        await storage.setItem(STORAGE_KEY, JSON.stringify(persistedState));
      } catch (error) {
        console.warn(`${LOG_PREFIX} persist failed:`, error?.message || error);
      }
    });
  };

  const createDefaultWorldBucket = () => ({
    sceneSummary: '',
    scenePressures: [],
    carryoverSignals: [],
    relationSignals: [],
    worldLimits: [],
    codexSignals: [],
    entityDossierHints: [],
    dmaSummary: '',
    dmaScopeId: '',
    dmaStats: {
      directEntries: 0,
      previousEntries: 0,
      totalEntries: 0
    },
    structure: {
      institutions: [],
      laws: [],
      economy: [],
      culture: [],
      religion: [],
      regions: [],
      infrastructure: [],
      scarcity: [],
      publicOrder: [],
      summary: ''
    },
    factions: [],
    offscreenThreads: [],
    timeline: {
      currentPhase: '',
      recentEvents: [],
      pendingEvents: [],
      seasonalContext: [],
      pressureClock: [],
      temporalPulse: '',
      phaseShiftSummary: '',
      forecast: '',
      summary: ''
    },
    regions: [],
    publicPressure: [],
    propagation: [],
    analysis: {
      summary: '',
      structuralHints: [],
      factionHints: [],
      offscreenHints: [],
      regionalHints: [],
      timelineHints: [],
      propagationHints: [],
      promptHints: [],
      warnings: [],
      provider: '',
      model: '',
      stage: '',
      updatedAt: 0
    },
    systemFocus: '',
    autonomySummary: '',
    location: '',
    country: '',
    currentNodeName: '',
    updatedTurn: 0,
    updatedDate: '',
    history: []
  });

  const getChatBucket = async (chatId) => {
    const state = await loadState();
    const key = String(chatId || 'global');
    let migrated = false;
    state.chats[key] = state.chats[key] && typeof state.chats[key] === 'object'
      ? state.chats[key]
      : { entities: {}, groups: {}, counters: { entity: 0, group: 0 } };
    state.chats[key].entities = state.chats[key].entities && typeof state.chats[key].entities === 'object'
      ? state.chats[key].entities
      : {};
    if (Object.prototype.hasOwnProperty.call(state.chats[key], 'relations')) {
      delete state.chats[key].relations;
      migrated = true;
    }
    state.chats[key].groups = state.chats[key].groups && typeof state.chats[key].groups === 'object'
      ? state.chats[key].groups
      : {};
    state.chats[key].background = state.chats[key].background && typeof state.chats[key].background === 'object'
      ? state.chats[key].background
      : { entities: [], groups: [], updatedTurn: 0, updatedDate: '', mode: 'off', scope: 'recently_exited', contextMode: 'indirect', hints: '', history: [] };
    state.chats[key].world = state.chats[key].world && typeof state.chats[key].world === 'object'
      ? {
        ...createDefaultWorldBucket(),
        ...state.chats[key].world
      }
      : createDefaultWorldBucket();
    state.chats[key].counters = state.chats[key].counters && typeof state.chats[key].counters === 'object'
      ? state.chats[key].counters
      : { entity: 0, group: 0 };
    if (Object.prototype.hasOwnProperty.call(state.chats[key].counters, 'relation')) {
      delete state.chats[key].counters.relation;
      migrated = true;
    }
    state.chats[key].counters.group = Number.isFinite(Number(state.chats[key].counters.group))
      ? Number(state.chats[key].counters.group)
      : 0;
    if (migrated) void schedulePersist();
    return state.chats[key];
  };
  const getWorldBucketEntryCount = (bucket = {}) => (
    Object.keys(bucket?.entities || {}).length
    + Object.keys(bucket?.groups || {}).length
    + (Array.isArray(bucket?.background?.entities) ? bucket.background.entities.length : 0)
    + (Array.isArray(bucket?.background?.groups) ? bucket.background.groups.length : 0)
    + (Array.isArray(bucket?.world?.scenePressures) ? bucket.world.scenePressures.length : 0)
    + (Array.isArray(bucket?.world?.carryoverSignals) ? bucket.world.carryoverSignals.length : 0)
    + (Array.isArray(bucket?.world?.offscreenThreads) ? bucket.world.offscreenThreads.length : 0)
    + (Array.isArray(bucket?.world?.factions) ? bucket.world.factions.length : 0)
    + (Array.isArray(bucket?.world?.regions) ? bucket.world.regions.length : 0)
    + (bucket?.world?.sceneSummary ? 1 : 0)
    + (bucket?.world?.autonomySummary ? 1 : 0)
  );
  const nativeCopyHash = (value = '') => {
    const text = String(value || '');
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  };
  const stripNativeCopySuffix = (value = '') => {
    let text = compactText(value, 240);
    for (let i = 0; i < 4; i += 1) {
      const next = compactText(text
        .replace(/\s*[\[(](?:copy|copy\s*\d+|copied|사본|복사본)[\])]\s*$/i, '')
        .replace(/\s*[-_:–—]?\s*(?:copy|copy\s*\d+|copied|사본|복사본)\s*$/i, ''), 240);
      if (!next || next === text) break;
      text = next;
    }
    return text;
  };
  const hasNativeCopyNameSignal = (value = '') => /\bcopy\b|copied|복사|사본/i.test(compactText(value, 240));
  const buildNativeChatContentSignature = (chat = {}) => {
    const rows = getChatMessages(chat)
      .filter(msg => msg && typeof msg === 'object')
      .map((msg) => {
        const role = compactText(msg?.role || (msg?.is_user ? 'user' : 'assistant'), 40).toLowerCase();
        const text = compactText(getMessageText(msg), 20000);
        return text ? `${role}:${text}` : '';
      })
      .filter(Boolean);
    const joined = rows.join('\n');
    return { count: rows.length, chars: joined.length, hash: rows.length ? nativeCopyHash(joined) : '' };
  };
  const isNativeCopiedChatPair = (targetChat = {}, sourceChat = {}) => {
    const targetId = compactText(targetChat?.id || targetChat?.chatId || targetChat?.chatroom_id || '', 160);
    const sourceId = compactText(sourceChat?.id || sourceChat?.chatId || sourceChat?.chatroom_id || '', 160);
    if (!targetId || !sourceId || targetId === sourceId) return false;
    const targetName = compactText(targetChat?.name || targetChat?.title || '', 240);
    const sourceName = compactText(sourceChat?.name || sourceChat?.title || '', 240);
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
  const findNativeCopiedChatSourceForBucket = async (targetChatId = '') => {
    const target = compactText(targetChatId, 160);
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
    const activeChat = chats.find(chat => compactText(chat?.id || chat?.chatId || chat?.chatroom_id || '', 160) === target)
      || chats[Math.max(0, Number(character?.chatPage || 0))]
      || null;
    if (!activeChat) return null;
    const state = await loadState();
    const candidates = [];
    for (const chat of chats) {
      const sourceChatId = compactText(chat?.id || chat?.chatId || chat?.chatroom_id || '', 160);
      if (!sourceChatId || sourceChatId === target) continue;
      if (!isNativeCopiedChatPair(activeChat, chat)) continue;
      const sourceBucket = state.chats?.[sourceChatId];
      const count = getWorldBucketEntryCount(sourceBucket || {});
      if (count <= 0) continue;
      candidates.push({
        sourceChatId,
        sourceBucket,
        count,
        sourceName: compactText(chat?.name || chat?.title || '', 240)
      });
    }
    candidates.sort((a, b) => b.count - a.count || a.sourceChatId.localeCompare(b.sourceChatId));
    return candidates[0] || null;
  };
  const importBucketFromNativeCopiedChatIfNeeded = async (context = {}, targetChatId = '') => {
    const target = compactText(targetChatId || getRuntimeChatId(context), 120) || 'global';
    if (!target || target === 'global') return null;
    const state = await loadState();
    const current = state.chats?.[target];
    if (getWorldBucketEntryCount(current || {}) > 0) return null;
    if (current?.copiedFromChatId || current?.copiedFromImportedAt) return null;
    const source = await findNativeCopiedChatSourceForBucket(target);
    if (!source?.sourceChatId || !source?.sourceBucket) return null;
    const cloned = safeJsonParse(JSON.stringify({
      ...source.sourceBucket,
      copiedFromChatId: source.sourceChatId,
      copiedFromImportedAt: Date.now(),
      copyImportMatch: {
        mode: 'native-risu-chat-copy',
        sourceName: source.sourceName || '',
        entryCount: source.count
      }
    }), {});
    await replaceChatBucket(target, cloned, { mode: 'replace' });
    runtimeState.activeChatId = target;
    updateRuntimeStatus(`native chat copy World Core X bucket imported · ${source.sourceChatId}`);
    reportCoordinatorRuntime({ phase: 'native-chat-copy-import', activeChatId: target, copiedFromChatId: source.sourceChatId });
    return { chatId: target, bucket: state.chats[target], copiedFromChatId: source.sourceChatId };
  };
  const importBucketFromCopiedChatIfNeeded = async (context = {}, targetChatId = '') => {
    const target = compactText(targetChatId || getRuntimeChatId(context), 120) || 'global';
    if (!target || target === 'global') return null;
    const state = await loadState();
    const current = state.chats?.[target];
    if (getWorldBucketEntryCount(current || {}) > 0) return null;
    const explicitSource = compactText(
      context?.copiedFromChatId
      || context?.copiedFromScopeId
      || context?.sourceChatId
      || context?.sourceScopeId
      || '',
      120
    );
    const sourceChatId = explicitSource;
    if (!sourceChatId || sourceChatId === target || sourceChatId === 'global') {
      return importBucketFromNativeCopiedChatIfNeeded(context, target);
    }
    const sourceBucket = state.chats?.[sourceChatId];
    if (getWorldBucketEntryCount(sourceBucket || {}) <= 0) return null;
    const cloned = safeJsonParse(JSON.stringify({
      ...sourceBucket,
      copiedFromChatId: sourceChatId,
      copiedFromImportedAt: Date.now(),
      copyImportMatch: {
        mode: 'explicit-source'
      }
    }), {});
    await replaceChatBucket(target, cloned, { mode: 'replace' });
    runtimeState.activeChatId = target;
    updateRuntimeStatus(`chat copy World Core X bucket imported · ${sourceChatId}`);
    reportCoordinatorRuntime({ phase: 'chat-copy-import', activeChatId: target, copiedFromChatId: sourceChatId });
    return { chatId: target, bucket: state.chats[target], copiedFromChatId: sourceChatId };
  };
  const replaceChatBucket = async (chatId = 'global', bucket = {}, options = {}) => {
    const state = await loadState();
    const key = String(chatId || 'global').trim() || 'global';
    const previous = await getChatBucket(key);
    const incoming = bucket && typeof bucket === 'object' ? safeJsonParse(JSON.stringify(bucket), {}) : {};
    const mode = compactText(options?.mode || 'carryover', 40).toLowerCase();
    state.chats[key] = mode === 'replace'
      ? incoming
      : {
        ...previous,
        ...incoming,
        entities: {
          ...(previous?.entities && typeof previous.entities === 'object' ? previous.entities : {}),
          ...(incoming?.entities && typeof incoming.entities === 'object' ? incoming.entities : {})
        },
        groups: {
          ...(previous?.groups && typeof previous.groups === 'object' ? previous.groups : {}),
          ...(incoming?.groups && typeof incoming.groups === 'object' ? incoming.groups : {})
        },
        background: {
          ...(previous?.background && typeof previous.background === 'object' ? previous.background : {}),
          ...(incoming?.background && typeof incoming.background === 'object' ? incoming.background : {})
        },
        world: {
          ...createDefaultWorldBucket(),
          ...(previous?.world && typeof previous.world === 'object' ? previous.world : {}),
          ...(incoming?.world && typeof incoming.world === 'object' ? incoming.world : {})
        },
        counters: {
          ...(previous?.counters && typeof previous.counters === 'object' ? previous.counters : {}),
          ...(incoming?.counters && typeof incoming.counters === 'object' ? incoming.counters : {})
        }
      };
    await getChatBucket(key);
    await schedulePersist();
    return state.chats[key];
  };

  const getSettings = () => {
    const stateSettings = persistedState?.settings && typeof persistedState.settings === 'object'
      ? persistedState.settings
      : {};
    const runtimeOverrides = (typeof window !== 'undefined' && window.LIBRA_WorldCoreXSettings && typeof window.LIBRA_WorldCoreXSettings === 'object')
      ? window.LIBRA_WorldCoreXSettings
      : (typeof window !== 'undefined' && window.LIBRA_DyListCoreSettings && typeof window.LIBRA_DyListCoreSettings === 'object')
        ? window.LIBRA_DyListCoreSettings
      : {};
    return {
      ...DEFAULT_SETTINGS,
      ...stateSettings,
      ...runtimeOverrides,
      analysisProvider: normalizeAnalysisProviderSettings(
        runtimeOverrides.analysisProvider && typeof runtimeOverrides.analysisProvider === 'object'
          ? runtimeOverrides.analysisProvider
          : (stateSettings.analysisProvider && typeof stateSettings.analysisProvider === 'object')
            ? stateSettings.analysisProvider
            : {}
      ),
      historyTemplates: {
        ...DEFAULT_SETTINGS.historyTemplates,
        ...(stateSettings.historyTemplates && typeof stateSettings.historyTemplates === 'object' ? stateSettings.historyTemplates : {}),
        ...(runtimeOverrides.historyTemplates && typeof runtimeOverrides.historyTemplates === 'object' ? runtimeOverrides.historyTemplates : {})
      },
      groupAxisDescriptions: {
        ...DEFAULT_SETTINGS.groupAxisDescriptions,
        ...(stateSettings.groupAxisDescriptions && typeof stateSettings.groupAxisDescriptions === 'object' ? stateSettings.groupAxisDescriptions : {}),
        ...(runtimeOverrides.groupAxisDescriptions && typeof runtimeOverrides.groupAxisDescriptions === 'object' ? runtimeOverrides.groupAxisDescriptions : {})
      }
    };
  };

  const mergeSettings = (base = {}, patch = {}) => ({
    ...base,
    ...patch,
    analysisProvider: {
      ...(base.analysisProvider && typeof base.analysisProvider === 'object' ? base.analysisProvider : {}),
      ...(patch.analysisProvider && typeof patch.analysisProvider === 'object' ? patch.analysisProvider : {}),
      stages: {
        ...(base.analysisProvider?.stages && typeof base.analysisProvider.stages === 'object' ? base.analysisProvider.stages : {}),
        ...(patch.analysisProvider?.stages && typeof patch.analysisProvider.stages === 'object' ? patch.analysisProvider.stages : {})
      }
    },
    historyTemplates: {
      ...(base.historyTemplates && typeof base.historyTemplates === 'object' ? base.historyTemplates : {}),
      ...(patch.historyTemplates && typeof patch.historyTemplates === 'object' ? patch.historyTemplates : {})
    },
    groupAxisDescriptions: {
      ...(base.groupAxisDescriptions && typeof base.groupAxisDescriptions === 'object' ? base.groupAxisDescriptions : {}),
      ...(patch.groupAxisDescriptions && typeof patch.groupAxisDescriptions === 'object' ? patch.groupAxisDescriptions : {})
    }
  });

  const clampPositiveInt = (value, fallback) => {
    const parsed = Math.max(1, Math.round(Number(value)));
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const clampNonNegativeInt = (value, fallback = 0) => {
    const parsed = Math.max(0, Math.round(Number(value)));
    return Number.isFinite(parsed) ? parsed : Math.max(0, Math.round(Number(fallback) || 0));
  };
  const clampNumber = (value, fallback = 0, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return Math.max(min, Math.min(max, Number(fallback) || 0));
    return Math.max(min, Math.min(max, parsed));
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
      maxAutoCallsPerScene: Math.max(1, clampPositiveInt(source?.maxAutoCallsPerScene, DEFAULT_SETTINGS.analysisProvider.maxAutoCallsPerScene)),
      cooldownTurns: Math.max(0, clampNonNegativeInt(source?.cooldownTurns, DEFAULT_SETTINGS.analysisProvider.cooldownTurns)),
      onlyWhenDirty: source?.onlyWhenDirty !== false,
      minDirtySeverity: compactText(source?.minDirtySeverity || DEFAULT_SETTINGS.analysisProvider.minDirtySeverity, 20).toLowerCase() || 'high',
      outputMode: compactText(source?.outputMode || DEFAULT_SETTINGS.analysisProvider.outputMode, 20).toLowerCase() || 'proposal',
      stages: {
        finalize: stages?.finalize !== false,
        rebuild: stages?.rebuild !== false,
        manual: stages?.manual !== false
      },
      provider: compactText(source?.provider || DEFAULT_SETTINGS.analysisProvider.provider, 40).toLowerCase() || DEFAULT_SETTINGS.analysisProvider.provider,
      url: compactText(source?.url || '', 300),
      key: String(source?.key || ''),
      model: compactText(source?.model || DEFAULT_SETTINGS.analysisProvider.model, 120),
      temp: clampNumber(source?.temp, DEFAULT_SETTINGS.analysisProvider.temp, 0, 1.5),
      timeout: Math.max(3000, clampPositiveInt(source?.timeout, DEFAULT_SETTINGS.analysisProvider.timeout)),
      reasoningPreset: compactText(source?.reasoningPreset || DEFAULT_SETTINGS.analysisProvider.reasoningPreset, 20).toLowerCase() || 'auto',
      reasoningEffort: compactText(source?.reasoningEffort || DEFAULT_SETTINGS.analysisProvider.reasoningEffort, 20).toLowerCase() || 'none',
      reasoningBudgetTokens: clampNonNegativeInt(source?.reasoningBudgetTokens, DEFAULT_SETTINGS.analysisProvider.reasoningBudgetTokens),
      maxCompletionTokens: Math.max(256, clampPositiveInt(source?.maxCompletionTokens, DEFAULT_SETTINGS.analysisProvider.maxCompletionTokens)),
      responseMaxTokens: Math.max(256, clampPositiveInt(source?.responseMaxTokens, DEFAULT_SETTINGS.analysisProvider.responseMaxTokens)),
      maxEvidenceRefs: Math.max(4, clampPositiveInt(source?.maxEvidenceRefs, DEFAULT_SETTINGS.analysisProvider.maxEvidenceRefs)),
      maxEvidenceSnippets: Math.max(2, clampPositiveInt(source?.maxEvidenceSnippets, DEFAULT_SETTINGS.analysisProvider.maxEvidenceSnippets)),
      autoApply: source?.autoApply === true,
      debug: source?.debug === true
    };
  };

  const saveSettingsPatch = async (patch = {}, options = {}) => {
    const state = await loadState();
    const nextSettings = options.reset
      ? mergeSettings(DEFAULT_SETTINGS, patch)
      : mergeSettings(getSettings(), patch);
    state.settings = mergeSettings(DEFAULT_SETTINGS, nextSettings);
    if (typeof window !== 'undefined' && window.LIBRA_WorldCoreXSettings && typeof window.LIBRA_WorldCoreXSettings === 'object') {
      delete window.LIBRA_WorldCoreXSettings;
    }
    if (typeof window !== 'undefined' && window.LIBRA_DyListCoreSettings && typeof window.LIBRA_DyListCoreSettings === 'object') {
      delete window.LIBRA_DyListCoreSettings;
    }
    if (patch && typeof patch === 'object' && Object.prototype.hasOwnProperty.call(patch, 'analysisProvider')) {
      resetAnalysisProviderFailureState();
    }
    const storage = await waitForPluginStorage();
    if (storage) {
      await storage.setItem(STORAGE_KEY, JSON.stringify(state));
    } else {
      await schedulePersist();
    }
    return state.settings;
  };

  let settingsPanelHandlersBound = false;
  let settingsAutoSaveTimer = null;
  const queueSettingsAutoSave = (target, delay = 120) => {
    if (settingsAutoSaveTimer) clearTimeout(settingsAutoSaveTimer);
    settingsAutoSaveTimer = setTimeout(() => {
      settingsAutoSaveTimer = null;
      try { window.LIBRA_DyListCoreAPI?.saveFromPanel?.(target); } catch (_) {}
    }, Math.max(40, Number(delay) || 120));
  };
  const bindSettingsPanelHandlers = () => {
    if (settingsPanelHandlersBound || typeof document === 'undefined') return;
    dylistPanelClickHandler = (event) => {
      const rawTarget = event?.target;
      const targetEl = (
        rawTarget && rawTarget.nodeType === 1
          ? rawTarget
          : rawTarget?.parentElement
      );
      if (!targetEl || typeof targetEl.closest !== 'function') return;
      const button = targetEl.closest('button');
      if (!button || typeof button.getAttribute !== 'function') return;
      const popoverOpen = String(button.getAttribute('data-dylist-popover-open') || '').trim();
      if (popoverOpen) {
        try { event.preventDefault?.(); } catch (_) {}
        try { event.stopPropagation?.(); } catch (_) {}
        try { window.LIBRA_DyListCoreAPI?.openPopover?.(popoverOpen); } catch (_) {}
        return;
      }
      const popoverClose = String(button.getAttribute('data-dylist-popover-close') || '').trim();
      if (popoverClose) {
        try { event.preventDefault?.(); } catch (_) {}
        try { event.stopPropagation?.(); } catch (_) {}
        try { window.LIBRA_DyListCoreAPI?.closePopover?.(popoverClose); } catch (_) {}
        return;
      }
      const panel = button.closest('.dylist-settings-panel');
      if (!panel) return;
      const actionName = String(button.getAttribute('data-dylist-group') || '').trim();
      const value = String(button.getAttribute('data-dylist-value') || '').trim();
      if (actionName && value) {
        try {
          const action = window.LIBRA_DyListCoreAPI?.[actionName];
          if (typeof action === 'function') action(value, button);
        } catch (_) {}
        return;
      }
      if (button.matches('[data-dylist-explicit-save="true"]')) {
        try { window.LIBRA_DyListCoreAPI?.saveFromPanel?.(button); } catch (_) {}
        return;
      }
      const explicitAction = String(button.getAttribute('data-dylist-action') || '').trim();
      if (!explicitAction) return;
      try {
        const action = window.LIBRA_DyListCoreAPI?.[explicitAction];
        if (typeof action !== 'function') return;
        const actionValue = String(button.getAttribute('data-dylist-value') || '').trim();
        if (actionValue) action(actionValue, button);
        else action(button);
      } catch (_) {}
    };
    dylistPanelChangeHandler = (event) => {
      const target = event?.target;
      if (!(target instanceof HTMLElement)) return;
      const panel = target.closest('.dylist-settings-panel');
      if (!panel) return;
      if (target.matches('[data-dylist-toggle]')) {
        try {
          const key = String(target.getAttribute('data-dylist-toggle') || '').trim();
          window.LIBRA_DyListCoreAPI?.toggleQuick?.(
            key,
            Boolean(target.checked),
            target
          );
        } catch (_) {}
        return;
      }
      if (target.matches('[data-dylist-setting], [data-dylist-history-template], [data-dylist-group-axis]')) {
        try { window.LIBRA_DyListCoreAPI?.saveFromPanel?.(target); } catch (_) {}
      }
    };
    dylistPanelInputHandler = (event) => {
      const target = event?.target;
      if (!(target instanceof HTMLElement)) return;
      const panel = target.closest('.dylist-settings-panel');
      if (!panel) return;
      if (target.matches('input[data-dylist-setting][type="number"], textarea[data-dylist-history-template], textarea[data-dylist-group-axis], input[data-dylist-group-axis]')) {
        queueSettingsAutoSave(target, 180);
      }
    };
    document.addEventListener('click', dylistPanelClickHandler, true);
    document.addEventListener('change', dylistPanelChangeHandler, true);
    document.addEventListener('input', dylistPanelInputHandler, true);
    settingsPanelHandlersBound = true;
  };

  const getSettingsPanelRoot = (trigger) => trigger?.closest?.('.dylist-settings-panel') || null;
  const notifyDyListToast = (message) => {
    const text = String(message || '').trim();
    if (!text) return;
    try {
      const toastApi = globalThis?.LMAI_GUI?.toast || window?.LMAI_GUI?.toast;
      if (typeof toastApi === 'function') {
        toastApi(text);
        return;
      }
    } catch (_) {}
  };
  const getAnalysisProviderPanelRoot = (trigger) => trigger?.closest?.('.world-corex-analysis-panel') || null;
  const queueAnalysisPanelAutoSave = (trigger, delay = 180) => {
    if (analysisPanelAutoSaveTimer) clearTimeout(analysisPanelAutoSaveTimer);
    analysisPanelAutoSaveTimer = setTimeout(() => {
      analysisPanelAutoSaveTimer = null;
      try { window.LIBRA_WorldCoreXAPI?.saveAnalysisProviderFromPanel?.(trigger); } catch (_) {}
    }, Math.max(60, Number(delay) || 180));
  };
  const buildAnalysisProviderPanelPreviewHtml = (settings = {}, status = '') => {
    const analysis = normalizeAnalysisProviderSettings(settings);
    const stages = [
      analysis?.stages?.finalize ? 'finalize' : '',
      analysis?.stages?.rebuild ? 'rebuild' : '',
      analysis?.stages?.manual ? 'manual' : ''
    ].filter(Boolean).join(', ') || 'none';
    return `
      <div class="scope-section-note">runtime=${escHtml(analysis.enabled ? `${analysis.provider}/${analysis.model}` : 'disabled')} | stages=${escHtml(stages)}</div>
      <div class="scope-section-note" style="margin-top:4px">timeout=${escHtml(String(analysis.timeout))}ms | responseMax=${escHtml(String(analysis.responseMaxTokens))} | refs=${escHtml(String(analysis.maxEvidenceRefs))}</div>
      <div class="scope-section-note" style="margin-top:4px">autoApply=${escHtml(analysis.autoApply ? 'on' : 'off')} | reasoning=${escHtml(`${analysis.reasoningPreset}/${analysis.reasoningEffort}`)}</div>
      ${status ? `<div class="scope-section-note" style="margin-top:6px;color:#93c5fd">${escHtml(status)}</div>` : ''}
    `;
  };
  const readAnalysisProviderSettingsFromPanel = (root) => {
    if (!root || typeof root.querySelector !== 'function') return normalizeAnalysisProviderSettings(getSettings().analysisProvider || {});
    const getValue = (name) => root.querySelector(`[data-world-analysis-setting="${name}"]`);
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
      maxEvidenceSnippets: String(analysis.maxEvidenceSnippets)
    };
    Object.entries(valueMap).forEach(([key, value]) => {
      root.querySelectorAll(`[data-world-analysis-setting="${key}"]`).forEach((node) => {
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
      root.querySelectorAll(`[data-world-analysis-setting="${key}"]`).forEach((node) => {
        node.checked = Boolean(value);
      });
    });
    return true;
  };
  const syncAnalysisProviderPanelPreview = (root, settings = {}, status = '') => {
    const live = root?.querySelector?.('[data-world-analysis-live]');
    if (!live) return false;
    live.innerHTML = buildAnalysisProviderPanelPreviewHtml(settings, status);
    return true;
  };
  const renderAnalysisProviderSettingsPanelHtml = (settings = getSettings(), options = {}) => {
    const analysis = normalizeAnalysisProviderSettings(settings.analysisProvider || {});
    const open = options?.open === true;
    return `
      <details class="speech-dd world-corex-analysis-panel" style="margin-top:10px"${open ? ' open' : ''}>
        <summary>Analysis Provider</summary>
        <div style="margin-top:8px;padding:10px 12px;border-radius:10px;border:1px solid rgba(148,163,184,0.22);background:rgba(15,23,42,0.08)">
          <div data-world-analysis-live>
            ${buildAnalysisProviderPanelPreviewHtml(analysis)}
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-top:10px">
            <label class="scope-section-note"><input type="checkbox" data-world-analysis-setting="enabled"${analysis.enabled ? ' checked' : ''}> enabled</label>
            <label class="scope-section-note"><input type="checkbox" data-world-analysis-setting="stageFinalize"${analysis.stages.finalize ? ' checked' : ''}> finalize</label>
            <label class="scope-section-note"><input type="checkbox" data-world-analysis-setting="stageRebuild"${analysis.stages.rebuild ? ' checked' : ''}> rebuild</label>
            <label class="scope-section-note"><input type="checkbox" data-world-analysis-setting="stageManual"${analysis.stages.manual ? ' checked' : ''}> manual</label>
            <label class="scope-section-note"><input type="checkbox" data-world-analysis-setting="autoApply"${analysis.autoApply ? ' checked' : ''}> auto apply</label>
            <label class="scope-section-note"><input type="checkbox" data-world-analysis-setting="debug"${analysis.debug ? ' checked' : ''}> debug</label>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-top:10px">
            <label class="scope-section-note">provider
              <select data-world-analysis-setting="provider" style="width:100%;margin-top:4px">
                ${['openai','openrouter','claude','gemini','vertex','ollama_cloud','copilot','custom'].map(item => `<option value="${escHtml(item)}"${analysis.provider === item ? ' selected' : ''}>${escHtml(item)}</option>`).join('')}
              </select>
            </label>
            <label class="scope-section-note">model
              <input data-world-analysis-setting="model" type="text" value="${escHtml(analysis.model)}" style="width:100%;margin-top:4px">
            </label>
            <label class="scope-section-note">temperature
              <input data-world-analysis-setting="temp" type="number" step="0.05" min="0" max="1.5" value="${escHtml(String(analysis.temp))}" style="width:100%;margin-top:4px">
            </label>
            <label class="scope-section-note">timeout ms
              <input data-world-analysis-setting="timeout" type="number" min="3000" max="180000" value="${escHtml(String(analysis.timeout))}" style="width:100%;margin-top:4px">
            </label>
            <label class="scope-section-note">reasoning preset
              <select data-world-analysis-setting="reasoningPreset" style="width:100%;margin-top:4px">
                ${['auto','gpt','claude','gemini','deepseek','kimi','glm'].map(item => `<option value="${escHtml(item)}"${analysis.reasoningPreset === item ? ' selected' : ''}>${escHtml(item)}</option>`).join('')}
              </select>
            </label>
            <label class="scope-section-note">reasoning effort
              <select data-world-analysis-setting="reasoningEffort" style="width:100%;margin-top:4px">
                ${['none','low','medium','high'].map(item => `<option value="${escHtml(item)}"${analysis.reasoningEffort === item ? ' selected' : ''}>${escHtml(item)}</option>`).join('')}
              </select>
            </label>
            <label class="scope-section-note">reasoning budget
              <input data-world-analysis-setting="reasoningBudgetTokens" type="number" min="0" max="64000" value="${escHtml(String(analysis.reasoningBudgetTokens))}" style="width:100%;margin-top:4px">
            </label>
            <label class="scope-section-note">max completion
              <input data-world-analysis-setting="maxCompletionTokens" type="number" min="256" max="64000" value="${escHtml(String(analysis.maxCompletionTokens))}" style="width:100%;margin-top:4px">
            </label>
            <label class="scope-section-note">response max
              <input data-world-analysis-setting="responseMaxTokens" type="number" min="256" max="12000" value="${escHtml(String(analysis.responseMaxTokens))}" style="width:100%;margin-top:4px">
            </label>
            <label class="scope-section-note">evidence refs
              <input data-world-analysis-setting="maxEvidenceRefs" type="number" min="4" max="32" value="${escHtml(String(analysis.maxEvidenceRefs))}" style="width:100%;margin-top:4px">
            </label>
            <label class="scope-section-note">evidence snippets
              <input data-world-analysis-setting="maxEvidenceSnippets" type="number" min="2" max="16" value="${escHtml(String(analysis.maxEvidenceSnippets))}" style="width:100%;margin-top:4px">
            </label>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
            <label class="scope-section-note">base url
              <input data-world-analysis-setting="url" type="text" value="${escHtml(analysis.url)}" placeholder="https://api.openai.com" style="width:100%;margin-top:4px">
            </label>
            <label class="scope-section-note">api key
              <input data-world-analysis-setting="key" type="password" value="${escHtml(analysis.key)}" placeholder="provider key" style="width:100%;margin-top:4px">
            </label>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
            <button type="button" data-world-analysis-action="save">Save Analysis Settings</button>
            <button type="button" data-world-analysis-action="reset">Reset Defaults</button>
            <button type="button" data-world-analysis-action="audit">World 데이터 감사</button>
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
      if (!root) return;
      const action = String(button.getAttribute('data-world-analysis-action') || '').trim();
      if (!action) return;
      try {
        event.preventDefault?.();
        event.stopPropagation?.();
      } catch (_) {}
      if (action === 'save') {
        try { await window.LIBRA_WorldCoreXAPI?.saveAnalysisProviderFromPanel?.(button, true); } catch (_) {}
        return;
      }
      if (action === 'reset') {
        try { await window.LIBRA_WorldCoreXAPI?.resetAnalysisProviderPanel?.(button); } catch (_) {}
        return;
      }
      if (action === 'audit') {
        try {
          const report = await window.LIBRA_WorldCoreXAPI?.runAudit?.({});
          const warningCount = Number(report?.settingConflicts?.length || 0)
            + Number(report?.timelineConflicts?.length || 0)
            + Number(report?.genreStyleMixingWarnings?.length || 0)
            + Number(report?.hardCanonRisks?.length || 0);
          syncAnalysisProviderPanelPreview(root, getSettings().analysisProvider || {}, `World audit complete · signals ${Number(report?.checkedWorldSignals || 0)} · warnings ${warningCount}`);
          notifyDyListToast(`World audit complete · ${warningCount} warning(s)`);
        } catch (error) {
          const message = compactText(error?.message || String(error || 'audit_failed'), 180);
          syncAnalysisProviderPanelPreview(root, getSettings().analysisProvider || {}, `World audit failed: ${message}`);
          notifyDyListToast(`World audit failed: ${message}`);
        }
      }
    };
    analysisPanelChangeHandler = async (event) => {
      const target = event?.target;
      if (!(target instanceof HTMLElement)) return;
      const root = getAnalysisProviderPanelRoot(target);
      if (!root) return;
      if (target.matches('[data-world-analysis-setting]')) {
        try { await window.LIBRA_WorldCoreXAPI?.saveAnalysisProviderFromPanel?.(target, false); } catch (_) {}
      }
    };
    analysisPanelInputHandler = (event) => {
      const target = event?.target;
      if (!(target instanceof HTMLElement)) return;
      const root = getAnalysisProviderPanelRoot(target);
      if (!root) return;
      if (target.matches('input[data-world-analysis-setting][type="text"], input[data-world-analysis-setting][type="password"], input[data-world-analysis-setting][type="number"]')) {
        queueAnalysisPanelAutoSave(target, 220);
      }
    };
    document.addEventListener('click', analysisPanelClickHandler, true);
    document.addEventListener('change', analysisPanelChangeHandler, true);
    document.addEventListener('input', analysisPanelInputHandler, true);
    analysisPanelHandlersBound = true;
  };

  const pickPreferredChatBucket = () => {
    const chats = persistedState?.chats && typeof persistedState.chats === 'object' ? persistedState.chats : {};
    const entries = Object.entries(chats);
    if (!entries.length) return { chatId: 'global', bucket: {} };
    let best = { chatId: 'global', bucket: chats.global || {} };
    let bestScore = -1;
    entries.forEach(([chatId, bucket]) => {
      const score = (Number(bucket?.turn || 0) * 1000)
        + (Number(bucket?.background?.updatedTurn || 0) * 10)
        + (Number(bucket?.world?.updatedTurn || 0) * 12)
        + Object.keys(bucket?.entities || {}).length
        + Object.keys(bucket?.groups || {}).length;
      if (score > bestScore) {
        best = { chatId, bucket: bucket || {} };
        bestScore = score;
      }
    });
    return best;
  };

  const getCoordinatorDigest = () => {
    const snapshot = getPluginCoordinator()?.buildSnapshot?.() || {};
    const proposals = Array.isArray(snapshot?.recentPatchProposals) ? snapshot.recentPatchProposals : [];
    return {
      modeText: String(snapshot?.mode || '').trim() === 'manual' ? '수동 반영' : '자동 반영',
      runtimeCount: Array.isArray(snapshot?.runtime) ? snapshot.runtime.length : 0,
      pendingCount: proposals.filter(item => String(item?.status || '').trim() === 'pending').length,
      appliedCount: proposals.filter(item => String(item?.status || '').trim() === 'applied').length,
      failedCount: proposals.filter(item => String(item?.status || '').trim() === 'failed').length,
      blockedCount: proposals.filter(item => String(item?.status || '').trim() === 'blocked').length
    };
  };

  const buildDylistRuntimeSnapshot = (settings = getSettings(), input = {}) => {
    const preferred = input?.chatId
      ? { chatId: input.chatId, bucket: input.bucket || persistedState?.chats?.[input.chatId] || {} }
      : pickPreferredChatBucket();
    const chatId = String(preferred?.chatId || 'global');
    const bucket = preferred?.bucket && typeof preferred.bucket === 'object' ? preferred.bucket : {};
    const background = bucket?.background && typeof bucket.background === 'object' ? bucket.background : {};
    const world = bucket?.world && typeof bucket.world === 'object' ? bucket.world : createDefaultWorldBucket();
    const currentTurn = Number(bucket?.turn || background?.updatedTurn || 0);
    const bgHistory = Array.isArray(background?.history) ? background.history : [];
    const bgPromotions = [...bgHistory]
      .filter(item => String(item?.tag || '') === 'BGPROMOTE')
      .sort((left, right) => {
        const turnGap = Number(right?.turn || 0) - Number(left?.turn || 0);
        if (turnGap !== 0) return turnGap;
        return String(right?.date || '').localeCompare(String(left?.date || ''));
      });
    const latestPromotion = bgPromotions[0] || null;
    const recentPromotionCount = bgPromotions.filter((item) => {
      const turn = Number(item?.turn || 0);
      if (!Number.isFinite(turn) || turn <= 0 || !currentTurn) return false;
      return Math.max(0, currentTurn - turn) <= 2;
    }).length;
    const bgEntities = Array.isArray(background?.entities) ? background.entities : [];
    const bgGroups = Array.isArray(background?.groups) ? background.groups : [];
    const topBg = [...bgEntities, ...bgGroups]
      .slice()
      .sort((left, right) => Number(right?.score || 0) - Number(left?.score || 0))
      .slice(0, 3)
      .map(entry => ({
        name: entry?.name || '',
        reason: entry?.reasonLabel || entry?.reason || '장면 밖 후보',
        score: Math.round(Number(entry?.score || 0)),
        type: entry?.type || 'entity'
      }));
    return {
      chatId,
      bucket,
      currentTurn,
      entityCount: Object.keys(bucket?.entities || {}).length,
      groupCount: Object.keys(bucket?.groups || {}).length,
      bgMode: String(settings.bgListMode || 'off'),
      bgScope: String(settings.bgScope || 'recently_exited'),
      bgContextMode: String(settings.bgContextMode || 'indirect'),
      bgEntityCount: bgEntities.length,
      bgGroupCount: bgGroups.length,
      bgUpdatedTurn: Number(background?.updatedTurn || 0),
      bgUpdatedDate: String(background?.updatedDate || ''),
      worldSummary: summarizeWorldSystemFocus(world, settings) || summarizeWorldFocus(world),
      worldUpdatedTurn: Number(world?.updatedTurn || 0),
      worldUpdatedDate: String(world?.updatedDate || ''),
      worldAutonomySummary: compactText(world?.autonomySummary || summarizeWorldAutonomy(world), 220),
      worldDmaCount: Number(world?.dmaStats?.totalEntries || 0),
      worldPressureCount: uniqueTexts([
        ...(Array.isArray(world?.scenePressures) ? world.scenePressures : []),
        ...(Array.isArray(world?.carryoverSignals) ? world.carryoverSignals : []),
        ...(Array.isArray(world?.worldLimits) ? world.worldLimits : []),
        ...(Array.isArray(world?.codexSignals) ? world.codexSignals : []),
        ...(Array.isArray(world?.publicPressure) ? world.publicPressure.map(item => item?.summary || '') : [])
      ], 99).length,
      worldFactionCount: Array.isArray(world?.factions) ? world.factions.length : 0,
      worldThreadCount: Array.isArray(world?.offscreenThreads) ? world.offscreenThreads.length : 0,
      worldRegionCount: Array.isArray(world?.regions) ? world.regions.length : 0,
      worldPropagationCount: Array.isArray(world?.propagation) ? world.propagation.length : 0,
      worldCommandCount: normalizeArrayItems(world?.propagation).filter(item => item?.kind === 'organization-command').length,
      worldSeasonalCount: normalizeArrayItems(world?.propagation).filter(item => item?.kind === 'seasonal-strain').length,
      worldForegroundCount: uniqueTexts([
      ...normalizeArrayItems(world?.timeline?.foregroundSignals || []).map(item => item?.summary || ''),
      ...normalizeArrayItems(world?.offscreenThreads || []).filter(item => item?.foregroundCandidate).map(item => item?.title || item?.summary || '')
    ], 99).length,
      worldCoolingCount: uniqueTexts([
        ...normalizeArrayItems(world?.timeline?.resolvedSignals || []).map(item => item?.summary || ''),
        ...normalizeArrayItems(world?.offscreenThreads || []).filter(item => item?.outcome === 'cooling').map(item => item?.title || item?.summary || '')
      ], 99).length,
      recentPromotionCount,
      latestPromotionText: String(latestPromotion?.text || '').trim(),
      topBg,
      coordinator: getCoordinatorDigest()
    };
  };

  const renderOverviewMetricCard = (label, value, detail = '', tone = '#6aa8ff') => `
    <div style="padding:10px 11px;border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:12px;background:color-mix(in srgb,var(--dy-bg2, #e6eef8) 84%, transparent);box-shadow:inset 2px 0 0 ${tone}">
      <div style="font-size:11px;font-weight:700;color:var(--dy-text2, #607389)">${escHtml(label)}</div>
      <div style="margin-top:6px;font-size:20px;font-weight:800;color:var(--dy-text, #1b3047)">${escHtml(value)}</div>
      ${detail ? `<div class="scope-section-note" style="margin-top:5px">${escHtml(detail)}</div>` : ''}
    </div>
  `;

  const renderWorldCoreXBar = (label, value, tone = '#5db59b') => {
    const pct = Math.max(0, Math.min(100, Math.round(Number(value || 0) * 100)));
    return `
      <div style="padding:8px 9px;border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:10px;background:color-mix(in srgb,var(--dy-bg2, #e6eef8) 88%, transparent)">
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:10.5px;font-weight:800;color:var(--dy-text2, #607389)">
          <span>${escHtml(label)}</span>
          <span>${escHtml(`${pct}%`)}</span>
        </div>
        <div style="height:7px;margin-top:6px;border-radius:999px;background:color-mix(in srgb,var(--dy-bg3, #dbe6f2) 80%, transparent);overflow:hidden">
          <div style="width:${pct}%;height:100%;border-radius:999px;background:linear-gradient(90deg,${tone},#8c7dff)"></div>
        </div>
      </div>
    `;
  };

  const renderWorldCoreXVisualMapHtml = (settings = getSettings(), snapshot = buildDylistRuntimeSnapshot(settings)) => {
    const world = snapshot?.bucket?.world && typeof snapshot.bucket.world === 'object'
      ? snapshot.bucket.world
      : createDefaultWorldBucket();
    let guidance = null;
    try {
      guidance = buildStandardWorldGuidance(world, {
        chatId: snapshot?.chatId || 'global',
        bucket: snapshot?.bucket || {}
      });
    } catch (_) {
      guidance = null;
    }
    const ontology = guidance?.settingOntology || {};
    const genreWeights = guidance?.narrativeGenreWeights?.weights || guidance?.effectiveGenreWeights || {};
    const styleWeights = guidance?.styleWeights || {};
    const genreRows = Object.entries(genreWeights)
      .filter(([, value]) => Number(value || 0) > 0)
      .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))
      .slice(0, 5)
      .map(([key, value]) => renderWorldCoreXBar(key, value, '#5db59b'))
      .join('');
    const styleRows = Object.entries(styleWeights)
      .filter(([, value]) => Number.isFinite(Number(value)))
      .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))
      .slice(0, 5)
      .map(([key, value]) => renderWorldCoreXBar(key, value, '#6aa8ff'))
      .join('');
    const ontologyChips = [
      ontology.primary ? `설정 ${ontology.primary}` : '',
      ontology.era ? `시대 ${ontology.era}` : '',
      ontology.techLevel ? `기술 ${ontology.techLevel}` : '',
      ontology.magicLevel ? `마법 ${ontology.magicLevel}` : '',
      ontology.supernaturalLevel ? `초자연 ${ontology.supernaturalLevel}` : '',
      ontology.worldScale ? `규모 ${ontology.worldScale}` : ''
    ].filter(Boolean);
    const signalTiles = [
      { label: '세력', value: snapshot.worldFactionCount, detail: 'faction pressure', tone: '#74d0a7' },
      { label: '지역', value: snapshot.worldRegionCount, detail: 'regional constraints', tone: '#6aa8ff' },
      { label: '오프스크린', value: snapshot.worldThreadCount, detail: 'background motion', tone: '#ffd36a' },
      { label: '전면 후보', value: snapshot.worldForegroundCount, detail: 'foreground watch', tone: '#ff8a6f' },
      { label: '연쇄', value: snapshot.worldPropagationCount, detail: 'propagation chains', tone: '#9a87ff' }
    ].map(item => `
      <div style="padding:9px 10px;border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:10px;background:color-mix(in srgb,var(--dy-bg2, #e6eef8) 88%, transparent);box-shadow:inset 2px 0 0 ${item.tone}">
        <div style="font-size:10.5px;font-weight:800;color:var(--dy-text2, #607389)">${escHtml(item.label)}</div>
        <div style="margin-top:4px;font-size:18px;font-weight:850;color:var(--dy-text, #1b3047)">${escHtml(String(item.value || 0))}</div>
        <div style="margin-top:3px;font-size:10px;color:var(--dy-text2, #607389)">${escHtml(item.detail)}</div>
      </div>
    `).join('');
    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:10px">
        <div style="padding:12px;border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:14px;background:linear-gradient(180deg,color-mix(in srgb,var(--dy-bg2, #e6eef8) 86%, transparent),color-mix(in srgb,var(--dy-bg3, #dbe6f2) 72%, transparent))">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap">
            <div>
              <div style="font-size:12px;font-weight:850;color:var(--dy-text, #1b3047)">World Profile Lens</div>
              <div class="scope-section-note" style="margin-top:4px">${escHtml(snapshot.worldSummary || '월드 프로필 신호가 아직 충분하지 않습니다.')}</div>
            </div>
            <span class="scope-inline-pill">confidence ${escHtml(`${Math.round(Number(guidance?.confidence || 0.66) * 100)}%`)}</span>
          </div>
          <div class="scope-inline-list" style="margin-top:9px">
            ${(ontologyChips.length ? ontologyChips : ['setting ontology 대기']).map(item => `<span class="scope-inline-pill">${escHtml(item)}</span>`).join('')}
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:7px;margin-top:10px">
            ${signalTiles}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:minmax(0,1fr);gap:8px">
          <div style="padding:10px;border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:12px;background:color-mix(in srgb,var(--dy-bg2, #e6eef8) 84%, transparent)">
            <div style="font-size:11px;font-weight:850;color:var(--dy-text2, #607389)">Narrative Genre Weights</div>
            <div style="display:grid;gap:6px;margin-top:8px">${genreRows || '<div class="scope-section-note">감지된 장르 가중치가 없습니다.</div>'}</div>
          </div>
          <div style="padding:10px;border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:12px;background:color-mix(in srgb,var(--dy-bg2, #e6eef8) 84%, transparent)">
            <div style="font-size:11px;font-weight:850;color:var(--dy-text2, #607389)">Style Weights</div>
            <div style="display:grid;gap:6px;margin-top:8px">${styleRows || '<div class="scope-section-note">스타일 가중치가 아직 없습니다.</div>'}</div>
          </div>
        </div>
      </div>
    `;
  };

  const buildQuickSummaryHeroHtml = (settings = getSettings(), snapshot = buildDylistRuntimeSnapshot(settings)) => {
    const topBgText = snapshot.topBg.length
      ? snapshot.topBg.map(item => `${item.name}(${item.reason})`).join(' · ')
      : '현재 장면 기준 BG 후보가 없습니다.';
    const coordinatorDetail = `대기 ${snapshot.coordinator.pendingCount} · 적용 ${snapshot.coordinator.appliedCount} · 실패 ${snapshot.coordinator.failedCount} · 차단 ${snapshot.coordinator.blockedCount}`;
    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">
        ${renderOverviewMetricCard('활성 채팅', snapshot.chatId, snapshot.currentTurn ? `turn ${snapshot.currentTurn}` : 'turn 정보 없음', '#6aa8ff')}
        ${renderOverviewMetricCard('월드 압력', snapshot.worldPressureCount ? `${snapshot.worldPressureCount}신호` : '대기', snapshot.worldSummary || '현재 월드 압력 요약 없음', '#5db59b')}
        ${renderOverviewMetricCard('전면/냉각', `${snapshot.worldForegroundCount}/${snapshot.worldCoolingCount}`, 'foreground watch / cooling signals', '#ff8a6f')}
        ${renderOverviewMetricCard('추적 버킷', `${snapshot.entityCount}명 · ${snapshot.groupCount}그룹`, `BG ${snapshot.bgEntityCount + snapshot.bgGroupCount}후보`, '#8c7dff')}
        ${renderOverviewMetricCard('코디네이터', snapshot.coordinator.modeText, coordinatorDetail, '#ff8ab8')}
      </div>
      ${renderWorldCoreXVisualMapHtml(settings, snapshot)}
      <div class="scope-inline-list" style="margin-top:10px">
        <span class="scope-inline-pill">BG 맥락: ${escHtml(snapshot.bgContextMode)}</span>
        <span class="scope-inline-pill">최근 BG 갱신: ${escHtml(snapshot.bgUpdatedTurn ? `turn ${snapshot.bgUpdatedTurn}` : '-')}</span>
        <span class="scope-inline-pill">최근 월드 갱신: ${escHtml(snapshot.worldUpdatedTurn ? `turn ${snapshot.worldUpdatedTurn}` : '-')}</span>
        <span class="scope-inline-pill">명령 연쇄: ${escHtml(snapshot.worldCommandCount ? `${snapshot.worldCommandCount}건` : '없음')}</span>
        <span class="scope-inline-pill">계절 부담: ${escHtml(snapshot.worldSeasonalCount ? `${snapshot.worldSeasonalCount}건` : '없음')}</span>
        <span class="scope-inline-pill">런타임 보고: ${escHtml(snapshot.coordinator.runtimeCount)}</span>
      </div>
      <div style="margin-top:10px;padding:10px 11px;border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:10px;background:color-mix(in srgb,var(--dy-bg3, #dbe6f2) 78%, transparent)">
        <div style="font-size:11px;font-weight:700;color:var(--dy-text2, #607389)">현재 BG 포커스</div>
        <div class="scope-section-note" style="margin-top:6px">${escHtml(topBgText)}</div>
      </div>
    `;
  };

  const buildSettingsPreviewBodyHtml = (settings = getSettings()) => {
    const snapshot = buildDylistRuntimeSnapshot(settings);
    const historyTemplateRows = Object.entries(settings.historyTemplates || {}).map(([key, value]) => `
      <div class="scope-section-note" style="margin-top:6px">
        <strong>${escHtml(key)}</strong>
        <div style="margin-top:4px;color:var(--dy-text2, #607389)">${escHtml(compactText(value, 180))}</div>
      </div>
    `).join('');
    const axisPreviewRows = Object.entries(settings.groupAxisDescriptions || {}).map(([key, values]) => `
      <div class="scope-section-note" style="margin-top:6px">
        <strong>${escHtml(key)}</strong>
        <div style="margin-top:4px;color:var(--dy-text2, #607389)">${escHtml((Array.isArray(values) ? values : []).join(' · ') || '설명 없음')}</div>
      </div>
    `).join('');
    return `
      ${buildQuickSummaryHeroHtml(settings, snapshot)}
      <div class="scope-inline-list" style="margin-top:10px">
        <span class="scope-inline-pill">히스토리 버퍼: ${escHtml(settings.maxHistoryItems)}</span>
        <span class="scope-inline-pill">화면 표시: ${escHtml(settings.maxDisplayHistory)}</span>
        <span class="scope-inline-pill">최근 피드: ${escHtml(settings.maxRecentHistory)}</span>
        <span class="scope-inline-pill">월드 신호: ${escHtml(settings.trackWorldSignals ? 'ON' : 'OFF')}</span>
        <span class="scope-inline-pill">구조 추적: ${escHtml(settings.trackStructuralWorld ? 'ON' : 'OFF')}</span>
        <span class="scope-inline-pill">월드 프롬프트: ${escHtml(settings.worldPromptMode || 'balanced')}</span>
        <span class="scope-inline-pill">프롬프트 밀도: ${escHtml(settings.worldPromptDensity || 'balanced')}</span>
        <span class="scope-inline-pill">dossier 모드: ${escHtml(settings.worldDossierMode || 'focused')}</span>
        <span class="scope-inline-pill">세력 강조: ${escHtml(settings.factionEmphasis || 'balanced')}</span>
        <span class="scope-inline-pill">오프스크린 진행선: ${escHtml(settings.offscreenThreadStrength || 'balanced')}</span>
        <span class="scope-inline-pill">지역 인지: ${escHtml(settings.regionAwareness ? 'ON' : 'OFF')}</span>
        <span class="scope-inline-pill">그룹 축 설명: ${escHtml(settings.showGroupAxisDescriptions ? 'ON' : 'OFF')}</span>
        <span class="scope-inline-pill">남성 추적: ${escHtml(settings.dlMaleTrack ? 'ON' : 'OFF')}</span>
        <span class="scope-inline-pill">추적 상한: ${escHtml(Number(settings.dlCharTrackLimit || 0) > 0 ? String(settings.dlCharTrackLimit) : '∞')}</span>
        <span class="scope-inline-pill">BG 모드: ${escHtml(settings.bgListMode || 'off')}</span>
        <span class="scope-inline-pill">BG 범위: ${escHtml(settings.bgScope || 'recently_exited')}</span>
        <span class="scope-inline-pill">BG 맥락: ${escHtml(settings.bgContextMode || 'indirect')}</span>
      </div>
      <div class="scope-section-note" style="margin-top:10px"><strong>히스토리 포맷</strong></div>
      ${historyTemplateRows || '<div class="scope-section-note">설정된 히스토리 포맷이 없습니다.</div>'}
      <div class="scope-section-note" style="margin-top:10px"><strong>그룹 축 설명</strong></div>
      ${axisPreviewRows || '<div class="scope-section-note">설정된 축 설명이 없습니다.</div>'}
      <div class="scope-section-note" style="margin-top:10px">런타임 오버라이드는 <code>window.LIBRA_WorldCoreXSettings</code>에 넣으면 즉시 반영됩니다.</div>
    `;
  };

  const detectHistoryProfile = (settings = getSettings()) => {
    const buffer = Number(settings.maxHistoryItems || 0);
    const display = Number(settings.maxDisplayHistory || 0);
    const recent = Number(settings.maxRecentHistory || 0);
    return Object.entries(HISTORY_PROFILES).find(([, profile]) => (
      buffer === Number(profile.maxHistoryItems)
      && display === Number(profile.maxDisplayHistory)
      && recent === Number(profile.maxRecentHistory)
    ))?.[0] || 'custom';
  };
  const detectTrackLimitPreset = (settings = getSettings()) => {
    const current = clampNonNegativeInt(settings.dlCharTrackLimit, 0);
    return Object.entries(TRACK_LIMIT_PRESETS).find(([, value]) => current === value)?.[0] || 'custom';
  };
  const isCompactPresetSettings = (settings = getSettings()) => (
    detectHistoryProfile(settings) === 'compact'
    && settings.showGroupAxisDescriptions === false
  );
  const buildProfileButtonClass = (active) => `btn ${active ? 'bp' : 'bs'}`;
  const renderToggleGroupButtons = (items = [], currentValue, actionName) => items.map((item) => `
    <button
      type="button"
      class="${buildProfileButtonClass(String(item.value) === String(currentValue))}"
      data-dylist-group="${escHtml(actionName)}"
      data-dylist-value="${escHtml(item.value)}"
    >${escHtml(item.label)}</button>
  `).join('');

  const buildQuickControlStatusHtml = (settings = getSettings()) => {
    const snapshot = buildDylistRuntimeSnapshot(settings);
    return `
      ${buildQuickSummaryHeroHtml(settings, snapshot)}
      <div class="scope-inline-list" style="margin-top:10px">
        <span class="scope-inline-pill">그룹 축 설명: ${escHtml(settings.showGroupAxisDescriptions ? 'ON' : 'OFF')}</span>
        <span class="scope-inline-pill">남성 추적: ${escHtml(settings.dlMaleTrack ? 'ON' : 'OFF')}</span>
        <span class="scope-inline-pill">추적 범위: ${escHtml(detectTrackLimitPreset(settings) === 'custom' ? `${settings.dlCharTrackLimit || 0}` : detectTrackLimitPreset(settings))}</span>
        <span class="scope-inline-pill">BG: ${escHtml(settings.bgListMode || 'off')}</span>
        <span class="scope-inline-pill">BG 범위: ${escHtml(settings.bgScope || 'recently_exited')}</span>
        <span class="scope-inline-pill">구조 월드: ${escHtml(settings.trackStructuralWorld ? 'ON' : 'OFF')}</span>
        <span class="scope-inline-pill">세력 강조: ${escHtml(settings.factionEmphasis || 'balanced')}</span>
        <span class="scope-inline-pill">오프스크린 진행선: ${escHtml(settings.offscreenThreadStrength || 'balanced')}</span>
      </div>
    `;
  };

  const renderQuickRuntimeControlsHtml = (settings = getSettings()) => {
    const historyProfile = detectHistoryProfile(settings);
    const historyProfileDescription = HISTORY_PROFILE_DESCRIPTIONS[historyProfile] || HISTORY_PROFILE_DESCRIPTIONS.custom;
    const trackPreset = detectTrackLimitPreset(settings);
    const trackPresetDescription = TRACK_SCOPE_DESCRIPTIONS[trackPreset] || TRACK_SCOPE_DESCRIPTIONS.custom;
    const bgMode = String(settings.bgListMode || 'off');
    const bgScope = String(settings.bgScope || 'recently_exited');
    const bgContextMode = String(settings.bgContextMode || 'indirect');
    return `
      <div style="margin-top:10px;padding:10px;border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:10px;background:color-mix(in srgb,var(--dy-bg2, #e6eef8) 82%, transparent)">
        <div class="insp-section-title" style="font-size:12px">실시간 추적 제어</div>
        <div class="scope-section-note" style="margin-top:6px">현재 장면 추적에 바로 반영되는 핵심 항목만 남겼습니다.</div>
        <div class="tr" style="margin-top:8px">
          <label>그룹 축 설명</label>
          <label class="tog">
            <input data-dylist-toggle="showGroupAxisDescriptions" type="checkbox" ${settings.showGroupAxisDescriptions ? 'checked' : ''}>
            <span class="tsl"></span>
          </label>
        </div>
        <div class="scope-section-note" style="margin-top:4px">${escHtml(QUICK_TOGGLE_DESCRIPTIONS.showGroupAxisDescriptions)}</div>
        <div class="tr" style="margin-top:8px">
          <label>남성 캐릭터 적극 추적</label>
          <label class="tog">
            <input data-dylist-toggle="dlMaleTrack" type="checkbox" ${settings.dlMaleTrack ? 'checked' : ''}>
            <span class="tsl"></span>
          </label>
        </div>
        <div class="scope-section-note" style="margin-top:4px">${escHtml(QUICK_TOGGLE_DESCRIPTIONS.dlMaleTrack)}</div>
        <div style="margin-top:10px">
          <div style="font-size:11px;font-weight:700;margin-bottom:6px;color:var(--dy-text2, #607389)">추적 범위 프리셋</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${renderToggleGroupButtons([
              { value: 'unlimited', label: '무제한' },
              { value: 'focused', label: '집중형' },
              { value: 'tight', label: '좁게' }
            ], trackPreset, 'setTrackLimitPreset')}
          </div>
          <div class="scope-section-note" data-dylist-track-description style="margin-top:6px">${escHtml(trackPresetDescription)}</div>
          <div class="scope-section-note" data-dylist-track-custom-note style="margin-top:6px;${trackPreset === 'custom' ? '' : 'display:none;'}">현재는 커스텀 추적 수 (${escHtml(settings.dlCharTrackLimit)})가 적용 중입니다.</div>
        </div>
        <details style="margin-top:8px;border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:8px;background:color-mix(in srgb,var(--dy-bg3, #dbe6f2) 82%, transparent)">
          <summary style="cursor:pointer;font-size:11px;font-weight:700">추적 상한 직접 입력</summary>
          <div class="scope-section-note" style="margin-top:8px">프리셋 대신 추적 인물 상한을 직접 설정합니다. 0은 무제한입니다.</div>
          <label style="display:block;margin-top:8px">
            <div style="font-size:11px;font-weight:600;margin-bottom:4px">추적 상한 (0=∞)</div>
            <input data-dylist-setting="dlCharTrackLimit" type="number" min="0" value="${escHtml(settings.dlCharTrackLimit || 0)}" style="width:100%;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">
          </label>
        </details>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
          <button type="button" class="btn bs" data-dylist-explicit-save="true">저장</button>
        </div>
        <div class="scope-section-note dylist-settings-status" style="margin-top:8px">토글/입력 변경 시 즉시 저장됩니다.</div>
      </div>
      <div style="margin-top:10px;padding:10px;border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:10px;background:color-mix(in srgb,var(--dy-bg2, #e6eef8) 82%, transparent)">
        <div class="insp-section-title" style="font-size:12px">BG / 장면 밖 추적</div>
        <div class="scope-section-note" style="margin-top:6px">장면 밖 인물/그룹을 World Core X continuity 힌트로 함께 추적합니다.</div>
        <label style="display:block;margin-top:10px">
          <div style="font-size:11px;font-weight:700;margin-bottom:6px;color:var(--dy-text2, #607389)">BG 모드</div>
          <select data-dylist-setting="bgListMode" style="width:100%;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">
            <option value="off" ${bgMode === 'off' ? 'selected' : ''}>끄기</option>
            <option value="main" ${bgMode === 'main' ? 'selected' : ''}>메인</option>
            <option value="aux" ${bgMode === 'aux' ? 'selected' : ''}>보조</option>
          </select>
        </label>
        <div class="scope-section-note" style="margin-top:4px" data-dylist-bg-mode-description>${escHtml(BG_MODE_DESCRIPTIONS[bgMode] || BG_MODE_DESCRIPTIONS.off)}</div>
        <label style="display:block;margin-top:10px">
          <div style="font-size:11px;font-weight:700;margin-bottom:6px;color:var(--dy-text2, #607389)">BG 범위</div>
          <select data-dylist-setting="bgScope" style="width:100%;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">
            <option value="mentioned_untracked" ${bgScope === 'mentioned_untracked' ? 'selected' : ''}>언급되었으나 미등록</option>
            <option value="recently_exited" ${bgScope === 'recently_exited' ? 'selected' : ''}>직전 장면 퇴장</option>
            <option value="current_location" ${bgScope === 'current_location' ? 'selected' : ''}>현재 장소 범위</option>
            <option value="current_country" ${bgScope === 'current_country' ? 'selected' : ''}>현재 국가 범위</option>
            <option value="unrestricted" ${bgScope === 'unrestricted' ? 'selected' : ''}>장소 제한 없음</option>
            <option value="random" ${bgScope === 'random' ? 'selected' : ''}>랜덤</option>
          </select>
        </label>
        <div class="scope-section-note" style="margin-top:4px" data-dylist-bg-scope-description>${escHtml(BG_SCOPE_DESCRIPTIONS[bgScope] || BG_SCOPE_DESCRIPTIONS.recently_exited)}</div>
        <label style="display:block;margin-top:10px">
          <div style="font-size:11px;font-weight:700;margin-bottom:6px;color:var(--dy-text2, #607389)">BG 맥락</div>
          <select data-dylist-setting="bgContextMode" style="width:100%;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">
            <option value="direct" ${bgContextMode === 'direct' ? 'selected' : ''}>직결 관련</option>
            <option value="indirect" ${bgContextMode === 'indirect' ? 'selected' : ''}>간접 관련</option>
            <option value="time_shared" ${bgContextMode === 'time_shared' ? 'selected' : ''}>시간만 공유</option>
            <option value="random" ${bgContextMode === 'random' ? 'selected' : ''}>랜덤</option>
          </select>
        </label>
        <div class="scope-section-note" style="margin-top:4px" data-dylist-bg-context-description>${escHtml(BG_CONTEXT_DESCRIPTIONS[bgContextMode] || BG_CONTEXT_DESCRIPTIONS.indirect)}</div>
      </div>
      <div style="margin-top:10px;padding:10px;border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:10px;background:color-mix(in srgb,var(--dy-bg2, #e6eef8) 82%, transparent)">
        <div class="insp-section-title" style="font-size:12px">World Continuity</div>
        <div class="scope-section-note" style="margin-top:6px">scene pressure, carryover, world limit, dossier 신호를 따로 추적해 World Core X를 월드 강화 플러그인으로 사용합니다.</div>
        <div class="tr" style="margin-top:8px">
          <label>월드 신호 추적</label>
          <label class="tog">
            <input data-dylist-setting="trackWorldSignals" type="checkbox" ${settings.trackWorldSignals ? 'checked' : ''}>
            <span class="tsl"></span>
          </label>
        </div>
        <div class="tr" style="margin-top:8px">
          <label>구조 월드 추적</label>
          <label class="tog">
            <input data-dylist-setting="trackStructuralWorld" type="checkbox" ${settings.trackStructuralWorld ? 'checked' : ''}>
            <span class="tsl"></span>
          </label>
        </div>
        <label style="display:block;margin-top:10px">
          <div style="font-size:11px;font-weight:700;margin-bottom:6px;color:var(--dy-text2, #607389)">월드 프롬프트 강도</div>
          <select data-dylist-setting="worldPromptMode" style="width:100%;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">
            <option value="light" ${String(settings.worldPromptMode || 'balanced') === 'light' ? 'selected' : ''}>가볍게</option>
            <option value="balanced" ${String(settings.worldPromptMode || 'balanced') === 'balanced' ? 'selected' : ''}>균형</option>
            <option value="heavy" ${String(settings.worldPromptMode || 'balanced') === 'heavy' ? 'selected' : ''}>강하게</option>
          </select>
        </label>
        <div class="scope-section-note" style="margin-top:4px" data-dylist-world-prompt-description>${escHtml(WORLD_PROMPT_MODE_DESCRIPTIONS[String(settings.worldPromptMode || 'balanced')] || WORLD_PROMPT_MODE_DESCRIPTIONS.balanced)}</div>
        <label style="display:block;margin-top:10px">
          <div style="font-size:11px;font-weight:700;margin-bottom:6px;color:var(--dy-text2, #607389)">월드 프롬프트 밀도</div>
          <select data-dylist-setting="worldPromptDensity" style="width:100%;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">
            <option value="light" ${String(settings.worldPromptDensity || 'balanced') === 'light' ? 'selected' : ''}>가볍게</option>
            <option value="balanced" ${String(settings.worldPromptDensity || 'balanced') === 'balanced' ? 'selected' : ''}>균형</option>
            <option value="heavy" ${String(settings.worldPromptDensity || 'balanced') === 'heavy' ? 'selected' : ''}>강하게</option>
          </select>
        </label>
        <div class="scope-section-note" style="margin-top:4px" data-dylist-world-density-description>${escHtml(WORLD_PROMPT_DENSITY_DESCRIPTIONS[String(settings.worldPromptDensity || 'balanced')] || WORLD_PROMPT_DENSITY_DESCRIPTIONS.balanced)}</div>
        <label style="display:block;margin-top:10px">
          <div style="font-size:11px;font-weight:700;margin-bottom:6px;color:var(--dy-text2, #607389)">월드 dossier 모드</div>
          <select data-dylist-setting="worldDossierMode" style="width:100%;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">
            <option value="off" ${String(settings.worldDossierMode || 'focused') === 'off' ? 'selected' : ''}>끄기</option>
            <option value="focused" ${String(settings.worldDossierMode || 'focused') === 'focused' ? 'selected' : ''}>집중형</option>
            <option value="expanded" ${String(settings.worldDossierMode || 'focused') === 'expanded' ? 'selected' : ''}>확장형</option>
          </select>
        </label>
        <div class="scope-section-note" style="margin-top:4px" data-dylist-world-dossier-description>${escHtml(WORLD_DOSSIER_MODE_DESCRIPTIONS[String(settings.worldDossierMode || 'focused')] || WORLD_DOSSIER_MODE_DESCRIPTIONS.focused)}</div>
        <label style="display:block;margin-top:10px">
          <div style="font-size:11px;font-weight:700;margin-bottom:6px;color:var(--dy-text2, #607389)">오프스크린 진행선 강도</div>
          <select data-dylist-setting="offscreenThreadStrength" style="width:100%;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">
            <option value="light" ${String(settings.offscreenThreadStrength || 'balanced') === 'light' ? 'selected' : ''}>가볍게</option>
            <option value="balanced" ${String(settings.offscreenThreadStrength || 'balanced') === 'balanced' ? 'selected' : ''}>균형</option>
            <option value="heavy" ${String(settings.offscreenThreadStrength || 'balanced') === 'heavy' ? 'selected' : ''}>강하게</option>
          </select>
        </label>
        <div class="scope-section-note" style="margin-top:4px" data-dylist-offscreen-thread-description>${escHtml(OFFSCREEN_THREAD_STRENGTH_DESCRIPTIONS[String(settings.offscreenThreadStrength || 'balanced')] || OFFSCREEN_THREAD_STRENGTH_DESCRIPTIONS.balanced)}</div>
        <label style="display:block;margin-top:10px">
          <div style="font-size:11px;font-weight:700;margin-bottom:6px;color:var(--dy-text2, #607389)">세력 강조</div>
          <select data-dylist-setting="factionEmphasis" style="width:100%;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">
            <option value="light" ${String(settings.factionEmphasis || 'balanced') === 'light' ? 'selected' : ''}>가볍게</option>
            <option value="balanced" ${String(settings.factionEmphasis || 'balanced') === 'balanced' ? 'selected' : ''}>균형</option>
            <option value="heavy" ${String(settings.factionEmphasis || 'balanced') === 'heavy' ? 'selected' : ''}>강하게</option>
          </select>
        </label>
        <div class="scope-section-note" style="margin-top:4px" data-dylist-faction-emphasis-description>${escHtml(FACTION_EMPHASIS_DESCRIPTIONS[String(settings.factionEmphasis || 'balanced')] || FACTION_EMPHASIS_DESCRIPTIONS.balanced)}</div>
        <div class="tr" style="margin-top:8px">
          <label>지역 인지 강화</label>
          <label class="tog">
            <input data-dylist-setting="regionAwareness" type="checkbox" ${settings.regionAwareness ? 'checked' : ''}>
            <span class="tsl"></span>
          </label>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px">
          <label style="display:block">
            <div style="font-size:11px;font-weight:600;margin-bottom:4px">월드 신호 수</div>
            <input data-dylist-setting="maxWorldSignalItems" type="number" min="1" value="${escHtml(settings.maxWorldSignalItems)}" style="width:100%;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">
          </label>
          <label style="display:block">
            <div style="font-size:11px;font-weight:600;margin-bottom:4px">월드 히스토리</div>
            <input data-dylist-setting="maxWorldHistoryItems" type="number" min="1" value="${escHtml(settings.maxWorldHistoryItems)}" style="width:100%;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">
          </label>
        </div>
      </div>
      <div style="margin-top:10px;padding:10px;border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:10px;background:color-mix(in srgb,var(--dy-bg2, #e6eef8) 82%, transparent)">
        <div class="insp-section-title" style="font-size:12px">히스토리 엔진 제어</div>
        <div class="scope-section-note" style="margin-top:6px">히스토리 버퍼/표시/최근 피드 범위를 즉시 조정합니다.</div>
        <div style="margin-top:10px">
          <div style="font-size:11px;font-weight:700;margin-bottom:6px;color:var(--dy-text2, #607389)">히스토리 프로필</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${renderToggleGroupButtons([
              { value: 'compact', label: '간략' },
              { value: 'standard', label: '기본' },
              { value: 'expanded', label: '확장' }
            ], historyProfile, 'setHistoryProfile')}
          </div>
          <div class="scope-section-note" data-dylist-profile-description style="margin-top:6px">${escHtml(historyProfileDescription)}</div>
          <div class="scope-section-note" data-dylist-profile-custom-note style="margin-top:6px;${historyProfile === 'custom' ? '' : 'display:none;'}">현재는 커스텀 값이 적용 중입니다.</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px">
          <label style="display:block">
            <div style="font-size:11px;font-weight:600;margin-bottom:4px">히스토리 버퍼</div>
            <input data-dylist-setting="maxHistoryItems" type="number" min="1" value="${escHtml(settings.maxHistoryItems)}" style="width:100%;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">
          </label>
          <label style="display:block">
            <div style="font-size:11px;font-weight:600;margin-bottom:4px">화면 표시</div>
            <input data-dylist-setting="maxDisplayHistory" type="number" min="1" value="${escHtml(settings.maxDisplayHistory)}" style="width:100%;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">
          </label>
          <label style="display:block">
            <div style="font-size:11px;font-weight:600;margin-bottom:4px">최근 피드</div>
            <input data-dylist-setting="maxRecentHistory" type="number" min="1" value="${escHtml(settings.maxRecentHistory)}" style="width:100%;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">
          </label>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
          <button type="button" class="btn bs" data-dylist-explicit-save="true">저장</button>
        </div>
      </div>
    `;
  };

  const normalizeAxisDescriptionInput = (value = '') => {
    const normalized = String(value || '').replace(/\r/g, '\n');
    const parts = normalized
      .split(/\n|·|[,/]|[;；]/)
      .map(item => item.trim())
      .filter(Boolean);
    return parts.slice(0, 3);
  };

  const renderSettingsFormHtml = (settings = getSettings(), options = {}) => {
    const isFull = options?.mode === 'full';
    const editableTemplates = isFull
      ? ['REGISTER', 'STATUS', 'ACT', 'GROUPSET', 'GROUPCHANGE']
      : ['ACT', 'GROUPSET', 'GROUPCHANGE'];
    const templateInputs = editableTemplates.map((key) => `
      <details style="margin-top:8px;border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px;background:color-mix(in srgb,var(--dy-bg3, #dbe6f2) 82%, transparent)">
        <summary style="cursor:pointer;font-size:11px;font-weight:700">${escHtml(key)}</summary>
        <textarea data-dylist-history-template="${escHtml(key)}" rows="2" style="margin-top:8px;width:100%;resize:vertical;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">${escHtml(settings.historyTemplates?.[key] || '')}</textarea>
      </details>
    `).join('');
    const axisInputs = isFull ? Object.entries(settings.groupAxisDescriptions || {}).map(([key, values]) => `
      <details style="margin-top:8px;border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px;background:color-mix(in srgb,var(--dy-bg3, #dbe6f2) 82%, transparent)">
        <summary style="cursor:pointer;font-size:11px;font-weight:700">${escHtml(key)}</summary>
        <textarea data-dylist-group-axis="${escHtml(key)}" rows="2" style="margin-top:8px;width:100%;resize:vertical;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">${escHtml((Array.isArray(values) ? values : []).join(' · '))}</textarea>
      </details>
    `).join('') : '';
    const historyProfile = detectHistoryProfile(settings);
    const trackPreset = detectTrackLimitPreset(settings);
    const historyProfileDescription = HISTORY_PROFILE_DESCRIPTIONS[historyProfile] || HISTORY_PROFILE_DESCRIPTIONS.custom;
    const trackPresetDescription = TRACK_SCOPE_DESCRIPTIONS[trackPreset] || TRACK_SCOPE_DESCRIPTIONS.custom;
    const bgMode = String(settings.bgListMode || 'off');
    const bgScope = String(settings.bgScope || 'recently_exited');
    const bgContextMode = String(settings.bgContextMode || 'indirect');
    return `
      <div style="margin-top:10px;padding:10px;border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:10px;background:color-mix(in srgb,var(--dy-bg2, #e6eef8) 82%, transparent)">
        <div class="insp-section-title" style="font-size:12px">${isFull ? 'World Core X 제어' : '빠른 제어'}</div>
        <div class="scope-section-note" style="margin-top:6px">남아 있는 핵심 설정만 프리셋과 토글 중심으로 다룹니다.</div>
        <div style="margin-top:10px">
          <div style="font-size:11px;font-weight:700;margin-bottom:6px;color:var(--dy-text2, #607389)">히스토리 프로필</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${renderToggleGroupButtons([
              { value: 'compact', label: '간략' },
              { value: 'standard', label: '기본' },
              { value: 'expanded', label: '확장' }
            ], historyProfile, 'setHistoryProfile')}
          </div>
          <div class="scope-section-note" data-dylist-profile-description style="margin-top:6px">${escHtml(historyProfileDescription)}</div>
          <div class="scope-section-note" data-dylist-profile-custom-note style="margin-top:6px;${historyProfile === 'custom' ? '' : 'display:none;'}">현재는 커스텀 값이 적용 중입니다.</div>
        </div>
        <div class="tr" style="margin-top:8px">
          <label>Axis Description</label>
          <label class="tog">
            <input data-dylist-toggle="showGroupAxisDescriptions" type="checkbox" ${settings.showGroupAxisDescriptions ? 'checked' : ''}>
            <span class="tsl"></span>
          </label>
        </div>
        <div class="scope-section-note" style="margin-top:4px">${escHtml(QUICK_TOGGLE_DESCRIPTIONS.showGroupAxisDescriptions)}</div>
        <div class="tr" style="margin-top:8px">
          <label>남성 캐릭터 적극 추적</label>
          <label class="tog">
            <input data-dylist-toggle="dlMaleTrack" type="checkbox" ${settings.dlMaleTrack ? 'checked' : ''}>
            <span class="tsl"></span>
          </label>
        </div>
        <div class="scope-section-note" style="margin-top:4px">${escHtml(QUICK_TOGGLE_DESCRIPTIONS.dlMaleTrack)}</div>
        <div style="margin-top:10px">
          <div style="font-size:11px;font-weight:700;margin-bottom:6px;color:var(--dy-text2, #607389)">추적 범위</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${renderToggleGroupButtons([
              { value: 'unlimited', label: '무제한' },
              { value: 'focused', label: '집중형' },
              { value: 'tight', label: '좁게' }
            ], trackPreset, 'setTrackLimitPreset')}
          </div>
          <div class="scope-section-note" data-dylist-track-description style="margin-top:6px">${escHtml(trackPresetDescription)}</div>
          <div class="scope-section-note" data-dylist-track-custom-note style="margin-top:6px;${trackPreset === 'custom' ? '' : 'display:none;'}">현재는 커스텀 추적 수 (${escHtml(settings.dlCharTrackLimit)})가 적용 중입니다.</div>
        </div>
        ${isFull ? `
        <details open style="margin-top:8px;border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:8px;background:color-mix(in srgb,var(--dy-bg3, #dbe6f2) 82%, transparent)">
          <summary style="cursor:pointer;font-size:11px;font-weight:700">BG / Off-screen 추적</summary>
          <div class="scope-section-note" style="margin-top:8px">원본 Dynamic-List의 BG 리스트 성격을 이어 받아, 장면 밖 캐릭터/그룹을 continuity 힌트로 붙입니다.</div>
          <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:8px">
            <label style="display:block">
              <div style="font-size:11px;font-weight:600;margin-bottom:4px">BG 모드</div>
              <select data-dylist-setting="bgListMode" style="width:100%;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">
                <option value="off" ${bgMode === 'off' ? 'selected' : ''}>끄기</option>
                <option value="main" ${bgMode === 'main' ? 'selected' : ''}>메인</option>
                <option value="aux" ${bgMode === 'aux' ? 'selected' : ''}>보조</option>
              </select>
            </label>
            <label style="display:block">
              <div style="font-size:11px;font-weight:600;margin-bottom:4px">BG 범위</div>
              <select data-dylist-setting="bgScope" style="width:100%;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">
                <option value="mentioned_untracked" ${bgScope === 'mentioned_untracked' ? 'selected' : ''}>언급되었으나 미등록</option>
                <option value="recently_exited" ${bgScope === 'recently_exited' ? 'selected' : ''}>직전 장면 퇴장</option>
                <option value="current_location" ${bgScope === 'current_location' ? 'selected' : ''}>현재 장소 범위</option>
                <option value="current_country" ${bgScope === 'current_country' ? 'selected' : ''}>현재 국가 범위</option>
                <option value="unrestricted" ${bgScope === 'unrestricted' ? 'selected' : ''}>장소 제한 없음</option>
                <option value="random" ${bgScope === 'random' ? 'selected' : ''}>랜덤</option>
              </select>
            </label>
            <label style="display:block">
              <div style="font-size:11px;font-weight:600;margin-bottom:4px">BG 맥락</div>
              <select data-dylist-setting="bgContextMode" style="width:100%;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">
                <option value="direct" ${bgContextMode === 'direct' ? 'selected' : ''}>직결 관련</option>
                <option value="indirect" ${bgContextMode === 'indirect' ? 'selected' : ''}>간접 관련</option>
                <option value="time_shared" ${bgContextMode === 'time_shared' ? 'selected' : ''}>시간만 공유</option>
                <option value="random" ${bgContextMode === 'random' ? 'selected' : ''}>랜덤</option>
              </select>
            </label>
          </div>
          <div class="scope-section-note" style="margin-top:8px" data-dylist-bg-mode-description>${escHtml(BG_MODE_DESCRIPTIONS[bgMode] || BG_MODE_DESCRIPTIONS.off)}</div>
          <div class="scope-section-note" style="margin-top:4px" data-dylist-bg-scope-description>${escHtml(BG_SCOPE_DESCRIPTIONS[bgScope] || BG_SCOPE_DESCRIPTIONS.recently_exited)}</div>
          <div class="scope-section-note" style="margin-top:4px" data-dylist-bg-context-description>${escHtml(BG_CONTEXT_DESCRIPTIONS[bgContextMode] || BG_CONTEXT_DESCRIPTIONS.indirect)}</div>
        </details>
        ` : ''}
        ${isFull ? `
        <details open style="margin-top:8px;border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:8px;background:color-mix(in srgb,var(--dy-bg3, #dbe6f2) 82%, transparent)">
          <summary style="cursor:pointer;font-size:11px;font-weight:700">World System 추적</summary>
          <div class="scope-section-note" style="margin-top:8px">장면 압력뿐 아니라 구조 월드, 세력, 지역, 오프스크린 진행선을 함께 추적합니다.</div>
          <div class="tr" style="margin-top:8px">
            <label>월드 신호 추적</label>
            <label class="tog">
              <input data-dylist-setting="trackWorldSignals" type="checkbox" ${settings.trackWorldSignals ? 'checked' : ''}>
              <span class="tsl"></span>
            </label>
          </div>
          <div class="tr" style="margin-top:8px">
            <label>구조 월드 추적</label>
            <label class="tog">
              <input data-dylist-setting="trackStructuralWorld" type="checkbox" ${settings.trackStructuralWorld ? 'checked' : ''}>
              <span class="tsl"></span>
            </label>
          </div>
          <div class="tr" style="margin-top:8px">
            <label>지역 인지 강화</label>
            <label class="tog">
              <input data-dylist-setting="regionAwareness" type="checkbox" ${settings.regionAwareness ? 'checked' : ''}>
              <span class="tsl"></span>
            </label>
          </div>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px">
            <label style="display:block">
              <div style="font-size:11px;font-weight:600;margin-bottom:4px">월드 프롬프트 강도</div>
              <select data-dylist-setting="worldPromptMode" style="width:100%;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">
                <option value="light" ${String(settings.worldPromptMode || 'balanced') === 'light' ? 'selected' : ''}>가볍게</option>
                <option value="balanced" ${String(settings.worldPromptMode || 'balanced') === 'balanced' ? 'selected' : ''}>균형</option>
                <option value="heavy" ${String(settings.worldPromptMode || 'balanced') === 'heavy' ? 'selected' : ''}>강하게</option>
              </select>
            </label>
            <label style="display:block">
              <div style="font-size:11px;font-weight:600;margin-bottom:4px">프롬프트 밀도</div>
              <select data-dylist-setting="worldPromptDensity" style="width:100%;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">
                <option value="light" ${String(settings.worldPromptDensity || 'balanced') === 'light' ? 'selected' : ''}>가볍게</option>
                <option value="balanced" ${String(settings.worldPromptDensity || 'balanced') === 'balanced' ? 'selected' : ''}>균형</option>
                <option value="heavy" ${String(settings.worldPromptDensity || 'balanced') === 'heavy' ? 'selected' : ''}>강하게</option>
              </select>
            </label>
            <label style="display:block">
              <div style="font-size:11px;font-weight:600;margin-bottom:4px">오프스크린 진행선</div>
              <select data-dylist-setting="offscreenThreadStrength" style="width:100%;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">
                <option value="light" ${String(settings.offscreenThreadStrength || 'balanced') === 'light' ? 'selected' : ''}>가볍게</option>
                <option value="balanced" ${String(settings.offscreenThreadStrength || 'balanced') === 'balanced' ? 'selected' : ''}>균형</option>
                <option value="heavy" ${String(settings.offscreenThreadStrength || 'balanced') === 'heavy' ? 'selected' : ''}>강하게</option>
              </select>
            </label>
            <label style="display:block">
              <div style="font-size:11px;font-weight:600;margin-bottom:4px">세력 강조</div>
              <select data-dylist-setting="factionEmphasis" style="width:100%;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">
                <option value="light" ${String(settings.factionEmphasis || 'balanced') === 'light' ? 'selected' : ''}>가볍게</option>
                <option value="balanced" ${String(settings.factionEmphasis || 'balanced') === 'balanced' ? 'selected' : ''}>균형</option>
                <option value="heavy" ${String(settings.factionEmphasis || 'balanced') === 'heavy' ? 'selected' : ''}>강하게</option>
              </select>
            </label>
          </div>
          <div class="scope-section-note" style="margin-top:8px" data-dylist-world-prompt-description>${escHtml(WORLD_PROMPT_MODE_DESCRIPTIONS[String(settings.worldPromptMode || 'balanced')] || WORLD_PROMPT_MODE_DESCRIPTIONS.balanced)}</div>
          <div class="scope-section-note" style="margin-top:4px" data-dylist-world-density-description>${escHtml(WORLD_PROMPT_DENSITY_DESCRIPTIONS[String(settings.worldPromptDensity || 'balanced')] || WORLD_PROMPT_DENSITY_DESCRIPTIONS.balanced)}</div>
          <div class="scope-section-note" style="margin-top:4px" data-dylist-offscreen-thread-description>${escHtml(OFFSCREEN_THREAD_STRENGTH_DESCRIPTIONS[String(settings.offscreenThreadStrength || 'balanced')] || OFFSCREEN_THREAD_STRENGTH_DESCRIPTIONS.balanced)}</div>
          <div class="scope-section-note" style="margin-top:4px" data-dylist-faction-emphasis-description>${escHtml(FACTION_EMPHASIS_DESCRIPTIONS[String(settings.factionEmphasis || 'balanced')] || FACTION_EMPHASIS_DESCRIPTIONS.balanced)}</div>
        </details>
        ` : ''}
        ${isFull ? `
        <details open style="margin-top:8px;border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:8px;background:color-mix(in srgb,var(--dy-bg3, #dbe6f2) 82%, transparent)">
          <summary style="cursor:pointer;font-size:11px;font-weight:700">직접 수치 조정</summary>
          <div class="scope-section-note" style="margin-top:8px">프리셋 대신 수치를 직접 조정하고 싶을 때만 사용합니다.</div>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px">
            <label style="display:block">
              <div style="font-size:11px;font-weight:600;margin-bottom:4px">버퍼</div>
              <div class="scope-section-note" style="margin-bottom:4px">내부에 보관하는 히스토리 총량입니다.</div>
              <input data-dylist-setting="maxHistoryItems" type="number" min="1" value="${escHtml(settings.maxHistoryItems)}" style="width:100%;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">
            </label>
            <label style="display:block">
              <div style="font-size:11px;font-weight:600;margin-bottom:4px">화면 표시</div>
              <div class="scope-section-note" style="margin-bottom:4px">화면에 바로 보여줄 히스토리 개수입니다.</div>
              <input data-dylist-setting="maxDisplayHistory" type="number" min="1" value="${escHtml(settings.maxDisplayHistory)}" style="width:100%;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">
            </label>
            <label style="display:block">
              <div style="font-size:11px;font-weight:600;margin-bottom:4px">최근 피드</div>
              <div class="scope-section-note" style="margin-bottom:4px">최근 피드에 우선 반영할 기록 범위입니다.</div>
              <input data-dylist-setting="maxRecentHistory" type="number" min="1" value="${escHtml(settings.maxRecentHistory)}" style="width:100%;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">
            </label>
            <label style="display:block">
              <div style="font-size:11px;font-weight:600;margin-bottom:4px">추적 상한 (0=∞)</div>
              <div class="scope-section-note" style="margin-bottom:4px">한 턴에서 적극 추적할 인물 수 상한입니다.</div>
              <input data-dylist-setting="dlCharTrackLimit" type="number" min="0" value="${escHtml(settings.dlCharTrackLimit || 0)}" style="width:100%;background:var(--dy-bg2, #e6eef8);color:var(--dy-text, #1b3047);border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:6px 8px">
            </label>
          </div>
        </details>
        ` : ''}
        <details style="margin-top:8px;border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:8px;background:color-mix(in srgb,var(--dy-bg3, #dbe6f2) 82%, transparent)">
          <summary style="cursor:pointer;font-size:11px;font-weight:700">히스토리 템플릿</summary>
          ${templateInputs}
        </details>
        ${isFull ? `
        <details style="margin-top:8px;border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;padding:8px;background:color-mix(in srgb,var(--dy-bg3, #dbe6f2) 82%, transparent)">
          <summary style="cursor:pointer;font-size:11px;font-weight:700">그룹 축 설명</summary>
          ${axisInputs}
        </details>
        ` : ''}
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
          <button type="button" class="btn" data-dylist-action="applyPreset" data-dylist-value="default">기본값</button>
          <button type="button" class="btn bs" data-dylist-explicit-save="true">저장</button>
        </div>
        <div class="scope-section-note dylist-settings-status" style="margin-top:8px">토글/입력 변경 시 즉시 저장됩니다.</div>
      </div>
    `;
  };

  const readSettingsFromPanel = (root) => {
    const settings = getSettings();
    const next = {
      maxHistoryItems: clampPositiveInt(root?.querySelector('[data-dylist-setting="maxHistoryItems"]')?.value, settings.maxHistoryItems),
      maxDisplayHistory: clampPositiveInt(root?.querySelector('[data-dylist-setting="maxDisplayHistory"]')?.value, settings.maxDisplayHistory),
      maxRecentHistory: clampPositiveInt(root?.querySelector('[data-dylist-setting="maxRecentHistory"]')?.value, settings.maxRecentHistory),
      maxWorldHistoryItems: clampPositiveInt(root?.querySelector('[data-dylist-setting="maxWorldHistoryItems"]')?.value, settings.maxWorldHistoryItems),
      maxWorldSignalItems: clampPositiveInt(root?.querySelector('[data-dylist-setting="maxWorldSignalItems"]')?.value, settings.maxWorldSignalItems),
      showGroupAxisDescriptions: Boolean(root?.querySelector('[data-dylist-setting="showGroupAxisDescriptions"]')?.checked),
      dlMaleTrack: Boolean(root?.querySelector('[data-dylist-toggle="dlMaleTrack"]')?.checked),
      trackWorldSignals: Boolean(root?.querySelector('[data-dylist-setting="trackWorldSignals"]')?.checked),
      trackStructuralWorld: Boolean(root?.querySelector('[data-dylist-setting="trackStructuralWorld"]')?.checked),
      regionAwareness: Boolean(root?.querySelector('[data-dylist-setting="regionAwareness"]')?.checked),
      dlCharTrackLimit: clampNonNegativeInt(root?.querySelector('[data-dylist-setting="dlCharTrackLimit"]')?.value, settings.dlCharTrackLimit),
      bgListMode: String(root?.querySelector('[data-dylist-setting="bgListMode"]')?.value || settings.bgListMode || 'off').trim() || 'off',
      bgScope: String(root?.querySelector('[data-dylist-setting="bgScope"]')?.value || settings.bgScope || 'recently_exited').trim() || 'recently_exited',
      bgContextMode: String(root?.querySelector('[data-dylist-setting="bgContextMode"]')?.value || settings.bgContextMode || 'indirect').trim() || 'indirect',
      worldPromptMode: String(root?.querySelector('[data-dylist-setting="worldPromptMode"]')?.value || settings.worldPromptMode || 'balanced').trim() || 'balanced',
      worldPromptDensity: String(root?.querySelector('[data-dylist-setting="worldPromptDensity"]')?.value || settings.worldPromptDensity || 'balanced').trim() || 'balanced',
      worldDossierMode: String(root?.querySelector('[data-dylist-setting="worldDossierMode"]')?.value || settings.worldDossierMode || 'focused').trim() || 'focused',
      offscreenThreadStrength: String(root?.querySelector('[data-dylist-setting="offscreenThreadStrength"]')?.value || settings.offscreenThreadStrength || 'balanced').trim() || 'balanced',
      factionEmphasis: String(root?.querySelector('[data-dylist-setting="factionEmphasis"]')?.value || settings.factionEmphasis || 'balanced').trim() || 'balanced',
      historyTemplates: {},
      groupAxisDescriptions: {}
    };
    const axisToggle = root?.querySelector('[data-dylist-toggle="showGroupAxisDescriptions"]');
    if (axisToggle instanceof HTMLInputElement) {
      next.showGroupAxisDescriptions = Boolean(axisToggle.checked);
    }
    root?.querySelectorAll('[data-dylist-history-template]').forEach((node) => {
      const key = String(node.getAttribute('data-dylist-history-template') || '').trim();
      if (!key) return;
      next.historyTemplates[key] = String(node.value || '').trim() || DEFAULT_SETTINGS.historyTemplates[key] || '';
    });
    root?.querySelectorAll('[data-dylist-group-axis]').forEach((node) => {
      const key = String(node.getAttribute('data-dylist-group-axis') || '').trim();
      if (!key) return;
      const fallback = Array.isArray(DEFAULT_SETTINGS.groupAxisDescriptions?.[key]) ? DEFAULT_SETTINGS.groupAxisDescriptions[key] : [];
      const values = normalizeAxisDescriptionInput(node.value || '');
      next.groupAxisDescriptions[key] = values.length ? values : fallback;
    });
    return next;
  };

  const syncSettingsPanelPreview = (root, settings = getSettings(), message = '저장됨') => {
    const live = root?.querySelector('.dylist-settings-live');
    if (live) live.innerHTML = buildQuickControlStatusHtml(settings);
    const status = root?.querySelector('.dylist-settings-status');
    if (status) status.textContent = message;
    const historyProfile = detectHistoryProfile(settings);
    const trackPreset = detectTrackLimitPreset(settings);
    const compactToggle = root?.querySelector('[data-dylist-toggle="compactPreset"]');
    if (compactToggle) compactToggle.checked = isCompactPresetSettings(settings);
    const axisToggle = root?.querySelector('[data-dylist-toggle="showGroupAxisDescriptions"]');
    if (axisToggle) axisToggle.checked = Boolean(settings.showGroupAxisDescriptions);
    const maleToggle = root?.querySelector('[data-dylist-toggle="dlMaleTrack"]');
    if (maleToggle) maleToggle.checked = Boolean(settings.dlMaleTrack);
    const worldToggle = root?.querySelector('[data-dylist-setting="trackWorldSignals"]');
    if (worldToggle) worldToggle.checked = Boolean(settings.trackWorldSignals);
    const structuralToggle = root?.querySelector('[data-dylist-setting="trackStructuralWorld"]');
    if (structuralToggle) structuralToggle.checked = Boolean(settings.trackStructuralWorld);
    const regionToggle = root?.querySelector('[data-dylist-setting="regionAwareness"]');
    if (regionToggle) regionToggle.checked = Boolean(settings.regionAwareness);
    const trackLimitInput = root?.querySelector('[data-dylist-setting="dlCharTrackLimit"]');
    if (trackLimitInput) trackLimitInput.value = String(clampNonNegativeInt(settings.dlCharTrackLimit, 0));
    const bgModeSelect = root?.querySelector('[data-dylist-setting="bgListMode"]');
    if (bgModeSelect) bgModeSelect.value = String(settings.bgListMode || 'off');
    const bgScopeSelect = root?.querySelector('[data-dylist-setting="bgScope"]');
    if (bgScopeSelect) bgScopeSelect.value = String(settings.bgScope || 'recently_exited');
    const bgContextSelect = root?.querySelector('[data-dylist-setting="bgContextMode"]');
    if (bgContextSelect) bgContextSelect.value = String(settings.bgContextMode || 'indirect');
    const bgModeDescription = root?.querySelector('[data-dylist-bg-mode-description]');
    if (bgModeDescription) bgModeDescription.textContent = BG_MODE_DESCRIPTIONS[String(settings.bgListMode || 'off')] || BG_MODE_DESCRIPTIONS.off;
    const bgScopeDescription = root?.querySelector('[data-dylist-bg-scope-description]');
    if (bgScopeDescription) bgScopeDescription.textContent = BG_SCOPE_DESCRIPTIONS[String(settings.bgScope || 'recently_exited')] || BG_SCOPE_DESCRIPTIONS.recently_exited;
    const bgContextDescription = root?.querySelector('[data-dylist-bg-context-description]');
    if (bgContextDescription) bgContextDescription.textContent = BG_CONTEXT_DESCRIPTIONS[String(settings.bgContextMode || 'indirect')] || BG_CONTEXT_DESCRIPTIONS.indirect;
    const worldPromptSelect = root?.querySelector('[data-dylist-setting="worldPromptMode"]');
    if (worldPromptSelect) worldPromptSelect.value = String(settings.worldPromptMode || 'balanced');
    const worldPromptDescription = root?.querySelector('[data-dylist-world-prompt-description]');
    if (worldPromptDescription) worldPromptDescription.textContent = WORLD_PROMPT_MODE_DESCRIPTIONS[String(settings.worldPromptMode || 'balanced')] || WORLD_PROMPT_MODE_DESCRIPTIONS.balanced;
    const worldDensitySelect = root?.querySelector('[data-dylist-setting="worldPromptDensity"]');
    if (worldDensitySelect) worldDensitySelect.value = String(settings.worldPromptDensity || 'balanced');
    const worldDensityDescription = root?.querySelector('[data-dylist-world-density-description]');
    if (worldDensityDescription) worldDensityDescription.textContent = WORLD_PROMPT_DENSITY_DESCRIPTIONS[String(settings.worldPromptDensity || 'balanced')] || WORLD_PROMPT_DENSITY_DESCRIPTIONS.balanced;
    const worldDossierSelect = root?.querySelector('[data-dylist-setting="worldDossierMode"]');
    if (worldDossierSelect) worldDossierSelect.value = String(settings.worldDossierMode || 'focused');
    const worldDossierDescription = root?.querySelector('[data-dylist-world-dossier-description]');
    if (worldDossierDescription) worldDossierDescription.textContent = WORLD_DOSSIER_MODE_DESCRIPTIONS[String(settings.worldDossierMode || 'focused')] || WORLD_DOSSIER_MODE_DESCRIPTIONS.focused;
    const offscreenThreadSelect = root?.querySelector('[data-dylist-setting="offscreenThreadStrength"]');
    if (offscreenThreadSelect) offscreenThreadSelect.value = String(settings.offscreenThreadStrength || 'balanced');
    const offscreenThreadDescription = root?.querySelector('[data-dylist-offscreen-thread-description]');
    if (offscreenThreadDescription) offscreenThreadDescription.textContent = OFFSCREEN_THREAD_STRENGTH_DESCRIPTIONS[String(settings.offscreenThreadStrength || 'balanced')] || OFFSCREEN_THREAD_STRENGTH_DESCRIPTIONS.balanced;
    const factionEmphasisSelect = root?.querySelector('[data-dylist-setting="factionEmphasis"]');
    if (factionEmphasisSelect) factionEmphasisSelect.value = String(settings.factionEmphasis || 'balanced');
    const factionEmphasisDescription = root?.querySelector('[data-dylist-faction-emphasis-description]');
    if (factionEmphasisDescription) factionEmphasisDescription.textContent = FACTION_EMPHASIS_DESCRIPTIONS[String(settings.factionEmphasis || 'balanced')] || FACTION_EMPHASIS_DESCRIPTIONS.balanced;
    const maxWorldSignalInput = root?.querySelector('[data-dylist-setting="maxWorldSignalItems"]');
    if (maxWorldSignalInput) maxWorldSignalInput.value = String(clampPositiveInt(settings.maxWorldSignalItems, DEFAULT_SETTINGS.maxWorldSignalItems));
    const maxWorldHistoryInput = root?.querySelector('[data-dylist-setting="maxWorldHistoryItems"]');
    if (maxWorldHistoryInput) maxWorldHistoryInput.value = String(clampPositiveInt(settings.maxWorldHistoryItems, DEFAULT_SETTINGS.maxWorldHistoryItems));
    const historyDescription = root?.querySelector('[data-dylist-profile-description]');
    if (historyDescription) {
      historyDescription.textContent = HISTORY_PROFILE_DESCRIPTIONS[historyProfile] || HISTORY_PROFILE_DESCRIPTIONS.custom;
    }
    const historyCustomNote = root?.querySelector('[data-dylist-profile-custom-note]');
    if (historyCustomNote) {
      historyCustomNote.style.display = historyProfile === 'custom' ? '' : 'none';
    }
    const trackDescription = root?.querySelector('[data-dylist-track-description]');
    if (trackDescription) {
      trackDescription.textContent = TRACK_SCOPE_DESCRIPTIONS[trackPreset] || TRACK_SCOPE_DESCRIPTIONS.custom;
    }
    const trackCustomNote = root?.querySelector('[data-dylist-track-custom-note]');
    if (trackCustomNote) {
      trackCustomNote.textContent = `현재는 커스텀 추적 수 (${clampNonNegativeInt(settings.dlCharTrackLimit, 0)})가 적용 중입니다.`;
      trackCustomNote.style.display = trackPreset === 'custom' ? '' : 'none';
    }
    root?.querySelectorAll('[data-dylist-group="setHistoryProfile"]').forEach((node) => {
      const active = String(node.getAttribute('data-dylist-value') || '') === historyProfile;
      node.className = buildProfileButtonClass(active);
    });
    root?.querySelectorAll('[data-dylist-group="setTrackLimitPreset"]').forEach((node) => {
      const active = String(node.getAttribute('data-dylist-value') || '') === trackPreset;
      node.className = buildProfileButtonClass(active);
    });
  };

  const buildPresetSettings = (presetName) => {
    if (HISTORY_PROFILES[presetName]) return { ...HISTORY_PROFILES[presetName] };
    return {
      maxHistoryItems: DEFAULT_SETTINGS.maxHistoryItems,
      maxDisplayHistory: DEFAULT_SETTINGS.maxDisplayHistory,
      maxRecentHistory: DEFAULT_SETTINGS.maxRecentHistory,
      showGroupAxisDescriptions: DEFAULT_SETTINGS.showGroupAxisDescriptions,
      historyTemplates: { ...DEFAULT_SETTINGS.historyTemplates }
    };
  };

  const getDateTokens = (dateValue) => {
    const fallback = { YY: '', MM: '', DD: '' };
    const parsed = parseDateLike(dateValue);
    if (!parsed) return fallback;
    return {
      YY: String(parsed.getUTCFullYear()),
      MM: String(parsed.getUTCMonth() + 1).padStart(2, '0'),
      DD: String(parsed.getUTCDate()).padStart(2, '0')
    };
  };

  const getEntityLiveDate = (entity = {}) => {
    const timeTracking = getProjectedTimeTracking(entity);
    const status = entity?.status && typeof entity.status === 'object' ? entity.status : {};
    return String(
      timeTracking.currentDate
      || timeTracking.lastInteractionDate
      || status.currentDate
      || formatDateKST()
    ).trim();
  };

  const extractPsychologyModule = (entity = {}) => {
    const corex = getEntityCoreXBridge(entity);
    const module = entity?.psychologyModule && typeof entity.psychologyModule === 'object'
      ? entity.psychologyModule
      : entity?.entitySnapshot?.psychologyModule && typeof entity.entitySnapshot.psychologyModule === 'object'
        ? entity.entitySnapshot.psychologyModule
        : {};
    const engine = entity?.psychologyEngine && typeof entity.psychologyEngine === 'object'
      ? entity.psychologyEngine
      : entity?.entitySnapshot?.psychologyEngine && typeof entity.entitySnapshot.psychologyEngine === 'object'
        ? entity.entitySnapshot.psychologyEngine
        : {};
    const personality = entity?.personality && typeof entity.personality === 'object' ? entity.personality : {};
    const status = entity?.status && typeof entity.status === 'object' ? entity.status : {};
    const mainPsychology = compactText(
      corex?.mind?.coreMind
      || corex?.continuity?.psychologySummary
      || module.mainPsychology
      || (Array.isArray(module.mainPsychology) ? module.mainPsychology[0] : '')
      || (Array.isArray(personality.mainPsychology) ? personality.mainPsychology[0] : '')
      || '',
      120
    );
    const counterPsychology = compactText(
      module.counterPsychology
      || personality.psychologyConflict
      || '',
      120
    );
    const anxietyConditions = compactList(module.anxietyConditions, 3);
    const defenseBehaviors = compactList(module.defenseBehaviors, 3);
    const desires = compactList(module.desires, 3);
    const aspirations = compactList(module.aspirations, 2);
    const mode = compactText(corex?.psyche?.dynamic?.activeMode || engine?.dynamic?.activeMode || '', 60);
    const goal = compactText(corex?.psyche?.dynamic?.currentGoal || engine?.dynamic?.currentGoal || '', 100);
    const pressure = Number.isFinite(Number(engine?.dynamic?.emotionalPressure))
      ? `${Math.round(Math.max(0, Math.min(1, Number(engine.dynamic.emotionalPressure))) * 100)}%`
      : Number.isFinite(Number(corex?.psyche?.dynamic?.emotionalPressure))
        ? `${Math.round(Math.max(0, Math.min(1, Number(corex.psyche.dynamic.emotionalPressure))) * 100)}%`
      : '';
    const styleSummary = compactText([
      Number(engine?.dynamic?.responseStyle?.disclosure || 0) > 0 ? `disc ${Math.round(Number(engine.dynamic.responseStyle.disclosure || 0) * 100)}%` : '',
      Number(engine?.dynamic?.responseStyle?.warmth || 0) > 0 ? `warm ${Math.round(Number(engine.dynamic.responseStyle.warmth || 0) * 100)}%` : '',
      Number(engine?.dynamic?.responseStyle?.directness || 0) > 0 ? `direct ${Math.round(Number(engine.dynamic.responseStyle.directness || 0) * 100)}%` : '',
      Number(engine?.dynamic?.responseStyle?.avoidance || 0) > 0 ? `avoid ${Math.round(Number(engine.dynamic.responseStyle.avoidance || 0) * 100)}%` : ''
    ].filter(Boolean).join(' | '), 180);
    const speechBias = compactText(
      corex?.psyche?.dynamic?.speechBias
      || corex?.expression?.voiceSignature?.sentenceLength
      || entity?.psychologyEngine?.dynamic?.speechBias
      || entity?.entitySnapshot?.psychologyEngine?.dynamic?.speechBias
      || '',
      180
    );
    const emotionSummary = compactText(
      [
        corex?.psyche?.emotionBridge?.mood ? `mood ${corex.psyche.emotionBridge.mood}` : '',
        corex?.psyche?.emotionBridge?.signature ? `emotion ${corex.psyche.emotionBridge.signature}` : '',
        status.currentMood ? `mood ${status.currentMood}` : '',
        status.emotionSignature ? `emotion ${status.emotionSignature}` : '',
        status.emotionBlend ? `blend ${status.emotionBlend}` : '',
        Number(status.emotionIntensity || 0) > 0 ? `intensity ${Math.round(Number(status.emotionIntensity || 0) * 100)}%` : ''
      ].filter(Boolean).join(' | '),
      180
    );
    return {
      mainPsychology,
      counterPsychology,
      anxietyConditions: anxietyConditions || compactList(corex?.mind?.branches?.fear?.summary || '', 2),
      defenseBehaviors: defenseBehaviors || compactList(corex?.mind?.branches?.mask?.summary || '', 2),
      desires: desires || compactList(corex?.mind?.branches?.desire?.summary || '', 3),
      aspirations: aspirations || compactList(corex?.development?.mediumTermGoals || [], 2),
      mode,
      goal,
      pressure,
      styleSummary,
      speechBias,
      emotionSummary
    };
  };

  const buildPsychologySummary = (entity = {}) => {
    const psychology = extractPsychologyModule(entity);
    return compactText(
      [
        psychology.mainPsychology ? `주요 ${psychology.mainPsychology}` : '',
        psychology.counterPsychology ? `대항 ${psychology.counterPsychology}` : '',
        psychology.desires ? `욕구 ${psychology.desires}` : '',
        psychology.mode ? `모드 ${psychology.mode}` : '',
        psychology.speechBias ? `말투 ${psychology.speechBias}` : '',
        psychology.emotionSummary ? psychology.emotionSummary : ''
      ].filter(Boolean).join(' | '),
      220
    );
  };

  const buildPsychologyModuleSummary = (entity = {}) => {
    const psychology = extractPsychologyModule(entity);
    return compactText(
      [
        psychology.mainPsychology ? `주요 ${psychology.mainPsychology}` : '',
        psychology.counterPsychology ? `대항 ${psychology.counterPsychology}` : '',
        psychology.desires ? `욕구 ${psychology.desires}` : '',
        psychology.aspirations ? `지향 ${psychology.aspirations}` : '',
        psychology.mode ? `모드 ${psychology.mode}` : ''
      ].filter(Boolean).join(' | '),
      220
    );
  };

  const buildEmotionSyncSummary = (entity = {}) => extractPsychologyModule(entity).emotionSummary || '';

  const renderPsychologyBlockHtml = (entity = {}) => {
    const psychology = extractPsychologyModule(entity);
    const rows = [
      psychology.mainPsychology ? `<div class="scope-section-note" style="margin-top:6px"><strong>Main</strong> ${escHtml(psychology.mainPsychology)}</div>` : '',
      psychology.counterPsychology ? `<div class="scope-section-note" style="margin-top:6px"><strong>Counter</strong> ${escHtml(psychology.counterPsychology)}</div>` : '',
      psychology.anxietyConditions ? `<div class="scope-section-note" style="margin-top:6px"><strong>Anxiety</strong> ${escHtml(psychology.anxietyConditions)}</div>` : '',
      psychology.defenseBehaviors ? `<div class="scope-section-note" style="margin-top:6px"><strong>Defense</strong> ${escHtml(psychology.defenseBehaviors)}</div>` : '',
      psychology.desires ? `<div class="scope-section-note" style="margin-top:6px"><strong>Desires</strong> ${escHtml(psychology.desires)}</div>` : '',
      psychology.aspirations ? `<div class="scope-section-note" style="margin-top:6px"><strong>Aspirations</strong> ${escHtml(psychology.aspirations)}</div>` : '',
      psychology.mode ? `<div class="scope-section-note" style="margin-top:6px"><strong>Mode</strong> ${escHtml(psychology.mode)}</div>` : '',
      psychology.goal ? `<div class="scope-section-note" style="margin-top:6px"><strong>Goal</strong> ${escHtml(psychology.goal)}</div>` : '',
      psychology.pressure ? `<div class="scope-section-note" style="margin-top:6px"><strong>Pressure</strong> ${escHtml(psychology.pressure)}</div>` : '',
      psychology.styleSummary ? `<div class="scope-section-note" style="margin-top:6px"><strong>Style</strong> ${escHtml(psychology.styleSummary)}</div>` : '',
      psychology.speechBias ? `<div class="scope-section-note" style="margin-top:6px"><strong>Speech Bias</strong> ${escHtml(psychology.speechBias)}</div>` : '',
      psychology.emotionSummary ? `<div class="scope-section-note" style="margin-top:6px"><strong>Emotion Sync</strong> ${escHtml(psychology.emotionSummary)}</div>` : ''
    ].filter(Boolean);
    return rows.join('') || '<div class="scope-section-note">심리 요약이 없습니다.</div>';
  };

  const summarizeEntity = (entity = {}) => {
    const parts = [];
    const corex = getEntityCoreXBridge(entity);
    const core = entity?.core && typeof entity.core === 'object' ? entity.core : {};
    const speech = entity?.speech && typeof entity.speech === 'object' ? entity.speech : {};
    const status = entity?.status && typeof entity.status === 'object' ? entity.status : {};
    const identity = entity?.identity && typeof entity.identity === 'object' ? entity.identity : {};
    const personality = entity?.personality && typeof entity.personality === 'object' ? entity.personality : {};
    const background = entity?.background && typeof entity.background === 'object' ? entity.background : {};
    const psychology = extractPsychologyModule(entity);
    const type = compactText(entity?.type || '', 40);
    const intent = compactText(entity?.intent || '', 100);
    const action = compactText(entity?.action || '', 100);
    const belongsTo = compactText(entity?.belongsTo || '', 80);
    const groupTraits = compactText(entity?.groupTraits || '', 100);
    const eventLog = Array.isArray(entity?.eventLog) ? entity.eventLog : [];

    if (type === 'group') parts.push('그룹');
    if (identity.role) parts.push(identity.role);
    if (entity.gender) parts.push(entity.gender);
    if (intent) parts.push(`의도 ${intent}`);
    if (action) parts.push(`행동 ${action}`);
    if (belongsTo) parts.push(`소속 ${belongsTo}`);
    if (groupTraits) parts.push(`특성 ${groupTraits}`);
    if (core.want) parts.push(`욕구 ${core.want}`);
    if (corex?.mind?.coreMind) parts.push(`내면 ${compactText(corex.mind.coreMind, 100)}`);
    if (status.location) parts.push(`위치 ${status.location}`);
    if (speech.style) parts.push(`말투 ${speech.style}`);
    if (psychology.mainPsychology) parts.push(`심리 ${psychology.mainPsychology}`);
    else if (Array.isArray(personality.mainPsychology) && personality.mainPsychology[0]) parts.push(`심리 ${personality.mainPsychology[0]}`);
    if (psychology.emotionSummary) parts.push(psychology.emotionSummary);
    if (eventLog[0]?.description) parts.push(`최근 ${compactText(eventLog[0].description, 80)}`);
    if (Array.isArray(background.milestones) && background.milestones[0]) parts.push(`이력 ${background.milestones[0]}`);

    return compactText(parts.filter(Boolean).join(' | '), 260);
  };

  const summarizeEntityFields = (entity = {}) => {
    const fields = [];
    const corex = getEntityCoreXBridge(entity);
    const identity = entity?.identity && typeof entity.identity === 'object' ? entity.identity : {};
    const status = entity?.status && typeof entity.status === 'object' ? entity.status : {};
    const personality = entity?.personality && typeof entity.personality === 'object' ? entity.personality : {};
    const background = entity?.background && typeof entity.background === 'object' ? entity.background : {};
    const psychology = extractPsychologyModule(entity);
    const type = compactText(entity?.type || '', 40);
    const intent = compactText(entity?.intent || '', 100);
    const action = compactText(entity?.action || '', 100);
    const belongsTo = compactText(entity?.belongsTo || '', 100);
    const assets = compactText(entity?.assets || '', 120);
    const groupTraits = compactText(entity?.groupTraits || '', 120);

    if (type) fields.push({ label: 'Type', value: type });
    if (identity.role) fields.push({ label: 'Role', value: identity.role });
    if (entity.gender) fields.push({ label: 'Gender', value: entity.gender });
    if (intent) fields.push({ label: 'Intent', value: intent });
    if (action) fields.push({ label: 'Action', value: action });
    if (belongsTo) fields.push({ label: 'Belongs', value: belongsTo });
    if (groupTraits) fields.push({ label: 'Group', value: groupTraits });
    if (assets) fields.push({ label: 'Assets', value: assets });
    if (status.location) fields.push({ label: 'Location', value: status.location });
    if (corex?.mind?.coreMind) fields.push({ label: 'Core Mind', value: compactText(corex.mind.coreMind, 120) });
    if (psychology.mainPsychology) fields.push({ label: 'Psychology', value: psychology.mainPsychology });
    else if (Array.isArray(personality.mainPsychology) && personality.mainPsychology[0]) fields.push({ label: 'Psychology', value: personality.mainPsychology[0] });
    if (psychology.emotionSummary) fields.push({ label: 'Emotion', value: psychology.emotionSummary });
    if (Array.isArray(personality.likes) && personality.likes[0]) fields.push({ label: 'Likes', value: personality.likes.slice(0, 3).join(', ') });
    if (Array.isArray(personality.dislikes) && personality.dislikes[0]) fields.push({ label: 'Dislikes', value: personality.dislikes.slice(0, 3).join(', ') });
    if (Array.isArray(background.milestones) && background.milestones[0]) fields.push({ label: 'Milestone', value: background.milestones[0] });
    return fields.slice(0, 6);
  };

  const compactList = (value, maxItems = 4) => {
    const source = Array.isArray(value)
      ? value
      : String(value || '').split(/\r?\n|[,/]|[;；]/);
    return source.map(String).map(item => item.trim()).filter(Boolean).slice(0, maxItems).join(', ');
  };

  const getEntityGender = (entity = {}) => compactText(
    entity?.gender
    || entity?.nsfwTracker?.gender
    || entity?.entitySnapshot?.gender
    || '',
    40
  );
  const isLikelyMaleGender = (genderText = '') => /(남성|남자|male|man|boy|\bM\b)/i.test(String(genderText || '').trim());
  const scoreEntityTrackingPriority = (entry = {}) => {
    let score = 0;
    if (entry.mentioned) score += 1000;
    if (entry.hasSnapshot) score += 60;
    score += Math.min(40, Math.max(0, Number(entry.lastSeenTurn || 0)));
    return score;
  };
  const buildTrackedEntityQueue = (entityCache, bucket, contextText, settings) => {
    const candidates = [];
    entityCache.forEach((entity) => {
      const name = normalizeName(entity?.name);
      if (!name) return;
      const stored = bucket?.entities?.[name] || null;
      const gender = getEntityGender(entity) || getEntityGender(stored?.entitySnapshot || {});
      const mentioned = mentionsName(contextText, name);
      const isMale = isLikelyMaleGender(gender);
      candidates.push({
        name,
        entity,
        mentioned,
        isMale,
        hasSnapshot: Boolean(stored?.entitySnapshot),
        lastSeenTurn: Number(stored?.lastSeenTurn || 0)
      });
    });

    const maleTrackEnabled = settings.dlMaleTrack !== false;
    const filtered = candidates.filter((item) => {
      if (maleTrackEnabled) return true;
      return item.mentioned || !item.isMale;
    });

    filtered.sort((left, right) => {
      const scoreGap = scoreEntityTrackingPriority(right) - scoreEntityTrackingPriority(left);
      if (scoreGap !== 0) return scoreGap;
      return String(left.name).localeCompare(String(right.name));
    });

    const limit = clampNonNegativeInt(settings.dlCharTrackLimit, 0);
    const limited = limit > 0 ? filtered.slice(0, limit) : filtered;
    return limited.map(item => item.entity);
  };

  const getNsfwTrackerApi = () => (
    globalThis?.LIBRA_NsfwTrackerAPI
    || globalThis?.LIBRA?.NsfwTrackerAPI
    || null
  );

  const extractSexualStats = (entity = {}) => {
    const corex = getEntityCoreXBridge(entity);
    const api = getNsfwTrackerApi();
    if (api?.buildDisplayModel) {
      return api.buildDisplayModel(entity) || {
        hasAny: false,
        stats: [],
        sections: [],
        badges: [],
        summary: ''
      };
    }
    const corexSummary = compactText([
      corex?.nsfw?.profile?.virginStatus ? `Virgin ${corex.nsfw.profile.virginStatus}` : '',
      corex?.nsfw?.profile?.firstPartner ? `First ${corex.nsfw.profile.firstPartner}` : '',
      corex?.nsfw?.profile?.sexualHistory ? `History ${corex.nsfw.profile.sexualHistory}` : '',
      Number.isFinite(Number(corex?.nsfw?.dynamic?.arousal)) ? `Arousal ${Math.round(Number(corex.nsfw.dynamic.arousal || 0) * 100)}%` : '',
      corex?.nsfw?.physiology?.pregnancy?.status ? `Pregnancy ${corex.nsfw.physiology.pregnancy.status}` : ''
    ].filter(Boolean).join(' | '), 220);
    const tracker = entity?.nsfwTracker && typeof entity.nsfwTracker === 'object' ? entity.nsfwTracker : {};
    const summary = compactText([
      corexSummary,
      tracker.virginStatus ? `Virgin ${tracker.virginStatus}` : '',
      tracker.sexualHistory ? `History ${tracker.sexualHistory}` : '',
      tracker.pregnancyStatus ? `Pregnancy ${tracker.pregnancyStatus}` : '',
      tracker.sensitivity ? `Sensitivity ${tracker.sensitivity}` : ''
    ].filter(Boolean).join(' | '), 220);
    return {
      hasAny: !!summary,
      stats: [],
      sections: [],
      badges: [],
      summary
    };
  };

  const buildSafeDomId = (value, fallback = 'dylist') => {
    const normalized = String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return normalized || fallback;
  };

  const renderSexualStatsHtml = (entity = {}, options = {}) => {
    const api = getNsfwTrackerApi();
    if (api?.renderSexualStatsHtml) {
      return api.renderSexualStatsHtml(entity, options);
    }
    const sexual = extractSexualStats(entity);
    return sexual.summary
      ? `<div class="scope-section-note" style="margin-top:6px;color:var(--dy-text2, #607389)">${escHtml(sexual.summary)}</div>`
      : '<div class="scope-section-note">표시할 SexualStats가 없습니다.</div>';
  };

  const renderLauncherPopover = (options = {}) => {
    const popupId = buildSafeDomId(options.popupId || options.title || 'dylist-panel', 'dylist-panel-popup');
    const buttonLabel = options.buttonLabel || '열기';
    const title = options.title || 'DyList';
    const subtitle = options.subtitle || '';
    const summary = options.summary || '';
    const bodyHtml = options.bodyHtml || '';
    const accent = options.accent || '🧩';
    return `
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px">
        <button
          type="button"
          class="btn"
          popovertarget="${escHtml(popupId)}"
          data-dylist-popover-open="${escHtml(popupId)}"
          style="padding:5px 11px"
        >${escHtml(buttonLabel)}</button>
        ${summary ? `<span class="scope-section-note" style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;background:color-mix(in srgb,var(--dy-bg2, #e6eef8) 88%, transparent)">${escHtml(summary)}</span>` : ''}
      </div>
      <div
        id="${escHtml(popupId)}"
        popover
        style="max-width:min(640px, calc(100vw - 28px));padding:0;border:1px solid var(--dy-border-soft, rgba(66,92,122,0.28));border-radius:14px;background:color-mix(in srgb,var(--dy-bg, #f2f7fd) 92%, black);color:var(--dy-text, #1b3047);box-shadow:0 18px 48px rgba(0,0,0,0.35)"
      >
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));background:color-mix(in srgb,var(--dy-bg2, #e6eef8) 88%, transparent)">
          <div>
            <div style="font-size:13px;font-weight:700">${escHtml(accent)} ${escHtml(title)}</div>
            ${subtitle ? `<div style="margin-top:3px;font-size:11px;color:var(--dy-text2, #607389)">${escHtml(subtitle)}</div>` : ''}
          </div>
          <button
            type="button"
            class="btn"
            popovertarget="${escHtml(popupId)}"
            popovertargetaction="hide"
            data-dylist-popover-close="${escHtml(popupId)}"
            style="padding:4px 10px"
          >닫기</button>
        </div>
        <div style="padding:12px 14px;max-height:min(76vh, 680px);overflow:auto">
          ${bodyHtml}
        </div>
      </div>
    `;
  };

  const renderDylistPillRow = (items = [], options = {}) => {
    const html = (Array.isArray(items) ? items : [items])
      .filter(Boolean)
      .map(item => `<span class="scope-inline-pill">${escHtml(item)}</span>`)
      .join('');
    if (!html) return '';
    return `<div class="scope-inline-list" style="margin-top:${Number(options.marginTop || 8)}px">${html}</div>`;
  };

  const renderDylistSubCard = (title, bodyHtml = '', options = {}) => {
    const description = String(options.description || '').trim();
    const tone = String(options.tone || '').trim();
    const accentBar = tone
      ? `box-shadow:inset 2px 0 0 ${tone};`
      : '';
    return `
      <div style="margin-top:${Number(options.marginTop || 10)}px;padding:10px 11px;border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:10px;background:color-mix(in srgb,var(--dy-bg2, #e6eef8) 82%, transparent);${accentBar}">
        <div style="font-size:11px;font-weight:700;color:var(--dy-text, #1b3047)">${escHtml(title)}</div>
        ${description ? `<div class="scope-section-note" style="margin-top:4px">${escHtml(description)}</div>` : ''}
        ${bodyHtml}
      </div>
    `;
  };

  const renderDylistFoldSection = (title, bodyHtml = '', options = {}) => {
    const open = options?.open === true;
    const note = String(options?.note || '').trim();
    if (!String(bodyHtml || '').trim() && !note) return '';
    return `
      <details class="speech-dd" style="margin-top:${Math.max(0, Number(options?.marginTop || 8))}px"${open ? ' open' : ''}>
        <summary>${escHtml(title)}</summary>
        <div style="margin-top:8px">
          ${note ? `<div class="scope-section-note">${escHtml(note)}</div>` : ''}
          ${bodyHtml || ''}
        </div>
      </details>
    `;
  };

  const renderDylistHistoryEntry = (item = {}, options = {}) => {
    const labelMap = getHistoryLabelMap();
    const rendered = renderHistoryRichText(item);
    const scope = String(options.scope || '').trim();
    const tag = String(item?.tag || '').trim();
    const isBgPromote = tag === 'BGPROMOTE';
    const titlePrefix = isBgPromote ? '🔼 ' : '';
    const effectiveTone = options.tone || (isBgPromote ? '#e4a93a' : '#6aa8ff');
    const meta = [
      scope,
      labelMap[item.tag] || item.tag || '?',
      item.turn ? `turn ${item.turn}` : '',
      item.date || ''
    ].filter(Boolean);
    return renderDylistSubCard(
      `${titlePrefix}${rendered.title || labelMap[item.tag] || item.tag || 'History'}`,
      `
        ${rendered.detail ? `<div class="scope-section-note" style="margin-top:6px">${escHtml(rendered.detail)}</div>` : ''}
        ${rendered.body ? `<div style="margin-top:6px;line-height:1.55;${isBgPromote ? 'font-weight:600;color:#7a5320;' : ''}">${escHtml(rendered.body)}</div>` : ''}
      `,
      {
        marginTop: Number(options.marginTop || 6),
        tone: effectiveTone,
        description: meta.join(' · ')
      }
    );
  };

  const normalizeWorldOrg = (item = {}) => {
    if (!item || typeof item !== 'object') return null;
    const name = normalizeName(item?.name || item?.title || item?.label || item?.organization || item?.group);
    if (!name) return null;
    const members = Array.isArray(item?.members)
      ? item.members.map(value => normalizeName(value)).filter(Boolean).slice(0, 6)
      : [];
    const summary = compactText([
      item?.kind || item?.type || '',
      item?.role || '',
      item?.description || '',
      members.length ? `members ${members.join(', ')}` : ''
    ].filter(Boolean).join(' | '), 260);
    return {
      name,
      kind: compactText(item?.kind || item?.type || 'group', 60),
      role: compactText(item?.role || item?.description || '', 180),
      managementStyle: compactText(item?.managementStyle || item?.governance || '', 160),
      description: compactText(item?.description || '', 180),
      members,
      summary
    };
  };

  const collectWorldGroups = (context = {}) => {
    const collected = new Map();
    const pushGroup = (input, source = '') => {
      const normalized = normalizeWorldOrg(input);
      if (!normalized) return;
      const existing = collected.get(normalized.name);
      if (!existing) {
        collected.set(normalized.name, {
          ...normalized,
          sources: source ? [source] : []
        });
        return;
      }
      existing.kind = existing.kind || normalized.kind;
      existing.role = existing.role || normalized.role;
      existing.managementStyle = existing.managementStyle || normalized.managementStyle;
      existing.description = existing.description || normalized.description;
      existing.summary = existing.summary || normalized.summary;
      existing.members = Array.from(new Set([...(existing.members || []), ...(normalized.members || [])])).slice(0, 8);
      if (source && !existing.sources.includes(source)) existing.sources.push(source);
    };

    const currentNode = context?.HierarchicalWorldManager?.getCurrentNode?.() || null;
    const profile = context?.HierarchicalWorldManager?.getProfile?.() || null;
    const nodes = profile?.nodes instanceof Map ? Array.from(profile.nodes.values()) : [];
    nodes.forEach((node) => {
      const nodeName = normalizeName(node?.name);
      const scopeSource = nodeName ? `world:${nodeName}` : 'world';
      const organizations = Array.isArray(node?.meta?.worldMetadata?.organizations)
        ? node.meta.worldMetadata.organizations
        : [];
      organizations.forEach(org => pushGroup(org, scopeSource));
    });

    const worldState = context?.WorldStateTracker?.getState?.() || null;
    const worldOrganizations = Array.isArray(worldState?.organizations) ? worldState.organizations : [];
    worldOrganizations.forEach((item) => {
      if (typeof item === 'string') pushGroup({ name: item }, 'world-state');
      else pushGroup(item, 'world-state');
    });

    if (currentNode?.meta?.worldMetadata?.organizations instanceof Array) {
      currentNode.meta.worldMetadata.organizations.forEach(org => pushGroup(org, 'current-node'));
    }

    return Array.from(collected.values());
  };

  const summarizeWorldFocus = (world = {}) => compactText([
    world?.systemFocus || '',
    world?.sceneSummary || '',
    world?.scenePressures?.[0] ? `scene ${world.scenePressures[0]}` : '',
    world?.carryoverSignals?.[0] ? `carry ${world.carryoverSignals[0]}` : '',
    world?.worldLimits?.[0] ? `limit ${world.worldLimits[0]}` : ''
  ].filter(Boolean).join(' | '), 220);

  const refreshWorldState = async (context = {}, bucket = {}, contextText = '', settings = getSettings(), turn = 0) => {
    if (settings.trackWorldSignals === false) {
      bucket.world = createDefaultWorldBucket();
      return 0;
    }
    const previous = bucket?.world && typeof bucket.world === 'object'
      ? { ...createDefaultWorldBucket(), ...bucket.world }
      : createDefaultWorldBucket();
    const snapshot = buildWorldSignalSnapshot(context, settings);
    const dmaInsights = await loadEntityCoreXDmaInsights(context, settings);
    const currentDate = formatDateKST();
    const structure = settings.trackStructuralWorld === false
      ? previous.structure || createDefaultWorldBucket().structure
      : buildWorldStructureSnapshot(context, bucket, settings, snapshot);
    const factions = refreshFactionSignals(context, bucket, contextText, turn, settings, snapshot);
    let regions = refreshRegionalState(context, bucket, contextText, turn, settings, snapshot, structure, factions);
    let timeline = refreshWorldTimeline(context, bucket, contextText, turn, settings, snapshot, factions, regions);
    let offscreenThreads = refreshOffscreenThreads(context, bucket, contextText, turn, settings, snapshot, factions, regions, timeline);
    const propagation = buildWorldPropagationSignals(snapshot, structure, factions, regions, timeline, offscreenThreads);
    const propagatedLayers = applyPropagationToWorldLayers(regions, timeline, offscreenThreads, propagation);
    regions = propagatedLayers.regions;
    timeline = propagatedLayers.timeline;
    offscreenThreads = propagatedLayers.offscreenThreads;
    const publicPressure = uniqueTexts([
      ...snapshot.scenePressures,
      ...snapshot.carryoverSignals,
      ...snapshot.worldLimits,
      ...normalizeArrayItems(dmaInsights?.hints || []),
      ...propagation.map(item => item?.summary || ''),
      ...timeline.pressureClock.map(item => item?.summary || ''),
      ...offscreenThreads.map(item => item?.summary || '')
    ], Number(settings.maxWorldSignalItems || 4) + 4).map((item, index) => {
      const regionName = regions.find(region => findTextMentions([item], region?.name))?.name || '';
      const factionName = factions.find(faction => findTextMentions([item], faction?.name))?.name || '';
      const score = scoreWorldSignalRelevance({
        sceneRelation: findTextMentions(snapshot.scenePressures, item) ? 0.86 : 0.35,
        focusEntityRelevance: mentionsName(contextText, factionName || regionName) ? 0.72 : 0.2,
        recency: 0.7,
        regionMatch: regionName && normalizeName(regionName) === normalizeName(snapshot.location) ? 0.84 : 0.3,
        factionInvolvement: factionName ? 0.72 : 0.2,
        urgency: /war|raid|epidemic|crackdown|전쟁|습격|역병|단속|봉쇄/i.test(item) ? 0.86 : 0.5,
        restrictionConflict: /limit|ban|통금|금지|봉쇄|restriction/i.test(item) ? 0.8 : 0.25,
        carryoverOverlap: findTextMentions(snapshot.carryoverSignals, item) ? 0.78 : 0.24,
        base: 0.34
      });
      return {
        id: `pressure-${index + 1}-${normalizeLooseToken(item)}`,
        key: compactText(item, 80),
        summary: compactText(item, 180),
        score,
        region: regionName,
        faction: factionName
      };
    }).sort((left, right) => Number(right.score || 0) - Number(left.score || 0));
    const nextWorld = {
      ...previous,
      sceneSummary: snapshot.sceneSummary,
      scenePressures: uniqueTexts(snapshot.scenePressures, Number(settings.maxWorldSignalItems || 4)),
      carryoverSignals: uniqueTexts(snapshot.carryoverSignals, Number(settings.maxWorldSignalItems || 4)),
      relationSignals: uniqueTexts(snapshot.relationSignals, Number(settings.maxWorldSignalItems || 4)),
      worldLimits: uniqueTexts(snapshot.worldLimits, Number(settings.maxWorldSignalItems || 4)),
      codexSignals: uniqueTexts(snapshot.codexSignals, Number(settings.maxWorldSignalItems || 4)),
      entityDossierHints: uniqueTexts([
        ...normalizeArrayItems(snapshot.entityDossierHints || []),
        ...normalizeArrayItems(dmaInsights?.hints || [])
      ], Number(settings.maxWorldSignalItems || 4) + 2),
      dmaSummary: compactText(dmaInsights?.summary || '', 220),
      dmaScopeId: compactText(dmaInsights?.scopeId || '', 80),
      dmaStats: dmaInsights?.stats && typeof dmaInsights.stats === 'object'
        ? {
          directEntries: Number(dmaInsights.stats.directEntries || 0),
          previousEntries: Number(dmaInsights.stats.previousEntries || 0),
          totalEntries: Number(dmaInsights.stats.totalEntries || 0)
        }
        : createDefaultWorldBucket().dmaStats,
      structure,
      factions,
      offscreenThreads,
      timeline,
      regions,
      publicPressure,
      propagation,
      systemFocus: summarizeWorldSystemFocus({
        ...previous,
        sceneSummary: snapshot.sceneSummary,
        structure,
        factions,
        offscreenThreads,
        timeline,
        regions,
        propagation
      }, settings),
      location: snapshot.location || '',
      country: snapshot.country || '',
      currentNodeName: snapshot.currentNodeName || '',
      updatedTurn: Number(turn || 0),
      updatedDate: currentDate,
      history: Array.isArray(previous.history) ? previous.history : []
    };
    nextWorld.autonomySummary = summarizeWorldAutonomy(nextWorld);
    const previousForeground = uniqueTexts([
      ...normalizeArrayItems(previous?.timeline?.foregroundSignals || []).map(item => item?.summary || ''),
      ...normalizeArrayItems(previous?.offscreenThreads || []).filter(item => item?.foregroundCandidate).map(item => item?.title || item?.summary || '')
    ], 99);
    const nextForeground = uniqueTexts([
      ...normalizeArrayItems(nextWorld?.timeline?.foregroundSignals || []).map(item => item?.summary || ''),
      ...normalizeArrayItems(nextWorld?.offscreenThreads || []).filter(item => item?.foregroundCandidate).map(item => item?.title || item?.summary || '')
    ], 99);
    const previousResolved = uniqueTexts([
      ...normalizeArrayItems(previous?.timeline?.resolvedSignals || []).map(item => item?.summary || ''),
      ...normalizeArrayItems(previous?.offscreenThreads || []).filter(item => item?.outcome === 'cooling').map(item => item?.title || item?.summary || '')
    ], 99);
    const nextResolved = uniqueTexts([
      ...normalizeArrayItems(nextWorld?.timeline?.resolvedSignals || []).map(item => item?.summary || ''),
      ...normalizeArrayItems(nextWorld?.offscreenThreads || []).filter(item => item?.outcome === 'cooling').map(item => item?.title || item?.summary || '')
    ], 99);
    const previousSummary = summarizeWorldFocus(previous);
    const nextSummary = summarizeWorldFocus(nextWorld);
    const changeBits = uniqueTexts([
      nextWorld.scenePressures[0] ? `scene ${nextWorld.scenePressures[0]}` : '',
      nextWorld.carryoverSignals[0] ? `carryover ${nextWorld.carryoverSignals[0]}` : '',
      nextWorld.worldLimits[0] ? `limit ${nextWorld.worldLimits[0]}` : '',
      nextWorld.relationSignals[0] ? `relation ${nextWorld.relationSignals[0]}` : '',
      nextWorld.codexSignals[0] ? `codex ${nextWorld.codexSignals[0]}` : '',
      nextWorld.factions?.[0] ? `faction ${nextWorld.factions[0].name}` : '',
      nextWorld.offscreenThreads?.[0] ? `thread ${nextWorld.offscreenThreads[0].title}` : '',
      nextWorld.timeline?.currentPhase ? `timeline ${nextWorld.timeline.currentPhase}` : ''
    ], 4).join(' | ');
    const changed = (
      previousSummary !== nextSummary
      || String(previous.location || '') !== String(nextWorld.location || '')
      || String(previous.country || '') !== String(nextWorld.country || '')
      || JSON.stringify(previous.scenePressures || []) !== JSON.stringify(nextWorld.scenePressures || [])
      || JSON.stringify(previous.carryoverSignals || []) !== JSON.stringify(nextWorld.carryoverSignals || [])
      || JSON.stringify(previous.worldLimits || []) !== JSON.stringify(nextWorld.worldLimits || [])
      || JSON.stringify(previous.codexSignals || []) !== JSON.stringify(nextWorld.codexSignals || [])
      || JSON.stringify(previous.factions || []) !== JSON.stringify(nextWorld.factions || [])
      || JSON.stringify(previous.offscreenThreads || []) !== JSON.stringify(nextWorld.offscreenThreads || [])
      || JSON.stringify(previous.timeline || {}) !== JSON.stringify(nextWorld.timeline || {})
      || JSON.stringify(previous.regions || []) !== JSON.stringify(nextWorld.regions || [])
    );
    if (changed) {
      nextWorld.history = pushUniqueHistory(nextWorld.history, {
        turn,
        date: currentDate,
        tag: previousSummary ? 'STATUS' : 'REGISTER',
        text: nextSummary || changeBits || compactText(contextText || '', 180),
        label: nextWorld.currentNodeName || nextWorld.location || nextWorld.country || 'World',
        details: {
          location: nextWorld.location || '',
          country: nextWorld.country || '',
          carryover: nextWorld.carryoverSignals[0] || '',
          limit: nextWorld.worldLimits[0] || ''
        }
      }, Number(settings.maxWorldHistoryItems || 10));
      const newlyForeground = nextForeground.filter(item => !previousForeground.includes(item)).slice(0, 2);
      const newlyResolved = nextResolved.filter(item => !previousResolved.includes(item)).slice(0, 2);
      if (newlyForeground.length) {
        nextWorld.history = pushUniqueHistory(nextWorld.history, {
          turn,
          date: currentDate,
          tag: 'WORLDESCALATE',
          text: `전면 월드 압력 부상 · ${newlyForeground.join(' / ')}`,
          label: 'Foreground pressure',
          details: {
            watch: newlyForeground.join(' | '),
            scene: nextWorld.currentNodeName || nextWorld.location || ''
          }
        }, Number(settings.maxWorldHistoryItems || 10));
      }
      if (newlyResolved.length) {
        nextWorld.history = pushUniqueHistory(nextWorld.history, {
          turn,
          date: currentDate,
          tag: 'WORLDCOOL',
          text: `월드 압력 완화 · ${newlyResolved.join(' / ')}`,
          label: 'Cooling pressure',
          details: {
            resolved: newlyResolved.join(' | '),
            scene: nextWorld.currentNodeName || nextWorld.location || ''
          }
        }, Number(settings.maxWorldHistoryItems || 10));
      }
    }
    bucket.world = nextWorld;
    return changed ? 1 : 0;
  };

  const pushUniqueHistory = (list, entry, maxItems = Number(getSettings().maxHistoryItems || DEFAULT_SETTINGS.maxHistoryItems)) => {
    const safeList = Array.isArray(list) ? list : [];
    const normalized = {
      turn: Number(entry?.turn || 0),
      date: compactText(entry?.date || '', 40),
      tag: compactText(entry?.tag || '', 40),
      text: compactText(entry?.text || '', 220),
      target: compactText(entry?.target || '', 80),
      label: compactText(entry?.label || '', 80),
      details: entry?.details && typeof entry.details === 'object'
        ? Object.fromEntries(Object.entries(entry.details).map(([key, value]) => [key, compactText(value, 120)]))
        : {},
      metrics: entry?.metrics && typeof entry.metrics === 'object'
        ? Object.fromEntries(Object.entries(entry.metrics)
          .filter(([, value]) => Number.isFinite(Number(value)))
          .map(([key, value]) => [key, Number(value)]))
        : {}
    };
    if (!normalized.text) return safeList;
    const last = safeList[safeList.length - 1];
    if (last && last.tag === normalized.tag && last.text === normalized.text && last.target === normalized.target) {
      last.turn = normalized.turn || last.turn;
      last.date = normalized.date || last.date;
      if (normalized.label) last.label = normalized.label;
      if (Object.keys(normalized.details).length > 0) last.details = normalized.details;
      if (Object.keys(normalized.metrics).length > 0) last.metrics = normalized.metrics;
      return safeList;
    }
    safeList.push(normalized);
    if (safeList.length > maxItems) safeList.splice(0, safeList.length - maxItems);
    return safeList;
  };
  const appendHistory = (entry, payload, maxItems = 18) => {
    if (!entry || typeof entry !== 'object') return false;
    const before = JSON.stringify(Array.isArray(entry.history) ? entry.history : []);
    entry.history = pushUniqueHistory(entry.history, payload, maxItems);
    return JSON.stringify(entry.history) !== before;
  };

  const ensureEntityEntry = (bucket, name) => {
    const normalized = normalizeName(name);
    if (!normalized) return null;
    bucket.entities[normalized] = bucket.entities[normalized] && typeof bucket.entities[normalized] === 'object'
      ? bucket.entities[normalized]
      : {
        name: normalized,
        charNum: ++bucket.counters.entity,
        firstSeenTurn: 0,
        lastSeenTurn: 0,
        currentSummary: '',
        psychologySummary: '',
        emotionSummary: '',
        sexualSummary: '',
        lastDate: '',
        entitySnapshot: null,
        history: []
      };
    return bucket.entities[normalized];
  };

  const buildEntitySnapshot = (entity = {}) => ({
    name: entity?.name || '',
    type: compactText(entity?.type || '', 40),
    gender: getEntityGender(entity),
    intent: compactText(entity?.intent || '', 120),
    action: compactText(entity?.action || '', 120),
    belongsTo: compactText(entity?.belongsTo || '', 100),
    groupTraits: compactText(entity?.groupTraits || '', 140),
    assets: compactText(entity?.assets || '', 140),
    identity: entity?.identity && typeof entity.identity === 'object' ? {
      role: entity.identity.role || ''
    } : {},
    status: entity?.status && typeof entity.status === 'object' ? {
      location: entity.status.location || ''
    } : {},
    background: entity?.background && typeof entity.background === 'object' ? {
      occupation: entity.background.occupation || '',
      milestones: Array.isArray(entity.background.milestones) ? entity.background.milestones.slice(0, 4) : []
    } : {},
    personality: entity?.personality && typeof entity.personality === 'object' ? {
      sexualAttitudes: entity.personality.sexualAttitudes || '',
      sexualOrientation: entity.personality.sexualOrientation || '',
      sexualPreferences: Array.isArray(entity.personality.sexualPreferences) ? entity.personality.sexualPreferences.slice(0, 8) : [],
      mainPsychology: Array.isArray(entity.personality.mainPsychology) ? entity.personality.mainPsychology.slice(0, 3) : []
    } : {},
    nsfwTracker: entity?.nsfwTracker && typeof entity.nsfwTracker === 'object' ? {
      virginStatus: entity.nsfwTracker.virginStatus || '',
      firstPartner: entity.nsfwTracker.firstPartner || '',
      sexualAttitudes: entity.nsfwTracker.sexualAttitudes || '',
      sexualPreferences: Array.isArray(entity.nsfwTracker.sexualPreferences) ? entity.nsfwTracker.sexualPreferences.slice(0, 8) : [],
      sexualHistory: entity.nsfwTracker.sexualHistory || '',
      menstrualCycle: entity.nsfwTracker.menstrualCycle || '',
      menstruationStatus: entity.nsfwTracker.menstruationStatus || '',
      pregnancyChance: entity.nsfwTracker.pregnancyChance || '',
      pregnancyStatus: entity.nsfwTracker.pregnancyStatus || '',
      sensitivity: entity.nsfwTracker.sensitivity || '',
      sexualStamina: entity.nsfwTracker.sexualStamina || ''
    } : {},
    psychologyModule: (() => {
      const psychology = extractPsychologyModule(entity);
      return {
        mainPsychology: psychology.mainPsychology || '',
        counterPsychology: psychology.counterPsychology || '',
        anxietyConditions: psychology.anxietyConditions || '',
        defenseBehaviors: psychology.defenseBehaviors || '',
        desires: psychology.desires || '',
        aspirations: psychology.aspirations || '',
        mode: psychology.mode || '',
        goal: psychology.goal || '',
        pressure: psychology.pressure || '',
        styleSummary: psychology.styleSummary || '',
        emotionSummary: psychology.emotionSummary || ''
      };
    })(),
    psychologyEngine: entity?.psychologyEngine && typeof entity.psychologyEngine === 'object' ? {
      stable: entity.psychologyEngine.stable || {},
      dynamic: entity.psychologyEngine.dynamic || {},
      evidence: entity.psychologyEngine.evidence || {},
      meta: entity.psychologyEngine.meta || {}
    } : {},
    statusEmotion: entity?.status && typeof entity.status === 'object' ? {
      currentMood: entity.status.currentMood || '',
      emotionSignature: entity.status.emotionSignature || '',
      emotionBlend: entity.status.emotionBlend || '',
      emotionIntensity: Number.isFinite(Number(entity.status.emotionIntensity)) ? Number(entity.status.emotionIntensity) : 0
    } : {},
    legacyEventLog: Array.isArray(entity?.eventLog)
      ? entity.eventLog.slice(-6).map((event) => ({
        turn: Number(event?.turn || 0),
        time: compactText(event?.time || '', 40),
        tag: compactText(event?.tag || '', 40),
        description: compactText(event?.description || '', 180),
        source: compactText(event?.source || '', 40)
      }))
      : [],
    groupStats: entity?.groupStats && typeof entity.groupStats === 'object'
      ? JSON.parse(JSON.stringify(entity.groupStats))
      : null,
    timeProjection: (() => {
      const timeTracking = getProjectedTimeTracking(entity);
      return {
        currentDate: timeTracking.currentDate || '',
        lastInteractionDate: timeTracking.lastInteractionDate || '',
        lastIntimacyDate: timeTracking.lastIntimacyDate || '',
        cycleAnchorDate: timeTracking.cycleAnchorDate || ''
      };
    })(),
    entityCoreX: (() => {
      const corex = getEntityCoreXBridge(entity);
      if (!corex || typeof corex !== 'object' || !Object.keys(corex).length) return {};
      return {
        mind: {
          coreMind: compactText(corex?.mind?.coreMind || '', 180),
          desire: compactText(corex?.mind?.branches?.desire?.summary || '', 140),
          fear: compactText(corex?.mind?.branches?.fear?.summary || '', 140),
          bond: compactText(corex?.mind?.branches?.bond?.summary || '', 140)
        },
        psyche: {
          activeMode: compactText(corex?.psyche?.dynamic?.activeMode || '', 60),
          currentGoal: compactText(corex?.psyche?.dynamic?.currentGoal || '', 140),
          speechBias: compactText(corex?.psyche?.dynamic?.speechBias || '', 140)
        },
        continuity: {
          currentSummary: compactText(corex?.continuity?.currentSummary || '', 180),
          psychologySummary: compactText(corex?.continuity?.psychologySummary || '', 180),
          sexualSummary: compactText(corex?.continuity?.sexualSummary || '', 180)
        },
        nsfw: {
          sexualSummary: compactText([
            corex?.nsfw?.profile?.virginStatus ? `Virgin ${corex.nsfw.profile.virginStatus}` : '',
            corex?.nsfw?.profile?.sexualHistory ? `History ${corex.nsfw.profile.sexualHistory}` : '',
            Number.isFinite(Number(corex?.nsfw?.dynamic?.arousal)) ? `Arousal ${Math.round(Number(corex.nsfw.dynamic.arousal || 0) * 100)}%` : ''
          ].filter(Boolean).join(' | '), 180)
        }
      };
    })()
  });

  const extractLegacyEntityEvents = (entity = {}) => (
    Array.isArray(entity?.eventLog)
      ? entity.eventLog.map((event) => ({
        turn: Number(event?.turn || 0),
        date: compactText(event?.time || '', 40),
        tag: compactText(event?.tag || 'ACT', 40),
        text: compactText(event?.description || '', 220),
        label: compactText(event?.father || event?.source || '', 80)
      })).filter(item => item.text)
      : []
  );

  const buildLegacyEntityGroup = (entity = {}) => {
    if (String(entity?.type || '').trim().toLowerCase() !== 'group' && !entity?.groupStats && !entity?.groupTraits && !entity?.belongsTo && !entity?.assets) {
      return null;
    }
    const name = normalizeName(entity?.name);
    if (!name) return null;
    const members = Array.isArray(entity?.members)
      ? entity.members.map(value => normalizeName(value)).filter(Boolean).slice(0, 8)
      : [];
    return {
      name,
      kind: compactText(entity?.type || 'group', 60),
      role: compactText(entity?.intent || entity?.identity?.role || '', 180),
      managementStyle: compactText(entity?.groupTraits || '', 160),
      description: compactText(entity?.assets || entity?.action || '', 180),
      members,
      sources: ['entity-group'],
      groupStats: entity?.groupStats && typeof entity.groupStats === 'object'
        ? JSON.parse(JSON.stringify(entity.groupStats))
        : null,
      summary: compactText([
        entity?.groupTraits || '',
        entity?.belongsTo ? `belongs ${entity.belongsTo}` : '',
        entity?.assets ? `assets ${entity.assets}` : '',
        entity?.action ? `action ${entity.action}` : '',
        members.length ? `members ${members.join(', ')}` : ''
      ].filter(Boolean).join(' | '), 260)
    };
  };

  const ensureGroupEntry = (bucket, name) => {
    const normalized = normalizeName(name);
    if (!normalized) return null;
    bucket.groups[normalized] = bucket.groups[normalized] && typeof bucket.groups[normalized] === 'object'
      ? bucket.groups[normalized]
      : {
        name: normalized,
        groupNum: ++bucket.counters.group,
        firstSeenTurn: 0,
        lastSeenTurn: 0,
        currentSummary: '',
        kind: '',
        role: '',
        managementStyle: '',
        description: '',
        groupStats: null,
        members: [],
        sources: [],
        history: []
      };
    return bucket.groups[normalized];
  };

  const buildContextText = async (context = {}) => {
    const messages = getChatMessages(context?.chat);
    const evidenceText = await collectUnifiedContextEvidenceText(context, {
      scope: 'dylist-context',
      maxLen: 5000
    });
    return [
      getMessageText(messages[messages.length - 2]),
      getMessageText(messages[messages.length - 1]),
      context?.userMsg,
      context?.memorySourceText,
      context?.pendingResponseText,
      context?.displayContent,
      context?.aiResponse,
      evidenceText
    ].filter(Boolean).join('\n');
  };

  const mentionsName = (text, name) => {
    const hay = String(text || '');
    const target = normalizeName(name);
    if (!hay || !target) return false;
    if (hay.includes(target)) return true;
    const looseHay = normalizeLooseToken(hay);
    const looseTarget = normalizeLooseToken(target);
    if (looseHay && looseTarget && looseHay.includes(looseTarget)) return true;
    const asciiLike = /^[a-z0-9][a-z0-9\s_\-'"`’‘.]+$/i.test(target);
    if (!asciiLike) return false;
    try {
      const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}([^\\p{L}\\p{N}_]|$)`, 'iu').test(hay);
    } catch (_) {
      return false;
    }
  };

  const getCurrentSceneLocationMeta = (context = {}) => {
    const currentNode = context?.HierarchicalWorldManager?.getCurrentNode?.() || null;
    const nodeMeta = currentNode?.meta?.worldMetadata || {};
    const worldState = context?.WorldStateTracker?.getState?.() || {};
    const location = normalizeName(
      nodeMeta?.location
      || worldState?.currentLocation
      || worldState?.location
      || currentNode?.name
      || ''
    );
    const country = normalizeName(
      nodeMeta?.country
      || worldState?.currentCountry
      || worldState?.country
      || ''
    );
    return { location, country, currentNodeName: normalizeName(currentNode?.name || '') };
  };

  const extractPromptSignalLines = (input) => {
    const text = compactText(input || '', 3000);
    if (!text) return [];
    return uniqueTexts(
      text
        .split(/\r?\n|[|]/)
        .map(line => compactText(line, 180))
        .filter(Boolean),
      12
    );
  };

  const collectContextSignalArray = (context = {}, key = '') => {
    const direct = context?.[key];
    if (Array.isArray(direct)) return direct;
    if (typeof direct === 'string') return [direct];
    return [];
  };

  const normalizeArrayItems = (value) => {
    if (Array.isArray(value)) return value.filter(item => item !== undefined && item !== null);
    if (value === undefined || value === null || value === '') return [];
    return [value];
  };
  const buildStructuredSummary = (parts = [], maxLen = 220) => compactText(parts.filter(Boolean).join(' | '), maxLen);
  const normalizeStructureItem = (input = {}, fallback = {}) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      const summary = compactText(input || '', 180);
      if (!summary) return null;
      return {
        ...fallback,
        name: fallback.name || summary,
        key: fallback.key || normalizeLooseToken(summary),
        summary
      };
    }
    const name = compactText(input?.name || input?.title || input?.label || input?.key || '', 80);
    const key = compactText(input?.key || input?.id || name || fallback.key || '', 80);
    const summary = compactText(
      input?.summary
      || input?.description
      || input?.detail
      || buildStructuredSummary([
        input?.type,
        input?.scope,
        input?.status,
        input?.taboo,
        input?.norm
      ], 180)
      || name,
      180
    );
    if (!name && !key && !summary) return null;
    return {
      ...fallback,
      ...input,
      name: name || fallback.name || key || summary,
      key: key || fallback.key || normalizeLooseToken(name || summary),
      summary
    };
  };
  const dedupeStructuredItems = (rows = [], limit = 6) => {
    const output = [];
    const seen = new Set();
    normalizeArrayItems(rows).forEach((row) => {
      const normalized = normalizeStructureItem(row);
      if (!normalized) return;
      const key = normalizeLooseToken(normalized?.key || normalized?.name || normalized?.summary || '');
      if (!key || seen.has(key)) return;
      seen.add(key);
      output.push(normalized);
    });
    return output.slice(0, Math.max(0, Number(limit || 0) || 0) || output.length);
  };
  const findTextMentions = (texts = [], pattern = '') => {
    const needle = normalizeLooseToken(pattern);
    if (!needle) return false;
    return normalizeArrayItems(texts).some((text) => normalizeLooseToken(text).includes(needle));
  };
  const scoreWorldSignalRelevance = (signal = {}, options = {}) => {
    const sceneRelation = clamp01(signal?.sceneRelation ?? options.sceneRelation ?? 0.4);
    const focusEntityRelevance = clamp01(signal?.focusEntityRelevance ?? options.focusEntityRelevance ?? 0.3);
    const recency = clamp01(signal?.recency ?? options.recency ?? 0.3);
    const regionMatch = clamp01(signal?.regionMatch ?? options.regionMatch ?? 0);
    const factionInvolvement = clamp01(signal?.factionInvolvement ?? options.factionInvolvement ?? 0);
    const urgency = clamp01(signal?.urgency ?? options.urgency ?? 0.2);
    const restrictionConflict = clamp01(signal?.restrictionConflict ?? options.restrictionConflict ?? 0);
    const carryoverOverlap = clamp01(signal?.carryoverOverlap ?? options.carryoverOverlap ?? 0.2);
    const base = clamp01(signal?.base ?? options.base ?? 0.2);
    return Math.round((
      (sceneRelation * 0.2)
      + (focusEntityRelevance * 0.14)
      + (recency * 0.12)
      + (regionMatch * 0.14)
      + (factionInvolvement * 0.14)
      + (urgency * 0.13)
      + (restrictionConflict * 0.07)
      + (carryoverOverlap * 0.06)
      + (base * 0.1)
    ) * 100);
  };
  const getTurnGap = (currentTurn = 0, previousTurn = 0) => {
    const current = Math.max(0, Number(currentTurn || 0));
    const previous = Math.max(0, Number(previousTurn || 0));
    if (!current || !previous) return 0;
    return Math.max(0, current - previous);
  };
  const describePressureStage = (value = 0) => {
    const numeric = Number(value || 0);
    if (numeric >= 82) return 'critical';
    if (numeric >= 66) return 'hot';
    if (numeric >= 48) return 'rising';
    if (numeric >= 28) return 'watch';
    return 'low';
  };
  const describeThreadState = ({ urgency = 0, pressure = 0, dormancy = 0, relevance = 0, carryoverHit = false } = {}) => {
    if (urgency >= 0.82 || pressure >= 0.82) return 'escalating';
    if (dormancy >= 4 && relevance < 55 && !carryoverHit) return 'dormant';
    if (dormancy >= 7 && urgency < 0.34 && pressure < 0.34) return 'fading';
    if (carryoverHit || relevance >= 62) return 'active';
    return 'latent';
  };
  const describeStageTransition = (previousStage = '', nextStage = '') => {
    const before = String(previousStage || '').trim();
    const after = String(nextStage || '').trim();
    if (!after) return '';
    if (!before || before === after) return after;
    return `${before} -> ${after}`;
  };
  const buildResolutionHint = ({ summary = '', stage = '', trend = '', region = '', faction = '' } = {}) => {
    if (stage === 'critical' || trend === 'up') {
      return compactText(`watch for direct spillover around ${region || faction || 'current scene'} from ${summary}`, 180);
    }
    if (stage === 'hot' || stage === 'rising') {
      return compactText(`keep background pressure visible until ${region || faction || 'the area'} reacts to ${summary}`, 180);
    }
    if (trend === 'down' || stage === 'watch') {
      return compactText(`allow partial cooling, but leave residue from ${summary}`, 180);
    }
    return compactText(`maintain low ambient continuity from ${summary}`, 180);
  };
  const collectLinkedSignals = (signals = [], terms = []) => uniqueTexts(
    normalizeArrayItems(signals).filter((item) => normalizeArrayItems(terms).some(term => findTextMentions([item], term))),
    4
  );
  const inferLinkedRules = (snapshot = {}, names = [], regions = []) => uniqueTexts([
    ...collectLinkedSignals(snapshot?.activeRules, [...names, ...regions]),
    ...collectLinkedSignals(snapshot?.worldLimits, [...names, ...regions])
  ], 4);
  const inferLinkedOrganizations = (snapshot = {}, names = [], regions = []) => uniqueTexts(
    collectLinkedSignals(snapshot?.organizations, [...names, ...regions]),
    4
  );
  const buildEscalationOutcome = ({ status = '', momentum = 0, urgency = 0, pressure = 0, dormancy = 0 } = {}) => {
    if (status === 'escalating' && (momentum >= 0.82 || urgency >= 0.84 || pressure >= 0.84)) return 'breakout-risk';
    if ((status === 'fading' || status === 'dormant') && dormancy >= 6 && momentum < 0.36) return 'cooling';
    if (status === 'active') return 'held';
    return 'latent';
  };
  const deriveSeasonalLoad = (season = '') => {
    const text = String(season || '').trim();
    if (!text) return 0;
    if (/blizzard|storm|monsoon|drought|heatwave|flood|typhoon|폭설|폭우|태풍|가뭄|혹한|폭염/i.test(text)) return 0.82;
    if (/winter|summer|rainy|dry|harvest|wintering|겨울|여름|장마|건기|우기|수확기/i.test(text)) return 0.58;
    if (/spring|autumn|fall|festival|봄|가을|축제/i.test(text)) return 0.34;
    return 0.22;
  };
  const deriveOrganizationTier = (organization = {}) => {
    const raw = compactText([
      organization?.tier,
      organization?.level,
      organization?.rank,
      organization?.authority,
      organization?.scope,
      organization?.type,
      organization?.category,
      organization?.name,
      organization?.summary
    ].filter(Boolean).join(' '), 220).toLowerCase();
    if (/supreme|central|state|imperial|federal|ministry|high command|directorate|council|본부|중앙|국가|정부|사령부|총괄|본청|위원회|청/i.test(raw)) return 3;
    if (/regional|province|provincial|district|branch|chapter|bureau|office|지부|지국|지회|지역|행정|국|부대/i.test(raw)) return 2;
    return 1;
  };
  const buildOrganizationHierarchyProfile = (snapshot = {}, names = [], regions = []) => {
    const terms = uniqueTexts([
      ...normalizeArrayItems(names),
      ...normalizeArrayItems(regions)
    ], 8);
    const matched = normalizeArrayItems(snapshot?.organizations).map((organization) => {
      const name = compactText(organization?.name || organization?.title || organization?.key || '', 80);
      if (!name) return null;
      const summary = compactText(organization?.summary || organization?.description || '', 180);
      const scope = compactText(organization?.scope || organization?.region || organization?.control || '', 80);
      const parent = compactText(organization?.parent || organization?.superior || organization?.command || '', 80);
      const type = compactText(organization?.type || organization?.category || '', 60);
      const tier = deriveOrganizationTier(organization);
      const matchedTerm = terms.find((term) => findTextMentions([
        name,
        summary,
        scope,
        parent,
        compactText(organization?.authority || '', 80),
        compactText(organization?.leader || '', 80)
      ], term));
      if (!matchedTerm) return null;
      return {
        name,
        summary,
        scope,
        parent,
        type,
        tier
      };
    }).filter(Boolean)
      .sort((left, right) => {
        const tierGap = Number(right?.tier || 0) - Number(left?.tier || 0);
        if (tierGap !== 0) return tierGap;
        return String(left?.name || '').localeCompare(String(right?.name || ''));
      });
    const primary = matched[0] || null;
    const commandReach = clamp01(
      primary
        ? ((Number(primary?.tier || 1) * 0.22) + (matched.length * 0.08) + (/regional|district|province|지부|지국|지역/i.test(primary?.scope || '') ? 0.12 : 0))
        : 0,
      0
    );
    const authorityBias = clamp01(
      primary
        ? Math.max(
          commandReach,
          /military|police|guard|ministry|council|directorate|사령부|경찰|치안|경비|위원회|행정/i.test(`${primary?.type || ''} ${primary?.summary || ''}`)
            ? 0.8
            : 0.48
        )
        : 0,
      0
    );
    return {
      bodies: matched.map(item => item.name),
      primaryBody: primary?.name || '',
      hierarchyTier: Number(primary?.tier || 0),
      commandReach,
      authorityBias,
      hierarchySummary: buildStructuredSummary([
        primary?.name || '',
        primary?.parent ? `parent ${primary.parent}` : '',
        primary?.scope ? `scope ${primary.scope}` : '',
        primary ? `tier ${primary.tier}` : ''
      ], 180)
    };
  };
  const summarizeTemporalForecast = ({ pressureClock = [], seasonalContext = [], pendingEvents = [], factions = [], regions = [] } = {}) => {
    const hottest = normalizeArrayItems(pressureClock)[0] || null;
    const hottestFaction = normalizeArrayItems(factions).slice().sort((left, right) => Number(right?.heat || 0) - Number(left?.heat || 0))[0] || null;
    const hottestRegion = normalizeArrayItems(regions).slice().sort((left, right) => Number(right?.pressureScore || 0) - Number(left?.pressureScore || 0))[0] || null;
    return buildStructuredSummary([
      hottest?.summary ? `clock ${hottest.summary}` : '',
      pendingEvents?.[0]?.summary ? `pending ${pendingEvents[0].summary}` : '',
      seasonalContext?.[0] ? `season ${seasonalContext[0]}` : '',
      hottestFaction?.name ? `faction ${hottestFaction.name}` : '',
      hottestRegion?.name ? `region ${hottestRegion.name}` : ''
    ], 220);
  };
  class WorldCoreXProviderError extends Error {
    constructor(message = 'Provider error', code = 'PROVIDER_ERROR', details = null) {
      super(String(message || 'Provider error'));
      this.name = 'WorldCoreXProviderError';
      this.code = String(code || 'PROVIDER_ERROR');
      this.details = details;
    }
  }
  const resolveAnalysisStage = (phase = '') => {
    const normalized = String(phase || '').trim().toLowerCase();
    if (normalized === 'finalize') return 'finalize';
    if (['rebuild', 'cold-start', 'recovery'].includes(normalized)) return 'rebuild';
    if (['reanalyze', 'manual'].includes(normalized)) return 'manual';
    return '';
  };
  const getAvailableFetch = () => {
    const risuApi = getRisuApi();
    try {
      if (typeof globalThis?.nativeFetch === 'function') return globalThis.nativeFetch.bind(globalThis);
    } catch (_) {}
    try {
      if (typeof globalThis?.LIBRA?.nativeFetch === 'function') return globalThis.LIBRA.nativeFetch.bind(globalThis.LIBRA);
    } catch (_) {}
    try {
      if (typeof globalThis?.LIBRA?.RuntimeBridge?.nativeFetch === 'function') {
        return globalThis.LIBRA.RuntimeBridge.nativeFetch.bind(globalThis.LIBRA.RuntimeBridge);
      }
    } catch (_) {}
    try {
      if (typeof globalThis?.LIBRA_RuntimeBridge?.nativeFetch === 'function') {
        return globalThis.LIBRA_RuntimeBridge.nativeFetch.bind(globalThis.LIBRA_RuntimeBridge);
      }
    } catch (_) {}
    try {
      if (typeof risuApi?.nativeFetch === 'function') return risuApi.nativeFetch.bind(risuApi);
    } catch (_) {}
    try {
      const webRequest = globalThis?.['fetch'];
      if (typeof webRequest === 'function') return webRequest.bind(globalThis);
    } catch (_) {}
    return null;
  };
  const encodeBase64Url = (source) => {
    let binary = '';
    for (let i = 0; i < source.length; i += 1) binary += String.fromCharCode(source[i]);
    return btoa(binary).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  };
  const decodePrivateKey = (privateKey = '') => {
    const pem = String(privateKey || '').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\\n|\n/g, '');
    const binaryString = atob(pem);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i += 1) bytes[i] = binaryString.charCodeAt(i);
    return bytes.buffer;
  };
  const resolveAnalysisProviderBaseUrl = (provider = 'openai', rawUrl = '') => {
    const normalizedProvider = String(provider || 'openai').trim().toLowerCase();
    const text = String(rawUrl || '').trim();
    if (text) return text;
    if (normalizedProvider === 'openai') return 'https://api.openai.com';
    if (normalizedProvider === 'openrouter') return 'https://openrouter.ai/api';
    if (normalizedProvider === 'claude') return 'https://api.anthropic.com';
    if (normalizedProvider === 'gemini') return 'https://generativelanguage.googleapis.com/v1beta';
    if (normalizedProvider === 'ollama_cloud') return 'https://ollama.com/v1/chat/completions';
    if (normalizedProvider === 'ollama') return 'https://ollama.com';
    if (normalizedProvider === 'copilot') return 'https://api.githubcopilot.com';
    return text;
  };
  const isOpenAICompatibleOllamaChatEndpoint = (rawUrl = '') => /\/chat\/completions$/i.test(String(rawUrl || '').trim().replace(/\/$/, ''));
  const normalizeAnalysisGeminiEndpoint = (rawUrl = '', model = '') => {
    let url = String(rawUrl || '').trim();
    if (!url) url = 'https://generativelanguage.googleapis.com/v1beta';
    url = url.replace(/\/$/, '');
    if (/:generateContent$/i.test(url)) return url;
    if (/\/models\/[^/:]+$/i.test(url)) return `${url}:generateContent`;
    return `${url}/models/${String(model || '').trim()}:generateContent`;
  };
  const normalizeAnalysisOllamaEndpoint = (rawUrl = '') => {
    let url = String(rawUrl || '').trim();
    if (!url) url = 'https://ollama.com';
    url = url.replace(/\/$/, '');
    if (isOpenAICompatibleOllamaChatEndpoint(url)) return url;
    if (/\/api\/chat$/i.test(url)) return url;
    if (/\/api$/i.test(url)) return `${url}/chat`;
    return `${url}/api/chat`;
  };
  const extractJsonCandidate = (text = '') => {
    const source = String(text || '').trim();
    if (!source) return null;
    const candidates = [
      source,
      ...((source.match(/```(?:json)?\s*([\s\S]*?)```/ig) || []).map(block => String(block || '').replace(/```(?:json)?/ig, '').replace(/```/g, '').trim()))
    ];
    const firstBrace = source.indexOf('{');
    const lastBrace = source.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(source.slice(firstBrace, lastBrace + 1));
    for (const candidate of candidates) {
      const parsed = safeJsonParse(candidate, null);
      if (parsed && typeof parsed === 'object') return parsed;
    }
    return null;
  };
  class WorldCoreXBaseProvider {
    _ensureKey(key = '') {
      if (!String(key || '').trim()) throw new WorldCoreXProviderError('API Key is missing. Please check analysisProvider settings.', 'MISSING_KEY');
    }
    _ensureUrl(url = '') {
      if (!String(url || '').trim()) throw new WorldCoreXProviderError('API URL is missing. Please check analysisProvider settings.', 'MISSING_URL');
    }
    async _fetchRaw(url, init = {}, timeoutMs = 30000) {
      const fetcher = getAvailableFetch();
      if (!fetcher) throw new WorldCoreXProviderError('No nativeFetch/fetch available for analysis provider.', 'NO_FETCH');
      let timeoutId = null;
      const controller = (typeof AbortController !== 'undefined' && !init?.signal) ? new AbortController() : null;
      const requestInit = controller ? { ...init, signal: controller.signal } : init;
      try {
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            try { controller?.abort?.(); } catch (_) {}
            reject(new WorldCoreXProviderError('API Request timed out', 'TIMEOUT'));
          }, Math.max(3000, Number(timeoutMs || 30000)));
        });
        return await Promise.race([fetcher(url, requestInit), timeoutPromise]);
      } finally {
        if (timeoutId != null) clearTimeout(timeoutId);
      }
    }
    async _fetchJson(url, init = {}, timeoutMs = 30000) {
      const response = await this._fetchRaw(url, init, timeoutMs);
      if (!response || !response.ok) {
        const errorText = await response?.text?.().catch(() => 'No error body') || 'No response';
        throw new WorldCoreXProviderError(`API Error: ${response?.status || 'Unknown'} - ${errorText}`, 'API_ERROR');
      }
      return response.json();
    }
    _ensureText(text = '', data = {}, label = 'LLM') {
      const content = String(text || '').trim();
      if (content) return content;
      throw new WorldCoreXProviderError(`${label} returned no text content`, 'EMPTY_RESPONSE', data);
    }
  }
  class WorldCoreXOpenAIProvider extends WorldCoreXBaseProvider {
    async _getCopilotBearerToken(rawToken = '') {
      const sourceToken = String(rawToken || '').replace(/[^\x20-\x7E]/g, '').trim();
      if (!sourceToken) return '';
      if (copilotTokenCache && Number.isFinite(copilotTokenExpiry) && Date.now() < copilotTokenExpiry - 60000) {
        return copilotTokenCache;
      }
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
        copilotTokenCache = token;
        copilotTokenExpiry = expiry || (Date.now() + 30 * 60 * 1000);
        return token;
      } catch (_) {
        return sourceToken;
      }
    }
    async callLLM(config = {}, systemPrompt = '', userPrompt = '', options = {}) {
      const provider = String(config?.llm?.provider || 'openai').toLowerCase();
      const rawBase = resolveAnalysisProviderBaseUrl(provider, config?.llm?.url).replace(/\/$/, '');
      const url = /\/chat\/completions$/i.test(rawBase) || /\/v1\/chat\/completions$/i.test(rawBase)
        ? rawBase
        : `${rawBase}${provider === 'copilot' ? '/chat/completions' : '/v1/chat/completions'}`;
      this._ensureKey(config?.llm?.key);
      this._ensureUrl(url);
      const authToken = provider === 'copilot'
        ? await this._getCopilotBearerToken(config.llm.key)
        : config.llm.key;
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`
      };
      if (provider === 'openrouter') {
        headers['HTTP-Referer'] = 'https://risuai.xyz';
        headers['X-Title'] = 'LIBRA World Core X';
      } else if (provider === 'copilot') {
        headers['Editor-Version'] = `vscode/${COPILOT_CODE_VERSION}`;
        headers['Editor-Plugin-Version'] = `copilot-chat/${COPILOT_CHAT_VERSION}`;
        headers['Copilot-Integration-Id'] = 'vscode-chat';
        headers['User-Agent'] = COPILOT_USER_AGENT;
      }
      const data = await this._fetchJson(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: String(config?.llm?.model || '').trim(),
          messages: [
            { role: 'system', content: String(systemPrompt || '') },
            { role: 'user', content: String(userPrompt || '') }
          ],
          temperature: Number(config?.llm?.temp ?? 0.2),
          max_tokens: Math.max(256, Number(options?.maxTokens || config?.llm?.responseMaxTokens || 3200)),
          stream: false
        })
      }, config?.llm?.timeout);
      const content = String(
        data?.choices?.[0]?.message?.content
        || data?.choices?.[0]?.text
        || data?.output_text
        || ''
      ).trim();
      return { content: this._ensureText(content, data, provider), usage: data?.usage || {} };
    }
  }
  class WorldCoreXAnthropicProvider extends WorldCoreXBaseProvider {
    async callLLM(config = {}, systemPrompt = '', userPrompt = '', options = {}) {
      let url = resolveAnalysisProviderBaseUrl('claude', config?.llm?.url);
      if (!/\/v1\/messages$/i.test(url)) url = `${url.replace(/\/$/, '')}/v1/messages`;
      this._ensureKey(config?.llm?.key);
      const data = await this._fetchJson(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.llm.key,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: String(config?.llm?.model || '').trim(),
          system: String(systemPrompt || ''),
          messages: [{ role: 'user', content: String(userPrompt || '') }],
          max_tokens: Math.max(256, Number(options?.maxTokens || config?.llm?.responseMaxTokens || 3200)),
          temperature: Number(config?.llm?.temp ?? 0.2)
        })
      }, config?.llm?.timeout);
      const content = Array.isArray(data?.content)
        ? data.content.map(block => String(block?.text || '').trim()).filter(Boolean).join('\n\n')
        : '';
      return { content: this._ensureText(content, data, 'anthropic'), usage: data?.usage || {} };
    }
  }
  class WorldCoreXGeminiProvider extends WorldCoreXBaseProvider {
    async callLLM(config = {}, systemPrompt = '', userPrompt = '', options = {}) {
      const model = String(config?.llm?.model || '').trim();
      const url = normalizeAnalysisGeminiEndpoint(resolveAnalysisProviderBaseUrl('gemini', config?.llm?.url), model);
      this._ensureKey(config?.llm?.key);
      const data = await this._fetchJson(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': config.llm.key
        },
        body: JSON.stringify({
          systemInstruction: systemPrompt ? { parts: [{ text: String(systemPrompt || '') }] } : undefined,
          contents: [{ role: 'user', parts: [{ text: String(userPrompt || '') }] }],
          generationConfig: {
            temperature: Number(config?.llm?.temp ?? 0.2),
            maxOutputTokens: Math.max(256, Number(options?.maxTokens || config?.llm?.responseMaxTokens || 3200))
          }
        })
      }, config?.llm?.timeout);
      const content = Array.isArray(data?.candidates?.[0]?.content?.parts)
        ? data.candidates[0].content.parts.map(part => String(part?.text || '').trim()).filter(Boolean).join('\n\n')
        : '';
      return { content: this._ensureText(content, data, 'gemini'), usage: data?.usageMetadata || data?.usage || {} };
    }
  }
  class WorldCoreXOllamaProvider extends WorldCoreXBaseProvider {
    async callLLM(config = {}, systemPrompt = '', userPrompt = '', options = {}) {
      const url = normalizeAnalysisOllamaEndpoint(resolveAnalysisProviderBaseUrl(config?.llm?.provider || 'ollama_cloud', config?.llm?.url));
      const useOpenAICompatibleEndpoint = isOpenAICompatibleOllamaChatEndpoint(url);
      const headers = { 'Content-Type': 'application/json' };
      if (String(config?.llm?.key || '').trim()) headers.Authorization = `Bearer ${config.llm.key}`;
      const data = await this._fetchJson(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(
          useOpenAICompatibleEndpoint
            ? {
                model: String(config?.llm?.model || '').trim(),
                messages: [
                  ...(String(systemPrompt || '').trim() ? [{ role: 'system', content: String(systemPrompt || '') }] : []),
                  { role: 'user', content: String(userPrompt || '') }
                ],
                temperature: Number(config?.llm?.temp ?? 0.2),
                max_tokens: Math.max(256, Number(options?.maxTokens || config?.llm?.responseMaxTokens || 3200)),
                stream: false
              }
            : {
                model: String(config?.llm?.model || '').trim(),
                messages: [
                  ...(String(systemPrompt || '').trim() ? [{ role: 'system', content: String(systemPrompt || '') }] : []),
                  { role: 'user', content: String(userPrompt || '') }
                ],
                stream: false,
                options: {
                  temperature: Number(config?.llm?.temp ?? 0.2),
                  num_predict: Math.max(256, Number(options?.maxTokens || config?.llm?.responseMaxTokens || 3200))
                }
              }
        )
      }, config?.llm?.timeout);
      const content = String(
        useOpenAICompatibleEndpoint
          ? data?.choices?.[0]?.message?.content
          : data?.message?.content || data?.response || ''
      ).trim();
      return { content: this._ensureText(content, data, 'ollama'), usage: data?.usage || {} };
    }
  }
  class WorldCoreXVertexProvider extends WorldCoreXBaseProvider {
    static _tokenCache = new Map();
    static async _generateAccessToken(clientEmail, privateKey) {
      const fetcher = getAvailableFetch();
      if (!fetcher) throw new WorldCoreXProviderError('nativeFetch/fetch is required for Vertex token exchange.', 'NO_FETCH');
      const now = Math.floor(Date.now() / 1000);
      const header = { alg: 'RS256', typ: 'JWT' };
      const claimSet = {
        iss: clientEmail,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
      };
      const encodedHeader = encodeBase64Url(new TextEncoder().encode(JSON.stringify(header)));
      const encodedClaimSet = encodeBase64Url(new TextEncoder().encode(JSON.stringify(claimSet)));
      const key = await crypto.subtle.importKey('pkcs8', decodePrivateKey(privateKey), { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } }, false, ['sign']);
      const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${encodedHeader}.${encodedClaimSet}`));
      const jwt = `${encodedHeader}.${encodedClaimSet}.${encodeBase64Url(new Uint8Array(signature))}`;
      const response = await fetcher('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(jwt)}`
      });
      if (!response?.ok) {
        const errText = await response?.text?.().catch(() => String(response?.status || 'Unknown')) || 'No response';
        throw new WorldCoreXProviderError(`Failed to get Vertex AI access token: ${errText}`, 'VERTEX_TOKEN_ERROR');
      }
      const data = await response.json();
      if (!data?.access_token) throw new WorldCoreXProviderError('No access token in Vertex AI token response', 'VERTEX_TOKEN_ERROR');
      return data.access_token;
    }
    static async _getAccessToken(rawKey) {
      const cacheKey = String(rawKey || '').trim();
      const cached = WorldCoreXVertexProvider._tokenCache.get(cacheKey);
      if (cached?.token && Date.now() < cached.expiry) return cached.token;
      let credentials = null;
      try {
        credentials = JSON.parse(cacheKey);
      } catch (_) {
        return cacheKey;
      }
      const clientEmail = String(credentials?.client_email || '').trim();
      const privateKey = String(credentials?.private_key || '').trim();
      if (!clientEmail || !privateKey) throw new WorldCoreXProviderError('Vertex AI credentials missing client_email or private_key.', 'VERTEX_CREDENTIAL_ERROR');
      const token = await WorldCoreXVertexProvider._generateAccessToken(clientEmail, privateKey);
      WorldCoreXVertexProvider._tokenCache.set(cacheKey, { token, expiry: Date.now() + 3500 * 1000 });
      return token;
    }
    async callLLM(config = {}, systemPrompt = '', userPrompt = '', options = {}) {
      this._ensureKey(config?.llm?.key);
      const baseUrl = String(config?.llm?.url || '').trim().replace(/\/$/, '');
      this._ensureUrl(baseUrl);
      const model = String(config?.llm?.model || '').trim();
      const url = baseUrl.includes(':generateContent') ? baseUrl : `${baseUrl}/${model}:generateContent`;
      const accessToken = await WorldCoreXVertexProvider._getAccessToken(config.llm.key);
      const data = await this._fetchJson(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          systemInstruction: systemPrompt ? { parts: [{ text: String(systemPrompt || '') }] } : undefined,
          contents: [{ role: 'user', parts: [{ text: String(userPrompt || '') }] }],
          generationConfig: {
            temperature: Number(config?.llm?.temp ?? 0.2),
            maxOutputTokens: Math.max(256, Number(options?.maxTokens || config?.llm?.responseMaxTokens || 3200))
          }
        })
      }, config?.llm?.timeout);
      const content = Array.isArray(data?.candidates?.[0]?.content?.parts)
        ? data.candidates[0].content.parts.map(part => String(part?.text || '').trim()).filter(Boolean).join('\n\n')
        : '';
      return { content: this._ensureText(content, data, 'vertex'), usage: data?.usageMetadata || data?.usage || {} };
    }
  }
  const WorldCoreXAnalysisProvider = (() => {
    const registry = {
      openai: new WorldCoreXOpenAIProvider(),
      openrouter: new WorldCoreXOpenAIProvider(),
      copilot: new WorldCoreXOpenAIProvider(),
      custom: new WorldCoreXOpenAIProvider(),
      claude: new WorldCoreXAnthropicProvider(),
      anthropic: new WorldCoreXAnthropicProvider(),
      gemini: new WorldCoreXGeminiProvider(),
      ollama_cloud: new WorldCoreXOllamaProvider(),
      ollama: new WorldCoreXOllamaProvider(),
      vertex: new WorldCoreXVertexProvider()
    };
    return {
      get(name = 'openai') {
        return registry[String(name || 'openai').toLowerCase()] || registry.openai;
      }
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
      responseMaxTokens: Math.max(256, Number(settings?.responseMaxTokens || 3200))
    }
  });
  const buildWorldAnalysisSnapshot = async (context = {}, bucket = {}, evidenceText = '', options = {}) => {
    const world = bucket?.world && typeof bucket.world === 'object' ? bucket.world : createDefaultWorldBucket();
    return {
      chatId: String(context?.chat?.id || 'global'),
      stage: compactText(options?.stage || 'manual', 40),
      scene: {
        node: compactText(world?.currentNodeName || '', 80),
        location: compactText(world?.location || '', 80),
        country: compactText(world?.country || '', 80),
        summary: compactText(world?.sceneSummary || '', 220)
      },
      world: {
        summary: compactText(world?.systemFocus || summarizeWorldSystemFocus(world, getSettings()), 260),
        autonomy: compactText(world?.autonomySummary || '', 220),
        structureSummary: compactText(world?.structure?.summary || '', 220),
        factions: normalizeArrayItems(world?.factions || []).slice(0, 5).map(item => compactText(buildStructuredSummary([item?.name, item?.summary, item?.patronBody || '', item?.controlRegions?.[0] || ''], 180), 180)),
        regions: normalizeArrayItems(world?.regions || []).slice(0, 5).map(item => compactText(buildStructuredSummary([item?.name, item?.summary, item?.accessLevel || '', `pressure ${Math.round(Number(item?.pressureScore || 0))}`], 180), 180)),
        offscreenThreads: normalizeArrayItems(world?.offscreenThreads || []).slice(0, 6).map(item => compactText(buildStructuredSummary([item?.title, item?.summary, item?.region || '', item?.status || '', `breakout ${Math.round(Number(item?.explosionRisk || 0) * 100)}%`], 180), 180)),
        timeline: {
          currentPhase: compactText(world?.timeline?.currentPhase || '', 160),
          temporalPulse: compactText(world?.timeline?.temporalPulse || '', 220),
          phaseShiftSummary: compactText(world?.timeline?.phaseShiftSummary || '', 220),
          forecast: compactText(world?.timeline?.forecast || '', 220)
        },
        propagation: normalizeArrayItems(world?.propagation || []).slice(0, 6).map(item => compactText(buildStructuredSummary([item?.summary, item?.kind, item?.region || '', item?.faction || ''], 180), 180)),
        publicPressure: normalizeArrayItems(world?.publicPressure || []).slice(0, 6).map(item => compactText(item?.summary || '', 180))
      },
      continuity: {
        backgroundEntities: normalizeArrayItems(bucket?.background?.entities || []).slice(0, 4).map(item => compactText(buildStructuredSummary([item?.name, item?.summary, item?.reasonLabel], 160), 160)),
        backgroundGroups: normalizeArrayItems(bucket?.background?.groups || []).slice(0, 4).map(item => compactText(buildStructuredSummary([item?.name, item?.summary, item?.reasonLabel], 160), 160)),
        recentHistory: buildRecentHistoryRows(bucket, 6).slice(0, 6).map(item => compactText(renderHistoryRichText(item, { mode: 'inline' }) || item?.text || '', 180))
      },
      evidence: compactText(evidenceText || '', 2200)
    };
  };
  const buildWorldAnalysisProviderPrompt = (snapshot = {}, stage = 'manual') => ({
    system: [
      'You are the analysis coprocessor for LIBRA World Core X.',
      'Inspect world continuity state and propose conservative world-pressure hints.',
      'Do not write story prose. Do not invent unsupported canon.',
      'Focus on laws, factions, regions, off-screen progression, timeline shifts, and propagation chains.',
      'Return strict JSON only.'
    ].join('\n'),
    user: JSON.stringify({
      task: 'Analyze this world state and return structured world continuity guidance.',
      stage,
      outputSchema: {
        summary: 'string',
        structuralHints: ['string'],
        factionHints: ['string'],
        offscreenHints: ['string'],
        regionalHints: ['string'],
        timelineHints: ['string'],
        propagationHints: ['string'],
        promptHints: ['string'],
        warnings: ['string']
      },
      snapshot
    }, null, 2)
  });
  const normalizeWorldAnalysisResult = (raw = {}, settings = getSettings().analysisProvider) => ({
    summary: compactText(raw?.summary || raw?.analysisSummary || '', 220),
    structuralHints: uniqueTexts(raw?.structuralHints || [], Math.max(2, Number(settings?.maxEvidenceSnippets || 4))),
    factionHints: uniqueTexts(raw?.factionHints || [], Math.max(2, Number(settings?.maxEvidenceSnippets || 4))),
    offscreenHints: uniqueTexts(raw?.offscreenHints || [], Math.max(2, Number(settings?.maxEvidenceSnippets || 4))),
    regionalHints: uniqueTexts(raw?.regionalHints || [], Math.max(2, Number(settings?.maxEvidenceSnippets || 4))),
    timelineHints: uniqueTexts(raw?.timelineHints || [], Math.max(2, Number(settings?.maxEvidenceSnippets || 4))),
    propagationHints: uniqueTexts(raw?.propagationHints || [], Math.max(2, Number(settings?.maxEvidenceSnippets || 4))),
    promptHints: uniqueTexts(raw?.promptHints || [], Math.max(3, Number(settings?.maxEvidenceSnippets || 4))),
    warnings: uniqueTexts(raw?.warnings || [], Math.max(2, Number(settings?.maxEvidenceSnippets || 4)))
  });
  const mergeWorldAnalysisIntoBucket = (bucket = {}, analysis = {}, settings = getSettings()) => {
    const world = bucket?.world && typeof bucket.world === 'object' ? bucket.world : createDefaultWorldBucket();
    const previous = world?.analysis && typeof world.analysis === 'object' ? world.analysis : createDefaultWorldBucket().analysis;
    const next = {
      ...previous,
      ...normalizeWorldAnalysisResult(analysis, settings.analysisProvider),
      provider: compactText(settings?.analysisProvider?.provider || '', 40),
      model: compactText(settings?.analysisProvider?.model || '', 80),
      stage: compactText(analysis?.stage || '', 40),
      updatedAt: Date.now()
    };
    world.analysis = next;
    if (settings?.analysisProvider?.autoApply === true) {
      world.systemFocus = buildStructuredSummary([world.systemFocus || '', next.summary || ''], 240);
      world.timeline.forecast = buildStructuredSummary([world?.timeline?.forecast || '', next.timelineHints?.[0] || '', next.promptHints?.[0] || ''], 220);
    }
    return JSON.stringify(previous || {}) !== JSON.stringify(next || {}) ? 1 : 0;
  };
  const approveWorldAnalysisProviderCall = (stage = 'manual', settings = {}, context = {}) => {
    const normalizedStage = compactText(stage || 'manual', 40).toLowerCase() || 'manual';
    if (!settings?.enabled) return { approved: false, reason: 'provider_disabled', stage: normalizedStage };
    if (settings?.stages?.[normalizedStage] !== true) return { approved: false, reason: 'stage_disabled', stage: normalizedStage };
    if (normalizedStage === 'manual' || context?.manualAnalysis === true || context?.forceAnalysisProvider === true) {
      if (settings?.manualRun === false && context?.forceAnalysisProvider !== true) {
        return { approved: false, reason: 'manual_run_disabled', stage: normalizedStage };
      }
      return { approved: true, reason: 'manual_or_forced', stage: normalizedStage };
    }
    const dirtyReasons = normalizeArrayItems(context?.dirtyReasons || context?.analysisDirtyReasons || []);
    const hasDirtyReason = dirtyReasons.length > 0
      || context?.dirty === true
      || context?.locationChanged === true
      || context?.timeSkipRequested === true
      || context?.worldRuleConflictDetected === true
      || context?.genreStyleShiftRequested === true
      || context?.offscreenThreadConflict === true
      || context?.legacyWorldMigrationNeeded === true;
    if (settings?.autoRun !== true && (!settings?.allowGatedAutoRun || !hasDirtyReason)) {
      return { approved: false, reason: 'auto_run_disabled_or_clean_domain', stage: normalizedStage };
    }
    if (settings?.onlyWhenDirty !== false && !hasDirtyReason) {
      return { approved: false, reason: 'clean_domain_cache_preferred', stage: normalizedStage };
    }
    try {
      const sharedApproval = globalThis?.LIBRA?.AnalysisProviderClient?.approveCall?.('world', {
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
      reason: hasDirtyReason ? 'dirty_world_guidance' : 'gated_auto',
      stage: normalizedStage,
      dirtyReasons
    };
  };
  const maybeRunAnalysisProvider = async (stage = 'manual', context = {}, bucket = {}, options = {}) => {
    const settings = normalizeAnalysisProviderSettings(getSettings().analysisProvider || {});
    const approval = approveWorldAnalysisProviderCall(stage, settings, context);
    reportCoordinatorRuntime({
      phase: `analysis-provider-${approval.approved ? 'approved' : 'skipped'}`,
      lastProviderGate: approval,
      genreWeightStatus: 'gated',
      settingOntologyStatus: 'projection'
    });
    if (!approval.approved) return null;
    if (isAnalysisProviderSuspended()) {
      updateRuntimeStatus(`analysis provider 중지 · 실패 ${runtimeState.analysisFailureCount}/${runtimeState.analysisFailureLimit}`);
      return null;
    }
    if (!String(settings?.key || '').trim()) return null;
    try {
      const snapshot = await buildWorldAnalysisSnapshot(context, bucket, options?.evidenceText || '', { stage });
      const prompt = buildWorldAnalysisProviderPrompt(snapshot, stage);
      const provider = WorldCoreXAnalysisProvider.get(settings.provider || 'openai');
      const result = await provider.callLLM(
        buildAnalysisProviderConfig(settings),
        prompt.system,
        prompt.user,
        { maxTokens: settings.responseMaxTokens }
      );
      const parsed = extractJsonCandidate(result?.content || '');
      if (!parsed) throw new WorldCoreXProviderError('Analysis provider returned non-JSON output.', 'INVALID_ANALYSIS_JSON', result?.content || '');
      resetAnalysisProviderFailureState();
      return normalizeWorldAnalysisResult(parsed, settings);
    } catch (error) {
      const failureCount = recordAnalysisProviderFailure(error);
      if (failureCount >= Number(runtimeState.analysisFailureLimit || ANALYSIS_PROVIDER_FAILURE_LIMIT)) {
        updateRuntimeStatus(`analysis provider 중지 · 실패 ${failureCount}/${runtimeState.analysisFailureLimit}`);
        return null;
      }
      throw error;
    }
  };
  const buildWorldPropagationSignals = (snapshot = {}, structure = {}, factions = [], regions = [], timeline = {}, offscreenThreads = []) => {
    const signals = [];
    normalizeArrayItems(regions).forEach((region) => {
      const faction = normalizeArrayItems(factions).find(item => normalizeName(item?.name) === normalizeName(region?.controlFaction));
      const matchingThreads = normalizeArrayItems(offscreenThreads).filter((thread) => (
        normalizeName(thread?.region) === normalizeName(region?.name)
        || findTextMentions(thread?.factions, faction?.name || '')
      ));
      const activeRestriction = normalizeArrayItems(region?.activeRestrictions)[0] || '';
      const governingBody = normalizeArrayItems(region?.governingBodies)[0] || '';
      if (region?.breakoutRisk && activeRestriction && faction?.name) {
        signals.push({
          id: `propagation-region-${normalizeLooseToken(region.name)}-${normalizeLooseToken(faction.name)}`,
          summary: compactText(`${activeRestriction} in ${region.name} intensifies ${faction.name} influence and raises scene spillover risk`, 180),
          score: scoreWorldSignalRelevance({
            sceneRelation: normalizeName(region?.name) === normalizeName(snapshot?.location) ? 0.92 : 0.48,
            regionMatch: normalizeName(region?.name) === normalizeName(snapshot?.location) ? 1 : 0.42,
            factionInvolvement: 0.84,
            urgency: clamp01(Number(faction?.heat || 0), 0.62),
            restrictionConflict: 0.86,
            carryoverOverlap: matchingThreads.length ? 0.72 : 0.35,
            base: 0.38
          }),
          region: region.name,
          faction: faction.name,
          thread: matchingThreads[0]?.title || '',
          kind: 'restriction-spillover'
        });
      }
      if (matchingThreads.length && normalizeArrayItems(region?.activeRestrictions).length) {
        signals.push({
          id: `propagation-thread-${normalizeLooseToken(region.name)}-${normalizeLooseToken(matchingThreads[0]?.title || 'thread')}`,
          summary: compactText(`${region.name} restrictions push off-screen thread ${matchingThreads[0].title} toward foreground`, 180),
          score: scoreWorldSignalRelevance({
            sceneRelation: normalizeName(region?.name) === normalizeName(snapshot?.location) ? 0.86 : 0.36,
            regionMatch: normalizeName(region?.name) === normalizeName(snapshot?.location) ? 1 : 0.46,
            factionInvolvement: faction?.name ? 0.76 : 0.32,
            urgency: clamp01(Number(matchingThreads[0]?.urgency || 0), 0.58),
            restrictionConflict: 0.82,
            carryoverOverlap: findTextMentions(snapshot?.carryoverSignals, matchingThreads[0]?.summary || '') ? 0.8 : 0.28,
            base: 0.34
          }),
          region: region.name,
          faction: faction?.name || '',
          thread: matchingThreads[0]?.title || '',
          kind: 'thread-promotion'
        });
      }
      if (governingBody && activeRestriction) {
        signals.push({
          id: `propagation-command-${normalizeLooseToken(region.name)}-${normalizeLooseToken(governingBody)}`,
          summary: compactText(`${governingBody} backs ${activeRestriction} in ${region.name}, tightening command pressure on local actors`, 180),
          score: scoreWorldSignalRelevance({
            sceneRelation: normalizeName(region?.name) === normalizeName(snapshot?.location) ? 0.84 : 0.34,
            regionMatch: normalizeName(region?.name) === normalizeName(snapshot?.location) ? 1 : 0.4,
            factionInvolvement: faction?.name ? 0.72 : 0.3,
            urgency: clamp01(Number(faction?.heat || 0), 0.58),
            restrictionConflict: 0.82,
            carryoverOverlap: matchingThreads.length ? 0.66 : 0.22,
            base: 0.32
          }),
          region: region.name,
          faction: faction?.name || '',
          thread: matchingThreads[0]?.title || '',
          kind: 'organization-command'
        });
      }
      if (region?.economy && /scarcity|ration|부족|배급|차단|inflation|물가/i.test(String(region.economy))) {
        signals.push({
          id: `propagation-economy-${normalizeLooseToken(region.name)}`,
          summary: compactText(`economic scarcity around ${region.name} lowers access and raises off-screen survival pressure`, 180),
          score: scoreWorldSignalRelevance({
            sceneRelation: normalizeName(region?.name) === normalizeName(snapshot?.location) ? 0.82 : 0.34,
            regionMatch: normalizeName(region?.name) === normalizeName(snapshot?.location) ? 1 : 0.44,
            factionInvolvement: faction?.name ? 0.58 : 0.24,
            urgency: 0.72,
            restrictionConflict: 0.64,
            carryoverOverlap: matchingThreads.length ? 0.62 : 0.26,
            base: 0.32
          }),
          region: region.name,
          faction: faction?.name || '',
          thread: matchingThreads[0]?.title || '',
          kind: 'economy-access'
        });
      }
      if (region?.publicOrder && /unstable|riot|crackdown|계엄|폭동|치안 붕괴|단속/i.test(String(region.publicOrder))) {
        signals.push({
          id: `propagation-order-${normalizeLooseToken(region.name)}`,
          summary: compactText(`public order instability in ${region.name} can push background conflict into the foreground`, 180),
          score: scoreWorldSignalRelevance({
            sceneRelation: normalizeName(region?.name) === normalizeName(snapshot?.location) ? 0.9 : 0.4,
            regionMatch: normalizeName(region?.name) === normalizeName(snapshot?.location) ? 1 : 0.46,
            factionInvolvement: faction?.name ? 0.66 : 0.28,
            urgency: 0.78,
            restrictionConflict: 0.58,
            carryoverOverlap: matchingThreads.length ? 0.74 : 0.24,
            base: 0.34
          }),
          region: region.name,
          faction: faction?.name || '',
          thread: matchingThreads[0]?.title || '',
          kind: 'order-foreground'
        });
      }
      const season = normalizeArrayItems(timeline?.seasonalContext)[0] || '';
      if (season && /winter|storm|monsoon|drought|festival|harvest|winter|우기|가뭄|축제|추수|겨울/i.test(String(season))) {
        signals.push({
          id: `propagation-season-${normalizeLooseToken(region.name)}-${normalizeLooseToken(season)}`,
          summary: compactText(`${season} conditions around ${region.name} shift movement and background pressure`, 180),
          score: scoreWorldSignalRelevance({
            sceneRelation: normalizeName(region?.name) === normalizeName(snapshot?.location) ? 0.72 : 0.28,
            regionMatch: normalizeName(region?.name) === normalizeName(snapshot?.location) ? 1 : 0.38,
            factionInvolvement: faction?.name ? 0.46 : 0.16,
            urgency: /storm|monsoon|drought|가뭄|폭우|폭설/i.test(String(season)) ? 0.7 : 0.48,
            restrictionConflict: activeRestriction ? 0.54 : 0.18,
            carryoverOverlap: matchingThreads.length ? 0.58 : 0.18,
            base: 0.26
          }),
          region: region.name,
          faction: faction?.name || '',
          thread: matchingThreads[0]?.title || '',
          kind: 'seasonal-strain'
        });
      }
    });
    normalizeArrayItems(factions).forEach((faction) => {
      if (Number(faction?.commandReach || 0) < 0.68 || !normalizeArrayItems(faction?.controlRegions).length) return;
      signals.push({
        id: `propagation-hierarchy-${normalizeLooseToken(faction?.name || '')}`,
        summary: compactText(`${faction?.patronBody || faction?.name} is tightening command pressure across ${faction.controlRegions[0]}`, 180),
        score: scoreWorldSignalRelevance({
          sceneRelation: normalizeName(faction?.controlRegions?.[0]) === normalizeName(snapshot?.location) ? 0.86 : 0.42,
          regionMatch: normalizeName(faction?.controlRegions?.[0]) === normalizeName(snapshot?.location) ? 1 : 0.38,
          factionInvolvement: 0.88,
          urgency: Math.max(0.62, Number(faction?.heat || 0)),
          restrictionConflict: normalizeArrayItems(faction?.linkedRules).length ? 0.76 : 0.34,
          carryoverOverlap: normalizeArrayItems(faction?.recentActions).length ? 0.7 : 0.24,
          base: 0.34
        }),
        region: faction?.controlRegions?.[0] || '',
        faction: faction?.name || '',
        thread: '',
        kind: 'hierarchy-pressure'
      });
    });
    normalizeArrayItems(timeline?.foregroundSignals).forEach((signal) => {
      const matchingThread = normalizeArrayItems(offscreenThreads).find((thread) => (
        findTextMentions([signal?.summary], thread?.title || '')
        || findTextMentions([thread?.summary], signal?.region || signal?.faction || '')
      ));
      if (!matchingThread) return;
      signals.push({
        id: `propagation-clock-${normalizeLooseToken(signal?.summary || '')}-${normalizeLooseToken(matchingThread?.title || '')}`,
        summary: compactText(`foreground pressure ${signal.summary} can pull ${matchingThread.title} into the next visible beat`, 180),
        score: Math.max(Number(signal?.intensity || 0), Number(matchingThread?.relevance || 0)),
        region: signal?.region || matchingThread?.region || '',
        faction: signal?.faction || matchingThread?.factions?.[0] || '',
        thread: matchingThread?.title || '',
        kind: 'clock-pull'
      });
    });
    normalizeArrayItems(timeline?.resolvedSignals).forEach((signal) => {
      const matchingThread = normalizeArrayItems(offscreenThreads).find((thread) => (
        findTextMentions([signal?.summary], thread?.title || '')
        || normalizeName(thread?.region) === normalizeName(signal?.region)
      ));
      if (!matchingThread) return;
      signals.push({
        id: `propagation-cooling-${normalizeLooseToken(signal?.summary || '')}-${normalizeLooseToken(matchingThread?.title || '')}`,
        summary: compactText(`cooling signal ${signal.summary} lets ${matchingThread.title} retreat back into background pressure`, 180),
        score: Math.max(28, Number(signal?.intensity || 0) - 18),
        region: signal?.region || matchingThread?.region || '',
        faction: signal?.faction || matchingThread?.factions?.[0] || '',
        thread: matchingThread?.title || '',
        kind: 'cooling-relief'
      });
    });
    return signals
      .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
      .slice(0, 6);
  };
  const applyPropagationToWorldLayers = (regions = [], timeline = {}, offscreenThreads = [], propagation = []) => {
    const boostedRegions = normalizeArrayItems(regions).map((region) => {
      const linked = normalizeArrayItems(propagation).filter(item => normalizeName(item?.region) === normalizeName(region?.name));
      if (!linked.length) return region;
      const organizationHits = linked.filter(item => item.kind === 'organization-command').length;
      const hierarchyHits = linked.filter(item => item.kind === 'hierarchy-pressure').length;
      const seasonalHits = linked.filter(item => item.kind === 'seasonal-strain').length;
      const nextPressureScore = Number(region?.pressureScore || 0)
        + Math.min(14, linked.length * 6)
        + Math.min(10, organizationHits * 4)
        + Math.min(10, hierarchyHits * 4)
        + Math.min(8, seasonalHits * 3);
      const coolingHit = linked.some(item => item.kind === 'cooling-relief');
      const economyHit = linked.some(item => item.kind === 'economy-access');
      const orderHit = linked.some(item => item.kind === 'order-foreground');
      const organizationHit = organizationHits > 0;
      const hierarchyHit = hierarchyHits > 0;
      const seasonalHit = seasonalHits > 0;
      const nextAccessLevel = economyHit
        ? compactText(region?.accessLevel === 'restricted' || region?.accessLevel === 'weather-limited' ? 'sealed' : 'restricted', 60)
        : (organizationHit
          ? compactText(region?.accessLevel === 'open' ? 'controlled' : region?.accessLevel || 'controlled', 60)
          : (hierarchyHit
            ? compactText(region?.accessLevel === 'open' ? 'checkpointed' : region?.accessLevel || 'checkpointed', 60)
          : (seasonalHit
            ? compactText(region?.accessLevel === 'open' ? 'weather-limited' : region?.accessLevel || 'weather-limited', 60)
            : (coolingHit ? compactText(region?.accessLevel === 'sealed' ? 'restricted' : region?.accessLevel || 'open', 60) : region?.accessLevel))));
      const nextSafety = orderHit
        ? compactText(region?.safety === 'high-risk' ? 'high-risk' : 'tense', 60)
        : (seasonalHit
          ? compactText(region?.safety === 'stable' ? 'strained' : region?.safety || 'strained', 60)
          : (coolingHit ? compactText(region?.safety === 'high-risk' ? 'tense' : region?.safety || 'stable', 60) : region?.safety));
      const nextPublicOrder = organizationHit
        ? compactText(buildStructuredSummary([
          region?.publicOrder || '',
          'command posture tightening local control'
        ], 120), 120)
        : (hierarchyHit
          ? compactText(buildStructuredSummary([
            region?.publicOrder || '',
            'hierarchy pressure is raising visible enforcement'
          ], 120), 120)
        : (coolingHit
          ? compactText(buildStructuredSummary([
            region?.publicOrder || '',
            'pressure partially cooled'
          ], 120), 120)
          : region?.publicOrder));
      const nextCoolingBias = clamp01(
        coolingHit
          ? Math.max(0.24, Number(region?.coolingBias || 0) + 0.16)
          : Math.max(0.1, (Number(region?.coolingBias || 0) * 0.56) + (seasonalHit ? 0.04 : 0) + (hierarchyHit ? 0.02 : 0)),
        0.18
      );
      return {
        ...region,
        pressureScore: coolingHit ? Math.max(0, nextPressureScore - 10) : nextPressureScore,
        breakoutRisk: coolingHit ? false : Boolean(
          region?.breakoutRisk
          || organizationHit
          || hierarchyHit
          || seasonalHits >= 2
          || linked.some(item => item.kind === 'restriction-spillover' || item.kind === 'order-foreground')
        ),
        summary: compactText(buildStructuredSummary([
          region?.summary || '',
          organizationHit ? 'organization command is tightening local movement' : '',
          hierarchyHit ? 'hierarchy pressure is reinforcing checkpoints and control' : '',
          seasonalHit ? 'seasonal strain is stressing access and supply' : ''
        ], 180), 180),
        accessLevel: nextAccessLevel,
        safety: nextSafety,
        publicOrder: nextPublicOrder,
        commandReach: Math.min(1, Number(region?.commandReach || 0) + (organizationHit ? 0.08 : 0) + (hierarchyHit ? 0.1 : 0)),
        seasonalLoad: clamp01(Number(region?.seasonalLoad || 0) + (seasonalHit ? 0.08 : 0), Number(region?.seasonalLoad || 0)),
        coolingBias: nextCoolingBias,
        stage: describePressureStage(coolingHit ? Math.max(0, nextPressureScore - 10) : nextPressureScore)
      };
    });
    const boostedThreads = normalizeArrayItems(offscreenThreads).map((thread) => {
      const linked = normalizeArrayItems(propagation).filter((item) => (
        normalizeName(item?.thread) === normalizeName(thread?.title)
        || (item?.region && normalizeName(item?.region) === normalizeName(thread?.region))
      ));
      if (!linked.length) return thread;
      const organizationHits = linked.filter(item => item.kind === 'organization-command').length;
      const hierarchyHits = linked.filter(item => item.kind === 'hierarchy-pressure').length;
      const seasonalHits = linked.filter(item => item.kind === 'seasonal-strain').length;
      const forecastHit = linked.some(item => item.kind === 'clock-pull' || item.kind === 'order-foreground');
      const coolingHit = linked.some(item => item.kind === 'cooling-relief');
      const urgency = coolingHit
        ? clamp01(Number(thread?.urgency || 0) - 0.18, 0)
        : clamp01(
          Number(thread?.urgency || 0)
          + Math.min(0.16, linked.length * 0.06)
          + Math.min(0.08, organizationHits * 0.03)
          + Math.min(0.08, hierarchyHits * 0.03)
          + Math.min(0.1, seasonalHits * 0.04),
          0
        );
      const pressure = coolingHit
        ? clamp01(Number(thread?.pressure || 0) - 0.2, 0)
        : clamp01(
          Number(thread?.pressure || 0)
          + Math.min(0.18, linked.length * 0.07)
          + Math.min(0.08, organizationHits * 0.03),
          0
        );
      const pressureWithHierarchy = coolingHit
        ? pressure
        : clamp01(
          pressure + Math.min(0.08, hierarchyHits * 0.03),
          0
        );
      const momentum = coolingHit
        ? clamp01(Number(thread?.momentum || 0) - 0.18, 0)
        : clamp01(
          Number(thread?.momentum || 0)
          + Math.min(0.2, linked.length * 0.08)
          + Math.min(0.08, organizationHits * 0.02)
          + Math.min(0.08, hierarchyHits * 0.02)
          + Math.min(0.08, seasonalHits * 0.02),
          0
        );
      const relevance = coolingHit
        ? Math.max(0, Number(thread?.relevance || 0) - 14)
        : Math.min(100, Number(thread?.relevance || 0) + (linked.length * 8) + (organizationHits * 6) + (hierarchyHits * 6) + (seasonalHits * 5));
      const coolingBias = clamp01(
        coolingHit
          ? Math.max(0.28, Number(thread?.coolingBias || 0) + 0.18)
          : Math.max(0.1, (Number(thread?.coolingBias || 0) * 0.56) + (seasonalHits ? 0.04 : 0)),
        0.18
      );
      const explosionRisk = coolingHit
        ? clamp01(Number(thread?.explosionRisk || 0) - 0.18, 0)
        : clamp01(
          Number(thread?.explosionRisk || 0)
          + (forecastHit ? 0.14 : 0.05)
          + (organizationHits * 0.05)
          + (hierarchyHits * 0.06)
          + (seasonalHits * 0.04),
          0
        );
      const status = describeThreadState({
        urgency,
        pressure: pressureWithHierarchy,
        dormancy: Number(thread?.dormancy || 0),
        relevance,
        carryoverHit: !coolingHit
      });
      const outcome = explosionRisk >= 0.82
        ? 'breakout-risk'
        : (coolingBias >= 0.62 && (coolingHit || relevance < 48)
          ? 'cooling'
          : buildEscalationOutcome({
        status,
        momentum,
        urgency,
        pressure: pressureWithHierarchy,
        dormancy: Number(thread?.dormancy || 0)
      }));
      return {
        ...thread,
        urgency,
        pressure: pressureWithHierarchy,
        momentum,
        relevance,
        commandReach: Math.min(1, Number(thread?.commandReach || 0) + (organizationHits * 0.06) + (hierarchyHits * 0.08)),
        coolingBias,
        explosionRisk,
        foregroundCandidate: coolingHit ? false : Boolean(
          thread?.foregroundCandidate
          || organizationHits > 0
          || hierarchyHits > 0
          || seasonalHits > 0
          || forecastHit
          || explosionRisk >= 0.7
          || relevance >= 62
        ),
        status,
        outcome,
        statusNote: buildStructuredSummary([
          status,
          outcome !== 'latent' ? outcome : '',
          coolingHit ? 'cooling propagated' : 'propagation boosted',
          organizationHits ? 'command pressure rising' : '',
          hierarchyHits ? 'hierarchy pressure rising' : '',
          seasonalHits ? 'seasonal burden increasing' : ''
        ], 140)
      };
    });
    const existingForeground = normalizeArrayItems(timeline?.foregroundSignals || []);
    const existingResolved = normalizeArrayItems(timeline?.resolvedSignals || []);
    const propagatedForeground = normalizeArrayItems(propagation)
      .filter(item => Number(item?.score || 0) >= 70)
      .slice(0, 2)
      .map((item) => ({
        id: `propagated-${normalizeLooseToken(item?.summary || '')}`,
        summary: compactText(item?.summary || '', 180),
        intensity: Number(item?.score || 0),
        delta: 0,
        stage: describePressureStage(Number(item?.score || 0)),
        previousStage: '',
        stageTransition: '',
        trend: 'up',
        turnsActive: 1,
        foreground: true,
        region: compactText(item?.region || '', 80),
        faction: compactText(item?.faction || '', 80),
        resolved: false,
        resolutionHint: buildResolutionHint({
          summary: item?.summary || '',
          stage: describePressureStage(Number(item?.score || 0)),
          trend: 'up',
          region: item?.region || '',
          faction: item?.faction || ''
        })
      }));
    const propagatedResolved = normalizeArrayItems(propagation)
      .filter(item => item.kind === 'cooling-relief')
      .slice(0, 2)
      .map((item) => ({
        id: `propagated-resolved-${normalizeLooseToken(item?.summary || '')}`,
        summary: compactText(item?.summary || '', 180),
        intensity: Math.max(18, Number(item?.score || 0) - 12),
        delta: -12,
        stage: 'watch',
        previousStage: 'rising',
        stageTransition: 'rising -> watch',
        trend: 'down',
        turnsActive: 1,
        foreground: false,
        region: compactText(item?.region || '', 80),
        faction: compactText(item?.faction || '', 80),
        resolved: true,
        resolutionHint: buildResolutionHint({
          summary: item?.summary || '',
          stage: 'watch',
          trend: 'down',
          region: item?.region || '',
          faction: item?.faction || ''
        })
      }));
    return {
      regions: boostedRegions,
      offscreenThreads: boostedThreads,
      timeline: {
        ...timeline,
        temporalPulse: buildStructuredSummary([
          timeline?.temporalPulse || '',
          propagatedForeground[0]?.summary ? `propagated ${propagatedForeground[0].summary}` : '',
          propagatedResolved[0]?.summary ? `cooling ${propagatedResolved[0].summary}` : ''
        ], 220),
        phaseShiftSummary: buildStructuredSummary([
          timeline?.phaseShiftSummary || '',
          propagatedForeground[0]?.summary ? `foreground pull ${propagatedForeground[0].summary}` : '',
          propagatedResolved[0]?.summary ? `relief ${propagatedResolved[0].summary}` : ''
        ], 220),
        forecast: buildStructuredSummary([
          timeline?.forecast || '',
          propagatedForeground[0]?.summary ? `watch ${propagatedForeground[0].summary}` : '',
          propagatedResolved[0]?.summary ? `cooling ${propagatedResolved[0].summary}` : ''
        ], 220),
        foregroundSignals: uniqueTexts([
          ...existingForeground.map(item => item?.summary || ''),
          ...propagatedForeground.map(item => item?.summary || '')
        ], 5).map((summary) => (
          existingForeground.find(item => normalizeLooseToken(item?.summary) === normalizeLooseToken(summary))
          || propagatedForeground.find(item => normalizeLooseToken(item?.summary) === normalizeLooseToken(summary))
        )).filter(Boolean),
        resolvedSignals: uniqueTexts([
          ...existingResolved.map(item => item?.summary || ''),
          ...propagatedResolved.map(item => item?.summary || '')
        ], 5).map((summary) => (
          existingResolved.find(item => normalizeLooseToken(item?.summary) === normalizeLooseToken(summary))
          || propagatedResolved.find(item => normalizeLooseToken(item?.summary) === normalizeLooseToken(summary))
        )).filter(Boolean)
      }
    };
  };
  const summarizeWorldAutonomy = (world = {}) => compactText([
    world?.timeline?.pressureClock?.[0]?.summary ? `clock ${world.timeline.pressureClock[0].summary}` : '',
    world?.offscreenThreads?.[0]?.title ? `thread ${world.offscreenThreads[0].title}` : '',
    world?.factions?.[0]?.name ? `faction ${world.factions[0].name}` : '',
    world?.regions?.[0]?.name ? `region ${world.regions[0].name}` : '',
    normalizeArrayItems(world?.propagation || []).find(item => item?.kind === 'organization-command')?.summary
      ? `command ${normalizeArrayItems(world?.propagation || []).find(item => item?.kind === 'organization-command')?.summary}`
      : '',
    normalizeArrayItems(world?.propagation || []).find(item => item?.kind === 'seasonal-strain')?.summary
      ? `season ${normalizeArrayItems(world?.propagation || []).find(item => item?.kind === 'seasonal-strain')?.summary}`
      : ''
  ].filter(Boolean).join(' | '), 220);
  const buildWorldStructureSnapshot = (context = {}, bucket = {}, settings = getSettings(), snapshot = {}) => {
    const currentNode = context?.HierarchicalWorldManager?.getCurrentNode?.() || null;
    const nodeMeta = currentNode?.meta?.worldMetadata || {};
    const worldState = context?.WorldStateTracker?.getState?.() || {};
    const worldManagerInputs = context?.worldManagerInputs && typeof context.worldManagerInputs === 'object'
      ? context.worldManagerInputs
      : {};
    const baseRegions = dedupeStructuredItems([
      ...(snapshot?.regions || []),
      ...normalizeArrayItems(nodeMeta?.regions),
      ...normalizeArrayItems(worldState?.regions),
      snapshot?.location ? {
        name: snapshot.location,
        summary: buildStructuredSummary([snapshot.currentNodeName, snapshot.country ? `country ${snapshot.country}` : ''], 180),
        safety: '',
        controlFaction: '',
        accessLevel: ''
      } : null
    ], 6).map((item) => ({
      name: compactText(item?.name || item?.key || '', 80),
      summary: compactText(item?.summary || '', 180),
      safety: compactText(item?.safety || item?.security || '', 60),
      controlFaction: compactText(item?.controlFaction || item?.owner || item?.governor || '', 80),
      accessLevel: compactText(item?.accessLevel || item?.access || '', 60)
    })).filter(item => item.name);
    const structure = {
      institutions: dedupeStructuredItems([
        ...normalizeArrayItems(nodeMeta?.institutions),
        ...normalizeArrayItems(worldState?.institutions),
        ...collectWorldGroups(context).map((group) => ({
          name: group.name,
          type: group.kind,
          summary: group.summary,
          influence: compactText(group.role || group.managementStyle || '', 90),
          status: 'active'
        }))
      ], 6).map((item) => ({
        name: compactText(item?.name || '', 80),
        type: compactText(item?.type || 'institution', 40),
        summary: compactText(item?.summary || '', 180),
        influence: compactText(item?.influence || item?.role || '', 90),
        status: compactText(item?.status || '', 40)
      })).filter(item => item.name),
      laws: dedupeStructuredItems([
        ...normalizeArrayItems(nodeMeta?.laws),
        ...normalizeArrayItems(worldManagerInputs?.activeRules),
        ...(snapshot?.worldLimits || []).map((item, index) => ({
          key: `limit-${index + 1}`,
          summary: item,
          scope: snapshot.currentNodeName || snapshot.location || 'scene',
          severity: /ban|금지|봉쇄|통행|검문|사형|처벌|restriction/i.test(item) ? 'high' : 'medium'
        }))
      ], 6).map((item) => ({
        key: compactText(item?.key || item?.name || '', 60),
        summary: compactText(item?.summary || '', 180),
        scope: compactText(item?.scope || '', 60),
        severity: compactText(item?.severity || '', 40)
      })).filter(item => item.summary),
      economy: dedupeStructuredItems([
        ...normalizeArrayItems(nodeMeta?.economy),
        ...normalizeArrayItems(worldState?.economy),
        ...(snapshot?.worldLimits || []).filter(item => /scarcity|ration|공급|부족|물가|봉쇄/i.test(item)).map((item, index) => ({
          key: `economy-${index + 1}`,
          summary: item,
          scarcityLevel: /severe|critical|심각|극심/i.test(item) ? 0.85 : 0.6,
          affectedRegions: snapshot.location ? [snapshot.location] : []
        }))
      ], 5).map((item) => ({
        key: compactText(item?.key || item?.name || '', 60),
        summary: compactText(item?.summary || '', 180),
        scarcityLevel: clamp01(item?.scarcityLevel, 0.45),
        affectedRegions: uniqueTexts(item?.affectedRegions || [], 4)
      })).filter(item => item.summary),
      culture: dedupeStructuredItems([
        ...normalizeArrayItems(nodeMeta?.culture),
        ...normalizeArrayItems(worldState?.culture),
        ...(snapshot?.codexSignals || []).filter(item => /taboo|custom|tradition|ritual|예법|금기|풍습|문화/i.test(item)).map((item, index) => ({
          key: `culture-${index + 1}`,
          summary: item,
          taboo: /taboo|금기/i.test(item) ? item : '',
          norm: /custom|tradition|ritual|예법|풍습/i.test(item) ? item : ''
        }))
      ], 5).map((item) => ({
        key: compactText(item?.key || '', 60),
        summary: compactText(item?.summary || '', 180),
        taboo: compactText(item?.taboo || '', 100),
        norm: compactText(item?.norm || '', 100)
      })).filter(item => item.summary),
      religion: dedupeStructuredItems([
        ...normalizeArrayItems(nodeMeta?.religion),
        ...normalizeArrayItems(worldState?.religion)
      ], 4).map((item) => ({
        key: compactText(item?.key || item?.name || '', 60),
        summary: compactText(item?.summary || '', 180),
        norm: compactText(item?.norm || item?.doctrine || '', 100)
      })).filter(item => item.summary),
      regions: baseRegions,
      infrastructure: dedupeStructuredItems([
        ...normalizeArrayItems(nodeMeta?.infrastructure),
        ...normalizeArrayItems(worldState?.infrastructure)
      ], 4).map((item) => ({
        key: compactText(item?.key || item?.name || '', 60),
        summary: compactText(item?.summary || '', 180),
        status: compactText(item?.status || '', 40)
      })).filter(item => item.summary),
      scarcity: dedupeStructuredItems([
        ...normalizeArrayItems(nodeMeta?.scarcity),
        ...(snapshot?.worldLimits || []).filter(item => /scarcity|ration|부족|제한|차단/i.test(item)).map((item, index) => ({
          key: `scarcity-${index + 1}`,
          summary: item,
          severity: /severe|critical|심각|극심/i.test(item) ? 'high' : 'medium'
        }))
      ], 4).map((item) => ({
        key: compactText(item?.key || '', 60),
        summary: compactText(item?.summary || '', 180),
        severity: compactText(item?.severity || '', 40)
      })).filter(item => item.summary),
      publicOrder: dedupeStructuredItems([
        ...normalizeArrayItems(nodeMeta?.publicOrder),
        ...(snapshot?.scenePressures || []).filter(item => /curfew|patrol|riot|police|검문|치안|계엄|폭동/i.test(item)).map((item, index) => ({
          key: `order-${index + 1}`,
          summary: item,
          status: /riot|폭동|붕괴/i.test(item) ? 'unstable' : 'tight'
        }))
      ], 4).map((item) => ({
        key: compactText(item?.key || '', 60),
        summary: compactText(item?.summary || '', 180),
        status: compactText(item?.status || '', 40)
      })).filter(item => item.summary),
      summary: ''
    };
    structure.summary = buildStructuredSummary([
      structure.institutions[0] ? `institutions ${structure.institutions[0].name}` : '',
      structure.laws[0] ? `law ${structure.laws[0].summary}` : '',
      structure.economy[0] ? `economy ${structure.economy[0].summary}` : '',
      structure.regions[0] ? `region ${structure.regions[0].name}` : '',
      structure.publicOrder[0] ? `order ${structure.publicOrder[0].summary}` : ''
    ], 240);
    return structure;
  };
  const refreshFactionSignals = (context = {}, bucket = {}, contextText = '', turn = 0, settings = getSettings(), snapshot = {}) => {
    const world = bucket?.world && typeof bucket.world === 'object' ? bucket.world : createDefaultWorldBucket();
    const previousFactions = Array.isArray(world?.factions) ? world.factions : [];
    const sceneMeta = getCurrentSceneLocationMeta(context);
    const relationSignals = snapshot?.relationSignals || [];
    const groups = collectWorldGroups(context);
    const trackedGroups = Object.values(bucket?.groups || {});
    const mode = String(settings.factionEmphasis || 'balanced');
    const limit = mode === 'heavy' ? 6 : 4;
    const merged = dedupeStructuredItems([
      ...groups,
      ...trackedGroups.map((group) => ({
        name: group.name,
        kind: group.kind,
        summary: group.currentSummary || group.description || '',
        role: group.role,
        members: group.members,
        groupStats: group.groupStats
      }))
    ], 12);
    return merged.map((group, index) => {
      const previousFaction = previousFactions.find(item => normalizeName(item?.name) === normalizeName(group?.name));
      const controlRegions = uniqueTexts([
        ...normalizeArrayItems(group?.controlRegions),
        ...normalizeArrayItems(group?.regions),
        ...normalizeArrayItems(group?.bases),
        findTextMentions([group?.summary, group?.description], sceneMeta.location) ? sceneMeta.location : ''
      ], 4);
      const hierarchy = buildOrganizationHierarchyProfile(snapshot, [group?.name], controlRegions);
      const linkedRules = inferLinkedRules(snapshot, [group?.name], controlRegions);
      const linkedOrganizations = inferLinkedOrganizations(snapshot, [group?.name], controlRegions);
      const recentActions = uniqueTexts([
        ...(snapshot?.scenePressures || []).filter(item => findTextMentions([item], group?.name)),
        ...(snapshot?.carryoverSignals || []).filter(item => findTextMentions([item], group?.name)),
        ...(snapshot?.codexSignals || []).filter(item => findTextMentions([item], group?.name)),
        ...(snapshot?.offscreenDevelopments || []).filter(item => findTextMentions([item], group?.name)),
        ...linkedRules
      ], 3);
      const tension = clamp01(
        recentActions.some(item => /conflict|raid|purge|strike|전쟁|충돌|탄압|습격/i.test(item))
          ? 0.78
          : Math.max(0.45, hierarchy.commandReach * 0.72),
        0.45
      );
      const longTermRisk = clamp01(
        recentActions.some(item => /war|collapse|scarcity|rebellion|전쟁|붕괴|부족|반란/i.test(item))
          ? 0.82
          : Math.max(0.4, hierarchy.authorityBias * 0.64),
        0.4
      );
      const heat = clamp01(
        Math.max(
          tension,
          longTermRisk,
          clamp01((Number(previousFaction?.heat || 0) * 0.58) + (recentActions.length ? 0.28 : 0) + (hierarchy.commandReach * 0.16), 0)
        ),
        0.35
      );
      const factionInvolvement = recentActions.length ? 0.8 : (controlRegions.includes(sceneMeta.location) ? 0.65 : 0.35);
      const relevanceScore = scoreWorldSignalRelevance({
        sceneRelation: controlRegions.includes(sceneMeta.location) ? 0.85 : 0.3,
        focusEntityRelevance: mentionsName(contextText, group?.name) ? 0.8 : 0.35,
        recency: Math.min(1, Number(turn || 0) / Math.max(1, Number(turn || 1))),
        regionMatch: controlRegions.includes(sceneMeta.location) || controlRegions.includes(sceneMeta.country) ? 0.8 : 0.2,
        factionInvolvement,
        urgency: Math.max(tension, linkedRules.length ? 0.62 : 0.35, hierarchy.commandReach * 0.74),
        carryoverOverlap: recentActions.length ? 0.7 : 0.2,
        restrictionConflict: linkedRules.length ? 0.74 : Math.max(0.18, hierarchy.authorityBias * 0.68),
        base: 0.42
      });
      const stanceScore = Math.round(((factionInvolvement * 0.55) + (heat * 0.45)) * 100);
      return {
        id: compactText(group?.id || `faction-${index + 1}-${normalizeLooseToken(group?.name || 'group')}`, 80),
        name: compactText(group?.name || '', 80),
        kind: compactText(group?.kind || group?.type || 'group', 40),
        officialGoal: compactText(group?.role || group?.goal || group?.summary || '', 160),
        unofficialGoal: compactText(group?.managementStyle || group?.description || '', 160),
        resources: uniqueTexts([
          ...normalizeArrayItems(group?.assets),
          ...normalizeArrayItems(group?.resources),
          group?.members?.length ? `members ${group.members.length}` : ''
        ], 4),
        linkedRules,
        linkedOrganizations,
        patronBody: hierarchy.primaryBody,
        hierarchyTier: hierarchy.hierarchyTier,
        commandReach: hierarchy.commandReach,
        authorityBias: hierarchy.authorityBias,
        hierarchySummary: hierarchy.hierarchySummary,
        influence: compactText(group?.role || group?.managementStyle || '', 80),
        controlRegions,
        allies: uniqueTexts(relationSignals.filter(item => findTextMentions([item], group?.name) && /ally|협력|동맹/i.test(item)), 3),
        enemies: uniqueTexts(relationSignals.filter(item => findTextMentions([item], group?.name) && /enemy|hostile|적대|충돌/i.test(item)), 3),
        recentActions,
        tension,
        longTermRisk,
        heat,
        stanceScore,
        stage: describePressureStage(relevanceScore),
        lastShiftTurn: Number(previousFaction?.lastShiftTurn || turn || 0),
        status: recentActions[0]
          ? (hierarchy.commandReach >= 0.68 ? 'command-active' : 'active')
          : (hierarchy.hierarchyTier >= 2 ? 'held' : 'latent'),
        relevanceScore,
        summary: buildStructuredSummary([
          group?.summary || group?.description || '',
          controlRegions[0] ? `control ${controlRegions[0]}` : '',
          hierarchy.primaryBody ? `command ${hierarchy.primaryBody}` : '',
          linkedRules[0] ? `rule ${linkedRules[0]}` : '',
          recentActions[0] ? `action ${recentActions[0]}` : '',
          `heat ${Math.round(heat * 100)}%`
        ], 220)
      };
    }).filter(item => item.name)
      .sort((left, right) => Number(right.relevanceScore || 0) - Number(left.relevanceScore || 0))
      .slice(0, limit);
  };
  const refreshRegionalState = (context = {}, bucket = {}, contextText = '', turn = 0, settings = getSettings(), snapshot = {}, structure = null, factions = []) => {
    const sceneMeta = getCurrentSceneLocationMeta(context);
    const previousRegions = Array.isArray(bucket?.world?.regions) ? bucket.world.regions : [];
    const existingRegions = dedupeStructuredItems([
      ...(structure?.regions || []),
      ...normalizeArrayItems(snapshot?.regions),
      ...normalizeArrayItems(bucket?.world?.regions)
    ], 8);
    const byName = new Map();
    existingRegions.forEach((region) => {
      const name = normalizeName(region?.name || region?.key);
      if (!name) return;
      const previousRegion = previousRegions.find(item => normalizeName(item?.name) === name);
      const matchedFaction = normalizeArrayItems(factions).find((faction) => normalizeArrayItems(faction?.controlRegions).some(item => normalizeName(item) === name));
      const hierarchy = buildOrganizationHierarchyProfile(snapshot, [name, matchedFaction?.name || ''], [name]);
      const seasonalLoad = deriveSeasonalLoad(snapshot?.seasonalContext?.[0] || bucket?.world?.timeline?.seasonalContext?.[0] || '');
      const activeRestrictions = inferLinkedRules(snapshot, [name, matchedFaction?.name || ''], [name]);
      const governingBodies = inferLinkedOrganizations(snapshot, [name, matchedFaction?.name || ''], [name]);
      const pressureHits = uniqueTexts([
        ...(snapshot?.scenePressures || []).filter(item => findTextMentions([item], name)),
        ...(snapshot?.worldLimits || []).filter(item => findTextMentions([item], name)),
        ...(snapshot?.carryoverSignals || []).filter(item => findTextMentions([item], name)),
        ...(snapshot?.offscreenDevelopments || []).filter(item => findTextMentions([item], name)),
        ...activeRestrictions
      ], 3);
      const pressureScore = scoreWorldSignalRelevance({
        sceneRelation: name === sceneMeta.location ? 0.9 : 0.35,
        focusEntityRelevance: mentionsName(contextText, name) ? 0.75 : 0.2,
        recency: pressureHits.length ? 0.72 : 0.3,
        regionMatch: name === sceneMeta.location || name === sceneMeta.country ? 1 : 0.25,
        factionInvolvement: matchedFaction ? Math.max(0.7, Number(matchedFaction?.commandReach || 0) * 0.78) : Math.max(0.2, hierarchy.commandReach * 0.64),
        urgency: pressureHits.some(item => /danger|raid|infection|폭동|봉쇄|검문/i.test(item)) ? 0.8 : Math.max(0.35, seasonalLoad * 0.7),
        restrictionConflict: pressureHits.some(item => /limit|ban|금지|봉쇄|검문/i.test(item)) ? 0.75 : Math.max(0.2, hierarchy.authorityBias * 0.62),
        carryoverOverlap: pressureHits.length ? 0.68 : 0.18,
        base: 0.3
      });
      const coolingBias = clamp01(
        Math.max(
          Number(previousRegion?.coolingBias || 0) * 0.56,
          pressureHits.length ? 0.14 : 0.34,
          seasonalLoad >= 0.58 ? 0.12 : 0.3
        ),
        0.18
      );
      byName.set(name, {
        name,
        summary: compactText(region?.summary || buildStructuredSummary([
          ...pressureHits,
          hierarchy.primaryBody ? `command ${hierarchy.primaryBody}` : '',
          seasonalLoad >= 0.58 ? 'seasonal strain active' : ''
        ], 180) || '', 180),
        safety: compactText(region?.safety || (pressureScore >= 72 ? 'high-risk' : pressureScore >= 48 ? 'tense' : 'stable'), 60),
        controlFaction: compactText(region?.controlFaction || matchedFaction?.name || '', 80),
        accessLevel: compactText(
          region?.accessLevel
          || (pressureHits.some(item => /ban|금지|봉쇄|통행/i.test(item))
            ? 'restricted'
            : (seasonalLoad >= 0.7 ? 'weather-limited' : (hierarchy.commandReach >= 0.7 ? 'controlled' : 'open'))),
          60
        ),
        economy: compactText(region?.economy || structure?.economy?.find(item => normalizeArrayItems(item?.affectedRegions).some(value => normalizeName(value) === name))?.summary || '', 120),
        publicOrder: compactText(region?.publicOrder || structure?.publicOrder?.[0]?.summary || '', 120),
        culturalTone: compactText(region?.culturalTone || structure?.culture?.[0]?.summary || '', 120),
        activeRestrictions,
        governingBodies,
        governanceTier: hierarchy.hierarchyTier,
        commandReach: hierarchy.commandReach,
        authorityBias: hierarchy.authorityBias,
        seasonalLoad,
        coolingBias,
        connectedRegions: uniqueTexts([
          ...normalizeArrayItems(region?.connectedRegions),
          ...normalizeArrayItems(previousRegion?.connectedRegions),
          ...normalizeArrayItems(existingRegions)
            .map(item => normalizeName(item?.name))
            .filter(otherName => otherName && otherName !== name && (
              normalizeName(region?.controlFaction || matchedFaction?.name || '') && normalizeName(region?.controlFaction || matchedFaction?.name || '') === normalizeName(existingRegions.find(item => normalizeName(item?.name) === otherName)?.controlFaction || '')
            ))
        ], 4),
        pressureScore,
        breakoutRisk: pressureScore >= 72
          || activeRestrictions.some(item => /ban|crackdown|봉쇄|계엄|검문/i.test(item))
          || (seasonalLoad >= 0.7 && pressureScore >= 58)
          || (hierarchy.commandReach >= 0.72 && pressureScore >= 54),
        stage: describePressureStage(pressureScore)
      });
    });
    if (sceneMeta.location && !byName.has(sceneMeta.location)) {
      const hierarchy = buildOrganizationHierarchyProfile(snapshot, [sceneMeta.location], [sceneMeta.location]);
      const seasonalLoad = deriveSeasonalLoad(snapshot?.seasonalContext?.[0] || '');
      byName.set(sceneMeta.location, {
        name: sceneMeta.location,
        summary: compactText(snapshot?.sceneSummary || '', 180),
        safety: snapshot?.worldLimits?.[0] ? 'tense' : 'stable',
        controlFaction: compactText(factions?.[0]?.name || '', 80),
        accessLevel: snapshot?.worldLimits?.[0] ? 'restricted' : (seasonalLoad >= 0.7 ? 'weather-limited' : 'open'),
        economy: compactText(structure?.economy?.[0]?.summary || '', 120),
        publicOrder: compactText(structure?.publicOrder?.[0]?.summary || '', 120),
        culturalTone: compactText(structure?.culture?.[0]?.summary || '', 120),
        activeRestrictions: inferLinkedRules(snapshot, [sceneMeta.location], [sceneMeta.location]),
        governingBodies: inferLinkedOrganizations(snapshot, [sceneMeta.location], [sceneMeta.location]),
        governanceTier: hierarchy.hierarchyTier,
        commandReach: hierarchy.commandReach,
        authorityBias: hierarchy.authorityBias,
        seasonalLoad,
        coolingBias: seasonalLoad >= 0.58 ? 0.16 : 0.28,
        connectedRegions: [],
        pressureScore: scoreWorldSignalRelevance({ sceneRelation: 0.95, regionMatch: 1, urgency: 0.55, base: 0.35 }),
        breakoutRisk: false,
        stage: 'rising'
      });
    }
    return Array.from(byName.values())
      .sort((left, right) => Number(right.pressureScore || 0) - Number(left.pressureScore || 0))
      .slice(0, settings.regionAwareness === false ? 3 : 6);
  };
  const refreshWorldTimeline = (context = {}, bucket = {}, contextText = '', turn = 0, settings = getSettings(), snapshot = {}, factions = [], regions = []) => {
    const worldState = context?.WorldStateTracker?.getState?.() || {};
    const narrativeState = context?.NarrativeTracker?.getState?.() || {};
    const previous = bucket?.world?.timeline && typeof bucket.world.timeline === 'object'
      ? bucket.world.timeline
      : createDefaultWorldBucket().timeline;
    const recentEvents = uniqueTexts([
      ...(snapshot?.carryoverSignals || []),
      ...collectContextSignalArray(worldState, 'offscreenDevelopments'),
      ...collectContextSignalArray(narrativeState, 'recentEvents')
    ], 6).map((item, index) => ({
      id: `recent-${index + 1}-${normalizeLooseToken(item)}`,
      summary: compactText(item, 180),
      phase: /war|election|epidemic|spread|전쟁|선거|역병|소문/i.test(item) ? 'escalating' : 'ongoing',
      urgency: clamp01(/war|epidemic|collapse|폭동|선거|역병|붕괴/i.test(item) ? 0.82 : 0.45)
    }));
    const pendingEvents = uniqueTexts([
      ...collectContextSignalArray(worldState, 'pendingEvents'),
      ...collectContextSignalArray(narrativeState, 'pendingEvents'),
      ...(snapshot?.worldLimits || []).filter(item => /soon|pending|곧|예정|강화|확산/i.test(item))
    ], 6).map((item, index) => ({
      id: `pending-${index + 1}-${normalizeLooseToken(item)}`,
      summary: compactText(item, 180),
      urgency: clamp01(/war|raid|crackdown|epidemic|전쟁|습격|단속|역병/i.test(item) ? 0.84 : 0.52),
      region: compactText(regions?.[0]?.name || '', 80)
    }));
    const seasonalContext = uniqueTexts([
      ...normalizeArrayItems(snapshot?.seasonalContext),
      ...collectContextSignalArray(worldState, 'seasonalContext'),
      ...collectContextSignalArray(narrativeState, 'seasonalContext'),
      worldState?.currentSeason || ''
    ], 4);
    const seasonalLoad = deriveSeasonalLoad(seasonalContext[0] || '');
    const factionHeat = normalizeArrayItems(factions).reduce((best, faction) => Math.max(best, Number(faction?.heat || 0)), 0);
    const regionalPressure = normalizeArrayItems(regions).reduce((best, region) => Math.max(best, Number(region?.pressureScore || 0) / 100), 0);
    const pressureClock = uniqueTexts([
      ...(snapshot?.scenePressures || []),
      ...(snapshot?.worldLimits || []),
      ...recentEvents.map(item => item.summary),
      ...pendingEvents.map(item => item.summary)
    ], 6).map((item, index) => {
      const previousClock = normalizeArrayItems(previous?.pressureClock).find(entry => normalizeLooseToken(entry?.summary) === normalizeLooseToken(item));
      const region = compactText(
        regions.find(entry => findTextMentions([item], entry?.name))?.name
        || pendingEvents.find(entry => findTextMentions([entry?.summary], item))?.region
        || '',
        80
      );
      const faction = compactText(
        factions.find(entry => findTextMentions([item], entry?.name))?.name
        || '',
        80
      );
      const turnsActive = Number(previousClock?.turnsActive || 0) + 1;
      const autoEscalation = (
        (turnsActive >= 3 ? 6 : 0)
        + (seasonalLoad >= 0.58 ? 5 : 0)
        + (factionHeat >= 0.68 ? 5 : 0)
        + (regionalPressure >= 0.66 ? 4 : 0)
      );
      const intensityBase = scoreWorldSignalRelevance({
        sceneRelation: findTextMentions(snapshot?.scenePressures, item) ? 0.8 : 0.35,
        urgency: /war|raid|collapse|epidemic|전쟁|붕괴|역병|폭동/i.test(item) ? 0.84 : 0.5,
        restrictionConflict: /ban|limit|통금|금지|봉쇄/i.test(item) ? 0.78 : 0.2,
        carryoverOverlap: findTextMentions(snapshot?.carryoverSignals, item) ? 0.8 : 0.24,
        factionInvolvement: factions.some(faction => findTextMentions([item], faction?.name)) ? 0.72 : 0.2,
        base: 0.3
      });
      const intensity = Math.min(100, Math.max(0, intensityBase + autoEscalation - (Number(previousClock?.resolved) ? 6 : 0)));
      const previousIntensity = Number(previousClock?.intensity || 0);
      const delta = intensity - previousIntensity;
      const stage = describePressureStage(intensity);
      const trend = delta >= 12 ? 'up' : delta <= -12 ? 'down' : 'steady';
      const foreground = intensity >= 72 || (trend === 'up' && intensity >= 56);
      const explosionRisk = clamp01(
        ((intensity / 100) * 0.46)
        + (seasonalLoad * 0.12)
        + (factionHeat * 0.14)
        + (regionalPressure * 0.12)
        + (turnsActive >= 4 ? 0.1 : 0)
        + (/ban|limit|통금|금지|봉쇄/i.test(item) ? 0.1 : 0),
        0
      );
      const coolingChance = clamp01(
        ((trend === 'down' ? 0.32 : 0.08))
        + ((stage === 'watch' || stage === 'low') ? 0.28 : 0.04)
        + (turnsActive >= 4 ? 0.1 : 0)
        + (seasonalLoad < 0.34 ? 0.08 : 0),
        0
      );
      const forecast = explosionRisk >= 0.76
        ? 'likely foreground escalation'
        : (coolingChance >= 0.66 ? 'likely to cool' : 'holding pressure');
      return {
        id: `clock-${index + 1}-${normalizeLooseToken(item)}`,
        summary: compactText(item, 180),
        intensity,
        delta,
        stage,
        previousStage: compactText(previousClock?.stage || '', 40),
        stageTransition: describeStageTransition(previousClock?.stage, stage),
        trend,
        turnsActive,
        foreground,
        region,
        faction,
        explosionRisk,
        coolingChance,
        forecast,
        resolved: ((stage === 'low' || stage === 'watch') && trend === 'down' && turnsActive >= 3) || coolingChance >= 0.72,
        resolutionHint: buildResolutionHint({ summary: item, stage, trend, region, faction })
      };
    });
    const promotedEvents = pendingEvents.filter((item) => Number(item?.urgency || 0) >= 0.78 && findTextMentions(snapshot?.carryoverSignals, item?.summary));
    const mergedRecentEvents = uniqueTexts([
      ...recentEvents.map(item => item.summary),
      ...promotedEvents.map(item => item.summary)
    ], 6).map((summary, index) => {
      const existing = recentEvents.find(item => normalizeLooseToken(item?.summary) === normalizeLooseToken(summary))
        || promotedEvents.find(item => normalizeLooseToken(item?.summary) === normalizeLooseToken(summary));
      return existing || {
        id: `recent-promoted-${index + 1}-${normalizeLooseToken(summary)}`,
        summary: compactText(summary, 180),
        phase: 'escalated',
        urgency: 0.82
      };
    });
    const currentPhase = compactText(
      pendingEvents[0]?.summary
      || mergedRecentEvents[0]?.summary
      || snapshot?.sceneSummary
      || previous?.currentPhase
      || '',
      160
    );
    const temporalPulse = buildStructuredSummary([
      pressureClock[0]?.summary ? `front ${pressureClock[0].summary}` : '',
      seasonalContext[0] ? `season ${seasonalContext[0]}` : '',
      factionHeat >= 0.68 && factions[0]?.name ? `faction heat ${factions[0].name}` : '',
      regionalPressure >= 0.66 && regions[0]?.name ? `regional strain ${regions[0].name}` : ''
    ], 220);
    const phaseShiftSummary = buildStructuredSummary([
      pressureClock.find(item => item?.explosionRisk >= 0.76)?.summary ? `escalation ${pressureClock.find(item => item?.explosionRisk >= 0.76)?.summary}` : '',
      pressureClock.find(item => item?.coolingChance >= 0.66)?.summary ? `cooling ${pressureClock.find(item => item?.coolingChance >= 0.66)?.summary}` : '',
      seasonalContext[0] ? `seasonal load ${Math.round(seasonalLoad * 100)}%` : ''
    ], 220);
    const forecast = summarizeTemporalForecast({
      pressureClock,
      seasonalContext,
      pendingEvents,
      factions,
      regions
    });
    return {
      currentPhase,
      recentEvents: mergedRecentEvents,
      pendingEvents,
      seasonalContext,
      pressureClock,
      temporalPulse,
      phaseShiftSummary,
      forecast,
      foregroundSignals: pressureClock.filter(item => item.foreground).slice(0, 3),
      resolvedSignals: pressureClock.filter(item => item.resolved).slice(0, 3),
      escalationSummary: buildStructuredSummary([
        pressureClock[0] ? `${pressureClock[0].stage} ${pressureClock[0].summary}` : '',
        promotedEvents[0] ? `promoted ${promotedEvents[0].summary}` : '',
        pendingEvents[0] ? `pending ${pendingEvents[0].summary}` : ''
      ], 220),
      summary: buildStructuredSummary([
        currentPhase,
        temporalPulse,
        pendingEvents[0] ? `pending ${pendingEvents[0].summary}` : '',
        seasonalContext[0] ? `season ${seasonalContext[0]}` : ''
      ], 220)
    };
  };
  const refreshOffscreenThreads = (context = {}, bucket = {}, contextText = '', turn = 0, settings = getSettings(), snapshot = {}, factions = [], regions = [], timeline = null) => {
    const previous = Array.isArray(bucket?.world?.offscreenThreads) ? bucket.world.offscreenThreads : [];
    const worldState = context?.WorldStateTracker?.getState?.() || {};
    const rawLines = uniqueTexts([
      ...collectContextSignalArray(worldState, 'offscreenDevelopments'),
      ...collectContextSignalArray(context, 'offscreenDevelopments'),
      ...(timeline?.pendingEvents || []).map(item => item?.summary || ''),
      ...(bucket?.background?.entities || []).map(item => item?.summary || ''),
      ...(bucket?.background?.groups || []).map(item => item?.summary || '')
    ], String(settings.offscreenThreadStrength || 'balanced') === 'heavy' ? 8 : 5);
    const nextThreads = rawLines.map((line, index) => {
      const existing = previous.find(item => normalizeLooseToken(item?.title || item?.summary) === normalizeLooseToken(line));
      const matchedFactionNames = uniqueTexts(factions.filter(item => findTextMentions([line], item?.name)).map(item => item?.name), 3);
      const matchedFaction = normalizeArrayItems(factions).find(item => normalizeName(item?.name) === normalizeName(matchedFactionNames[0] || ''));
      const region = compactText(
        regions.find(item => findTextMentions([line], item?.name))?.name
        || snapshot?.location
        || '',
        80
      );
      const matchedRegion = normalizeArrayItems(regions).find(item => normalizeName(item?.name) === normalizeName(region));
      const hierarchy = buildOrganizationHierarchyProfile(snapshot, [matchedFactionNames[0] || '', line], [region]);
      const seasonalLoad = deriveSeasonalLoad(timeline?.seasonalContext?.[0] || snapshot?.seasonalContext?.[0] || '');
      const participants = uniqueTexts([
        ...normalizeArrayItems(existing?.participants),
        ...normalizeArrayItems(bucket?.background?.entities).filter(item => findTextMentions([line], item?.name)).map(item => item?.name)
      ], 4);
      const urgency = clamp01(
        Math.max(
          Number(existing?.urgency || 0),
          /urgent|danger|raid|war|역병|위험|습격|전쟁/i.test(line) ? 0.84 : 0.52,
          Number(matchedRegion?.seasonalLoad || 0) * 0.7,
          hierarchy.commandReach * 0.56
        ),
        0
      );
      const pressure = clamp01(
        Math.max(
          Number(existing?.pressure || 0),
          /restriction|crackdown|봉쇄|단속|통금/i.test(line) ? 0.78 : 0.48,
          hierarchy.authorityBias * 0.62,
          (Number(matchedRegion?.pressureScore || 0) / 100) * 0.68
        ),
        0
      );
      const dormancy = getTurnGap(turn, Number(existing?.updatedTurn || 0));
      const carryoverHit = findTextMentions(snapshot?.carryoverSignals, line);
      const momentum = clamp01(
        Math.max(
          clamp01((Number(existing?.momentum || 0) * 0.52) + (carryoverHit ? 0.28 : 0) + (hierarchy.commandReach * 0.08)),
          urgency * 0.72,
          pressure * 0.66,
          seasonalLoad * 0.42
        ),
        0.28
      );
      const relevance = scoreWorldSignalRelevance({
        sceneRelation: findTextMentions(snapshot?.scenePressures, line) ? 0.72 : 0.28,
        focusEntityRelevance: participants.length ? 0.68 : 0.22,
        recency: existing ? 0.74 : 0.38,
        regionMatch: region && normalizeName(region) === normalizeName(snapshot?.location) ? 0.82 : 0.26,
        factionInvolvement: matchedFactionNames.length ? Math.max(0.74, hierarchy.commandReach * 0.72) : 0.2,
        urgency,
        restrictionConflict: /ban|restriction|금지|봉쇄|단속/i.test(line) ? 0.76 : Math.max(0.2, hierarchy.authorityBias * 0.64),
        carryoverOverlap: carryoverHit ? 0.72 : 0.24,
        base: 0.3
      });
      const coolingBias = clamp01(
        Math.max(
          Number(existing?.coolingBias || 0) * 0.56,
          Number(matchedRegion?.coolingBias || 0),
          dormancy >= 5 ? 0.44 : 0.18
        ),
        0.18
      );
      const explosionRisk = clamp01(
        (urgency * 0.28)
        + (pressure * 0.24)
        + (momentum * 0.18)
        + ((Number(matchedRegion?.pressureScore || 0) / 100) * 0.14)
        + (hierarchy.commandReach * 0.1)
        + (seasonalLoad * 0.08),
        0.18
      );
      const status = describeThreadState({ urgency, pressure, dormancy, relevance, carryoverHit });
      const foregroundCandidate = relevance >= 70 || momentum >= 0.72 || status === 'escalating' || explosionRisk >= 0.74;
      const stage = describePressureStage(Math.round(Math.max(relevance, momentum * 100)));
      const outcome = explosionRisk >= 0.82
        ? 'breakout-risk'
        : (coolingBias >= 0.62 && dormancy >= 5 && momentum < 0.42
          ? 'cooling'
          : buildEscalationOutcome({ status, momentum, urgency, pressure, dormancy }));
      const resolutionHint = buildResolutionHint({
        summary: line,
        stage,
        trend: foregroundCandidate ? 'up' : (dormancy >= 5 ? 'down' : 'steady'),
        region,
        faction: matchedFactionNames[0] || ''
      });
      return {
        id: compactText(existing?.id || `thread-${index + 1}-${normalizeLooseToken(line)}`, 90),
        title: compactText(existing?.title || line, 90),
        summary: compactText(line, 180),
        participants,
        factions: matchedFactionNames,
        region,
        startedTurn: Number(existing?.startedTurn || turn || 0),
        updatedTurn: Number(turn || existing?.updatedTurn || 0),
        urgency,
        pressure,
        momentum,
        dormancy,
        relevance,
        commandReach: hierarchy.commandReach,
        patronBody: hierarchy.primaryBody || matchedFaction?.patronBody || '',
        hierarchyTier: hierarchy.hierarchyTier || matchedFaction?.hierarchyTier || 0,
        coolingBias,
        explosionRisk,
        status: compactText(status, 40),
        foregroundCandidate,
        outcome,
        nextPossibleShift: compactText(
          existing?.nextPossibleShift
          || timeline?.pendingEvents?.find(item => findTextMentions([item?.summary], line))?.summary
          || (timeline?.forecast && (foregroundCandidate || explosionRisk >= 0.72) ? timeline.forecast : '')
          || '',
          180
        ),
        resolutionHint,
        statusNote: buildStructuredSummary([
          status,
          outcome !== 'latent' ? outcome : '',
          foregroundCandidate ? 'foreground candidate' : '',
          dormancy >= 4 ? `quiet ${dormancy} turns` : '',
          hierarchy.primaryBody ? `command ${hierarchy.primaryBody}` : '',
          seasonalLoad >= 0.58 ? 'seasonal load active' : ''
        ], 140),
        consequences: uniqueTexts([
          ...(existing?.consequences || []),
          status === 'escalating' ? `pressure rising around ${compactText(region || matchedFactionNames[0] || 'thread', 60)}` : '',
          status === 'dormant' ? 'background line is cooling but unresolved' : '',
          explosionRisk >= 0.76 ? 'breakout risk is building behind the scene' : '',
          coolingBias >= 0.62 ? 'cooling path remains possible if pressure drops' : ''
        ], 4),
        stage
      };
    });
    return nextThreads
      .sort((left, right) => Number(right.relevance || 0) - Number(left.relevance || 0))
      .slice(0, String(settings.offscreenThreadStrength || 'balanced') === 'light' ? 3 : 5);
  };
  const summarizeWorldSystemFocus = (world = {}, settings = getSettings()) => compactText([
    world?.sceneSummary || '',
    world?.structure?.summary ? `structure ${world.structure.summary}` : '',
    world?.factions?.[0] ? `faction ${world.factions[0].name}` : '',
    world?.offscreenThreads?.[0] ? `off-screen ${world.offscreenThreads[0].title}` : '',
    world?.regions?.[0] ? `region ${world.regions[0].name}` : '',
    world?.propagation?.[0] ? `propagation ${world.propagation[0].summary}` : '',
    world?.timeline?.currentPhase ? `timeline ${world.timeline.currentPhase}` : ''
  ].filter(Boolean).join(' | '), String(settings.worldPromptDensity || 'balanced') === 'heavy' ? 260 : 220);

  const buildWorldSignalSnapshot = (context = {}, settings = getSettings()) => {
    const sceneMeta = getCurrentSceneLocationMeta(context);
    const currentNode = context?.HierarchicalWorldManager?.getCurrentNode?.() || null;
    const worldState = context?.WorldStateTracker?.getState?.() || {};
    const narrativeState = context?.NarrativeTracker?.getState?.() || {};
    const dossierMode = String(settings.worldDossierMode || 'focused');
    const directScenePressures = collectContextSignalArray(context, 'scenePressures');
    const directEnvironmentPressures = collectContextSignalArray(context, 'environmentPressures');
    const directCarryover = collectContextSignalArray(context, 'storylineCarryoverSignals');
    const directRelationSignals = collectContextSignalArray(context, 'relationStateSignals');
    const directCodex = collectContextSignalArray(context, 'worldCodexSignals');
    const directHints = collectContextSignalArray(context, 'entityDossier');
    const sectionWorldMeta = context?.sectionWorldMeta && typeof context.sectionWorldMeta === 'object'
      ? context.sectionWorldMeta
      : {};
    const worldManagerDossier = context?.worldManagerDossier && typeof context.worldManagerDossier === 'object'
      ? context.worldManagerDossier
      : {};
    const worldManagerInputs = context?.worldManagerInputs && typeof context.worldManagerInputs === 'object'
      ? context.worldManagerInputs
      : {};
    const formatterLines = [
      context?.HierarchicalWorldManager?.formatForPrompt?.(),
      context?.WorldStateTracker?.formatForPrompt?.(),
      context?.NarrativeTracker?.formatForPrompt?.()
    ].flatMap(extractPromptSignalLines);
    const nodeMeta = currentNode?.meta?.worldMetadata || {};
    const scenePressures = uniqueTexts([
      ...directScenePressures,
      ...directEnvironmentPressures,
      ...collectContextSignalArray(sectionWorldMeta, 'scenePressures'),
      ...collectContextSignalArray(worldManagerInputs, 'scenePressures'),
      ...collectContextSignalArray(worldState, 'scenePressures'),
      ...collectContextSignalArray(narrativeState, 'scenePressures'),
      ...extractPromptSignalLines(sectionWorldMeta?.scenePressureSummary || ''),
      ...extractPromptSignalLines(worldManagerDossier?.scenePressures || ''),
      sceneMeta.currentNodeName ? `scene anchored at ${sceneMeta.currentNodeName}` : ''
    ], dossierMode === 'expanded' ? 8 : Number(settings.maxWorldSignalItems || 4));
    const carryoverSignals = uniqueTexts([
      ...directCarryover,
      ...collectContextSignalArray(sectionWorldMeta, 'storylineCarryoverSignals'),
      ...collectContextSignalArray(worldManagerInputs, 'storylineCarryoverSignals'),
      ...collectContextSignalArray(narrativeState, 'storylineCarryoverSignals'),
      ...collectContextSignalArray(narrativeState, 'carryoverSignals'),
      ...extractPromptSignalLines(worldManagerDossier?.storylineCarryoverSignals || '')
    ], dossierMode === 'expanded' ? 8 : Number(settings.maxWorldSignalItems || 4));
    const relationSignals = uniqueTexts([
      ...collectEntityCoreXRelationSignals(context, settings),
      ...directRelationSignals,
      ...collectContextSignalArray(worldManagerInputs, 'relationStateSignals'),
      ...collectContextSignalArray(worldState, 'relationStateSignals'),
      ...extractPromptSignalLines(worldManagerDossier?.relationStateSignals || '')
    ], dossierMode === 'expanded' ? 8 : Number(settings.maxWorldSignalItems || 4));
    const worldLimits = uniqueTexts([
      ...collectContextSignalArray(worldManagerDossier, 'worldLimits'),
      ...collectContextSignalArray(nodeMeta, 'worldLimits'),
      ...collectContextSignalArray(worldState, 'worldLimits'),
      ...extractPromptSignalLines(sectionWorldMeta?.worldLimits || '')
    ], dossierMode === 'expanded' ? 8 : Number(settings.maxWorldSignalItems || 4));
    const codexSignals = uniqueTexts([
      ...directCodex,
      ...collectContextSignalArray(worldManagerInputs, 'worldCodexSignals'),
      ...collectContextSignalArray(worldState, 'worldCodexSignals'),
      ...collectContextSignalArray(nodeMeta, 'worldCodexSignals'),
      ...extractPromptSignalLines(worldManagerDossier?.worldCodexSignals || '')
    ], dossierMode === 'expanded' ? 8 : Number(settings.maxWorldSignalItems || 4));
    const entityDossierHints = uniqueTexts([
      ...directHints,
      ...collectContextSignalArray(context, 'entityContextHints'),
      ...collectContextSignalArray(worldManagerInputs, 'entityContextHints'),
      ...extractPromptSignalLines(worldManagerDossier?.entityDossier || ''),
      ...extractPromptSignalLines(worldManagerDossier?.entityContextHints || '')
    ], dossierMode === 'expanded' ? 8 : Number(settings.maxWorldSignalItems || 4));
    const promptHints = formatterLines
      .filter(line => /(scene|pressure|world|limit|carry|relation|codex|dossier|장면|압력|세계|제약|관계|계속)/i.test(line));
    const organizations = dedupeStructuredItems([
      ...normalizeArrayItems(nodeMeta?.organizations),
      ...normalizeArrayItems(worldState?.organizations),
      ...normalizeArrayItems(worldManagerInputs?.organizations)
    ], dossierMode === 'expanded' ? 10 : 6);
    const regions = dedupeStructuredItems([
      ...normalizeArrayItems(nodeMeta?.regions),
      ...normalizeArrayItems(worldState?.regions),
      ...normalizeArrayItems(worldManagerInputs?.regions)
    ], dossierMode === 'expanded' ? 8 : 5);
    const activeRules = dedupeStructuredItems([
      ...normalizeArrayItems(worldManagerInputs?.activeRules),
      ...normalizeArrayItems(nodeMeta?.laws)
    ], dossierMode === 'expanded' ? 8 : 5);
    const offscreenDevelopments = uniqueTexts([
      ...collectContextSignalArray(context, 'offscreenDevelopments'),
      ...collectContextSignalArray(worldState, 'offscreenDevelopments'),
      ...collectContextSignalArray(narrativeState, 'offscreenDevelopments'),
      ...extractPromptSignalLines(worldManagerDossier?.offscreenDevelopments || '')
    ], dossierMode === 'expanded' ? 8 : 5);
    const seasonalContext = uniqueTexts([
      ...collectContextSignalArray(worldState, 'seasonalContext'),
      ...collectContextSignalArray(narrativeState, 'seasonalContext'),
      ...collectContextSignalArray(worldManagerInputs, 'seasonalContext'),
      worldState?.currentSeason || '',
      narrativeState?.currentSeason || ''
    ], dossierMode === 'expanded' ? 4 : 2);
    const sceneSummary = compactText(uniqueTexts([
      scenePressures[0] ? `scene ${scenePressures[0]}` : '',
      carryoverSignals[0] ? `carryover ${carryoverSignals[0]}` : '',
      relationSignals[0] ? `relation ${relationSignals[0]}` : '',
      worldLimits[0] ? `limit ${worldLimits[0]}` : '',
      codexSignals[0] ? `codex ${codexSignals[0]}` : '',
      seasonalContext[0] ? `season ${seasonalContext[0]}` : '',
      promptHints[0] || ''
    ], 5).join(' | '), 260);
    return {
      ...sceneMeta,
      scenePressures,
      carryoverSignals,
      relationSignals,
      worldLimits,
      codexSignals,
      entityDossierHints,
      organizations,
      regions,
      activeRules,
      offscreenDevelopments,
      seasonalContext,
      promptHints: uniqueTexts(promptHints, 4),
      sceneSummary
    };
  };

  const sampleStable = (rows = [], limit = 3) => {
    const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
    if (safeRows.length <= limit) return safeRows;
    return safeRows.slice(0, limit);
  };

  const computeBgBaseScore = (source = {}, options = {}) => {
    let score = 0;
    if (options.tracked) score += 120;
    score += Math.min(90, Math.max(0, Number(source?.lastSeenTurn || 0)) * 3);
    if (options.sameLocation) score += 70;
    if (options.sameCountry) score += 35;
    if (options.directMention) score += 140;
    score += Math.round(clamp01(options.currentSceneRelation, 0) * 55);
    score += Math.round(clamp01(options.focusEntityRelevance, 0) * 50);
    score += Math.round(clamp01(options.regionMatch, 0) * 65);
    score += Math.round(clamp01(options.factionInvolvement, 0) * 70);
    score += Math.round(clamp01(options.offscreenUrgency, 0) * 78);
    score += Math.round(clamp01(options.worldRestrictionConflict, 0) * 68);
    score += Math.round(clamp01(options.carryoverOverlap, 0) * 42);
    score += Math.round(clamp01(options.pendingWorldEvent, 0) * 52);
    if (options.randomMode) score += Math.round(Math.random() * 40);
    return score;
  };

  const buildOffscreenContextHints = (context = {}, settings = getSettings()) => {
    const sceneMeta = getCurrentSceneLocationMeta(context);
    const parts = [];
    if (sceneMeta.currentNodeName) parts.push(`현재 장면 축 ${sceneMeta.currentNodeName}`);
    if (sceneMeta.location) parts.push(`장소 ${sceneMeta.location}`);
    if (sceneMeta.country) parts.push(`국가 ${sceneMeta.country}`);
    const contextMode = String(settings.bgContextMode || 'indirect');
    const modeLabelMap = {
      direct: '현재 장면과 직접 이어지는 오프스크린 상황을 우선',
      indirect: '현재 장면과 간접적으로 얽힌 오프스크린 상황까지 허용',
      time_shared: '같은 시간대지만 다른 맥락의 오프스크린 상황 허용',
      random: '맥락 연결보다 다양한 오프스크린 후보를 우선'
    };
    if (modeLabelMap[contextMode]) parts.push(modeLabelMap[contextMode]);
    return parts.filter(Boolean).join(' · ');
  };

  const collectOffscreenEntityCandidates = (context = {}, bucket = {}, contextText = '', settings = getSettings()) => {
    const sceneMeta = getCurrentSceneLocationMeta(context);
    const world = bucket?.world && typeof bucket.world === 'object' ? bucket.world : createDefaultWorldBucket();
    const entityIterationMap = buildEntityIterationMap(context, context?.EntityManager?.getEntityCache?.());
    const trackedNames = new Set(Object.keys(bucket?.entities || {}).map(normalizeName).filter(Boolean));
    const candidates = [];
    const pushCandidate = (source = {}, reason = '', reasonCode = 'unrestricted', scoreOptions = {}) => {
      const name = normalizeName(source?.name);
      if (!name || mentionsName(contextText, name)) return;
      const stored = bucket?.entities?.[name] || null;
      const snapshot = stored?.entitySnapshot || source?.entitySnapshot || source;
      const location = normalizeName(snapshot?.status?.location || source?.currentLocation || '');
      const country = normalizeName(snapshot?.background?.origin || snapshot?.status?.currentCountry || '');
      const summary = compactText(stored?.currentSummary || summarizeEntity(snapshot) || '', 180);
      const sameLocation = Boolean(sceneMeta.location && location && (location.includes(sceneMeta.location) || sceneMeta.location.includes(location)));
      const sameCountry = Boolean(sceneMeta.country && country && (country.includes(sceneMeta.country) || sceneMeta.country.includes(country)));
      const factionNames = uniqueTexts([
        snapshot?.belongsTo || '',
        ...normalizeArrayItems(snapshot?.groupTraits || ''),
        ...normalizeArrayItems(world?.factions || []).filter(item => findTextMentions([
          snapshot?.belongsTo,
          snapshot?.groupTraits,
          summary,
          reason,
          source?.summary
        ], item?.name)).map(item => item?.name)
      ], 3);
      const relatedThreads = normalizeArrayItems(world?.offscreenThreads || []).filter((thread) => (
        findTextMentions(thread?.participants, name)
        || findTextMentions(thread?.factions, factionNames[0] || '')
        || findTextMentions([thread?.summary, thread?.title], location || country || name)
      ));
      const regionMatch = clamp01(
        sameLocation ? 1 : sameCountry ? 0.65 : normalizeArrayItems(world?.regions || []).some(region => normalizeName(region?.name) === location || normalizeName(region?.name) === country) ? 0.42 : 0,
        0
      );
      const factionInvolvement = clamp01(
        factionNames.length ? 0.74 : relatedThreads.length ? 0.46 : 0,
        0
      );
      const lawConflict = clamp01(
        normalizeArrayItems(world?.structure?.laws || []).some(item => findTextMentions([item?.summary, item?.scope], location || country || name)) ? 0.68 : 0,
        0
      );
      const pendingWorldEvent = clamp01(
        normalizeArrayItems(world?.timeline?.pendingEvents || []).some(item => findTextMentions([item?.summary], location || country || name)) ? 0.72 : 0,
        0
      );
      const offscreenUrgency = clamp01(
        relatedThreads.reduce((best, thread) => Math.max(best, Number(thread?.urgency || thread?.pressure || 0)), 0),
        0
      );
      const carryoverOverlap = clamp01(
        normalizeArrayItems(world?.carryoverSignals || []).some(item => findTextMentions([item], name) || findTextMentions([item], location || country)) ? 0.66 : 0,
        0
      );
      const entry = {
        type: 'entity',
        name,
        charNum: stored?.charNum || null,
        summary,
        location,
        country,
        lastSeenTurn: Number(stored?.lastSeenTurn || 0),
        reason,
        reasonCode,
        reasonLabel: BG_REASON_LABELS[reasonCode] || reasonCode,
        tracked: Boolean(stored),
        mentionedNow: mentionsName(contextText, name),
        factions: factionNames,
        relatedThreadCount: relatedThreads.length,
        score: computeBgBaseScore(stored || source, {
          tracked: Boolean(stored),
          sameLocation,
          sameCountry,
          directMention: Boolean(scoreOptions.directMention),
          currentSceneRelation: sameLocation ? 0.82 : sameCountry ? 0.45 : 0.18,
          focusEntityRelevance: mentionsName(contextText, name) ? 0.82 : 0.24,
          regionMatch,
          factionInvolvement,
          offscreenUrgency,
          worldRestrictionConflict: lawConflict,
          carryoverOverlap,
          pendingWorldEvent,
          randomMode: reasonCode === 'random'
        })
      };
      const dedupeKey = `${entry.type}:${name}`;
      if (candidates.some(item => item._key === dedupeKey)) return;
      entry._key = dedupeKey;
      candidates.push(entry);
    };

    const scope = String(settings.bgScope || 'recently_exited');
    if (scope === 'mentioned_untracked') {
      entityIterationMap.forEach((entity, name) => {
        if (!mentionsName(contextText, name)) return;
        if (trackedNames.has(name)) return;
        pushCandidate(entity, '현재 장면에서 언급됐지만 DyList 주 추적에는 아직 잡히지 않음', 'mentioned_untracked', { directMention: true });
      });
    } else {
      Object.values(bucket?.entities || {}).forEach((entry) => {
        const snapshot = entry?.entitySnapshot || {};
        const location = normalizeName(snapshot?.status?.location || '');
        const country = normalizeName(snapshot?.background?.origin || snapshot?.status?.currentCountry || '');
        if (scope === 'current_location' && sceneMeta.location && location && !location.includes(sceneMeta.location) && !sceneMeta.location.includes(location)) return;
        if (scope === 'current_country' && sceneMeta.country && country && !country.includes(sceneMeta.country) && !sceneMeta.country.includes(country)) return;
        pushCandidate(entry, (
          scope === 'current_location' ? '현재 장소 범위 안의 장면 밖 인물' :
          scope === 'current_country' ? '현재 국가 범위 안의 장면 밖 인물' :
          scope === 'unrestricted' ? '장면 밖 일반 후보' :
          scope === 'random' ? '랜덤 장면 밖 인물' :
          '직전 장면까지 보였지만 지금은 화면 밖으로 빠진 인물'
        ), (
          scope === 'current_location' ? 'current_location' :
          scope === 'current_country' ? 'current_country' :
          scope === 'random' ? 'random' :
          scope === 'unrestricted' ? 'unrestricted' :
          'recently_exited'
        ));
      });
      if (scope === 'unrestricted' || scope === 'random') {
        entityIterationMap.forEach((entity, name) => {
          if (trackedNames.has(name)) return;
          pushCandidate(entity, scope === 'random' ? '랜덤 장면 밖 인물' : '장면 밖 일반 후보', scope === 'random' ? 'random' : 'unrestricted');
        });
      }
    }

    candidates.sort((left, right) => {
      const scoreGap = Number(right.score || 0) - Number(left.score || 0);
      if (scoreGap !== 0) return scoreGap;
      const trackGap = Number(right.tracked) - Number(left.tracked);
      if (trackGap !== 0) return trackGap;
      const turnGap = Number(right.lastSeenTurn || 0) - Number(left.lastSeenTurn || 0);
      if (turnGap !== 0) return turnGap;
      return String(left.name).localeCompare(String(right.name));
    });
    return sampleStable(scope === 'random' ? candidates.sort(() => 0.5 - Math.random()) : candidates, 3);
  };

  const collectOffscreenGroupCandidates = (context = {}, bucket = {}, contextText = '', settings = getSettings()) => {
    const sceneMeta = getCurrentSceneLocationMeta(context);
    const world = bucket?.world && typeof bucket.world === 'object' ? bucket.world : createDefaultWorldBucket();
    const knownGroups = collectWorldGroups(context);
    const trackedNames = new Set(Object.keys(bucket?.groups || {}).map(normalizeName).filter(Boolean));
    const candidates = [];
    const pushCandidate = (source = {}, reason = '', reasonCode = 'unrestricted', scoreOptions = {}) => {
      const name = normalizeName(source?.name);
      if (!name || mentionsName(contextText, name)) return;
      const stored = bucket?.groups?.[name] || null;
      const description = compactText(stored?.description || source?.description || source?.role || '', 120);
      const location = normalizeName(source?.location || source?.base || '');
      const sameLocation = Boolean(sceneMeta.location && location && (location.includes(sceneMeta.location) || sceneMeta.location.includes(location)));
      const relatedThreads = normalizeArrayItems(world?.offscreenThreads || []).filter((thread) => (
        findTextMentions(thread?.factions, name)
        || findTextMentions(thread?.participants, name)
        || findTextMentions([thread?.summary, thread?.title], location || name)
      ));
      const activeFaction = normalizeArrayItems(world?.factions || []).find(item => normalizeName(item?.name) === name);
      const regionMatch = clamp01(
        sameLocation ? 1 : normalizeArrayItems(world?.regions || []).some(region => normalizeName(region?.name) === location) ? 0.55 : 0,
        0
      );
      const pendingWorldEvent = clamp01(
        normalizeArrayItems(world?.timeline?.pendingEvents || []).some(item => findTextMentions([item?.summary], name) || findTextMentions([item?.summary], location)) ? 0.74 : 0,
        0
      );
      const entry = {
        type: 'group',
        name,
        groupNum: stored?.groupNum || null,
        summary: compactText(stored?.currentSummary || source?.summary || description || '', 180),
        location,
        lastSeenTurn: Number(stored?.lastSeenTurn || 0),
        reason,
        reasonCode,
        reasonLabel: BG_REASON_LABELS[reasonCode] || reasonCode,
        tracked: Boolean(stored),
        factions: activeFaction ? [activeFaction.name] : [],
        relatedThreadCount: relatedThreads.length,
        score: computeBgBaseScore(stored || source, {
          tracked: Boolean(stored),
          sameLocation,
          sameCountry: false,
          directMention: Boolean(scoreOptions.directMention),
          currentSceneRelation: sameLocation ? 0.84 : 0.24,
          focusEntityRelevance: mentionsName(contextText, name) ? 0.76 : 0.22,
          regionMatch,
          factionInvolvement: activeFaction ? 0.88 : relatedThreads.length ? 0.55 : 0.18,
          offscreenUrgency: clamp01(relatedThreads.reduce((best, thread) => Math.max(best, Number(thread?.urgency || thread?.pressure || 0)), 0), 0),
          worldRestrictionConflict: normalizeArrayItems(world?.structure?.laws || []).some(item => findTextMentions([item?.summary], name) || findTextMentions([item?.summary], location)) ? 0.7 : 0,
          carryoverOverlap: normalizeArrayItems(world?.carryoverSignals || []).some(item => findTextMentions([item], name)) ? 0.68 : 0,
          pendingWorldEvent,
          randomMode: reasonCode === 'random'
        })
      };
      const dedupeKey = `${entry.type}:${name}`;
      if (candidates.some(item => item._key === dedupeKey)) return;
      entry._key = dedupeKey;
      candidates.push(entry);
    };

    const scope = String(settings.bgScope || 'recently_exited');
    if (scope === 'mentioned_untracked') {
      knownGroups.forEach((group) => {
        if (!mentionsName(contextText, group?.name)) return;
        if (trackedNames.has(normalizeName(group?.name))) return;
        pushCandidate(group, '현재 장면에서 언급됐지만 DyList 주 추적에는 아직 잡히지 않음', 'mentioned_untracked', { directMention: true });
      });
    } else {
      Object.values(bucket?.groups || {}).forEach((entry) => {
        if (scope === 'current_location' && sceneMeta.location && entry?.description && !String(entry.description).includes(sceneMeta.location)) return;
        pushCandidate(entry, (
          scope === 'current_location' ? '현재 장소 범위 안의 장면 밖 그룹' :
          scope === 'current_country' ? '현재 국가 범위 안의 장면 밖 그룹' :
          scope === 'unrestricted' ? '장면 밖 일반 그룹 후보' :
          scope === 'random' ? '랜덤 장면 밖 그룹' :
          '직전 장면까지 보였지만 지금은 화면 밖으로 빠진 그룹'
        ), (
          scope === 'current_location' ? 'current_location' :
          scope === 'current_country' ? 'current_country' :
          scope === 'random' ? 'random' :
          scope === 'unrestricted' ? 'unrestricted' :
          'recently_exited'
        ));
      });
      if (scope === 'unrestricted' || scope === 'random' || scope === 'current_country') {
        knownGroups.forEach((group) => {
          if (trackedNames.has(normalizeName(group?.name))) return;
          pushCandidate(group, scope === 'random' ? '랜덤 장면 밖 그룹' : '장면 밖 일반 그룹 후보', scope === 'random' ? 'random' : 'unrestricted');
        });
      }
    }

    candidates.sort((left, right) => {
      const scoreGap = Number(right.score || 0) - Number(left.score || 0);
      if (scoreGap !== 0) return scoreGap;
      const trackGap = Number(right.tracked) - Number(left.tracked);
      if (trackGap !== 0) return trackGap;
      const turnGap = Number(right.lastSeenTurn || 0) - Number(left.lastSeenTurn || 0);
      if (turnGap !== 0) return turnGap;
      return String(left.name).localeCompare(String(right.name));
    });
    return sampleStable(scope === 'random' ? candidates.sort(() => 0.5 - Math.random()) : candidates, 2);
  };

  const buildBgInfluenceDescriptor = (entry = {}, bucket = {}, recentProposals = []) => {
    const normalized = normalizeName(entry?.name);
    if (!normalized) return { tags: [], summary: '', proposalRows: [] };
    const trackedGroup = bucket?.groups?.[normalized] || null;
    const world = bucket?.world && typeof bucket.world === 'object' ? bucket.world : createDefaultWorldBucket();
    const tags = [];
    if (trackedGroup && Array.isArray(trackedGroup.members) && trackedGroup.members.length >= 3) tags.push('group-heavy');
    if (Array.isArray(entry?.factions) && entry.factions.length) tags.push('faction-linked');
    if (Number(entry?.relatedThreadCount || 0) > 0) tags.push('offscreen-thread');
    if (Array.isArray(world?.publicPressure) && world.publicPressure.some(item => findTextMentions([item?.summary], normalized))) tags.push('world-pressure');
    const matchedProposals = (Array.isArray(recentProposals) ? recentProposals : [])
      .filter((proposal) => {
        const names = Array.isArray(proposal?.entityNames) ? proposal.entityNames : [];
        return names.some(name => normalizeName(name) === normalized);
      })
      .slice(-4)
      .reverse();
    matchedProposals.forEach((proposal) => {
      const pluginId = String(proposal?.pluginId || '').trim().toLowerCase();
      if (!pluginId) return;
      if (pluginId.includes('world') && !tags.includes('world-recent')) tags.push('world-recent');
      else if (pluginId.includes('omni') && !tags.includes('memory-heavy')) tags.push('memory-heavy');
      else if ((pluginId.includes('canon') || pluginId.includes('loreqa') || pluginId.includes('원작')) && !tags.includes('canon-heavy')) tags.push('canon-heavy');
    });
    const category = (
      tags.includes('world-pressure') ? 'world-heavy' :
      tags.includes('world-recent') ? 'world-heavy' :
      (tags.includes('memory-heavy') || tags.includes('canon-heavy')) ? 'memory-heavy' :
      tags.includes('group-heavy') ? 'group-heavy' :
      'general'
    );
    const categoryLabel = (
      category === 'world-heavy' ? '월드 압력 중심' :
      category === 'memory-heavy' ? '메모리·원작 중심' :
      category === 'group-heavy' ? '그룹 중심' :
      '일반'
    );
    return {
      tags,
      summary: tags.join(', '),
      proposalRows: matchedProposals,
      category,
      categoryLabel
    };
  };

  const buildWorldPromptSection = (context = {}, bucket = {}, settings = getSettings()) => {
    if (settings.trackWorldSignals === false) return null;
    const world = bucket?.world && typeof bucket.world === 'object'
      ? bucket.world
      : buildWorldSignalSnapshot(context, settings);
    const density = String(settings.worldPromptDensity || settings.worldPromptMode || 'balanced');
    const signalBudget = Math.max(2, Math.min(6, Number(settings.maxWorldSignalItems || 4)));
    const pressureLines = uniqueTexts([
      ...(Array.isArray(world?.scenePressures) ? world.scenePressures : []),
      ...(Array.isArray(world?.carryoverSignals) ? world.carryoverSignals : []),
      ...(Array.isArray(world?.worldLimits) ? world.worldLimits : []),
      ...(Array.isArray(world?.relationSignals) ? world.relationSignals : []),
      ...(Array.isArray(world?.codexSignals) ? world.codexSignals : [])
    ], signalBudget);
    const dossierLines = String(settings.worldDossierMode || 'focused') === 'off'
      ? []
      : uniqueTexts(world?.entityDossierHints || [], Math.max(1, Math.min(3, signalBudget - 1)));
    const summary = summarizeWorldFocus(world);
    if (!summary && !pressureLines.length && !dossierLines.length) return null;
    const mode = String(settings.worldPromptMode || 'balanced');
    const intro = (
      mode === 'heavy'
        ? 'Treat these as active world and scene continuity pressures. Keep responses aligned with them unless the turn explicitly breaks them.'
        : mode === 'light'
          ? 'Use these as lightweight world continuity hints.'
          : 'Use these as world continuity anchors together with background drift.'
    );
    const lines = [
      '[World Core X / World Continuity]',
      intro,
      summary ? `- World Focus: ${summary}` : '',
      world?.autonomySummary ? `- World Motion: ${compactText(world.autonomySummary, 180)}` : '',
      world?.timeline?.phaseShiftSummary ? `- Phase Shift: ${compactText(world.timeline.phaseShiftSummary, 180)}` : '',
      world?.timeline?.forecast ? `- Forecast: ${compactText(world.timeline.forecast, 180)}` : '',
      world?.analysis?.summary ? `- Analysis: ${compactText(world.analysis.summary, 180)}` : '',
      world?.dmaSummary ? `- DMA: ${compactText(world.dmaSummary, 180)}` : '',
      ...pressureLines.map(item => `- Pressure: ${compactText(item, 180)}`),
      ...dossierLines.map(item => `- Dossier: ${compactText(item, 180)}`)
    ].filter(Boolean);
    const structuralLines = uniqueTexts([
      ...(world?.structure?.laws || []).map(item => `law ${item.summary}`),
      ...(world?.structure?.institutions || []).map(item => `${item.name}: ${item.summary}`),
      ...(world?.structure?.economy || []).map(item => `economy ${item.summary}`),
      ...(world?.structure?.culture || []).map(item => `culture ${item.summary}`)
    ], density === 'heavy' ? 3 : 2);
    const factionLines = uniqueTexts(
      normalizeArrayItems(world?.factions || []).map((faction) => buildStructuredSummary([
        faction?.name,
        faction?.officialGoal ? `goal ${faction.officialGoal}` : '',
        faction?.patronBody ? `command ${faction.patronBody}` : '',
        faction?.controlRegions?.[0] ? `control ${faction.controlRegions[0]}` : '',
        faction?.hierarchyTier ? `tier ${faction.hierarchyTier}` : '',
        Number.isFinite(Number(faction?.tension)) ? `tension ${Math.round(Number(faction.tension) * 100)}%` : ''
      ], 180)),
      density === 'heavy' ? 3 : 2
    );
    const offscreenLines = uniqueTexts(
      normalizeArrayItems(world?.offscreenThreads || []).map((thread) => buildStructuredSummary([
        thread?.title,
        thread?.summary,
        thread?.region ? `region ${thread.region}` : '',
        thread?.patronBody ? `command ${thread.patronBody}` : '',
        Number.isFinite(Number(thread?.explosionRisk)) ? `breakout ${Math.round(Number(thread.explosionRisk) * 100)}%` : '',
        Number.isFinite(Number(thread?.urgency)) ? `urgency ${Math.round(Number(thread.urgency) * 100)}%` : ''
      ], 180)),
      density === 'heavy' ? 3 : 2
    );
    const regionalLines = uniqueTexts(
      normalizeArrayItems(world?.regions || []).map((region) => buildStructuredSummary([
        region?.name,
        region?.summary,
        region?.controlFaction ? `control ${region.controlFaction}` : '',
        region?.governanceTier ? `tier ${region.governanceTier}` : '',
        region?.accessLevel ? `access ${region.accessLevel}` : '',
        Number.isFinite(Number(region?.pressureScore)) ? `pressure ${Math.round(Number(region.pressureScore))}` : ''
      ], 180)),
      density === 'heavy' ? 3 : 2
    );
    const candidateSections = [
      {
        title: '[World Core X / Structural World Rules]',
        lines: structuralLines.map(item => `- Rule: ${compactText(item, 180)}`),
        score: Number(world?.publicPressure?.[0]?.score || 0) + (world?.structure?.laws?.length ? 14 : 0) + (world?.structure?.institutions?.length ? 9 : 0)
      },
      {
        title: '[World Core X / Active Factions]',
        lines: factionLines.map(item => `- Faction: ${compactText(item, 180)}`),
        score: Number(world?.factions?.[0]?.relevanceScore || 0)
      },
      {
        title: '[World Core X / Off-screen Progression]',
        lines: offscreenLines.map(item => `- Thread: ${compactText(item, 180)}`),
        score: Number(world?.offscreenThreads?.[0]?.relevance || 0)
      },
      {
        title: '[World Core X / Regional Pressure]',
        lines: regionalLines.map(item => `- Region: ${compactText(item, 180)}`),
        score: Number(world?.regions?.[0]?.pressureScore || 0)
      },
      {
        title: '[World Core X / Escalation Watch]',
        lines: uniqueTexts([
          ...normalizeArrayItems(world?.timeline?.foregroundSignals || []).map(item => buildStructuredSummary([
            item?.summary,
            item?.stage ? `stage ${item.stage}` : '',
            item?.trend ? `trend ${item.trend}` : '',
            item?.resolutionHint || ''
          ], 180)),
          ...normalizeArrayItems(world?.offscreenThreads || []).filter(item => item?.foregroundCandidate).map(item => buildStructuredSummary([
            item?.title,
            item?.status,
            item?.nextPossibleShift ? `next ${item.nextPossibleShift}` : '',
            item?.resolutionHint || ''
          ], 180))
        ], density === 'heavy' ? 4 : 2).map(item => `- Watch: ${compactText(item, 180)}`),
        score: Math.max(
          Number(world?.timeline?.foregroundSignals?.[0]?.intensity || 0),
          Number(world?.offscreenThreads?.find(item => item?.foregroundCandidate)?.relevance || 0)
        )
      },
      {
        title: '[World Core X / Propagation Chains]',
        lines: uniqueTexts(
          normalizeArrayItems(world?.propagation || []).map(item => buildStructuredSummary([
            item?.summary,
            item?.kind ? `kind ${item.kind}` : '',
            item?.region ? `region ${item.region}` : '',
            item?.faction ? `faction ${item.faction}` : ''
          ], 180)),
          density === 'heavy' ? 3 : 2
        ).map(item => `- Chain: ${compactText(item, 180)}`),
        score: Number(world?.propagation?.[0]?.score || 0)
      },
      {
        title: '[World Core X / Analysis Hints]',
        lines: uniqueTexts([
          ...(world?.analysis?.promptHints || []),
          ...(world?.analysis?.timelineHints || []),
          ...(world?.analysis?.warnings || [])
        ], density === 'heavy' ? 4 : 2).map(item => `- Analysis: ${compactText(item, 180)}`),
        score: world?.analysis?.summary ? 72 : 0
      }
    ].filter(section => Array.isArray(section.lines) && section.lines.length);
    const sectionLimit = density === 'light' ? 1 : 2;
    const selectedSections = candidateSections
      .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
      .slice(0, sectionLimit);
    selectedSections.forEach((section) => {
      lines.push(section.title);
      lines.push(...section.lines);
    });
    return {
      lines,
      mode,
      relevance: Math.max(
        mode === 'heavy' ? 0.82 : (mode === 'light' ? 0.52 : 0.68),
        selectedSections[0] ? clamp01(Number(selectedSections[0].score || 0) / 100, 0.58) : 0
      )
    };
  };

  const buildBgPromptSection = (context = {}, bucket = {}, contextText = '', settings = getSettings()) => {
    const mode = String(settings.bgListMode || 'off');
    if (mode === 'off') return null;
    const coordinatorSnapshot = getPluginCoordinator()?.buildSnapshot?.() || {};
    const recentProposals = Array.isArray(coordinatorSnapshot?.recentPatchProposals) ? coordinatorSnapshot.recentPatchProposals : [];
    const storedBackground = bucket?.background && typeof bucket.background === 'object' ? bucket.background : null;
    const entityCandidates = Array.isArray(storedBackground?.entities) && storedBackground.entities.length
      ? storedBackground.entities
      : collectOffscreenEntityCandidates(context, bucket, contextText, settings);
    const groupCandidates = Array.isArray(storedBackground?.groups) && storedBackground.groups.length
      ? storedBackground.groups
      : collectOffscreenGroupCandidates(context, bucket, contextText, settings);
    const entityLimit = mode === 'main' ? 4 : 2;
    const groupLimit = mode === 'main' ? 3 : 1;
    const bgLines = [
      ...entityCandidates.slice(0, entityLimit).map((entry) => {
        const influence = buildBgInfluenceDescriptor(entry, bucket, recentProposals);
        return `- BG 인물 ${entry.charNum ? `C${entry.charNum} ` : ''}${entry.name}: ${entry.summary || '요약 없음'} / 분류 ${influence.categoryLabel || '일반'} / 이유 ${entry.reasonLabel || entry.reason || '장면 밖 후보'} / 점수 ${Math.round(Number(entry.score || 0))}${entry.location ? ` / 장소 ${entry.location}` : ''}${entry.country ? ` / 국가 ${entry.country}` : ''}${entry.factions?.[0] ? ` / 세력 ${entry.factions[0]}` : ''}${Number(entry.relatedThreadCount || 0) > 0 ? ` / thread ${entry.relatedThreadCount}` : ''}${entry.lastSeenTurn ? ` / 최근 turn ${entry.lastSeenTurn}` : ''}${influence.summary ? ` / 성격 ${influence.summary}` : ''}`;
      }),
      ...groupCandidates.slice(0, groupLimit).map((entry) => {
        const influence = buildBgInfluenceDescriptor(entry, bucket, recentProposals);
        return `- BG 그룹 ${entry.groupNum ? `G${entry.groupNum} ` : ''}${entry.name}: ${entry.summary || '요약 없음'} / 분류 ${influence.categoryLabel || '일반'} / 이유 ${entry.reasonLabel || entry.reason || '장면 밖 후보'} / 점수 ${Math.round(Number(entry.score || 0))}${entry.location ? ` / 장소 ${entry.location}` : ''}${entry.factions?.[0] ? ` / 세력 ${entry.factions[0]}` : ''}${Number(entry.relatedThreadCount || 0) > 0 ? ` / thread ${entry.relatedThreadCount}` : ''}${entry.lastSeenTurn ? ` / 최근 turn ${entry.lastSeenTurn}` : ''}${influence.summary ? ` / 성격 ${influence.summary}` : ''}`;
      })
    ].filter(Boolean);
    if (!bgLines.length) return null;
    const hints = String(storedBackground?.hints || '').trim() || buildOffscreenContextHints(context, settings);
    const intro = mode === 'main'
      ? '다음 후보들은 현재 장면과 병행되는 오프스크린 연속성으로 적극 참고합니다. 현재 장면을 뒤집지는 않되, 배경 압력과 다음 등장 준비로 비교적 강하게 반영하세요.'
      : '다음 후보들은 현재 장면 바깥에서 동시에 진행 중일 수 있는 보조 연속성 힌트입니다. 명시적으로 장면이 바뀌지 않았다면 배경 압력이나 후속 등장 가능성 정도로만 약하게 반영하세요.';
    return {
      lines: [
        '[World Core X / BG Off-screen candidates]',
        intro,
        hints ? `- BG 기준: ${hints}` : '',
        ...bgLines
      ].filter(Boolean),
      mode
    };
  };

  const shallowBgEntryListEqual = (left = [], right = []) => {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      const a = left[index] || {};
      const b = right[index] || {};
      if (
        String(a.type || '') !== String(b.type || '')
        || String(a.name || '') !== String(b.name || '')
        || String(a.summary || '') !== String(b.summary || '')
        || String(a.reason || '') !== String(b.reason || '')
        || JSON.stringify(a.factions || []) !== JSON.stringify(b.factions || [])
        || Number(a.relatedThreadCount || 0) !== Number(b.relatedThreadCount || 0)
        || Number(a.charNum || 0) !== Number(b.charNum || 0)
        || Number(a.groupNum || 0) !== Number(b.groupNum || 0)
        || Number(a.lastSeenTurn || 0) !== Number(b.lastSeenTurn || 0)
      ) {
        return false;
      }
    }
    return true;
  };

  const summarizeBackgroundEntries = (entries = [], groups = []) => {
    const entityNames = (Array.isArray(entries) ? entries : []).map(item => normalizeName(item?.name)).filter(Boolean);
    const groupNames = (Array.isArray(groups) ? groups : []).map(item => normalizeName(item?.name)).filter(Boolean);
    const parts = [];
    if (entityNames.length) parts.push(`인물 ${entityNames.join(', ')}`);
    if (groupNames.length) parts.push(`그룹 ${groupNames.join(', ')}`);
    return parts.join(' / ');
  };

  const diffBackgroundEntries = (previous = [], next = []) => {
    const prevMap = new Map((Array.isArray(previous) ? previous : []).map(item => [`${item?.type || 'x'}:${normalizeName(item?.name)}`, item]));
    const nextMap = new Map((Array.isArray(next) ? next : []).map(item => [`${item?.type || 'x'}:${normalizeName(item?.name)}`, item]));
    const added = [];
    const removed = [];
    nextMap.forEach((item, key) => {
      if (!prevMap.has(key)) added.push(item);
    });
    prevMap.forEach((item, key) => {
      if (!nextMap.has(key)) removed.push(item);
    });
    return { added, removed };
  };

  const promoteBackgroundEntries = (bucket = {}, contextText = '', turn = 0, currentDate = formatDateKST()) => {
    const background = bucket?.background && typeof bucket.background === 'object' ? bucket.background : null;
    if (!background) return 0;
    const promotedEntities = (Array.isArray(background.entities) ? background.entities : []).filter((entry) => {
      const normalized = normalizeName(entry?.name);
      if (!normalized) return false;
      if (mentionsName(contextText, normalized)) return true;
      const tracked = bucket?.entities?.[normalized];
      return Number(tracked?.lastSeenTurn || 0) === Number(turn || 0);
    });
    const promotedGroups = (Array.isArray(background.groups) ? background.groups : []).filter((entry) => {
      const normalized = normalizeName(entry?.name);
      if (!normalized) return false;
      if (mentionsName(contextText, normalized)) return true;
      const tracked = bucket?.groups?.[normalized];
      return Number(tracked?.lastSeenTurn || 0) === Number(turn || 0);
    });
    const promotedNames = [
      ...promotedEntities.map(entry => normalizeName(entry?.name)).filter(Boolean),
      ...promotedGroups.map(entry => normalizeName(entry?.name)).filter(Boolean)
    ];
    if (!promotedNames.length) return 0;
    const history = Array.isArray(background.history) ? background.history : [];
    pushUniqueHistory(history, {
      turn,
      date: currentDate,
      tag: 'BGPROMOTE',
      text: `BG 후보가 메인 추적으로 승격됨 · ${promotedNames.join(', ')}`,
      label: 'BG promote',
      details: {
        promoted: promotedNames.join(', ')
      }
    }, 20);
    background.history = history;
    return promotedNames.length;
  };

  const refreshBackgroundList = (context = {}, bucket = {}, contextText = '', settings = getSettings(), turn = 0) => {
    const mode = String(settings.bgListMode || 'off');
    const previous = bucket?.background && typeof bucket.background === 'object'
      ? bucket.background
      : { entities: [], groups: [], updatedTurn: 0, updatedDate: '', mode: 'off', scope: 'recently_exited', contextMode: 'indirect', hints: '', history: [] };
    const history = Array.isArray(previous.history) ? [...previous.history] : [];
    const currentDate = formatDateKST();
    if (mode === 'off') {
      const hadAnything = Array.isArray(previous.entities) && previous.entities.length
        || Array.isArray(previous.groups) && previous.groups.length
        || String(previous.mode || 'off') !== 'off';
      if (hadAnything) {
        pushUniqueHistory(history, {
          turn,
          date: currentDate,
          tag: 'BGCHANGE',
          text: 'BG 리스트를 비우고 장면 밖 추적을 끔',
          label: 'BG off',
          details: {
            scope: String(previous.scope || 'recently_exited'),
            context: String(previous.contextMode || 'indirect')
          }
        }, 20);
      }
      bucket.background = {
        entities: [],
        groups: [],
        updatedTurn: Number(turn || 0),
        updatedDate: currentDate,
        mode: 'off',
        scope: String(settings.bgScope || 'recently_exited'),
        contextMode: String(settings.bgContextMode || 'indirect'),
        hints: '',
        history
      };
      return hadAnything ? 1 : 0;
    }

    const entities = collectOffscreenEntityCandidates(context, bucket, contextText, settings).map((entry) => ({
      type: 'entity',
      name: normalizeName(entry?.name),
      charNum: Number(entry?.charNum || 0) || null,
      summary: compactText(entry?.summary || '', 180),
      reason: compactText(entry?.reason || '', 120),
      reasonCode: compactText(entry?.reasonCode || '', 60),
      reasonLabel: compactText(entry?.reasonLabel || '', 60),
      location: compactText(entry?.location || '', 80),
      country: compactText(entry?.country || '', 80),
      factions: uniqueTexts(entry?.factions || [], 3),
      relatedThreadCount: Number(entry?.relatedThreadCount || 0),
      lastSeenTurn: Number(entry?.lastSeenTurn || 0)
      ,
      score: Number(entry?.score || 0)
    }));
    const groups = collectOffscreenGroupCandidates(context, bucket, contextText, settings).map((entry) => ({
      type: 'group',
      name: normalizeName(entry?.name),
      groupNum: Number(entry?.groupNum || 0) || null,
      summary: compactText(entry?.summary || '', 180),
      reason: compactText(entry?.reason || '', 120),
      reasonCode: compactText(entry?.reasonCode || '', 60),
      reasonLabel: compactText(entry?.reasonLabel || '', 60),
      location: compactText(entry?.location || '', 80),
      factions: uniqueTexts(entry?.factions || [], 3),
      relatedThreadCount: Number(entry?.relatedThreadCount || 0),
      lastSeenTurn: Number(entry?.lastSeenTurn || 0)
      ,
      score: Number(entry?.score || 0)
    }));
    const hints = buildOffscreenContextHints(context, settings);
    const nextBackground = {
      entities,
      groups,
      updatedTurn: Number(turn || 0),
      updatedDate: currentDate,
      mode,
      scope: String(settings.bgScope || 'recently_exited'),
      contextMode: String(settings.bgContextMode || 'indirect'),
      hints,
      history
    };
    const changed = (
      !shallowBgEntryListEqual(previous.entities, nextBackground.entities)
      || !shallowBgEntryListEqual(previous.groups, nextBackground.groups)
      || String(previous.mode || '') !== nextBackground.mode
      || String(previous.scope || '') !== nextBackground.scope
      || String(previous.contextMode || '') !== nextBackground.contextMode
      || String(previous.hints || '') !== nextBackground.hints
    );
    if (changed) {
      const summary = summarizeBackgroundEntries(entities, groups);
      const previousCombined = [
        ...(Array.isArray(previous.entities) ? previous.entities : []),
        ...(Array.isArray(previous.groups) ? previous.groups : [])
      ];
      const nextCombined = [...entities, ...groups];
      const diff = diffBackgroundEntries(previousCombined, nextCombined);
      const changeBits = [];
      if (diff.added.length) changeBits.push(`추가 ${diff.added.map(item => item.name).slice(0, 4).join(', ')}`);
      if (diff.removed.length) changeBits.push(`제외 ${diff.removed.map(item => item.name).slice(0, 4).join(', ')}`);
      pushUniqueHistory(history, {
        turn,
        date: currentDate,
        tag: Array.isArray(previous.entities) && previous.entities.length || Array.isArray(previous.groups) && previous.groups.length ? 'BGCHANGE' : 'BGSET',
        text: [summary || '장면 밖 후보가 다시 계산됨', ...changeBits].filter(Boolean).join(' · '),
        label: mode === 'main' ? 'BG main' : 'BG aux',
        details: {
          scope: nextBackground.scope,
          context: nextBackground.contextMode,
          hint: hints,
          added: diff.added.map(item => item.name).slice(0, 6).join(', '),
          removed: diff.removed.map(item => item.name).slice(0, 6).join(', ')
        }
      }, 20);
    }
    bucket.background = nextBackground;
    return changed ? (entities.length + groups.length || 1) : 0;
  };

  const renderBackgroundListHtml = (background = {}) => {
    const bucket = arguments[1] && typeof arguments[1] === 'object' ? arguments[1] : {};
    const coordinatorSnapshot = getPluginCoordinator()?.buildSnapshot?.() || {};
    const recentProposals = Array.isArray(coordinatorSnapshot?.recentPatchProposals) ? coordinatorSnapshot.recentPatchProposals : [];
    const entities = Array.isArray(background?.entities) ? background.entities : [];
    const groups = Array.isArray(background?.groups) ? background.groups : [];
    const modeTextMap = { off: '끄기', main: '메인', aux: '보조' };
    const scopeTextMap = {
      mentioned_untracked: '언급되었으나 미등록',
      recently_exited: '직전 장면 퇴장',
      current_location: '현재 장소 범위',
      current_country: '현재 국가 범위',
      unrestricted: '장소 제한 없음',
      random: '랜덤'
    };
    const contextTextMap = {
      direct: '직결 관련',
      indirect: '간접 관련',
      time_shared: '시간만 공유',
      random: '랜덤'
    };
    const buildCoordinatorInfluenceHtml = (entry = {}) => {
      const influence = buildBgInfluenceDescriptor(entry, bucket, recentProposals);
      const influencePills = influence.tags.map((tag) => {
        const label = (
          tag === 'world-heavy' ? '모듈 월드 압력 중심' :
          tag === 'memory-heavy' ? '모듈 메모리 중심' :
          tag === 'canon-heavy' ? '모듈 원작 중심' :
          tag === 'group-heavy' ? '모듈 그룹 축' :
          tag === 'world-recent' ? '월드 최근 제안' :
          tag
        );
        return `모듈 ${label}`;
      });
      if (!influencePills.length) return '';
      const detailRows = influence.proposalRows.map((proposal) => {
        const bits = [
          proposal?.domain ? `도메인 ${proposal.domain}` : '',
          proposal?.phase ? `phase ${proposal.phase}` : '',
          Number.isFinite(Number(proposal?.changedCount)) ? `변경 ${proposal.changedCount}` : '',
          proposal?.source ? `source ${proposal.source}` : ''
        ].filter(Boolean);
        return `<div class="scope-section-note" style="margin-top:4px">${escHtml(String(proposal?.pluginId || 'plugin'))}${bits.length ? ` · ${escHtml(bits.join(' · '))}` : ''}</div>`;
      }).join('');
      return `
        ${renderDylistPillRow(influencePills.map(item => `모듈 ${item}`), { marginTop: 6 })}
        ${detailRows ? `<div style="margin-top:6px"><div class="scope-section-note"><strong>최근 모듈 흔적</strong></div>${detailRows}</div>` : ''}
      `;
    };
  const buildBgEntityContextHtml = (entry = {}) => {
    const normalized = normalizeName(entry?.name);
    const tracked = normalized ? bucket?.entities?.[normalized] : null;
    const snapshot = tracked?.entitySnapshot || null;
    if (!snapshot) return '';
    return [
      tracked?.currentSummary ? `<div class="scope-section-note" style="margin-top:6px"><strong>현재 위치</strong> ${escHtml(tracked.currentSummary)}</div>` : '',
      buildCoordinatorInfluenceHtml(entry)
    ].filter(Boolean).join('');
  };
    const buildBgGroupContextHtml = (entry = {}) => {
      const normalized = normalizeName(entry?.name);
      const tracked = normalized ? bucket?.groups?.[normalized] : null;
      if (!tracked) return '';
      return [
        Array.isArray(tracked.members) && tracked.members.length
          ? `<div class="scope-section-note" style="margin-top:6px"><strong>구성원</strong> ${escHtml(tracked.members.slice(0, 6).join(', '))}</div>`
          : '',
        tracked.role
          ? `<div class="scope-section-note" style="margin-top:6px"><strong>역할</strong> ${escHtml(tracked.role)}</div>`
          : '',
        tracked.managementStyle
          ? `<div class="scope-section-note" style="margin-top:6px"><strong>운영</strong> ${escHtml(tracked.managementStyle)}</div>`
          : '',
        buildCoordinatorInfluenceHtml(entry)
      ].filter(Boolean).join('');
    };
    const renderBgEntityCard = (entry) => renderDylistSubCard(
        `${entry?.charNum ? `C${entry.charNum} · ` : ''}${entry?.name || 'BG 인물'}`,
        `
          <div style="margin-top:6px;line-height:1.5">${escHtml(entry?.summary || '요약 없음')}</div>
          <div class="scope-inline-list" style="margin-top:6px">
            <span class="scope-inline-pill">${escHtml(entry?.reasonLabel || entry?.reason || '장면 밖 후보')}</span>
            <span class="scope-inline-pill">점수 ${escHtml(Math.round(Number(entry?.score || 0)))}</span>
            ${entry?.lastSeenTurn ? `<span class="scope-inline-pill">최근 turn ${escHtml(entry.lastSeenTurn)}</span>` : ''}
          </div>
          ${renderDylistPillRow([
            entry?.location ? `장소 ${entry.location}` : '',
            entry?.country ? `국가 ${entry.country}` : ''
          ], { marginTop: 6 })}
          <div class="scope-section-note" style="margin-top:6px">${escHtml(entry?.reason || '장면 밖 후보')}</div>
          ${buildBgEntityContextHtml(entry)}
        `,
        { marginTop: 6, tone: '#8fb8ff' }
      );
    const renderBgGroupCard = (entry) => renderDylistSubCard(
        `${entry?.groupNum ? `G${entry.groupNum} · ` : ''}${entry?.name || 'BG 그룹'}`,
        `
          <div style="margin-top:6px;line-height:1.5">${escHtml(entry?.summary || '요약 없음')}</div>
          <div class="scope-inline-list" style="margin-top:6px">
            <span class="scope-inline-pill">${escHtml(entry?.reasonLabel || entry?.reason || '장면 밖 그룹 후보')}</span>
            <span class="scope-inline-pill">점수 ${escHtml(Math.round(Number(entry?.score || 0)))}</span>
            ${entry?.lastSeenTurn ? `<span class="scope-inline-pill">최근 turn ${escHtml(entry.lastSeenTurn)}</span>` : ''}
          </div>
          ${renderDylistPillRow([
            entry?.location ? `장소 ${entry.location}` : ''
          ], { marginTop: 6 })}
          <div class="scope-section-note" style="margin-top:6px">${escHtml(entry?.reason || '장면 밖 그룹 후보')}</div>
          ${buildBgGroupContextHtml(entry)}
        `,
        { marginTop: 6, tone: '#7dd3b0' }
      );
    const combinedEntries = [
      ...entities.map((entry) => ({ kind: 'entity', entry, influence: buildBgInfluenceDescriptor(entry, bucket, recentProposals) })),
      ...groups.map((entry) => ({ kind: 'group', entry, influence: buildBgInfluenceDescriptor(entry, bucket, recentProposals) }))
    ];
    const sectionOrder = ['world-heavy', 'memory-heavy', 'group-heavy', 'general'];
    const sectionLabelMap = {
      'world-heavy': '월드 압력 중심 BG',
      'memory-heavy': '메모리·원작 중심 BG',
      'group-heavy': '그룹 중심 BG',
      general: '일반 BG'
    };
    const sectionNoteMap = {
      'world-heavy': '장면 압력, carryover, world limit 같은 외부 월드 신호 때문에 중요도가 올라간 후보입니다.',
      'memory-heavy': '옴니 메모리 또는 원작견 흔적 때문에 맥락상 다시 떠오른 후보입니다.',
      'group-heavy': '개별 인물보다 그룹 움직임이나 소속 변화가 더 중요한 후보입니다.',
      general: '특정 모듈 영향보다는 일반적인 장면 밖 연속성 후보입니다.'
    };
    const rows = sectionOrder.map((sectionKey) => {
      const items = combinedEntries.filter((item) => item.influence?.category === sectionKey);
      if (!items.length) return '';
      const cards = items.map((item) => (
        item.kind === 'entity'
          ? renderBgEntityCard(item.entry)
          : renderBgGroupCard(item.entry)
      )).join('');
      return renderDylistSubCard(
        sectionLabelMap[sectionKey] || sectionKey,
        cards || '<div class="scope-section-note" style="margin-top:6px">표시할 후보가 없습니다.</div>',
        {
          marginTop: 8,
          tone: (
            sectionKey === 'world-heavy' ? '#66c2a5' :
            sectionKey === 'memory-heavy' ? '#7ed0ff' :
            sectionKey === 'group-heavy' ? '#74d0a7' :
            '#9fb6d2'
          ),
          description: sectionNoteMap[sectionKey] || ''
        }
      );
    }).filter(Boolean).join('');
    return `
      <div class="scope-inline-list" style="margin-top:8px">
        <span class="scope-inline-pill">모드 ${escHtml(modeTextMap[String(background?.mode || 'off')] || '끄기')}</span>
        <span class="scope-inline-pill">범위 ${escHtml(scopeTextMap[String(background?.scope || 'recently_exited')] || '직전 장면 퇴장')}</span>
        <span class="scope-inline-pill">맥락 ${escHtml(contextTextMap[String(background?.contextMode || 'indirect')] || '간접 관련')}</span>
        <span class="scope-inline-pill">업데이트 turn ${escHtml(background?.updatedTurn || 0)}</span>
      </div>
      ${background?.hints ? `<div class="scope-section-note" style="margin-top:8px">${escHtml(background.hints)}</div>` : ''}
      ${rows || '<div class="scope-section-note" style="margin-top:8px">현재 장면 기준으로 잡힌 BG 후보가 없습니다.</div>'}
      <div style="margin-top:10px">
        <div class="scope-section-note"><strong>BG History</strong></div>
        ${buildHistoryHtml(Array.isArray(background?.history) ? background.history : [], '아직 기록된 BG 변화가 없습니다.')}
      </div>
    `;
  };

  const getMapLikeValues = (source) => {
    if (!source) return [];
    if (Array.isArray(source)) return source.slice();
    if (typeof source.forEach === 'function') {
      const values = [];
      try {
        source.forEach((value) => values.push(value));
        return values;
      } catch (_) {}
    }
    if (typeof source.values === 'function') {
      try {
        return Array.from(source.values());
      } catch (_) {}
    }
    return [];
  };

  const getContextLorebook = (context = {}) => {
    if (Array.isArray(context?.lore)) return context.lore;
    const MemoryEngine = context?.MemoryEngine || null;
    const activeChar = context?.char || null;
    const activeChat = context?.chat || null;
    if (!activeChar || !activeChat || typeof MemoryEngine?.getLorebook !== 'function') return [];
    const lore = MemoryEngine.getLorebook(activeChar, activeChat);
    return Array.isArray(lore) ? lore : [];
  };

  const collectLoreTypedRecords = (context = {}, commentType = '') => {
    const lore = getContextLorebook(context);
    const target = String(commentType || '').trim();
    if (!target) return [];
    const rows = [];
    lore.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      if (String(entry?.comment || '').trim() !== target) return;
      const parsed = safeJsonParse(entry?.content, null);
      if (parsed && typeof parsed === 'object') rows.push(parsed);
    });
    return rows;
  };

  const buildEntityIterationMap = (context = {}, entityCache = null) => {
    const mapped = new Map();
    const appendEntity = (entity) => {
      if (!entity || typeof entity !== 'object') return;
      const name = normalizeName(entity?.name);
      if (!name || mapped.has(name)) return;
      mapped.set(name, entity);
    };
    getMapLikeValues(entityCache).forEach(appendEntity);
    if (mapped.size === 0) {
      collectLoreTypedRecords(context, 'lmai_entity').forEach(appendEntity);
    }
    return mapped;
  };

  const rebuildExtensionState = async (context = {}) => {
    runtimeState.activeChatId = getRuntimeChatId(context);
    const phaseLabel = String(context?.capturePhase || 'runtime').trim() || 'runtime';
    if (!ensureStateCommitAllowed(context, phaseLabel)) return 0;
    let entityCache = context?.EntityManager?.getEntityCache?.();
    const lore = getContextLorebook(context);
    if (Array.isArray(lore) && lore.length > 0 && getMapLikeValues(entityCache).length === 0 && typeof context?.EntityManager?.rebuildCache === 'function') {
      try {
        context.EntityManager.rebuildCache(lore);
        entityCache = context?.EntityManager?.getEntityCache?.();
      } catch (_) {}
    }

    const entityIterationMap = buildEntityIterationMap(context, entityCache);
    if (entityIterationMap.size === 0) {
      runtimeState.lastChangedCount = 0;
      updateRuntimeStatus(`${phaseLabel} DyList 갱신 · 추적 대상 없음`);
      reportCoordinatorRuntime({ phase: phaseLabel, changedCount: 0, touchedCount: 0 });
      return 0;
    }

    await importBucketFromCopiedChatIfNeeded(context, runtimeState.activeChatId);
    const bucket = await getChatBucket(runtimeState.activeChatId);
    const turn = getTurn(context);
    const contextText = await buildContextText(context);
    const settings = getSettings();
    let changed = 0;
    let touched = 0;

    changed += await refreshWorldState(context, bucket, contextText, settings, turn);
    const analysisStage = resolveAnalysisStage(phaseLabel);
    if (analysisStage) {
      try {
        const evidenceText = await collectUnifiedContextEvidenceText(context, {
          scope: `world-corex-analysis:${analysisStage}`,
          maxLen: 6000
        });
        const analysisResult = await maybeRunAnalysisProvider(analysisStage, context, bucket, { evidenceText });
        if (analysisResult) {
          changed += mergeWorldAnalysisIntoBucket(bucket, {
            ...analysisResult,
            stage: analysisStage
          }, settings);
        }
      } catch (error) {
        updateRuntimeStatus(`${phaseLabel} analysis failed · ${compactText(error?.message || String(error), 120)}`);
      }
    }

    const entitiesToTrack = buildTrackedEntityQueue(entityIterationMap, bucket, contextText, settings);
    entitiesToTrack.forEach((entity) => {
      const name = normalizeName(entity?.name);
      if (!name) return;
      const entry = ensureEntityEntry(bucket, name);
      const summary = summarizeEntity(entity);
      const date = getEntityLiveDate(entity);
      const wasEmpty = !entry.firstSeenTurn;
      let entityChanged = false;
      entry.firstSeenTurn = entry.firstSeenTurn || turn;
      entry.lastSeenTurn = turn;
      entry.lastDate = date;
      entry.entitySnapshot = buildEntitySnapshot(entity);
      if (summary && summary !== entry.currentSummary) {
        entry.currentSummary = summary;
        if (appendHistory(entry, {
          turn,
          date,
          tag: wasEmpty ? 'REGISTER' : 'STATUS',
          text: summary,
          label: entity?.identity?.role || entity?.background?.occupation || ''
        })) touched += 1;
        changed += 1;
        entityChanged = true;
      }
      if (!entityChanged && mentionsName(contextText, name)) {
        if (appendHistory(entry, {
          turn,
          date,
          tag: 'ACT',
          text: compactText(contextText, 180)
        })) touched += 1;
      }

      extractLegacyEntityEvents(entity).forEach((event) => {
        if (appendHistory(entry, event, 24)) touched += 1;
      });

      const legacyGroup = buildLegacyEntityGroup(entity);
      if (legacyGroup) {
        const groupEntry = ensureGroupEntry(bucket, legacyGroup.name);
        if (groupEntry) {
          const wasGroupEmpty = !groupEntry.firstSeenTurn;
          groupEntry.firstSeenTurn = groupEntry.firstSeenTurn || turn;
          groupEntry.lastSeenTurn = turn;
          groupEntry.kind = legacyGroup.kind || groupEntry.kind || '';
          groupEntry.role = legacyGroup.role || groupEntry.role || '';
          groupEntry.managementStyle = legacyGroup.managementStyle || groupEntry.managementStyle || '';
          groupEntry.description = legacyGroup.description || groupEntry.description || '';
          groupEntry.members = Array.from(new Set([...(Array.isArray(groupEntry.members) ? groupEntry.members : []), ...(Array.isArray(legacyGroup.members) ? legacyGroup.members : [])])).slice(0, 8);
          groupEntry.sources = Array.from(new Set([...(Array.isArray(groupEntry.sources) ? groupEntry.sources : []), ...(Array.isArray(legacyGroup.sources) ? legacyGroup.sources : [])])).slice(0, 6);
          if (legacyGroup.groupStats && !groupEntry.groupStats) groupEntry.groupStats = legacyGroup.groupStats;
          if (legacyGroup.summary && legacyGroup.summary !== groupEntry.currentSummary) {
            groupEntry.currentSummary = legacyGroup.summary;
            if (appendHistory(groupEntry, {
              turn,
              date,
              tag: wasGroupEmpty ? 'GROUPSET' : 'GROUPCHANGE',
              text: legacyGroup.summary,
              label: legacyGroup.kind || '',
              details: {
                members: Array.isArray(legacyGroup.members) ? legacyGroup.members.join(', ') : '',
                role: legacyGroup.role || '',
                style: legacyGroup.managementStyle || ''
              }
            })) touched += 1;
            changed += 1;
          }
        }
      }
    });

    collectWorldGroups(context).forEach((group) => {
      const entry = ensureGroupEntry(bucket, group.name);
      if (!entry) return;
      const summary = compactText(group.summary || [group.kind, group.role].filter(Boolean).join(' | '), 260);
      const date = formatDateKST();
      const wasEmpty = !entry.firstSeenTurn;
      entry.firstSeenTurn = entry.firstSeenTurn || turn;
      entry.lastSeenTurn = turn;
      entry.kind = group.kind || entry.kind || '';
      entry.role = group.role || entry.role || '';
      entry.managementStyle = group.managementStyle || entry.managementStyle || '';
      entry.description = group.description || entry.description || '';
      entry.members = Array.from(new Set([...(Array.isArray(entry.members) ? entry.members : []), ...(Array.isArray(group.members) ? group.members : [])])).slice(0, 8);
      entry.sources = Array.from(new Set([...(Array.isArray(entry.sources) ? entry.sources : []), ...(Array.isArray(group.sources) ? group.sources : [])])).slice(0, 6);
      if (summary && summary !== entry.currentSummary) {
        entry.currentSummary = summary;
        if (appendHistory(entry, {
          turn,
          date,
          tag: wasEmpty ? 'GROUPSET' : 'GROUPCHANGE',
          text: summary,
          label: group.kind || '',
          details: {
            members: Array.isArray(group.members) ? group.members.join(', ') : '',
            role: group.role || '',
            style: group.managementStyle || ''
          }
        })) touched += 1;
        changed += 1;
      } else if (mentionsName(contextText, group.name)) {
        if (appendHistory(entry, {
          turn,
          date,
          tag: 'ACT',
          text: compactText(contextText, 180)
        })) touched += 1;
      }
    });

    const backgroundPromoted = promoteBackgroundEntries(bucket, contextText, turn, formatDateKST());
    if (backgroundPromoted > 0) touched += backgroundPromoted;

    const bgChanged = refreshBackgroundList(context, bucket, contextText, settings, turn);
    if (bgChanged > 0) changed += bgChanged;

    if (changed > 0 || touched > 0) await schedulePersist();
    runtimeState.lastChangedCount = changed;
    updateRuntimeStatus(`${phaseLabel} DyList 갱신 · changed ${changed} / touched ${touched}`);
    reportCoordinatorRuntime({ phase: phaseLabel, changedCount: changed, touchedCount: touched });
    return changed;
  };

  const getHistoryLabelMap = () => ({
    REGISTER: '현재 상태',
    STATUS: '상태 변화',
    ACT: '행동',
    GROUPSET: '그룹 설정',
    GROUPCHANGE: '그룹 변화',
    BGSET: 'BG 설정',
    BGCHANGE: 'BG 변화',
    BGPROMOTE: 'BG 승격'
  });

  const renderHistoryRichText = (item = {}, options = {}) => {
    const settings = getSettings();
    const labelMap = getHistoryLabelMap();
    const metrics = item.metrics || {};
    const details = item.details || {};
    const dateTokens = getDateTokens(item.date);
    const replacements = {
      '⌂HISYY⌂': dateTokens.YY,
      '⌂HISMM⌂': dateTokens.MM,
      '⌂HISDD⌂': dateTokens.DD,
      '⌂HISTT⌂': '',
      '⌂HISTAG⌂': String(labelMap[item.tag] || item.tag || '').trim(),
      '⌂HISDESC⌂': String(item.text || '').trim(),
      '⌂HISTARGET⌂': String(item.target || '').trim(),
      '⌂HISLABEL⌂': String(item.label || '').trim(),
      '⌂HISTRUST⌂': Number.isFinite(Number(metrics.trust)) ? `신뢰 ${Math.round(Number(metrics.trust) * 100)}%` : '',
      '⌂HISINTI⌂': Number.isFinite(Number(metrics.closeness)) ? `친밀 ${Math.round(Number(metrics.closeness) * 100)}%` : '',
      '⌂HISCOG⌂': Number.isFinite(Number(metrics.cognition)) ? `인지 ${Math.round(Number(metrics.cognition) * 100)}%` : '',
      '⌂HISINTEREST⌂': Number.isFinite(Number(metrics.interest)) ? `흥미 ${Math.round(Number(metrics.interest) * 100)}%` : '',
      '⌂HISAFFECTION⌂': Number.isFinite(Number(metrics.affection)) ? `사랑 ${Math.round(Number(metrics.affection) * 100)}%` : '',
      '⌂HISDESIRE⌂': Number.isFinite(Number(metrics.lust)) ? `욕정 ${Math.round(Number(metrics.lust) * 100)}%` : '',
      '⌂HISRESPECT⌂': Number.isFinite(Number(metrics.respect)) ? `존경 ${Math.round(Number(metrics.respect) * 100)}%` : '',
      '⌂HISOBEDIENCE⌂': Number.isFinite(Number(metrics.obedience)) ? `복종 ${Math.round(Number(metrics.obedience) * 100)}%` : '',
      '⌂HISTENSION⌂': Number.isFinite(Number(metrics.tension)) ? `긴장 ${Math.round(Number(metrics.tension) * 100)}%` : '',
      '⌂HISSTABILITY⌂': Number.isFinite(Number(metrics.stability)) ? `안정 ${Math.round(Number(metrics.stability) * 100)}%` : '',
      '⌂HISMEMBERS⌂': String(details.members || '').trim(),
      '⌂HISROLE⌂': String(details.role || '').trim(),
      '⌂HISSTYLE⌂': String(details.style || '').trim()
    };
    const template = String(settings.historyTemplates?.[item.tag] || '⌂HISDESC⌂');
    const rendered = template
      .replace(/⌂HISYY⌂|⌂HISMM⌂|⌂HISDD⌂|⌂HISTT⌂|⌂HISTAG⌂|⌂HISDESC⌂|⌂HISTARGET⌂|⌂HISLABEL⌂|⌂HISTRUST⌂|⌂HISINTI⌂|⌂HISCOG⌂|⌂HISINTEREST⌂|⌂HISAFFECTION⌂|⌂HISDESIRE⌂|⌂HISRESPECT⌂|⌂HISOBEDIENCE⌂|⌂HISTENSION⌂|⌂HISSTABILITY⌂|⌂HISMEMBERS⌂|⌂HISROLE⌂|⌂HISSTYLE⌂/g, (token) => replacements[token] || '')
      .split('·')
      .map(part => part.trim())
      .filter(Boolean)
      .join(' · ');
    if (options.mode === 'inline') return rendered || String(item.text || '').trim();
    return {
      title: String(labelMap[item.tag] || item.tag || '?').trim(),
      detail: rendered,
      body: String(item.text || '').trim()
    };
  };

  const buildHistoryHtml = (history = [], emptyText = '기록 없음') => {
    const settings = getSettings();
    const rows = (Array.isArray(history) ? history : [])
      .slice(-Number(settings.maxDisplayHistory || DEFAULT_SETTINGS.maxDisplayHistory))
      .reverse()
      .map(item => renderDylistHistoryEntry(item))
      .join('');
    return rows || `<div class="scope-section-note">${escHtml(emptyText)}</div>`;
  };

  const collectEntityGroups = (bucket, entityName, limit = 4) => {
    const normalized = normalizeName(entityName);
    if (!normalized) return [];
    return Object.values(bucket?.groups || {})
      .filter(entry => Array.isArray(entry?.members) && entry.members.some(member => normalizeName(member) === normalized))
      .sort((left, right) => Number(right.lastSeenTurn || 0) - Number(left.lastSeenTurn || 0))
      .slice(0, limit);
  };

  const buildRecentHistoryRows = (bucket, limit = Number(getSettings().maxRecentHistory || DEFAULT_SETTINGS.maxRecentHistory)) => {
    const merged = [];
    Object.values(bucket?.entities || {}).forEach(entry => {
      (Array.isArray(entry?.history) ? entry.history : []).forEach(item => {
        merged.push({
          scope: `C${entry.charNum} ${entry.name}`,
          turn: Number(item?.turn || 0),
          date: item?.date || '',
          tag: item?.tag || '',
          text: item?.text || '',
          target: item?.target || '',
          label: item?.label || '',
          details: item?.details || {},
          metrics: item?.metrics || {}
        });
      });
    });
    Object.values(bucket?.groups || {}).forEach(entry => {
      (Array.isArray(entry?.history) ? entry.history : []).forEach(item => {
        merged.push({
          scope: `G${entry.groupNum} ${entry.name}`,
          turn: Number(item?.turn || 0),
          date: item?.date || '',
          tag: item?.tag || '',
          text: item?.text || '',
          target: item?.target || '',
          label: item?.label || '',
          details: item?.details || {},
          metrics: item?.metrics || {}
        });
      });
    });
    (Array.isArray(bucket?.background?.history) ? bucket.background.history : []).forEach((item) => {
      merged.push({
        scope: 'BG List',
        turn: Number(item?.turn || 0),
        date: item?.date || '',
        tag: item?.tag || '',
        text: item?.text || '',
        target: item?.target || '',
        label: item?.label || '',
        details: item?.details || {},
        metrics: item?.metrics || {}
      });
    });
    return merged
      .sort((left, right) => {
        const turnGap = Number(right.turn || 0) - Number(left.turn || 0);
        if (turnGap !== 0) return turnGap;
        return String(right.date || '').localeCompare(String(left.date || ''));
      })
      .slice(0, limit);
  };

  const getRecentBgPromotionInfo = (bucket = {}, entityName = '', currentTurn = 0) => {
    const normalizedEntityName = normalizeName(entityName);
    if (!normalizedEntityName) return null;
    const history = Array.isArray(bucket?.background?.history) ? bucket.background.history : [];
    const recentHistory = [...history]
      .filter(item => String(item?.tag || '') === 'BGPROMOTE')
      .sort((left, right) => {
        const turnGap = Number(right?.turn || 0) - Number(left?.turn || 0);
        if (turnGap !== 0) return turnGap;
        return String(right?.date || '').localeCompare(String(left?.date || ''));
      });
    for (const item of recentHistory) {
      const promotedNames = String(item?.details?.promoted || '')
        .split(',')
        .map(name => normalizeName(name))
        .filter(Boolean);
      if (!promotedNames.includes(normalizedEntityName)) continue;
      const turn = Number(item?.turn || 0);
      const turnGap = Number.isFinite(turn) && turn > 0 && Number.isFinite(Number(currentTurn))
        ? Math.max(0, Number(currentTurn) - turn)
        : null;
      return {
        turn,
        date: item?.date || '',
        text: item?.text || '',
        turnGap,
        recent: Number.isFinite(turnGap) ? turnGap <= 2 : false
      };
    }
    return null;
  };

  const buildBgPromotionPillRow = (promotion = null) => {
    if (!promotion) return '';
    const phaseLabel = (() => {
      if (!Number.isFinite(promotion.turnGap)) return `BG 승격 · turn ${promotion.turn || 0}`;
      if (promotion.turnGap <= 1) return 'BG 승격 · 최근 유입';
      if (promotion.turnGap <= 2) return 'BG 승격 · 유입 여운';
      return `BG 승격 · turn ${promotion.turn || 0}`;
    })();
    const items = [
      phaseLabel,
      Number.isFinite(promotion.turnGap) ? `${promotion.turnGap}턴 전` : '',
      promotion.date ? promotion.date : ''
    ].filter(Boolean);
    return items.length ? renderDylistPillRow(items, { marginTop: 6 }) : '';
  };

  const getBgPromotionWeight = (bucket = {}, entityName = '', currentTurn = 0) => {
    const promotion = getRecentBgPromotionInfo(bucket, entityName, currentTurn);
    if (!promotion) return 0;
    if (!Number.isFinite(promotion.turnGap)) return 0;
    if (promotion.turnGap <= 1) return 2;
    if (promotion.turnGap <= 2) return 1;
    return 0;
  };

  const entityCardSection = (context = {}) => {
    const entity = context?.entity || null;
    if (!entity) return null;
    const chatId = String(context?.chat?.id || 'global');
    const chatBucket = persistedState?.chats?.[chatId] || {};
    const bucket = chatBucket?.entities || {};
    const currentTurn = Number(context?.chat?.turn || 0);
    const normalizedName = normalizeName(entity?.name);
    const entry = bucket[normalizedName] || {
      name: normalizedName || compactText(entity?.name || 'Entity', 80),
      charNum: 0,
      firstSeenTurn: 0,
      lastSeenTurn: 0,
      currentSummary: summarizeEntity(entity),
      psychologySummary: buildPsychologyModuleSummary(entity),
      emotionSummary: buildEmotionSyncSummary(entity),
      sexualSummary: extractSexualStats(entity).summary,
      lastDate: getEntityLiveDate(entity),
      entitySnapshot: buildEntitySnapshot(entity),
      history: []
    };

    const gender = getEntityGender(entity) || entry?.entitySnapshot?.gender || '';
    const bgPromotion = getRecentBgPromotionInfo(chatBucket, entity?.name || entry?.name, currentTurn || entry?.lastSeenTurn || 0);
    const bgPromotionBadgeItems = bgPromotion ? [
      bgPromotion.recent ? 'BG 승격 · 최근 장면 유입' : `BG 승격 · turn ${bgPromotion.turn || 0}`,
      Number.isFinite(bgPromotion.turnGap) ? `${bgPromotion.turnGap}턴 전` : '',
      bgPromotion.date ? bgPromotion.date : ''
    ].filter(Boolean) : [];
    const bgPromotionPills = buildBgPromotionPillRow(bgPromotion);
    const bgPromotionNote = bgPromotion
      ? `<div class="scope-section-note" style="margin-top:6px;color:#8f6234"><strong>BG 승격 기록</strong> · ${escHtml(bgPromotion.text || 'BG 후보에서 메인 추적으로 전환됨')}</div>`
      : '';
    const fieldItems = summarizeEntityFields({
      ...entity,
      gender
    }).map(field => `${field.label}: ${compactText(field.value, 90)}`);
    const fields = renderDylistPillRow(fieldItems);
    const groupRows = collectEntityGroups(chatBucket, entity?.name).map(item => renderDylistSubCard(
      `G${item.groupNum} · ${item.name}`,
      `<div style="margin-top:6px;line-height:1.5">${escHtml(item.currentSummary || '그룹 요약 없음')}</div>`,
      { marginTop: 6, tone: '#74d0a7' }
    )).join('');
    const psychologyHtml = renderPsychologyBlockHtml(entity);
    const popupBody = `
      ${renderDylistSubCard('개요', `
        <div class="scope-section-note" style="margin-top:6px">C${escHtml(entry.charNum)} · first turn ${escHtml(entry.firstSeenTurn || 0)} · last turn ${escHtml(entry.lastSeenTurn || 0)}</div>
        ${bgPromotionNote}
        <div style="margin-top:6px;line-height:1.55">${escHtml(entry.currentSummary || '요약 없음')}</div>
        ${gender ? renderDylistPillRow([`Gender ${gender}`], { marginTop: 6 }) : ''}
        ${bgPromotionPills}
        ${fields}
      `, { tone: '#6aa8ff', marginTop: 0 })}
      ${renderDylistSubCard('Psychology', psychologyHtml || '<div class="scope-section-note" style="margin-top:6px">심리 정보가 없습니다.</div>', { tone: '#b388ff' })}
      ${renderDylistSubCard('GroupList', groupRows || '<div class="scope-section-note" style="margin-top:6px">연결된 그룹이 없습니다.</div>', { tone: '#74d0a7' })}
      ${renderDylistSubCard('Recent History', buildHistoryHtml(entry.history), { tone: '#ffd36a' })}
    `;

    return {
      key: 'dylist.entity.card',
      name: 'World Core X',
      order: 32,
      html: `
        <div class="scope-section-card">
          <div class="insp-section-title">🎭 DyList Character</div>
          <div class="scope-section-note" style="margin-top:6px">카드 상세는 팝오버에서 확인할 수 있습니다.</div>
          ${bgPromotionPills}
          ${renderLauncherPopover({
            popupId: `dylist-entity-card-${chatId}-${entry.charNum}`,
            buttonLabel: 'DyList 보기',
            title: 'CharacterList Snapshot',
            subtitle: `${entry.name || entity?.name || 'Entity'} · C${entry.charNum}${gender ? ` · ${gender}` : ''}`,
            summary: '그룹/히스토리 확인',
            bodyHtml: popupBody,
            accent: '🎭'
          })}
        </div>
      `
    };
  };

  const buildGroupSummaryFields = (entry = {}) => {
    const fields = [];
    if (entry.kind) fields.push({ label: 'Kind', value: entry.kind });
    if (entry.role) fields.push({ label: 'Role', value: entry.role });
    if (entry.managementStyle) fields.push({ label: 'Style', value: entry.managementStyle });
    if (Array.isArray(entry.members) && entry.members.length > 0) fields.push({ label: 'Members', value: entry.members.join(', ') });
    return fields.slice(0, 4);
  };

  const clampPct = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const keywordHits = (text, patterns = []) => patterns.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0);
  const buildGroupStats = (entry = {}) => {
    if (entry?.groupStats && typeof entry.groupStats === 'object') {
      return entry.groupStats;
    }
    const text = `${entry.kind || ''} ${entry.role || ''} ${entry.managementStyle || ''} ${entry.description || ''} ${entry.currentSummary || ''}`.trim();
    const memberCount = Array.isArray(entry.members) ? entry.members.length : 0;
    const sourceCount = Array.isArray(entry.sources) ? entry.sources.length : 0;
    const controlBias = keywordHits(text, [/guild|clan|order|government|police|association|위원회|길드|세력|가문|정부|기사단|학생회/i]);
    const infoBias = keywordHits(text, [/school|academy|research|studio|production|committee|학교|학원|연구|스튜디오|동아리/i]);
    const sustainBias = keywordHits(text, [/company|family|union|foundation|enterprise|회사|가문|연합|재단|기업/i]);
    const stats = {
      SYSTEM: [
        clampPct(24 + memberCount * 11 + sourceCount * 8 + controlBias * 10),
        clampPct(18 + memberCount * 9 + controlBias * 14),
        clampPct(22 + memberCount * 8 + sourceCount * 10 + infoBias * 8)
      ],
      CAPABILITIES: [
        clampPct(20 + infoBias * 16 + sourceCount * 12),
        clampPct(18 + memberCount * 10 + controlBias * 8),
        clampPct(16 + controlBias * 12 + sustainBias * 10)
      ],
      LIFESPAN: [
        clampPct(28 + sustainBias * 14 + sourceCount * 10),
        clampPct(22 + memberCount * 9 + sustainBias * 8),
        clampPct(20 + sourceCount * 12 + sustainBias * 12)
      ],
      SIZE: [
        clampPct(15 + memberCount * 14 + sourceCount * 8),
        clampPct(18 + memberCount * 10 + controlBias * 10),
        clampPct(16 + memberCount * 9 + sustainBias * 12)
      ],
      MEMBERSHIP: [
        clampPct(18 + memberCount * 12 + sustainBias * 6),
        clampPct(14 + controlBias * 10 + infoBias * 8),
        clampPct(20 + memberCount * 10 + sourceCount * 8)
      ]
    };
    return stats;
  };

  const renderMiniGauge = (label, value) => `
    <div style="margin-top:4px">
      <div style="display:flex;justify-content:space-between;gap:8px;font-size:10px;color:var(--dy-text2, #607389)">
        <span>${escHtml(label)}</span>
        <span>${escHtml(clampPct(value))}</span>
      </div>
      <div style="margin-top:3px;height:5px;border-radius:999px;background:color-mix(in srgb,var(--dy-bg3, #dbe6f2) 82%, transparent);overflow:hidden">
        <div style="height:100%;width:${clampPct(value)}%;border-radius:999px;background:linear-gradient(90deg,#5dc8ff,#8c7dff)"></div>
      </div>
    </div>
  `;

  const renderGroupStatsHtml = (entry = {}) => {
    const settings = getSettings();
    const stats = buildGroupStats(entry);
    const axisLabels = {
      SYSTEM: ['Decision', 'Control', 'Comm.'],
      CAPABILITIES: ['Info', 'Action', 'Control'],
      LIFESPAN: ['Moral', 'Internal', 'Sustain'],
      SIZE: ['Scale', 'Influence', 'Expansion'],
      MEMBERSHIP: ['Cohesion', 'Autonomy', 'Stability']
    };
    return Object.entries(stats).map(([key, values]) => `
      <div style="margin-top:8px;padding:8px 9px;border:1px solid var(--dy-border-soft, rgba(66,92,122,0.22));border-radius:8px;background:color-mix(in srgb,var(--dy-bg2, #e6eef8) 82%, transparent)">
        <div style="font-size:11px;font-weight:600;color:var(--dy-text, #1b3047)">${escHtml(key)}</div>
        ${values.map((value, index) => `
          ${renderMiniGauge(axisLabels[key][index], value)}
          ${settings.showGroupAxisDescriptions && settings.groupAxisDescriptions?.[key]?.[index]
            ? `<div style="margin-top:3px;font-size:10px;color:var(--dy-text2, #607389)">${escHtml(settings.groupAxisDescriptions[key][index])}</div>`
            : ''}
        `).join('')}
      </div>
    `).join('');
  };

  const renderSettingsPreviewHtml = () => {
    const settings = getSettings();
    return `
      <div class="scope-section-card dylist-settings-panel" style="margin-top:8px">
        <div class="insp-section-title">World Core X 설정</div>
        <div class="dylist-settings-live">
          ${buildSettingsPreviewBodyHtml(settings)}
        </div>
        ${renderSettingsFormHtml(settings, { mode: 'full' })}
      </div>
    `;
  };

  const buildCoordinatorSummaryHtml = () => {
    const coordinator = getPluginCoordinator();
    const snapshot = coordinator?.buildSnapshot?.() || {};
    const runtime = Array.isArray(snapshot?.runtime) ? snapshot.runtime : [];
    const proposals = Array.isArray(snapshot?.recentPatchProposals) ? snapshot.recentPatchProposals : [];
    const pendingCount = proposals.filter(item => String(item?.status || '').trim() === 'pending').length;
    const appliedCount = proposals.filter(item => String(item?.status || '').trim() === 'applied').length;
    const failedCount = proposals.filter(item => String(item?.status || '').trim() === 'failed').length;
    const blockedCount = proposals.filter(item => String(item?.status || '').trim() === 'blocked').length;
    const modeText = String(snapshot?.mode || '').trim() === 'manual' ? '수동 반영' : '자동 반영';
    const runtimeRows = runtime.slice(0, 4).map((entry) => renderDylistSubCard(
      `${entry?.pluginId || 'unknown'}${entry?.domain ? ` · ${entry.domain}` : ''}`,
      `
        <div style="margin-top:6px;line-height:1.5">${escHtml(compactText(entry?.lastStatus || '상태 없음', 140))}</div>
        <div class="scope-section-note" style="margin-top:6px">phase ${escHtml(entry?.phase || '-')} · chat ${escHtml(entry?.activeChatId || 'global')}</div>
      `,
      { marginTop: 6, tone: '#6aa8ff' }
    )).join('');
    return `
      <div class="scope-section-card" style="margin-top:8px">
        <div class="insp-section-title">코디네이터 요약</div>
        <div class="scope-section-note">본체 coordinator가 받은 서브플러그인 상태를 World Core X 기준으로 요약해 보여줍니다.</div>
        <div class="scope-inline-list" style="margin-top:8px">
          <span class="scope-inline-pill">모드 ${escHtml(modeText)}</span>
          <span class="scope-inline-pill">런타임 ${escHtml(runtime.length)}</span>
          <span class="scope-inline-pill">대기 ${escHtml(pendingCount)}</span>
          <span class="scope-inline-pill">적용 ${escHtml(appliedCount)}</span>
          <span class="scope-inline-pill">실패 ${escHtml(failedCount)}</span>
          <span class="scope-inline-pill">차단 ${escHtml(blockedCount)}</span>
        </div>
        ${runtimeRows || '<div class="scope-section-note" style="margin-top:8px">아직 coordinator에 보고된 플러그인 상태가 없습니다.</div>'}
      </div>
    `;
  };

  const relationCardSection = (context = {}) => {
    return null;
  };

  const inspectorPanel = async (context = {}) => {
    const chatId = String(context?.chat?.id || 'global');
    await importBucketFromCopiedChatIfNeeded(context, chatId);
    const bucket = await getChatBucket(chatId);
    const runtimeSnapshot = buildDylistRuntimeSnapshot(getSettings(), { chatId, bucket });
    const currentTurn = Number(bucket?.turn || bucket?.background?.updatedTurn || 0);
    const world = bucket?.world && typeof bucket.world === 'object' ? bucket.world : createDefaultWorldBucket();
    const worldLines = [
      world.sceneSummary ? `<div class="scope-section-note" style="margin-top:6px"><strong>Focus</strong> ${escHtml(world.sceneSummary)}</div>` : '',
      world.autonomySummary ? `<div class="scope-section-note" style="margin-top:6px"><strong>Motion</strong> ${escHtml(world.autonomySummary)}</div>` : '',
      world.dmaSummary ? `<div class="scope-section-note" style="margin-top:6px"><strong>DMA</strong> ${escHtml(world.dmaSummary)}</div>` : '',
      world?.timeline?.phaseShiftSummary ? `<div class="scope-section-note" style="margin-top:6px"><strong>Phase Shift</strong> ${escHtml(world.timeline.phaseShiftSummary)}</div>` : '',
      world?.timeline?.forecast ? `<div class="scope-section-note" style="margin-top:6px"><strong>Forecast</strong> ${escHtml(world.timeline.forecast)}</div>` : '',
      world.scenePressures?.[0] ? `<div class="scope-section-note" style="margin-top:6px"><strong>Scene</strong> ${escHtml(world.scenePressures.slice(0, 3).join(' · '))}</div>` : '',
      world.carryoverSignals?.[0] ? `<div class="scope-section-note" style="margin-top:6px"><strong>Carryover</strong> ${escHtml(world.carryoverSignals.slice(0, 2).join(' · '))}</div>` : '',
      world.worldLimits?.[0] ? `<div class="scope-section-note" style="margin-top:6px"><strong>Limit</strong> ${escHtml(world.worldLimits.slice(0, 2).join(' · '))}</div>` : '',
      world.codexSignals?.[0] ? `<div class="scope-section-note" style="margin-top:6px"><strong>Codex</strong> ${escHtml(world.codexSignals.slice(0, 2).join(' · '))}</div>` : '',
      (world.location || world.country) ? `<div class="scope-section-note" style="margin-top:6px"><strong>Scene Meta</strong> ${escHtml([world.currentNodeName, world.location, world.country].filter(Boolean).join(' · '))}</div>` : ''
    ].filter(Boolean).join('');
    const worldStructureHtml = [
      world?.structure?.summary ? `<div class="scope-section-note" style="margin-top:6px"><strong>Focus</strong> ${escHtml(world.structure.summary)}</div>` : '',
      ...(world?.structure?.institutions || []).slice(0, 2).map(item => `<div class="scope-section-note" style="margin-top:6px"><strong>${escHtml(item.name || 'Institution')}</strong> ${escHtml(item.summary || '')}</div>`),
      ...(world?.structure?.laws || []).slice(0, 2).map(item => `<div class="scope-section-note" style="margin-top:6px"><strong>Law</strong> ${escHtml(buildStructuredSummary([item.summary, item.scope ? `scope ${item.scope}` : '', item.severity ? `severity ${item.severity}` : ''], 180))}</div>`),
      ...(world?.structure?.economy || []).slice(0, 1).map(item => `<div class="scope-section-note" style="margin-top:6px"><strong>Economy</strong> ${escHtml(item.summary || '')}</div>`)
    ].filter(Boolean).join('');
    const factionHtml = normalizeArrayItems(world?.factions || []).slice(0, 4).map((item) => renderDylistSubCard(
      item?.name || 'Faction',
      `
        <div class="scope-section-note" style="margin-top:6px">${escHtml(item?.summary || item?.officialGoal || '요약 없음')}</div>
        <div class="scope-inline-list" style="margin-top:6px">
          ${item?.controlRegions?.[0] ? `<span class="scope-inline-pill">통제 ${escHtml(item.controlRegions[0])}</span>` : ''}
          ${item?.patronBody ? `<span class="scope-inline-pill">지휘 ${escHtml(item.patronBody)}</span>` : ''}
          ${item?.hierarchyTier ? `<span class="scope-inline-pill">티어 ${escHtml(String(item.hierarchyTier))}</span>` : ''}
          ${item?.linkedRules?.[0] ? `<span class="scope-inline-pill">규칙 연동</span>` : ''}
          <span class="scope-inline-pill">긴장 ${escHtml(`${Math.round(Number(item?.tension || 0) * 100)}%`)}</span>
          <span class="scope-inline-pill">열도 ${escHtml(`${Math.round(Number(item?.heat || 0) * 100)}%`)}</span>
          <span class="scope-inline-pill">위험 ${escHtml(`${Math.round(Number(item?.longTermRisk || 0) * 100)}%`)}</span>
        </div>
        ${item?.hierarchySummary ? `<div class="scope-section-note" style="margin-top:6px"><strong>Hierarchy</strong> ${escHtml(item.hierarchySummary)}</div>` : ''}
        ${item?.linkedRules?.[0] ? `<div class="scope-section-note" style="margin-top:6px"><strong>Rules</strong> ${escHtml(item.linkedRules.slice(0, 2).join(' · '))}</div>` : ''}
      `,
      { marginTop: 6, tone: '#74d0a7' }
    )).join('');
    const offscreenThreadHtml = normalizeArrayItems(world?.offscreenThreads || []).slice(0, 4).map((item) => renderDylistSubCard(
      item?.title || 'Thread',
      `
        <div class="scope-section-note" style="margin-top:6px">${escHtml(item?.summary || '요약 없음')}</div>
        <div class="scope-inline-list" style="margin-top:6px">
          ${item?.region ? `<span class="scope-inline-pill">지역 ${escHtml(item.region)}</span>` : ''}
          ${item?.patronBody ? `<span class="scope-inline-pill">지휘 ${escHtml(item.patronBody)}</span>` : ''}
          <span class="scope-inline-pill">상태 ${escHtml(item?.status || 'active')}</span>
          ${item?.foregroundCandidate ? `<span class="scope-inline-pill">전면 후보</span>` : ''}
          <span class="scope-inline-pill">긴급 ${escHtml(`${Math.round(Number(item?.urgency || 0) * 100)}%`)}</span>
          <span class="scope-inline-pill">모멘텀 ${escHtml(`${Math.round(Number(item?.momentum || 0) * 100)}%`)}</span>
          <span class="scope-inline-pill">압력 ${escHtml(`${Math.round(Number(item?.pressure || 0) * 100)}%`)}</span>
        </div>
        <div class="scope-inline-list" style="margin-top:6px">
          ${Number.isFinite(Number(item?.explosionRisk)) ? `<span class="scope-inline-pill">폭발 ${escHtml(`${Math.round(Number(item.explosionRisk) * 100)}%`)}</span>` : ''}
          ${Number.isFinite(Number(item?.coolingBias)) ? `<span class="scope-inline-pill">냉각 ${escHtml(`${Math.round(Number(item.coolingBias) * 100)}%`)}</span>` : ''}
          ${Number.isFinite(Number(item?.commandReach)) ? `<span class="scope-inline-pill">지휘권 ${escHtml(`${Math.round(Number(item.commandReach) * 100)}%`)}</span>` : ''}
        </div>
        ${item?.resolutionHint ? `<div class="scope-section-note" style="margin-top:6px"><strong>Hint</strong> ${escHtml(item.resolutionHint)}</div>` : ''}
      `,
      { marginTop: 6, tone: '#ffd36a' }
    )).join('');
    const regionalPressureHtml = normalizeArrayItems(world?.regions || []).slice(0, 4).map((item) => renderDylistSubCard(
      item?.name || 'Region',
      `
        <div class="scope-section-note" style="margin-top:6px">${escHtml(item?.summary || '요약 없음')}</div>
        <div class="scope-inline-list" style="margin-top:6px">
          ${item?.controlFaction ? `<span class="scope-inline-pill">통제 ${escHtml(item.controlFaction)}</span>` : ''}
          ${item?.accessLevel ? `<span class="scope-inline-pill">출입 ${escHtml(item.accessLevel)}</span>` : ''}
          ${item?.governanceTier ? `<span class="scope-inline-pill">거버넌스 ${escHtml(String(item.governanceTier))}</span>` : ''}
          ${item?.breakoutRisk ? `<span class="scope-inline-pill">폭발 위험</span>` : ''}
          <span class="scope-inline-pill">압력 ${escHtml(String(Math.round(Number(item?.pressureScore || 0))))}</span>
        </div>
        <div class="scope-inline-list" style="margin-top:6px">
          ${Number.isFinite(Number(item?.seasonalLoad)) ? `<span class="scope-inline-pill">계절 ${escHtml(`${Math.round(Number(item.seasonalLoad) * 100)}%`)}</span>` : ''}
          ${Number.isFinite(Number(item?.coolingBias)) ? `<span class="scope-inline-pill">냉각 ${escHtml(`${Math.round(Number(item.coolingBias) * 100)}%`)}</span>` : ''}
          ${Number.isFinite(Number(item?.commandReach)) ? `<span class="scope-inline-pill">지휘권 ${escHtml(`${Math.round(Number(item.commandReach) * 100)}%`)}</span>` : ''}
        </div>
        ${item?.activeRestrictions?.[0] ? `<div class="scope-section-note" style="margin-top:6px"><strong>Restrictions</strong> ${escHtml(item.activeRestrictions.slice(0, 2).join(' · '))}</div>` : ''}
      `,
      { marginTop: 6, tone: '#6aa8ff' }
    )).join('');
    const worldTimelineHtml = [
      world?.timeline?.currentPhase ? `<div class="scope-section-note" style="margin-top:6px"><strong>Current Phase</strong> ${escHtml(world.timeline.currentPhase)}</div>` : '',
      world?.timeline?.escalationSummary ? `<div class="scope-section-note" style="margin-top:6px"><strong>Escalation</strong> ${escHtml(world.timeline.escalationSummary)}</div>` : '',
      world?.timeline?.temporalPulse ? `<div class="scope-section-note" style="margin-top:6px"><strong>Temporal Pulse</strong> ${escHtml(world.timeline.temporalPulse)}</div>` : '',
      world?.timeline?.phaseShiftSummary ? `<div class="scope-section-note" style="margin-top:6px"><strong>Phase Shift</strong> ${escHtml(world.timeline.phaseShiftSummary)}</div>` : '',
      world?.timeline?.forecast ? `<div class="scope-section-note" style="margin-top:6px"><strong>Forecast</strong> ${escHtml(world.timeline.forecast)}</div>` : '',
      ...(world?.timeline?.foregroundSignals || []).slice(0, 2).map(item => `<div class="scope-section-note" style="margin-top:6px"><strong>Watch</strong> ${escHtml(buildStructuredSummary([item.summary, item.stage ? `stage ${item.stage}` : '', item.trend ? `trend ${item.trend}` : '', item.resolutionHint || ''], 180))}</div>`),
      ...(world?.timeline?.resolvedSignals || []).slice(0, 2).map(item => `<div class="scope-section-note" style="margin-top:6px"><strong>Cooling</strong> ${escHtml(buildStructuredSummary([item.summary, item.stage ? `stage ${item.stage}` : '', item.stageTransition || '', item.resolutionHint || ''], 180))}</div>`),
      ...(world?.timeline?.recentEvents || []).slice(0, 2).map(item => `<div class="scope-section-note" style="margin-top:6px"><strong>Recent</strong> ${escHtml(item.summary || '')}</div>`),
      ...(world?.timeline?.pendingEvents || []).slice(0, 2).map(item => `<div class="scope-section-note" style="margin-top:6px"><strong>Pending</strong> ${escHtml(item.summary || '')}</div>`),
      ...(world?.timeline?.seasonalContext || []).slice(0, 1).map(item => `<div class="scope-section-note" style="margin-top:6px"><strong>Season</strong> ${escHtml(item)}</div>`)
    ].filter(Boolean).join('');
    const worldPropagationHtml = normalizeArrayItems(world?.propagation || []).slice(0, 4).map((item) => renderDylistSubCard(
      item?.kind || 'Propagation',
      `
        <div class="scope-section-note" style="margin-top:6px">${escHtml(item?.summary || '요약 없음')}</div>
        <div class="scope-inline-list" style="margin-top:6px">
          ${item?.region ? `<span class="scope-inline-pill">지역 ${escHtml(item.region)}</span>` : ''}
          ${item?.faction ? `<span class="scope-inline-pill">세력 ${escHtml(item.faction)}</span>` : ''}
          ${item?.thread ? `<span class="scope-inline-pill">선 ${escHtml(item.thread)}</span>` : ''}
          <span class="scope-inline-pill">점수 ${escHtml(String(Math.round(Number(item?.score || 0))))}</span>
        </div>
      `,
      { marginTop: 6, tone: '#9a87ff' }
    )).join('');
    const worldAnalysisHtml = [
      world?.analysis?.summary ? `<div class="scope-section-note" style="margin-top:6px"><strong>Summary</strong> ${escHtml(world.analysis.summary)}</div>` : '',
      ...(world?.analysis?.promptHints || []).slice(0, 3).map(item => `<div class="scope-section-note" style="margin-top:6px"><strong>Hint</strong> ${escHtml(item)}</div>`),
      ...(world?.analysis?.timelineHints || []).slice(0, 2).map(item => `<div class="scope-section-note" style="margin-top:6px"><strong>Timeline</strong> ${escHtml(item)}</div>`),
      ...(world?.analysis?.warnings || []).slice(0, 2).map(item => `<div class="scope-section-note" style="margin-top:6px"><strong>Warning</strong> ${escHtml(item)}</div>`),
      world?.analysis?.provider ? `<div class="scope-section-note" style="margin-top:6px"><strong>Provider</strong> ${escHtml(`${world.analysis.provider}/${world.analysis.model || '-'}`)}</div>` : ''
    ].filter(Boolean).join('');
    const entityRows = Object.values(bucket.entities || {})
      .sort((left, right) => {
        const leftWeight = getBgPromotionWeight(bucket, left?.name, currentTurn || left?.lastSeenTurn || 0);
        const rightWeight = getBgPromotionWeight(bucket, right?.name, currentTurn || right?.lastSeenTurn || 0);
        if (leftWeight !== rightWeight) return rightWeight - leftWeight;
        const turnGap = Number(right.lastSeenTurn || 0) - Number(left.lastSeenTurn || 0);
        if (turnGap !== 0) return turnGap;
        return Number(left.charNum || 0) - Number(right.charNum || 0);
      })
      .slice(0, 12)
      .map(entry => {
        const bgPromotion = getRecentBgPromotionInfo(bucket, entry?.name, currentTurn || entry?.lastSeenTurn || 0);
        const bgPromotionPills = buildBgPromotionPillRow(bgPromotion);
        const bgPromotionNote = bgPromotion
          ? `<div class="scope-section-note" style="margin-top:6px;color:#8f6234"><strong>BG 승격</strong> · ${escHtml(bgPromotion.recent ? '최근 장면에서 장면 밖 추적 후보가 메인 추적으로 들어왔습니다.' : (bgPromotion.text || '장면 밖 추적 후보에서 메인 추적으로 전환된 기록이 있습니다.'))}</div>`
          : '';
        return renderDylistSubCard(
          `C${entry.charNum} · ${entry.name}`,
          `
            <div style="margin-top:6px;line-height:1.5">${escHtml(entry.currentSummary || '요약 없음')}</div>
            ${bgPromotionPills}
            ${bgPromotionNote}
          `,
          { marginTop: 6, tone: '#6aa8ff' }
        );
      }).join('');
    const groupRows = Object.values(bucket.groups || {})
      .sort((left, right) => Number(left.groupNum || 0) - Number(right.groupNum || 0))
      .slice(0, 10)
      .map(entry => {
        const groupFields = buildGroupSummaryFields(entry).map(field => `
          <span class="scope-inline-pill">${escHtml(field.label)}: ${escHtml(compactText(field.value, 80))}</span>
        `).join('');
        return renderDylistSubCard(
          `G${entry.groupNum} · ${entry.name}`,
          `
            <div style="margin-top:6px;line-height:1.5">${escHtml(entry.currentSummary || '그룹 요약 없음')}</div>
            ${groupFields ? `<div class="scope-inline-list" style="margin-top:6px">${groupFields}</div>` : ''}
            ${renderGroupStatsHtml(entry)}
          `,
          { marginTop: 6, tone: '#74d0a7' }
        );
      }).join('');
    const activityRows = buildRecentHistoryRows(bucket).map(item => {
      return renderDylistHistoryEntry(item, {
        scope: item.scope,
        tone: '#ffd36a',
        marginTop: 6
      });
    }).join('');
    const backgroundHtml = renderBackgroundListHtml(bucket.background || {}, bucket);
    const analysis = normalizeAnalysisProviderSettings(getSettings().analysisProvider || {});
    const promptFacingHtml = [
      world?.systemFocus ? `<div class="scope-section-note" style="margin-top:6px"><strong>World Focus</strong> ${escHtml(world.systemFocus)}</div>` : '',
      world?.sceneSummary ? `<div class="scope-section-note" style="margin-top:6px"><strong>Scene Summary</strong> ${escHtml(world.sceneSummary)}</div>` : '',
      world?.dmaSummary ? `<div class="scope-section-note" style="margin-top:6px"><strong>DMA Hint</strong> ${escHtml(world.dmaSummary)}</div>` : '',
      normalizeArrayItems(world?.publicPressure || []).slice(0, 2).map(item => `<div class="scope-section-note" style="margin-top:6px"><strong>Pressure</strong> ${escHtml(item?.summary || '')}</div>`).join(''),
      normalizeArrayItems(world?.factions || []).slice(0, 1).map(item => `<div class="scope-section-note" style="margin-top:6px"><strong>Faction</strong> ${escHtml(buildStructuredSummary([item?.name, item?.summary || item?.officialGoal || '', item?.controlRegions?.[0] ? `region ${item.controlRegions[0]}` : ''], 180))}</div>`).join(''),
      normalizeArrayItems(world?.offscreenThreads || []).slice(0, 1).map(item => `<div class="scope-section-note" style="margin-top:6px"><strong>Off-screen</strong> ${escHtml(buildStructuredSummary([item?.title, item?.summary || '', item?.nextPossibleShift || item?.resolutionHint || ''], 180))}</div>`).join(''),
      normalizeArrayItems(world?.regions || []).slice(0, 1).map(item => `<div class="scope-section-note" style="margin-top:6px"><strong>Region</strong> ${escHtml(buildStructuredSummary([item?.name, item?.summary || '', item?.activeRestrictions?.[0] || ''], 180))}</div>`).join(''),
      world?.analysis?.summary ? `<div class="scope-section-note" style="margin-top:6px"><strong>Analysis Hint</strong> ${escHtml(world.analysis.summary)}</div>` : ''
    ].filter(Boolean).join('');
    const systemDetailHtml = [
      renderDylistFoldSection('World Continuity', worldLines || '<div class="scope-section-note">추적된 월드 신호가 없습니다.</div>', {
        open: true,
        note: 'Story Author / Director / main model이 직접 참조하게 될 압축 세계 압력입니다.'
      }),
      renderDylistFoldSection('World Structure', worldStructureHtml || '<div class="scope-section-note">구조 월드 데이터가 없습니다.</div>', {
        note: '법, 제도, 경제, 문화, 공공질서 같은 장면 바깥 구조를 보여줍니다.'
      }),
      renderDylistFoldSection('Active Factions', factionHtml || '<div class="scope-section-note">활성 세력 데이터가 없습니다.</div>'),
      renderDylistFoldSection('Off-screen Threads', offscreenThreadHtml || '<div class="scope-section-note">오프스크린 진행선이 없습니다.</div>'),
      renderDylistFoldSection('Regional Pressure', regionalPressureHtml || '<div class="scope-section-note">지역 압력 데이터가 없습니다.</div>'),
      renderDylistFoldSection('World Timeline', worldTimelineHtml || '<div class="scope-section-note">월드 타임라인 데이터가 없습니다.</div>'),
      renderDylistFoldSection('Propagation Chains', worldPropagationHtml || '<div class="scope-section-note">연쇄 규칙 신호가 없습니다.</div>'),
      renderDylistFoldSection('World Analysis', worldAnalysisHtml || '<div class="scope-section-note">분석 provider 결과가 아직 없습니다.</div>')
    ].join('');
    const trackingDetailHtml = [
      renderDylistFoldSection('CharacterList', entityRows || '<div class="scope-section-note">추적된 캐릭터가 없습니다.</div>', {
        open: true,
        note: '인물 내부 해석은 Entity Core X가 맡고, 여기서는 월드 추적 접점만 요약합니다.'
      }),
      renderDylistFoldSection('GroupList', groupRows || '<div class="scope-section-note">추적된 그룹이 없습니다.</div>'),
      renderDylistFoldSection('BG List', `
        <div class="scope-section-note">원본 Dynamic-List의 장면 밖 추적 성격을 이어 받아, 현재 장면 바깥 후보를 월드 버킷에 유지합니다.</div>
        ${backgroundHtml}
      `),
      renderDylistFoldSection('Recent History', activityRows || '<div class="scope-section-note">표시할 최근 히스토리가 없습니다.</div>')
    ].join('');

    return {
      key: 'dylist.core.panel',
      name: 'World Core X',
      order: 34,
      html: `
        <div class="scope-section-card">
          <div class="insp-section-title">🔦 World Core X</div>
          <div class="scope-section-note">리브라 본체는 서브플러그인 inspector/quick/entity/relation 패널을 거의 그대로 카드로 붙입니다. 그래서 World Core X는 카드 수를 줄이고, Story Author와 main model이 실제로 참조할 요약을 먼저 보여주는 쪽이 효율적입니다.</div>
          <div class="scope-section-note" style="margin-top:6px">Entity Core X와 겹치는 심리/NSFW/엔티티 내부 해석은 제외하고, 월드 구조·세력·지역·오프스크린 진행선·시간 압력을 중심으로 보여줍니다.</div>
          <div style="margin-top:10px">
            ${buildQuickSummaryHeroHtml(getSettings(), runtimeSnapshot)}
          </div>
          ${renderDylistPillRow([
            `world pressure ${runtimeSnapshot.worldPressureCount}`,
            `factions ${runtimeSnapshot.worldFactionCount}`,
            `threads ${runtimeSnapshot.worldThreadCount}`,
            `regions ${runtimeSnapshot.worldRegionCount}`,
            `foreground ${runtimeSnapshot.worldForegroundCount}`,
            runtimeSnapshot.worldDmaCount ? `dma ${runtimeSnapshot.worldDmaCount}` : '',
            runtimeSnapshot.worldCoolingCount ? `cooling ${runtimeSnapshot.worldCoolingCount}` : '',
            analysis.enabled ? `analysis ${analysis.provider}/${analysis.model}` : 'analysis disabled'
          ], { marginTop: 10 })}
        </div>
        <div class="scope-section-card" style="margin-top:8px">
          <div class="insp-section-title">What LIBRA Sees</div>
          <div class="scope-section-note">이 요약은 prompt injector가 월드 데이터를 압축할 때의 우선순위와 거의 같은 결을 유지합니다. 즉, 여기서 먼저 보여주는 것이 실제 아웃풋 개입면과 가깝습니다.</div>
          ${promptFacingHtml || '<div class="scope-section-note" style="margin-top:8px">아직 프롬프트에 올릴 만한 월드 요약이 없습니다.</div>'}
        </div>
        <div class="scope-section-card" style="margin-top:8px">
          <div class="insp-section-title">World Systems</div>
          <div class="scope-section-note">구조 월드, 세력, 지역, 타임라인, 전이 규칙은 한 카드 안에서 접어서 확인하는 편이 리브라 inspector에서 가장 보기 좋습니다.</div>
          ${systemDetailHtml}
        </div>
        <div class="scope-section-card" style="margin-top:8px">
          <div class="insp-section-title">Tracking Buckets</div>
          <div class="scope-section-note">Character / Group / BG / History는 운영용 진단 정보라서, 상단 요약 아래에 묶어 두는 편이 실제 사용성이 좋습니다.</div>
          ${trackingDetailHtml}
        </div>
      `
    };
  };

  const quickControlPanel = async () => {
    const settings = getSettings();
    const analysis = normalizeAnalysisProviderSettings(settings.analysisProvider || {});
    return {
      key: 'dylist.core.quick-controls',
      name: 'World Core X 퀵패널',
      order: 24,
      html: `
        <div class="scope-section-card dylist-settings-panel">
          <div class="insp-section-title">🔦 World Core X · 퀵패널</div>
          <div class="scope-section-note">퀵패널은 런타임 상태와 자주 바꾸는 추적 강도만 빠르게 조정하는 곳으로 두고, 상세 진단은 inspector에서 보도록 분리하는 편이 리브라 UI에 가장 잘 맞습니다.</div>
          <div class="scope-section-note" style="margin-top:6px">analysis=${escHtml(analysis.enabled ? `${analysis.provider}/${analysis.model}` : 'disabled')}</div>
          <div class="dylist-settings-live" style="margin-top:8px">
            ${buildQuickControlStatusHtml(settings)}
          </div>
          ${renderDylistFoldSection('Tracking Controls', renderQuickRuntimeControlsHtml(settings), {
            open: true,
            marginTop: 10,
            note: '구조 월드, 오프스크린 진행선, 지역 인지, 프롬프트 밀도처럼 자주 손대는 항목만 빠르게 묶었습니다.'
          })}
          ${renderAnalysisProviderSettingsPanelHtml(settings, { open: false })}
          ${renderDylistFoldSection('Coordinator Summary', buildCoordinatorSummaryHtml(), {
            marginTop: 10,
            note: '본체 coordinator에 보고된 상태는 필요할 때만 펼쳐 확인하는 편이 화면을 덜 차지합니다.'
          })}
        </div>
      `
    };
  };

  const buildPromptInjectorSection = async (context = {}) => {
    const settings = getSettings();
    const chatId = String(context?.chat?.id || 'global');
    await importBucketFromCopiedChatIfNeeded(context, chatId);
    const bucket = await getChatBucket(chatId);
    const contextText = await buildContextText(context);
    const evidenceText = await collectUnifiedContextEvidenceText(context, {
      scope: 'dylist-prompt',
      maxLen: 5000
    });
    const currentTurn = Number(context?.chat?.turn || bucket?.turn || bucket?.background?.updatedTurn || 0);

    const entityPool = Object.values(bucket.entities || {})
      .filter(entry => entry && typeof entry === 'object' && entry.currentSummary)
      .filter((entry) => {
        if (settings.dlMaleTrack !== false) return true;
        const gender = getEntityGender(entry?.entitySnapshot || {});
        const name = normalizeName(entry?.name);
        if (mentionsName(contextText, name)) return true;
        return !isLikelyMaleGender(gender);
      })
      .sort((left, right) => {
        const leftPromotion = getBgPromotionWeight(bucket, left?.name, currentTurn);
        const rightPromotion = getBgPromotionWeight(bucket, right?.name, currentTurn);
        if (leftPromotion !== rightPromotion) return rightPromotion - leftPromotion;
        const leftMentioned = mentionsName(contextText, left?.name) ? 1 : 0;
        const rightMentioned = mentionsName(contextText, right?.name) ? 1 : 0;
        if (leftMentioned !== rightMentioned) return rightMentioned - leftMentioned;
        return Number(right.lastSeenTurn || 0) - Number(left.lastSeenTurn || 0);
      });
    const entityCap = (() => {
      const maxTrack = clampNonNegativeInt(settings.dlCharTrackLimit, 0);
      if (maxTrack > 0) return Math.max(1, Math.min(4, maxTrack));
      return 2;
    })();
    const entityLines = entityPool
      .slice(0, entityCap)
      .map(entry => `- C${entry.charNum} ${entry.name}: ${compactText(entry.currentSummary, 180)}`);

    const activityLines = buildRecentHistoryRows(bucket, 2)
      .slice(0, 2)
      .map(item => {
        const rendered = renderHistoryRichText(item, { mode: 'inline' });
        return `- Recent ${item.scope}: ${compactText(rendered || item.text || '', 180)}`;
      });

    const evidenceLines = evidenceText
      ? evidenceText.split('\n').filter(Boolean).slice(0, 2).map(line => `- Evidence: ${compactText(line, 180)}`)
      : [];

    const behaviorLines = [];
    if (settings.dlMaleTrack) behaviorLines.push('- 남성 캐릭터도 적극적으로 추적합니다.');
    if (Number(settings.dlCharTrackLimit || 0) > 0) behaviorLines.push(`- 한 턴에 최대 ${settings.dlCharTrackLimit}명만 추적합니다.`);
    if (String(settings.bgListMode || 'off') !== 'off') {
      behaviorLines.push(`- BG/off-screen 후보를 ${settings.bgListMode === 'main' ? '메인' : '보조'} continuity 힌트로 함께 추적합니다.`);
    }
    if (settings.trackWorldSignals !== false) {
      behaviorLines.push(`- 월드 압력은 ${settings.worldPromptMode === 'heavy' ? '강하게' : (settings.worldPromptMode === 'light' ? '가볍게' : '균형 있게')} continuity 힌트로 사용합니다.`);
    }

    const worldSection = buildWorldPromptSection(context, bucket, settings);
    const bgSection = buildBgPromptSection(context, bucket, contextText, settings);
    const lines = [...entityLines, ...activityLines, ...evidenceLines].filter(Boolean).slice(0, 6);
    if (!lines.length && !(bgSection?.lines || []).length && !(worldSection?.lines || []).length) return null;
    const relevance = Math.max(
      worldSection?.relevance || 0,
      bgSection?.mode === 'main' ? 0.74 : 0.58
    );

    return {
      key: `${PLUGIN_ID}:prompt`,
      priority: 'optional',
      relevance,
      label: 'worldCoreX',
      text: [
        '[World Core X / Scene + BG continuity]',
        'Use these as persistent continuity hints for world pressure, off-screen movement, and recent carryover unless the new turn changes them clearly.',
        ...(behaviorLines.length ? ['[Extraction Behavior]', ...behaviorLines] : []),
        ...(worldSection?.lines || []),
        ...lines,
        ...(bgSection?.lines || [])
      ].join('\n')
    };
  };

  const refreshBackgroundOnly = async (context = {}) => {
    runtimeState.activeChatId = getRuntimeChatId(context);
    const phaseLabel = String(context?.capturePhase || 'finalize').trim() || 'finalize';
    if (!ensureStateCommitAllowed(context, phaseLabel)) return 0;
    const chatId = String(context?.chat?.id || 'global');
    await importBucketFromCopiedChatIfNeeded(context, chatId);
    const bucket = await getChatBucket(chatId);
    const settings = getSettings();
    const turn = getTurn(context);
    const contextText = await buildContextText(context);
    const changed = refreshBackgroundList(context, bucket, contextText, settings, turn);
    if (changed > 0) await schedulePersist();
    runtimeState.lastChangedCount = changed;
    updateRuntimeStatus(`${phaseLabel} BG 갱신 · changed ${changed}`);
    reportCoordinatorRuntime({ phase: `${phaseLabel}-bg`, changedCount: changed });
    return changed;
  };
  const runManualWorldAnalysis = async (context = {}, options = {}) => {
    const chatId = String(options?.chatId || context?.chat?.id || 'global');
    await importBucketFromCopiedChatIfNeeded(context, chatId);
    const bucket = await getChatBucket(chatId);
    const evidenceText = compactText(
      String(options?.evidenceText || '')
      || await collectUnifiedContextEvidenceText(context, {
        scope: 'world-corex-analysis:manual',
        maxLen: 6000
      }),
      6000
    );
    const analysisResult = await maybeRunAnalysisProvider('manual', {
      ...(context && typeof context === 'object' ? context : {}),
      chat: context?.chat || { id: chatId }
    }, bucket, { evidenceText });
    if (analysisResult) {
      mergeWorldAnalysisIntoBucket(bucket, {
        ...analysisResult,
        stage: 'manual'
      }, getSettings());
      await schedulePersist();
    }
    return {
      chatId,
      analysis: safeJsonParse(JSON.stringify(bucket?.world?.analysis || {}), {}),
      applied: !!analysisResult
    };
  };

  const definition = {
    id: PLUGIN_ID,
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    relationCardSection,
    inspectorPanel,
    quickControlPanel,
    promptInjector(context = {}) {
      return buildPromptInjectorSection(context);
    },
    rebuildExtensionState(context = {}) {
      return rebuildExtensionState(withPhaseContext(context, 'rebuild'));
    },
    beforeRequest(context = {}) {
      return rebuildExtensionState(withPhaseContext(context, 'beforeRequest'));
    },
    afterRequest(context = {}) {
      runtimeState.activeChatId = getRuntimeChatId(context);
      runtimeState.lastChangedCount = 0;
      updateRuntimeStatus('pseudo afterRequest 관측 · finalize 대기');
      reportCoordinatorRuntime({ phase: 'afterRequest-observe', changedCount: 0 });
      return 0;
    },
    onColdStart(context = {}) {
      return rebuildExtensionState(withPhaseContext(context, 'cold-start'));
    },
    onReanalyze(context = {}) {
      return rebuildExtensionState(withPhaseContext(context, 'reanalyze'));
    },
    onRecovery(context = {}) {
      return rebuildExtensionState(withPhaseContext(context, 'recovery'));
    },
    onFinalize(context = {}) {
      return rebuildExtensionState(withPhaseContext(context, 'finalize'));
    },
    async onLibraReady() {
      await loadState();
      bindSettingsPanelHandlers();
      bindAnalysisProviderPanelHandlers();
      reportCoordinatorRuntime({ phase: 'ready', changedCount: 0 });
      if (typeof window !== 'undefined') {
        const openFallbackPopover = (popoverId, node) => {
          if (typeof document === 'undefined' || !node) return false;
          const normalizedId = String(popoverId || '').trim();
          if (!normalizedId) return false;
          let state = dylistFallbackPopoverStates.get(normalizedId);
          if (!state) {
            state = {
              originalParent: null,
              originalNextSibling: null,
              backdrop: null,
              escHandler: null
            };
            dylistFallbackPopoverStates.set(normalizedId, state);
          }
          if (!state.originalParent) {
            state.originalParent = node.parentNode || null;
            state.originalNextSibling = node.nextSibling || null;
          }
          if (!(state.backdrop instanceof HTMLElement)) {
            const backdrop = document.createElement('div');
            backdrop.setAttribute('data-dylist-fallback-popover', normalizedId);
            backdrop.style.position = 'fixed';
            backdrop.style.inset = '0';
            backdrop.style.zIndex = '10060';
            backdrop.style.background = 'rgba(10, 18, 30, 0.45)';
            backdrop.style.display = 'flex';
            backdrop.style.alignItems = 'center';
            backdrop.style.justifyContent = 'center';
            backdrop.style.padding = '14px';
            backdrop.addEventListener('click', (event) => {
              if (event.target !== backdrop) return;
              try { window.LIBRA_DyListCoreAPI?.closePopover?.(normalizedId); } catch (_) {}
            });
            state.backdrop = backdrop;
          }
          if (state.backdrop && !state.backdrop.parentNode) {
            document.body.appendChild(state.backdrop);
          }
          if (state.backdrop && node.parentNode !== state.backdrop) {
            state.backdrop.appendChild(node);
          }
          node.style.display = 'block';
          node.style.width = 'min(640px, calc(100vw - 28px))';
          node.style.maxWidth = 'min(640px, calc(100vw - 28px))';
          node.style.maxHeight = 'min(84vh, 720px)';
          node.style.overflow = 'auto';
          node.style.margin = '0';
          node.style.position = 'relative';
          node.setAttribute('data-dylist-open', '1');
          if (!state.escHandler) {
            state.escHandler = (event) => {
              if (event.key !== 'Escape') return;
              try { window.LIBRA_DyListCoreAPI?.closePopover?.(normalizedId); } catch (_) {}
            };
            document.addEventListener('keydown', state.escHandler, true);
          }
          return true;
        };
        const closeFallbackPopover = (popoverId, node) => {
          if (typeof document === 'undefined') return false;
          const normalizedId = String(popoverId || '').trim();
          if (!normalizedId) return false;
          const state = dylistFallbackPopoverStates.get(normalizedId);
          if (!state) return false;
          const targetNode = node || document.getElementById(normalizedId);
          if (targetNode) {
            if (state.originalParent) {
              if (state.originalNextSibling && state.originalNextSibling.parentNode === state.originalParent) {
                state.originalParent.insertBefore(targetNode, state.originalNextSibling);
              } else {
                state.originalParent.appendChild(targetNode);
              }
            }
            targetNode.style.display = 'none';
            targetNode.removeAttribute('data-dylist-open');
          }
          if (state.escHandler) {
            document.removeEventListener('keydown', state.escHandler, true);
          }
          if (state.backdrop && state.backdrop.parentNode) {
            state.backdrop.parentNode.removeChild(state.backdrop);
          }
          dylistFallbackPopoverStates.delete(normalizedId);
          return true;
        };
        const buildStandardWorldGuidance = (world = {}, context = {}) => {
          const normalizedWorld = world && typeof world === 'object' ? { ...createDefaultWorldBucket(), ...world } : createDefaultWorldBucket();
          const emotionSignals = context?.emotionSignals || context?.entitySignals?.emotionState || context?.entityGuidance?.emotionState || {};
          const genreAffect = emotionSignals?.genreAffectSignals || context?.genreAffectSignals || {};
          const styleAffect = emotionSignals?.styleAffectSignals || context?.styleAffectSignals || {};
          const settingOntology = {
            primary: compactText(normalizedWorld?.settingOntology?.primary || normalizedWorld?.systemFocus || '', 80),
            secondary: normalizeArrayItems(normalizedWorld?.settingOntology?.secondary || []).slice(0, 4),
            era: compactText(normalizedWorld?.settingOntology?.era || '', 60),
            civilizationType: compactText(normalizedWorld?.settingOntology?.civilizationType || '', 80),
            techLevel: compactText(normalizedWorld?.settingOntology?.techLevel || '', 60),
            magicLevel: compactText(normalizedWorld?.settingOntology?.magicLevel || '', 60),
            supernaturalLevel: compactText(normalizedWorld?.settingOntology?.supernaturalLevel || '', 60),
            worldScale: compactText(normalizedWorld?.settingOntology?.worldScale || '', 60),
            socialOrder: compactText(normalizedWorld?.settingOntology?.socialOrder || '', 100),
            powerSystem: compactText(normalizedWorld?.settingOntology?.powerSystem || '', 100),
            realismMode: compactText(normalizedWorld?.settingOntology?.realismMode || '', 60),
            worldRuleStrictness: clampNumber(normalizedWorld?.settingOntology?.worldRuleStrictness, 0.65, 0, 1)
          };
          const baseGenreWeights = {
            romance: 0,
            mystery: 0,
            psychological: 0,
            political: 0,
            action: 0,
            relationship_drama: 0,
            tragedy: 0,
            comedy: 0,
            thriller: 0,
            confrontation: 0
          };
          normalizeArrayItems(normalizedWorld?.scenePressures || []).forEach((item) => {
            const text = String(item?.summary || item || '').toLowerCase();
            if (/romance|love|애정|연애|로맨/.test(text)) baseGenreWeights.romance += 0.18;
            if (/mystery|secret|의문|비밀|미스터/.test(text)) baseGenreWeights.mystery += 0.18;
            if (/politic|faction|세력|정치|권력/.test(text)) baseGenreWeights.political += 0.18;
            if (/fight|battle|action|전투|추격|액션/.test(text)) baseGenreWeights.action += 0.18;
            if (/confront|conflict|대립|갈등/.test(text)) baseGenreWeights.confrontation += 0.18;
          });
          const effectiveGenreWeights = Object.fromEntries(Object.entries(baseGenreWeights).map(([key, value]) => [
            key,
            clampNumber((value * 0.55) + (Number(genreAffect?.[key] || 0) * 0.45), 0, 0, 1)
          ]));
          const styleWeights = {
            realism: clampNumber(normalizedWorld?.styleWeights?.realism, 0.65, 0, 1),
            emotionalIntensity: clampNumber((Number(styleAffect?.emotionalIntensity || 0) * 0.45) + 0.35, 0.35, 0, 1),
            humor: clampNumber(styleAffect?.humor, 0.08, 0, 1),
            darkness: clampNumber((Number(styleAffect?.darkness || 0) * 0.45) + 0.18, 0.18, 0, 1),
            actionPace: clampNumber((Number(styleAffect?.actionPace || 0) * 0.45) + (effectiveGenreWeights.action * 0.35), 0.2, 0, 1),
            mysteryDensity: clampNumber(effectiveGenreWeights.mystery, 0, 0, 1),
            romanceTension: clampNumber(effectiveGenreWeights.romance, 0, 0, 1),
            socialPressure: clampNumber(effectiveGenreWeights.political + effectiveGenreWeights.relationship_drama, 0, 0, 1),
            worldRuleStrictness: settingOntology.worldRuleStrictness,
            introspection: clampNumber(styleAffect?.introspection, 0.35, 0, 1)
          };
          return {
            worldPressureHints: normalizeArrayItems([
              ...(normalizedWorld?.scenePressures || []),
              ...(normalizedWorld?.carryoverSignals || []),
              ...(normalizedWorld?.worldLimits || [])
            ]).slice(0, 8),
            activeWorldRules: normalizeArrayItems(normalizedWorld?.worldLimits || normalizedWorld?.codexSignals || []).slice(0, 8),
            settingOntology,
            narrativeGenreWeights: {
              primary: Object.entries(effectiveGenreWeights).sort((a, b) => b[1] - a[1])[0]?.[0] || '',
              secondary: Object.entries(effectiveGenreWeights).sort((a, b) => b[1] - a[1]).slice(1, 4).map(([key]) => key),
              weights: effectiveGenreWeights
            },
            styleWeights,
            effectiveGenreWeights,
            factionSignals: normalizeArrayItems(normalizedWorld?.factions || []).slice(0, 8),
            regionSignals: normalizeArrayItems(normalizedWorld?.regions || []).slice(0, 8),
            offscreenThreads: normalizeArrayItems(normalizedWorld?.offscreenThreads || []).slice(0, 8),
            timelineShifts: normalizeArrayItems([
              normalizedWorld?.timeline?.phaseShiftSummary,
              normalizedWorld?.timeline?.forecast,
              ...(normalizedWorld?.timeline?.foregroundSignals || [])
            ]).slice(0, 8),
            propagationRisks: normalizeArrayItems(normalizedWorld?.propagationRisks || normalizedWorld?.analysis?.warnings || []).slice(0, 8),
            settingViolationWarnings: normalizeArrayItems(normalizedWorld?.settingViolationWarnings || normalizedWorld?.analysis?.warnings || []).slice(0, 6),
            genreConflictWarnings: normalizeArrayItems(normalizedWorld?.genreConflictWarnings || []).slice(0, 6),
            confidence: clampNumber(normalizedWorld?.confidence || normalizedWorld?.analysis?.confidence, 0.66, 0, 1),
            evidenceRefs: normalizeArrayItems(normalizedWorld?.evidenceRefs || normalizedWorld?.analysis?.evidenceRefs || []).slice(0, 10)
          };
        };
        const buildWorldAuditReport = async (context = {}) => {
          const chatId = getRuntimeChatId(context);
          const bucket = await getChatBucket(chatId);
          const world = bucket?.world && typeof bucket.world === 'object'
            ? { ...createDefaultWorldBucket(), ...bucket.world }
            : buildWorldSignalSnapshot(context, getSettings());
          const guidance = buildStandardWorldGuidance(world, context);
          const settingTerms = /fantasy|sf|sci.?fi|modern|medieval|cyberpunk|post.?apoc|판타지|현대|중세|사이버|포스트|마법|초능력/i;
          const genreTerms = /romance|mystery|politic|psychological|action|tragedy|comedy|thriller|로맨|미스터|정치|심리|액션|비극|희극|스릴러/i;
          const styleTerms = /dark|humor|intensity|realism|pace|tone|어두|유머|강도|현실|속도|문체|톤/i;
          const settingConflicts = [];
          const genreStyleMixingWarnings = [];
          const timelineConflicts = [];
          const factionConflicts = [];
          const regionConflicts = [];
          const offscreenRisks = [];
          const hardCanonRisks = [];
          const lowConfidenceWorldHints = [];
          const checkText = (value = '') => compactText(value, 220);
          const settingPrimary = checkText(guidance?.settingOntology?.primary || '');
          if (settingPrimary && genreTerms.test(settingPrimary)) {
            settingConflicts.push({ field: 'settingOntology.primary', value: settingPrimary, reason: 'genre_term_in_setting_layer' });
          }
          Object.keys(guidance?.narrativeGenreWeights?.weights || {}).forEach((key) => {
            if (settingTerms.test(key)) {
              genreStyleMixingWarnings.push({ field: `narrativeGenreWeights.${key}`, reason: 'setting_term_in_genre_layer' });
            }
          });
          Object.keys(guidance?.styleWeights || {}).forEach((key) => {
            if (settingTerms.test(key) || genreTerms.test(key)) {
              genreStyleMixingWarnings.push({ field: `styleWeights.${key}`, reason: 'setting_or_genre_term_in_style_layer' });
            }
          });
          normalizeArrayItems(guidance?.worldPressureHints || []).forEach((item) => {
            const text = checkText(item?.summary || item || '');
            if (/final directive|director mandate|must force|absolute scene|최종 지시|감독 명령|강제 전환/i.test(text)) {
              hardCanonRisks.push({ source: 'worldPressureHints', text, reason: 'world_hint_reads_like_final_directive' });
            }
            if (styleTerms.test(text) && settingTerms.test(text) && genreTerms.test(text)) {
              genreStyleMixingWarnings.push({ field: 'worldPressureHints', value: text, reason: 'mixed_setting_genre_style_language' });
            }
          });
          normalizeArrayItems(guidance?.timelineShifts || []).forEach((item) => {
            const text = checkText(item?.summary || item || '');
            if (/immediate.*years|same turn.*days|순간.*며칠|즉시.*몇 년|시간.*모순/i.test(text)) {
              timelineConflicts.push({ text, reason: 'possible_time_jump_conflict' });
            }
          });
          normalizeArrayItems(guidance?.factionSignals || []).forEach((item) => {
            const text = checkText(item?.summary || item?.name || item || '');
            if (/unknown.*controls|controls.*unknown|소속.*불명|지배.*불명/i.test(text)) {
              factionConflicts.push({ text, reason: 'ambiguous_faction_control' });
            }
          });
          normalizeArrayItems(guidance?.regionSignals || []).forEach((item) => {
            const text = checkText(item?.summary || item?.name || item || '');
            if (/same place.*different|동일 장소.*다른|위치.*충돌/i.test(text)) {
              regionConflicts.push({ text, reason: 'ambiguous_region_identity' });
            }
          });
          normalizeArrayItems(guidance?.offscreenThreads || []).forEach((item) => {
            const text = checkText(item?.summary || item?.title || item || '');
            if (/resolved|confirmed|canon|확정|정본|해결됨/i.test(text) && !normalizeArrayItems(guidance?.evidenceRefs || []).length) {
              offscreenRisks.push({ text, reason: 'offscreen_thread_has_no_evidence_ref' });
            }
          });
          if (Number(guidance?.confidence || 0) < 0.45) {
            lowConfidenceWorldHints.push({ field: 'worldGuidance', confidence: Number(guidance?.confidence || 0) });
          }
          const checkedWorldSignals = normalizeArrayItems([
            ...(guidance?.worldPressureHints || []),
            ...(guidance?.activeWorldRules || []),
            ...(guidance?.factionSignals || []),
            ...(guidance?.regionSignals || []),
            ...(guidance?.offscreenThreads || []),
            ...(guidance?.timelineShifts || [])
          ]).length;
          const report = {
            ok: true,
            source: 'world_core_x_audit',
            chatId,
            checkedWorldSignals,
            settingConflicts,
            timelineConflicts,
            factionConflicts,
            regionConflicts,
            offscreenRisks,
            genreStyleMixingWarnings,
            hardCanonRisks,
            lowConfidenceWorldHints,
            recommendedRepairs: normalizeArrayItems([
              settingConflicts.length ? 'separate_setting_ontology_from_narrative_genre' : '',
              genreStyleMixingWarnings.length ? 'normalize_world_profile_layers' : '',
              timelineConflicts.length ? 'route_time_conflicts_through_v4_scene_contract' : '',
              hardCanonRisks.length ? 'downgrade_world_outputs_to_pressure_hints' : '',
              offscreenRisks.length ? 'attach_evidence_refs_before_offscreen_canon'
                : ''
            ]).slice(0, 8),
            confidence: clampNumber(
              1 - ((settingConflicts.length + timelineConflicts.length + genreStyleMixingWarnings.length + hardCanonRisks.length) / Math.max(1, checkedWorldSignals + 4)),
              0.72,
              0,
              1
            ),
            worldProfile: {
              settingOntologyStatus: settingConflicts.length ? 'warning' : 'ok',
              genreWeightStatus: genreStyleMixingWarnings.length ? 'warning' : 'ok',
              worldSignals: checkedWorldSignals,
              evidenceRefs: normalizeArrayItems(guidance?.evidenceRefs || []).length
            },
            ranAt: Date.now()
          };
          updateRuntimeStatus(`World audit complete · signals ${checkedWorldSignals} · warnings ${settingConflicts.length + timelineConflicts.length + genreStyleMixingWarnings.length + hardCanonRisks.length}`, {
            chatId,
            audit: report
          });
          reportCoordinatorRuntime({
            phase: 'world-audit',
            domain: 'world',
            activeChatId: chatId,
            worldSignals: checkedWorldSignals,
            settingOntologyStatus: report.worldProfile.settingOntologyStatus,
            genreWeightStatus: report.worldProfile.genreWeightStatus,
            analysisFailureCount: runtimeState.analysisFailureCount,
            auditWarnings: settingConflicts.length + timelineConflicts.length + genreStyleMixingWarnings.length + hardCanonRisks.length
          });
          return report;
        };
        const worldCoreXApi = {
          openPopover: (popoverId) => {
            if (typeof document === 'undefined') return false;
            const normalizedId = String(popoverId || '').trim();
            const node = document.getElementById(normalizedId);
            if (!node) return false;
            closeFallbackPopover(normalizedId, node);
            try {
              if (typeof node.showPopover === 'function') {
                node.showPopover();
                return true;
              }
            } catch (_) {}
            return openFallbackPopover(normalizedId, node);
          },
          closePopover: (popoverId) => {
            if (typeof document === 'undefined') return false;
            const normalizedId = String(popoverId || '').trim();
            const node = document.getElementById(normalizedId);
            if (closeFallbackPopover(normalizedId, node)) return true;
            if (!node) return false;
            try {
              if (typeof node.hidePopover === 'function') {
                node.hidePopover();
                return true;
              }
            } catch (_) {}
            node.style.display = 'none';
            node.removeAttribute('data-dylist-open');
            return true;
          },
          saveFromPanel: async (trigger) => {
            const root = getSettingsPanelRoot(trigger);
            if (!root) return false;
            const patch = readSettingsFromPanel(root);
            const saved = await saveSettingsPatch(patch);
            syncSettingsPanelPreview(root, saved, 'DyList 설정을 저장했습니다.');
            const isExplicitSave = Boolean(trigger?.matches?.('[data-dylist-explicit-save="true"]'));
            if (isExplicitSave) notifyDyListToast('💾 DyList 설정 저장됨');
            return true;
          },
          configureAnalysisProvider: async (config = {}) => {
            const current = normalizeAnalysisProviderSettings(getSettings().analysisProvider || {});
            return saveSettingsPatch({
              analysisProvider: {
                ...current,
                ...(config && typeof config === 'object' ? config : {}),
                stages: {
                  ...current.stages,
                  ...(config?.stages && typeof config.stages === 'object' ? config.stages : {})
                }
              }
            });
          },
          saveAnalysisProviderFromPanel: async (trigger = null, explicitSave = false) => {
            const root = getAnalysisProviderPanelRoot(trigger);
            if (!root) return false;
            const analysisProvider = readAnalysisProviderSettingsFromPanel(root);
            const saved = await saveSettingsPatch({ analysisProvider });
            writeAnalysisProviderSettingsToPanel(root, saved.analysisProvider || {});
            syncAnalysisProviderPanelPreview(root, saved.analysisProvider || {}, 'Analysis provider settings saved.');
            if (explicitSave) notifyDyListToast('🧠 World Core X analysis settings saved');
            return true;
          },
          resetAnalysisProviderPanel: async (trigger = null) => {
            const root = getAnalysisProviderPanelRoot(trigger);
            const defaults = normalizeAnalysisProviderSettings(DEFAULT_SETTINGS.analysisProvider || {});
            const saved = await saveSettingsPatch({ analysisProvider: defaults });
            if (root) {
              writeAnalysisProviderSettingsToPanel(root, saved.analysisProvider || defaults);
              syncAnalysisProviderPanelPreview(root, saved.analysisProvider || defaults, 'Analysis provider reset to defaults.');
            }
            return true;
          },
          toggleQuick: async (key, checked, trigger) => {
            const root = getSettingsPanelRoot(trigger);
            if (!root) return false;
            const normalizedKey = String(key || '').trim();
            if (normalizedKey === 'compactPreset') {
              const patch = checked
                ? buildPresetSettings('compact')
                : buildPresetSettings('default');
              const saved = await saveSettingsPatch(patch);
              root.querySelectorAll('[data-dylist-setting="maxHistoryItems"]').forEach(node => { node.value = String(saved.maxHistoryItems); });
              root.querySelectorAll('[data-dylist-setting="maxDisplayHistory"]').forEach(node => { node.value = String(saved.maxDisplayHistory); });
              root.querySelectorAll('[data-dylist-setting="maxRecentHistory"]').forEach(node => { node.value = String(saved.maxRecentHistory); });
              root.querySelectorAll('[data-dylist-toggle="showGroupAxisDescriptions"]').forEach(node => { node.checked = Boolean(saved.showGroupAxisDescriptions); });
              root.querySelectorAll('[data-dylist-history-template]').forEach((node) => {
                const tKey = String(node.getAttribute('data-dylist-history-template') || '').trim();
                node.value = String(saved.historyTemplates?.[tKey] || '');
              });
              root.querySelectorAll('[data-dylist-group-axis]').forEach((node) => {
                const axisKey = String(node.getAttribute('data-dylist-group-axis') || '').trim();
                node.value = String((saved.groupAxisDescriptions?.[axisKey] || []).join(' · '));
              });
              syncSettingsPanelPreview(root, saved, checked ? 'Compact 모드 ON' : 'Compact 모드 OFF (기본값 복귀)');
              return true;
            }
            const boolKeyMap = {
              showGroupAxisDescriptions: 'showGroupAxisDescriptions',
              dlMaleTrack: 'dlMaleTrack'
            };
            if (boolKeyMap[normalizedKey]) {
              const patch = { [boolKeyMap[normalizedKey]]: Boolean(checked) };
              const saved = await saveSettingsPatch(patch);
              syncSettingsPanelPreview(root, saved, `${normalizedKey} ${checked ? 'ON' : 'OFF'}`);
              return true;
            }
            return worldCoreXApi?.saveFromPanel?.(trigger);
          },
          setHistoryProfile: async (profileName, trigger) => {
            const root = getSettingsPanelRoot(trigger);
            if (!root) return false;
            const patch = buildPresetSettings(String(profileName || 'standard'));
            const saved = await saveSettingsPatch(patch);
            root.querySelectorAll('[data-dylist-setting="maxHistoryItems"]').forEach(node => { node.value = String(saved.maxHistoryItems); });
            root.querySelectorAll('[data-dylist-setting="maxDisplayHistory"]').forEach(node => { node.value = String(saved.maxDisplayHistory); });
            root.querySelectorAll('[data-dylist-setting="maxRecentHistory"]').forEach(node => { node.value = String(saved.maxRecentHistory); });
            syncSettingsPanelPreview(root, saved, `History profile: ${profileName}`);
            return true;
          },
          setTrackLimitPreset: async (presetName, trigger) => {
            const root = getSettingsPanelRoot(trigger);
            if (!root) return false;
            const nextValue = TRACK_LIMIT_PRESETS[String(presetName || 'unlimited')] ?? 0;
            const saved = await saveSettingsPatch({ dlCharTrackLimit: nextValue });
            root.querySelectorAll('[data-dylist-setting="dlCharTrackLimit"]').forEach(node => { node.value = String(saved.dlCharTrackLimit); });
            syncSettingsPanelPreview(root, saved, `Track scope: ${presetName}`);
            return true;
          },
          applyPreset: async (presetName, trigger) => {
            const root = getSettingsPanelRoot(trigger);
            if (!root) return false;
            const patch = buildPresetSettings(String(presetName || 'default'));
            const saved = await saveSettingsPatch(patch);
            root.querySelectorAll('[data-dylist-setting="maxHistoryItems"]').forEach(node => { node.value = String(saved.maxHistoryItems); });
            root.querySelectorAll('[data-dylist-setting="maxDisplayHistory"]').forEach(node => { node.value = String(saved.maxDisplayHistory); });
            root.querySelectorAll('[data-dylist-setting="maxRecentHistory"]').forEach(node => { node.value = String(saved.maxRecentHistory); });
            root.querySelectorAll('[data-dylist-toggle="showGroupAxisDescriptions"]').forEach(node => { node.checked = Boolean(saved.showGroupAxisDescriptions); });
            root.querySelectorAll('[data-dylist-history-template]').forEach((node) => {
              const key = String(node.getAttribute('data-dylist-history-template') || '').trim();
              node.value = String(saved.historyTemplates?.[key] || '');
            });
            root.querySelectorAll('[data-dylist-group-axis]').forEach((node) => {
              const axisKey = String(node.getAttribute('data-dylist-group-axis') || '').trim();
              node.value = String((saved.groupAxisDescriptions?.[axisKey] || []).join(' · '));
            });
            syncSettingsPanelPreview(root, saved, `프리셋 ${presetName} 적용 완료`);
            return true;
          },
          refreshBackgroundOnly: async (context = {}) => {
            return refreshBackgroundOnly(context);
          },
          analyzeWorld: async (context = {}, options = {}) => {
            return runManualWorldAnalysis(context, options);
          },
          receiveBootstrapSeed: async (bundle = {}, context = {}) => {
            const chatId = getRuntimeChatId(context || bundle || {});
            const worldSeed = bundle?.worldSeedProposals && typeof bundle.worldSeedProposals === 'object'
              ? bundle.worldSeedProposals
              : {};
            const rules = normalizeArrayItems(worldSeed?.rules || []);
            runtimeState.lastBootstrapSeed = {
              source: compactText(bundle?.source || 'bootstrap', 80),
              chatId,
              worldRules: rules.length,
              tech: compactText(worldSeed?.tech || '', 80),
              confidence: clampNumber(worldSeed?.confidence || bundle?.confidence, 0.55, 0, 1),
              receivedAt: Date.now()
            };
            updateRuntimeStatus(`Bootstrap seed received · world rules ${rules.length}`, {
              chatId,
              bootstrapSeed: runtimeState.lastBootstrapSeed
            });
            reportCoordinatorRuntime({
              phase: 'bootstrap-seed',
              domain: 'world',
              activeChatId: chatId,
              worldSignals: rules.length,
              settingOntologyStatus: 'seed_only',
              genreWeightStatus: 'seed_only',
              analysisFailureCount: runtimeState.analysisFailureCount
            });
            return safeJsonParse(JSON.stringify({
              ok: true,
              chatId,
              acceptedAs: 'seed_proposal',
              worldRules: rules.length,
              tech: runtimeState.lastBootstrapSeed.tech
            }), null);
          },
          runAudit: async (context = {}) => {
            await importBucketFromCopiedChatIfNeeded(context, getRuntimeChatId(context));
            const report = await buildWorldAuditReport(context);
            return safeJsonParse(JSON.stringify(report), report);
          },
          getWorldGuidance: async (context = {}) => {
            const bucket = await worldCoreXApi.loadChatBucket(context);
            const world = bucket?.world && typeof bucket.world === 'object'
              ? { ...createDefaultWorldBucket(), ...bucket.world }
              : buildWorldSignalSnapshot(context, getSettings());
            return safeJsonParse(JSON.stringify(buildStandardWorldGuidance(world, context)), null);
          },
          getWorldPressureHints: async (context = {}) => {
            const guidance = await worldCoreXApi.getWorldGuidance(context);
            return safeJsonParse(JSON.stringify(guidance?.worldPressureHints || []), []);
          },
          getRuntimeStatus: () => safeJsonParse(JSON.stringify(runtimeState), runtimeState),
          rebuild: async (context = {}) => rebuildExtensionState(withPhaseContext(context, 'rebuild-api')),
          finalizeTurn: async (context = {}) => rebuildExtensionState(withPhaseContext(context, 'finalize-api')),
          cleanup: async () => window.__LIBRA_WORLD_CORE_X_RUNTIME__?.cleanup?.(),
          selfCheck: async () => ({
            ok: true,
            api: 'LIBRA_WorldCoreXAPI',
            methods: ['getWorldGuidance', 'getWorldPressureHints', 'getRuntimeStatus', 'rebuild', 'finalizeTurn', 'cleanup'],
            runtime: safeJsonParse(JSON.stringify(runtimeState), runtimeState)
          }),
          peekWorldGuidance: (context = {}) => {
            const world = worldCoreXApi.peekWorldSnapshot(context);
            return safeJsonParse(JSON.stringify(buildStandardWorldGuidance(world, context)), null);
          },
          peekChatBucket: (options = {}) => {
            const chatId = typeof options === 'string'
              ? String(options || 'global').trim() || 'global'
              : getRuntimeChatId(options);
            const bucket = persistedState?.chats?.[chatId] && typeof persistedState.chats[chatId] === 'object'
              ? persistedState.chats[chatId]
              : {};
            const normalized = {
              ...bucket,
              entities: bucket?.entities && typeof bucket.entities === 'object' ? bucket.entities : {},
              groups: bucket?.groups && typeof bucket.groups === 'object' ? bucket.groups : {},
              world: bucket?.world && typeof bucket.world === 'object'
                ? { ...createDefaultWorldBucket(), ...bucket.world }
                : createDefaultWorldBucket(),
              background: bucket?.background && typeof bucket.background === 'object'
                ? bucket.background
                : { entities: [], groups: [], updatedTurn: 0, updatedDate: '', mode: 'off', scope: 'recently_exited', contextMode: 'indirect', hints: '', history: [] }
            };
            return safeJsonParse(JSON.stringify(normalized), normalized);
          },
          loadChatBucket: async (options = {}) => {
            const chatId = typeof options === 'string'
              ? String(options || 'global').trim() || 'global'
              : getRuntimeChatId(options);
            if (typeof options !== 'string') await importBucketFromCopiedChatIfNeeded(options, chatId);
            const bucket = await getChatBucket(chatId);
            return safeJsonParse(JSON.stringify(bucket), bucket);
          },
          exportChatBucket: async (options = {}) => {
            const chatId = typeof options === 'string'
              ? String(options || 'global').trim() || 'global'
              : getRuntimeChatId(options);
            if (typeof options !== 'string') await importBucketFromCopiedChatIfNeeded(options, chatId);
            const bucket = await getChatBucket(chatId);
            return safeJsonParse(JSON.stringify(bucket), bucket);
          },
          importFromCopiedChat: async (options = {}) => {
            const targetChatId = compactText(options?.targetChatId || options?.chatId || options?.scopeId || getRuntimeChatId(options), 120) || 'global';
            const sourceChatId = compactText(options?.sourceChatId || options?.copiedFromChatId || options?.sourceScopeId || options?.copiedFromScopeId || '', 120);
            return importBucketFromCopiedChatIfNeeded({
              ...options,
              chatId: targetChatId,
              copiedFromChatId: sourceChatId,
              sourceChatId
            }, targetChatId);
          },
          importChatBucket: async (options = {}) => {
            const chatId = getRuntimeChatId(options);
            const bucket = await replaceChatBucket(chatId, options?.bucket || {}, {
              mode: options?.mode || 'carryover'
            });
            runtimeState.activeChatId = chatId;
            updateRuntimeStatus(`Chat bucket imported · ${chatId}`, {
              chatId,
              mode: options?.mode || 'carryover'
            });
            reportCoordinatorRuntime({
              phase: 'chat-bucket-import',
              domain: 'world',
              activeChatId: chatId,
              worldSignals: normalizeArrayItems(bucket?.world?.scenePressures || []).length
            });
            return safeJsonParse(JSON.stringify(bucket), bucket);
          },
          peekWorldSnapshot: (context = {}) => {
            const bucket = worldCoreXApi.peekChatBucket(context);
            const stored = bucket?.world && typeof bucket.world === 'object'
              ? { ...createDefaultWorldBucket(), ...bucket.world }
              : createDefaultWorldBucket();
            const hasStoredWorld = Boolean(
              stored.sceneSummary
              || stored.scenePressures?.length
              || stored.carryoverSignals?.length
              || stored.relationSignals?.length
              || stored.worldLimits?.length
              || stored.codexSignals?.length
              || stored.factions?.length
              || stored.offscreenThreads?.length
              || stored.regions?.length
            );
            const snapshot = hasStoredWorld ? stored : buildWorldSignalSnapshot(context, getSettings());
            return safeJsonParse(JSON.stringify(snapshot), snapshot);
          },
          peekPromptSnapshot: (context = {}) => {
            const bucket = worldCoreXApi.peekChatBucket(context);
            const section = buildWorldPromptSection(context, bucket, getSettings());
            return safeJsonParse(JSON.stringify(section), section);
          }
        };
        window.LIBRA_WorldCoreXAPI = worldCoreXApi;
        window.LIBRA_DyListCoreAPI = worldCoreXApi;
        window.LIBRA = window.LIBRA || {};
        window.LIBRA.WorldCoreX = worldCoreXApi;
        window.__LIBRA_WORLD_CORE_X_RUNTIME__ = {
          cleanup() {
            if (typeof document !== 'undefined') {
              if (dylistPanelClickHandler) document.removeEventListener('click', dylistPanelClickHandler, true);
              if (dylistPanelChangeHandler) document.removeEventListener('change', dylistPanelChangeHandler, true);
              if (dylistPanelInputHandler) document.removeEventListener('input', dylistPanelInputHandler, true);
              if (analysisPanelClickHandler) document.removeEventListener('click', analysisPanelClickHandler, true);
              if (analysisPanelChangeHandler) document.removeEventListener('change', analysisPanelChangeHandler, true);
              if (analysisPanelInputHandler) document.removeEventListener('input', analysisPanelInputHandler, true);
            }
            settingsPanelHandlersBound = false;
            analysisPanelHandlersBound = false;
            dylistPanelClickHandler = null;
            dylistPanelChangeHandler = null;
            dylistPanelInputHandler = null;
            analysisPanelClickHandler = null;
            analysisPanelChangeHandler = null;
            analysisPanelInputHandler = null;
            dylistFallbackPopoverStates.forEach((state, popoverId) => {
              try {
                state?.escHandler && document.removeEventListener('keydown', state.escHandler, true);
              } catch (_) {}
              try {
                const node = typeof document !== 'undefined' ? document.getElementById(popoverId) : null;
                if (node) {
                  node.style.display = 'none';
                  node.removeAttribute('data-dylist-open');
                }
              } catch (_) {}
              try {
                state?.backdrop?.parentNode?.removeChild?.(state.backdrop);
              } catch (_) {}
            });
            dylistFallbackPopoverStates.clear();
            try { delete window.LIBRA_WorldCoreXAPI; } catch (_) {}
            try { delete window.LIBRA_DyListCoreAPI; } catch (_) {}
            try { if (window.LIBRA?.WorldCoreX === worldCoreXApi) delete window.LIBRA.WorldCoreX; } catch (_) {}
            try {
              const host = window?.LIBRA?.ExtensionHost || window?.LIBRA_ExtensionHost;
              if (host?.unregisterExtension) host.unregisterExtension(PLUGIN_ID);
            } catch (_) {}
          }
        };
        window.__LIBRA_DYLIST_CORE_RUNTIME__ = window.__LIBRA_WORLD_CORE_X_RUNTIME__;
      }
      console.log(`${LOG_PREFIX} ready`);
    }
  };

  const tryRegister = () => {
    const host = typeof window !== 'undefined' ? window.LIBRA?.ExtensionHost || window.LIBRA_ExtensionHost : null;
    if (!host || typeof host.registerExtension !== 'function') return false;
    host.registerExtension(definition);
    return true;
  };

  const invokeReadyIfPossible = async (definitionRef) => {
    try {
      const LIBRA = window?.LIBRA || globalThis?.LIBRA || null;
      if (LIBRA && typeof definitionRef?.onLibraReady === 'function' && definitionRef.__libraReadyInvoked !== true) {
        definitionRef.__libraReadyInvoked = true;
        await definitionRef.onLibraReady({ LIBRA });
        return true;
      }
    } catch (error) {
      try { console.warn('[LIBRA World Core X] onLibraReady immediate invoke failed:', error); } catch (_) {}
      try { definitionRef.__libraReadyInvoked = false; } catch (_) {}
    }
    return false;
  };

  const registered = tryRegister();
  if (registered) {
    const host = typeof window !== 'undefined' ? window.LIBRA?.ExtensionHost || window.LIBRA_ExtensionHost : null;
    if (!host?.getRuntimeReports) void invokeReadyIfPossible(definition);
  }

  if (!registered && typeof window !== 'undefined') {
    window.LIBRA_SubPlugins = Array.isArray(window.LIBRA_SubPlugins) ? window.LIBRA_SubPlugins : [];
    window.LIBRA_SubPlugins.push(definition);
  }
})();
