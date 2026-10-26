"use client";

import { ReactNode, useEffect, useState } from "react";
import { E2eIconName, E2eSide, railCenter } from "../lib/e2e-flow";

export type E2eFlowIconName = E2eIconName | "pause" | "play" | "prev" | "next";

const icons: Record<E2eFlowIconName, ReactNode> = {
  plan: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 3h6v3H9z" /><path d="M9 12h6M9 16h4" /></>,
  cart: <><circle cx="9" cy="20" r="1.5" /><circle cx="17" cy="20" r="1.5" /><path d="M3 4h2l2.4 11h11l2-8H6.2" /></>,
  send: <><path d="M21 3L10 14" /><path d="M21 3l-7 18-4-7-7-4z" /></>,
  factory: <><path d="M3 21V10l6 4v-4l6 4V6l6 3v12z" /><path d="M3 21h18" /></>,
  ship: <><path d="M3 15h18l-2.5 5h-13z" /><path d="M6 15V9h12v6" /><path d="M12 9V4" /><path d="M9 6h6" /></>,
  plane: <path d="M2 13l8-2 4-7h2l-2 7 6 1 2-3h1.5l-1 4 1 4H22l-2-3-6 1 2 7h-2l-4-7-8-2z" />,
  truck: <><path d="M2 6h11v10H2z" /><path d="M13 9h4l4 4v3h-8" /><circle cx="6.5" cy="18" r="1.8" /><circle cx="17" cy="18" r="1.8" /></>,
  pause: <path d="M8 5v14M16 5v14" />,
  play: <path d="M7 4l13 8-13 8z" />,
  prev: <path d="M15 18l-6-6 6-6" />,
  next: <path d="M9 18l6-6-6-6" />,
};

export function Icon({ name, size = 20 }: { name: E2eFlowIconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>;
}

export function Arrow({ w = 34, h = 14 }: { w?: number; h?: number }) {
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none" stroke="currentColor" strokeWidth="2.2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={`M2 ${h / 2}h${w - 6}M${w - 10} 2l6 ${h / 2 - 2}-6 ${h / 2 - 2}`} />
  </svg>;
}

/** Steps through the six stages; `current` is null when no stage is selected. */
export function useE2eStepper(count: number, intervalMs: number, autoplay: boolean, initial: number | null = 0) {
  const [current, setCurrent] = useState<number | null>(initial);
  const [playing, setPlaying] = useState(autoplay);

  useEffect(() => {
    if (!playing) return undefined;
    const timer = setInterval(() => setCurrent(value => ((value ?? -1) + 1) % count), intervalMs);
    return () => clearInterval(timer);
  }, [playing, count, intervalMs]);

  /** Selecting a stage (or none) stops the animation. */
  function goTo(k: number | null) { setCurrent(k); setPlaying(false); }
  /** Playing starts at the first stage when none is selected. */
  function toggle() {
    if (!playing && current === null) setCurrent(0);
    setPlaying(value => !value);
  }
  return { current, playing, goTo, toggle };
}

/** Dashed rail with one dot per stage and the moving marker over the current one. */
export function E2eFlowRail({ phases, current }: {
  phases: { code: string; side: E2eSide; icon: E2eIconName }[]; current: number | null;
}) {
  const reached = current ?? -1;
  return <div className="e2e-rail" aria-hidden="true">
    <div className="e2e-rail-base" style={{ left: railCenter(0), right: `calc(100% - ${railCenter(phases.length - 1)})` }} />
    {current !== null && <div className="e2e-rail-progress"
      style={{ left: railCenter(0), width: `calc(${railCenter(current)} - ${railCenter(0)})` }} />}
    <div className="e2e-grid6 e2e-rail-dots">
      {phases.map((item, k) => <div key={item.code}>
        <span className={`e2e-rail-dot side-${item.side}${k <= reached ? " is-reached" : ""}${k < reached ? " is-done" : ""}`} />
      </div>)}
    </div>
    {current !== null && <div className="e2e-marker" style={{ left: railCenter(current) }}>
      <span className="e2e-marker-ring" />
      <span className="e2e-marker-disc"><Icon name={phases[current].icon} size={24} /></span>
    </div>}
  </div>;
}
