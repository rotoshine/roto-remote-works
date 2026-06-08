/** Minimal mount config the loader passes through to mountOverlay. Inlined (not
 *  imported from ./mount) so the vendored loader resolves in any host where only
 *  overlay.js is copied. `token` is the BROWSER bearer = the LOW-trust clientToken;
 *  the high-trust token is server-only (RRW_TOKEN env) and must never be bundled. */
export interface RrwLoaderConfig {
  bridgeUrl?: string;
  token?: string;
  author?: string;
  pollMs?: number;
}

let unmount: (() => void) | undefined;
let starting = false;
let wantRunning = false;

/** Lazy-load and mount the overlay. Idempotent; callable from a host effect, a
 *  console, or vConsole. The dynamic import keeps the heavy chunk out of every
 *  normal user's bundle. */
export async function startRrw(config: RrwLoaderConfig = {}): Promise<void> {
  wantRunning = true;
  if (unmount || starting) return;
  starting = true;
  try {
    const m = (await import("./index")) as { mountOverlay: (c: RrwLoaderConfig) => () => void };
    const u = m.mountOverlay(config);
    if (wantRunning) {
      unmount = u;
    } else {
      // stopRrw() was called while the import was in-flight — tear down immediately
      // so no overlay is left stranded with no unmount handle.
      u();
    }
  } finally {
    starting = false;
  }
}

export function stopRrw(): void {
  wantRunning = false;
  unmount?.();
  unmount = undefined;
}

export function isRrwRunning(): boolean {
  return !!unmount;
}

if (typeof window !== "undefined") {
  (window as unknown as { __rrw?: unknown }).__rrw = {
    start: startRrw,
    stop: stopRrw,
    isRunning: isRrwRunning,
  };
}
