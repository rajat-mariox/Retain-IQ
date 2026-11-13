"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Loader2, X } from "lucide-react";
import type { OrgBilling } from "@/lib/api";

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/**
 * Amber banner shown while a seat/plan change the org submitted is awaiting platform
 * approval. Nothing has changed yet — it explains the pending state and lets the org
 * withdraw the request. Clears once the platform approves/rejects (page re-fetches).
 */
export function PendingChangeNotice({ request }: { request: NonNullable<OrgBilling["pendingChangeRequest"]> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seatsChanged = request.fromSeats !== request.toSeats;
  const delta = request.estimatedDeltaPrice;

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/billing/change-request/${request.id}/cancel`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not cancel the request.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="status" className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
      <Clock className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Change pending platform approval</p>
        <p className="mt-0.5 text-amber-700">
          {seatsChanged ? `Seats ${request.fromSeats} → ${request.toSeats}` : "Plan change"} requested
          {` · new cost ${usd(request.estimatedTotalPrice)}/mo`}
          {delta !== 0 ? ` (${delta > 0 ? "+" : "−"}${usd(Math.abs(delta))}/mo)` : ""}. It applies once a platform admin approves it.
        </p>
        {error ? <p className="mt-1 text-rose-700">{error}</p> : null}
      </div>
      <button
        type="button"
        onClick={cancel}
        disabled={busy}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-amber-500/40 px-2.5 py-1 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-500/10 disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />} Cancel request
      </button>
    </div>
  );
}
