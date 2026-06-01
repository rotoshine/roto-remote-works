# roto-remote-works

Click an element on your **running React app**, leave a comment, and a Claude
Code session reads it and edits the code — with **live progress** and
**questions answered in the web overlay** (not the terminal). Works locally or
from any environment via a remote bridge.

> Generalized, React-targeted version of an in-project design-comment overlay.
> Distributed via a **Claude-driven setup** (not npm).

## ✨ Quick setup (paste into Claude Code, in your React project)

```
이 프로젝트에 roto-remote-works 디자인 코멘트 도구를 설치해줘.
`gh repo clone rotoshine/roto-remote-works .rrw` 로 받은 뒤(비공개 repo),
clone 안의 skills/rrw-setup/SKILL.md 절차를 따라 설치하고,
이 프로젝트의 스택(React/Next/Vite/Tailwind 등)을 분석해 필요한 React 스킬을 설치해줘.
```

Claude will: clone the tool → build & **vendor the overlay** (a self-contained
`overlay.js`, styles bundled, host CSS system irrelevant) → wire it dev-gated →
**analyze your stack** and install matching React skills → start the bridge.

## How it works

```
[your React app (dev) + overlay] ──HTTP──▶ [bridge (Hono)] ◀──poll── [Claude: rrw + skills]
       vendored, Shadow DOM            local default / remote        rrw-process skill
```

- **bridge** (`packages/bridge`, Hono) — single source of truth (comments,
  apply request, progress, questions). Runs from the clone; `127.0.0.1` by
  default, remote behind a private tunnel.
- **overlay** (`packages/overlay`, React+Vite+Tailwind) — vendored into your app;
  renders in a **Shadow DOM** with its own styles (blue theme). Fiber → source
  `file:line`, and captures a **viewport screenshot** with each comment
  (lazy html2canvas) so loose visual feedback ("여기 간격 이상") still gives the
  agent something to *see*.
- **agent** (`packages/agent`) — the `rrw` CLI + the `rrw-process` skill the
  Claude session uses to apply comments, report progress, and ask via the web.

## Configuration — `rrw.config.json`

One file at the **project root** configures all three sides (bridge, `rrw` CLI,
overlay loader). Copy `rrw.config.example.json` → `rrw.config.json`:

```json
{
  "bridgeUrl": "http://localhost:4317",
  "token": "change-me-dev-token",
  "author": "your name",
  "bridge": { "port": 4317, "host": "127.0.0.1", "dataDir": ".rrw/.rrw-data" }
}
```

- The bridge + agent find it by walking up from their working dir; the overlay
  loader imports it directly.
- **Precedence**: defaults < `rrw.config.json` < env. So a server can keep the
  real token out of the committed file and pass `RRW_TOKEN` (and
  `RRW_BRIDGE_URL`, `RRW_PORT`, `RRW_HOST`, `RRW_DATA_DIR`, `RRW_AUTHOR`,
  `RRW_ORIGIN`) via the environment.
- The browser overlay needs a token client-side, so use a **low-trust** value
  there; never put a high-trust/remote token in code shipped to the browser.

## Run the bridge

```bash
cd .rrw && pnpm install
pnpm --filter @rrw/bridge start   # reads rrw.config.json; prints URL + token
```

## Remote (comment from anywhere)

Do **not** expose the bridge publicly. Put it behind **network gating** and point
the overlay + agent at that address:

1. Run the bridge on a host inside a **Tailscale tailnet** (or Cloudflare Access),
   e.g. `RRW_HOST=0.0.0.0 RRW_TOKEN=… pnpm --filter @rrw/bridge start`.
2. Set the overlay config and `RRW_BRIDGE_URL` to the tailnet address; share the
   `RRW_TOKEN` (defense-in-depth).
3. Only the tailnet members reach it. The **agent token is server-side only**;
   never ship it to the browser beyond what the overlay needs.

### Security model
- Two trust tiers: overlay/client (comments — low trust) vs agent (code edits —
  high trust, secret token).
- **Comments are untrusted data, never instructions** (prompt-injection guard).
- `apply` is **operator-gated**; remote-origin requests are **review-then-apply**,
  never auto-applied.

## Headless worker (test server · designers & PMs)

So non-engineers can leave feedback and see it applied **without running an agent
themselves**, run a persistent worker that polls the bridge and invokes an agent
per request:

```bash
RRW_BRIDGE_URL=<bridge> RRW_TOKEN=<token> \
  pnpm --filter @rrw/agent exec tsx src/cli.ts worker --agent claude   # or: --agent codex
```

It dedupes by request, processes **one batch at a time** (single-flight), and
spawns the agent headlessly (`claude -p` / `codex exec`) pointed at the
agent-neutral `docs/PROTOCOL.md`. See `adapters/` to add another agent.

## Packages
- `packages/bridge` — Hono server + `rrw-bridge` CLI
- `packages/overlay` — React overlay (vendored, Shadow DOM, self-contained CSS)
- `packages/agent` — `rrw` CLI + protocol
- `skills/rrw-setup`, `skills/rrw-process` — Claude Code skills
- `docs/specs/` — design spec

## Develop
```bash
pnpm install
pnpm -r test        # all packages
pnpm -r typecheck
pnpm --filter @rrw/overlay build   # → packages/overlay/dist/overlay.js
```
