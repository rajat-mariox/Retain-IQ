"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, Loader2, Minus, Plus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import type { OrgBilling } from "@/lib/api";
import { computePrice } from "@/lib/pricing";

type Plan = OrgBilling["plans"][number];
type Sub = NonNullable<OrgBilling["subscription"]>;

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** A plan's headline monthly cost at its included-seat count (what "from $X" shows). */
function fromPrice(p: Plan): number {
  return computePrice(p, Math.max(p.includedSeats, p.minSeats)).totalPrice;
}

/**
 * The plan catalog with a working self-serve upgrade. Each non-current plan can be
 * selected; a modal confirms the new plan + seat count and shows the projected
 * monthly cost before committing. Seats can't be dropped below the current
 * headcount (billing-service enforces this too). On success the page refreshes so
 * the current-plan card and seat bar reflect the change.
 */
export function PlanCatalog({ plans, sub, highlight }: { plans: Plan[]; sub: Sub; highlight?: boolean }) {
  const router = useRouter();
  const [target, setTarget] = useState<Plan | null>(null);
  const [seats, setSeats] = useState(sub.seats);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seat floor: never below who's already on the team, nor below the plan minimum.
  // Ceiling: the plan's max (maxSeats supersedes legacy seatLimit; null = unlimited).
  const minSeats = Math.max(sub.activeSeats, target?.minSeats ?? 1);
  const seatCap = target ? (target.maxSeats ?? target.seatLimit) : null;
  const clampedSeats = Math.max(minSeats, seatCap ? Math.min(seats, seatCap) : seats);
  const targetIsCurrent = target?.id === sub.planId;
  // Full itemised breakdown (base + extra seats) at the chosen quantity.
  const breakdown = target ? computePrice(target, clampedSeats) : null;
  const projectedTotal = breakdown?.totalPrice ?? 0;
  const canStep = target?.allowCustomSeats ?? false;
  // On the current plan the only change is seats — block confirm if nothing moved.
  const noChange = targetIsCurrent && clampedSeats === sub.seats;

  function openFor(plan: Plan) {
    setTarget(plan);
    const floor = Math.max(sub.activeSeats, plan.minSeats);
    const cap = plan.maxSeats ?? plan.seatLimit;
    // Start from current seats; when adding seats to the current plan, nudge up one
    // so there's a change to make. Custom seats off → snap to the included count.
    const start = !plan.allowCustomSeats ? Math.max(plan.includedSeats, plan.minSeats) : plan.id === sub.planId ? sub.seats + 1 : sub.seats;
    setSeats(Math.max(floor, cap ? Math.min(start, cap) : start));
    setError(null);
  }

  const stepSeat = (delta: number) => {
    const cap = seatCap;
    setSeats((s) => {
      const next = Math.max(minSeats, s + delta);
      return cap ? Math.min(next, cap) : next;
    });
  };

  async function confirm() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/subscription", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: target.id, seats: clampedSeats }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not update your plan.");
        return;
      }
      setTarget(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ul className="space-y-2.5">
        {plans.map((p) => {
          const current = p.id === sub.planId;
          // Room to grow on THIS plan: custom seats allowed and licensed seats still
          // below the cap (unlimited when maxSeats/seatLimit is null).
          const planCap = p.maxSeats ?? p.seatLimit;
          const canAddSeats = current && p.allowCustomSeats && (planCap == null || sub.seats < planCap);
          return (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-hairline px-3 py-2.5"
              style={current && highlight ? { borderColor: `${p.color}66`, backgroundColor: `${p.color}0f` } : undefined}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                <span className="truncate text-sm font-medium text-slate-800">{p.name}</span>
                {current ? <Check className="size-4 shrink-0 text-brand" /> : null}
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-slate-500">
                  {fromPrice(p) === 0 && p.additionalSeatPrice === 0 ? "Free" : p.basePrice > 0 ? `from ${usd(fromPrice(p))}/mo` : `${usd(p.additionalSeatPrice)}/seat`}
                </span>
                {current ? (
                  canAddSeats ? (
                    <button
                      type="button"
                      onClick={() => openFor(p)}
                      className="inline-flex items-center gap-1 rounded-lg border border-brand/40 bg-brand/10 px-2.5 py-1 text-xs font-semibold text-brand transition-colors hover:bg-brand/15"
                    >
                      <Plus className="size-3" /> Add seats
                    </button>
                  ) : (
                    <span className="text-xs font-medium text-slate-400">Current</span>
                  )
                ) : (
                  <button
                    type="button"
                    onClick={() => openFor(p)}
                    className="inline-flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-brand-soft"
                  >
                    {p.pricePerSeat > sub.pricePerSeat ? "Upgrade" : "Switch"}
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <Modal
        open={target !== null}
        onClose={() => (busy ? undefined : setTarget(null))}
        title={target ? (targetIsCurrent ? `Add seats to ${target.name}` : `Switch to ${target.name}`) : ""}
        size="sm"
      >
        {target ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-hairline bg-panel-2/40 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Plan</span>
                <span className="inline-flex items-center gap-1.5 font-medium text-slate-900">
                  {targetIsCurrent ? (
                    target.name
                  ) : (
                    <>
                      {sub.planName} <ArrowUpRight className="size-3.5 text-slate-400" /> {target.name}
                    </>
                  )}
                </span>
              </div>
              {target.basePrice > 0 ? (
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-slate-500">Base price</span>
                  <span className="tabular-nums text-slate-700">{usd(target.basePrice)} / mo{target.includedSeats > 0 ? ` · ${target.includedSeats} seats included` : ""}</span>
                </div>
              ) : null}
              {breakdown && breakdown.additionalSeatPrice > 0 ? (
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-slate-500">Additional seat</span>
                  <span className="tabular-nums text-slate-700">{usd(breakdown.additionalSeatPrice)} / seat / mo</span>
                </div>
              ) : null}
            </div>

            <div>
              <label htmlFor="seats" className="mb-1 block text-xs font-medium text-slate-600">Seats</label>
              <div className="flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={() => stepSeat(-1)}
                  disabled={!canStep || clampedSeats <= minSeats}
                  aria-label="Fewer seats"
                  className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-hairline text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-40"
                >
                  <Minus className="size-4" />
                </button>
                <input
                  id="seats"
                  type="number"
                  min={minSeats}
                  max={seatCap ?? undefined}
                  readOnly={!canStep}
                  value={clampedSeats}
                  onChange={(e) => setSeats(Number(e.target.value) || minSeats)}
                  className="w-full rounded-xl border border-hairline bg-panel-2/60 px-3 py-2 text-center text-sm tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand/30 read-only:opacity-70"
                />
                <button
                  type="button"
                  onClick={() => stepSeat(1)}
                  disabled={!canStep || (seatCap != null && clampedSeats >= seatCap)}
                  aria-label="More seats"
                  className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-hairline text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-40"
                >
                  <Plus className="size-4" />
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {sub.seats} licensed · {sub.activeSeats} in use
                {!canStep ? ` · ${target.name} has a fixed ${target.includedSeats || target.minSeats} seats` : seatCap ? ` · up to ${seatCap}` : " · unlimited"}.
              </p>
            </div>

            {breakdown && breakdown.additionalSeats > 0 ? (
              <div className="rounded-xl bg-panel-2/40 p-3 text-sm">
                <div className="flex items-center justify-between text-slate-600">
                  <span>Base</span><span className="tabular-nums">{usd(breakdown.basePrice)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-slate-600">
                  <span>{breakdown.additionalSeats} × extra seat</span><span className="tabular-nums">{usd(breakdown.additionalSeatTotal)}</span>
                </div>
              </div>
            ) : null}

            <div className="flex items-center justify-between border-t border-hairline pt-3 text-sm">
              <span className="text-slate-500">New monthly cost</span>
              <span className="text-base font-semibold tabular-nums text-slate-900">{usd(projectedTotal)}<span className="text-xs font-normal text-slate-400"> / mo</span></span>
            </div>
            <p className="text-xs text-slate-400">The new rate applies from your next billing period. Seats are available immediately.</p>

            {error ? <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

            <div className="flex items-center justify-end gap-2 border-t border-hairline pt-4">
              <button type="button" onClick={() => setTarget(null)} disabled={busy} className="rounded-xl px-3.5 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-60">Cancel</button>
              <button
                type="button"
                onClick={confirm}
                disabled={busy || noChange}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-soft disabled:opacity-60"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                {targetIsCurrent ? "Add seats" : "Confirm change"}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
