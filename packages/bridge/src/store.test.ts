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
