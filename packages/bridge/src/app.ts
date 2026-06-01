import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ApplyOrigin, NewComment, NewQuestion, Store, StatusPatch } from "./store";

export interface AppOptions {
  store: Store;
  token: string;
  corsOrigin?: string | string[];
}

export function createApp(opts: AppOptions): Hono {
  const app = new Hono();
  const { store } = opts;

  app.use(
    "*",
    cors({
      origin: opts.corsOrigin ?? "*",
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  // Bearer-token auth (preflight OPTIONS is already handled by cors()).
  app.use("*", async (c, next) => {
    if (c.req.header("authorization") !== `Bearer ${opts.token}`) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });

  // ── comments ──
  app.get("/comments", async (c) => c.json(await store.listComments()));
  app.post("/comments", async (c) => {
    const body = (await c.req.json()) as NewComment;
    return c.json(await store.addComment(body), 201);
  });
  app.patch("/comments/:id", async (c) => {
    const body = await c.req.json();
    const updated = await store.patchComment(c.req.param("id"), body);
    return updated ? c.json(updated) : c.json({ error: "not found" }, 404);
  });
  app.get("/comments/:id/screenshot", async (c) => {
    const buf = await store.getScreenshot(c.req.param("id"));
    if (!buf) return c.json({ error: "not found" }, 404);
    return c.body(new Uint8Array(buf), 200, { "content-type": "image/png" });
  });
  app.delete("/comments/:id", async (c) => {
    const ok = await store.deleteComment(c.req.param("id"));
    return ok ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
  });
  app.delete("/comments", async (c) => {
    await store.clearComments();
    return c.json({ ok: true });
  });

  // ── apply / request ──
  app.post("/apply", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { origin?: ApplyOrigin };
    const origin: ApplyOrigin = body.origin === "local" ? "local" : "remote";
    const result = await store.requestApply(origin);
    if (result.ok) return c.json(result.request, 202);
    return c.json({ error: result.reason }, result.reason === "busy" ? 409 : 400);
  });
  app.get("/request", async (c) => c.json(await store.getRequest()));
  app.delete("/request", async (c) => {
    await store.clearRequest();
    return c.json({ ok: true });
  });

  // ── status (progress) ──
  app.get("/status", async (c) => c.json(await store.getStatus()));
  app.patch("/status", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as StatusPatch;
    return c.json(await store.setStatus(body));
  });

  // ── question (web-ask) ──
  app.post("/question", async (c) => {
    const body = (await c.req.json()) as NewQuestion;
    return c.json(await store.postQuestion(body), 201);
  });
  app.get("/question", async (c) => c.json(await store.getQuestion()));
  app.get("/question/current", async (c) => c.json(await store.currentQuestion()));
  app.post("/question/:id/answer", async (c) => {
    const body = (await c.req.json()) as { answer: string };
    const answered = await store.answerQuestion(c.req.param("id"), body.answer);
    return answered ? c.json(answered) : c.json({ error: "not found" }, 404);
  });
  app.post("/question/:id/cancel", async (c) => {
    const cancelled = await store.cancelQuestion(c.req.param("id"));
    return cancelled ? c.json(cancelled) : c.json({ error: "not found" }, 404);
  });

  return app;
}
