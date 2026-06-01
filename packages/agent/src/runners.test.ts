import { describe, it, expect } from "vitest";
import { agentCommand } from "./runners";

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
