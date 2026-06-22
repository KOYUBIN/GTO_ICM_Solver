# GTO / ICM Solver

No-Limit Texas Hold'em **GTO / ICM 솔버 + 커뮤니티** 앱. GTO Wizard를 레퍼런스로 한
웹 · 모바일 모노레포입니다.

## 구성

```
packages/engine   공용 포커 엔진 (순수 TypeScript, 웹·모바일 공유)
apps/web          Next.js 웹 앱
apps/mobile       Expo (React Native) 모바일 앱
```

핵심 계산 로직은 모두 `@gto/engine` 한 곳에 있어 웹과 모바일이 **동일한 엔진**을 사용합니다.

## 엔진 (`@gto/engine`)

- **핸드 평가** — 7장 중 베스트 5장 평가기
- **에쿼티** — 몬테카를로 시뮬레이션 (핸드 vs 핸드 / 핸드 vs 레인지, 보드 지정 가능)
- **레인지** — 솔버 표기 파서 (`22+`, `ATs+`, `A5s-A2s`, `AKo`, 가중치 `AKs:0.5`) + 13×13 그리드
- **ICM** — Malmuth-Harville 모델, 버블 리스크 프리미엄
- **프리플랍** — Chen 공식 기반 핸드 강도 + 숏스택 푸시/폴드 근사

> 프리플랍/푸시폴드는 **실용적 근사**입니다 (정확한 Nash·CFR 해가 아님). 향후 본격
> CFR 솔버로 확장 가능하도록 모듈화되어 있습니다.

## 기능

| 화면 | 설명 |
|------|------|
| 에쿼티 | 승률 계산 |
| 레인지 | 13×13 그리드 시각화, 콤보·비중 |
| 푸시/폴드 | 숏스택 셔브 차트 (웹) |
| ICM | 칩 → 상금 기대값, 리스크 프리미엄 |
| 커뮤니티 | 핸드 공유, 코멘트·리뷰 |

커뮤니티는 현재 인메모리 목 데이터이며, 백엔드(REST/Supabase 등) 연동을 전제로
`apps/web/src/lib/community.ts`의 API 형태로 설계되어 있습니다.

## 개발

```bash
npm install              # 루트: 엔진 + 웹 설치
npm run build:engine     # 엔진 빌드 (dist)
npm run test:engine      # 엔진 단위 테스트
npm run dev:web          # 웹 개발 서버
npm run build:web        # 웹 프로덕션 빌드

# 모바일 (별도 설치 — Expo SDK 52, React 18)
cd apps/mobile && npm install
npm run typecheck        # 타입체크
npm run export:web       # Expo 웹 정적 export
npm run start            # Expo 개발 서버 (Expo Go / 에뮬레이터)
```

## 빌드 상태

- `@gto/engine` — 빌드 ✓, 단위 테스트 11/11 통과 ✓
- `apps/web` — Next.js 프로덕션 빌드 ✓ (정적 라우트 9개)
- `apps/mobile` — 타입체크 ✓, Expo 웹 export ✓

배포는 추후 진행 예정입니다.
