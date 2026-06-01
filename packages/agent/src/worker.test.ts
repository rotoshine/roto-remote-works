import { describe, it, expect, vi } from "vitest";
import { runWorkerLoop } from "./worker";

describe("runWorkerLoop", () => {
  it("invokes the agent once for a request (same requestedAt = not re-run)", async () => {
    const runAgent = vi.fn(async () => {});
    let polls = 0;
    const getRequest = vi.fn(async () => {
      polls += 1;
      return polls <= 2 ? { requestedAt: "t1" } : null;
    });
    await runWorkerLoop({
      getRequest,
      runAgent,
      sleep: async () => {},
      pollMs: 1,
      shouldStop: () => polls >= 4,
    });
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it("processes a second, distinct request", async () => {
    const runAgent = vi.fn(async () => {});
    const seq: ({ requestedAt: string } | null)[] = [
      { requestedAt: "t1" },
      null,
      { requestedAt: "t2" },
      null,
    ];
    let i = 0;
    const getRequest = vi.fn(async () => seq[i++] ?? null);
    await runWorkerLoop({ getRequest, runAgent, sleep: async () => {}, pollMs: 1, shouldStop: () => i >= seq.length });
    expect(runAgent).toHaveBeenCalledTimes(2);
  });

  it("does not re-run the same request after the agent fails", async () => {
    const runAgent = vi.fn(async () => {
      throw new Error("agent failed");
    });
    let i = 0;
    const seq = [{ requestedAt: "t1" }, { requestedAt: "t1" }, { requestedAt: "t1" }];
    const getRequest = vi.fn(async () => seq[i++] ?? null);
    await runWorkerLoop({ getRequest, runAgent, sleep: async () => {}, pollMs: 1, shouldStop: () => i >= seq.length });
    expect(runAgent).toHaveBeenCalledTimes(1);
  });
});
