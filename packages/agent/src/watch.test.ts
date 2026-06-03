import { describe, it, expect } from "vitest";
import { runWatch } from "./watch";

describe("runWatch", () => {
  it("fires onRequest once for a pending request (once mode)", async () => {
    const fired: string[] = [];
    await runWatch({
      getRequest: async () => ({ requestedAt: "t1" }),
      onRequest: (r) => void fired.push(r.requestedAt),
      once: true,
      sleep: async () => {},
    });
    expect(fired).toEqual(["t1"]);
  });

  it("dedupes the same request and re-fires on a new requestedAt", async () => {
    const seq: ({ requestedAt: string } | null)[] = [
      null,
      { requestedAt: "t1" },
      { requestedAt: "t1" },
      { requestedAt: "t2" },
    ];
    let i = 0;
    const fired: string[] = [];
    await runWatch({
      getRequest: async () => seq[Math.min(i++, seq.length - 1)] ?? null,
      onRequest: (r) => void fired.push(r.requestedAt),
      sleep: async () => {},
      shouldStop: () => i >= seq.length,
    });
    expect(fired).toEqual(["t1", "t2"]);
  });

  it("does not fire when there is no request", async () => {
    let polls = 0;
    const fired: string[] = [];
    await runWatch({
      getRequest: async () => null,
      onRequest: () => void fired.push("x"),
      sleep: async () => {},
      shouldStop: () => ++polls >= 3,
    });
    expect(fired).toEqual([]);
  });
});
