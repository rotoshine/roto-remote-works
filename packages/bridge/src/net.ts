const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "0:0:0:0:0:0:0:1"]);

/**
 * Advice to print when the bridge binds a non-loopback address. The bridge can't
 * detect whether a private tunnel is in front of it, so warn the operator to
 * keep it behind network gating and never on the public internet.
 * Returns null for safe loopback binds.
 */
export function bindAdvice(host: string): string | null {
  if (LOOPBACK.has(host)) return null;
  return (
    `[rrw-bridge] WARNING: bound to ${host} (non-loopback). Expose ONLY behind ` +
    `network gating (Tailscale / Cloudflare Access) — never on the public internet. ` +
    `Set a low-trust clientToken for the overlay and keep the high-trust token server-side.`
  );
}
