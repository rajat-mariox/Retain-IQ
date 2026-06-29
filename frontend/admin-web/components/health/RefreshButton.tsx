"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/** Re-runs the server render of the Platform Health page (fresh probes + analytics). */
export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      onClick={() => start(() => router.refresh())}
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-panel/70 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
    >
      <RefreshCw className={`size-4 text-slate-500 ${pending ? "animate-spin" : ""}`} />
      {pending ? "Refreshing…" : "Refresh"}
    </button>
  );
}
