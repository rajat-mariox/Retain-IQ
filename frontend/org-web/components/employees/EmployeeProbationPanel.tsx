"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, CalendarClock, Check, RefreshCcw, UserX, Loader2, History } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";

interface Extension { id: string; from: string; to: string; reason: string | null }
interface Probation {
  id: string; startDate: string; endDate: string; originalEndDate: string; durationMonths: number;
  status: string; daysLeft: number | null; performanceNote: string | null; attendanceNote: string | null;
  reviewNote: string | null; recommendation: string | null; extensions: Extension[];
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-amber-500/10 text-amber-700", EXTENDED: "bg-sky-500/10 text-sky-700",
  CONFIRMED: "bg-emerald-500/10 text-emerald-700", TERMINATED: "bg-rose-500/10 text-rose-700",
};
const pretty = (s: string) => s.replace(/_/g, " ").toLowerCase();

/** Probation tab: start probation, review (confirm/extend/terminate), extension history. */
export function EmployeeProbationPanel({ employeeId, canManage }: { employeeId: string; canManage: boolean }) {
  const [rows, setRows] = useState<Probation[]>([]);
  const [loading, setLoading] = useState(true);
  const [startOpen, setStartOpen] = useState(false);
  const [reviewFor, setReviewFor] = useState<Probation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // start form
  const [months, setMonths] = useState("6");
  // review form
  const [rec, setRec] = useState<"CONFIRM" | "EXTEND" | "TERMINATE">("CONFIRM");
  const [perf, setPerf] = useState("");
  const [att, setAtt] = useState("");
  const [note, setNote] = useState("");
  const [extMonths, setExtMonths] = useState("3");

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/employees/${employeeId}/probations`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [employeeId]);
  useEffect(() => { load(); }, [load]);

  async function post(url: string, body?: unknown) {
    setBusy(true); setError(null);
    const res = await fetch(url, { method: "POST", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? "That didn't work."); }
    setBusy(false);
    return res.ok;
  }
  async function start() {
    if (await post(`/api/employees/${employeeId}/probation`, { durationMonths: Number(months) })) { setStartOpen(false); load(); }
  }
  async function review() {
    if (!reviewFor) return;
    const body: Record<string, unknown> = { recommendation: rec, performanceNote: perf.trim() || undefined, attendanceNote: att.trim() || undefined, reviewNote: note.trim() || undefined };
    if (rec === "EXTEND") body.extendMonths = Number(extMonths);
    if (await post(`/api/employees/probations/${reviewFor.id}/review`, body)) { setReviewFor(null); setPerf(""); setAtt(""); setNote(""); load(); }
  }

  const active = rows.find((r) => ["ACTIVE", "EXTENDED"].includes(r.status));
  const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm";
  const label = "mb-1 block text-xs font-medium text-slate-500";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Probation & confirmation"
          subtitle="Probation period, review & confirmation"
          action={canManage && !active ? (
            <button onClick={() => setStartOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"><CalendarClock className="size-4" /> Start probation</button>
          ) : null}
        />
        <div className="p-4">
          {loading ? <p className="py-4 text-center text-sm text-slate-500">Loading…</p> : null}
          {error ? <p className="mb-2 text-sm text-rose-600">{error}</p> : null}
          {rows.length === 0 && !loading ? <p className="py-4 text-center text-sm text-slate-500">No probation record.</p> : null}

          {rows.map((p) => (
            <div key={p.id} className="mb-3 rounded-xl border border-hairline p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 font-medium text-slate-800"><ShieldCheck className="size-4" /> {p.durationMonths}-month probation</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[p.status] ?? "bg-slate-100 text-slate-500"}`}>{pretty(p.status)}</span>
                <span className="text-xs text-slate-400">{p.startDate} → {p.endDate}</span>
                {p.daysLeft !== null ? <span className={`text-xs font-medium ${p.daysLeft <= 7 ? "text-rose-600" : p.daysLeft <= 30 ? "text-amber-600" : "text-slate-500"}`}>{p.daysLeft} days left</span> : null}
              </div>
              {p.endDate !== p.originalEndDate ? <p className="mt-1 text-[11px] text-slate-400">Originally ended {p.originalEndDate}</p> : null}

              {p.extensions.length > 0 ? (
                <div className="mt-2 space-y-1">
                  {p.extensions.map((e) => (
                    <p key={e.id} className="inline-flex items-center gap-1.5 text-[11px] text-slate-500"><History className="size-3" /> Extended {e.from} → {e.to}{e.reason ? ` · ${e.reason}` : ""}</p>
                  ))}
                </div>
              ) : null}

              {p.recommendation ? <p className="mt-2 text-xs text-slate-500">Review: <span className="font-medium">{pretty(p.recommendation)}</span>{p.reviewNote ? ` · ${p.reviewNote}` : ""}</p> : null}

              {canManage && ["ACTIVE", "EXTENDED"].includes(p.status) ? (
                <button onClick={() => { setReviewFor(p); setRec("CONFIRM"); }} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:brightness-95"><Check className="size-4" /> Review probation</button>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      <Modal open={startOpen} onClose={() => setStartOpen(false)} title="Start probation">
        <div className="space-y-3">
          <div><label className={label}>Duration</label><select className={input} value={months} onChange={(e) => setMonths(e.target.value)}><option value="3">3 months</option><option value="6">6 months</option><option value="12">12 months</option></select></div>
          <p className="text-xs text-slate-400">The end date is calculated automatically. The manager is reminded before it ends.</p>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setStartOpen(false)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={start} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:brightness-95 disabled:opacity-50">{busy ? <Loader2 className="size-4 animate-spin" /> : null} Start</button>
          </div>
        </div>
      </Modal>

      <Modal open={reviewFor !== null} onClose={() => setReviewFor(null)} title="Probation review">
        <div className="space-y-3">
          <div>
            <label className={label}>Recommendation</label>
            <div className="grid grid-cols-3 gap-2">
              {([["CONFIRM", Check, "Confirm"], ["EXTEND", RefreshCcw, "Extend"], ["TERMINATE", UserX, "Terminate"]] as const).map(([v, Icon, l]) => (
                <button key={v} type="button" onClick={() => setRec(v)} className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-sm font-medium ${rec === v ? "border-brand bg-brand/5 text-brand" : "border-hairline bg-panel text-slate-600 hover:bg-slate-50"}`}><Icon className="size-4" /> {l}</button>
              ))}
            </div>
          </div>
          {rec === "EXTEND" ? <div><label className={label}>Extend by (months)</label><input type="number" min={1} max={12} className={`${input} w-24`} value={extMonths} onChange={(e) => setExtMonths(e.target.value)} /></div> : null}
          {rec === "TERMINATE" ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 ring-1 ring-inset ring-rose-200">This starts the structured exit process (offboarding checklist) for the employee.</p> : null}
          <div><label className={label}>Performance</label><textarea className={input} rows={2} value={perf} onChange={(e) => setPerf(e.target.value)} /></div>
          <div><label className={label}>Attendance</label><textarea className={input} rows={2} value={att} onChange={(e) => setAtt(e.target.value)} /></div>
          <div><label className={label}>Overall note</label><textarea className={input} rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setReviewFor(null)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={review} disabled={busy} className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium text-white disabled:opacity-50 ${rec === "TERMINATE" ? "bg-rose-600 hover:bg-rose-700" : "bg-brand hover:brightness-95"}`}>{busy ? <Loader2 className="size-4 animate-spin" /> : null} Submit review</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
