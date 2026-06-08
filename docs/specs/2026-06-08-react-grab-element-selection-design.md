# roto-remote-works — react-grab as the Element-Selection Engine (Phase 1)

Spec date: 2026-06-08

## 1. Purpose

Improve the overlay's **element-selection UX** by delegating the selection phase
to [`react-grab`](https://github.com/aidenybai/react-grab) (MIT). Today the
overlay does hover-highlight + single-click capture and resolves source via a
hand-rolled React-fiber walk (`packages/overlay/src/selector.ts` →
`inspectFiber`, reading `_debugSource`). On **React 19** (`@types/react ^19`)
`_debugSource` is removed, so source resolution is degraded, and the user can
only grab the deepest leaf DOM node (e.g. a `<span>` inside a button), never the
meaningful component.

react-grab provides, at runtime with **no consumer build plugin**: hover
highlight, component-name labels, component-stack navigation (pick the parent
component instead of the leaf), and more accurate source resolution. This spec
adopts it as the **selection engine** while keeping our comment/screenshot/bridge
flow unchanged.

## 2. Goals / Non-goals

**Goals (Phase 1)**
- Replace the overlay's `selecting`-mode hover-highlight + click capture with
  react-grab's selection UI while a comment is being placed.
- **Component-unit selection** with ↑↓ stack navigation (react-grab native).
- **Component-name + source label** on the highlight (react-grab native).
- **Source accuracy** on React 19 — let react-grab resolve `file:line:col`;
  fall back to our existing `inspectFiber` when it returns nothing.
- Deliver react-grab as a **separate, on-demand chunk** so the base
  `overlay.js` download stays lean (it is loaded only when the user enters
  comment mode).
- Keep `rrw-setup` / vendoring working (now a multi-file artifact).

**Non-goals**
- **Multi-element (drag) selection** — deferred to Phase 2 because it changes the
  bridge contract (`Comment`/`NewComment` gain `targets: Captured[]`) and ripples
  into `docs/PROTOCOL.md` and the agent. Out of scope here.
- Disabling react-grab's own context-menu/toast/clipboard — not configurable;
  we design around it instead (see §4).
- Production-build source resolution — runtime fiber resolution yields
  `file:line` only in **dev builds**. This is a dev-time tool, so dev builds are
  the expected environment. Documented, not solved.
- Changing the `rrw.config.json` schema or the bridge data model.

## 3. Approach (decisions locked during brainstorming)

- **A — integrate react-grab as the selection engine** (vs. re-implementing the
  features ourselves). Chosen because the user wants react-grab's full feature
  set and a maintained implementation.
- **Multi-file code-splitting** delivery: drop `inlineDynamicImports` *for the
  react-grab path only*. `html2canvas` stays inlined as today. Result:
  `overlay.js` + `overlay-grab-[hash].js`.
- **Phase 1 = single-element only.** Multi-select is a separate future PR.
- react-grab resolves source **at runtime, no build-time plugin** → consumer
  setup story (`rrw-setup`) is unchanged except for copying the extra chunk.

## 4. Responsibility split (the core integration idea)

react-grab's own UI and clipboard copy **cannot be disabled**. We avoid conflict
by splitting the interaction **in time**:

- **Selection phase → react-grab owns it.** Hover highlight box, component-name
  label, ↑↓ component-stack navigation. Our overlay's existing `selecting`-mode
  hover-highlight + click capture (`DesignCommentOverlay.tsx:84-119`,
  `rrw-highlight`) is **disabled while react-grab is active**.
- **Comment phase → we own it.** Draft card, screenshot, bridge submit, status —
  all unchanged, all in our Shadow DOM.
- **Clipboard**: react-grab copies on grab and we cannot stop it. We override
  `getContent` to emit a minimal/useful string. The copy is treated as a benign
  side effect (it is even useful for pasting into an external agent).
- **react-grab renders in light DOM**, our overlay in Shadow DOM. They never draw
  simultaneously (selection phase vs comment phase), which keeps visual conflict
  to the hand-off moment only.

## 5. Data flow

```
user enters comment mode
  → import("react-grab")            // separate chunk, on-demand, cached after first load
  → engine.activate()
  → user selects an element / walks the component stack (react-grab UI)
  → engine.onGrab({ element, source, component })   // source = "file:line:col", component = name; either may be null
  → engine.deactivate()
  → capture(element, source)        // our selector.ts maps to Captured
  → draft card opens → comment text + screenshot → submit to bridge   // unchanged
```

**Source resolution order:** react-grab's runtime resolution first; if it returns
nothing, fall back to our existing `inspectFiber(element)`. The merged result
fills the existing `Captured.source` / `Captured.component` fields — **no schema
change**, the bridge contract is untouched.

## 6. The GrabEngine seam (for TDD)

react-grab is wrapped behind a small adapter interface so the overlay never
imports it directly and unit tests inject a fake:

```ts
export interface GrabSelection {
  element: Element;
  source: string | null;     // "file:line:col" when react-grab resolves it
  component: string | null;
}
export interface GrabEngine {
  activate(): void;
  deactivate(): void;
  onGrab(cb: (sel: GrabSelection) => void): () => void;  // returns unsubscribe
}
```

- **Production factory** `loadGrabEngine(): Promise<GrabEngine>` does the
  `import("react-grab")`, configures it (`getContent` override, activation mode),
  and maps its hooks (`onGrabbedBox` / `transformActionContext`) onto
  `GrabEngine`.
- **Tests** inject a `fakeGrabEngine` so the comment-mode flow is verified with no
  real import and no real DOM grab — consistent with the repo's
  "side-effects via runner injection" rule (CLAUDE.md / CONTRIBUTING.md).
- `DesignCommentOverlay` receives the engine via prop/factory so the existing
  component tests keep working and a new test drives:
  enter-mode → activate → fake grab → draft opens with source/component filled.

## 7. Build / vendoring changes

- `packages/overlay/vite.config.ts`: keep `inlineDynamicImports` behavior for
  html2canvas, but allow the react-grab `import()` to split into its own chunk.
  (Likely: a second `rollupOptions.output` manualChunk / a build that emits
  `overlay.js` + `overlay-grab-[hash].js`; exact mechanism settled in the plan.)
- `react` / `react-dom` stay external (host-provided), as today.
- **Vendoring + `rrw-setup`** currently assume a single `overlay.js`. They must
  copy/serve **all** emitted chunks and keep the chunk reachable from the host at
  runtime (relative path next to `overlay.js`). This is the widest ripple of the
  change and gets explicit integration-test coverage (the build emits ≥2 files;
  the setup copies them all).

## 8. Testing strategy (TDD — repo Iron Law)

- **Overlay unit/component (Vitest + Testing Library):**
  - comment-mode entry calls `engine.activate()`; exit calls `deactivate()`.
  - a fake `onGrab` opens the draft card with `Captured.source`/`component`
    populated from the selection.
  - source-resolution fallback: when `GrabSelection.source` is null, `capture`
    falls back to `inspectFiber` (existing tests stay green).
  - our legacy `selecting` hover-highlight/click handlers are NOT attached while
    the engine is active (no double-capture).
- **selector.ts:** `capture(el, source?)` precedence — explicit source wins over
  fiber-derived; existing `inspectFiber` tests unchanged.
- **Build/vendoring integration:** `pnpm --filter @rrw/overlay build` emits the
  base file + a react-grab chunk; the setup/vendoring step copies every emitted
  artifact (temp-dir integration test, mirroring the repo's real-git PR tests).

## 9. Risks & open decisions

| Risk | Severity | Mitigation |
|------|----------|------------|
| `onGrabbedBox` + `transformActionContext` may not hand back structured `file:line:col` cleanly | Med | First plan step is a spike; if absent, take only the `element` and resolve via our `inspectFiber` fallback — feature still ships, just no accuracy gain on React 19 until resolved |
| react-grab context-menu/toast visually clashes with our card at hand-off | Med | `deactivate()` before opening the draft; verify z-index / light-DOM vs Shadow DOM boundary during integration |
| Multi-file vendoring breaks an existing single-file assumption somewhere | Med | Integration test asserting all chunks are copied + reachable; audit `rrw-setup` copy logic |
| react-grab bundle is large even as a separate chunk | Low | It is on-demand and cached; base download unaffected (the whole point of §3) |
| Production host app → empty `file:line`, component-name only | Low | Documented dev-time limitation; matches existing fiber-based behavior |

## 10. Phasing (implementation order)

1. **Spike** — confirm react-grab's runtime API hands back `{element, source}` and
   that `getContent`/activation can be configured headlessly enough. Lock the
   `loadGrabEngine` mapping.
2. **GrabEngine seam** — interface + fake + a thin real adapter (TDD).
3. **Overlay wiring** — comment mode activates/deactivates the engine; grab opens
   the draft; legacy hover/click disabled while active; source fallback in
   `capture`.
4. **Build split** — emit the react-grab chunk; keep html2canvas inlined.
5. **Vendoring / `rrw-setup`** — copy all chunks; integration test.
6. **Docs** — note the dev-build source limitation; update overlay README/section.

**Phase 2 (separate PR, out of scope):** drag multi-select →
`Comment`/`NewComment.targets: Captured[]` → bridge + `docs/PROTOCOL.md` + agent.
