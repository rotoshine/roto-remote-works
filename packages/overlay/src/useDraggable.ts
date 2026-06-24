import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { clampToViewport, nextZ, type Box, type Point } from "./position";

const viewport = (): Box => ({ w: window.innerWidth, h: window.innerHeight });

export interface UseDraggableOptions {
  /** Approx element size, used to keep it (and its controls) fully on-screen. */
  size: Box;
  /** Default position; clamped to the viewport on mount. */
  initial: Point;
  /** Min px to each viewport edge (default 12). */
  margin?: number;
}

export interface Draggable {
  /** Spread onto the floating element: absolute position + bring-to-front z. */
  style: { left: number; top: number; zIndex: number };
  /** Spread onto the drag handle (a header/grip), not the whole element. */
  handleProps: { onMouseDown: (e: React.MouseEvent) => void };
}

/**
 * Make a floating overlay element draggable by a handle while keeping it on
 * screen: clamps on mount, during drag, and on window resize. Grabbing the
 * handle also raises the element above its siblings (bring-to-front).
 */
export function useDraggable({ size, initial, margin }: UseDraggableOptions): Draggable {
  const [pos, setPos] = useState<Point>(() => clampToViewport(initial, size, viewport(), margin));
  const [zIndex, setZIndex] = useState<number>(() => nextZ());
  const posRef = useRef(pos);
  posRef.current = pos;

  useEffect(() => {
    const onResize = () => setPos(clampToViewport(posRef.current, size, viewport(), margin));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [size, margin]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setZIndex(nextZ());
      const startX = e.clientX;
      const startY = e.clientY;
      const base = posRef.current;
      const onMove = (ev: MouseEvent) => {
        setPos(
          clampToViewport(
            { left: base.left + (ev.clientX - startX), top: base.top + (ev.clientY - startY) },
            size,
            viewport(),
            margin,
          ),
        );
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [size, margin],
  );

  return { style: { left: pos.left, top: pos.top, zIndex }, handleProps: { onMouseDown } };
}
