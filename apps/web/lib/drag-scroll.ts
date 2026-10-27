export type DragAxis = "x" | "y";
export type DragPoint = { x: number; y: number };
export type ScrollPosition = { left: number; top: number };
/** The parts of an element that decide whether it scrolls; `HTMLElement` fits. */
export type ScrollNode = {
  parentElement: ScrollNode | null; scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number;
};

/** Movement, in px, that turns a press on a table into a drag; below it the press stays a click. */
const threshold = 4;
/** Elements inside a table that keep their own pointer behaviour and never start a drag. */
export const dragIgnoreSelector = "a, button, input, select, textarea, label, summary, [role=button], [contenteditable], [data-drag-scroll=off]";

export const dragStarted = (distance: DragPoint) => Math.max(Math.abs(distance.x), Math.abs(distance.y)) > threshold;

/** Scroll position that keeps the content under the pointer: the content moves the same way as the pointer. */
export const dragScrollPosition = (start: ScrollPosition, distance: DragPoint): ScrollPosition =>
  ({ left: start.left - distance.x, top: start.top - distance.y });

/**
 * Nearest ancestor of `from` that scrolls on `axis`: its overflow is `auto` or `scroll` and its content
 * is more than 1 px larger than the box (sub-pixel rounding is not scrollable). The page itself has
 * `visible` overflow, so the caller falls back to it when nothing is found.
 */
export function scrollerFor<T extends ScrollNode>(from: T, axis: DragAxis, overflowOf: (node: T, axis: DragAxis) => string): T | null {
  for (let node = from.parentElement as T | null; node; node = node.parentElement as T | null) {
    const hidden = axis === "x" ? node.scrollWidth - node.clientWidth : node.scrollHeight - node.clientHeight;
    if (hidden > 1 && /^(auto|scroll)$/u.test(overflowOf(node, axis))) return node;
  }
  return null;
}
