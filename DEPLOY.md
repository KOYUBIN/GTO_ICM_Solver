# 배포 가이드 (Hosting)

이 저장소는 모노레포입니다.

```
packages/engine   공용 엔진 (빌드 시 dist 생성 필요)
apps/web          Next.js 웹 앱  ← 호스팅 대상
apps/mobile       Expo 앱 (별도: EAS Build / 웹 export)
```

핵심: 웹 앱은 `@gto/engine`의 빌드 산출물(`dist`)에 의존합니다. 그래서 **배포 시
`build:engine`이 `next build`보다 먼저** 실행돼야 합니다. 이를 위해 루트
`package.json`에 `postinstall`(설치 후 엔진 빌드)과 `vercel-build`/`vercel.json`을
넣어 두었습니다.

---

## 옵션 A — Vercel (추천, Next.js 최적)

GitHub 저장소를 Vercel에 연결하면 push마다 자동 배포됩니다.

1. https://vercel.com 에서 GitHub로 로그인 → **Add New… → Project** → 이 저장소 선택
2. 프로젝트 설정:
   - **Root Directory**: 저장소 루트(기본값) 그대로 두면 루트 `vercel.json`이
     `build:engine → build:web`을 실행합니다.
     - (만약 Root Directory를 `apps/web`으로 지정했다면, 루트 `postinstall`이 설치
       단계에서 엔진을 빌드하므로 그대로 동작합니다.)
   - **Framework Preset**: Next.js (자동 감지)
3. **Deploy** 클릭 → `https://<프로젝트>.vercel.app` 발급

### 커뮤니티 영구 저장 — Vercel Postgres 연결 (권장)
스토어는 **플러그형**입니다: 환경변수 `POSTGRES_URL`이 있으면 자동으로 Postgres에
저장하고, 없으면 파일/메모리(휘발성)로 동작합니다. 코드 수정 없이 DB만 붙이면 됩니다.

1. Vercel 프로젝트 → **Storage** 탭 → **Create Database** → **Postgres** 생성
2. 그 DB를 이 프로젝트에 **Connect** → Vercel이 `POSTGRES_URL` 등 환경변수를 자동 주입
3. **Redeploy** (Deployments → 최신 → Redeploy)
4. 끝! 첫 요청 때 테이블이 자동 생성·시드됩니다.

확인: 배포 주소에서 **`/api/health`** 를 열어보세요.
- `{"backend":"postgres", ...}` → 영구 저장 활성 ✅
- `{"backend":"file", ...}` → 아직 파일/메모리(휘발성) 상태

> Supabase 등 다른 Postgres를 써도 됩니다 — 환경변수 이름만 `POSTGRES_URL`로 맞추면 됩니다.
> (`@vercel/postgres`는 풀링된 Neon/Vercel Postgres 연결 문자열을 기대합니다.)

---

## 옵션 B — Render / Railway (영구 디스크, 지금 그대로 동작)

진짜 Node 서버라 **현재 JSON 파일 스토어가 그대로 보존**됩니다.

1. 새 **Web Service** 생성 → GitHub 저장소 연결
2. 설정:
   - **Build Command**: `npm install && npm run build:engine && npm run build:web`
   - **Start Command**: `npm run start -w web`  (Next 프로덕션 서버)
   - **환경변수** `COMMUNITY_DATA_DIR` = 영구 디스크 경로 (예: `/var/data`)
     - Render는 **Disks**, Railway는 **Volumes**로 영구 디스크를 마운트한 뒤 그 경로 지정
3. 배포 → 발급된 URL 사용

---

## 옵션 C — GitHub Pages (정적, 무료, GitHub 직접 호스팅)

GitHub Pages는 **정적 파일만** 호스팅하므로 **커뮤니티 API는 동작하지 않습니다**.
솔버·에쿼티·차트·레인지·푸시폴드·ICM·핸드분석 등 **계산 기능은 전부 동작**합니다.
이 경로를 원하면 Next를 정적 export(`output: 'export'`)로 바꾸고 `/api`·`/community`를
제외하는 별도 설정이 필요합니다. (원하시면 워크플로까지 구성해 드립니다.)

---

## 모바일 (Expo)
- 웹 미리보기: `cd apps/mobile && npm run export:web` → 정적 호스팅 가능
- 실제 앱: **EAS Build**로 iOS/Android 빌드 후 스토어 배포
- 앱이 커뮤니티 API를 쓰게 하려면 환경변수 `EXPO_PUBLIC_API_URL`을 배포된 웹 주소로 설정

---

## 로컬에서 프로덕션처럼 확인
```bash
npm install            # postinstall이 엔진을 빌드
npm run build          # build:engine → build:web
npm run start -w web   # http://localhost:3000
```
