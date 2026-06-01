import { describe, it, expect } from "vitest";
import { bindAdvice } from "./net";

describe("bindAdvice", () => {
  it("returns null for loopback hosts (safe)", () => {
    for (const h of ["127.0.0.1", "localhost", "::1"]) {
      expect(bindAdvice(h)).toBeNull();
    }
  });

  it("warns when binding 0.0.0.0 (all interfaces)", () => {
    const a = bindAdvice("0.0.0.0");
    expect(a).toBeTruthy();
    expect(a).toMatch(/gating|tailscale|cloudflare|public/i);
  });

  it("warns when binding a specific non-loopback IP (e.g. a tailnet address)", () => {
    expect(bindAdvice("100.64.0.5")).toBeTruthy();
  });
});
