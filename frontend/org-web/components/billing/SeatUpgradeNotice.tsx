"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Info, X } from "lucide-react";

/**
 * Info banner shown when someone lands on Billing after hitting the seat cap
 * while adding an employee (redirected here with `?upgrade=seats`). It reads
 * like a toast — a soft info note, dismissible — and it tidies the query string
 * off the URL on mount so a refresh or back-nav doesn't resurface it.
 *
 * `reason` carries the exact server message ("Seat limit reached: 5/5 …") so the
 * person sees the real numbers, not a generic line.
 */
export function SeatUpgradeNotice({ reason }: { reason?: string }) {
  const router = useRouter();
  const [show, setShow] = useState(true);

  // Drop the upgrade params from the address bar without a reload, so the banner
  // is a one-time nudge tied to the action that caused it — not a sticky state.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("upgrade")) {
      url.searchParams.delete("upgrade");
      url.searchParams.delete("reason");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
  }, []);

  if (!show) return null;

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900"
    >
      <Info className="mt-0.5 size-4 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Your plan is out of seats</p>
        <p className="mt-0.5 text-amber-800">
          {reason || "All seats on your current plan are in use."} Upgrade the plan or add seats below to bring on more people.
        </p>
      </div>
      <button
        type="button"
        onClick={() => setShow(false)}
        aria-label="Dismiss"
        className="shrink-0 rounded-lg p-1 text-amber-700 transition-colors hover:bg-amber-500/15 hover:text-amber-900"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
