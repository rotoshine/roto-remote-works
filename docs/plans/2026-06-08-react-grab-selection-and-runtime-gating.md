# react-grab Selection Engine + Runtime-Gated Loader + React 19 Rule — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the overlay's hand-rolled element selection with react-grab as a (near-headless) selection + source engine, make the overlay load only on a host-owned runtime condition (zero bytes for normal users), and enforce React ≥ 19.

**Architecture:** A `GrabEngine` adapter wraps react-grab with **all of its own chrome disabled** (it is used purely as a selection/stack-nav/`getSource` engine; our Shadow-DOM highlight + draft card stay as the only UI). The overlay's "selecting" mode keeps the hover highlight but hands the click→capture to `engine.onGrab`, which runs `capture()` and overrides source/component from `api.getSource()`. A thin vendored loader (`rrw-loader.ts` + `useRrwOverlay.ts`) lazy-imports `overlay.js` only when the host enables it. react-grab ships **inside** `overlay.js` (single vendored artifact preserved).

**Tech Stack:** TypeScript (strict: `verbatimModuleSyntax`, `noUncheckedIndexedAccess`), React 19, Vite 5 (lib build, ESM), Vitest + Testing Library + jsdom, pnpm workspace. Spec: `docs/specs/2026-06-08-react-grab-element-selection-design.md`. Grounding spikes: `wf_bc209933-aad` (react-grab facts), `wf_af4e61bf-001` (plan review).

**Conventions:** pnpm only. Conventional Commits. Run `pnpm --filter @rrw/overlay test` and `pnpm --filter @rrw/overlay typecheck` green before each commit. react-grab@0.1.44 is already installed in `packages/overlay` (its install changed `pnpm-lock.yaml`).

> **Two `strict` gotchas to honor in every step below:** (1) `noUncheckedIndexedAccess` — never index an array/tuple without `?.` or a prior guard (e.g. `mock.calls[0]?.[0]`). (2) `verbatimModuleSyntax` — type-only imports must use `import type`.

---

## Task 1: Enforce React ≥ 19 (peer dep + setup gate + docs)

**Files:**
- Modify: `packages/overlay/package.json:6-9`
- Modify: `skills/rrw-setup/SKILL.md` (§2 Detect the stack)
- Modify: `CLAUDE.md`, `README.md`

- [ ] **Step 1: Bump overlay peer dependencies to React 19**

In `packages/overlay/package.json`:
```json
  "peerDependencies": {
    "react": ">=19",
    "react-dom": ">=19"
  },
```

- [ ] **Step 2: Verify install still resolves**

Run: `pnpm install`
Expected: completes; `pnpm-lock.yaml` may change (react-grab was just added) — stage it in Step 5.

- [ ] **Step 3: Add a React-19 gate to the setup skill**

In `skills/rrw-setup/SKILL.md`, in `## 2. Detect the stack`, after the "Read the project `package.json`" line, add:
```markdown
- **Require React ≥ 19.** Read the host's resolved `react` version. If it is **< 19**,
  STOP and tell the user: "roto-remote-works는 React 19 이상만 지원합니다 (현재
  <version>). 설치를 중단합니다." Do not vendor or wire anything. (This is a hard break;
  React 18 hosts must pin an older tag of this tool.)
```

- [ ] **Step 4: Document the rule (and the hard break)**

In `CLAUDE.md`, change `## 구조 (pnpm 모노레포, Node ≥ 22)` to:
```markdown
## 구조 (pnpm 모노레포, Node ≥ 22, 소비자 앱은 React ≥ 19)
```
In `README.md` requirements/prerequisites, add:
```markdown
- **React ≥ 19** (소비자 앱). 오버레이의 소스 매핑이 React 19의 fiber 디버그 정보(`_debugStack`)에
  의존합니다. React 18 사용자는 이전 태그를 고정해 사용하세요. (의도된 하드 브레이크)
```

- [ ] **Step 5: Commit**

```bash
git add packages/overlay/package.json skills/rrw-setup/SKILL.md CLAUDE.md README.md pnpm-lock.yaml
git commit -m "feat(overlay): require React >= 19 (peer dep + setup gate + docs)"
```

---

## Task 2: GrabEngine adapter (react-grab as a near-headless engine)

**Files:**
- Create: `packages/overlay/src/grab-engine.ts`
- Test: `packages/overlay/src/grab-engine.test.ts`
- Modify: `packages/overlay/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/overlay/src/grab-engine.test.ts`. Mocks are defined at **module scope** and forward args, so the same `vi.fn` instances are seen through `grab-engine.ts`'s dynamic `import("react-grab")`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const initFn = vi.fn();
const getGlobalApiFn = vi.fn<() => unknown>(() => null);
const registerPlugin = vi.fn();
const unregisterPlugin = vi.fn();
const dispose = vi.fn();
const getSource = vi.fn();
const activate = vi.fn();
const deactivate = vi.fn();

