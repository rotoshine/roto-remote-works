import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context, Next } from "hono";
import type { ApplyOrigin, NewComment, NewQuestion, Store, StatusPatch } from "./store";

export interface AppOptions {
  store: Store;
  /** High-trust token (agent / code edits). */
  token: string;
  /**
   * Optional low-trust token for the browser overlay. When set, that token may
   * only comment/read/answer/apply; agent-only routes return 403. When omitted,
   * the single `token` authorizes everything (backward-compatible).
   */
  clientToken?: string;
  corsOrigin?: string | string[];
}

type Tier = "agent" | "client";

export function createApp(opts: AppOptions): Hono<{ Variables: { tier: Tier } }> {
  const app = new Hono<{ Variables: { tier: Tier } }>();
  const { store } = opts;

  app.use(
    "*",
    cors({
      origin: opts.corsOrigin ?? "*",
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  // Bearer-token auth + trust tier (preflight OPTIONS handled by cors()).
  app.use("*", async (c, next) => {
    const auth = c.req.header("authorization");
    const isAgent = auth === `Bearer ${opts.token}`;
    const isClient = opts.clientToken !== undefined && auth === `Bearer ${opts.clientToken}`;
    if (!isAgent && !isClient) return c.json({ error: "unauthorized" }, 401);
    c.set("tier", isAgent ? "agent" : "client");
    await next();
  });

  // Guard agent-only routes: the low-trust client token gets 403.
  const requireAgent = async (c: Context<{ Variables: { tier: Tier } }>, next: Next) => {
    if (c.get("tier") !== "agent") return c.json({ error: "forbidden" }, 403);
    await next();
  };

  // ── comments ──
  app.get("/comments", async (c) => c.json(await store.listComments()));
  app.post("/comments", async (c) => {
    const body = (await c.req.json()) as NewComment;
    return c.json(await store.addComment(body), 201);
  });
  app.patch("/comments/:id", requireAgent, async (c) => {
    const body = await c.req.json();
    const updated = await store.patchComment(c.req.param("id")!, body);
    return updated ? c.json(updated) : c.json({ error: "not found" }, 404);
  });
  app.get("/comments/:id/screenshot", requireAgent, async (c) => {
    const buf = await store.getScreenshot(c.req.param("id")!);
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
  app.get("/request", requireAgent, async (c) => c.json(await store.getRequest()));
  app.delete("/request", requireAgent, async (c) => {
    await store.clearRequest();
    return c.json({ ok: true });
  });

  // ── status (progress) ──
  app.get("/status", async (c) => c.json(await store.getStatus()));
  app.patch("/status", requireAgent, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as StatusPatch;
    return c.json(await store.setStatus(body));
  });

  // ── question (web-ask) ──
  app.post("/question", requireAgent, async (c) => {
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
