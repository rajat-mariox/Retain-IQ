import { Clock, AlertTriangle, XCircle } from "lucide-react";
import type { OrgBilling } from "@/lib/api";

type Sub = NonNullable<OrgBilling["subscription"]>;

/** Human date, e.g. "August 12, 2026". */
function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/**
 * Trial / lifecycle banner for the org's own billing page. Surfaces the states
 * the plan card's status badge can't fully convey: how long a trial has left,
 * that a trial has expired (and to pick a plan), or a payment problem. Renders
 * nothing for a plain active/free subscription.
 */
export function TrialStatus({ sub }: { sub: Sub }) {
  if (sub.status === "TRIALING") {
    const days = sub.trialDaysRemaining ?? 0;
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-brand/25 bg-brand/5 px-4 py-3 text-sm">
        <Clock className="mt-0.5 size-4 shrink-0 text-brand" />
        <div>
          <p className="font-medium text-slate-900">{sub.planName} trial · {days} day{days === 1 ? "" : "s"} left</p>
          <p className="mt-0.5 text-slate-600">
            You have full {sub.planName} access. Your trial ends on {fmtDate(sub.trialEndsAt)} — pick a plan below to keep going.
          </p>
        </div>
      </div>
    );
  }

  if (sub.status === "EXPIRED") {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
        <XCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <div>
          <p className="font-medium text-slate-900">Your trial has expired</p>
          <p className="mt-0.5 text-amber-800">Choose a plan below to continue using {sub.planName} features.</p>
        </div>
      </div>
    );
  }

  if (sub.status === "PAST_DUE") {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-600" />
        <div>
          <p className="font-medium text-slate-900">Payment issue</p>
          <p className="mt-0.5 text-rose-700">A recent charge didn't go through. Update your billing to avoid losing access.</p>
        </div>
      </div>
    );
  }

  return null;
}
