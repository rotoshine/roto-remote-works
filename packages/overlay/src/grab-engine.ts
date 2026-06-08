import type { ReactGrabAPI, SourceInfo } from "react-grab";

export interface Grab {
  element: Element;
  source: string | null; // "file:line" (react-grab getSource has no column)
  component: string | null;
}

export interface GrabEngine {
  activate(): void;
  deactivate(): void;
  onGrab(cb: (g: Grab) => void): () => void;
  dispose(): void;
}

const PLUGIN_NAME = "roto-remote-works";

function formatSource(s: SourceInfo | null): string | null {
  if (!s?.filePath) return null;
  return s.lineNumber != null ? `${s.filePath}:${s.lineNumber}` : s.filePath;
}

/**
 * Lazily load react-grab and wrap it as a near-headless GrabEngine. Every option
 * here is load-bearing (see design spec §4):
 * - __REACT_GRAB_DISABLED__ before import: react-grab auto-inits at module-eval and
 *   would fire a telemetry fetch to react-grab.com.
 * - telemetry:false — no outbound calls (offline / Tailscale).
 * - freezeReactUpdates:false — default true monkeypatches the GLOBAL React dispatcher
 *   and would freeze our own overlay React tree.
 * - theme: ALL chrome off — react-grab is used only as a selection/source engine; we
 *   render every visual ourselves (Shadow DOM), so no react-grab styles.css is needed.
 * - onElementSelect returns false — suppress react-grab's default clipboard copy.
 */
export async function loadGrabEngine(): Promise<GrabEngine> {
  (window as unknown as { __REACT_GRAB_DISABLED__?: boolean }).__REACT_GRAB_DISABLED__ = true;

  const rg = await import("react-grab");
  const api: ReactGrabAPI =
    rg.getGlobalApi() ?? rg.init({ telemetry: false, freezeReactUpdates: false });

  const subscribers = new Set<(g: Grab) => void>();

  api.registerPlugin({
    name: PLUGIN_NAME,
    theme: {
      toolbar: { enabled: false },
      selectionBox: { enabled: false },
      dragBox: { enabled: false },
      grabbedBoxes: { enabled: false },
      elementLabel: { enabled: false },
    },
    hooks: {
      onElementSelect: async (element: Element): Promise<boolean> => {
        let source: string | null = null;
        let component: string | null = null;
        try {
          const s = await api.getSource(element);
          source = formatSource(s);
          component = s?.componentName ?? null;
        } catch {
          /* prod build / no source maps — degrade to null, caller falls back */
        }
        for (const cb of subscribers) cb({ element, source, component });
        return false;
      },
    },
  });

  let disposed = false;

  return {
    activate: () => {
      if (disposed) return;
      api.activate();
    },
    deactivate: () => {
      if (disposed) return;
      api.deactivate();
    },
    onGrab: (cb) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      subscribers.clear();
      api.unregisterPlugin(PLUGIN_NAME);
      api.dispose();
    },
  };
}
