import type { OrgStatus } from "@/lib/data/types";
import { cn } from "@/lib/cn";

/** Name + accent for one plan, as served by the billing-service plan API. */
export interface PlanMeta {
  name: string;
  color: string;
}
/** id → meta, built by the page from live plans and passed down. */
export type PlanLookup = Record<string, PlanMeta>;

const FALLBACK_COLOR = "#64748b";

const STATUS_STYLES: Record<OrgStatus, string> = {
  active: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20",
  trialing: "bg-sky-500/10 text-sky-700 ring-sky-600/20",
  suspended: "bg-amber-500/10 text-amber-700 ring-amber-600/20",
  churned: "bg-rose-500/10 text-rose-700 ring-rose-600/20",
};

const STATUS_LABEL: Record<OrgStatus, string> = {
  active: "Active",
  trialing: "Trialing",
  suspended: "Suspended",
  churned: "Churned",
};

export function StatusBadge({ status }: { status: OrgStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        STATUS_STYLES[status],
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * Plan chip. Metadata comes from the live plan API via `plans` — plans are DB
 * rows an admin can rename or recolour, so this must never hardcode them. An
 * unknown id still renders (with its raw id) rather than crashing the table.
 */
export function PlanBadge({ plan, plans }: { plan: string; plans?: PlanLookup }) {
  const meta = plans?.[plan];
  const color = meta?.color || FALLBACK_COLOR;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset"
      style={{ color, backgroundColor: `${color}1a`, borderColor: `${color}40` }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      {meta?.name ?? plan}
    </span>
  );
}
