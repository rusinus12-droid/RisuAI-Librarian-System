# LIBRA World Manager

RisuAI용 장기 컨텍스트 관리 플러그인입니다.  
메모리, 엔티티, 관계, 세계관, 내러티브, 세션 전환, 로어북 동적 참조, 감정 분석, 스토리 작가 개입을 한 시스템으로 묶어 관리합니다.

## 핵심 기능

- 메모리 저장 / 검색 / GC / 롤백
- 엔티티 / 관계 추출 및 추적
- 세계관 트리 및 세계 규칙 관리
- 내러티브 추적 및 storyline 요약
- 스토리 작가 개입 기능
- 과거 대화 분석 Cold Start
- Hypa V3 지식 가져오기 및 구조화 반영
- 다음 세션으로 대화 이어가기
- 로어북 동적 참조(RAG)
- 감정 분석
- CBS / GigaTrans / Lightboard 호환

## 주요 구조

- `lmai_memory`: 일반 기억
- `lmai_entity`: 인물/엔티티 정보
- `lmai_relation`: 관계 정보
- `lmai_world_graph`: 세계관 트리
- `lmai_narrative`: 진행 중인 줄거리 정보
- `lmai_story_author`: 스토리 작가 계획
- `lmai_char_states`: 캐릭터 상태 추적
- `lmai_world_states`: 세계 상태 추적

## GUI에서 할 수 있는 것

- 메모리 조회 / 편집 / 삭제
- 엔티티 / 관계 조회 / 편집 / 추가 / 삭제
- 내러티브 storyline 조회 / 편집 / 추가 / 저장
- 세계관 트리 및 규칙 확인
- 과거 대화 분석 실행
- Hypa V3 → 로어북 가져오기
- 다음 세션으로 대화 이어가기
- LLM / 임베딩 / 메모리 / 고급 설정 변경

GUI는 반응형으로 구성되어 있어 모바일 환경이나 좁은 창에서는 세로 모드에 맞춰 자동 재배치됩니다.

- 헤더 / 탭 / 툴바 / 액션 버튼이 세로 친화적으로 재배치
- 설정 2열 그리드가 1열 레이아웃으로 전환
- 좁은 폭에서는 탭이 3열 또는 2열 그리드로 축소
- 패널 스크롤이 터치 환경에 맞게 최적화

## 스토리 작가 기능

`고급 > 스토리 작가 모드`에서 제어합니다.

- `비활성`: 작가 개입 없음
- `서포트형`: 보조적으로만 전개 유도
- `주도형`: 기본 추천
- `강공형`: 장면 정체를 줄이고 적극적으로 다음 비트를 밀어줌

작가 기능이 켜져 있으면 LIBRA는 다음 정보를 종합해 메인 AI에게 서사 지침을 추가합니다.

- 메모리
- 엔티티 / 관계
- 세계관
- 내러티브
- 캐릭터 상태
- 세계 상태
- 로어북

유저 입력이 비어 있어도, 작가 기능이 켜져 있으면 현재 장면을 최소 한 박자 전진시키도록 유도합니다.

## 세션 전환

`다음 세션으로 대화 이어가기`를 사용하면 다음 항목이 새 채팅방으로 계승됩니다.

- 메모리
- 엔티티 / 관계
- 세계관
- 내러티브
- 스토리 작가 상태
- 캐릭터 상태 / 세계 상태
- 직전 상황 요약

첫 AI 인사말은 컨텍스트 오염 방지를 위해 예외적으로 격리 처리됩니다.

## LLM / 임베딩 지원

### LLM

- OpenAI
- Claude
- Gemini
- OpenRouter
- Vertex AI
- Copilot
- Custom(OpenAI-compatible)

### Embedding

- OpenAI
- Gemini
- Vertex AI
- VoyageAI
- Custom(OpenAI-compatible)

기본 타임아웃은 LLM / 임베딩 모두 `120000ms`입니다.

## 추론 설정

- `Reasoning Effort`
- `Reasoning Budget Tokens`

provider마다 반영 방식이 다릅니다.

- OpenAI 계열: `reasoning_effort`
- Claude: `thinking.budget_tokens`
- Gemini / Vertex: `thinkingConfig.thinkingBudget`

## 디버그

