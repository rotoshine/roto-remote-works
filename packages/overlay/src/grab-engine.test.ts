import { it, expect, vi, beforeEach } from "vitest";

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
  getGlobalApi: (..._a: unknown[]) => getGlobalApiFn(),
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

// Fix #2: replace unsafe optional-chained call with guarded extraction
it("falls back to null source when getSource rejects", async () => {
  getSource.mockRejectedValue(new Error("no source maps"));
  const engine = await loadGrabEngine();
  const grabs: Array<{ source: string | null; component: string | null }> = [];
  engine.onGrab((g) => grabs.push(g));
  const plugin = registerPlugin.mock.calls[0]?.[0];
  expect(plugin).toBeDefined();
  await plugin.hooks.onElementSelect(document.createElement("div"));
  expect(grabs[0]).toEqual({ element: expect.any(Element), source: null, component: null });
});

// Fix #3: verify dispose() actually clears subscribers so the onGrab spy is NOT called after dispose
it("dispose unregisters the plugin, disposes the api, and clears subscribers", async () => {
  const engine = await loadGrabEngine();

  // Capture plugin reference BEFORE dispose
  const plugin = registerPlugin.mock.calls[0]?.[0];
  expect(plugin).toBeDefined();

  const grabSpy = vi.fn();
  engine.onGrab(grabSpy);

  engine.dispose();

  expect(unregisterPlugin).toHaveBeenCalledWith("roto-remote-works");
  expect(dispose).toHaveBeenCalled();

  // Drive onElementSelect via the captured plugin ref after dispose.
  // subscribers.clear() must have been called — if it were removed the spy WOULD fire.
  getSource.mockResolvedValue({ filePath: "src/Foo.tsx", lineNumber: 1, componentName: "Foo" });
  await plugin.hooks.onElementSelect(document.createElement("div"));
  expect(grabSpy).not.toHaveBeenCalled();
});

// Fix #4: assert activate() / deactivate() delegate to the api mocks
it("activate() calls the api activate mock", async () => {
  const engine = await loadGrabEngine();
  engine.activate();
  expect(activate).toHaveBeenCalledTimes(1);
});

it("deactivate() calls the api deactivate mock", async () => {
  const engine = await loadGrabEngine();
  engine.deactivate();
  expect(deactivate).toHaveBeenCalledTimes(1);
});

it("reuses an existing global instance instead of re-initing", async () => {
  getGlobalApiFn.mockReturnValue(api);
  await loadGrabEngine();
  expect(initFn).not.toHaveBeenCalled();
});

it("re-inits after dispose when no global instance survives", async () => {
  getGlobalApiFn.mockReturnValue(null);
  const e1 = await loadGrabEngine();
  e1.dispose();
  getGlobalApiFn.mockReturnValue(null);
  await loadGrabEngine();
  expect(initFn).toHaveBeenCalledTimes(2);
});

it("activate/deactivate/dispose are no-ops after dispose()", async () => {
  const engine = await loadGrabEngine();
  engine.dispose();

  // Reset call counts after dispose so we only observe post-dispose calls
  activate.mockClear();
  deactivate.mockClear();
  dispose.mockClear();

  // These must NOT forward to the api
  engine.activate();
  engine.deactivate();

  expect(activate).not.toHaveBeenCalled();
  expect(deactivate).not.toHaveBeenCalled();

  // A second dispose must not call api.dispose() again
  engine.dispose();
  expect(dispose).not.toHaveBeenCalled();
});
