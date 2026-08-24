"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Modal } from "@/components/ui/Modal";

interface PlanOption {
  id: string;
  name: string;
  pricePerSeat: number; // USD cents (legacy flat)
  basePrice: number;
  includedSeats: number;
  additionalSeatPrice: number;
}

interface Props {
  orgId: string;
  current: { planId: string | null; seats: number; autoRenew: boolean };
  plans: PlanOption[];
}

const usd = (cents: number) => (cents === 0 ? "Free" : `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}/seat`);

/** Seat-based total (cents): base + max(0, seats − included) × additional. Falls
 *  back to flat per-seat when the base/included model is unset. */
function planTotalCents(p: PlanOption, seats: number): number {
  const flat = p.basePrice === 0 && p.includedSeats === 0 && p.additionalSeatPrice === 0;
  const addl = flat ? p.pricePerSeat : p.additionalSeatPrice;
  const base = flat ? 0 : p.basePrice;
  return base + Math.max(0, seats - (flat ? 0 : p.includedSeats)) * addl;
}

export function EditSubscriptionButton({ orgId, current, plans }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState(current.planId ?? plans[0]?.id ?? "");
  const [seats, setSeats] = useState(String(current.seats || 1));
  const [autoRenew, setAutoRenew] = useState(current.autoRenew);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const selectedPlan = plans.find((p) => p.id === planId);
  const seatNum = Math.max(1, Number(seats) || 0);
  const projectedMrr = selectedPlan ? planTotalCents(selectedPlan, seatNum) / 100 : 0;
  const dirty = planId !== current.planId || seatNum !== current.seats || autoRenew !== current.autoRenew;

  function reset() {
    setPlanId(current.planId ?? plans[0]?.id ?? "");
    setSeats(String(current.seats || 1));
    setAutoRenew(current.autoRenew);
    setError(null);
  }

  function submit() {
    setError(null);
    start(async () => {
      const res = await fetch(`/api/admin/subscriptions/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, seats: seatNum, autoRenew }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not update subscription.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel/70 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
      >
        <Pencil className="size-3.5 text-slate-500" />
        Edit
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Edit subscription">
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Plan</label>
            <select
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none"
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {usd(p.pricePerSeat)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Seats</label>
            <input
              type="number"
              min={1}
              value={seats}
              onChange={(e) => setSeats(e.target.value)}
              className="w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none"
            />
          </div>

          <label className="flex items-center justify-between gap-3 rounded-lg border border-hairline bg-panel/60 px-3 py-2.5">
            <span className="text-sm font-medium text-slate-700">Auto-renew</span>
            <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} className="size-4 accent-brand" />
          </label>

          <div className="rounded-lg bg-panel-2/60 px-3 py-2.5 text-xs text-slate-500">
            New MRR: <span className="font-semibold text-slate-700">${projectedMrr.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
            <span className="ml-1">· takes effect at the next renewal (no mid-cycle proration).</span>
          </div>

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending || !dirty || !planId}
              className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-strong disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
