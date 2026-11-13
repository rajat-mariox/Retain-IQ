"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldAlert, AlertTriangle } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";

interface GroupRow { id: string; name: string; observations: number; escalations: number; overdue: number }
interface Rollup { departments: GroupRow[]; teams: GroupRow[] }

/**
 * Compact "open cases by department / team" rollup — surfaced on the department
 * and team management pages. Read-only; links through to the Observations page.
 * Renders nothing if the caller can't see cases or there's nothing open.
 */
export function EscalationRollup({ mode }: { mode: "department" | "team" }) {
  const [data, setData] = useState<Rollup | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/escalations/rollup`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Rollup | null) => { if (alive) setData(d); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const rows = (mode === "department" ? data?.departments : data?.teams) ?? [];
  if (rows.length === 0) return null; // nothing open (or no reach) -> stay quiet

  const label = mode === "department" ? "department" : "team";
  return (
    <Card>
      <CardHeader
        title={`Open cases by ${label}`}
        subtitle="Unresolved observations & escalations across the workflow"
        action={<Link href="/observations" className="text-xs font-medium text-brand hover:underline">Open Observations →</Link>}
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-hairline text-xs text-slate-500">
              <th className="px-5 py-3 text-left font-medium">{mode === "department" ? "Department" : "Team"}</th>
              <th className="px-5 py-3 text-right font-medium">Observations</th>
              <th className="px-5 py-3 text-right font-medium">Escalations</th>
              <th className="px-5 py-3 text-right font-medium">Overdue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                <td className="px-5 py-3 font-medium text-slate-900">{r.name}</td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-600">{r.observations || "—"}</td>
                <td className="px-5 py-3 text-right">
                  {r.escalations ? <span className="inline-flex items-center gap-1 tabular-nums text-orange-700"><ShieldAlert className="size-3.5" />{r.escalations}</span> : <span className="text-slate-400">—</span>}
                </td>
                <td className="px-5 py-3 text-right">
                  {r.overdue ? <span className="inline-flex items-center gap-1 font-medium tabular-nums text-rose-600"><AlertTriangle className="size-3.5" />{r.overdue}</span> : <span className="text-slate-400">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
