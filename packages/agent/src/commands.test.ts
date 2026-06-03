import { describe, it, expect, vi } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdStatus, cmdComment, cmdResolve, cmdDone, cmdPull, cmdScreenshot } from "./commands";
import type { AgentClient } from "./client";
import type { Comment, CommentStatus, Status } from "@rrw/bridge";

const idle: Status = { state: "idle", currentStep: null, perComment: {}, result: null, updatedAt: "t" };

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
    getScreenshot: async () => null,
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

  it("done can attach a result (PR link) for the overlay", async () => {
    const setStatus = vi.fn(async () => idle);
    const clearRequest = vi.fn(async () => {});
    const result = { ok: true, prUrl: "https://x/pull/3", summary: "1 적용", at: "t" };
    await cmdDone(fakeAgentClient({ setStatus, clearRequest }), result);
    expect(setStatus).toHaveBeenCalledWith({ state: "done", result });
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

  it("screenshot downloads the bytes to a file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rrw-shot-"));
    const out = join(dir, "s.png");
    const client = fakeAgentClient({ getScreenshot: async () => new Uint8Array([1, 2, 3]) });
    const r = await cmdScreenshot(client, "c1", out);
    expect(r).toBe(out);
    expect([...(await readFile(out))]).toEqual([1, 2, 3]);
  });

  it("screenshot returns null when there is none", async () => {
    const client = fakeAgentClient({ getScreenshot: async () => null });
    expect(await cmdScreenshot(client, "c1", join(tmpdir(), "none.png"))).toBeNull();
  });
});
