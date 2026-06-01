#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createAgentClient } from "./client";
import { cmdStatus, cmdComment, cmdResolve, cmdDone, cmdPull, cmdScreenshot } from "./commands";
import { askQuestion } from "./ask";
import { runWorkerLoop } from "./worker";
import { agentCommand, type AgentKind } from "./runners";
import { loadConfig } from "@rrw/config";
import type { CommentStatus, RunState } from "@rrw/bridge";

function config(): { baseUrl: string; token: string } {
  // rrw.config.json (nearest ancestor) supplies bridgeUrl + token; env
  // (RRW_BRIDGE_URL / RRW_TOKEN) overrides it.
  const cfg = loadConfig();
  if (!cfg.token) {
    console.error("token required: set it in rrw.config.json or the RRW_TOKEN env (the bridge token).");
    process.exit(1);
  }
  return { baseUrl: cfg.bridgeUrl, token: cfg.token };
}

function parseFlags(args: string[]): { positionals: string[]; flags: Record<string, string | boolean> } {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positionals, flags } = parseFlags(rest);
  const cfg = config();
  const client = createAgentClient(cfg);

  switch (cmd) {
    case "pull":
      console.log(JSON.stringify(await cmdPull(client), null, 2));
      break;
    case "status":
      await cmdStatus(client, {
        state: typeof flags.state === "string" ? (flags.state as RunState) : undefined,
        step: typeof flags.step === "string" ? flags.step : undefined,
      });
      break;
    case "comment":
      await cmdComment(client, positionals[0]!, positionals[1] as CommentStatus);
      break;
    case "resolve":
      await cmdResolve(client, positionals[0]!);
      break;
    case "screenshot": {
      const path = await cmdScreenshot(client, positionals[0]!, positionals[1]!);
      if (path) console.log(path);
      else {
        console.error("no screenshot for that comment");
        process.exit(2);
      }
      break;
    }
    case "done":
      await cmdDone(client);
      break;
    case "worker": {
      const kind: AgentKind = flags.agent === "codex" ? "codex" : "claude";
      const pollMs = typeof flags.poll === "string" ? Number(flags.poll) : 2000;
      const { cmd: aCmd, args: aArgs } = agentCommand(kind);
      console.error(`[rrw worker] agent=${kind} bridge=${cfg.baseUrl} poll=${pollMs}ms (Ctrl+C to stop)`);
      let stopping = false;
      process.on("SIGINT", () => {
        stopping = true;
      });
      await runWorkerLoop({
        getRequest: () => client.getRequest(),
        runAgent: () =>
          new Promise<void>((resolve) => {
            const child = spawn(aCmd, aArgs, {
              stdio: "inherit",
              env: { ...process.env, RRW_BRIDGE_URL: cfg.baseUrl, RRW_TOKEN: cfg.token },
            });
            child.on("close", () => resolve());
            child.on("error", () => resolve());
          }),
        pollMs,
        shouldStop: () => stopping,
      });
      break;
    }
    case "ask": {
      const options =
        typeof flags.options === "string"
          ? flags.options.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined;
      const res = await askQuestion(client, positionals[0] ?? "", { options });
      if (res.answered) {
        console.log(res.answer);
      } else {
        console.error(`ask ${res.reason}`);
        process.exit(2);
      }
      break;
    }
    default:
      console.error(
        "usage: rrw <pull|status|comment|resolve|screenshot|done|ask|worker> [args]\n" +
          "       rrw worker [--agent claude|codex] [--poll <ms>]",
      );
      process.exit(1);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
