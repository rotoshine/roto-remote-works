import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, createApp } from "@rrw/bridge";
import { createAgentClient } from "./client";
import { cmdPull, cmdStatus, cmdComment, cmdResolve, cmdDone } from "./commands";
import { askQuestion } from "./ask";

// Wires the real agent CLI logic against the real bridge HTTP app, in-process
// (the client's fetch routes straight into the Hono app). Deterministic — no
// subprocess startup races.
async function harness() {
  const dir = await mkdtemp(join(tmpdir(), "rrw-int-"));
  const store = new Store({ file: join(dir, "comments.json") });
  const app = createApp({ store, token: "t" });
  const fetchImpl = ((url: string, init?: RequestInit) => app.request(url, init)) as unknown as typeof fetch;
  const client = createAgentClient({ baseUrl: "http://bridge", token: "t", fetch: fetchImpl });
  return { store, client };
}

describe("agent ↔ bridge integration (in-process)", () => {
  it("runs the full apply loop including a web-ask round-trip", async () => {
    const { store, client } = await harness();

    // user left a comment in the overlay + pressed "Claude에게 수정 요청"
    const c = await store.addComment({ comment: "make bigger", selector: "h1" });
    await store.requestApply("local");

    // agent: pull
    const pulled = await cmdPull(client);
    expect(pulled.request?.ids).toEqual([c.id]);
    expect(pulled.comments.map((x) => x.id)).toContain(c.id);

    // agent: report progress
    await cmdStatus(client, { state: "applying", step: "editing" });
    await cmdComment(client, c.id, "applying");
    expect((await store.getStatus()).perComment[c.id]).toBe("applying");

    // agent: ask via the web; user answers in the overlay (simulated concurrently)
    const answerer = (async () => {
      for (let i = 0; i < 500; i++) {
        const q = await store.getQuestion();
        if (q) {
          await store.answerQuestion(q.id, "파랑");
          return;
        }
        await new Promise((r) => setTimeout(r, 2));
      }
    })();
    const result = await askQuestion(client, "색?", { options: ["파랑", "빨강"], pollMs: 2 });
    await answerer;
    expect(result).toEqual({ answered: true, answer: "파랑" });

    // agent: resolve + done
    await cmdResolve(client, c.id);
    await cmdDone(client);

    expect((await store.listComments()).find((x) => x.id === c.id)?.status).toBe("resolved");
    expect(await store.getRequest()).toBeNull();
    expect((await store.getStatus()).state).toBe("done");
  });
});
