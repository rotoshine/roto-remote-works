import { useEffect } from "react";
import { startRrw, stopRrw, type RrwLoaderConfig } from "./rrw-loader";

/** Declarative host-owned activation. Pass `enabled` computed from your own
 *  userId/role/flag; when true the overlay lazy-loads and mounts, when false
 *  (normal users) nothing is fetched. `config` must be a STABLE reference
 *  (module-scope or memoized): the effect re-runs only on `enabled` changes — to
 *  change config, call stopRrw() then re-enable. */
export function useRrwOverlay(enabled: boolean, config: RrwLoaderConfig = {}): void {
  useEffect(() => {
    if (!enabled) return;
    void startRrw(config);
    return () => stopRrw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