`설정 > 플러그인 기능 > 디버그 모드`를 켜면 콘솔에 다음 로그가 찍힙니다.

- LLM 호출 시작 / 성공 / 실패
- 임베딩 호출 시작 / 성공 / 캐시 히트
- maintenance queue 상태
- background maintenance 완료 시간
- 메시지 tracker remap

예시:

```text
[LIBRA][LLM] start | label=generic | provider=openai | model=gpt-4o-mini | url=...
[LIBRA][LLM] success | label=generic | provider=openai | duration=1820ms | contentChars=742
[LIBRA][EMBED] success | provider=openai | duration=240ms | dims=1536
```

## 권장 사용 흐름

1. LLM / 임베딩 설정 입력
2. 메모리 프리셋 선택
3. 필요하면 과거 대화 분석 실행
4. 필요하면 Hypa V3 지식 가져오기
5. 스토리 작가 모드 설정
6. 모바일이나 좁은 창에서도 GUI를 열어 바로 편집 가능
7. 긴 서사는 세션 전환으로 이어가기

## 실제 설정 예시

### 1. 일반적인 OpenAI 구성

- LLM Provider: `openai`
- LLM URL: `https://api.openai.com`
- LLM Model: `gpt-4o-mini`
- Temperature: `0.3`
- Timeout: `120000`
- Reasoning Effort: `none`
- Reasoning Budget Tokens: `0`

- Embedding Provider: `openai`
- Embedding URL: `https://api.openai.com`
- Embedding Model: `text-embedding-3-small`
- Timeout: `120000`

- 메모리 프리셋: `general`
- 스토리 작가 모드: `비활성` 또는 `주도형`

### 2. 로맨스 / 생활 시뮬레이션 구성

- LLM Provider: `openai` 또는 `claude`
- Model: `gpt-4o-mini` / `claude-sonnet` 계열
- Temperature: `0.4`
- Weight Mode: `romance`
- 메모리 프리셋: `sim_small` 또는 `sim_medium`
- 감정 분석: `ON`
- 로어북 동적 참조: `ON`
- 스토리 작가 모드: `주도형`

### 3. 장기 시뮬 / 세계관 중심 구성

- LLM Provider: `claude`, `gemini`, `vertex`, `openrouter`
- Temperature: `0.2 ~ 0.4`
- 메모리 프리셋: `sim_medium` 또는 `sim_large`
- 과거 대화 분석 범위: `부분(300)` 또는 `전체`
- 세계관 조정 모드: `dynamic`
- 스토리 작가 모드: `주도형` 또는 `강공형`

### 4. 보수적인 보조 메모리 구성

- 스토리 작가 모드: `비활성`
- Weight Mode: `auto`
- 메모리 프리셋: `general`
- 감정 분석: `ON`
- CBS / 로어북 동적 참조: 필요 시만 `ON`

## Provider별 추천값

### OpenAI

- 추천 용도: 범용, 빠른 응답, 안정적인 기본값
- LLM URL: `https://api.openai.com`
- 추천 모델:
  - 가성비: `gpt-4o-mini`
  - 더 강한 품질: 상위 GPT 계열
- Temperature: `0.2 ~ 0.4`
- Reasoning Effort:
  - 일반 RP: `none`
  - 복잡한 추론: `medium`
- Embedding: `text-embedding-3-small`

### Claude

- 추천 용도: 긴 문맥, 문장 품질, 섬세한 감정선
- LLM URL: `https://api.anthropic.com`
- 추천 모델: Sonnet 계열
- Temperature: `0.2 ~ 0.5`
- Reasoning Budget Tokens:
  - 일반 RP: `0`
  - 복잡한 분석: `1024+`
- 메모리 프리셋: `sim_medium` 이상 권장

### Gemini

- 추천 용도: 긴 입력 처리, 다양한 설정 실험
- LLM URL: `https://generativelanguage.googleapis.com/v1beta`
- Embedding URL: `https://generativelanguage.googleapis.com/v1beta`
- Temperature: `0.2 ~ 0.4`
- Reasoning Budget Tokens: 필요 시만 사용
- 메모리 프리셋: `general` ~ `sim_medium`

### Vertex AI

