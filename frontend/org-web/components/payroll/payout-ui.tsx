import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// The payout API returns money as plain decimal numbers (not cents) alongside a
// 3-letter ISO currency code. Format with the viewer's locale; fall back to a
// prefixed amount for exotic codes Intl doesn't know.
export function money(amount: number | null | undefined, currency = "USD"): string {
  const value = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

export function fmtNum(n: number | null | undefined): string {
  return (typeof n === "number" && Number.isFinite(n) ? n : 0).toLocaleString("en-US");
}

/** Turn an UPPER_SNAKE status into "Title case" words. */
export function humanizeStatus(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Semantic status colouring shared by batches, records and payments. A single
// accent isn't enough here because these statuses carry meaning (blocked vs done
// vs needs-attention), so we reserve the standard status hues.
const SUCCESS = new Set(["APPROVED", "PAID", "CLOSED", "VALIDATED", "RESOLVED", "INCLUDED_IN_PAYROLL", "SETTLED", "COMPLETED", "ACTIVE"]);
const WARN = new Set([
  "PENDING_APPROVAL", "ON_HOLD", "PENDING", "MANAGER_APPROVAL", "REVIEW", "UNDER_REVIEW",
  "EMPLOYEE_INPUT_REQUIRED", "OPEN", "INPUT_CUTOFF", "PROCESSING", "PAYMENT_PROCESSING", "RETRYING",
]);
const INFO = new Set(["VALIDATION", "CALCULATION", "INPUT_COLLECTION", "CALCULATED", "SUBMITTED", "DRAFT"]);
const DANGER = new Set(["REJECTED", "VALIDATION_FAILED", "FAILED", "CANCELLED", "RECOVERY"]);

export function statusPill(status: string): string {
  const base = "inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset";
  if (SUCCESS.has(status)) return cn(base, "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20");
  if (DANGER.has(status)) return cn(base, "bg-rose-500/10 text-rose-700 ring-rose-600/20");
  if (WARN.has(status)) return cn(base, "bg-amber-500/10 text-amber-700 ring-amber-600/20");
  if (INFO.has(status)) return cn(base, "bg-sky-500/10 text-sky-700 ring-sky-600/20");
  return cn(base, "bg-slate-500/10 text-slate-600 ring-slate-500/20");
}

export function PayoutStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-slate-400">—</span>;
  return <span className={statusPill(status)}>{humanizeStatus(status)}</span>;
}

/** A short, monospace employee reference used when a display name can't be resolved. */
export function EmployeeRef({ id }: { id: string }) {
  return <span className="font-mono text-xs text-slate-500" title={id}>EMP·{id.slice(0, 6)}</span>;
}

/** Consistent empty state for a panel or a section with no data yet. */
export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon ? <div className="mb-1 grid size-11 place-items-center rounded-2xl bg-panel-2 text-slate-400 ring-1 ring-inset ring-hairline">{icon}</div> : null}
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-slate-500">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** A labelled distribution row (status → count) rendered as a proportional bar. */
export function DistributionBar({ entries }: { entries: { label: string; count: number }[] }) {
  const total = entries.reduce((s, e) => s + e.count, 0);
  if (total === 0) return <p className="text-xs text-slate-400">No data yet.</p>;
  return (
    <div className="space-y-2.5">
      <span className="flex h-2 overflow-hidden rounded-full bg-panel-2">
        {entries.map((e) => (
          <span key={e.label} className={cn("block h-full", segmentColor(e.label))} style={{ width: `${(e.count / total) * 100}%` }} />
        ))}
      </span>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {entries.map((e) => (
          <li key={e.label} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className={cn("size-2 rounded-full", segmentColor(e.label))} />
            <span>{humanizeStatus(e.label)}</span>
            <span className="tabular-nums font-medium text-slate-800">{e.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function segmentColor(status: string): string {
  if (SUCCESS.has(status)) return "bg-emerald-500";
  if (DANGER.has(status)) return "bg-rose-500";
  if (WARN.has(status)) return "bg-amber-500";
  if (INFO.has(status)) return "bg-sky-500";
  return "bg-slate-400";
}

/** Shared button styles so every panel's actions read the same. */
export const btn = {
  primary:
    "inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-soft disabled:opacity-60",
  ghost:
    "inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60",
  danger:
    "inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-60",
};

export const field = {
  input: "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none",
  label: "mb-1.5 block text-sm font-medium text-slate-700",
};
