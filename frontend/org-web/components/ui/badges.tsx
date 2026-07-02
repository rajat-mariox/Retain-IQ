import { cn } from "@/lib/cn";

const ATTENDANCE: Record<string, string> = {
  PRESENT: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20",
  LATE: "bg-amber-500/10 text-amber-700 ring-amber-600/20",
  ABSENT: "bg-rose-500/10 text-rose-700 ring-rose-600/20",
  ON_LEAVE: "bg-sky-500/10 text-sky-700 ring-sky-600/20",
  WEEKLY_OFF: "bg-slate-500/10 text-slate-500 ring-slate-500/20",
};

const SUBSCRIPTION: Record<string, string> = {
  ACTIVE: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20",
  TRIALING: "bg-sky-500/10 text-sky-700 ring-sky-600/20",
  PAST_DUE: "bg-amber-500/10 text-amber-700 ring-amber-600/20",
  SUSPENDED: "bg-amber-500/10 text-amber-700 ring-amber-600/20",
  CANCELED: "bg-rose-500/10 text-rose-700 ring-rose-600/20",
};

const INVOICE: Record<string, string> = {
  PAID: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20",
  OPEN: "bg-sky-500/10 text-sky-700 ring-sky-600/20",
  VOID: "bg-slate-500/10 text-slate-600 ring-slate-500/20",
  DRAFT: "bg-slate-500/10 text-slate-600 ring-slate-500/20",
};

function pill(map: Record<string, string>, status: string) {
  return cn(
    "inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
    map[status] ?? "bg-panel-2 text-slate-600 ring-hairline",
  );
}

export function AttendanceBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-slate-400">—</span>;
  return <span className={pill(ATTENDANCE, status)}>{status.replace("_", " ").toLowerCase()}</span>;
}

export function SubscriptionBadge({ status }: { status: string }) {
  return <span className={pill(SUBSCRIPTION, status)}>{status.replace("_", " ").toLowerCase()}</span>;
}

export function InvoiceBadge({ status }: { status: string }) {
  return <span className={pill(INVOICE, status)}>{status.toLowerCase()}</span>;
}

const TASK: Record<string, string> = {
  TODO: "bg-slate-500/10 text-slate-600 ring-slate-500/20",
  IN_PROGRESS: "bg-sky-500/10 text-sky-700 ring-sky-600/20",
  IN_REVIEW: "bg-amber-500/10 text-amber-700 ring-amber-600/20",
  DONE: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20",
};
const PRIORITY: Record<string, string> = {
  LOW: "bg-slate-500/10 text-slate-600 ring-slate-500/20",
  MEDIUM: "bg-sky-500/10 text-sky-700 ring-sky-600/20",
  HIGH: "bg-amber-500/10 text-amber-700 ring-amber-600/20",
  URGENT: "bg-rose-500/10 text-rose-700 ring-rose-600/20",
};
const RISK: Record<string, string> = {
  healthy: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20",
  burnout_risk: "bg-rose-500/10 text-rose-700 ring-rose-600/20",
  low_engagement: "bg-amber-500/10 text-amber-700 ring-amber-600/20",
};

export function TaskBadge({ status }: { status: string }) {
  return <span className={pill(TASK, status)}>{status.replace("_", " ").toLowerCase()}</span>;
}
export function PriorityBadge({ priority }: { priority: string }) {
  return <span className={pill(PRIORITY, priority)}>{priority.toLowerCase()}</span>;
}
export function RiskBadge({ risk }: { risk: string }) {
  return <span className={pill(RISK, risk)}>{risk.replace("_", " ")}</span>;
}
export function ProjectStatusBadge({ status }: { status: string }) {
  return <span className={pill(SUBSCRIPTION, status === "ACTIVE" ? "ACTIVE" : status)}>{status.replace("_", " ").toLowerCase()}</span>;
}
