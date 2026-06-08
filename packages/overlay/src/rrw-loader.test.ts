import { it, expect, vi, beforeEach } from "vitest";

const mountOverlay = vi.fn();
const unmount = vi.fn();
// startRrw does import("./index"); mock index so the heavy overlay tree isn't loaded.
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
  const w = window as unknown as { __rrw?: { start: unknown; stop: unknown; isRunning: unknown } };
  expect(typeof w.__rrw?.start).toBe("function");
  expect(typeof w.__rrw?.stop).toBe("function");
  expect(typeof w.__rrw?.isRunning).toBe("function");
});

it("stop during load unmounts the overlay once it finishes loading", async () => {
  // The vi.mock above provides a synchronous module, but `import("./index")` itself
  // is always at least a microtask away. By calling startRrw (no await) and then
  // stopRrw() synchronously — before the microtask queue drains — we simulate a
  // stop-during-load scenario.  After awaiting the promise we assert the overlay
  // is NOT left running and, if mountOverlay was called, its returned unmount fn
  // was also called (the stranded-mount case is cleaned up immediately).
  const p = startRrw({ bridgeUrl: "x", token: "t" });
  // stopRrw() runs synchronously, BEFORE the import promise microtask resolves.
  stopRrw();
  await p;

  expect(isRrwRunning()).toBe(false);
  // If mountOverlay was called at all (i.e. the import resolved before stop ran,
  // which shouldn't happen here but we guard both paths), unmount must have been
  // called to tear down the stranded mount.
  if (mountOverlay.mock.calls.length > 0) {
    expect(unmount).toHaveBeenCalled();
  }
});
