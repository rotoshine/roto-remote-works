// Best-effort viewport screenshot via html2canvas. Lazy-loaded (dynamic import)
// so it never runs unless a comment is actually being captured. Returns a PNG
// data URL, or null if capture isn't possible (degrades gracefully).
export async function captureScreenshot(): Promise<string | null> {
  try {
    const { default: html2canvas } = await import("html2canvas");
    // Hide the overlay's own UI so it isn't in the shot.
    const hosts = Array.from(document.querySelectorAll<HTMLElement>("[data-rrw-host]"));
    const prev = hosts.map((h) => h.style.visibility);
    hosts.forEach((h) => (h.style.visibility = "hidden"));
    try {
      const canvas = await html2canvas(document.body, {
        x: window.scrollX,
        y: window.scrollY,
        width: window.innerWidth,
        height: window.innerHeight,
        windowWidth: document.documentElement.scrollWidth,
        windowHeight: document.documentElement.scrollHeight,
        logging: false,
        useCORS: true,
        scale: Math.min(window.devicePixelRatio || 1, 2),
      });
      return canvas.toDataURL("image/png");
    } finally {
      hosts.forEach((h, i) => (h.style.visibility = prev[i] ?? ""));
    }
  } catch {
    return null;
  }
}
