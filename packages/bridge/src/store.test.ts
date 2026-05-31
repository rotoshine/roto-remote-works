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
