"use client";

import { useCallback, useEffect, useState } from "react";
import { Award, Plus, Trash2, Trophy, Star, Medal, Sparkles, Loader2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";

interface Achievement { id: string; title: string; description: string | null; category: string | null; awardedOn: string | null }

const CATS = ["KUDOS", "AWARD", "MILESTONE", "OTHER"];
const CAT_ICON: Record<string, typeof Award> = { KUDOS: Star, AWARD: Trophy, MILESTONE: Medal, CERTIFICATION: Sparkles, OTHER: Award };
const CAT_STYLE: Record<string, string> = {
  KUDOS: "bg-amber-500/10 text-amber-700", AWARD: "bg-violet-500/10 text-violet-700",
  MILESTONE: "bg-sky-500/10 text-sky-700", CERTIFICATION: "bg-emerald-500/10 text-emerald-700", OTHER: "bg-slate-100 text-slate-600",
};

/** Recognition tab: awards, kudos & milestones. Reuses the existing achievements
 *  store (no duplicate model); adding one congratulates the employee. */
export function EmployeeRecognitionPanel({ employeeId, canManage }: { employeeId: string; canManage: boolean }) {
  const [rows, setRows] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("KUDOS");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/performance/employees/${employeeId}/achievements`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [employeeId]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!title.trim()) return;
    setBusy(true); setError(null);
    const res = await fetch(`/api/performance/employees/${employeeId}/achievements`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title.trim(), category, description: description.trim() || undefined }) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? "That didn't work."); }
    else { setOpen(false); setTitle(""); setDescription(""); load(); }
    setBusy(false);
  }
  async function del(id: string) {
    const res = await fetch(`/api/performance/achievements/${id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm";
  return (
    <Card>
      <CardHeader
        title="Recognition"
        subtitle="Awards, kudos & milestones"
        action={canManage ? (
          <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:brightness-95"><Plus className="size-3.5" /> Recognize</button>
        ) : null}
      />
      <div className="p-4">
        {open && canManage ? (
          <div className="mb-3 space-y-2 rounded-lg border border-hairline bg-panel-2 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div><label className="mb-1 block text-xs text-slate-500">Title</label><input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Outstanding Delivery" /></div>
              <div><label className="mb-1 block text-xs text-slate-500">Type</label><select className={input} value={category} onChange={(e) => setCategory(e.target.value)}>{CATS.map((c) => <option key={c} value={c}>{c[0] + c.slice(1).toLowerCase()}</option>)}</select></div>
            </div>
            <textarea className={input} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Why (optional)" />
            {error ? <p className="text-xs text-rose-600">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={add} disabled={busy || !title.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:brightness-95 disabled:opacity-50">{busy ? <Loader2 className="size-4 animate-spin" /> : null} Recognize</button>
            </div>
          </div>
        ) : null}

        {loading ? <p className="py-4 text-center text-sm text-slate-500">Loading…</p> : rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">No recognition yet.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {rows.map((a) => {
              const cat = a.category ?? "OTHER";
              const Icon = CAT_ICON[cat] ?? Award;
              return (
                <li key={a.id} className="flex items-start gap-3 rounded-xl border border-hairline p-3">
                  <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${CAT_STYLE[cat] ?? CAT_STYLE.OTHER}`}><Icon className="size-4.5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{a.title}</p>
                    {a.description ? <p className="text-xs text-slate-500">{a.description}</p> : null}
                    <p className="mt-0.5 text-[11px] text-slate-400">{cat[0] + cat.slice(1).toLowerCase()}{a.awardedOn ? ` · ${a.awardedOn}` : ""}</p>
                  </div>
                  {canManage ? <button onClick={() => del(a.id)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600" title="Remove"><Trash2 className="size-3.5" /></button> : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
