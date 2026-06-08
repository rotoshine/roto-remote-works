import { describe, it, expect, vi, beforeEach } from "vitest";

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
  const w = window as unknown as { __rrw?: { start: unknown; stop: unknown } };
  expect(typeof w.__rrw?.start).toBe("function");
  expect(typeof w.__rrw?.stop).toBe("function");
});
