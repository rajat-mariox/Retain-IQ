"use client";

import { useCallback, useEffect, useState } from "react";
import { DoorOpen, Check, SkipForward, Ban, CheckCircle2, Loader2, ClipboardList } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";

interface Task { id: string; title: string; category: string; assignee: string; status: string; note: string | null }
interface Exit {
  id: string; reason: string; status: string; reasonNote: string | null;
  noticeStartDate: string | null; lastWorkingDay: string | null; exitInterviewNote: string | null;
  rehireEligible: boolean; rehireRating: number | null; initiatedAt: string;
  progress: { done: number; total: number }; tasks: Task[];
}

const REASONS = ["RESIGNATION", "TERMINATION", "RETIREMENT", "CONTRACT_END", "LAYOFF", "OTHER"];
const STATUS_STYLE: Record<string, string> = {
  INITIATED: "bg-amber-500/10 text-amber-700", NOTICE_PERIOD: "bg-amber-500/10 text-amber-700",
  CLEARANCE: "bg-sky-500/10 text-sky-700", COMPLETED: "bg-emerald-500/10 text-emerald-700", CANCELLED: "bg-slate-100 text-slate-500",
};
const pretty = (s: string) => s.replace(/_/g, " ").toLowerCase();

/** Exit tab: initiate a structured exit, work the offboarding checklist, complete on the last working day. */
export function EmployeeExitPanel({ employeeId, canManage }: { employeeId: string; canManage: boolean }) {
  const [exits, setExits] = useState<Exit[]>([]);
  const [loading, setLoading] = useState(true);
  const [initOpen, setInitOpen] = useState(false);
  const [completeFor, setCompleteFor] = useState<Exit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // initiate form
  const [reason, setReason] = useState("RESIGNATION");
  const [reasonNote, setReasonNote] = useState("");
  const [lastWorkingDay, setLastWorkingDay] = useState("");
  // complete form
  const [interview, setInterview] = useState("");
  const [rehire, setRehire] = useState(true);
  const [rating, setRating] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/employees/${employeeId}/exits`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setExits(Array.isArray(d) ? d : []))
      .catch(() => setExits([]))
      .finally(() => setLoading(false));
  }, [employeeId]);
  useEffect(() => { load(); }, [load]);

  async function post(url: string, body?: unknown, method = "POST") {
    setBusy(true); setError(null);
    const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? "That didn't work."); }
    setBusy(false);
    return res.ok;
  }

  async function initiate() {
    const ok = await post(`/api/employees/${employeeId}/exit-process`, { reason, reasonNote: reasonNote.trim() || undefined, lastWorkingDay: lastWorkingDay || undefined });
    if (ok) { setInitOpen(false); setReasonNote(""); setLastWorkingDay(""); load(); }
  }
  async function complete() {
    if (!completeFor) return;
    const ok = await post(`/api/employees/exits/${completeFor.id}/complete`, { exitInterviewNote: interview.trim() || undefined, rehireEligible: rehire, rehireRating: rating ? Number(rating) : undefined });
    if (ok) { setCompleteFor(null); setInterview(""); setRating(""); load(); }
  }

  const active = exits.find((e) => ["INITIATED", "NOTICE_PERIOD", "CLEARANCE"].includes(e.status));
  const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm";
  const label = "mb-1 block text-xs font-medium text-slate-500";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Exit & offboarding"
          subtitle="Structured exit process with a clearance checklist"
          action={canManage && !active ? (
            <button onClick={() => setInitOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50"><DoorOpen className="size-4" /> Initiate exit</button>
          ) : null}
        />
        <div className="p-4">
          {loading ? <p className="py-4 text-center text-sm text-slate-500">Loading…</p> : null}
          {error ? <p className="mb-2 text-sm text-rose-600">{error}</p> : null}

          {exits.length === 0 && !loading ? <p className="py-4 text-center text-sm text-slate-500">No exit process. This employee is active.</p> : null}

          {exits.map((e) => (
            <div key={e.id} className="mb-3 rounded-xl border border-hairline p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 font-medium text-slate-800"><DoorOpen className="size-4" /> {pretty(e.reason)}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[e.status] ?? "bg-slate-100 text-slate-500"}`}>{pretty(e.status)}</span>
                {e.lastWorkingDay ? <span className="text-xs text-slate-400">last day {e.lastWorkingDay}</span> : null}
                <span className="ml-auto inline-flex items-center gap-1 text-xs text-slate-500"><ClipboardList className="size-3.5" /> {e.progress.done}/{e.progress.total}</span>
              </div>
              {e.reasonNote ? <p className="mt-1 text-xs text-slate-500">{e.reasonNote}</p> : null}

              {/* checklist */}
              <ul className="mt-3 space-y-1.5">
                {e.tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-sm">
                    <span className={`inline-flex size-5 items-center justify-center rounded-full ${t.status === "DONE" ? "bg-emerald-500/10 text-emerald-600" : t.status === "SKIPPED" ? "bg-slate-100 text-slate-400" : "bg-panel-2 text-slate-300"}`}>
                      {t.status === "DONE" ? <Check className="size-3" /> : t.status === "SKIPPED" ? <SkipForward className="size-3" /> : null}
                    </span>
                    <span className={`flex-1 ${t.status === "DONE" ? "text-slate-500 line-through" : "text-slate-700"}`}>{t.title}</span>
                    <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">{t.assignee}</span>
                    {canManage && ["INITIATED", "NOTICE_PERIOD", "CLEARANCE"].includes(e.status) && t.status !== "DONE" ? (
                      <span className="flex gap-1">
                        <button onClick={async () => { if (await post(`/api/employees/offboarding-tasks/${t.id}`, { status: "DONE" }, "PATCH")) load(); }} title="Mark done" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-emerald-600"><Check className="size-4" /></button>
                        <button onClick={async () => { if (await post(`/api/employees/offboarding-tasks/${t.id}`, { status: "SKIPPED" }, "PATCH")) load(); }} title="Skip" className="rounded p-1 text-slate-400 hover:bg-slate-100"><SkipForward className="size-4" /></button>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>

              {canManage && ["INITIATED", "NOTICE_PERIOD", "CLEARANCE"].includes(e.status) ? (
                <div className="mt-3 flex gap-2">
                  <button onClick={() => { setCompleteFor(e); setRehire(e.rehireEligible); }} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:brightness-95"><CheckCircle2 className="size-4" /> Complete exit</button>
                  <button onClick={async () => { if (await post(`/api/employees/exits/${e.id}/cancel`)) load(); }} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"><Ban className="size-4" /> Cancel</button>
                </div>
              ) : null}
              {e.status === "COMPLETED" ? <p className="mt-2 text-xs text-slate-400">Completed · rehire {e.rehireEligible ? "eligible" : "not eligible"}{e.rehireRating ? ` · rating ${e.rehireRating}/5` : ""}</p> : null}
            </div>
          ))}
        </div>
      </Card>

      <Modal open={initOpen} onClose={() => setInitOpen(false)} title="Initiate exit">
        <div className="space-y-3">
          <div><label className={label}>Reason</label><select className={input} value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r} value={r}>{pretty(r)}</option>)}</select></div>
          <div><label className={label}>Last working day (optional)</label><input type="date" className={input} value={lastWorkingDay} onChange={(e) => setLastWorkingDay(e.target.value)} /></div>
          <div><label className={label}>Note</label><textarea className={input} rows={2} value={reasonNote} onChange={(e) => setReasonNote(e.target.value)} placeholder="Context for the exit" /></div>
          <p className="text-xs text-slate-400">This puts the employee on notice and creates the offboarding checklist. They stay active until you complete the exit.</p>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setInitOpen(false)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={initiate} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50">{busy ? <Loader2 className="size-4 animate-spin" /> : null} Initiate</button>
          </div>
        </div>
      </Modal>

      <Modal open={completeFor !== null} onClose={() => setCompleteFor(null)} title="Complete exit">
        <div className="space-y-3">
          <p className="text-xs text-slate-500">This moves the employee to EXITED and creates their alumni record. Access will be revoked.</p>
          <div><label className={label}>Exit interview notes</label><textarea className={input} rows={3} value={interview} onChange={(e) => setInterview(e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={rehire} onChange={(e) => setRehire(e.target.checked)} className="size-4 accent-brand" /> Eligible for rehire</label>
          {rehire ? <div><label className={label}>Rehire rating (1–5)</label><input type="number" min={1} max={5} className={`${input} w-24`} value={rating} onChange={(e) => setRating(e.target.value)} /></div> : null}
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setCompleteFor(null)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={complete} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:brightness-95 disabled:opacity-50">{busy ? <Loader2 className="size-4 animate-spin" /> : null} Complete exit</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
