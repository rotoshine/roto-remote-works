#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createAgentClient, type AgentClient } from "./client";
import { cmdStatus, cmdComment, cmdResolve, cmdDone, cmdPull, cmdScreenshot } from "./commands";
import { askQuestion } from "./ask";
import { runWorkerLoop } from "./worker";
import { agentCommand, resolveRunner, type AgentKind, type RunMode } from "./runners";
import { makeApply, type Delivery } from "./apply";
import { openPullRequest, type CmdRunner } from "./pr";
import { runDoctor } from "./doctor";
import { loadConfig } from "@rrw/config";
import type { CommentStatus, RunState } from "@rrw/bridge";

function config(): {
  baseUrl: string;
  token: string;
  processing: { mode: RunMode; agent: AgentKind; delivery: Delivery; base: string };
} {
  // rrw.config.json (nearest ancestor) supplies bridgeUrl + token + processing
  // mode; env (RRW_BRIDGE_URL / RRW_TOKEN / RRW_MODE / RRW_AGENT) overrides it.
  const cfg = loadConfig();
  if (!cfg.token) {
    console.error("token required: set it in rrw.config.json or the RRW_TOKEN env (the bridge token).");
    process.exit(1);
  }
  return { baseUrl: cfg.bridgeUrl, token: cfg.token, processing: cfg.processing };
}

/** Run an external command capturing its output (for git/gh in pr delivery). */
const cmdRunner: CmdRunner = (cmd, args) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => (out += String(d)));
    child.stderr?.on("data", (d) => (err += String(d)));
    child.on("close", (code) => resolve({ code: code ?? 0, stdout: out, stderr: err }));
    child.on("error", (e) => resolve({ code: 1, stdout: out, stderr: e instanceof Error ? e.message : String(e) }));
  });

/**
 * Headless worker loop: poll the bridge and, per request, spawn the agent —
 * then (delivery="pr") open a PR for the changes instead of leaving them in the
 * working tree (built/deployed servers can't hot-reload).
 */
async function startWorker(
  client: AgentClient,
  baseUrl: string,
  token: string,
  choice: { agent: AgentKind; delivery: Delivery; base: string },
  pollMs: number,
): Promise<void> {
  const { agent, delivery, base } = choice;
  const { cmd: aCmd, args: aArgs } = agentCommand(agent);
  console.error(
    `[rrw worker] agent=${agent} delivery=${delivery} bridge=${baseUrl} poll=${pollMs}ms (Ctrl+C to stop)`,
  );
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });

  const apply = makeApply({
    delivery,
    base,
    runAgent: () =>
      new Promise<void>((resolve) => {
        const child = spawn(aCmd, aArgs, {
          stdio: "inherit",
          env: { ...process.env, RRW_BRIDGE_URL: baseUrl, RRW_TOKEN: token },
        });
        child.on("close", () => resolve());
        child.on("error", () => resolve());
      }),
    listComments: () => client.listComments(),
    openPr: (content, b) => openPullRequest(cmdRunner, content, b),
    prepare:
      delivery === "pr"
        ? async () => {
            await cmdRunner("git", ["checkout", base]);
            await cmdRunner("git", ["pull", "--ff-only"]);
          }
        : undefined,
    // surface the outcome (PR link) back to the overlay via status.result
    reportResult: (r) =>
      client
        .setStatus({
          state: r.ok ? "done" : "error",
          result: { ok: r.ok, prUrl: r.prUrl ?? null, summary: r.summary ?? null, at: new Date().toISOString() },
        })
        .then(() => undefined),
    log: (m) => console.error(m),
  });

  await runWorkerLoop({
    getRequest: () => client.getRequest(),
    runAgent: apply,
    pollMs,
    shouldStop: () => stopping,
  });
}

/** Resolve delivery from a `--delivery` flag, falling back to config. */
function deliveryOf(flags: Record<string, string | boolean>, fallback: Delivery): Delivery {
  return flags.delivery === "pr" ? "pr" : flags.delivery === "in-place" ? "in-place" : fallback;
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

  // `doctor` runs before the token gate so it can diagnose a missing token.
  if (cmd === "doctor") {
    const full = loadConfig();
    const probeBridge = async () => {
      const res = await fetch(`${full.bridgeUrl}/status`, {
        headers: { authorization: `Bearer ${full.token}` },
      });
      return res.status;
    };
    const checks = await runDoctor({ config: full, probeBridge, run: cmdRunner });
    for (const ch of checks) console.log(`${ch.ok ? "✓" : "✗"} ${ch.name}: ${ch.detail}`);
    if (checks.some((ch) => !ch.ok)) process.exitCode = 1;
    return;
  }

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
    case "done": {
      const pr = typeof flags.pr === "string" ? flags.pr : undefined;
      const summary = typeof flags.summary === "string" ? flags.summary : undefined;
      const result =
        pr || summary
          ? { ok: true, prUrl: pr ?? null, summary: summary ?? null, at: new Date().toISOString() }
          : undefined;
      await cmdDone(client, result);
      break;
    }
    case "worker": {
      const { agent } = resolveRunner(cfg.processing, { mode: "worker", agent: flags.agent });
      const pollMs = typeof flags.poll === "string" ? Number(flags.poll) : 2000;
      await startWorker(client, cfg.baseUrl, cfg.token, { agent, delivery: deliveryOf(flags, cfg.processing.delivery), base: cfg.processing.base }, pollMs);
      break;
    }
    case "run": {
      // Dispatch on the configured processing mode (flags override).
      const { mode, agent } = resolveRunner(cfg.processing, { mode: flags.mode, agent: flags.agent });
      if (mode === "worker") {
        const pollMs = typeof flags.poll === "string" ? Number(flags.poll) : 2000;
        await startWorker(client, cfg.baseUrl, cfg.token, { agent, delivery: deliveryOf(flags, cfg.processing.delivery), base: cfg.processing.base }, pollMs);
      } else {
        // session mode: nothing to daemonize — the operator's interactive agent
        // session applies comments via the rrw-process skill (local/HMR).
        const { comments } = await cmdPull(client);
        const open = comments.filter((c) => c.status !== "resolved");
        console.log(
          `[rrw] session mode — your interactive ${agent} session applies comments via the rrw-process skill.`,
        );
        console.log(
          `[rrw] ${open.length} comment(s) pending. Trigger rrw-process in your session (or use 'rrw pull'). ` +
            `For an unattended/standalone bridge, set processing.mode="worker" (or run 'rrw worker').`,
        );
      }
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
        "usage: rrw <pull|status|comment|resolve|screenshot|done|ask|run|worker|doctor> [args]\n" +
          "       rrw run    [--mode session|worker] [--agent claude|codex] [--delivery in-place|pr] [--poll <ms>]\n" +
          "       rrw worker [--agent claude|codex] [--delivery in-place|pr] [--poll <ms>]   # force headless\n" +
          "       rrw doctor   # 설정·브리지·토큰·(pr면)gh/git 점검",
      );
      process.exit(1);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
