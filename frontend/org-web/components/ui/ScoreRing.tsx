/**
 * A compact 0–100 score ring. The arc length encodes the magnitude; its colour
 * follows the same four-band scale the rest of the scorecard uses (a sequential
 * good→poor ramp), and the number sits in the centre in ink — the colour is a
 * reinforcement, never the only signal. Renders a hollow ring for "no score".
 */
function bandColor(v: number): string {
  if (v >= 85) return "var(--score-excellent, #059669)";
  if (v >= 70) return "var(--score-good, #65a30d)";
  if (v >= 55) return "var(--score-fair, #f59e0b)";
  return "var(--score-poor, #f43f5e)";
}

export function ScoreRing({ value, size = 52, stroke = 5 }: { value: number | null; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const has = value !== null;
  const pct = has ? Math.max(0, Math.min(100, value)) : 0;
  const color = has ? bandColor(value) : "var(--color-hairline, #e5e7eb)";
  return (
    <span className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-panel-2, #f1f5f9)" strokeWidth={stroke} />
        {has ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct / 100)}
          />
        ) : null}
      </svg>
      <span className="absolute text-sm font-semibold tabular-nums text-slate-800">{has ? value : "0"}</span>
    </span>
  );
}
