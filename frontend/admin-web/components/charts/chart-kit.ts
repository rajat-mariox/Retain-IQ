// Shared Recharts styling tokens so every chart matches the light panels.

export const AXIS_TICK = { fill: "#64748b", fontSize: 11 } as const;
export const GRID_STROKE = "#e6eaf2";

export const TOOLTIP_PROPS = {
  cursor: { stroke: "#cbd5e1", strokeWidth: 1 },
  contentStyle: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    fontSize: 12,
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.12)",
  },
  labelStyle: { color: "#475569", marginBottom: 4 },
  itemStyle: { color: "#0f172a" },
} as const;

export function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
