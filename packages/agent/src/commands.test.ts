import { describe, it, expect, vi } from "vitest";
import { cmdStatus, cmdComment, cmdResolve, cmdDone, cmdPull } from "./commands";
import type { AgentClient } from "./client";
import type { Comment, CommentStatus, Status } from "@rrw/bridge";

const idle: Status = { state: "idle", currentStep: null, perComment: {}, updatedAt: "t" };

function comment(id: string, text: string, status: CommentStatus): Comment {
  return {
    id, comment: text, status, url: "", selector: "", text: "", tag: "", classes: "",
    component: null, source: null, rect: null, createdAt: "t",
  };
}

function fakeAgentClient(over: Partial<AgentClient>): AgentClient {
  return {
    listComments: async () => [],
    patchComment: async (id) => comment(id, "x", "resolved"),
    getRequest: async () => null,
    clearRequest: async () => {},
    setStatus: async () => idle,
    postQuestion: async () => ({ id: "q", text: "", options: [], status: "pending", answer: null, askedAt: "t" }),
    currentQuestion: async () => null,
    cancelQuestion: async () => null,
    ...over,
  };
}

describe("agent commands", () => {
  it("status sets state + currentStep", async () => {
    const setStatus = vi.fn(async () => idle);
    await cmdStatus(fakeAgentClient({ setStatus }), { state: "applying", step: "fixing header" });
    expect(setStatus).toHaveBeenCalledWith({ state: "applying", currentStep: "fixing header" });
  });

  it("comment patches status and reflects it in perComment", async () => {
    const patchComment = vi.fn(async (id) => comment(id, "x", "applying"));
    const setStatus = vi.fn(async () => idle);
    await cmdComment(fakeAgentClient({ patchComment, setStatus }), "c1", "applying");
    expect(patchComment).toHaveBeenCalledWith("c1", { status: "applying" });
    expect(setStatus).toHaveBeenCalledWith({ perComment: { c1: "applying" } });
  });

  it("resolve marks a comment resolved (comment + perComment)", async () => {
    const patchComment = vi.fn(async (id) => comment(id, "x", "resolved"));
    const setStatus = vi.fn(async () => idle);
    await cmdResolve(fakeAgentClient({ patchComment, setStatus }), "c1");
    expect(patchComment).toHaveBeenCalledWith("c1", { status: "resolved" });
    expect(setStatus).toHaveBeenCalledWith({ perComment: { c1: "resolved" } });
  });

  it("done sets state=done and clears the request", async () => {
    const setStatus = vi.fn(async () => idle);
    const clearRequest = vi.fn(async () => {});
    await cmdDone(fakeAgentClient({ setStatus, clearRequest }));
    expect(setStatus).toHaveBeenCalledWith({ state: "done" });
    expect(clearRequest).toHaveBeenCalled();
  });

  it("pull returns the request and the non-resolved comments", async () => {
    const client = fakeAgentClient({
      getRequest: async () => ({ requestedAt: "t", origin: "local", ids: ["c1"] }),
      listComments: async () => [comment("c1", "do this", "queued"), comment("c2", "done", "resolved")],
    });
    const r = await cmdPull(client);
    expect(r.request?.ids).toEqual(["c1"]);
    expect(r.comments.map((c) => c.id)).toEqual(["c1"]);
  });
});
