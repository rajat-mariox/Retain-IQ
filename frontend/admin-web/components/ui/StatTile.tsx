import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";

interface StatTileProps {
  label: string;
  value: string;
  icon: LucideIcon;
  /** Signed percentage; renders an up/down chip when provided. */
  deltaPct?: number;
  hint?: string;
  accent?: string;
}

// Brand-green accents follow the configured primary colour (var(--color-brand));
// semantic colours (rose/amber/blue/teal…) stay fixed so they keep their meaning.
const BRAND_GREENS = new Set(["#1f883d", "#2da44e", "#16a34a", "#166534", "#15803d"]);

export function StatTile({ label, value, icon: Icon, deltaPct, hint, accent }: StatTileProps) {
  const up = (deltaPct ?? 0) >= 0;
  const useBrand = !accent || BRAND_GREENS.has(accent.toLowerCase());
  const iconStyle = useBrand
    ? {
        backgroundColor: "color-mix(in srgb, var(--color-brand) 12%, transparent)",
        color: "var(--color-brand)",
        borderColor: "color-mix(in srgb, var(--color-brand) 22%, transparent)",
      }
    : { backgroundColor: `${accent}1f`, color: accent, borderColor: `${accent}33` };
  return (
    <div className="rounded-2xl border border-hairline bg-panel/70 p-5 backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="grid size-9 place-items-center rounded-xl ring-1 ring-inset" style={iconStyle}>
          <Icon className="size-4.5" strokeWidth={2} />
        </span>
        {deltaPct !== undefined ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium",
              up ? "bg-emerald-500/10 text-emerald-700" : "bg-rose-500/10 text-rose-700",
            )}
          >
            {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {formatPercent(deltaPct)}
          </span>
        ) : null}
      </div>
      <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-xs font-medium text-slate-600">{label}</p>
      {hint ? <p className="mt-0.5 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}
