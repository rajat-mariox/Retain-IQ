"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogIn, LogOut } from "lucide-react";

export function CheckInOut({ checkedIn, checkedOut }: { checkedIn: boolean; checkedOut: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(kind: "check-in" | "check-out") {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/attendance/${kind}`, { method: "POST" });
      if (!res.ok) {
        setError(kind === "check-in" ? "Check-in failed." : "Check-out failed.");
      }
    } finally {
      router.refresh();
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => act("check-in")}
          disabled={checkedIn || busy !== null}
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === "check-in" ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
          {checkedIn ? "Checked in" : "Check in"}
        </button>
        <button
          type="button"
          onClick={() => act("check-out")}
          disabled={!checkedIn || checkedOut || busy !== null}
          className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-panel px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === "check-out" ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
          {checkedOut ? "Checked out" : "Check out"}
        </button>
      </div>
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
