/** Runs an external command; injected so the orchestration is testable. */
export type CmdRunner = (
  cmd: string,
  args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface PrContent {
  branch: string;
  title: string;
  body: string;
  commitMessage: string;
}

export interface PrResult {
  ok: boolean;
  url?: string;
  reason?: string;
  /** True when the working tree was clean — nothing to open a PR for. */
  noChanges?: boolean;
}

interface CommentLike {
  comment: string;
  author?: string | null;
  url?: string;
}

/** Parse `git symbolic-ref --short refs/remotes/origin/HEAD` (e.g. "origin/main") → "main". */
export function parseDefaultBranch(symbolicRefOutput: string): string | null {
  const t = symbolicRefOutput.trim();
  if (!t) return null;
  const slash = t.lastIndexOf("/");
  return slash >= 0 ? t.slice(slash + 1) : t;
}

/** Resolve the PR base: `auto` → the detected default branch (fallback "main"); else as configured. */
export function resolveBase(configured: string, detected: string | null): string {
  if (configured === "auto") return detected ?? "main";
  return configured;
}

/** Deterministic, git-safe branch name from a request timestamp. */
export function branchNameFor(requestedAt: string): string {
  const slug = requestedAt
    .replace(/[^0-9A-Za-z]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `rrw/apply-${slug}`;
}

/** Build the PR/commit content from the comments a worker run addressed. */
export function prContentFromComments(comments: CommentLike[], requestedAt: string): PrContent {
  const n = comments.length;
  const title = `rrw: apply ${n} design comment${n === 1 ? "" : "s"}`;
  const lines = comments.map((c) => {
    const who = c.author ? `**${c.author}**: ` : "";
    const where = c.url ? ` _(${c.url})_` : "";
    return `- ${who}${c.comment}${where}`;
  });
  const body = `Applied via roto-remote-works (\`rrw\` worker).\n\n${lines.join("\n")}`;
  return {
    branch: branchNameFor(requestedAt),
    title,
    body,
    commitMessage: `${title}\n\n${comments.map((c) => `- ${c.comment}`).join("\n")}`,
  };
}

/**
 * Open a PR for whatever the agent just changed in the working tree:
 * branch → add → commit → push → `gh pr create`, then return to `base`.
 * Returns `{noChanges:true}` if the tree is clean; `{ok:false,reason}` on any
 * git/gh failure (stopping before later steps).
 */
export async function openPullRequest(run: CmdRunner, content: PrContent, base: string): Promise<PrResult> {
  const status = await run("git", ["status", "--porcelain"]);
  if (status.code !== 0) return { ok: false, reason: `git status failed: ${status.stderr.trim()}` };
  if (status.stdout.trim() === "") return { ok: false, noChanges: true };

  const steps: { label: string; cmd: string; args: string[] }[] = [
    { label: "checkout", cmd: "git", args: ["checkout", "-b", content.branch] },
    { label: "add", cmd: "git", args: ["add", "-A"] },
    { label: "commit", cmd: "git", args: ["commit", "-m", content.commitMessage] },
    { label: "push", cmd: "git", args: ["push", "-u", "origin", content.branch] },
  ];
  for (const s of steps) {
    const r = await run(s.cmd, s.args);
    if (r.code !== 0) return { ok: false, reason: `${s.label} failed: ${(r.stderr || r.stdout).trim()}` };
  }

  const pr = await run("gh", ["pr", "create", "--base", base, "--title", content.title, "--body", content.body]);
  if (pr.code !== 0) return { ok: false, reason: `gh pr create failed: ${(pr.stderr || pr.stdout).trim()}` };
  const url = (pr.stdout.match(/https?:\/\/\S+/) ?? [])[0];

  // Best-effort: return to base so the next request starts clean.
  await run("git", ["checkout", base]);
  return url ? { ok: true, url } : { ok: true };
}
