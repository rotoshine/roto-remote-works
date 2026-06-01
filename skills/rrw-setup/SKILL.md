---
name: rrw-setup
description: Install the roto-remote-works design-comment tool into a React project. Use when the user pastes the setup prompt or asks to set up / install roto-remote-works (the design-comment overlay) in their app. Clones the tool, vendors the overlay, wires it dev-gated, analyzes the stack, and installs matching React skills.
---

# rrw-setup — install into a React project

Target = **React** apps (Next.js or Vite + React). Do the steps in order.

## 1. Clone the tool
If `.rrw/` is missing, clone the repo there (or download a GitHub release):
```bash
gh repo clone rotoshine/roto-remote-works .rrw   # gh handles auth for the private repo
(cd .rrw && pnpm install && pnpm --filter @rrw/overlay build)   # → .rrw/packages/overlay/dist/overlay.js
```
Add `.rrw/` to the project `.gitignore`.

## 2. Detect the stack
Read the project `package.json`:
- **Next.js** (`next` dep) → App Router layout (`app/layout.tsx`) or `_app`.
- **Vite + React** (`vite` + `react`) → `src/main.tsx`.
- Note Tailwind / vanilla-extract / shadcn — **irrelevant to the overlay** (it ships its own styles), but informs which React skills to install.

## 3. Vendor the overlay (prebuilt, self-contained)
Copy the built artifact into the app and add a dev-only loader:
```bash
mkdir -p components/rrw && cp .rrw/packages/overlay/dist/overlay.js components/rrw/overlay.js
```
Create `components/rrw/RrwOverlay.tsx` (reads the shared `rrw.config.json` — see step 5):
```tsx
"use client";
import { useEffect } from "react";
import rrwConfig from "@/rrw.config.json"; // bridgeUrl, token, author
export function RrwOverlay() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    let unmount: (() => void) | undefined;
    import("./overlay.js").then((m) => {
      unmount = m.mountOverlay({
        bridgeUrl: rrwConfig.bridgeUrl ?? "http://localhost:4317",
        token: rrwConfig.token ?? "",
        author: rrwConfig.author,
      });
    });
    return () => unmount?.();
  }, []);
  return null;
}
```
(Vite: gate with `import.meta.env.DEV`; the JSON import is the same.)

## 4. Wire it dev-gated
- **Next**: in `app/layout.tsx` `<body>`, render
  `{process.env.NODE_ENV !== "production" && <RrwOverlay />}`.
- **Vite**: in `src/main.tsx`, `if (import.meta.env.DEV) import("./components/rrw/RrwOverlay")…`.

## 5. Config — `rrw.config.json` (one file, read by all three sides)
Create `rrw.config.json` at the **project root**. The bridge, the `rrw` CLI, and
the overlay loader all read it; env vars override it (so secrets/remote tokens
can stay in env on a server).
```json
{
  "bridgeUrl": "http://localhost:4317",
  "token": "<dev token — overlay & bridge must match>",
  "author": "your name",
  "bridge": { "port": 4317, "host": "127.0.0.1", "dataDir": ".rrw/.rrw-data" }
}
```
- **Local**: keep `bridgeUrl` at localhost; set any `token` (overlay needs it client-side).
- **Remote**: set `bridgeUrl` to the gated host (Tailscale/Cloudflare Access). Keep the
  real token **out of the committed file** — supply it via `RRW_TOKEN` on the bridge
  and agent hosts (env overrides the file). The browser overlay still needs a token,
  so use a low-trust value there.
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
