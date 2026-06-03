export interface WatchDeps {
  getRequest: () => Promise<{ requestedAt: string } | null>;
  /** Called once per NEW apply request (deduped by requestedAt). */
  onRequest: (req: { requestedAt: string }) => void | Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  shouldStop?: () => boolean;
  /** Stop after the first request fires. */
  once?: boolean;
  pollMs?: number;
}

/**
 * Poll the bridge and fire `onRequest` when a new apply request appears — for
 * session mode, so an interactive agent session (or a Monitor watching stdout)
 * wakes up when someone presses the overlay's "apply" button.
 */
export async function runWatch(deps: WatchDeps): Promise<void> {
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const pollMs = deps.pollMs ?? 2000;
  let lastSeen: string | null = null;

  while (!(deps.shouldStop?.() ?? false)) {
    const req = await deps.getRequest();
    if (req) {
      if (req.requestedAt !== lastSeen) {
        lastSeen = req.requestedAt;
        await deps.onRequest(req);
        if (deps.once) return;
      }
    } else {
      lastSeen = null; // request cleared — let the next one fire
    }
    await sleep(pollMs);
  }
}
