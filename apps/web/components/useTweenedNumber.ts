import { useEffect, useRef, useState } from "react";
import { chartMotionMs, tweenAt } from "../lib/motion";

const reducedMotion = () => typeof window.matchMedia === "function"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The shown value of a number that counts from where it is to `target`, with the easing of the chart
 * transitions. It starts at zero, so a chart counts up when it appears; a new target mid-way continues from
 * the value on screen. With reduced motion the target shows on the next frame.
 */
export function useTweenedNumber(target: number, duration = chartMotionMs): number {
  const [shown, setShown] = useState(0);
  const current = useRef(0);
  useEffect(() => {
    const from = current.current;
    if (from === target) return;
    const length = reducedMotion() ? 0 : duration;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const value = tweenAt(from, target, now - start, length);
      current.current = value;
      setShown(value);
      if (value !== target) frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [target, duration]);
  return shown;
}
