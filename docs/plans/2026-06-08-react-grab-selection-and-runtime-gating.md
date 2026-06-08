# react-grab Selection Engine + Runtime-Gated Loader + React 19 Rule — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the overlay's hand-rolled element selection with react-grab (component-unit selection, labels, React-19-correct source), make the overlay load only on a host-owned runtime condition (zero bytes for normal users), and enforce React ≥ 19.

**Architecture:** A `GrabEngine` adapter wraps react-grab (injected for tests). The overlay's "selecting" mode drives `engine.activate()`; `onGrab` runs the existing `capture()` and overrides source/component from `api.getSource()`. A thin vendored loader (`rrw-loader.ts` + `useRrwOverlay.ts`) lazy-imports `overlay.js` only when the host enables it. react-grab ships **inside** `overlay.js` (single vendored artifact preserved).

**Tech Stack:** TypeScript (strict), React 19, Vite 5 (lib build, ESM), Vitest + Testing Library + jsdom, pnpm workspace. Spec: `docs/specs/2026-06-08-react-grab-element-selection-design.md`. Grounding spike: `wf_bc209933-aad`.

**Conventions:** pnpm only. Conventional Commits. Run `pnpm --filter @rrw/overlay test` and `pnpm --filter @rrw/overlay typecheck` green before each commit. react-grab@0.1.44 is already installed in `packages/overlay`.

---

## Task 1: Enforce React ≥ 19 (peer dep + setup gate + docs)

**Files:**
- Modify: `packages/overlay/package.json:6-9`
- Modify: `skills/rrw-setup/SKILL.md` (§2 Detect the stack)
- Modify: `CLAUDE.md` (structure line), `README.md` (requirements)

- [ ] **Step 1: Bump overlay peer dependencies to React 19**

In `packages/overlay/package.json` change:
```json
  "peerDependencies": {
    "react": ">=19",
    "react-dom": ">=19"
  },
```

- [ ] **Step 2: Verify install still resolves**

Run: `pnpm install`
Expected: completes; no peer-dependency error (root dev React is `^19`).

- [ ] **Step 3: Add a React-19 gate to the setup skill**

In `skills/rrw-setup/SKILL.md`, in `## 2. Detect the stack`, after the "Read the project `package.json`" line, add:
```markdown
- **Require React ≥ 19.** Read the host's resolved `react` version (`package.json`
  dependencies or `node_modules/react/package.json`). If it is **< 19**, STOP and tell
  the user: "roto-remote-works는 React 19 이상만 지원합니다 (현재 <version>). 설치를
  중단합니다." Do not vendor or wire anything.
```

- [ ] **Step 4: Document the rule**

In `CLAUDE.md`, change the structure heading line `## 구조 (pnpm 모노레포, Node ≥ 22)` to:
```markdown
## 구조 (pnpm 모노레포, Node ≥ 22, 소비자 앱은 React ≥ 19)
```
In `README.md`, find the requirements/prerequisites section and add a bullet:
```markdown
- **React ≥ 19** (소비자 앱). 오버레이의 소스 매핑이 React 19의 fiber 디버그 정보에 의존합니다.
```

- [ ] **Step 5: Commit**

```bash
git add packages/overlay/package.json skills/rrw-setup/SKILL.md CLAUDE.md README.md pnpm-lock.yaml
git commit -m "feat(overlay): require React >= 19 (peer dep + setup gate + docs)"
```

---

## Task 2: GrabEngine interface + fake + real adapter

**Files:**
- Create: `packages/overlay/src/grab-engine.ts`
- Test: `packages/overlay/src/grab-engine.test.ts`
- Modify: `packages/overlay/src/index.ts` (export the types)

- [ ] **Step 1: Write the failing test for the real adapter**

