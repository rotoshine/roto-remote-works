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
let starting: Promise<void> | undefined;

/** Lazy-load and mount the overlay. Idempotent; callable from a host effect, a
 *  console, or vConsole. The dynamic import keeps the heavy chunk out of every
 *  normal user's bundle. */
export async function startRrw(config: RrwLoaderConfig = {}): Promise<void> {
  if (unmount) return;
  if (starting) return starting;
  starting = import("./index")
    .then((m: { mountOverlay: (c: RrwLoaderConfig) => () => void }) => {
      unmount = m.mountOverlay(config);
    })
    .finally(() => {
      starting = undefined;
    });
  return starting;
}

export function stopRrw(): void {
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
