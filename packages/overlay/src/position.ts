export interface Box {
  w: number;
  h: number;
}
export interface Point {
  left: number;
  top: number;
}

/**
 * Keep a floating card fully on-screen: clamp `pos` so a `card`-sized box stays
 * within `viewport` with at least `margin` px to each edge. Prevents the comment
 * draft (and its buttons) from overflowing when an element near the right/bottom
 * edge is clicked.
 */
export function clampToViewport(pos: Point, card: Box, viewport: Box, margin = 12): Point {
  return {
    left: Math.max(margin, Math.min(pos.left, viewport.w - card.w - margin)),
    top: Math.max(margin, Math.min(pos.top, viewport.h - card.h - margin)),
  };
}

/**
 * Floating panels sit inside `.rrw-root` (z 2147483000), below the hover
 * highlight (z 2147483100). A small positive base lifts a dragged panel above
 * its auto-stacked siblings (including the FAB) while staying under the
 * highlight. Each call hands out a strictly larger value → bring-to-front.
 */
export const BASE_DRAG_Z = 10;

/** Make an independent monotonically-increasing z-index counter above `base`. */
export function createZAllocator(base: number): () => number {
  let z = base;
  return () => ++z;
}

/** Shared bring-to-front allocator used by all draggable overlay panels. */
export const nextZ = createZAllocator(BASE_DRAG_Z);
