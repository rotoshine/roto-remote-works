# roto-remote-works — react-grab Selection Engine + Runtime-Gated Loader + React 19 Rule

Spec date: 2026-06-08
Status: design approved; grounded against react-grab@0.1.44 installed source (spike `wf_bc209933-aad`).

## 1. Purpose

Three cohesive changes to how the overlay is selected-with and loaded:

- **(A) react-grab selection engine** — delegate the element-**selection** UX to
  [`react-grab`](https://github.com/aidenybai/react-grab)@0.1.44 (MIT): hover
  highlight, component-name labels, component-stack (↑↓) navigation, and
  **React-19-correct source resolution** via `bippy`. Today the overlay does
  hover-highlight + leaf-only click capture and resolves source by hand
  (`packages/overlay/src/selector.ts` → `inspectFiber`, reading `_debugSource`,
  which React 19 drops).
- **(B) Runtime-gated loader** — the overlay must be includable in **production
  builds** yet load **zero bytes for normal users**, activating only on a
  **host-owned runtime decision** (userId/role/flag) or a manual call (e.g. from
  vConsole). This replaces today's build-time `NODE_ENV` gate.
- **(C) React 19+ project rule** — this project supports **React ≥ 19 only**.

Multi-element (drag) selection is **Phase 2** (separate PR; it changes the bridge
contract) and is out of scope here.

## 2. Goals / Non-goals

**Goals**
- Component-unit selection + ↑↓ stack navigation + component-name label
  (react-grab native).
- React-19-correct source: fill `Captured.source`/`component` from
  `api.getSource(element)`; fall back to `inspectFiber` when it returns null.
- react-grab loads **lazily on first activation**, shipped **inside `overlay.js`**
  (single vendored artifact preserved).
- Host-owned runtime activation via a React hook **and** an imperative API; normal
  users fetch nothing.
- Enforce React ≥ 19 (peer dep + setup gate + docs).

**Non-goals**
- Multi-element drag selection (Phase 2 — `Comment.targets: Captured[]`, bridge +
  `docs/PROTOCOL.md` + agent).
- Source **column** numbers — `api.getSource` returns `file:line` only; we drop the
  `:col` we emit today (verified acceptable pending a smoke-test, §9).
- Built-in query-string/localStorage activation triggers — the **host owns** the
  decision; we only provide the hook + imperative entry points.
- Production source resolution — runtime fiber/bippy resolution yields `file:line`
  only in **dev/source-mapped** builds; minified prod yields component-name only or
  null. Documented, not solved (dev-time tool).

## 3. Decisions locked (with the spike evidence that grounds each)

- **(A) Integrate react-grab as the selection engine**, single-file inline, lazy on
  first `activate()`. Keep `inlineDynamicImports: true` — splitting react-grab into
  a separate chunk would break the single-`overlay.js` vendoring contract
  (CLAUDE.md) and re-open html2canvas single-file handling, for **no real benefit**:
  the whole overlay is already a runtime-gated lazy chunk (§B), so react-grab is
  never in any user's initial bundle regardless.
- **Bundling is browser-safe.** react-grab's `.` ESM export is browser-pure; the
  Node `@react-grab/cli` dep is reachable only from `bin/cli.js` and is tree-shaken.
  Add `rollupOptions.external += "@react-grab/cli"` + `optimizeDeps.exclude` as
  belt-and-suspenders. (Adversarial bundling check: 2/3 refuters failed to refute;
  the 1 "refute" conflated a declared-but-unimported dep with a bundled one.)
- **Source = `getSource` primary, `inspectFiber` fallback**, format `file:line`
  (drop `:col`). This is the actual React-19 accuracy win (bippy handles
  `_debugStack`); `_debugSource` that `inspectFiber` reads is gone in React 19.
- **(B) Runtime gating, host-owned.** Replace the `NODE_ENV` build gate with a thin
  always-present loader exposing `useRrwOverlay(enabled)` + `window.__rrw` +
  `startRrw/stopRrw`. The heavy `import("./overlay.js")` runs only when the host
  enables it → normal users get 0 bytes.
- **(C) React ≥ 19 only.** Bump overlay peer deps; gate in `rrw-setup`; document.

## 4. react-grab integration (A) — the GrabEngine seam

react-grab is wrapped behind an adapter so the overlay never imports it directly
and unit tests inject a fake (repo "side-effects via runner injection" rule).

```ts
// packages/overlay/src/grab-engine.ts
export interface Grab { element: Element; source: string | null; component: string | null }
export interface GrabEngine {
  activate(): void;
  deactivate(): void;
  onGrab(cb: (g: Grab) => void): () => void; // returns unsubscribe
  dispose(): void;
}
export async function loadGrabEngine(): Promise<GrabEngine> { /* real adapter, below */ }
```

**Real adapter (`loadGrabEngine`) — every line grounded by the spike:**

1. `window.__REACT_GRAB_DISABLED__ = true` **before** `await import("react-grab")` —
   react-grab auto-inits at module-eval (verified literal in `dist/index.js`), and
   default auto-init fires a telemetry fetch to react-grab.com (bad offline /
   Tailscale).
2. `const api = getGlobalApi() ?? init({ telemetry: false, freezeReactUpdates: false })`.
   - `telemetry: false` — no outbound calls (only outbound call in the artifact is
     the version check).
   - `freezeReactUpdates: false` — **critical**: default `true` monkeypatches the
     **global** React dispatcher (`useState/useReducer/useTransition/
     useSyncExternalStore`) across all React trees, which would freeze **our own**
     overlay. Tradeoff: host page may shift slightly during selection (accepted).
   - `getGlobalApi()` first — singleton-aware; never assume we own the only instance.
3. `api.registerPlugin({ name, theme, hooks })` — hooks attach to a **Plugin**, not
   `init()` (Options has no `hooks`/`theme`). `theme` disables **all** react-grab
   chrome (`toolbar`, `selectionBox`, `dragBox`, `grabbedBoxes`, `elementLabel` all
   `enabled:false`) so react-grab renders **zero** light-DOM UI and needs no
   `styles.css`. We use it purely as a selection/stack-nav/`getSource` engine; **our**
   Shadow-DOM highlight + draft card stay as the only UI. (Re-enabling
   `selectionBox`/`elementLabel` for a native floating component-label is a
   smoke-test-verified follow-up — Task 8 — not the baseline.)
4. `hooks.onElementSelect = async (el) => { const s = await api.getSource(el);
   emit({ element: el, source: s?.filePath ? (s.lineNumber!=null ?
   ` + "`${s.filePath}:${s.lineNumber}`" + ` : s.filePath) : null, component:
   s?.componentName ?? null }); return false }` — **`return false` suppresses the
   default clipboard copy + success flash** (inferred from the minified copy
   pipeline; §9 smoke-test #5 verifies at runtime).
5. `dispose()` → `unregisterPlugin(name)` + `api.dispose()` (no auto-cleanup on React
   unmount).

**Overlay wiring (`DesignCommentOverlay.tsx`):** in the `mode==="selecting"` effect
(~lines 86–128) we **keep** the `mousemove` hover highlight and the Esc handler, and
**replace only the click→capture** path with the engine: on first entering selecting
mode, `await loadGrabEngine()` once (memoize the promise in a ref), guard against
unmount-during-load (a `disposed` flag before subscribing), `engine.onGrab` → ignore
elements inside `[data-rrw-host]`, run existing `capture(el)` for
`selector/rect/text/classes/tag` then **override** `source`/`component` with the
grab's values, open the draft card (reuse `clampToViewport` placement), then
`engine.activate()`. On Esc/exit → `deactivate()`. On unmount → `dispose()`.
`inspectFiber` stays as the fallback inside `capture` when the grab's source is null.
Keeping our own highlight means each commit always has selection-time visual feedback
regardless of react-grab's (suppressed) chrome.

## 5. Runtime-gated loader (B) — host-owned activation

A thin always-present module (vendored into the host, no static import of
`overlay.js`) with a single lazy-load-once controller shared by both entry points:

```ts
// rrw-loader.ts (vendored; tiny — only this + the hook are in the host bundle)
// Inlines its config type so it resolves where only overlay.js is copied. `token` is
// the BROWSER bearer = the LOW-trust clientToken; the high-trust token is server-only
// (RRW_TOKEN env) and must NEVER be bundled (no `?? cfg.token` fallback).
export interface RrwLoaderConfig { bridgeUrl?: string; token?: string; author?: string; pollMs?: number }

let unmount: (() => void) | undefined;
let starting: Promise<void> | undefined;

export async function startRrw(config: RrwLoaderConfig = {}): Promise<void> {
  if (unmount) return;
  if (starting) return starting;                   // idempotent
  starting = import("./index") // rrw-setup rewrites to import("./overlay.js") when vendoring
    .then((m: { mountOverlay: (c: RrwLoaderConfig) => () => void }) => { unmount = m.mountOverlay(config); })
    .finally(() => { starting = undefined; });
  return starting;
}
export function stopRrw(): void { unmount?.(); unmount = undefined; }
export function isRrwRunning(): boolean { return !!unmount; }

if (typeof window !== "undefined") {
  (window as unknown as { __rrw?: unknown }).__rrw = { start: startRrw, stop: stopRrw, isRunning: isRrwRunning };
}
```

React hook (declarative; host computes `enabled` from its own userId/role/flag; `config`
must be a stable reference):

```ts
// useRrwOverlay.ts
export function useRrwOverlay(enabled: boolean, config: RrwLoaderConfig = {}): void {
  useEffect(() => {
    if (!enabled) return;
    void startRrw(config);
    return () => stopRrw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]); // re-runs only on enabled change; to change config, stopRrw() then re-enable
}
```

- **Normal users:** `enabled` stays false / nobody calls `start` → `import()` never
  runs → the `overlay.js` chunk (react-grab inside) is **never fetched**.
- **Privileged users:** host flips `enabled` true (or calls `window.__rrw.start()` /
  vConsole) → lazy chunk loads once → overlay mounts.
- **No `NODE_ENV` gate** — works in production builds by design.

`rrw-setup` (SKILL.md §3–4) changes: vendor `rrw-loader.ts` + `useRrwOverlay.ts`
alongside `overlay.js`; wire via the hook (`useRrwOverlay(host-decides)`) instead of
`{process.env.NODE_ENV !== "production" && <RrwOverlay/>}`.

## 6. React 19+ rule (C)

- `packages/overlay/package.json` peerDependencies: `react`/`react-dom` `>=18` →
  `>=19`.
- `rrw-setup` SKILL.md §2 (Detect the stack): read host `package.json` React
  version; **refuse/warn if < 19** with a clear message.
- Docs: README + CLAUDE.md "Node ≥ 22" line → add "React ≥ 19".

## 7. Build / vendoring

- `packages/overlay/package.json`: `react-grab` is a direct dependency.
- `vite.config.ts`: **keep** `inlineDynamicImports: true`; add
  `rollupOptions.external: [..., "@react-grab/cli"]` and (dev)
  `optimizeDeps.exclude: ["@react-grab/cli"]`. `react`/`react-dom` stay external.
- Output stays a single `overlay.js` (+ existing `styles.css` inlined). Vendoring
  contract (CLAUDE.md) **unchanged** beyond adding the two new loader files.
- react-grab's `styles.css` is **not** auto-injected and, with chrome themed off,
  likely renders no react-grab DOM → do **not** import it unless §9 smoke-test #4
  shows stray unstyled chrome.

## 8. Testing strategy (TDD — repo Iron Law)

**Unit / component (Vitest + Testing Library), fully deterministic:**
- `grab-engine` adapter: with a fake `react-grab` module, assert `loadGrabEngine`
  sets `__REACT_GRAB_DISABLED__` before import, calls `init` with
  `telemetry:false`+`freezeReactUpdates:false`, registers a plugin with the chrome
  theme off, and that `onElementSelect` emits a `Grab` and returns `false`.
- `DesignCommentOverlay`: inject a fake `GrabEngine`; entering selecting mode calls
  `activate()`, a fake grab opens the draft card with `source`/`component` filled,
  exit calls `deactivate()`, unmount calls `dispose()`; the legacy
  `mousemove`/`click` inspector is **not** attached while the engine drives.
- `selector.ts`: `capture(el, override?)` precedence — an explicit grab source wins;
  `inspectFiber` fallback when override is null (existing tests stay green).
- `rrw-loader`: `startRrw` is idempotent (concurrent calls share one `import`),
  `stopRrw` unmounts, `window.__rrw` is wired; `useRrwOverlay(false)` never imports,
  `useRrwOverlay(true)` starts and cleans up on unmount/`enabled→false`. Mock the
  dynamic import.

**Build/vendoring integration:** `pnpm --filter @rrw/overlay build` emits a single
`overlay.js` that contains react-grab and does **not** contain `@react-grab/cli`
(grep the artifact). `rrw-setup` copies `overlay.js` + the two loader files.

**Runtime smoke-tests (manual, against a real React-19 app)** — these cover the
spike's residual unknowns (§9); they are checklist items in the plan, not unit
tests.

## 9. Residual unknowns → first runtime smoke-tests (from the spike)

1. **Column dependency:** does the bridge/apply pipeline rely on `:col`? If yes,
   reconsider dropping it. (Expected: no.)
2. **Programmatic activation:** `api.activate()` enters selection without the user
   also pressing react-grab's own activation key; no stray react-grab key listeners
   hijack host input.
3. **Shadow-DOM hit-testing:** clicking our own FAB/draft card is **not** captured by
   react-grab as a selectable element; hover targets host elements, not the overlay.
4. **styles.css:** confirm nothing from react-grab renders unstyled; import
   `react-grab/styles.css` only if needed.
5. **Copy suppression:** `onElementSelect` returning `false` actually prevents the
   clipboard write + success flash (inferred, not executed). If not, also guard
   `onBeforeCopy`/`transformCopyContent`.
6. **Freeze tradeoff:** with `freezeReactUpdates:false`, overlay (draft card,
   progress panel) stays interactive during selection and the host stays usable.
7. **dispose() restoration:** after activate→select→deactivate→dispose, the global
   dispatcher patches are reverted and re-mounting re-inits cleanly (`getGlobalApi()`
   must not return a dead handle post-dispose).

## 10. Security / trust model (B widens exposure — document it)

Runtime gating is **host-owned**; when the host computes `enabled` from
authenticated state (userId/role) it is a real access control. But the project-level
boundary is unchanged and must be documented so a guessable gate is never mistaken
for security:

- Bridge stays **network-gated** (Tailscale/Cloudflare Access) — a normal user's
  browser cannot reach an internal `bridgeUrl`.
- `clientToken` is **low-trust** (browser-visible by design); in a runtime-gated prod
  build it sits in the lazy chunk and is exposed to anyone who can load it — so the
  bridge's network gating + the **operator-gated `apply`** remain the real defenses.
  Loading the overlay can never trigger code edits.
- Matches the existing two-trust-tier model (CLAUDE.md).

## 11. Phasing (implementation order)

1. **React 19 rule (C)** — peer deps, `rrw-setup` gate, docs. Small, independent.
2. **GrabEngine seam (A)** — interface + fake + real adapter (TDD).
3. **Overlay wiring (A)** — engine drives selecting mode; `capture` source override;
   legacy inspector removed; fallback intact.
4. **Build guards** — `external`/`optimizeDeps.exclude` for `@react-grab/cli`;
   artifact integration test.
5. **Runtime-gated loader (B)** — `rrw-loader.ts` + `useRrwOverlay.ts` (TDD) +
   `rrw-setup` rewiring (hook instead of `NODE_ENV`).
6. **Runtime smoke-tests (§9)** against a real React-19 app; fix what they surface.
7. **Docs** — README/overlay section: runtime gating, host-owned activation, the
   dev-build source limitation, security framing.

**Phase 2 (separate PR, out of scope):** drag multi-select →
`Comment`/`NewComment.targets: Captured[]` → bridge + `docs/PROTOCOL.md` + agent.
