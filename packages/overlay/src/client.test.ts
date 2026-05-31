import { describe, it, expect } from "vitest";
import { createClient } from "./client";

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function mockFetch(responder: (c: Captured) => { status?: number; body?: unknown }) {
  const calls: Captured[] = [];
  const fn = (async (url: string | URL, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const captured: Captured = {
      url: String(url),
      method: init.method ?? "GET",
      headers,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(captured);
    const r = responder(captured);
    return new Response(JSON.stringify(r.body ?? null), {
      status: r.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const make = (responder: (c: Captured) => { status?: number; body?: unknown }) => {
  const { fn, calls } = mockFetch(responder);
  const client = createClient({ baseUrl: "http://localhost:4317", token: "tok", fetch: fn });
  return { client, calls };
};

describe("bridge client", () => {
  it("listComments GETs /comments with bearer auth", async () => {
    const { client, calls } = make(() => ({ body: [{ id: "1", comment: "x" }] }));
    const list = await client.listComments();
    expect(list).toEqual([{ id: "1", comment: "x" }]);
    expect(calls[0]?.url).toBe("http://localhost:4317/comments");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.authorization).toBe("Bearer tok");
  });

  it("addComment POSTs the body and returns the created comment", async () => {
    const { client, calls } = make((c) => ({ status: 201, body: { id: "9", ...(c.body as object) } }));
    const created = await client.addComment({ comment: "hi", selector: "h1" });
    expect(created).toMatchObject({ id: "9", comment: "hi", selector: "h1" });
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("http://localhost:4317/comments");
    expect(calls[0]?.body).toEqual({ comment: "hi", selector: "h1" });
    expect(calls[0]?.headers["content-type"]).toContain("application/json");
  });

  it("patchComment PATCHes /comments/:id", async () => {
    const { client, calls } = make(() => ({ body: { id: "5", status: "resolved" } }));
    await client.patchComment("5", { status: "resolved" });
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.url).toBe("http://localhost:4317/comments/5");
    expect(calls[0]?.body).toEqual({ status: "resolved" });
  });

  it("deleteComment DELETEs /comments/:id", async () => {
    const { client, calls } = make(() => ({ body: { ok: true } }));
    await client.deleteComment("5");
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toBe("http://localhost:4317/comments/5");
  });

  it("apply POSTs /apply with origin", async () => {
    const { client, calls } = make(() => ({ status: 202, body: { requestedAt: "t", origin: "local", ids: ["1"] } }));
    const req = await client.apply("local");
    expect(req.ids).toEqual(["1"]);
    expect(calls[0]?.url).toBe("http://localhost:4317/apply");
    expect(calls[0]?.body).toEqual({ origin: "local" });
  });

  it("getStatus / setStatus hit /status", async () => {
    const { client, calls } = make(() => ({ body: { state: "idle", currentStep: null, perComment: {}, updatedAt: "t" } }));
    await client.getStatus();
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe("http://localhost:4317/status");
    await client.setStatus({ state: "applying" });
    expect(calls[1]?.method).toBe("PATCH");
    expect(calls[1]?.body).toEqual({ state: "applying" });
  });

  it("getQuestion returns null when bridge has none", async () => {
    const { client } = make(() => ({ body: null }));
    expect(await client.getQuestion()).toBeNull();
  });

  it("answer POSTs /question/:id/answer", async () => {
    const { client, calls } = make(() => ({ body: { id: "q1", answer: "blue", status: "answered" } }));
    const q = await client.answer("q1", "blue");
    expect(q.answer).toBe("blue");
    expect(calls[0]?.url).toBe("http://localhost:4317/question/q1/answer");
    expect(calls[0]?.body).toEqual({ answer: "blue" });
  });

  it("throws on a non-ok response", async () => {
    const { client } = make(() => ({ status: 401, body: { error: "unauthorized" } }));
    await expect(client.listComments()).rejects.toThrow(/401/);
  });
});