Create `packages/overlay/src/grab-engine.test.ts`. It mocks the `react-grab` module and asserts the adapter wires it correctly.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture what the adapter passes to react-grab.
const init = vi.fn();
const registerPlugin = vi.fn();
const unregisterPlugin = vi.fn();
const dispose = vi.fn();
const getSource = vi.fn();
const activate = vi.fn();
const deactivate = vi.fn();
const getGlobalApi = vi.fn(() => null);

const api = { init, registerPlugin, unregisterPlugin, dispose, getSource, activate, deactivate };
init.mockReturnValue({ registerPlugin, unregisterPlugin, dispose, getSource, activate, deactivate });

vi.mock("react-grab", () => ({
  init: (...a: unknown[]) => init(...a),
  getGlobalApi: () => getGlobalApi(),
}));

import { loadGrabEngine } from "./grab-engine";

describe("loadGrabEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    init.mockReturnValue({ registerPlugin, unregisterPlugin, dispose, getSource, activate, deactivate });
    getGlobalApi.mockReturnValue(null);
    (window as unknown as { __REACT_GRAB_DISABLED__?: boolean }).__REACT_GRAB_DISABLED__ = undefined;
  });

  it("disables auto-init before import and inits offline/freeze-safe", async () => {
    await loadGrabEngine();
    expect((window as unknown as { __REACT_GRAB_DISABLED__?: boolean }).__REACT_GRAB_DISABLED__).toBe(true);
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ telemetry: false, freezeReactUpdates: false }),
    );
  });

  it("registers a plugin with react-grab chrome themed off", async () => {
    await loadGrabEngine();
    const plugin = registerPlugin.mock.calls[0][0];
    expect(plugin.theme).toEqual({ toolbar: { enabled: false }, grabbedBoxes: { enabled: false } });
    expect(typeof plugin.hooks.onElementSelect).toBe("function");
  });

  it("onElementSelect emits a Grab (source from getSource) and returns false", async () => {
    getSource.mockResolvedValue({ filePath: "src/Button.tsx", lineNumber: 12, componentName: "Button" });
    const engine = await loadGrabEngine();
    const grabs: unknown[] = [];
    engine.onGrab((g) => grabs.push(g));
    const el = document.createElement("button");
    const plugin = registerPlugin.mock.calls[0][0];
    const result = await plugin.hooks.onElementSelect(el);
    expect(result).toBe(false);
    expect(grabs).toEqual([{ element: el, source: "src/Button.tsx:12", component: "Button" }]);
  });

  it("dispose unregisters the plugin and disposes the api", async () => {
    const engine = await loadGrabEngine();
    engine.dispose();
    expect(unregisterPlugin).toHaveBeenCalledWith("roto-remote-works");
    expect(dispose).toHaveBeenCalled();
  });

  it("reuses an existing global instance instead of re-initing", async () => {
    getGlobalApi.mockReturnValue({ registerPlugin, unregisterPlugin, dispose, getSource, activate, deactivate });
    await loadGrabEngine();
    expect(init).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @rrw/overlay test grab-engine`
Expected: FAIL — `Cannot find module './grab-engine'`.

- [ ] **Step 3: Write the adapter**

Create `packages/overlay/src/grab-engine.ts`:
```ts
import type { ReactGrabAPI, SourceInfo } from "react-grab";

export interface Grab {
  element: Element;
  source: string | null; // "file:line" (no column — react-grab getSource has none)
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
 * Lazily load react-grab and wrap it as a GrabEngine. Must be called from the
 * browser. Every option here is load-bearing — see the spike (wf_bc209933-aad):
 * - __REACT_GRAB_DISABLED__ before import: react-grab auto-inits at module-eval
 *   and would fire a telemetry fetch to react-grab.com.
 * - telemetry:false — no outbound calls (offline / Tailscale).
 * - freezeReactUpdates:false — default true monkeypatches the GLOBAL React
 *   dispatcher and would freeze our own overlay React tree.
 * - theme toolbar/grabbedBoxes off — suppress react-grab's own chrome.
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
    theme: { toolbar: { enabled: false }, grabbedBoxes: { enabled: false } },
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

Run: `pnpm --filter @rrw/overlay test grab-engine`
Expected: PASS (5 tests).

- [ ] **Step 5: Export the public types**

In `packages/overlay/src/index.ts`, add after the `selector` export line:
```ts
export { loadGrabEngine, type GrabEngine, type Grab } from "./grab-engine";
```

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @rrw/overlay typecheck`
Expected: no errors.
```bash
git add packages/overlay/src/grab-engine.ts packages/overlay/src/grab-engine.test.ts packages/overlay/src/index.ts
git commit -m "feat(overlay): GrabEngine adapter wrapping react-grab (telemetry/freeze/chrome off)"
```

---

## Task 3: `capture()` accepts a source/component override

**Files:**
- Modify: `packages/overlay/src/selector.ts:70-83`
- Test: `packages/overlay/src/selector.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/overlay/src/selector.test.ts`:
```ts
import { capture } from "./selector";

describe("capture with override", () => {
  it("prefers an explicit source/component over fiber inspection", () => {
    const el = document.createElement("div");
    const c = capture(el, { source: "src/Foo.tsx:3", component: "Foo" });
    expect(c.source).toBe("src/Foo.tsx:3");
    expect(c.component).toBe("Foo");
  });

  it("falls back to fiber inspection when override is null", () => {
    const el = document.createElement("div");
    const c = capture(el, { source: null, component: null });
    // no fiber in jsdom → both null, same as no override
    expect(c.source).toBeNull();
    expect(c.component).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @rrw/overlay test selector`
Expected: FAIL — `capture` takes one argument / override ignored.

- [ ] **Step 3: Implement the override**

In `packages/overlay/src/selector.ts`, replace the `capture` function (lines 70-83) with:
```ts
/** Capture everything the bridge needs to locate the clicked element.
 *  An optional `override` (e.g. from react-grab's getSource) wins over fiber
 *  inspection; when its fields are null, we fall back to inspectFiber. */
export function capture(
  el: Element,
  override?: { source: string | null; component: string | null },
): Captured {
  const r = el.getBoundingClientRect();
  const fiber = inspectFiber(el);
  const source = override?.source ?? fiber.source;
  const component = override?.component ?? fiber.component;
  return {
    selector: cssPath(el),
    tag: el.tagName.toLowerCase(),
    classes: typeof el.className === "string" ? el.className : "",
    text: (el.textContent ?? "").trim().slice(0, 200),
    component,
    source,
    rect: { x: r.x, y: r.y, w: r.width, h: r.height },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @rrw/overlay test selector`
Expected: PASS (new + existing tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/overlay/src/selector.ts packages/overlay/src/selector.test.ts
git commit -m "feat(overlay): capture() accepts source/component override (react-grab getSource)"
```

---

## Task 4: Drive selecting mode with the GrabEngine

**Files:**
- Modify: `packages/overlay/src/DesignCommentOverlay.tsx` (props, the selecting effect ~86-128, the highlight render ~193-199)
- Test: `packages/overlay/src/DesignCommentOverlay.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `packages/overlay/src/DesignCommentOverlay.test.tsx`. It reuses the file's existing `fakeClient()` helper and `vi` import; add `waitFor` to the testing-library import and `import type { GrabEngine, Grab } from "./grab-engine";`.
```ts
function fakeEngine() {
  let emit: ((g: Grab) => void) | undefined;
  const engine: GrabEngine = {
    activate: vi.fn(),
    deactivate: vi.fn(),
    onGrab: (cb) => {
      emit = cb;
      return () => {};
    },
    dispose: vi.fn(),
  };
  return { engine, grab: (g: Grab) => emit?.(g) };
}

it("activates the engine in selecting mode and opens a draft on grab", async () => {
  const { engine, grab } = fakeEngine();
  render(<DesignCommentOverlay client={fakeClient()} grabEngineLoader={async () => engine} />);
  fireEvent.click(screen.getByRole("button", { name: /코멘트/ }));
  await waitFor(() => expect(engine.activate).toHaveBeenCalled());

  const el = document.createElement("button");
  document.body.appendChild(el);
  grab({ element: el, source: "src/Button.tsx:12", component: "Button" });

  await waitFor(() => expect(screen.getByText(/<Button>/)).toBeInTheDocument());
});

it("ignores grabs on the overlay's own host", async () => {
  const { engine, grab } = fakeEngine();
  render(<DesignCommentOverlay client={fakeClient()} grabEngineLoader={async () => engine} />);
  fireEvent.click(screen.getByRole("button", { name: /코멘트/ }));
  await waitFor(() => expect(engine.activate).toHaveBeenCalled());

  const host = document.createElement("div");
  host.setAttribute("data-rrw-host", "");
  const inner = document.createElement("span");
  host.appendChild(inner);
  document.body.appendChild(host);
  grab({ element: inner, source: null, component: null });

  expect(screen.queryByPlaceholderText("이 요소 수정 요청…")).not.toBeInTheDocument();
});

it("deactivates on exit and disposes on unmount", async () => {
  const { engine } = fakeEngine();
  const { unmount } = render(
    <DesignCommentOverlay client={fakeClient()} grabEngineLoader={async () => engine} />,
  );
  fireEvent.click(screen.getByRole("button", { name: /코멘트/ }));
  await waitFor(() => expect(engine.activate).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: /취소/ }));
  await waitFor(() => expect(engine.deactivate).toHaveBeenCalled());
  unmount();
  expect(engine.dispose).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @rrw/overlay test DesignCommentOverlay`
Expected: FAIL — `grabEngineLoader` prop unknown; engine not activated.

- [ ] **Step 3: Add the prop and the engine-driven effect**

In `packages/overlay/src/DesignCommentOverlay.tsx`:

(a) Add imports near the top:
```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { loadGrabEngine, type GrabEngine, type Grab } from "./grab-engine";
```

(b) Extend the props interface:
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
and destructure it with a default:
```ts
  grabEngineLoader = loadGrabEngine,
```

(c) Replace the entire selecting-mode effect (the `useEffect` at ~86-128, the one with `onMove`/`onClick`/`onKey`) with engine-driven logic, and remove the now-unused `hover` state (line 51) and the highlight render (lines 193-199):
```ts
  const engineRef = useRef<Promise<GrabEngine> | null>(null);

  // Lazy-create the engine once; dispose on unmount.
  useEffect(() => {
    return () => {
      void engineRef.current?.then((e) => e.dispose());
    };
  }, []);

  // selecting mode: react-grab drives hover/label/select; we receive grabs.
  useEffect(() => {
    if (mode !== "selecting") return;
    let unsub: (() => void) | undefined;
    let disposed = false;
    if (!engineRef.current) engineRef.current = grabEngineLoader();
    void engineRef.current.then((engine) => {
      if (disposed) return;
      unsub = engine.onGrab((g: Grab) => {
        if (g.element instanceof Element && g.element.closest("[data-rrw-host]")) return; // ignore our own UI
        const r = g.element.getBoundingClientRect();
        setDraft({ ...capture(g.element, { source: g.source, component: g.component }), px: r.left, py: r.top });
        setDraftText("");
        setDraftPos(clampToViewport({ left: r.left, top: r.top + 12 }, DRAFT_SIZE, viewport()));
        setMode("off");
      });
      engine.activate();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMode("off");
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      disposed = true;
      unsub?.();
      void engineRef.current?.then((e) => e.deactivate());
      document.removeEventListener("keydown", onKey, true);
    };
  }, [mode, grabEngineLoader]);
```

(d) Delete the `hover` state declaration (`const [hover, setHover] = useState(...)`) and the highlight JSX block:
```tsx
      {mode === "selecting" && hover && ( ... )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @rrw/overlay test DesignCommentOverlay`
Expected: PASS.

- [ ] **Step 5: Typecheck (catch the removed `hover` usages)**

Run: `pnpm --filter @rrw/overlay typecheck`
Expected: no errors. If `hover`/`setHover` are referenced anywhere else, remove those references.

- [ ] **Step 6: Commit**

```bash
git add packages/overlay/src/DesignCommentOverlay.tsx packages/overlay/src/DesignCommentOverlay.test.tsx
git commit -m "feat(overlay): drive selecting mode with react-grab engine (drop manual inspector)"
```

---

## Task 5: Build guards + single-file artifact integration test

**Files:**
- Modify: `packages/overlay/vite.config.ts`
- Test: `packages/overlay/build.test.ts` (new)

- [ ] **Step 1: Add the @react-grab/cli guards to vite config**

In `packages/overlay/vite.config.ts`, add `optimizeDeps` and extend `external`:
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

- [ ] **Step 2: Write the failing build test**

Create `packages/overlay/build.test.ts`:
```ts
import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const dist = resolve(import.meta.dirname, "dist");

describe("overlay build artifact", () => {
  beforeAll(() => {
    execSync("pnpm build", { cwd: resolve(import.meta.dirname), stdio: "inherit" });
  }, 120_000);

  it("emits a single overlay.js (single-file vendoring contract)", () => {
    const js = readdirSync(dist).filter((f) => f.endsWith(".js"));
    expect(js).toEqual(["overlay.js"]);
  });

  it("bundles react-grab but not the Node @react-grab/cli", () => {
    const code = readFileSync(resolve(dist, "overlay.js"), "utf8");
    expect(existsSync(resolve(dist, "overlay.js"))).toBe(true);
    expect(code).not.toMatch(/@react-grab\/cli/);
    expect(code).not.toMatch(/node:child_process/);
  });
});
```

- [ ] **Step 3: Run the test to verify it passes (or surfaces a real issue)**

Run: `pnpm --filter @rrw/overlay test build`
Expected: PASS — one `overlay.js`, no `@react-grab/cli`/`node:child_process` strings.
If it FAILS because the CLI string leaks, the `external` guard isn't taking effect — investigate the import graph before forcing the test green.

- [ ] **Step 4: Commit**

```bash
git add packages/overlay/vite.config.ts packages/overlay/build.test.ts
git commit -m "build(overlay): guard @react-grab/cli out of the bundle; assert single-file artifact"
```

---

## Task 6: Runtime-gated loader (`rrw-loader` + `useRrwOverlay`)

These vendored files live in the overlay package so they are built/tested here and copied into hosts by `rrw-setup`. They import `./overlay.js` lazily; in this package the equivalent module is `./index` (the built `overlay.js` is `index.ts`). Author them against `./index` and have `rrw-setup` rewrite the import to `./overlay.js` when vendoring.

**Files:**
- Create: `packages/overlay/src/rrw-loader.ts`
- Create: `packages/overlay/src/useRrwOverlay.ts`
- Test: `packages/overlay/src/rrw-loader.test.ts`
- Modify: `packages/overlay/src/index.ts`

- [ ] **Step 1: Write the failing loader test**

Create `packages/overlay/src/rrw-loader.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mountOverlay = vi.fn();
const unmount = vi.fn();
mountOverlay.mockReturnValue(unmount);
// startRrw does `import("./index")`; mock index so the heavy overlay tree isn't loaded.
vi.mock("./index", () => ({ mountOverlay: (...a: unknown[]) => mountOverlay(...a) }));

import { startRrw, stopRrw, isRrwRunning } from "./rrw-loader";

describe("rrw-loader", () => {
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
    expect(typeof (window as unknown as { __rrw?: { start: unknown } }).__rrw?.start).toBe("function");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @rrw/overlay test rrw-loader`
Expected: FAIL — `Cannot find module './rrw-loader'`.

- [ ] **Step 3: Write the loader**

Create `packages/overlay/src/rrw-loader.ts`:
```ts
import type { MountConfig } from "./mount";

let unmount: (() => void) | undefined;
let starting: Promise<void> | undefined;

/** Lazy-load and mount the overlay. Idempotent; safe to call from anywhere
 *  (a host's gating effect, a console, vConsole). The dynamic import keeps the
 *  heavy chunk out of every normal user's bundle. */
export async function startRrw(config: MountConfig = {}): Promise<void> {
  if (unmount) return;
  if (starting) return starting;
  starting = import("./index")
    .then((m) => {
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

Run: `pnpm --filter @rrw/overlay test rrw-loader`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the React hook (no separate test — it is a thin effect wrapper)**

Create `packages/overlay/src/useRrwOverlay.ts`:
```ts
import { useEffect } from "react";
import type { MountConfig } from "./mount";
import { startRrw, stopRrw } from "./rrw-loader";

/** Declarative host-owned activation: pass `enabled` computed from your own
 *  userId/role/flag. When true, the overlay lazy-loads and mounts; when false
 *  (the default for normal users) nothing is fetched. */
export function useRrwOverlay(enabled: boolean, config: MountConfig = {}): void {
  useEffect(() => {
    if (!enabled) return;
    void startRrw(config);
    return () => stopRrw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
```

- [ ] **Step 6: Export both from index.ts**

In `packages/overlay/src/index.ts` add:
```ts
export { startRrw, stopRrw, isRrwRunning } from "./rrw-loader";
export { useRrwOverlay } from "./useRrwOverlay";
```

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm --filter @rrw/overlay typecheck`
Expected: no errors.
```bash
git add packages/overlay/src/rrw-loader.ts packages/overlay/src/useRrwOverlay.ts packages/overlay/src/rrw-loader.test.ts packages/overlay/src/index.ts
git commit -m "feat(overlay): runtime-gated loader (startRrw/stopRrw + useRrwOverlay + window.__rrw)"
```

---

## Task 7: Rewire `rrw-setup` to host-owned runtime gating

**Files:**
- Modify: `skills/rrw-setup/SKILL.md` (§3 Vendor, §4 Wire)

- [ ] **Step 1: Vendor the loader files alongside overlay.js**

In `## 3. Vendor the overlay`, change the copy step to also copy the loader sources and rewrite their lazy import to `./overlay.js`:
```bash
mkdir -p components/rrw
cp .rrw/packages/overlay/dist/overlay.js components/rrw/overlay.js
cp .rrw/packages/overlay/src/rrw-loader.ts components/rrw/rrw-loader.ts
cp .rrw/packages/overlay/src/useRrwOverlay.ts components/rrw/useRrwOverlay.ts
# the vendored loader imports the built bundle, not the TS source:
sed -i '' 's#import("./index")#import("./overlay.js")#' components/rrw/rrw-loader.ts
```
Note in the skill prose: `rrw-loader.ts` reads `rrw.config.json` is NOT assumed — the host passes `MountConfig` (bridgeUrl/clientToken/author) when calling `useRrwOverlay(enabled, config)` or `window.__rrw.start(config)`.

- [ ] **Step 2: Replace the NODE_ENV wiring with host-owned gating**

Replace the `RrwOverlay.tsx` component block and `## 4. Wire it dev-gated` section with host-owned activation:
```markdown
## 4. Wire it — host-owned runtime gating (works in production)
The overlay is **not** build-gated. The host decides who sees it and only then is
the bundle fetched (normal users fetch nothing). Two ways:

**React hook (recommended):**
```tsx
"use client";
import { useRrwOverlay } from "@/components/rrw/useRrwOverlay";
import rrwConfig from "@/rrw.config.json";
const cfg = rrwConfig as { bridgeUrl?: string; clientToken?: string; token?: string; author?: string };

export function RrwGate() {
  // Replace with YOUR own condition (role, userId allowlist, feature flag, query string…).
  const enabled = typeof window !== "undefined" && new URLSearchParams(location.search).get("rrw") === "1";
  useRrwOverlay(enabled, {
    bridgeUrl: cfg.bridgeUrl,
    token: cfg.clientToken ?? cfg.token,
    author: cfg.author,
  });
  return null;
}
```
Render `<RrwGate />` unconditionally (Next `app/layout.tsx` `<body>`, or Vite root).

**Imperative / vConsole:** `window.__rrw.start({ bridgeUrl, token, author })` starts it
on demand; `window.__rrw.stop()` removes it.

> ⚠️ The gate is host-owned. A query-string/localStorage gate is **convenience, not
> access control** — anyone can set it. The real boundary stays: bridge network-gating
> (Tailscale/Cloudflare Access) + low-trust `clientToken` + operator-gated `apply`.
> Loading the overlay can never trigger code edits.
```

- [ ] **Step 3: Commit**

```bash
git add skills/rrw-setup/SKILL.md
git commit -m "docs(rrw-setup): host-owned runtime gating (useRrwOverlay/window.__rrw), vendor loader files"
```

---

## Task 8: Runtime smoke-tests + final docs

**Files:**
- Create: `docs/specs/2026-06-08-react-grab-smoke-tests.md` (checklist results)
- Modify: `README.md` and/or `packages/overlay` docs

- [ ] **Step 1: Build and run against a real React-19 dev app**

Vendor the built overlay into a scratch React-19 + Vite app, wire `useRrwOverlay(true)`, run it, and walk the spike's residual unknowns. Record pass/fail in `docs/specs/2026-06-08-react-grab-smoke-tests.md`:
1. Column dependency — does apply rely on `:col`? (inspect agent apply path)
2. `api.activate()` enters selection without react-grab's own activation key; no key hijack.
3. Shadow-DOM hit-testing — our FAB/draft are not selectable by react-grab; hover targets host elements.
4. styles.css — nothing renders unstyled; import `react-grab/styles.css` only if needed.
5. Copy suppression — selecting does not write the clipboard / show success flash.
6. Freeze tradeoff — overlay stays interactive; host usable with `freezeReactUpdates:false`.
7. dispose() — after activate→select→deactivate→dispose, re-mount re-inits cleanly.

- [ ] **Step 2: Apply fixes surfaced by smoke-tests**

For any failure, add the mitigation noted in the spec §9 (e.g. `onBeforeCopy` guard if #5 fails; import `react-grab/styles.css` if #4 fails) with a matching unit test where possible, and commit per fix.

- [ ] **Step 3: Document the feature**

In `README.md` (overlay/usage section) document: host-owned runtime gating (hook + imperative), the React ≥ 19 requirement, and the dev-build source-mapping limitation (prod yields component name only). Commit:
```bash
git add README.md docs/specs/2026-06-08-react-grab-smoke-tests.md
git commit -m "docs: react-grab selection + runtime gating usage, smoke-test results"
```

- [ ] **Step 4: Full gate before opening the PR**

Run: `pnpm -r test && pnpm -r typecheck`
Expected: all green.

---

## Self-Review notes (for the implementer)

- **Spec coverage:** Task 1 → §6 (React 19). Tasks 2–4 → §4 (A). Task 5 → §7 (build). Task 6 → §5 (B). Task 7 → §5/§6 wiring. Task 8 → §9 smoke-tests + §10 security docs.
- **Type consistency:** `Grab { element, source, component }` and `GrabEngine { activate, deactivate, onGrab, dispose }` are used identically in Tasks 2 and 4. `capture(el, override?)` signature in Task 3 matches its call in Task 4. `MountConfig` (existing) is reused by the loader in Task 6.
- **Out of scope (Phase 2):** multi-select / `Comment.targets`. Do not add it here.
