/** Preferred side of the anchor; the tooltip moves to the opposite side when it does not fit. */
export type TooltipPlacement = "top" | "right";
export type TooltipRect = { left: number; top: number; width: number; height: number };
export type TooltipSize = { width: number; height: number };

const margin = 8;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

/**
 * Top left corner of the tooltip box in viewport coordinates: on the preferred side of the anchor
 * (`gap` px away), on the opposite side when the preferred one has no room, and always at least
 * 8 px inside the viewport. A cursor anchor is a rect with no size.
 */
export function tooltipPosition(anchor: TooltipRect, tooltip: TooltipSize, viewport: TooltipSize,
  placement: TooltipPlacement, gap = 8): { left: number; top: number } {
  let left: number;
  let top: number;
  if (placement === "right") {
    left = anchor.left + anchor.width + gap;
    if (left + tooltip.width > viewport.width - margin) left = anchor.left - gap - tooltip.width;
    top = anchor.top + anchor.height / 2 - tooltip.height / 2;
  } else {
    top = anchor.top - gap - tooltip.height;
    if (top < margin) top = anchor.top + anchor.height + gap;
    left = anchor.left + anchor.width / 2 - tooltip.width / 2;
  }
  return {
    left: clamp(left, margin, viewport.width - tooltip.width - margin),
    top: clamp(top, margin, viewport.height - tooltip.height - margin),
  };
}
