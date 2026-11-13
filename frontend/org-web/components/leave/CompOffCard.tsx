"use client";

import { useCallback, useEffect, useState } from "react";
import { Gift, Plus, Minus, Clock } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { LocalTime } from "@/components/ui/LocalTime";

interface LedgerEntry { id: string; deltaDays: number; source: string; note: string | null; expiresAt: string | null; createdAt: string }
interface CompOffBalance { employeeId: string | null; balance: number; ledger: LedgerEntry[] }

const SOURCE_LABEL: Record<string, string> = {
  OVERTIME: "Overtime → comp-off",
  HOLIDAY_WORK: "Holiday work",
  MANUAL_GRANT: "Manual grant",
  LEAVE_SPENT: "Comp-off leave taken",
  LEAVE_REVERSED: "Leave cancelled",
};

/**
 * Comp-off (compensatory off) balance + ledger for the signed-in employee. In a
 * "give comp-off" org, approved overtime is converted to a comp-off balance when
 * payroll is locked; those days are then spendable as COMP_OFF leave. Managers
 * additionally get a manual grant control for the people they approve.
 */
export function CompOffCard({ canGrant, employees }: { canGrant: boolean; employees?: { id: string; name: string }[] }) {
  const [data, setData] = useState<CompOffBalance | null>(null);
  const [open, setOpen] = useState(false);
  const [empId, setEmpId] = useState("");
  const [days, setDays] = useState("1");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/leave/comp-off/balance`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => undefined);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function grant() {
    if (!empId || !Number(days)) return;
    setBusy(true); setError(null);
    const res = await fetch(`/api/leave/comp-off/grant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId: empId, days: Number(days), note: note.trim() || undefined }),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setError(d.error ?? "Could not grant comp-off.");
    } else {
      setOpen(false); setEmpId(""); setDays("1"); setNote("");
      load();
    }
    setBusy(false);
  }

  const balance = data?.balance ?? 0;
  const ledger = data?.ledger ?? [];

  return (
    <Card>
      <CardHeader
        title="Comp-off balance"
        subtitle="Time-off earned from approved overtime & manual grants"
        action={
          canGrant ? (
            <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Gift className="size-4" /> Grant comp-off
            </button>
          ) : null
        }
      />
      <div className="p-4">
        <div className="mb-3 flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums text-slate-900">{balance}</span>
          <span className="text-sm text-slate-500">day{balance === 1 ? "" : "s"} available</span>
        </div>

        {open && canGrant ? (
          <div className="mb-3 space-y-2 rounded-lg border border-hairline bg-panel-2 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <select value={empId} onChange={(e) => setEmpId(e.target.value)} className="rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-sm">
                <option value="">Select employee…</option>
                {(employees ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <div className="flex items-center gap-2">
                <input type="number" step={0.5} value={days} onChange={(e) => setDays(e.target.value)} className="w-24 rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-sm" />
                <span className="text-xs text-slate-400">days (negative to debit)</span>
              </div>
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="w-full rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-sm" />
            {error ? <p className="text-xs text-rose-600">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={grant} disabled={busy || !empId || !Number(days)} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:brightness-95 disabled:opacity-50">{busy ? "Saving…" : "Grant"}</button>
            </div>
          </div>
        ) : null}

        {ledger.length === 0 ? (
          <p className="py-2 text-sm text-slate-500">No comp-off activity yet.</p>
        ) : (
          <ul className="divide-y divide-hairline/60">
            {ledger.map((l) => (
              <li key={l.id} className="flex items-center gap-3 py-2 text-sm">
                <span className={`inline-flex size-6 items-center justify-center rounded-full ${l.deltaDays >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>
                  {l.deltaDays >= 0 ? <Plus className="size-3.5" /> : <Minus className="size-3.5" />}
                </span>
                <span className={`w-14 tabular-nums font-medium ${l.deltaDays >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{l.deltaDays >= 0 ? "+" : ""}{l.deltaDays}d</span>
                <span className="text-slate-700">{SOURCE_LABEL[l.source] ?? l.source}</span>
                {l.note ? <span className="truncate text-xs text-slate-400">· {l.note}</span> : null}
                <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-400"><Clock className="size-3" /><LocalTime iso={l.createdAt} /></span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
