# FreeCL

Geometry Dash 챌린지 리스트 FreeCL(구 JAWVCL). Supabase 하나에 React(Vite) 앱 두 개가 붙는 구조다.

```
FreeCLMain/    공개 사이트 — 13개 엔트리 MPA (라우터 없음)
FreeCLAdmin/   관리자 SPA — 제출 검토 / 맵 / 기록 / 유저 관리
supabase/      스키마 SQL, 검사 스크립트, Edge Function 5개
```

의존성은 두 앱 모두 `react`, `react-dom`, `@supabase/supabase-js` 셋뿐이다. 라우터·상태 관리·UI 킷·CSS 프레임워크 없음. **코드를 적게 쓰는 것이 이 프로젝트의 1순위 제약이다** — 새 라이브러리는 표준 기능이나 기존 코드로 안 될 때만 추가한다.

## 로컬 실행

```bash
cd FreeCLMain   # 또는 FreeCLAdmin
npm install
npm run dev
```

`.env`는 레포에 포함돼 있고 값은 전부 publishable(브라우저 번들에 실리는 공개 키)이다. 따로 받을 것이 없다.

`.env.local`은 Vite가 **개인 로컬 오버라이드**로 쓰는 파일이라 gitignore 상태다. 공유해야 하는 설정은 `.env`에 넣어라.

## 서버 비밀값은 git에 없다

Edge Function의 비밀값은 Supabase 프로젝트에 등록돼 있고 저장소에는 **이름만** 존재한다. 새 개발자에게 필요한 건 파일이 아니라 Supabase 프로젝트 권한이다.

| 이름 | 쓰는 곳 |
|---|---|
| `TURNSTILE_SECRET_KEY` | `submit`, `login` — 캡차 서버 검증 |
| `DISCORD_WEBHOOK_URL` | `notify-map` — 등재 알람 |
| `NOTIFY_SECRET` | `notify-map` — DB Webhook 요청 인증 (`x-notify-secret` 헤더와 일치해야 함) |
| `SUPABASE_*` | 플랫폼이 자동 주입 |

등록 여부는 `npx supabase secrets list`로 확인한다 — 값이 아니라 SHA-256 다이제스트가 나온다.

## Edge Functions

`login`(닉네임 로그인), `submit`(`submissions`로 가는 유일한 쓰기 경로), `admin-users`(밴/해제 — 이메일 차단 목록 포함), `withdraw`(회원 탈퇴), `notify-map`(등재 Discord 알람).

```bash
npx supabase functions deploy <name>
npx supabase functions deploy notify-map --no-verify-jwt   # DB Webhook이 호출하므로 JWT 검증 없음
```

## 데이터베이스

`supabase/*.sql`은 운영 DB에 시간 순으로 적용해 온 패치 모음이다. 빈 프로젝트에서 처음부터 재현하는 순서는 아직 정리돼 있지 않다.

```bash
npx supabase db query --linked=false --project-ref <ref> -f supabase/<file>.sql
```

## 검사

```bash
node supabase/classic-extra-check.mjs
npx --yes --package=deno deno check supabase/functions/<name>/index.ts
npx --yes --package=deno deno run --allow-env supabase/<name>-check.ts
```

`*-check.sql`은 fixture를 넣고 전부 롤백하므로 실제 데이터를 바꾸지 않는다. `*-check.ts`는 외부 API를 mock하므로 실제 계정을 밴하거나 Discord로 메시지를 보내지 않는다.

## 배포

공개 사이트와 관리자 사이트는 Firebase 프로젝트 하나 안의 서로 다른 hosting site다. 각 앱의 `firebase.json`이 자기 `site`를 지정한다.

```bash
cd FreeCLMain   # 또는 FreeCLAdmin
npm_config_prefix="$HOME/.npm-global" npx -y firebase-tools deploy --only hosting
```

맵을 승인한 뒤 배포하려면 먼저 폴백 JSON을 갱신해야 한다. 안 하면 첫 화면이 옛 목록을 보여 준다.

```bash
node supabase/refresh-fallback.mjs
```

- 공개: https://freecl.web.app (커스텀 도메인 없음)
- 관리자: https://freecl-admin.web.app (`noindex`)

## 라이선스

[GNU GPL 3.0](LICENSE) (`GPL-3.0-only`). 외부 폰트의 라이선스는 `FreeCLMain/THIRD_PARTY_NOTICES.md`.