- 추천 용도: Google Cloud 환경, 엔터프라이즈형 운영
- LLM URL: full Vertex generateContent endpoint
- Embedding URL: full Vertex predict endpoint
- 인증: API key가 아니라 유효한 Bearer token 성격의 access token 사용
- Temperature: `0.2 ~ 0.4`
- Reasoning Budget Tokens: 필요 시 사용

### OpenRouter

- 추천 용도: 여러 모델을 한 URL 체계에서 교체하며 사용
- LLM URL: `https://openrouter.ai/api`
- Temperature: 모델별 권장값 따름
- Weight Mode / 메모리 프리셋은 모델 성향과 별개로 조정

### Copilot

- 추천 용도: 이미 GitHub / Copilot 환경을 쓰는 경우
- LLM URL: Copilot chat completions endpoint base
- 필수: GitHub token 기반 인증
- 주의: 모델명 일부는 내부적으로 호환 모델로 매핑될 수 있음

### Custom (OpenAI-compatible)

- 추천 용도: GLM, LM Studio, vLLM, OpenAI-compatible gateway
- 조건: OpenAI 호환 `chat/completions`, `embeddings` 형식 지원
- URL:
  - LLM: base URL 또는 chat completions endpoint
  - Embedding: base URL 또는 embeddings endpoint
- Reasoning Effort는 서버가 OpenAI식 파라미터를 받아줄 때만 의미 있음

## 빠른 추천 조합

### 가장 무난한 기본값

- LLM: `OpenAI / gpt-4o-mini`
- Embedding: `OpenAI / text-embedding-3-small`
- 메모리 프리셋: `general`
- 스토리 작가 모드: `비활성`

## 버전 변경사항

### v2.4.0 -> v2.4.1

Copilot의 GPT-4.1, OpenAI-compatible 계열 모델, 그 외 일부 추론형 LLM이 응답에 내부 사고 태그를 포함할 때, 해당 태그가 메모리/요약/구조화 추출 파이프라인에 섞여 저장되던 문제를 수정했습니다.

대표적으로 아래와 같은 태그를 제거합니다.

- `<thoughts> ... </thoughts>`
- `<thinking> ... </thinking>`
- `<__filter_complete__>`

핵심 수정 내용:

- `Utils.stripLLMThinkingTags()` 추가
- `sanitizeForLibra()`에서 메인 응답 저장 전 사고 태그 제거
- `extractJson()`에서 JSON 파싱 전 사고 태그 제거
- `CharacterStateTracker.consolidateIfNeeded()`에서 캐릭터 상태 통합 전 보호
- `WorldStateTracker.consolidateIfNeeded()`에서 세계 상태 통합 전 보호
- `EntityAwareProcessor.extractFromConversation()`에서 구조화 추출 전 보호

추가 보완:

- 세션 전환 시 직전 상황 요약(`sceneSummary`) 생성 경로에서도 사고 태그를 제거하도록 보완
- 태그 제거 후 빈 문자열이 되면 태그가 포함된 원문으로 되돌아가지 않도록 유지

효과:

- 메모리에 내부 사고 태그가 그대로 남는 현상 완화
- 요약 JSON 파싱 안정성 향상
- 상태 통합 및 엔티티 추출 정확도 향상
- 세션 전환 시 다음 방에 불필요한 내부 태그가 전파되는 문제 완화

### 장기 RP / 서사형 추천

- LLM: `Claude Sonnet` 또는 강한 GPT 계열
- Embedding: `OpenAI text-embedding-3-small`
- 메모리 프리셋: `sim_medium`
- 과거 대화 분석: `부분(300)`
- 스토리 작가 모드: `주도형`

### 강한 전개 유도 추천

- 메모리 프리셋: `sim_large`
- Weight Mode: `romance` / `mystery` / `action` 중 장르에 맞게
- 감정 분석: `ON`
- 로어북 동적 참조: `ON`
- 스토리 작가 모드: `강공형`

## 현재 특징

- 기본 보조 기능만 원하면: 스토리 작가 모드를 `비활성`
- 적극적인 서사 개입이 필요하면: `주도형` 또는 `강공형`
- 일반봇 / 시뮬봇 규모에 맞춰 메모리 프리셋 제공
- 구조화 데이터는 가능한 한 롤백 / dedupe / 세션 분리를 고려해 관리

## 파일

- 메인 구현: [LIBRA_World_manager.js](./LIBRA_World_manager.js)
