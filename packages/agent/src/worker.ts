export interface WorkerDeps {
  /** Returns the pending apply request, or null. */
  getRequest: () => Promise<{ requestedAt: string } | null>;
  /** Invoked once per new request to process it (e.g. spawn claude/codex). */
  runAgent: (req: { requestedAt: string }) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  shouldStop?: () => boolean;
  pollMs?: number;
}

/**
 * Headless worker: polls the bridge and invokes the configured agent once per
 * new request. Dedupes by `requestedAt`, so a request is never re-run (even if
 * the agent crashes) — a fresh apply gets a new timestamp and is handled.
 */
export async function runWorkerLoop(deps: WorkerDeps): Promise<void> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = deps.pollMs ?? 2000;
  const stop = deps.shouldStop ?? (() => false);

  let lastHandled: string | null = null;
  while (!stop()) {
    const req = await deps.getRequest().catch(() => null);
    if (req && req.requestedAt !== lastHandled) {
      lastHandled = req.requestedAt;
      try {
        await deps.runAgent(req);
      } catch {
        /* agent failed — do not re-run this request; a new apply will retry */
      }
    }
    if (stop()) break;
    await sleep(pollMs);
  }
}