vi.mock("react-grab", () => ({
  init: (...a: unknown[]) => initFn(...a),
  getGlobalApi: (...a: unknown[]) => getGlobalApiFn(...a),
}));

import { loadGrabEngine } from "./grab-engine";

const api = { registerPlugin, unregisterPlugin, dispose, getSource, activate, deactivate };

beforeEach(() => {
  vi.clearAllMocks();
  initFn.mockReturnValue(api);
  getGlobalApiFn.mockReturnValue(null);
  (window as unknown as { __REACT_GRAB_DISABLED__?: boolean }).__REACT_GRAB_DISABLED__ = undefined;
});

it("intercepts the dynamic import and inits offline/freeze-safe", async () => {
  await loadGrabEngine();
  expect((window as unknown as { __REACT_GRAB_DISABLED__?: boolean }).__REACT_GRAB_DISABLED__).toBe(true);
  expect(initFn).toHaveBeenCalledTimes(1);
  expect(initFn).toHaveBeenCalledWith(
    expect.objectContaining({ telemetry: false, freezeReactUpdates: false }),
  );
});

it("registers a plugin with ALL react-grab chrome disabled", async () => {
  await loadGrabEngine();
  const plugin = registerPlugin.mock.calls[0]?.[0];
  expect(plugin).toBeDefined();
  expect(plugin.theme).toMatchObject({
    toolbar: { enabled: false },
    selectionBox: { enabled: false },
    dragBox: { enabled: false },
    grabbedBoxes: { enabled: false },
    elementLabel: { enabled: false },
  });
  expect(typeof plugin.hooks.onElementSelect).toBe("function");
});

it("onElementSelect emits a Grab (source from getSource) and returns false", async () => {
  getSource.mockResolvedValue({ filePath: "src/Button.tsx", lineNumber: 12, componentName: "Button" });
  const engine = await loadGrabEngine();
  const grabs: unknown[] = [];
  engine.onGrab((g) => grabs.push(g));
  const el = document.createElement("button");
  const plugin = registerPlugin.mock.calls[0]?.[0];
  expect(plugin).toBeDefined();
  const result = await plugin.hooks.onElementSelect(el);
  expect(result).toBe(false);
  expect(grabs).toEqual([{ element: el, source: "src/Button.tsx:12", component: "Button" }]);
});

it("falls back to null source when getSource rejects", async () => {
  getSource.mockRejectedValue(new Error("no source maps"));
  const engine = await loadGrabEngine();
  const grabs: Array<{ source: string | null; component: string | null }> = [];
  engine.onGrab((g) => grabs.push(g));
  await registerPlugin.mock.calls[0]?.[0].hooks.onElementSelect(document.createElement("div"));
  expect(grabs[0]).toEqual({ element: expect.any(Element), source: null, component: null });
});

it("dispose unregisters the plugin and disposes the api", async () => {
  const engine = await loadGrabEngine();
  engine.dispose();
  expect(unregisterPlugin).toHaveBeenCalledWith("roto-remote-works");
  expect(dispose).toHaveBeenCalled();
});

it("reuses an existing global instance instead of re-initing", async () => {
  getGlobalApiFn.mockReturnValue(api);
  await loadGrabEngine();
  expect(initFn).not.toHaveBeenCalled();
});

