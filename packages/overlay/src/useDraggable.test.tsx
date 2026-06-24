import { describe, it, expect } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { useDraggable } from "./useDraggable";
import type { Box, Point } from "./position";

function setViewport(w: number, h: number) {
  Object.defineProperty(window, "innerWidth", { value: w, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: h, configurable: true });
}

function Harness({ initial, size, testid = "box" }: { initial: Point; size: Box; testid?: string }) {
  const { style, handleProps } = useDraggable({ size, initial });
  return (
    <div data-testid={testid} style={style}>
      <div data-testid={`${testid}-handle`} {...handleProps}>
        handle
      </div>
    </div>
  );
}

describe("useDraggable", () => {
  it("moves the element by the drag delta", () => {
    setViewport(1200, 800);
    const { getByTestId } = render(<Harness initial={{ left: 100, top: 100 }} size={{ w: 100, h: 100 }} />);
    const handle = getByTestId("box-handle");

    fireEvent.mouseDown(handle, { clientX: 500, clientY: 500 });
    fireEvent.mouseMove(document, { clientX: 550, clientY: 530 }); // +50, +30
    fireEvent.mouseUp(document);

    const box = getByTestId("box");
    expect(box.style.left).toBe("150px");
    expect(box.style.top).toBe("130px");
  });

  it("clamps to the viewport while dragging so it never leaves the screen", () => {
    setViewport(1200, 800);
    const { getByTestId } = render(<Harness initial={{ left: 100, top: 100 }} size={{ w: 100, h: 100 }} />);
    const handle = getByTestId("box-handle");

    fireEvent.mouseDown(handle, { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(document, { clientX: 5000, clientY: 5000 }); // far off-screen
    fireEvent.mouseUp(document);

    const box = getByTestId("box");
    expect(box.style.left).toBe("1088px"); // 1200 - 100 - 12
    expect(box.style.top).toBe("688px"); // 800 - 100 - 12
  });

  it("re-clamps when the window shrinks", () => {
    setViewport(1200, 800);
    const { getByTestId } = render(<Harness initial={{ left: 500, top: 400 }} size={{ w: 100, h: 100 }} />);
    const box = getByTestId("box");
    expect(box.style.left).toBe("500px"); // fits initially

    act(() => {
      setViewport(600, 500);
      window.dispatchEvent(new Event("resize"));
    });

    expect(box.style.left).toBe("488px"); // 600 - 100 - 12
    expect(box.style.top).toBe("388px"); // 500 - 100 - 12
  });

  it("brings the just-dragged element to front (higher z-index than a sibling grabbed earlier)", () => {
    setViewport(1200, 800);
    const { getByTestId } = render(
      <>
        <Harness initial={{ left: 100, top: 100 }} size={{ w: 100, h: 100 }} testid="a" />
        <Harness initial={{ left: 300, top: 300 }} size={{ w: 100, h: 100 }} testid="b" />
      </>,
    );

    fireEvent.mouseDown(getByTestId("a-handle"), { clientX: 0, clientY: 0 });
    fireEvent.mouseUp(document);
    fireEvent.mouseDown(getByTestId("b-handle"), { clientX: 0, clientY: 0 });
    fireEvent.mouseUp(document);

    const za = Number(getByTestId("a").style.zIndex);
    const zb = Number(getByTestId("b").style.zIndex);
    expect(zb).toBeGreaterThan(za);
  });
});
