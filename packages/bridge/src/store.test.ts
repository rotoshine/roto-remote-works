import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store";

async function tempStore() {
  const dir = await mkdtemp(join(tmpdir(), "rrw-"));
  let n = 0;
  const store = new Store({
    file: join(dir, "comments.json"),
    id: () => `id-${++n}`,
    now: () => "2026-05-31T00:00:00.000Z",
  });
  return { store, dir };
}

describe("Store — comments", () => {
  it("adds a comment and lists it with generated id/status/createdAt", async () => {
    const { store } = await tempStore();

    const c = await store.addComment({ comment: "make it bigger", url: "/", selector: "h1" });

    expect(c.id).toBe("id-1");
    expect(c.status).toBe("open");
    expect(c.comment).toBe("make it bigger");
    expect(c.url).toBe("/");
    expect(c.selector).toBe("h1");
    expect(c.createdAt).toBe("2026-05-31T00:00:00.000Z");

    expect(await store.listComments()).toEqual([c]);
  });
});

describe("Store — patch / delete / clear", () => {
  it("patches a comment's status and returns the updated comment", async () => {
    const { store } = await tempStore();
    const c = await store.addComment({ comment: "x" });
    const updated = await store.patchComment(c.id, { status: "resolved" });
    expect(updated?.status).toBe("resolved");
    expect((await store.listComments())[0]?.status).toBe("resolved");
  });

  it("patchComment returns null for an unknown id", async () => {
    const { store } = await tempStore();
    expect(await store.patchComment("nope", { status: "resolved" })).toBeNull();
  });

  it("deletes a comment and returns true", async () => {
    const { store } = await tempStore();
    const c = await store.addComment({ comment: "x" });
    expect(await store.deleteComment(c.id)).toBe(true);
    expect(await store.listComments()).toEqual([]);
  });

  it("deleteComment returns false for an unknown id", async () => {
    const { store } = await tempStore();
    expect(await store.deleteComment("nope")).toBe(false);
  });

  it("clears all comments", async () => {
    const { store } = await tempStore();
    await store.addComment({ comment: "a" });
    await store.addComment({ comment: "b" });
    await store.clearComments();
    expect(await store.listComments()).toEqual([]);
  });
});

describe("Store — persistence & concurrency", () => {
  it("persists comments across Store instances (reload from file)", async () => {
    const { store, dir } = await tempStore();
    await store.addComment({ comment: "kept" });

    const reopened = new Store({ file: join(dir, "comments.json") });
    const list = await reopened.listComments();

    expect(list).toHaveLength(1);
    expect(list[0]?.comment).toBe("kept");
  });

  it("serializes concurrent writes without losing data", async () => {
    const { store } = await tempStore();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => store.addComment({ comment: `c${i}` })),
    );
    expect(await store.listComments()).toHaveLength(20);
  });
});

describe("Store — screenshots", () => {
  it("saves an attached PNG and serves it via getScreenshot, keeping bytes out of comments.json", async () => {
    const { store } = await tempStore();
    const dataUrl = "data:image/png;base64," + Buffer.from("PNGBYTES").toString("base64");

    const c = await store.addComment({ comment: "spacing off", screenshot: dataUrl });

    expect(c.screenshot).toBe(`screenshots/${c.id}.png`);
    expect(JSON.stringify(await store.listComments())).not.toContain("base64");
    expect((await store.getScreenshot(c.id))?.toString()).toBe("PNGBYTES");
  });

  it("a comment without a screenshot has screenshot=null", async () => {
    const { store } = await tempStore();
    const c = await store.addComment({ comment: "x" });
    expect(c.screenshot ?? null).toBeNull();
    expect(await store.getScreenshot(c.id)).toBeNull();
  });

  it("ignores a non-PNG-dataURL screenshot value", async () => {
    const { store } = await tempStore();
    const c = await store.addComment({ comment: "x", screenshot: "not-a-data-url" });
    expect(c.screenshot ?? null).toBeNull();
    expect(await store.getScreenshot(c.id)).toBeNull();
  });
});

describe("Store — comments author", () => {
  it("stores the comment author", async () => {
    const { store } = await tempStore();
    const c = await store.addComment({ comment: "x", author: "Designer A" });
    expect(c.author).toBe("Designer A");
  });
});

