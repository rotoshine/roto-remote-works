# roto-remote-works — Design-Comment Tool (React-targeted)

Spec date: 2026-05-31

## 1. Purpose

A reusable "click an element on a running web app → leave a comment → a Claude
Code session reads it and edits the code" tool, extracted and generalized from
the overlay built in the `idiots.band` project. Targets **React products**
(Next.js / Vite + React + Tailwind). Supports local and remote operation so
design feedback can be left from any environment (preview, mobile) and processed
by a Claude session that polls a shared bridge.

## 2. Goals / Non-goals

**Goals**
- Point-and-comment overlay for React apps, installed via a Claude-driven setup
  (no `npm publish`; distributed from GitHub).
- A standalone bridge server (Hono) as the single source of truth for comments,
  requests, progress, and questions.
- **Reverse channel**: progress (per-comment status + current-step line) and
  **web-ask** (Claude asks questions in the overlay instead of the terminal).
- Local by default; configurable remote bridge behind network gating.
- Leverage React design skills (best-practices, view-transitions, json-render)
  so applied edits follow React conventions.

**Non-goals**
- Non-React hosts (explicitly out of scope — enables React-fiber source mapping
  and React-specific skills).
- npm package distribution (setup is skill-driven from GitHub).
- A production auth system (this is a dev tool; trust = network gating + tokens).

## 3. Architecture

```
[React host app (dev) + <DesignCommentOverlay/> (vendored)]
        │  HTTP (bridge URL, token)
        ▼
[Bridge — Hono + TS]  ← runs from the cloned tool repo, local default / remote
        ▲  HTTP poll (token)
        │
[Claude session: agent connector + skill]
```

**Tool repo** (`roto-remote-works`, GitHub, pnpm workspace monorepo):
- `packages/bridge/` — Hono + TS server. REST API, JSON file storage, token
  auth, CORS. `bin` to run it. Runs from the clone (separate process).
- `packages/overlay/` — React + TS + Tailwind component(s). The **source that is
  vendored into consumer projects** by the setup skill. Built & tested here.
- `packages/agent/` — agent-side helper CLI (`rrw status set`, `rrw ask`, poll
  loop) + the Claude Code skill(s): the **setup skill** (README prompt target)
  and the **processing protocol**.
- `docs/specs/` — this spec.

## 4. Distribution & setup (skill-driven, no npm)

1. Tool hosted on GitHub. `README.md` contains a **setup prompt**.
2. User pastes the prompt into Claude Code inside their React project.
3. Claude **git-clones the tool** (or downloads a GitHub release) to a local
   location (default: `<project>/.rrw/`, git-ignored).
4. Claude **vendors the overlay** React component into the consumer
   (`components/design-comments/`) — **source + its prebuilt self-contained
   stylesheet** (so the host's CSS system is irrelevant) — wires it dev-gated
   into the app (`process.env.NODE_ENV !== "production"`), and writes config
   (`BRIDGE_URL`, `BRIDGE_TOKEN`).
5. Claude **analyzes the host stack** (React? Next vs Vite? Tailwind version?)
   and conditionally installs React skills via `npx skills add`:
   - `vercel-labs/agent-skills@vercel-react-best-practices`
   - `vercel-labs/agent-skills@vercel-react-view-transitions`
   - `vercel-labs/json-render@react`
6. The bridge is started from the clone (`pnpm --filter bridge dev`), local
   default; remote is a config change.

## 5. Data model & bridge API (the contract)

Storage: JSON files under the bridge's data dir; **writes serialized** (in-memory
mutex / atomic write) to avoid read-modify-write races.

All endpoints require `Authorization: Bearer <token>` and send CORS headers.

- `GET/POST/PATCH/DELETE /comments` — comment store
  (`{id, comment, status, url, selector, text, tag, classes, component, source, rect, createdAt}`;
  status: `open | queued | applying | resolved`; `source` is React-fiber
  `file:line:col`, best-effort).
- `POST /apply` — operator requests processing: `open → queued`, writes a request
  marker.
- `GET/PATCH /status` — progress `{ state, currentStep, perComment: {id: status} }`
  (agent PATCHes as it works; overlay polls).
- `POST /question` (agent registers `{text, options}`), `GET /question` (overlay
  reads pending), `POST /answer` (user answers), agent polls for the answer.
  Includes timeout/cancel (see §7).

## 6. Reverse channel (the two enhancements)

