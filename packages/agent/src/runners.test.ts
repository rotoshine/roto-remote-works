import { describe, it, expect } from "vitest";
import { agentCommand, resolveRunner } from "./runners";

describe("agentCommand", () => {
  it("builds the claude headless command (acceptEdits)", () => {
    const { cmd, args } = agentCommand("claude");
    expect(cmd).toBe("claude");
    expect(args).toContain("-p");
    expect(args).toContain("--permission-mode");
    expect(args).toContain("acceptEdits");
  });

  it("builds the codex headless command (exec)", () => {
    const { cmd, args } = agentCommand("codex");
    expect(cmd).toBe("codex");
    expect(args[0]).toBe("exec");
  });

  it("carries a prompt that points at the rrw protocol", () => {
    for (const kind of ["claude", "codex"] as const) {
      const { args } = agentCommand(kind);
      expect(args.some((a) => /rrw/.test(a))).toBe(true);
    }
  });
});

describe("resolveRunner", () => {
  it("uses the configured mode/agent when no flags are given", () => {
    expect(resolveRunner({ mode: "worker", agent: "codex" }, {})).toEqual({ mode: "worker", agent: "codex" });
  });

  it("lets CLI flags override the config", () => {
    expect(resolveRunner({ mode: "session", agent: "claude" }, { mode: "worker", agent: "codex" })).toEqual({
      mode: "worker",
      agent: "codex",
    });
  });

  it("ignores unknown flag values and keeps the configured choice", () => {
    expect(resolveRunner({ mode: "worker", agent: "codex" }, { mode: "weird", agent: "gpt" })).toEqual({
      mode: "worker",
      agent: "codex",
    });
  });
});
