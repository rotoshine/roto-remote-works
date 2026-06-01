import type { PrContent, PrResult } from "./pr";
import { prContentFromComments } from "./pr";

export type Delivery = "in-place" | "pr";

export interface ApplyComment {
  comment: string;
  author?: string | null;
  url?: string;
  status?: string;
}

export interface ApplyDeps {
  /** Spawn the agent (claude -p / codex exec); it edits the working tree. */
  runAgent: () => Promise<void>;
  delivery: Delivery;
  base: string;
  listComments: () => Promise<ApplyComment[]>;
  /** Open a PR for the working-tree changes (pr delivery only). */
  openPr: (content: PrContent, base: string) => Promise<PrResult>;
  /** Optional: e.g. checkout base + pull before the agent runs. */
  prepare?: () => Promise<void>;
  log?: (msg: string) => void;
}

/**
 * Build the per-request worker action. `in-place` just runs the agent (the edits
 * hot-reload). `pr` captures the pending comments first, runs the agent, then
 * opens a PR for whatever changed.
 */
export function makeApply(deps: ApplyDeps): (req: { requestedAt: string }) => Promise<void> {
  return async (req) => {
    if (deps.prepare) await deps.prepare();

    let pending: ApplyComment[] = [];
    if (deps.delivery === "pr") {
      pending = (await deps.listComments()).filter((c) => c.status !== "resolved");
    }

    await deps.runAgent();
    if (deps.delivery !== "pr") return;

    const content = prContentFromComments(pending, req.requestedAt);
    const res = await deps.openPr(content, deps.base);
    if (res.ok) deps.log?.(`[rrw] opened PR: ${res.url ?? "(created)"}`);
    else if (res.noChanges) deps.log?.("[rrw] no changes — no PR opened");
    else deps.log?.(`[rrw] PR failed: ${res.reason ?? "unknown"}`);
  };
}