- **Progress (web)**: as the agent works each comment it `PATCH /status` with the
  current step (one line) and per-comment state. Overlay polls `/status` and
  renders pin colors (대기/처리중/완료) + a "지금: … 수정 중" line. The agent uses a
  helper CLI (`rrw status set …`) so it is hard to forget.
- **Web-ask**: when the agent needs to ask, it `POST /question` (instead of
  `AskUserQuestion`) and polls `/question` for the answer. The overlay shows a
  modal (question + option buttons + free text); the user answers in the web;
  the agent resumes.

## 7. Security / trust model

- **Two trust tiers**: overlay/client (comments, answers — low trust; token is
  browser-visible) vs agent connector (polling, code edits — high trust; secret
  token, never shipped to the browser).
- **Local default**: bridge binds `127.0.0.1`, auto-generated token, `Origin`
  check. Zero config.
- **Remote**: bridge behind **network gating** (Tailscale tailnet / Cloudflare
  Access) — not publicly exposed. Bearer token is defense-in-depth.
- **Prompt-injection guard (critical)**: remote comments are **untrusted data**.
  `apply` (the code-editing trigger) is **operator-gated** — never auto-applied
  for remote-origin requests; remote = review-then-apply, local-origin may
  auto-apply. The agent skill frames comment text as user-supplied data, not
  instructions.
- **Web-ask robustness**: questions carry a timeout; on timeout or user-cancel
  the agent aborts the run gracefully and reverts `applying → open`.

## 8. Overlay specifics (React)

- A React component vendored into the host; dev-gated. Comment UI (click-to-
  select via `document.elementFromPoint`, drag-to-move panel/draft, pins),
  progress panel, web-ask modal.
- **Source mapping**: React fiber (`_debugSource`) → `file:line:col` (works
  because target is React). Falls back to selector/text/classes if absent.
- **Style isolation & host-CSS independence**: the overlay must **not** assume the
  host's CSS system. The host may use Tailwind, vanilla-extract, shadcn, CSS
  modules, or nothing. The overlay authors its styles **in `packages/overlay`**
  (Tailwind is an internal authoring choice), compiles them to a **self-contained
  stylesheet at tool-build time**, and **injects that prebuilt CSS into its own
  Shadow DOM root**. The vendored component therefore ships its own styles and
  renders identically regardless of the host's CSS pipeline (no host Tailwind /
  build step required for the overlay's styles). Modals/portals target the shadow
  root, not `document.body`.
- **Theme**: blue primary, defined as CSS variables **inside the shadow root**
  (independent of any host theme/CSS).

## 9. Risks & mitigations (from design review)

| Risk | Severity | Mitigation |
|------|----------|------------|
| Prompt injection via remote comments | High | comments=untrusted; apply operator-gated; remote=review-then-apply |
| Remote-triggered code edits | High | agent confirms/operator-gates before editing; token secret + network gating |
| Web-ask blocks the agent | Med | timeout + cancel + graceful abort |
| Agent forgets protocol (status/ask) | Med | helper CLI `rrw …`; skill instructions |
| Tailwind/React in Shadow DOM | Med | compile Tailwind into shadow root; portals to shadow root |
| JSON store concurrency | Low | serialize writes / atomic write |

## 10. Phasing (implementation order)

1. **Monorepo setup** — pnpm workspace, TS, Vitest, Tailwind (blue theme), lint.
2. **Bridge** — data store + API + auth + CORS (TDD, comprehensive).
3. **Overlay** — React component (comment UI, drag, pins) + progress + web-ask
   (component tests).
4. **Agent** — helper CLI + Claude Code processing skill (protocol).
5. **Setup skill** — README prompt → clone/vendor/wire/analyze/install-skills.
6. **Remote** — tunnel/network-gating docs + auth hardening.
7. **Validation** — try it against a sample React app.

## 11. Testing strategy (thorough — explicit requirement)

- **Bridge**: unit + integration tests (Vitest + Hono test client) covering every
  endpoint, auth (missing/invalid/valid token), CORS, status transitions
  (open→queued→applying→resolved), concurrency (serialized writes), web-ask
  lifecycle (post → answer → resolve, and timeout/cancel), error paths.
- **Overlay**: component tests (Vitest + Testing Library) for selector capture,
  comment CRUD against a mocked bridge, drag, progress rendering, web-ask modal.
- **Agent CLI**: unit tests for `status set` / `ask` / poll against a mock bridge.
- Target: cover happy paths + auth/error/edge paths for every public surface.
