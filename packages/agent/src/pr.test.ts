import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  branchNameFor,
  prContentFromComments,
  openPullRequest,
  parseDefaultBranch,
  resolveBase,
  type CmdRunner,
} from "./pr";

const pexec = promisify(execFile);

/** Recording fake runner; scripted by `${cmd} ${args[0]}`. */
function recorder(script: Record<string, { code?: number; stdout?: string; stderr?: string }> = {}) {
  const calls: { cmd: string; args: string[] }[] = [];
  const run: CmdRunner = async (cmd, args) => {
    calls.push({ cmd, args });
    const r = script[`${cmd} ${args[0]}`] ?? {};
    return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  return { run, calls };
}

describe("branchNameFor", () => {
  it("makes a git-safe branch from a request timestamp", () => {
    expect(branchNameFor("2026-06-01T04:25:06.956Z")).toBe("rrw/apply-2026-06-01T04-25-06-956Z");
  });
});

describe("parseDefaultBranch", () => {
  it("strips the remote prefix from git symbolic-ref output", () => {
    expect(parseDefaultBranch("origin/main\n")).toBe("main");
    expect(parseDefaultBranch("origin/develop")).toBe("develop");
    expect(parseDefaultBranch("trunk")).toBe("trunk");
  });
  it("returns null for empty output", () => {
    expect(parseDefaultBranch("")).toBeNull();
    expect(parseDefaultBranch("  \n")).toBeNull();
  });
});

describe("resolveBase", () => {
  it("returns the configured branch as-is when it is not 'auto'", () => {
    expect(resolveBase("develop", "main")).toBe("develop");
    expect(resolveBase("main", null)).toBe("main");
  });
  it("uses the detected branch when configured is 'auto'", () => {
    expect(resolveBase("auto", "develop")).toBe("develop");
  });
  it("falls back to 'main' when 'auto' but nothing detected", () => {
    expect(resolveBase("auto", null)).toBe("main");
  });
});

describe("prContentFromComments", () => {
  it("summarizes the addressed comments into title/body/commit", () => {
    const c = prContentFromComments(
      [
        { comment: "remove SOLO SHOW", author: "PM", url: "/en/gigs" },
        { comment: "tighten the hero spacing", author: "Designer", url: "/" },
      ],
      "2026-06-01T04:25:06.956Z",
    );
    expect(c.branch).toBe("rrw/apply-2026-06-01T04-25-06-956Z");
    expect(c.title).toMatch(/2 .*comment/i);
    expect(c.body).toContain("remove SOLO SHOW");
    expect(c.body).toContain("tighten the hero spacing");
    expect(c.body).toContain("PM");
    expect(c.commitMessage).toMatch(/rrw/i);
  });
});

describe("openPullRequest", () => {
  const content = { branch: "rrw/apply-x", title: "t", body: "b", commitMessage: "m" };

  it("returns noChanges (and creates no branch) when the tree is clean", async () => {
    const { run, calls } = recorder({ "git status": { stdout: "" } });
    const res = await openPullRequest(run, content, "main");
    expect(res).toEqual({ ok: false, noChanges: true });
    expect(calls.some((c) => c.cmd === "git" && c.args[0] === "checkout")).toBe(false);
  });

  it("branches, commits, pushes, opens a PR, returns to base, and parses the URL", async () => {
    const { run, calls } = recorder({
      "git status": { stdout: " M components/LivePage.tsx\n" },
      "gh pr": { stdout: "https://github.com/o/r/pull/7\n" },
    });
    const res = await openPullRequest(run, content, "develop");
    expect(res.ok).toBe(true);
    expect(res.url).toBe("https://github.com/o/r/pull/7");
    const seq = calls.map((c) => `${c.cmd} ${c.args[0]}`);
    expect(seq).toEqual([
      "git status",
      "git checkout", // -b branch
      "git add",
      "git commit",
      "git push",
      "gh pr",
      "git checkout", // back to base
    ]);
    const gh = calls.find((c) => c.cmd === "gh")!;
    expect(gh.args).toContain("--base");
    expect(gh.args).toContain("develop");
  });

  it("stops and reports when commit fails (no push, no PR)", async () => {
    const { run, calls } = recorder({
      "git status": { stdout: " M a\n" },
      "git commit": { code: 1, stderr: "nothing staged" },
    });
    const res = await openPullRequest(run, content, "main");
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/commit/i);
    expect(calls.some((c) => c.cmd === "git" && c.args[0] === "push")).toBe(false);
    expect(calls.some((c) => c.cmd === "gh")).toBe(false);
  });

  it("reports when gh pr create fails", async () => {
    const { run } = recorder({
      "git status": { stdout: " M a\n" },
      "gh pr": { code: 1, stderr: "no auth" },
    });
    const res = await openPullRequest(run, content, "main");
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/gh|pr/i);
  });

  // Real git in a temp repo; only `gh` and `git push` are faked (no remote).
  it("[integration] creates a real branch+commit with real git", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rrw-pr-"));
    const git = (args: string[]) => pexec("git", args, { cwd: dir });
    await git(["init", "-b", "main"]);
    await git(["config", "user.email", "t@e.st"]);
    await git(["config", "user.name", "tester"]);
    await writeFile(join(dir, "file.txt"), "v1\n");
    await git(["add", "-A"]);
    await git(["commit", "-m", "init"]);
    await writeFile(join(dir, "file.txt"), "v2\n"); // uncommitted change (as if the agent edited)

    const run: CmdRunner = async (cmd, args) => {
      if (cmd === "gh") return { code: 0, stdout: "https://github.com/o/r/pull/99\n", stderr: "" };
      if (cmd === "git" && args[0] === "push") return { code: 0, stdout: "", stderr: "" };
      const r = await git(args).catch((e: { code?: number; stderr?: string; stdout?: string }) => e);
      return { code: 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    };
    const c = prContentFromComments([{ comment: "bump", author: "PM" }], "2026-06-01T00:00:00.000Z");
    const res = await openPullRequest(run, c, "main");

    expect(res.ok).toBe(true);
    expect(res.url).toBe("https://github.com/o/r/pull/99");
    // commit landed on the branch — subject (%s) is the title line of the message
    const log = await git(["log", "-1", "--format=%s", c.branch]);
    expect(log.stdout.trim()).toBe(c.title);
    // returned to base
    const head = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
    expect(head.stdout.trim()).toBe("main");
  });
});
