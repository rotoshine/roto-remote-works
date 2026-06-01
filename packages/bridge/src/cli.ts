#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { loadConfig } from "@rrw/config";
import { Store } from "./store";
import { createApp } from "./app";

// rrw.config.json (if present) supplies bridge.port/host/dataDir + token;
// env vars (RRW_PORT/RRW_HOST/RRW_DATA_DIR/RRW_TOKEN) override it. Bind to
// loopback by default; set host 0.0.0.0 only behind network gating (spec §7).
const cfg = loadConfig();
const { port, host, dataDir } = cfg.bridge;
// Always run with a token; generate an ephemeral one if none was configured.
const token = cfg.token || randomUUID();
const clientToken = cfg.clientToken ?? undefined;

const store = new Store({ file: join(dataDir, "comments.json") });
const app = createApp({ store, token, clientToken });

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`[rrw-bridge] listening on http://${host}:${info.port}`);
  console.log(`[rrw-bridge] token:        ${token}`);
  if (clientToken) console.log(`[rrw-bridge] clientToken:  ${clientToken} (low-trust, overlay)`);
  console.log(`[rrw-bridge] data dir:     ${dataDir}`);
  if (cfg.source) console.log(`[rrw-bridge] config:       ${cfg.source}`);
});
