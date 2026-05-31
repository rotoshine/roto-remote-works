import { createRoot, type Root } from "react-dom/client";
import { createClient, type BridgeClient } from "./client";
import { DesignCommentOverlay } from "./DesignCommentOverlay";
import { captureScreenshot as defaultCapture } from "./capture-screenshot";
import type { ApplyOrigin } from "./types";
import overlayCss from "./styles.css?inline";

export interface MountConfig {
  bridgeUrl?: string;
  token?: string;
  origin?: ApplyOrigin;
  pollMs?: number;
  /** Where to attach the overlay host (default: document.body). */
  target?: HTMLElement;
  /** Inject a client (testing); otherwise built from bridgeUrl + token. */
  client?: BridgeClient;
  /** Override screenshot capture (default: html2canvas viewport capture). */
  captureScreenshot?: () => Promise<string | null>;
}

/**
 * Mounts the overlay into an isolated Shadow DOM root so its styles never clash
 * with the host app's CSS (Tailwind / vanilla-extract / shadcn / none).
 * Returns an unmount function.
 */
export function mountOverlay(config: MountConfig = {}): () => void {
  const target = config.target ?? document.body;

  const host = document.createElement("div");
  host.setAttribute("data-rrw-host", "");
  target.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = overlayCss;
  shadow.appendChild(style);

  const mountPoint = document.createElement("div");
  shadow.appendChild(mountPoint);

  const client =
    config.client ??
    createClient({ baseUrl: config.bridgeUrl ?? "http://localhost:4317", token: config.token ?? "" });

  const root: Root = createRoot(mountPoint);
  root.render(
    <DesignCommentOverlay
      client={client}
      pollMs={config.pollMs}
      origin={config.origin}
      captureScreenshot={config.captureScreenshot ?? defaultCapture}
    />,
  );

  return () => {
    root.unmount();
    host.remove();
  };
}
