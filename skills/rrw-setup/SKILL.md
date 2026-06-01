---
name: rrw-setup
description: Install the roto-remote-works design-comment tool into a React project. Use when the user pastes the setup prompt or asks to set up / install roto-remote-works (the design-comment overlay) in their app. Clones the tool, vendors the overlay, wires it dev-gated, analyzes the stack, and installs matching React skills.
---

# rrw-setup — install into a React project

Target = **React** apps (Next.js or Vite + React). Do the steps in order.

## 1. Clone the tool
If `.rrw/` is missing, clone the repo there (or download a GitHub release):
```bash
git clone https://github.com/rotoshine/roto-remote-works .rrw
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
Create `components/rrw/RrwOverlay.tsx`:
```tsx
"use client";
import { useEffect } from "react";
export function RrwOverlay() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    let unmount: (() => void) | undefined;
    import("./overlay.js").then((m) => {
      unmount = m.mountOverlay({
        bridgeUrl: process.env.NEXT_PUBLIC_RRW_BRIDGE_URL ?? "http://localhost:4317",
        token: process.env.NEXT_PUBLIC_RRW_TOKEN ?? "",
      });
    });
    return () => unmount?.();
  }, []);
  return null;
}
```
(Vite: read `import.meta.env.VITE_RRW_*` and `import.meta.env.DEV` instead.)

## 4. Wire it dev-gated
- **Next**: in `app/layout.tsx` `<body>`, render
  `{process.env.NODE_ENV !== "production" && <RrwOverlay />}`.
- **Vite**: in `src/main.tsx`, `if (import.meta.env.DEV) import("./components/rrw/RrwOverlay")…`.

## 5. Config
Add the bridge URL + token to the app env (dev only):
`NEXT_PUBLIC_RRW_BRIDGE_URL`, `NEXT_PUBLIC_RRW_TOKEN` (or `VITE_…`). For local use,
the bridge prints its token on start. For remote, see the project README
(network gating).

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
Tell the user to set `RRW_BRIDGE_URL` + `RRW_TOKEN` when invoking it.

## 8. Start the bridge & verify
```bash
RRW_TOKEN=<token> pnpm --filter @rrw/bridge --dir .rrw start
```
Then run the dev server, open the app, and confirm the **＋ 코멘트** FAB appears.
Hand off to `rrw-process` for applying comments.
