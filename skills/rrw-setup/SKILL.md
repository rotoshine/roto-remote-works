---
name: rrw-setup
description: Install the roto-remote-works design-comment tool into a React project. Use when the user pastes the setup prompt or asks to set up / install roto-remote-works (the design-comment overlay) in their app. Clones the tool, vendors the overlay, wires it with host-owned runtime gating, analyzes the stack, and installs matching React skills.
---

# rrw-setup — install into a React project

Target = **React** apps (Next.js or Vite + React). Do the steps in order.

## 1. Clone the tool
If `.rrw/` is missing, clone the repo there (or download a GitHub release):
```bash
git clone https://github.com/rotoshine/roto-remote-works .rrw   # public repo, no auth needed
(cd .rrw && pnpm install && pnpm --filter @rrw/overlay build)   # → .rrw/packages/overlay/dist/overlay.js
```
Add `.rrw/` to the project `.gitignore`.

## 2. Detect the stack
Read the project `package.json`:
- **Require React ≥ 19.** Read the host's resolved `react` version. If it is **< 19**,
  STOP and tell the user: "roto-remote-works는 React 19 이상만 지원합니다 (현재
  <version>). 설치를 중단합니다." Do not vendor or wire anything. (This is a hard break;
  React 18 hosts must pin an older tag of this tool.)
- **Next.js** (`next` dep) → App Router layout (`app/layout.tsx`) or `_app`.
- **Vite + React** (`vite` + `react`) → `src/main.tsx`.
- Note Tailwind / vanilla-extract / shadcn — **irrelevant to the overlay** (it ships its own styles), but informs which React skills to install.

## 3. Vendor the overlay (prebuilt, self-contained)
빌드 산출물과 런타임 로더 소스를 앱 안으로 복사한다:
```bash
mkdir -p components/rrw
cp .rrw/packages/overlay/dist/overlay.js components/rrw/overlay.js
cp .rrw/packages/overlay/src/rrw-loader.ts components/rrw/rrw-loader.ts
cp .rrw/packages/overlay/src/useRrwOverlay.ts components/rrw/useRrwOverlay.ts
# vendored 로더가 TS 소스가 아닌 빌드 번들을 가리키도록 경로를 교정한다:
sed -i '' 's#import("./index")#import("./overlay.js")#' components/rrw/rrw-loader.ts
```
로더(`rrw-loader.ts`)는 `RrwLoaderConfig` 타입을 인라인으로 정의하므로 다른 소스 파일은
필요 없다. `overlay.js`에는 호스트 쪽 타입 정의가 없어 `mountOverlay`가 untyped로 남는데,
vendored 로더가 그 호출을 감싸므로 호스트에서 직접 접근할 일은 없다 — 허용 가능.

## 4. Wire it — host-owned runtime gating (works in production)
오버레이는 빌드 타임에 막지 않는다. **호스트가 활성화 조건을 직접 결정**하며, 조건이
충족될 때만 번들이 lazy-fetch된다 (일반 사용자는 0 바이트를 받는다). 두 가지 방법:

**React hook (권장):**
```tsx
"use client";
import { useRrwOverlay } from "@/components/rrw/useRrwOverlay";
import rrwConfig from "@/rrw.config.json";
// 브라우저는 LOW-trust clientToken 만 사용한다. 고신뢰 `token` 은 서버 전용
// (브리지·에이전트 호스트의 RRW_TOKEN env)이며 여기에 참조하면 안 된다.
// 런타임 게이팅 prod 빌드에서는 config 전체가 번들에 포함되므로,
// `?? cfg.token` 폴백을 쓰면 고신뢰 토큰이 모든 브라우저로 유출된다.
const cfg = rrwConfig as { bridgeUrl?: string; clientToken?: string; author?: string };

export function RrwGate() {
  // 아래 조건을 프로젝트 상황에 맞게 교체한다 (역할, userId allowlist, 피처 플래그, 쿼리스트링 등).
  const enabled =
    typeof window !== "undefined" && new URLSearchParams(location.search).get("rrw") === "1";
  useRrwOverlay(enabled, { bridgeUrl: cfg.bridgeUrl, token: cfg.clientToken ?? "", author: cfg.author });
  return null;
}
```
`<RrwGate />`를 조건 없이 렌더링한다 (Next `app/layout.tsx` `<body>`, 또는 Vite 루트).

