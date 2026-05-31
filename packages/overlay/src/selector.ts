import type { Rect } from "./types";

export interface Captured {
  selector: string;
  tag: string;
  classes: string;
  text: string;
  component: string | null;
  source: string | null;
  rect: Rect | null;
}

function escapeId(id: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(id);
  return id.replace(/([^\w-])/g, "\\$1");
}

/** A reasonably-unique CSS selector path from the element up to the nearest id / body. */
export function cssPath(el: Element): string {
  if (el.id) return `#${escapeId(el.id)}`;
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1 && node !== document.body && parts.length < 8) {
    if (node.id) {
      parts.unshift(`#${escapeId(node.id)}`);
      break;
    }
    let part = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
      if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(" > ");
}

/** Best-effort React-fiber inspection for source file:line + component name. */
export function inspectFiber(el: Element): { source: string | null; component: string | null } {
  try {
    const key = Object.keys(el).find(
      (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
    );
    if (!key) return { source: null, component: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fiber: any = (el as any)[key];
    let source: string | null = null;
    let component: string | null = null;
    for (let i = 0; fiber && i < 40; i++) {
      const src = fiber._debugSource;
      if (!source && src?.fileName) {
        source = `${src.fileName}:${src.lineNumber ?? 0}${src.columnNumber ? `:${src.columnNumber}` : ""}`;
      }
      if (!component) {
        const t = fiber.type;
        const name = typeof t === "function" ? (t.displayName as string) || t.name : null;
        if (name && /^[A-Z]/.test(name)) component = name;
      }
      if (source && component) break;
      fiber = fiber.return;
    }
    return { source, component };
  } catch {
    return { source: null, component: null };
  }
}

/** Capture everything the bridge needs to locate the clicked element. */
export function capture(el: Element): Captured {
  const r = el.getBoundingClientRect();
  const { source, component } = inspectFiber(el);
  return {
    selector: cssPath(el),
    tag: el.tagName.toLowerCase(),
    classes: typeof el.className === "string" ? el.className : "",
    text: (el.textContent ?? "").trim().slice(0, 200),
    component,
    source,
    rect: { x: r.x, y: r.y, w: r.width, h: r.height },
  };
}
