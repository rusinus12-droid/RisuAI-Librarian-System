# 📚 Librarian System - Long Memory AI Assistant

[![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)](https://github.com/rusinus12/RisuAI-Librarian-System
)
[![API](https://img.shields.io/badge/RisuAI%20API-3.0-green.svg)](https://risuai.xyz)
[![License](https://img.shields.io/badge/license-MIT-orange.svg)](LICENSE)

**RisuAI용 장기 메모리 관리 및 다중 AI 공급자 연동 플러그인**

RisuAI 캐릭터가 대화 맥락을 장기적으로 기억하고, AI를 활용해 요약·분석하여 자연스러운 롤플레이를 지원합니다.

---

## 🌟 주요 기능

### 장기 메모리 시스템
- **자동 저장**: 대화 내용을 자동으로 메모리로 변환하여 저장
- **유사도 검색**: 임베딩 기반 벡터 유사도로 관련 기억 검색
- **메모리 분류**: Core(핵심), Episodic(사건), Context(문맥), Archive(압축) 4단계 분류
- **자동 압축**: 메모리 임계값 도달 시 AI로 요약하여 압축 보관
- **TTL 관리**: 메모리 타입별 자동 만료 및 가비지 컬렉션

### 다중 AI 공급자 지원
| 공급자 | 메인 모델 | 임베딩 모델 |
|--------|----------|------------|
| OpenAI | GPT-4o, GPT-4, o1, o3-mini | text-embedding-3-small |
| Google | Gemini 2.0 Flash/Pro | Gemini Embedding |
| Anthropic | Claude 3.5/3.7 Sonnet, Haiku | (OpenAI 호환) |
| OpenRouter | 300+ 모델 자동 로드 | (OpenAI 호환) |

### 토크나이저
- **다중 토크나이저**: GPT-4, Claude, Gemini, Custom API 지원
- **토큰 제한**: 메모리당 최대 토큰 수 설정으로 컨텍스트 관리
- **다국어 지원**: 한국어/영어 최적화 토큰 비율

### CBS (Conditional Block Syntax) 엔진
- 조건부 텍스트 처리 `{{#if ...}}...{{/if}}`
- 변수 처리 `{{getvar::변수명}}`
- 연산 처리 `{{calc::수식}}`
- 커스텀 함수 `{{#func 이름}}...{{/func}}`

### 추가 기능
- **감정 분석**: 대화 감정 태깅 (joy, sadness, anger, fear, surprise, trust, neutral)
- **번역 필터링**: `<original>` 태그 기반 원문 추출
- **Thinking 모드**: Claude/Gemini/o1 시리즈 추론 모드 지원
- **GUI 대시보드**: 메모리 조회, 삭제, 설정 관리

---

## 📦 설치

### 요구사항
- RisuAI 최신 버전
- API 키 (OpenAI / Google / Anthropic / OpenRouter 중 하나)

### 설치 방법

1. RisuAI에서 **플러그인** 탭으로 이동
2. **플러그인 추가**
3. 설치 후 📊 아이콘 클릭하여 설정

---

## ⚙️ 설정

### 기본 설정 (Arguments)

| 인자 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `max_limit` | int | 150 | 최대 메모리 보관 수 |
| `threshold` | int | 5 | 메모리 저장 최소 중요도 |
| `gc_frequency` | int | 10 | GC 실행 주기 (턴) |
| `emotion_enabled` | string | true | 감정 분석 활성화 |
| `summary_threshold` | int | 100 | 메모리 압축 임계값 |
| `debug` | string | false | 디버그 로그 출력 |
| `cbs_enabled` | string | true | CBS 엔진 활성화 |
| `sim_threshold` | string | 0.25 | 최소 유사도 임계값 |

### 프리셋

| 프리셋 | Max | Similarity | Summary | GC | 용도 |
|--------|-----|------------|---------|-----|------|
| 🌱 일반 | 100 | 0.20 | 80 | 5 | 일반 대화 |
| 🪵 시뮬(추천) | 150 | 0.25 | 100 | 10 | RPG/시뮬레이션 |
| 🌳 대규모 | 300 | 0.30 | 200 | 15 | 장기 캠페인 |

### API 설정

GUI 대시보드에서 다음을 설정:

**메인 모델** (메모리 요약, 감정 분석)
- Provider: OpenAI / Gemini / Anthropic / OpenRouter
- Model: 모델명
- URL: API 엔드포인트
- Key: API 키
- Temperature: 0.0 ~ 2.0

**임베딩 모델** (유사도 검색)
- Provider: OpenAI / Gemini
- Model: text-embedding-3-small (권장)

---

## 🎯 사용법

### 자동 동작

1. **대화 시작**: 캐릭터와 대화하면 자동으로 메모리 저장
2. **맥락 검색**: 새 메시지에서 관련 기억 자동 검색 및 프롬프트에 주입
3. **메모리 정리**: 설정한 주기마다 만료된 메모리 자동 삭제

### 수동 관리

📊 아이콘 클릭 → GUI 대시보드:

- **홈**: 기능 소개
- **메모리**: 저장된 메모리 조회, 삭제
- **토크나이저**: 토큰 계산 테스트
- **설정**: API, 프리셋, 파라미터 설정

---

## 🔧 고급 기능

### SAO 변수 스냅샷

메모리 저장 시 다음 변수를 자동 기록:
- `world` - 현재 월드
- `floor` - 현재 층
- `hp` - 체력
- `location` - 위치

동일 월드에서 20% 관련성 보너스 적용.

### 번역 필터링

활성화 시 AI에게 `<original>` 태그 사용 지시:
