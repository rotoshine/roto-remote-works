#!/usr/bin/env node
import { createAgentClient } from "./client";
import { cmdStatus, cmdComment, cmdResolve, cmdDone, cmdPull } from "./commands";
import { askQuestion } from "./ask";
import type { CommentStatus, RunState } from "@rrw/bridge";

function config(): { baseUrl: string; token: string } {
  const baseUrl = process.env.RRW_BRIDGE_URL ?? "http://localhost:4317";
  const token = process.env.RRW_TOKEN ?? "";
  if (!token) {
    console.error("RRW_TOKEN is required (set it to the bridge token).");
    process.exit(1);
  }
  return { baseUrl, token };
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
  const client = createAgentClient(config());

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
    case "done":
      await cmdDone(client);
      break;
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
      console.error("usage: rrw <pull|status|comment|resolve|done|ask> [args]");
      process.exit(1);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
