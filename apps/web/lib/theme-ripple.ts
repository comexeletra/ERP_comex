/** Width (px) of the soft front and rings that run ahead of the new theme; base.css uses the same value. */
export const rippleWaveWidth = 72;

type Pointer = { clientX: number; clientY: number; detail: number };
type Rect = { left: number; top: number; width: number; height: number };
type Viewport = { width: number; height: number };

/**
 * Center and final radius of the theme ripple. A keyboard click (`detail === 0`)
 * has no pointer position, so the wave starts at the button center. The radius
 * reaches the farthest viewport corner plus the wave, so the whole page ends in the new theme.
 */
export function rippleGeometry(pointer: Pointer, rect: Rect, viewport: Viewport) {
  const fromKeyboard = pointer.detail === 0;
  const x = fromKeyboard ? rect.left + rect.width / 2 : pointer.clientX;
  const y = fromKeyboard ? rect.top + rect.height / 2 : pointer.clientY;
  const radius = Math.ceil(Math.hypot(Math.max(x, viewport.width - x), Math.max(y, viewport.height - y))) + rippleWaveWidth;
  return { x, y, radius };
}