**Imperative / vConsole:**
`window.__rrw.start({ bridgeUrl, token: clientToken })` 로 시작하고,
`window.__rrw.stop()` 으로 제거한다.

> ⚠️ **게이트는 UX 편의용이지 보안 경계가 아니다.** URL 파라미터·localStorage·devtools로
> 플래그를 바꾸면 누구든 lazy 번들을 받아 `clientToken`을 읽을 수 있다 — 이는 저신뢰 토큰이며
> 브라우저에 노출되도록 설계된 것이다. 실제 보안 경계는 브리지의 **네트워크 게이팅**
> (Tailscale/Cloudflare Access)과 **운영자 승인 `apply`** 이다. 오버레이 로딩 자체가 코드
> 편집을 트리거하지는 않는다. 2-토큰 prod 빌드에서는 `rrw.config.json`에 `bridgeUrl` +
> `clientToken` 만 남겨라.

## 5. Config — `rrw.config.json` (one file, read by all three sides)
Create `rrw.config.json` at the **project root**. The bridge, the `rrw` CLI, and
the overlay loader all read it; env vars override it (so secrets/remote tokens
can stay in env on a server).
```json
{
  "bridgeUrl": "http://localhost:4317",
  "token": "<dev token — overlay & bridge must match>",
  "author": "your name",
  "processing": { "mode": "session", "agent": "claude" },
  "bridge": { "port": 4317, "host": "127.0.0.1", "dataDir": ".rrw/.rrw-data" }
}
```
- **`processing.mode`**: `session` (default, local dev — the operator's interactive
  agent applies via `rrw-process`) or `worker` (standalone/remote bridge — a headless
  `claude -p`/`codex exec` applies per request). `rrw run` dispatches on it.
- **`processing.delivery`**: `in-place` (default — edits hot-reload, for local/HMR)
  or `pr` (worker opens a PR off `processing.base` instead of writing the tree, for
  built/deployed servers). Set `pr` only with `gh` auth + push rights on that host.
- **Local (single token)**: keep `bridgeUrl` at localhost; set any `token` — fine for
  the browser to hold on localhost.
- **Remote / standalone (two tokens)**: add a low-trust **`clientToken`** for the
  overlay; the bridge accepts it for comment/read/answer/apply but returns 403 on
  agent-only routes (resolve, status, ask, request, screenshots). The overlay bundles
  this file, so **keep the high-trust `token` OUT of it** — supply `token` via
  `RRW_TOKEN` env on the bridge + agent hosts (env overrides file). Point `bridgeUrl`
  at the gated host (Tailscale/Cloudflare Access).
- Precedence: built-in defaults < `rrw.config.json` < env (`RRW_BRIDGE_URL`, `RRW_TOKEN`,
  `RRW_PORT`, `RRW_HOST`, `RRW_DATA_DIR`, `RRW_AUTHOR`, `RRW_ORIGIN`).

## 6. Install matching React skills
The applier follows these for quality React edits:
```bash
npx skills add vercel-labs/agent-skills@vercel-react-best-practices
npx skills add vercel-labs/agent-skills@vercel-react-view-transitions   # if the app uses transitions
npx skills add vercel-labs/json-render@react                            # if rendering JSON-driven UI
```
Install the `rrw-process` skill from `.rrw/skills/rrw-process` as well.

## 7. `rrw` wrapper (so rrw-process can call `rrw`)
Create `.rrw/rrw` (chmod +x):
```bash
#!/usr/bin/env bash
cd "$(dirname "$0")/packages/agent" && exec pnpm exec tsx src/cli.ts "$@"
```
Run it from inside the project so it finds `rrw.config.json` (it walks up from
its own dir). Override with `RRW_BRIDGE_URL` / `RRW_TOKEN` env only when needed.

## 8. Start the bridge & verify
The bridge reads `rrw.config.json` automatically (port/host/dataDir/token):
```bash
pnpm --filter @rrw/bridge --dir .rrw start   # add RRW_TOKEN=… only to override the file
```
Then run the dev server, open the app, and confirm the **＋ 코멘트** FAB appears
(hovering highlights the element under the cursor). Hand off to `rrw-process`
for applying comments.
