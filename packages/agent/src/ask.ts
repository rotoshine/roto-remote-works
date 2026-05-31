import type { AgentClient } from "./client";

export type AskResult =
  | { answered: true; answer: string }
  | { answered: false; reason: "cancelled" | "timeout" };

export interface AskOptions {
  options?: string[];
  pollMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Posts a question to the bridge and polls until the user answers in the web
 * overlay, the question is cancelled, or the timeout elapses (auto-cancel).
 * This is how the agent asks instead of using the terminal AskUserQuestion.
 */
export async function askQuestion(client: AgentClient, text: string, opts: AskOptions = {}): Promise<AskResult> {
  const pollMs = opts.pollMs ?? 1500;
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());

  const start = now();
  const posted = await client.postQuestion({ text, options: opts.options });

  for (;;) {
    const current = await client.currentQuestion();
    if (current && current.id === posted.id) {
      if (current.status === "answered") return { answered: true, answer: current.answer ?? "" };
      if (current.status === "cancelled") return { answered: false, reason: "cancelled" };
    }
    if (now() - start >= timeoutMs) {
      await client.cancelQuestion(posted.id);
      return { answered: false, reason: "timeout" };
    }
    await sleep(pollMs);
  }
}
