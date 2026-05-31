import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store";
import { createApp } from "./app";

const TOKEN = "secret-token";

// Test helper: parse a Response body as loosely-typed JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function data(res: Response): Promise<any> {
  return res.json();
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "rrw-app-"));
  let n = 0;
  const store = new Store({
    file: join(dir, "comments.json"),
    id: () => `id-${++n}`,
    now: () => "2026-05-31T00:00:00.000Z",
  });
  const app = createApp({ store, token: TOKEN });
  const call = (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  const json = (path: string, method: string, body?: unknown) =>
    call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  return { store, app, call, json };
}

describe("bridge app — auth", () => {
  it("401 without a token", async () => {
    const { app } = await setup();
    expect((await app.request("/comments")).status).toBe(401);
  });

  it("401 with a wrong token", async () => {
    const { app } = await setup();
    const res = await app.request("/comments", { headers: { authorization: "Bearer nope" } });
    expect(res.status).toBe(401);
  });

  it("200 with the correct token", async () => {
    const { call } = await setup();
    const res = await call("/comments");
    expect(res.status).toBe(200);
    expect(await data(res)).toEqual([]);
  });
});

describe("bridge app — comments", () => {
  it("POST creates (201) and GET lists it", async () => {
    const { json, call } = await setup();
    const res = await json("/comments", "POST", { comment: "bigger", url: "/", selector: "h1" });
    expect(res.status).toBe(201);
    const created = await data(res);
    expect(created.id).toBe("id-1");
    expect(created.status).toBe("open");

    expect(await data(await call("/comments"))).toHaveLength(1);
  });

  it("PATCH updates status (200) and 404 for unknown id", async () => {
    const { json } = await setup();
    const created = await data(await json("/comments", "POST", { comment: "x" }));
    const ok = await json(`/comments/${created.id}`, "PATCH", { status: "resolved" });
    expect(ok.status).toBe(200);
    expect((await data(ok)).status).toBe("resolved");

    expect((await json("/comments/nope", "PATCH", { status: "resolved" })).status).toBe(404);
  });

  it("DELETE removes (200), 404 unknown, and DELETE /comments clears", async () => {
    const { json, call } = await setup();
    const created = await data(await json("/comments", "POST", { comment: "x" }));
    expect((await json(`/comments/${created.id}`, "DELETE")).status).toBe(200);
    expect((await json("/comments/nope", "DELETE")).status).toBe(404);

    await json("/comments", "POST", { comment: "a" });
    expect((await call("/comments", { method: "DELETE" })).status).toBe(200);
    expect(await data(await call("/comments"))).toEqual([]);
  });
});

describe("bridge app — apply / status / question", () => {
  it("POST /apply queues open comments (202) and 400 when none open", async () => {
    const { json } = await setup();
    expect((await json("/apply", "POST", { origin: "local" })).status).toBe(400);

    await json("/comments", "POST", { comment: "x" });
    const res = await json("/apply", "POST", { origin: "local" });
    expect(res.status).toBe(202);
    const req = await data(res);
    expect(req.origin).toBe("local");
    expect(req.ids).toEqual(["id-1"]);
  });

  it("GET /status defaults to idle; PATCH merges", async () => {
    const { call, json } = await setup();
    expect((await data(await call("/status"))).state).toBe("idle");

    await json("/status", "PATCH", { state: "applying", currentStep: "header", perComment: { a: "applying" } });
    await json("/status", "PATCH", { perComment: { b: "resolved" } });
    const s = await data(await call("/status"));
    expect(s.state).toBe("applying");
    expect(s.perComment).toEqual({ a: "applying", b: "resolved" });
  });

  it("question lifecycle: post → get(pending) → answer; cancel", async () => {
    const { call, json } = await setup();
    const q = await data(await json("/question", "POST", { text: "color?", options: ["blue"] }));
    expect(q.status).toBe("pending");

    expect((await data(await call("/question"))).id).toBe(q.id);

    const answered = await data(await json(`/question/${q.id}/answer`, "POST", { answer: "blue" }));
    expect(answered.answer).toBe("blue");
    expect(await data(await call("/question"))).toBeNull();

    const q2 = await data(await json("/question", "POST", { text: "again" }));
    await json(`/question/${q2.id}/cancel`, "POST");
    expect((await data(await call("/question/current"))).status).toBe("cancelled");
  });
});

describe("bridge app — CORS", () => {
  it("OPTIONS preflight returns CORS headers without auth", async () => {
    const { app } = await setup();
    const res = await app.request("/comments", {
      method: "OPTIONS",
      headers: { origin: "http://localhost:3000", "access-control-request-method": "GET" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
  });

  it("normal responses carry Access-Control-Allow-Origin", async () => {
    const { call } = await setup();
    const res = await call("/comments", { headers: { origin: "http://localhost:3000" } });
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
  });
});
