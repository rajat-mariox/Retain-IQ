"use client";

import { useState } from "react";
import { Target, Check, Pencil } from "lucide-react";
import { Card } from "@/components/ui/Card";

/**
 * Org productivity target vs the current average. Managers/admins can set or
 * clear the target; everyone else sees the progress read-only. The target is
 * stored as an org-level Goal (metric='productivity') on the backend.
 */
export function ProductivityTargetCard({ avgProductivity, initialTarget, onTargetCount, trackedEmployees, canManage }: {
  avgProductivity: number;
  initialTarget: number | null;
  onTargetCount: number | null;
  trackedEmployees: number;
  canManage: boolean;
}) {
  const [target, setTarget] = useState<number | null>(initialTarget);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(initialTarget ?? 80));
  const [busy, setBusy] = useState(false);

  async function save(next: number | null) {
    setBusy(true);
    try {
      const res = await fetch(`/api/insights/productivity-target`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: next }),
      });
      if (res.ok) { const d = await res.json(); setTarget(d.target); setEditing(false); }
    } finally { setBusy(false); }
  }

  const pct = target ? Math.min(100, Math.round((avgProductivity / target) * 100)) : 0;
  const met = target != null && avgProductivity >= target;

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700"><Target className="size-4 text-brand" /> Productivity target</span>
        {canManage && !editing ? (
          <button onClick={() => { setDraft(String(target ?? 80)); setEditing(true); }} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"><Pencil className="size-3" /> {target != null ? "Edit" : "Set"}</button>
        ) : null}
      </div>

      {editing ? (
        <div className="flex items-center gap-2">
          <input type="number" min={0} max={100} value={draft} onChange={(e) => setDraft(e.target.value)} className="w-20 rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-sm focus:border-brand focus:outline-none" />
          <span className="text-sm text-slate-500">%</span>
          <button disabled={busy} onClick={() => save(Math.max(0, Math.min(100, Number(draft) || 0)))} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:brightness-95 disabled:opacity-50">Save</button>
          {target != null ? <button disabled={busy} onClick={() => save(null)} className="text-xs text-slate-500 hover:text-rose-600">Clear</button> : null}
          <button onClick={() => setEditing(false)} className="text-xs text-slate-500 hover:text-slate-800">Cancel</button>
        </div>
      ) : target == null ? (
        <p className="text-sm text-slate-400">{canManage ? "No target set — set one to track the team against a goal." : "No productivity target set."}</p>
      ) : (
        <>
          <div className="flex items-end justify-between">
            <span className={`text-3xl font-semibold tabular-nums ${met ? "text-emerald-600" : "text-slate-800"}`}>{avgProductivity}%</span>
            <span className="pb-1 text-sm text-slate-500">target {target}%</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${met ? "bg-emerald-500" : avgProductivity >= target * 0.85 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-500">
            {met ? <><Check className="size-3.5 text-emerald-600" /> On target</> : `${target - avgProductivity}% below target`}
            {onTargetCount != null ? <span className="text-slate-400"> · {onTargetCount}/{trackedEmployees} people on target</span> : null}
          </p>
        </>
      )}
    </Card>
  );
}
