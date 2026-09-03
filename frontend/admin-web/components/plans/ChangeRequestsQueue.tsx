"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Clock, Loader2, X } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import type { ApiChangeRequest } from "@/lib/admin-api";

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * Platform approval queue for org seat/plan change requests. Each pending request
 * shows the org, the from→to plan/seat move and the estimated new cost; Approve
 * applies the change in billing-service (re-locking the rate), Reject declines it.
 */
export function ChangeRequestsQueue({ requests }: { requests: ApiChangeRequest[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  function decide(id: string, action: "approve" | "reject") {
    setError(null);
    setBusyId(id);
    start(async () => {
      try {
        const res = await fetch(`/api/admin/change-requests/${id}/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          setError(d.error ?? "Could not update the request.");
          return;
        }
        router.refresh();
      } finally {
        setBusyId(null);
      }
    });
  }

  return (
    <Card>
      <CardHeader title="Change requests" subtitle="Org seat/plan changes awaiting your approval" />
      <CardBody className="space-y-3">
        {error ? <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        {requests.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No pending change requests. All caught up.</p>
        ) : (
          <ul className="space-y-2.5">
            {requests.map((r) => {
              const seatsChanged = r.fromSeats !== r.toSeats;
              const planChanged = r.fromPlanId !== r.toPlanId;
              const busy = busyId === r.id;
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline px-3.5 py-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                      {r.orgName ?? r.orgId.slice(0, 8)}
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700"><Clock className="size-3" /> pending</span>
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      {planChanged ? <span>{r.fromPlanName} <ArrowRight className="inline size-3" /> {r.toPlanName}</span> : <span>{r.toPlanName}</span>}
                      {seatsChanged ? <span>· {r.fromSeats} <ArrowRight className="inline size-3" /> {r.toSeats} seats</span> : null}
                      <span>· {usd(r.estimatedTotalPrice)}/mo</span>
                      {r.estimatedDeltaPrice !== 0 ? (
                        <span className={r.estimatedDeltaPrice > 0 ? "text-emerald-600" : "text-slate-500"}>
                          ({r.estimatedDeltaPrice > 0 ? "+" : "−"}{usd(Math.abs(r.estimatedDeltaPrice))}/mo)
                        </span>
                      ) : null}
                      {r.requestedByEmail ? <span className="text-slate-400">· by {r.requestedByEmail}</span> : null}
                      <span className="text-slate-400">· {when(r.createdAt)}</span>
                    </p>
                    {r.note ? <p className="mt-1 text-xs italic text-slate-400">“{r.note}”</p> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => decide(r.id, "approve")}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-soft disabled:opacity-60"
                    >
                      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => decide(r.id, "reject")}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-500/10 disabled:opacity-60"
                    >
                      <X className="size-3.5" /> Reject
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
