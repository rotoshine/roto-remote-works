#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Store } from "./store";
import { createApp } from "./app";

const port = Number(process.env.RRW_PORT ?? 4317);
// Bind to loopback by default; set RRW_HOST=0.0.0.0 only behind a private
// tunnel / network gating (see spec §7).
const host = process.env.RRW_HOST ?? "127.0.0.1";
const token = process.env.RRW_TOKEN ?? randomUUID();
const dataDir = process.env.RRW_DATA_DIR ?? join(process.cwd(), ".rrw-data");

const store = new Store({ file: join(dataDir, "comments.json") });
const app = createApp({ store, token });

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`[rrw-bridge] listening on http://${host}:${info.port}`);
  console.log(`[rrw-bridge] token:    ${token}`);
  console.log(`[rrw-bridge] data dir: ${dataDir}`);
});
