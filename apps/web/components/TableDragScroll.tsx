"use client";

import { useEffect } from "react";
import { dragIgnoreSelector, dragScrollPosition, dragStarted, scrollerFor, type DragAxis } from "../lib/drag-scroll";

type Drag = {
  pointerId: number; table: HTMLTableElement; startX: number; startY: number; moved: boolean;
  x: Element | null; y: Element | null; left: number; top: number;
};

const draggingClass = "table-drag-scrolling";
const overflowOf = (node: Element, axis: DragAxis) => {
  const style = getComputedStyle(node);
  return axis === "x" ? style.overflowX : style.overflowY;
};

/**
 * Lets every table of the app scroll by dragging with the mouse, on both axes: sideways it moves the
 * table's own scroll box, vertically the box when its height is limited and the page otherwise.
 * Touch already scrolls natively, controls keep their behaviour and Alt + drag still selects text.
 * Listens once on the document, so tables added later need nothing.
 */
export default function TableDragScroll() {
  useEffect(() => {
    let drag: Drag | null = null;

    const end = (event: PointerEvent) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const { moved, table } = drag;
      drag = null;
      document.documentElement.classList.remove(draggingClass);
      if (table.hasPointerCapture(event.pointerId)) table.releasePointerCapture(event.pointerId);
      if (!moved) return;
      // The click that ends a drag must not select a row or follow a link.
      const swallow = (click: MouseEvent) => { click.preventDefault(); click.stopPropagation(); };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }));
    };

    const down = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0 || event.altKey || !(event.target instanceof Element)) return;
      const table = event.target.closest("table");
      if (!table || event.target.closest(dragIgnoreSelector)) return;
      const page = document.scrollingElement;
      const x = scrollerFor(table, "x", overflowOf);
      const y = scrollerFor(table, "y", overflowOf)
        ?? (page && page.scrollHeight - page.clientHeight > 1 ? page : null);
      if (!x && !y) return;
      drag = { pointerId: event.pointerId, table, startX: event.clientX, startY: event.clientY, moved: false,
        x, y, left: x?.scrollLeft ?? 0, top: y?.scrollTop ?? 0 };
    };

    const move = (event: PointerEvent) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      // The button was released outside the window, where no pointerup reaches the page.
      if ((event.buttons & 1) === 0) { end(event); return; }
      const distance = { x: event.clientX - drag.startX, y: event.clientY - drag.startY };
      if (!drag.moved) {
        if (!dragStarted(distance)) return;
        drag.moved = true;
        document.documentElement.classList.add(draggingClass);
        window.getSelection()?.removeAllRanges();
        drag.table.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
      const { left, top } = dragScrollPosition({ left: drag.left, top: drag.top }, distance);
      if (drag.x) drag.x.scrollLeft = left;
      if (drag.y) drag.y.scrollTop = top;
    };

    document.addEventListener("pointerdown", down);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
      document.documentElement.classList.remove(draggingClass);
    };
  }, []);
  return null;
}
