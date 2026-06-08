import { describe, it, expect, beforeEach, vi } from "vitest";
import { cssPath, inspectFiber, capture } from "./selector";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("cssPath", () => {
  it("uses #id when the element has one", () => {
    document.body.innerHTML = `<div id="hero"></div>`;
    expect(cssPath(document.getElementById("hero")!)).toBe("#hero");
  });

  it("builds an nth-of-type path that resolves back to the element", () => {
    document.body.innerHTML = `<section><p>a</p><p>b</p><span></span></section>`;
    const target = document.querySelectorAll("p")[1]!;
    const path = cssPath(target);
    expect(document.querySelector(path)).toBe(target);
  });

  it("stops at the nearest ancestor id", () => {
    document.body.innerHTML = `<main id="root"><ul><li></li><li></li></ul></main>`;
    const target = document.querySelectorAll("li")[1]!;
    const path = cssPath(target);
    expect(path.startsWith("#root")).toBe(true);
    expect(document.querySelector(path)).toBe(target);
  });
});

describe("inspectFiber", () => {
  it("returns nulls when there is no React fiber (non-React host)", () => {
    document.body.innerHTML = `<div></div>`;
    expect(inspectFiber(document.querySelector("div")!)).toEqual({ source: null, component: null });
  });
});

describe("capture", () => {
  it("collects selector, tag, classes, text, and rect", () => {
    document.body.innerHTML = `<button class="btn primary">Click me</button>`;
    const cap = capture(document.querySelector("button")!);
    expect(cap.tag).toBe("button");
    expect(cap.classes).toBe("btn primary");
    expect(cap.text).toBe("Click me");
    expect(cap.selector).toContain("button");
    expect(cap.rect).not.toBeNull();
    expect(cap.component).toBeNull();
    expect(cap.source).toBeNull();
  });
});

describe("capture with override", () => {
  it("prefers an explicit source/component over fiber inspection", () => {
    const el = document.createElement("div");
    const c = capture(el, { source: "src/Foo.tsx:3", component: "Foo" });
    expect(c.source).toBe("src/Foo.tsx:3");
    expect(c.component).toBe("Foo");
  });

  it("falls back to fiber inspection per-field when override is null", () => {
    const el = document.createElement("div");
    const c = capture(
      el,
      { source: null, component: null },
      () => ({ source: "fallback:5", component: "FallbackComponent" }),
    );
    expect(c.source).toBe("fallback:5");
    expect(c.component).toBe("FallbackComponent");
  });
});
