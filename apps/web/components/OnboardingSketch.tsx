"use client";

import type { ReactNode } from "react";
import { SKETCH_HEIGHT, SKETCH_WIDTH, type SketchBlock, type SketchPoint } from "../lib/onboarding";

// Fixed heights keep the drawing identical on every render; they only suggest a chart.
const barHeights = [.5, .8, .62, .9, .42, .72, .55, .86];

/** Splits a width into `n` parts separated by `gap`. */
function parts(x: number, w: number, n: number, gap: number) {
  const size = (w - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, k) => ({ x: x + k * (size + gap), w: size }));
}

function drawBlock(block: SketchBlock, key: number): ReactNode {
  const { kind, x, y, w, h } = block;
  const n = block.n ?? 1;
  switch (kind) {
    case "title":
      return <g key={key}>
        <rect className="onboarding-sketch-strong" x={x} y={y} width={w * .62} height={h * .5} rx={3} />
        <rect className="onboarding-sketch-line" x={x} y={y + h * .7} width={w} height={h * .22} rx={2} />
      </g>;
    case "button":
      return <rect key={key} className="onboarding-sketch-primary" x={x} y={y} width={w} height={h} rx={h / 2} />;
    case "tabs":
      return <g key={key}>{parts(x, w, n, 4).map((part, k) => <g key={k}>
        <rect className={k === 0 ? "onboarding-sketch-soft" : "onboarding-sketch-line"} x={part.x} y={y} width={part.w} height={h} rx={3} />
        {k === 0 && <rect className="onboarding-sketch-primary" x={part.x} y={y + h - 2} width={part.w} height={2} />}
      </g>)}</g>;
    case "filters":
      return <g key={key}>{parts(x, w, n, 6).map((part, k) =>
        <rect key={k} className="onboarding-sketch-field" x={part.x} y={y} width={part.w} height={h} rx={3} />)}</g>;
    case "kpis":
      return <g key={key}>{parts(x, w, n, 6).map((part, k) => <g key={k}>
        <rect className="onboarding-sketch-tile" x={part.x} y={y} width={part.w} height={h} rx={4} />
        <rect className={k % 2 ? "onboarding-sketch-accent" : "onboarding-sketch-primary"} x={part.x} y={y} width={3} height={h} rx={1.5} />
        <rect className="onboarding-sketch-line" x={part.x + 8} y={y + h * .22} width={part.w * .5} height={3} rx={1.5} />
        <rect className="onboarding-sketch-strong" x={part.x + 8} y={y + h * .5} width={part.w * .35} height={Math.min(8, h * .25)} rx={2} />
      </g>)}</g>;
    case "table": {
      const rowHeight = (h - 12) / n;
      return <g key={key}>
        <rect className="onboarding-sketch-tile" x={x} y={y} width={w} height={h} rx={4} />
        <rect className="onboarding-sketch-header" x={x} y={y} width={w} height={12} rx={4} />
        {Array.from({ length: n }, (_, k) => {
          const rowY = y + 12 + k * rowHeight;
          return <g key={k}>
            {k > 0 && <rect className="onboarding-sketch-divider" x={x} y={rowY} width={w} height={.8} />}
            <rect className="onboarding-sketch-line" x={x + 8} y={rowY + rowHeight / 2 - 2} width={w * .22} height={4} rx={2} />
            <rect className="onboarding-sketch-line" x={x + w * .34} y={rowY + rowHeight / 2 - 2} width={w * .28} height={4} rx={2} />
            <rect className={k % 3 === 1 ? "onboarding-sketch-accent" : "onboarding-sketch-soft"} x={x + w - 54}
              y={rowY + rowHeight / 2 - 4} width={42} height={8} rx={4} />
          </g>;
        })}
      </g>;
    }
    case "bars":
      return <g key={key}>
        <rect className="onboarding-sketch-tile" x={x} y={y} width={w} height={h} rx={4} />
        {parts(x + 10, w - 20, n, 6).map((part, k) => {
          const barHeight = (h - 16) * barHeights[k % barHeights.length];
          return <rect key={k} className={k % 2 ? "onboarding-sketch-accent" : "onboarding-sketch-primary"}
            x={part.x} y={y + h - 8 - barHeight} width={part.w} height={barHeight} rx={2} />;
        })}
      </g>;
    case "donut": {
      const radius = Math.min(w, h) / 2 - 10;
      const length = 2 * Math.PI * radius;
      const cx = x + w / 2;
      const cy = y + h / 2;
      return <g key={key}>
        <rect className="onboarding-sketch-tile" x={x} y={y} width={w} height={h} rx={4} />
        <circle className="onboarding-sketch-ring" cx={cx} cy={cy} r={radius} />
        <circle className="onboarding-sketch-ring-primary" cx={cx} cy={cy} r={radius}
          strokeDasharray={`${length * .58} ${length}`} transform={`rotate(-90 ${cx} ${cy})`} />
        <circle className="onboarding-sketch-ring-accent" cx={cx} cy={cy} r={radius}
          strokeDasharray={`${length * .24} ${length}`} strokeDashoffset={-length * .6} transform={`rotate(-90 ${cx} ${cy})`} />
      </g>;
    }
    case "rail": {
      const dots = parts(x, w, 6, 0);
      const cy = y + h / 2;
      return <g key={key}>
        <rect className="onboarding-sketch-divider" x={dots[0].x + dots[0].w / 2} y={cy - 1} width={w - dots[0].w} height={2} />
        {dots.map((dot, k) => <circle key={k} className={k < 3 ? "onboarding-sketch-accent" : "onboarding-sketch-primary"}
          cx={dot.x + dot.w / 2} cy={cy} r={5} />)}
      </g>;
    }
    case "upload":
      return <g key={key}>
        <rect className="onboarding-sketch-drop" x={x} y={y} width={w} height={h} rx={6} />
        <path className="onboarding-sketch-arrow" d={`M${x + w / 2} ${y + h * .68}V${y + h * .3}m-7 7 7-7 7 7`} />
      </g>;
    case "checklist": {
      const rowHeight = h / n;
      return <g key={key}>
        <rect className="onboarding-sketch-tile" x={x} y={y} width={w} height={h} rx={4} />
        {Array.from({ length: n }, (_, k) => {
          const cy = y + rowHeight * (k + .5);
          return <g key={k}>
            <circle className={k % 2 ? "onboarding-sketch-accent" : "onboarding-sketch-warn"} cx={x + 12} cy={cy} r={4} />
            <rect className="onboarding-sketch-line" x={x + 22} y={cy - 2} width={(w - 34) * (k % 3 === 2 ? .55 : .8)} height={4} rx={2} />
          </g>;
        })}
      </g>;
    }
    case "form": {
      const columns = parts(x, w, 2, 10);
      const rows = Math.ceil(n / 2);
      const rowHeight = h / rows;
      return <g key={key}>{Array.from({ length: n }, (_, k) => {
        const column = columns[k % 2];
        const rowY = y + Math.floor(k / 2) * rowHeight;
        return <g key={k}>
          <rect className="onboarding-sketch-line" x={column.x} y={rowY + 2} width={column.w * .45} height={3} rx={1.5} />
          <rect className="onboarding-sketch-field" x={column.x} y={rowY + 8} width={column.w} height={Math.min(14, rowHeight - 12)} rx={3} />
        </g>;
      })}</g>;
    }
  }
}

/**
 * Schematic drawing of a screen with its numbered walkthrough points. It holds no real data, follows the
 * theme through the tokens and highlights the point of the current step.
 */
export default function OnboardingSketch({ blocks, points, current, label }: {
  blocks: readonly SketchBlock[]; points: readonly SketchPoint[]; current: number | null; label: string;
}) {
  return <svg className="onboarding-sketch" viewBox={`0 0 ${SKETCH_WIDTH} ${SKETCH_HEIGHT}`} role="img" aria-label={label}>
    <rect className="onboarding-sketch-frame" x={1} y={1} width={SKETCH_WIDTH - 2} height={SKETCH_HEIGHT - 2} rx={10} />
    {blocks.map(drawBlock)}
    {points.map((point, k) => <g key={k} className={k === current ? "onboarding-sketch-point is-current" : "onboarding-sketch-point"}>
      {k === current && <circle className="onboarding-sketch-pulse" cx={point.x} cy={point.y} r={9} />}
      <circle className="onboarding-sketch-dot" cx={point.x} cy={point.y} r={8} />
      <text className="onboarding-sketch-number" x={point.x} y={point.y} textAnchor="middle" dominantBaseline="central">{k + 1}</text>
    </g>)}
  </svg>;
}