// spec §9 smoke-test #7, proven at the unit level: a disposed engine re-inits cleanly.
it("re-inits after dispose when no global instance survives", async () => {
  getGlobalApiFn.mockReturnValue(null);
  const e1 = await loadGrabEngine();
  e1.dispose();
  getGlobalApiFn.mockReturnValue(null);
  await loadGrabEngine();
  expect(initFn).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @rrw/overlay test grab-engine.test`
Expected: FAIL — `Cannot find module './grab-engine'`.

- [ ] **Step 3: Write the adapter**

Create `packages/overlay/src/grab-engine.ts`:
```ts
import type { ReactGrabAPI, SourceInfo } from "react-grab";

export interface Grab {
  element: Element;
  source: string | null; // "file:line" (react-grab getSource has no column)
  component: string | null;
}

export interface GrabEngine {
  activate(): void;
  deactivate(): void;
  onGrab(cb: (g: Grab) => void): () => void;
  dispose(): void;
}

const PLUGIN_NAME = "roto-remote-works";

function formatSource(s: SourceInfo | null): string | null {
  if (!s?.filePath) return null;
  return s.lineNumber != null ? `${s.filePath}:${s.lineNumber}` : s.filePath;
}

/**
 * Lazily load react-grab and wrap it as a near-headless GrabEngine. Every option
 * here is load-bearing — see spike wf_bc209933-aad:
 * - __REACT_GRAB_DISABLED__ before import: react-grab auto-inits at module-eval and
 *   would fire a telemetry fetch to react-grab.com.
 * - telemetry:false — no outbound calls (offline / Tailscale).
 * - freezeReactUpdates:false — default true monkeypatches the GLOBAL React dispatcher
 *   and would freeze our own overlay React tree.
 * - theme: ALL chrome off — we use react-grab only as a selection/source engine and
 *   render every visual ourselves (Shadow DOM). This also means react-grab injects no
 *   light-DOM UI, so its styles.css is not needed. (Re-enabling selectionBox/
 *   elementLabel for a native stack-nav label is a verified follow-up — see Task 8.)
 * - onElementSelect returns false — suppress react-grab's default clipboard copy.
 */
export async function loadGrabEngine(): Promise<GrabEngine> {
  (window as unknown as { __REACT_GRAB_DISABLED__?: boolean }).__REACT_GRAB_DISABLED__ = true;

  const rg = await import("react-grab");
  const api: ReactGrabAPI =
    rg.getGlobalApi() ?? rg.init({ telemetry: false, freezeReactUpdates: false });

  const subscribers = new Set<(g: Grab) => void>();

  api.registerPlugin({
    name: PLUGIN_NAME,
    theme: {
      toolbar: { enabled: false },
      selectionBox: { enabled: false },
      dragBox: { enabled: false },
      grabbedBoxes: { enabled: false },
      elementLabel: { enabled: false },
    },
    hooks: {
      onElementSelect: async (element: Element): Promise<boolean> => {
        let source: string | null = null;
        let component: string | null = null;
        try {
          const s = await api.getSource(element);
          source = formatSource(s);
          component = s?.componentName ?? null;
        } catch {
          /* prod build / no source maps — degrade to null, caller falls back */
        }
        for (const cb of subscribers) cb({ element, source, component });
        return false;
      },
    },
  });

  return {
    activate: () => api.activate(),
    deactivate: () => api.deactivate(),
    onGrab: (cb) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    dispose: () => {
      subscribers.clear();
      api.unregisterPlugin(PLUGIN_NAME);
      api.dispose();
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @rrw/overlay test grab-engine.test`
Expected: PASS (7 tests). If `init` is reported "not called" in the interception test, the dynamic-import mock is not applying — fix the mock before continuing (do not skip the test).

- [ ] **Step 5: Export the public types**

In `packages/overlay/src/index.ts`, after the `selector` export line:
```ts
export { loadGrabEngine, type GrabEngine, type Grab } from "./grab-engine";
```

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @rrw/overlay typecheck`
```bash
git add packages/overlay/src/grab-engine.ts packages/overlay/src/grab-engine.test.ts packages/overlay/src/index.ts
git commit -m "feat(overlay): GrabEngine adapter — react-grab as near-headless selection/source engine"
```

---

## Task 3: `capture()` accepts a source/component override

**Files:**
- Modify: `packages/overlay/src/selector.ts:70-83`
- Test: `packages/overlay/src/selector.test.ts`

- [ ] **Step 1: Write the failing test (strengthened so removing the fallback fails it)**

Add to `packages/overlay/src/selector.test.ts`. Spy on `inspectFiber` so the fallback path is actually exercised (jsdom has no fiber, so without a spy the test passes even if the fallback were deleted):
```ts
import * as selectorModule from "./selector";
import { capture } from "./selector";

describe("capture with override", () => {
  it("prefers an explicit source/component over fiber inspection", () => {
    const el = document.createElement("div");
    const c = capture(el, { source: "src/Foo.tsx:3", component: "Foo" });
    expect(c.source).toBe("src/Foo.tsx:3");
    expect(c.component).toBe("Foo");
  });

  it("falls back to fiber inspection per-field when override is null", () => {
    const spy = vi
      .spyOn(selectorModule, "inspectFiber")
      .mockReturnValue({ source: "fallback:5", component: "FallbackComponent" });
    const el = document.createElement("div");
    const c = capture(el, { source: null, component: null });
    expect(c.source).toBe("fallback:5");
    expect(c.component).toBe("FallbackComponent");
    spy.mockRestore();
  });
});
```
(Ensure `vi` is imported in this file; add it to the `vitest` import if missing.)

> Note: for `vi.spyOn` on a same-module function to intercept the internal call, `capture` must call it via the module namespace OR the spy must target the bound reference. If the spy does not intercept (because `capture` calls a local `inspectFiber` directly), instead assert behavior by mounting a real fibered element is impractical in jsdom — in that case keep the spy but call through `selectorModule.capture` and have `capture` reference `inspectFiber` through the module. Simplest robust approach: in Step 3, keep `capture` and `inspectFiber` in the same module and let the test spy on the export; if Vitest cannot rebind it, change the assertion to inject the fallback via a default param (see Step 3 alternative).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @rrw/overlay test selector.test`
Expected: FAIL — `capture` ignores the override argument.

- [ ] **Step 3: Implement the override**

In `packages/overlay/src/selector.ts`, replace the `capture` function (lines 70-83) with:
```ts
/** Capture everything the bridge needs to locate the clicked element.
 *  An optional `override` (e.g. react-grab's getSource result) wins per-field over
 *  fiber inspection; when a field is null we fall back to inspectFiber. */
export function capture(
  el: Element,
  override?: { source: string | null; component: string | null },
): Captured {
  const r = el.getBoundingClientRect();
  const fiber = inspectFiber(el);
  return {
    selector: cssPath(el),
    tag: el.tagName.toLowerCase(),
    classes: typeof el.className === "string" ? el.className : "",
    text: (el.textContent ?? "").trim().slice(0, 200),
    component: override?.component ?? fiber.component,
    source: override?.source ?? fiber.source,
    rect: { x: r.x, y: r.y, w: r.width, h: r.height },
  };
}
```
**Alternative if the spy cannot intercept** (Vitest + ESM may not rebind a same-module call): add an injectable fallback param used only by tests —
```ts
export function capture(
  el: Element,
  override?: { source: string | null; component: string | null },
  inspect: (el: Element) => { source: string | null; component: string | null } = inspectFiber,
): Captured { /* use inspect(el) instead of inspectFiber(el) */ }
```
and have the test pass a stub `inspect`. Pick whichever the test runner actually honors; do not ship a test that passes with the fallback deleted.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @rrw/overlay test selector.test`
Expected: PASS (new + existing green).

- [ ] **Step 5: Commit**

```bash
git add packages/overlay/src/selector.ts packages/overlay/src/selector.test.ts
git commit -m "feat(overlay): capture() accepts per-field source/component override"
```

---

## Task 4: Drive selection with the GrabEngine (keep the Shadow-DOM highlight)

We use react-grab for the **select gesture + stack-nav + source**, but keep our own
hover highlight and draft card (react-grab's chrome is all off). We replace only the
click→capture path; the mousemove highlight and Esc stay.

**Files:**
- Modify: `packages/overlay/src/DesignCommentOverlay.tsx`
- Test: `packages/overlay/src/DesignCommentOverlay.test.tsx`

- [ ] **Step 1: Write the failing test**

In `packages/overlay/src/DesignCommentOverlay.test.tsx`: extend the testing-library import to `import { render, screen, fireEvent, waitFor } from "@testing-library/react";`, add `import type { GrabEngine, Grab } from "./grab-engine";`, and reuse the file's existing `fakeClient()`. `fakeEngine` exposes `waitReady()` so we never emit before `onGrab` subscribes. Render with `pollMs={0}` to avoid the 1500ms poll interval leaking:
```ts
function fakeEngine() {
  let emit: ((g: Grab) => void) | undefined;
  const engine: GrabEngine = {
    activate: vi.fn(),
    deactivate: vi.fn(),
    onGrab: (cb) => {
      emit = cb;
      return () => {
        emit = undefined;
      };
    },
    dispose: vi.fn(),
  };
  const waitReady = () => vi.waitUntil(() => emit !== undefined);
  return { engine, waitReady, grab: (g: Grab) => emit?.(g) };
}

it("activates the engine in selecting mode and opens a draft on grab", async () => {
  const { engine, waitReady, grab } = fakeEngine();
  render(<DesignCommentOverlay client={fakeClient()} pollMs={0} grabEngineLoader={async () => engine} />);
  fireEvent.click(screen.getByRole("button", { name: /코멘트/ }));
  await waitFor(() => expect(engine.activate).toHaveBeenCalled());
  await waitReady();

  const el = document.createElement("button");
  document.body.appendChild(el);
  grab({ element: el, source: "src/Button.tsx:12", component: "Button" });

  await waitFor(() => expect(screen.getByText(/<Button>/)).toBeInTheDocument());
});

it("ignores grabs on the overlay's own host", async () => {
  const { engine, waitReady, grab } = fakeEngine();
  render(<DesignCommentOverlay client={fakeClient()} pollMs={0} grabEngineLoader={async () => engine} />);
  fireEvent.click(screen.getByRole("button", { name: /코멘트/ }));
  await waitFor(() => expect(engine.activate).toHaveBeenCalled());
  await waitReady();

  const host = document.createElement("div");
  host.setAttribute("data-rrw-host", "");
  const inner = document.createElement("span");
  host.appendChild(inner);
  document.body.appendChild(host);
  grab({ element: inner, source: null, component: null });

  expect(screen.queryByPlaceholderText("이 요소 수정 요청…")).not.toBeInTheDocument();
});

it("deactivates on exit and disposes on unmount", async () => {
  const { engine, waitReady } = fakeEngine();
  const { unmount } = render(
    <DesignCommentOverlay client={fakeClient()} pollMs={0} grabEngineLoader={async () => engine} />,
  );
  fireEvent.click(screen.getByRole("button", { name: /코멘트/ }));
  await waitFor(() => expect(engine.activate).toHaveBeenCalled());
  await waitReady();
  fireEvent.click(screen.getByRole("button", { name: /취소/ }));
  await waitFor(() => expect(engine.deactivate).toHaveBeenCalled());
  unmount();
  expect(engine.dispose).toHaveBeenCalled();
});

it("disposes even if unmounted while the engine is still loading", async () => {
  let resolve!: (e: GrabEngine) => void;
  const pending = new Promise<GrabEngine>((r) => (resolve = r));
  const { engine } = fakeEngine();
  const { unmount } = render(
    <DesignCommentOverlay client={fakeClient()} pollMs={0} grabEngineLoader={() => pending} />,
  );
  fireEvent.click(screen.getByRole("button", { name: /코멘트/ }));
  unmount();
  resolve(engine);
  await waitFor(() => expect(engine.dispose).toHaveBeenCalled());
  expect(engine.onGrab).not.toHaveBeenCalled(); // never subscribed after unmount
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @rrw/overlay test DesignCommentOverlay.test`
Expected: FAIL — `grabEngineLoader` prop unknown; engine not used.

- [ ] **Step 3: Add the prop and the engine-driven select path (keep the highlight)**

In `packages/overlay/src/DesignCommentOverlay.tsx`:

(a) imports:
```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { loadGrabEngine, type GrabEngine, type Grab } from "./grab-engine";
```

(b) props — add the injectable loader (default = real adapter):
```ts
export interface DesignCommentOverlayProps {
  client: BridgeClient;
  pollMs?: number;
  origin?: ApplyOrigin;
  captureScreenshot?: () => Promise<string | null>;
  author?: string;
  /** Injected for tests; defaults to the real react-grab adapter. */
  grabEngineLoader?: () => Promise<GrabEngine>;
}
```
and destructure `grabEngineLoader = loadGrabEngine,`.

(c) Add an engine ref + unmount disposal, and **rewrite the body of the existing
`mode==="selecting"` effect (lines 86-128)**: KEEP the `onMove` hover highlight and
the `onKey` Esc handler; REMOVE the `onClick` capture (react-grab now performs
selection); load + activate the engine and subscribe to `onGrab`:
```ts
  const engineRef = useRef<Promise<GrabEngine> | null>(null);

  useEffect(() => {
    return () => {
      void engineRef.current?.then((e) => e.dispose());
    };
  }, []);

  useEffect(() => {
    if (mode !== "selecting") {
      setHover(null);
      return;
    }
    let disposed = false;
    let unsub: (() => void) | undefined;
    if (!engineRef.current) engineRef.current = grabEngineLoader();
    void engineRef.current.then((engine) => {
      if (disposed) return; // unmounted/exited while loading — do not subscribe
      unsub = engine.onGrab((g: Grab) => {
        if (g.element instanceof Element && g.element.closest("[data-rrw-host]")) return;
        const r = g.element.getBoundingClientRect();
        setDraft({ ...capture(g.element, { source: g.source, component: g.component }), px: r.left, py: r.top });
        setDraftText("");
        setDraftPos(clampToViewport({ left: r.left, top: r.top + 12 }, DRAFT_SIZE, viewport()));
        setHover(null);
        setMode("off");
      });
      engine.activate();
    });

    const isUi = (t: EventTarget | null) => t instanceof Element && !!t.closest("[data-rrw-ui]");
    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || isUi(el)) return setHover(null);
      const r = el.getBoundingClientRect();
      setHover({ left: r.left, top: r.top, width: r.width, height: r.height });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMode("off");
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("keydown", onKey, true);
    document.body.style.cursor = "crosshair";
    return () => {
      disposed = true;
      unsub?.();
      void engineRef.current?.then((e) => e.deactivate());
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("keydown", onKey, true);
      document.body.style.cursor = "";
      setHover(null);
    };
  }, [mode, grabEngineLoader]);
```
Keep the `hover` state (line 51) and the `rrw-highlight` render (lines 193-199) **as-is** — they remain the selection-time visual. (Switching to react-grab's native highlight/label is the verified follow-up in Task 8.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @rrw/overlay test DesignCommentOverlay.test`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @rrw/overlay typecheck`
```bash
git add packages/overlay/src/DesignCommentOverlay.tsx packages/overlay/src/DesignCommentOverlay.test.tsx
git commit -m "feat(overlay): react-grab drives the select gesture (keep Shadow-DOM highlight)"
```

---

## Task 5: Build guards + single-file artifact integration test (env-gated)

**Files:**
- Modify: `packages/overlay/vite.config.ts`
- Create: `packages/overlay/build.test.ts`

- [ ] **Step 1: Add the @react-grab/cli guards (preserve existing external entries)**

In `packages/overlay/vite.config.ts`:
```ts
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ["@react-grab/cli"] },
  build: {
    cssCodeSplit: false,
    lib: {
      entry: resolve(import.meta.dirname, "src/index.ts"),
      formats: ["es"],
      fileName: () => "overlay.js",
    },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime", "react-dom/client", "@react-grab/cli"],
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
```

- [ ] **Step 2: Write the build test, gated out of the default `pnpm -r test`**

Create `packages/overlay/build.test.ts`. It runs a real build, so it is **gated behind `RRW_BUILD_TEST=1`** to avoid firing (and racing `dist/`) during the standard `pnpm -r test` gate:
```ts
import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const RUN = process.env.RRW_BUILD_TEST === "1";
const dist = resolve(import.meta.dirname, "dist");

describe.runIf(RUN)("overlay build artifact", () => {
  beforeAll(() => {
    execSync("pnpm build", { cwd: resolve(import.meta.dirname), stdio: "inherit" }); // throws on non-zero
    if (!existsSync(resolve(dist, "overlay.js"))) throw new Error("build did not emit overlay.js");
  }, 180_000);

  it("emits a single overlay.js (single-file vendoring contract)", () => {
    expect(readdirSync(dist).filter((f) => f.endsWith(".js"))).toEqual(["overlay.js"]);
  });

  it("bundles react-grab but not the Node @react-grab/cli", () => {
    const code = readFileSync(resolve(dist, "overlay.js"), "utf8");
    expect(code).toMatch(/react-grab/); // positive: react-grab IS bundled, not externalized
    expect(code).not.toMatch(/from\s*['"]@react-grab\/cli/);
    expect(code).not.toMatch(/require\(\s*['"]@react-grab\/cli/);
    expect(code).not.toMatch(/['"]node:child_process['"]/);
  });
});
```

- [ ] **Step 3: Run the gated build test explicitly**

Run: `RRW_BUILD_TEST=1 pnpm --filter @rrw/overlay test build.test`
Expected: PASS — one `overlay.js`; react-grab present; no `@react-grab/cli` import / `node:child_process`.
Also confirm it is SKIPPED by default: `pnpm --filter @rrw/overlay test` does not run the build suite.

- [ ] **Step 4: Commit**

```bash
git add packages/overlay/vite.config.ts packages/overlay/build.test.ts
git commit -m "build(overlay): guard @react-grab/cli out; assert single-file artifact (RRW_BUILD_TEST)"
```

---

## Task 6: Runtime-gated loader (`rrw-loader` + `useRrwOverlay`)

The loader must be vendorable into hosts where **only `overlay.js` is copied** (no
`mount.tsx`, no `.d.ts`). Therefore it **inlines its own config type** and never
imports types from sibling source files. In-package it does `import("./index")`;
`rrw-setup` rewrites that to `import("./overlay.js")` when vendoring.

**Files:**
- Create: `packages/overlay/src/rrw-loader.ts`
- Create: `packages/overlay/src/useRrwOverlay.ts`
- Test: `packages/overlay/src/rrw-loader.test.ts`
- Modify: `packages/overlay/src/index.ts`

- [ ] **Step 1: Write the failing loader test**

Create `packages/overlay/src/rrw-loader.test.ts`. `startRrw` does `import("./index")`, so mock `./index`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mountOverlay = vi.fn();
const unmount = vi.fn();
vi.mock("./index", () => ({ mountOverlay: (...a: unknown[]) => mountOverlay(...a) }));

import { startRrw, stopRrw, isRrwRunning } from "./rrw-loader";

beforeEach(() => {
  vi.clearAllMocks();
  mountOverlay.mockReturnValue(unmount);
  stopRrw();
});

it("starts once even under concurrent calls", async () => {
  await Promise.all([startRrw({ bridgeUrl: "x", token: "t" }), startRrw({ bridgeUrl: "x", token: "t" })]);
  expect(mountOverlay).toHaveBeenCalledTimes(1);
  expect(isRrwRunning()).toBe(true);
});

it("stop unmounts", async () => {
  await startRrw({ bridgeUrl: "x", token: "t" });
  stopRrw();
  expect(unmount).toHaveBeenCalled();
  expect(isRrwRunning()).toBe(false);
});

it("exposes window.__rrw", () => {
  const w = window as unknown as { __rrw?: { start: unknown; stop: unknown } };
  expect(typeof w.__rrw?.start).toBe("function");
  expect(typeof w.__rrw?.stop).toBe("function");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @rrw/overlay test rrw-loader.test`
Expected: FAIL — `Cannot find module './rrw-loader'`.

- [ ] **Step 3: Write the loader (inline config type — no `./mount` import)**

Create `packages/overlay/src/rrw-loader.ts`:
```ts
/** Minimal mount config the loader passes through to mountOverlay. Inlined (not
 *  imported from ./mount) so the vendored loader resolves in any host where only
 *  overlay.js is copied. `token` is the BROWSER bearer = the LOW-trust clientToken;
 *  the high-trust token is server-only (RRW_TOKEN env) and must never be bundled. */
export interface RrwLoaderConfig {
  bridgeUrl?: string;
  token?: string;
  author?: string;
  pollMs?: number;
}

let unmount: (() => void) | undefined;
let starting: Promise<void> | undefined;

/** Lazy-load and mount the overlay. Idempotent; callable from a host effect, a
 *  console, or vConsole. The dynamic import keeps the heavy chunk out of every
 *  normal user's bundle. */
export async function startRrw(config: RrwLoaderConfig = {}): Promise<void> {
  if (unmount) return;
  if (starting) return starting;
  starting = import("./index")
    .then((m: { mountOverlay: (c: RrwLoaderConfig) => () => void }) => {
      unmount = m.mountOverlay(config);
    })
    .finally(() => {
      starting = undefined;
    });
  return starting;
}

export function stopRrw(): void {
  unmount?.();
  unmount = undefined;
}

export function isRrwRunning(): boolean {
  return !!unmount;
}

if (typeof window !== "undefined") {
  (window as unknown as { __rrw?: unknown }).__rrw = {
    start: startRrw,
    stop: stopRrw,
    isRunning: isRrwRunning,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @rrw/overlay test rrw-loader.test`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the React hook**

Create `packages/overlay/src/useRrwOverlay.ts` (imports the inlined type from `./rrw-loader`, not `./mount`):
```ts
import { useEffect } from "react";
import { startRrw, stopRrw, type RrwLoaderConfig } from "./rrw-loader";

/** Declarative host-owned activation. Pass `enabled` computed from your own
 *  userId/role/flag; when true the overlay lazy-loads and mounts, when false
 *  (normal users) nothing is fetched. `config` must be a STABLE reference
 *  (module-scope or memoized): the effect re-runs only on `enabled` changes — to
 *  change config, call stopRrw() then re-enable. */
export function useRrwOverlay(enabled: boolean, config: RrwLoaderConfig = {}): void {
  useEffect(() => {
    if (!enabled) return;
    void startRrw(config);
    return () => stopRrw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
```

- [ ] **Step 6: Export from index.ts**

```ts
export { startRrw, stopRrw, isRrwRunning, type RrwLoaderConfig } from "./rrw-loader";
export { useRrwOverlay } from "./useRrwOverlay";
```

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm --filter @rrw/overlay typecheck`
```bash
git add packages/overlay/src/rrw-loader.ts packages/overlay/src/useRrwOverlay.ts packages/overlay/src/rrw-loader.test.ts packages/overlay/src/index.ts
git commit -m "feat(overlay): runtime-gated loader (startRrw/stopRrw + useRrwOverlay + window.__rrw)"
```

---

## Task 7: Rewire `rrw-setup` — host-owned runtime gating (DOCUMENTATION ONLY)

`rrw-setup` is an **agent-followed SKILL guide**, not executable build code. This task
only edits `skills/rrw-setup/SKILL.md`. The `cp`/`sed` lines are prose instructions an
agent or human runs by hand during setup.

**Files:**
- Modify: `skills/rrw-setup/SKILL.md` (§3 Vendor, §4 Wire)

- [ ] **Step 1: Vendor the loader files alongside overlay.js**

In `## 3. Vendor the overlay`, change the copy step:
```bash
mkdir -p components/rrw
cp .rrw/packages/overlay/dist/overlay.js components/rrw/overlay.js
cp .rrw/packages/overlay/src/rrw-loader.ts components/rrw/rrw-loader.ts
cp .rrw/packages/overlay/src/useRrwOverlay.ts components/rrw/useRrwOverlay.ts
# the vendored loader imports the built bundle, not the TS source:
sed -i '' 's#import("./index")#import("./overlay.js")#' components/rrw/rrw-loader.ts
```
Add prose: the loader inlines `RrwLoaderConfig`, so no other source files are needed;
`overlay.js` has no type defs in the host (`mountOverlay` is untyped there) — acceptable.

- [ ] **Step 2: Replace the NODE_ENV gate with host-owned runtime gating (clientToken ONLY)**

Replace the `RrwOverlay.tsx` block and `## 4. Wire it dev-gated` with:
```markdown
## 4. Wire it — host-owned runtime gating (works in production)
The overlay is **not** build-gated. The host decides who sees it; only then is the
bundle fetched (normal users fetch nothing). Two ways:

**React hook (recommended):**
```tsx
"use client";
import { useRrwOverlay } from "@/components/rrw/useRrwOverlay";
import rrwConfig from "@/rrw.config.json";
// Browser uses the LOW-trust clientToken ONLY. The high-trust `token` is server-only
// (RRW_TOKEN env on the bridge/agent hosts) and MUST NOT be referenced here — in a
// runtime-gated prod build the whole config is bundled, so a `?? cfg.token` fallback
// would ship the high-trust token to every privileged browser.
const cfg = rrwConfig as { bridgeUrl?: string; clientToken?: string; author?: string };

export function RrwGate() {
  // Replace with YOUR own condition (role, userId allowlist, feature flag, query string…).
  const enabled =
    typeof window !== "undefined" && new URLSearchParams(location.search).get("rrw") === "1";
  useRrwOverlay(enabled, { bridgeUrl: cfg.bridgeUrl, token: cfg.clientToken ?? "", author: cfg.author });
  return null;
}
```
Render `<RrwGate />` unconditionally (Next `app/layout.tsx` `<body>`, or Vite root).

**Imperative / vConsole:** `window.__rrw.start({ bridgeUrl, token: clientToken })` starts
it; `window.__rrw.stop()` removes it.

> ⚠️ **The gate is UX convenience, not a security boundary.** Anyone who flips it
> (URL param / localStorage / devtools) can fetch the lazy chunk and read the
> `clientToken` — which is low-trust and expected to be browser-visible. The real
> boundaries are the bridge's **network gating** (Tailscale/Cloudflare Access) and the
> **operator-gated `apply`**; loading the overlay can never trigger code edits. In a
> two-token prod build, keep only `bridgeUrl` + `clientToken` in `rrw.config.json`.
```

- [ ] **Step 3: Commit**

```bash
git add skills/rrw-setup/SKILL.md
git commit -m "docs(rrw-setup): host-owned runtime gating, clientToken-only browser wiring, vendor loader"
```

---

## Task 8: Runtime smoke-tests (acceptance-bearing) + optional native label + docs

**Files:**
- Create: `docs/specs/2026-06-08-react-grab-smoke-tests.md`
- Modify: `README.md`; possibly `packages/overlay/src/grab-engine.ts`

- [ ] **Step 1: Scaffold and run against a real React-19 app**

Scaffold a throwaway React 19 + Vite app, vendor the built overlay + loader files, wire
`useRrwOverlay(true, { bridgeUrl, token: clientToken })` against a local bridge, run it,
and record pass/fail with an explicit criterion per item in
`docs/specs/2026-06-08-react-grab-smoke-tests.md`:
1. **Column dependency** — inspect the agent apply path (`packages/agent`); PASS if it
   matches on `file:line` without needing `:col`.
2. **Programmatic activation** — PASS if `api.activate()` (via entering selecting mode)
   lets a click select, with NO react-grab activation key, and no host key hijack.
3. **Shadow-DOM hit-testing** — PASS if clicking our FAB/draft is not captured as a
   selectable element and hover targets host elements (the `[data-rrw-host]` guard holds).
4. **No stray chrome** — PASS if nothing from react-grab renders (all chrome themed off);
   no unstyled boxes.
5. **Copy suppression** — PASS if selecting does NOT write the clipboard or show a flash.
   If it does, add `onBeforeCopy`/`transformCopyContent` guards in `grab-engine.ts`.
6. **Freeze tradeoff** — PASS if the overlay (draft card, progress panel) stays
   interactive during selection and the host stays usable (`freezeReactUpdates:false`).
7. **dispose/re-mount** — PASS if activate→select→deactivate→dispose then re-enable
   re-inits cleanly (covered at unit level in Task 2; confirm in-browser).

- [ ] **Step 2: Apply fixes for any failing item (test-first where possible), then re-run**

For each failure, implement the spec §9 mitigation with a matching unit test where
feasible, re-run that smoke-test, update the doc, and commit per fix. Do not open the PR
with any previously-failing item left red.

- [ ] **Step 3: (Optional) enable react-grab's native stack-nav label**

Only if the team wants the floating component-name label during hover (and #4 stays
clean): in `grab-engine.ts` set `selectionBox.enabled` / `elementLabel.enabled` to
`true`, `import "react-grab/styles.css"` (light DOM) at the top of the adapter, remove
our `hover`/`rrw-highlight`, and re-verify #3/#4 in-browser. Otherwise keep our highlight.
Commit separately.

- [ ] **Step 4: Document the feature**

In `README.md` (overlay/usage): host-owned runtime gating (hook + imperative + vConsole),
the React ≥ 19 requirement, and the dev-build source-mapping limitation (prod yields
component name only / null). Commit:
```bash
git add README.md docs/specs/2026-06-08-react-grab-smoke-tests.md
git commit -m "docs: react-grab selection + runtime gating usage; smoke-test results"
```

- [ ] **Step 5: Full gate before the PR**

Run: `pnpm -r test && pnpm -r typecheck`
Expected: all green (the build suite stays skipped unless `RRW_BUILD_TEST=1`).

---

## Self-Review notes (for the implementer)

- **Spec coverage:** Task 1 → §6. Tasks 2–4 → §4 (A). Task 5 → §7. Task 6 → §5 (B). Task 7 → §5/§6 wiring + §10 security. Task 8 → §9 smoke-tests.
- **Token safety (critical):** browser code uses `clientToken` only (`token: cfg.clientToken ?? ""`); never `?? cfg.token`. The high-trust token stays server-side (`RRW_TOKEN`).
- **Type consistency:** `Grab { element, source, component }` and `GrabEngine { activate, deactivate, onGrab, dispose }` identical in Tasks 2 & 4. `capture(el, override?)` (Task 3) matches its call in Task 4. `RrwLoaderConfig` (Task 6) is inlined and reused by `useRrwOverlay`; the vendored loader imports no sibling source types.
- **`strict` honored:** `mock.calls[0]?.[0]` everywhere; `import type` for type-only imports.
- **Out of scope (Phase 2):** multi-select / `Comment.targets`. Do not add it here.
```
