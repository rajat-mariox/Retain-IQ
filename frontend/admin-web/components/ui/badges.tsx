import { PLANS } from "@/lib/data/seed";
import type { OrgStatus, PlanId } from "@/lib/data/types";
import { cn } from "@/lib/cn";

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

export function PlanBadge({ plan }: { plan: PlanId }) {
  const meta = PLANS[plan];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset"
      style={{ color: meta.color, backgroundColor: `${meta.color}1a`, borderColor: `${meta.color}40` }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
      {meta.name}
    </span>
  );
}
