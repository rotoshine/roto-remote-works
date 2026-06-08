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

it("re-inits after dispose when no global instance survives", async () => {
  getGlobalApiFn.mockReturnValue(null);
  const e1 = await loadGrabEngine();
  e1.dispose();
  getGlobalApiFn.mockReturnValue(null);
  await loadGrabEngine();
  expect(initFn).toHaveBeenCalledTimes(2);
});
