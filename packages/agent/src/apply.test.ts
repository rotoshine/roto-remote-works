import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { makeApply, type ApplyComment } from "./apply";
import { openPullRequest, type CmdRunner } from "./pr";

const pexec = promisify(execFile);

function comment(text: string, status = "open", author: string | null = null, url = ""): ApplyComment {
  return { comment: text, status, author, url };
}

describe("makeApply", () => {
  it("in-place: prepares + runs the agent, opens no PR", async () => {
    const order: string[] = [];
    const apply = makeApply({
      delivery: "in-place",
      base: "main",
      prepare: async () => void order.push("prepare"),
      runAgent: async () => void order.push("agent"),
      listComments: async () => [comment("x")],
      openPr: async () => {
        order.push("pr");
        return { ok: true };
      },
    });
    await apply({ requestedAt: "t" });
    expect(order).toEqual(["prepare", "agent"]);
  });

  it("pr: captures open comments BEFORE the agent, then opens a PR with them", async () => {
    const order: string[] = [];
    let seen: { content?: { body: string; branch: string }; base?: string } = {};
    const apply = makeApply({
      delivery: "pr",
      base: "develop",
      runAgent: async () => void order.push("agent"),
      listComments: async () => {
        order.push("pull");
        return [comment("remove SOLO SHOW", "open", "PM", "/g"), comment("already done", "resolved")];
      },
      openPr: async (content, base) => {
        order.push("pr");
        seen = { content, base };
        return { ok: true, url: "https://x/pull/1" };
      },
      log: () => {},
    });
    await apply({ requestedAt: "2026-06-01T00:00:00.000Z" });
    expect(order).toEqual(["pull", "agent", "pr"]);
    expect(seen.base).toBe("develop");
    expect(seen.content!.body).toContain("remove SOLO SHOW");
    expect(seen.content!.body).not.toContain("already done");
    expect(seen.content!.branch).toBe("rrw/apply-2026-06-01T00-00-00-000Z");
  });

  it("pr: logs when there are no changes", async () => {
    const logs: string[] = [];
    const apply = makeApply({
      delivery: "pr",
      base: "main",
      runAgent: async () => {},
      listComments: async () => [comment("x")],
      openPr: async () => ({ ok: false, noChanges: true }),
      log: (m) => logs.push(m),
    });
    await apply({ requestedAt: "t" });
    expect(logs.some((l) => /no changes/i.test(l))).toBe(true);
  });

  it("pr: logs the failure reason", async () => {
    const logs: string[] = [];
    const apply = makeApply({
      delivery: "pr",
      base: "main",
      runAgent: async () => {},
      listComments: async () => [comment("x")],
      openPr: async () => ({ ok: false, reason: "no auth" }),
      log: (m) => logs.push(m),
    });
    await apply({ requestedAt: "t" });
    expect(logs.some((l) => /no auth/.test(l))).toBe(true);
  });

  // Full chain with REAL git: fake agent edits a file → makeApply → openPullRequest.
  it("[integration] agent edit → real branch+commit+PR via the full chain", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rrw-apply-"));
    const git = (args: string[]) => pexec("git", args, { cwd: dir });
    await git(["init", "-b", "main"]);
    await git(["config", "user.email", "t@e.st"]);
    await git(["config", "user.name", "tester"]);
    await writeFile(join(dir, "page.tsx"), "v1\n");
    await git(["add", "-A"]);
    await git(["commit", "-m", "init"]);

    const run: CmdRunner = async (cmd, args) => {
      if (cmd === "gh") return { code: 0, stdout: "https://github.com/o/r/pull/123\n", stderr: "" };
      if (cmd === "git" && args[0] === "push") return { code: 0, stdout: "", stderr: "" };
      const r = await git(args).catch((e: { stdout?: string; stderr?: string }) => e);
      return { code: 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    };
    const logs: string[] = [];
    const apply = makeApply({
      delivery: "pr",
      base: "main",
      // the "agent" edits the working tree
      runAgent: async () => void (await writeFile(join(dir, "page.tsx"), "v2 — SOLO SHOW removed\n")),
      listComments: async () => [{ comment: "remove SOLO SHOW", author: "PM", url: "/g", status: "open" }],
      openPr: (content, base) => openPullRequest(run, content, base),
      log: (m) => logs.push(m),
    });

    await apply({ requestedAt: "2026-06-01T12:00:00.000Z" });

    expect(logs.some((l) => /opened PR: https:\/\/github\.com\/o\/r\/pull\/123/.test(l))).toBe(true);
    const branch = "rrw/apply-2026-06-01T12-00-00-000Z";
    const subject = await git(["log", "-1", "--format=%s", branch]);
    expect(subject.stdout.trim()).toMatch(/apply 1 design comment/);
    const head = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
    expect(head.stdout.trim()).toBe("main"); // returned to base
  });
});
