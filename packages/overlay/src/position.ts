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
