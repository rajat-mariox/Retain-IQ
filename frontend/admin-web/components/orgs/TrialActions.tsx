"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, Loader2, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";

/**
 * Super-admin trial controls, shown only for a TRIALING subscription: convert to
 * paid, extend by N days, or cancel the trial. Each posts to the trial BFF, which
 * proxies to billing-service (the authority on the transition). On success the
 * page refreshes so status/trial dates update.
 */
export function TrialActions({ orgId, trialEndsAt }: { orgId: string; trialEndsAt: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState<null | "extend">(null);
  const [days, setDays] = useState("7");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function act(action: "convert" | "extend" | "cancel", body?: unknown) {
    setError(null);
    start(async () => {
      const res = await fetch(`/api/admin/subscriptions/${orgId}/trial/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "Could not update the trial.");
        return;
      }
      setOpen(null);
      router.refresh();
    });
  }

  const trialEnds = trialEndsAt ? new Date(trialEndsAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {trialEnds ? <span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><Clock className="size-3.5" /> ends {trialEnds}</span> : null}
      <button
        type="button"
        onClick={() => act("convert")}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-soft disabled:opacity-60"
      >
        <Check className="size-3.5" /> Convert to paid
      </button>
      <button
        type="button"
        onClick={() => { setOpen("extend"); setError(null); }}
        disabled={pending}
        className="rounded-lg border border-hairline px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-panel-2 disabled:opacity-60"
      >
        Extend…
      </button>
      <button
        type="button"
        onClick={() => act("cancel")}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-500/10 disabled:opacity-60"
      >
        <X className="size-3.5" /> Cancel trial
      </button>
      {error && open === null ? <span className="text-xs text-rose-600">{error}</span> : null}

      <Modal open={open === "extend"} onClose={() => setOpen(null)} title="Extend trial" size="sm">
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Extend by (days)</span>
            <input
              type="number"
              min="1"
              max="365"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="w-full rounded-xl border border-hairline bg-panel-2/60 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </label>
          {error ? <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(null)} className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900">Cancel</button>
            <button
              type="button"
              onClick={() => act("extend", { days: Math.max(1, Number(days) || 0) })}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-soft disabled:opacity-60"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Clock className="size-4" />} Extend trial
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
