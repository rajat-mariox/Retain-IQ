"use client";

import { useState } from "react";

/**
 * Small, dependency-free inline-SVG charts for report surfaces. Single-series by
 * design (magnitude / change-over-time), so no legend is needed — the card title
 * names the series. Recessive grid, a 2px brand line/area, an emphasized endpoint,
 * and a hover crosshair + tooltip. Colors come from CSS tokens (brand + ink), so
 * they follow the theme. Values/labels wear ink tokens, never the series color.
 */

const BRAND = "var(--color-brand, #1f883d)";

export interface Point { label: string; value: number; sub?: string }

/** Area + line trend. `unit` (e.g. "%", "h") is appended in the tooltip. */
export function MiniTrend({ points, height = 120, unit = "", valueFmt }: { points: Point[]; height?: number; unit?: string; valueFmt?: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 100; // viewBox width (percentage-based, scales to container)
  const pad = 6;
  if (points.length === 0) return <div className="grid h-[120px] place-items-center text-xs text-slate-400">No data</div>;

  const max = Math.max(1, ...points.map((p) => p.value));
  const min = Math.min(0, ...points.map((p) => p.value));
  const span = max - min || 1;
  const n = points.length;
  const x = (i: number) => (n === 1 ? w / 2 : pad + (i / (n - 1)) * (w - 2 * pad));
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - 2 * pad);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.value).toFixed(2)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(2)},${height - pad} L${x(0).toFixed(2)},${height - pad} Z`;
  const fmt = valueFmt ?? ((v: number) => String(v));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="h-[120px] w-full" style={{ height }}>
        {/* recessive gridlines */}
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={pad} x2={w - pad} y1={pad + g * (height - 2 * pad)} y2={pad + g * (height - 2 * pad)} stroke="currentColor" className="text-slate-200" strokeWidth={0.3} />
        ))}
        <defs>
          <linearGradient id="mt-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BRAND} stopOpacity={0.18} />
            <stop offset="100%" stopColor={BRAND} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#mt-fill)" />
        <path d={line} fill="none" stroke={BRAND} strokeWidth={0.8} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {/* endpoint marker */}
        <circle cx={x(n - 1)} cy={y(points[n - 1]!.value)} r={1.4} fill={BRAND} />
        {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={pad} y2={height - pad} stroke={BRAND} strokeWidth={0.4} strokeDasharray="1 1" /> : null}
        {/* hit targets */}
        {points.map((p, i) => (
          <rect key={i} x={x(i) - (w / n) / 2} y={0} width={w / n} height={height} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>
      {hover !== null ? (
        <div className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-slate-900 px-2 py-1 text-[11px] text-white shadow" style={{ left: `${x(hover)}%` }}>
          <div className="font-medium tabular-nums">{fmt(points[hover]!.value)}{unit}</div>
          <div className="text-slate-300">{points[hover]!.label}</div>
        </div>
      ) : null}
    </div>
  );
}

/** Vertical bar chart (magnitude by category), single hue, hover tooltip. */
export function MiniBars({ points, height = 120, unit = "", valueFmt }: { points: Point[]; height?: number; unit?: string; valueFmt?: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) return <div className="grid h-[120px] place-items-center text-xs text-slate-400">No data</div>;
  const max = Math.max(1, ...points.map((p) => p.value));
  const fmt = valueFmt ?? ((v: number) => String(v));

  return (
    <div className="relative">
      <div className="flex items-end gap-1.5" style={{ height }}>
        {points.map((p, i) => (
          <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div className="flex w-full flex-1 items-end">
              <div className="w-full rounded-t" style={{ height: `${Math.max(2, Math.round((p.value / max) * 100))}%`, backgroundColor: BRAND, opacity: hover === null || hover === i ? 1 : 0.5 }} />
            </div>
            <span className="w-full truncate text-center text-[10px] text-slate-400">{p.label}</span>
          </div>
        ))}
      </div>
      {hover !== null ? (
        <div className="pointer-events-none absolute -top-1 z-10 -translate-y-full rounded-lg bg-slate-900 px-2 py-1 text-[11px] text-white shadow" style={{ left: `${((hover + 0.5) / points.length) * 100}%`, transform: "translate(-50%, -100%)" }}>
          <div className="font-medium tabular-nums">{fmt(points[hover]!.value)}{unit}</div>
          <div className="text-slate-300">{points[hover]!.label}{points[hover]!.sub ? ` · ${points[hover]!.sub}` : ""}</div>
        </div>
      ) : null}
    </div>
  );
}
