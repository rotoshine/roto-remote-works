import type { AgentClient } from "./client";
import type { ApplyRequest, Comment, CommentStatus, RunState, Status } from "@rrw/bridge";

export async function cmdStatus(
  client: AgentClient,
  opts: { state?: RunState; step?: string | null },
): Promise<Status> {
  const patch: { state?: RunState; currentStep?: string | null } = {};
  if (opts.state !== undefined) patch.state = opts.state;
  if (opts.step !== undefined) patch.currentStep = opts.step;
  return client.setStatus(patch);
}

export async function cmdComment(client: AgentClient, id: string, status: CommentStatus): Promise<void> {
  await client.patchComment(id, { status });
  await client.setStatus({ perComment: { [id]: status } });
}

export async function cmdResolve(client: AgentClient, id: string): Promise<void> {
  await cmdComment(client, id, "resolved");
}

export async function cmdDone(client: AgentClient): Promise<void> {
  await client.setStatus({ state: "done" });
  await client.clearRequest();
}

export async function cmdPull(
  client: AgentClient,
): Promise<{ request: ApplyRequest | null; comments: Comment[] }> {
  const [request, all] = await Promise.all([client.getRequest(), client.listComments()]);
  return { request, comments: all.filter((c) => c.status !== "resolved") };
}
