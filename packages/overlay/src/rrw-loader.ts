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

// Expose the imperative controller, but only ONCE per page. When the overlay is
// vendored, the host statically imports this file (the vendored loader) AND it is
// re-exported from index.ts → so it also rides inside the lazily-imported
// overlay.js. Both module instances run this side-effect with SEPARATE unmount
// state. The vendored loader loads first and owns the real `unmount`; using `??=`
// keeps it on window so `window.__rrw.stop()` tears down the running overlay instead
// of hitting the bundle's empty-handle copy (a no-op).
if (typeof window !== "undefined") {
  const w = window as unknown as { __rrw?: unknown };
  w.__rrw ??= {
    start: startRrw,
    stop: stopRrw,
    isRunning: isRrwRunning,
  };
}