describe("Store — apply / request (single-flight)", () => {
  it("queues open comments, records a request, and marks the run queued (ok)", async () => {
    const { store } = await tempStore();
    const a = await store.addComment({ comment: "a" });
    await store.patchComment(a.id, { status: "resolved" });
    const b = await store.addComment({ comment: "b" });

    const res = await store.requestApply("local");

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.request.origin).toBe("local");
      expect(res.request.ids).toEqual([b.id]);
    }
    const list = await store.listComments();
    expect(list.find((c) => c.id === b.id)?.status).toBe("queued");
    expect(list.find((c) => c.id === a.id)?.status).toBe("resolved");
    expect((await store.getStatus()).state).toBe("queued");
    expect((await store.getRequest())?.ids).toEqual([b.id]);
  });

  it("returns no-open when there are no open comments", async () => {
    const { store } = await tempStore();
    expect(await store.requestApply("local")).toEqual({ ok: false, reason: "no-open" });
    expect(await store.getRequest()).toBeNull();
  });

  it("returns busy when a run is already in progress (single-flight)", async () => {
    const { store } = await tempStore();
    await store.addComment({ comment: "a" });
    await store.requestApply("local");
    await store.addComment({ comment: "b" });
    expect(await store.requestApply("local")).toEqual({ ok: false, reason: "busy" });
  });

  it("clearRequest removes the pending request", async () => {
    const { store } = await tempStore();
    await store.addComment({ comment: "x" });
    await store.requestApply("remote");
    await store.clearRequest();
    expect(await store.getRequest()).toBeNull();
  });
});

describe("Store — status (progress)", () => {
  it("defaults to idle", async () => {
    const { store } = await tempStore();
    const s = await store.getStatus();
    expect(s.state).toBe("idle");
    expect(s.currentStep).toBeNull();
    expect(s.perComment).toEqual({});
  });

  it("merges status patches (perComment accumulates)", async () => {
    const { store } = await tempStore();
    await store.setStatus({ state: "applying", currentStep: "fixing header", perComment: { c1: "applying" } });
    await store.setStatus({ perComment: { c2: "resolved" } });

    const s = await store.getStatus();
    expect(s.state).toBe("applying");
    expect(s.currentStep).toBe("fixing header");
    expect(s.perComment).toEqual({ c1: "applying", c2: "resolved" });
  });

  it("defaults result to null and persists an apply result", async () => {
    const { store } = await tempStore();
    expect((await store.getStatus()).result).toBeNull();

    await store.setStatus({
      state: "done",
      result: { ok: true, prUrl: "https://github.com/o/r/pull/7", summary: "2 코멘트 적용", at: "t" },
    });
    const s = await store.getStatus();
    expect(s.state).toBe("done");
    expect(s.result).toEqual({ ok: true, prUrl: "https://github.com/o/r/pull/7", summary: "2 코멘트 적용", at: "t" });

    // a later patch that doesn't touch result keeps it
    await store.setStatus({ currentStep: "x" });
    expect((await store.getStatus()).result?.prUrl).toBe("https://github.com/o/r/pull/7");
  });
});

describe("Store — question (web-ask)", () => {
  it("postQuestion creates a pending question that getQuestion returns", async () => {
    const { store } = await tempStore();
    const q = await store.postQuestion({ text: "Which color?", options: ["blue", "red"] });
    expect(q.status).toBe("pending");
    expect(q.answer).toBeNull();

    const pending = await store.getQuestion();
    expect(pending?.id).toBe(q.id);
    expect(pending?.options).toEqual(["blue", "red"]);
  });

  it("answerQuestion records the answer, marks answered, and clears pending", async () => {
    const { store } = await tempStore();
    const q = await store.postQuestion({ text: "x" });

    const answered = await store.answerQuestion(q.id, "blue");
    expect(answered?.status).toBe("answered");
    expect(answered?.answer).toBe("blue");
    expect(await store.getQuestion()).toBeNull();
    expect((await store.currentQuestion())?.answer).toBe("blue");
  });

  it("answerQuestion returns null for an unknown id", async () => {
    const { store } = await tempStore();
    await store.postQuestion({ text: "x" });
    expect(await store.answerQuestion("nope", "y")).toBeNull();
  });

  it("cancelQuestion marks it cancelled and clears pending", async () => {
    const { store } = await tempStore();
    const q = await store.postQuestion({ text: "x" });
    await store.cancelQuestion(q.id);
    expect(await store.getQuestion()).toBeNull();
    expect((await store.currentQuestion())?.status).toBe("cancelled");
  });
});
