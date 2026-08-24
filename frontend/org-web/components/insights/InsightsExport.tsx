"use client";

import { Download } from "lucide-react";
import { downloadCsv, downloadXlsx } from "@/lib/export";

interface Person { name: string; productivity: number; focus: number; activeHours: number; trackedDays: number; risk: string }

/**
 * Export the workforce productivity table (already loaded on the page) to CSV or
 * Excel — client-side, no round-trip. Keeps the Insights dashboard a dashboard
 * while still letting managers take the numbers away.
 */
export function InsightsExport({ people }: { people: Person[] }) {
  const rows = people.map((p) => ({
    Employee: p.name,
    "Productivity %": p.productivity,
    "Focus %": p.focus,
    "Active hours": p.activeHours,
    "Tracked days": p.trackedDays,
    Risk: p.risk.replace(/_/g, " "),
  }));
  if (rows.length === 0) return null;
  return (
    <div className="flex gap-2">
      <button onClick={() => downloadCsv("workforce-productivity", rows)} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"><Download className="size-3.5" /> CSV</button>
      <button onClick={() => downloadXlsx("workforce-productivity", "Productivity", rows)} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"><Download className="size-3.5" /> Excel</button>
    </div>
  );
}
