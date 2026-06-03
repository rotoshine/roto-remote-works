import { describe, it, expect } from "vitest";
import { runDoctor, type DoctorConfig } from "./doctor";

function cfg(over: Partial<DoctorConfig> = {}): DoctorConfig {
  return {
    bridgeUrl: "http://localhost:4317",
    token: "tok",
    clientToken: null,
    source: "/proj/rrw.config.json",
    processing: { mode: "session", agent: "claude", delivery: "in-place", base: "main" },
    ...over,
  };
}
const find = (cs: { name: string; ok: boolean; detail: string }[], n: string) => cs.find((c) => c.name === n)!;

describe("runDoctor", () => {
  it("all-good local setup: config/token/bridge/processing pass", async () => {
    const checks = await runDoctor({ config: cfg(), probeBridge: async () => 200 });
    expect(find(checks, "token").ok).toBe(true);
    expect(find(checks, "bridge").ok).toBe(true);
    expect(find(checks, "bridge").detail).toMatch(/200/);
    expect(find(checks, "processing").detail).toMatch(/session/);
  });

  it("flags a missing token", async () => {
    const checks = await runDoctor({ config: cfg({ token: "" }), probeBridge: async () => 200 });
    expect(find(checks, "token").ok).toBe(false);
  });

  it("401 from the bridge → token mismatch (not ok)", async () => {
    const checks = await runDoctor({ config: cfg(), probeBridge: async () => 401 });
    expect(find(checks, "bridge").ok).toBe(false);
    expect(find(checks, "bridge").detail).toMatch(/토큰|401/);
  });

  it("unreachable bridge (throws) → not ok with a hint", async () => {
    const checks = await runDoctor({
      config: cfg(),
      probeBridge: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(find(checks, "bridge").ok).toBe(false);
    expect(find(checks, "bridge").detail).toMatch(/연결|브리지/);
  });

  it("pr delivery: checks gh auth + git repo via the runner", async () => {
    const calls: string[] = [];
    const run = async (c: string, a: string[]) => {
      calls.push(`${c} ${a[0]}`);
      return { code: 0, stdout: "", stderr: "" };
    };
    const checks = await runDoctor({
      config: cfg({ processing: { mode: "worker", agent: "claude", delivery: "pr", base: "main" } }),
      probeBridge: async () => 200,
      run,
    });
    expect(find(checks, "gh").ok).toBe(true);
    expect(find(checks, "git").ok).toBe(true);
    expect(calls).toContain("gh auth");
    expect(calls).toContain("git rev-parse");
  });

  it("pr delivery: failing gh auth is reported", async () => {
    const run = async (c: string) => ({ code: c === "gh" ? 1 : 0, stdout: "", stderr: "no auth" });
    const checks = await runDoctor({
      config: cfg({ processing: { mode: "worker", agent: "claude", delivery: "pr", base: "main" } }),
      probeBridge: async () => 200,
      run,
    });
    expect(find(checks, "gh").ok).toBe(false);
  });

  it("in-place delivery: no gh/git checks", async () => {
    const checks = await runDoctor({ config: cfg(), probeBridge: async () => 200, run: async () => ({ code: 0, stdout: "", stderr: "" }) });
    expect(checks.find((c) => c.name === "gh")).toBeUndefined();
  });
});
