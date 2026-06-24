import { describe, it, expect } from "vitest";
import { clampToViewport, createZAllocator, nextZ } from "./position";

const card = { w: 288, h: 200 };
const vp = { w: 1200, h: 800 };

describe("clampToViewport", () => {
  it("leaves a position that already fits unchanged", () => {
    expect(clampToViewport({ left: 100, top: 100 }, card, vp)).toEqual({ left: 100, top: 100 });
  });

  it("pulls a right-overflowing card back so it stays on-screen", () => {
    // 1100 + 288 = 1388 > 1200 → left = 1200 - 288 - 12
    expect(clampToViewport({ left: 1100, top: 100 }, card, vp).left).toBe(900);
  });

  it("pulls a bottom-overflowing card up so the buttons stay reachable", () => {
    // 750 + 200 = 950 > 800 → top = 800 - 200 - 12
    expect(clampToViewport({ left: 100, top: 750 }, card, vp).top).toBe(588);
  });

  it("clamps negative / left-top positions to the margin", () => {
    expect(clampToViewport({ left: -50, top: 0 }, card, vp)).toEqual({ left: 12, top: 12 });
  });

  it("respects a custom margin", () => {
    expect(clampToViewport({ left: 5, top: 5 }, card, vp, 20)).toEqual({ left: 20, top: 20 });
  });
});

describe("createZAllocator", () => {
  it("hands out strictly increasing values starting just above the base", () => {
    const next = createZAllocator(10);
    expect(next()).toBe(11);
    expect(next()).toBe(12);
    expect(next()).toBe(13);
  });

  it("keeps independent allocators on their own counters", () => {
    const a = createZAllocator(100);
    const b = createZAllocator(200);
    expect(a()).toBe(101);
    expect(b()).toBe(201);
    expect(a()).toBe(102);
  });
});

describe("nextZ", () => {
  it("hands out strictly increasing z-indexes (shared bring-to-front counter)", () => {
    const first = nextZ();
    const second = nextZ();
    expect(second).toBeGreaterThan(first);
  });
});
