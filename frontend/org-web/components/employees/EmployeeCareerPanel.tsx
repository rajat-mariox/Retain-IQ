"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, ArrowLeftRight, Clock, Check, X, Ban, Loader2, TrendingUp } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";

type Options = {
  departments: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  designations: { id: string; title: string; level: string | null }[];
  managers: { id: string; name: string }[];
};
interface Step { id: string; order: number; role: string; status: string; assignedTo: string | null; note: string | null }
interface ChangeRequest { id: string; kind: string; status: string; proposed: Record<string, unknown>; reason: string | null; effectiveDate: string; createdAt: string; steps: Step[] }
interface CareerRow {
  id: string; changeType: string; previousDesignation: string | null; newDesignation: string | null;
  previousDepartment: string | null; newDepartment: string | null; previousManager: string | null; newManager: string | null;
  reason: string | null; effectiveFrom: string;
}

const STATUS_STYLE: Record<string, string> = {
  PENDING_APPROVAL: "bg-amber-500/10 text-amber-700",
  APPROVED: "bg-emerald-500/10 text-emerald-700",
  SCHEDULED: "bg-sky-500/10 text-sky-700",
  APPLIED: "bg-emerald-500/10 text-emerald-700",
  REJECTED: "bg-rose-500/10 text-rose-700",
  CANCELLED: "bg-slate-100 text-slate-500",
};
const STEP_ICON = (s: string) => (s === "APPROVED" ? <Check className="size-3.5 text-emerald-600" /> : s === "REJECTED" ? <X className="size-3.5 text-rose-600" /> : <Clock className="size-3.5 text-slate-400" />);
const pretty = (s: string) => s.replace(/_/g, " ").toLowerCase();

/** Career tab: promotion/transfer requests, their approval chains, and an immutable career-history timeline. */
export function EmployeeCareerPanel({ employeeId, canManage, options }: { employeeId: string; canManage: boolean; options: Options }) {
  const [history, setHistory] = useState<CareerRow[]>([]);
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<null | "PROMOTION" | "TRANSFER">(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // form
  const [designationId, setDesignationId] = useState("");
  const [title, setTitle] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [managerId, setManagerId] = useState("");
  const [reason, setReason] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/employees/${employeeId}/career`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
      fetch(`/api/employees/${employeeId}/change-requests`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([h, rq]) => { setHistory(Array.isArray(h) ? h : []); setRequests(Array.isArray(rq) ? rq : []); })
      .catch(() => undefined)
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

  function resetForm() { setDesignationId(""); setTitle(""); setDepartmentId(""); setTeamId(""); setManagerId(""); setReason(""); setEffectiveDate(""); }

  async function submit() {
    const proposed: Record<string, unknown> = {};
    if (modal === "PROMOTION") { if (designationId) proposed.designationId = designationId; if (title.trim()) proposed.title = title.trim(); }
    else { if (departmentId) proposed.departmentId = departmentId; if (teamId) proposed.teamId = teamId; if (managerId) proposed.managerId = managerId; }
    if (Object.keys(proposed).length === 0) { setError("Choose at least one change."); return; }
    const path = modal === "PROMOTION" ? "promotion" : "transfer";
    const ok = await post(`/api/employees/${employeeId}/${path}`, { proposed, reason: reason.trim() || undefined, effectiveDate: effectiveDate || undefined });
    if (ok) { setModal(null); resetForm(); load(); }
  }

  const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm";
  const label = "mb-1 block text-xs font-medium text-slate-500";
  const active = requests.filter((r) => ["PENDING_APPROVAL", "APPROVED", "SCHEDULED"].includes(r.status));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Career"
          subtitle="Promotions, transfers & progression history"
          action={canManage ? (
            <div className="flex gap-2">
              <button onClick={() => { resetForm(); setModal("PROMOTION"); }} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:brightness-95"><ArrowUpRight className="size-4" /> Promote</button>
              <button onClick={() => { resetForm(); setModal("TRANSFER"); }} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"><ArrowLeftRight className="size-4" /> Transfer</button>
            </div>
          ) : null}
        />
        <div className="p-4">
          {loading ? <p className="py-4 text-center text-sm text-slate-500">Loading…</p> : null}

          {active.length > 0 ? (
            <div className="mb-4 space-y-3">
              <p className="text-xs font-medium text-slate-500">In progress</p>
              {active.map((r) => (
                <div key={r.id} className="rounded-xl border border-hairline p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">{r.kind === "PROMOTION" ? <ArrowUpRight className="size-4" /> : <ArrowLeftRight className="size-4" />} {pretty(r.kind)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[r.status] ?? "bg-slate-100 text-slate-500"}`}>{pretty(r.status)}</span>
                    <span className="text-xs text-slate-400">effective {r.effectiveDate}</span>
                    {canManage ? <button onClick={async () => { if (await post(`/api/employees/change-requests/${r.id}/cancel`)) load(); }} className="ml-auto inline-flex items-center gap-1 text-xs text-slate-400 hover:text-rose-600"><Ban className="size-3.5" /> Cancel</button> : null}
                  </div>
                  {/* approval chain */}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {r.steps.map((s) => (
                      <span key={s.id} className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-panel-2 px-2 py-1 text-[11px] text-slate-600">
                        {STEP_ICON(s.status)} {s.role.replace(/_/g, " ").toLowerCase()}
                      </span>
                    ))}
                  </div>
                  {r.reason ? <p className="mt-1.5 text-xs text-slate-400">{r.reason}</p> : null}
                </div>
              ))}
            </div>
          ) : null}

          {/* career history timeline */}
          <p className="mb-2 text-xs font-medium text-slate-500">Progression</p>
          {history.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">No career changes recorded yet.</p>
          ) : (
            <ol className="relative space-y-4 border-l border-hairline pl-5">
              {history.map((h) => (
                <li key={h.id} className="relative">
                  <span className="absolute -left-[27px] top-0.5 grid size-5 place-items-center rounded-full bg-brand/10 text-brand ring-2 ring-panel"><TrendingUp className="size-3" /></span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">{pretty(h.changeType)}</span>
                    <span className="text-xs text-slate-400">{h.effectiveFrom}</span>
                  </div>
                  <p className="text-sm text-slate-600">
                    {h.previousDesignation !== h.newDesignation ? <>{h.previousDesignation ?? "—"} → <span className="font-medium">{h.newDesignation ?? "—"}</span> </> : null}
                    {h.previousDepartment !== h.newDepartment ? <span className="text-slate-500">· {h.previousDepartment ?? "—"} → {h.newDepartment ?? "—"} </span> : null}
                    {h.previousManager !== h.newManager ? <span className="text-slate-500">· mgr {h.previousManager ?? "—"} → {h.newManager ?? "—"}</span> : null}
                  </p>
                  {h.reason ? <p className="text-xs text-slate-400">{h.reason}</p> : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </Card>

      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal === "PROMOTION" ? "Promote employee" : "Transfer employee"}>
        <div className="space-y-3">
          {modal === "PROMOTION" ? (
            <>
              <div><label className={label}>New designation</label><select className={input} value={designationId} onChange={(e) => setDesignationId(e.target.value)}><option value="">No change</option>{options.designations.map((d) => <option key={d.id} value={d.id}>{d.title}{d.level ? ` · ${d.level}` : ""}</option>)}</select></div>
              <div><label className={label}>New title (optional)</label><input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Senior Engineer" /></div>
            </>
          ) : (
            <>
              <div><label className={label}>New department</label><select className={input} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}><option value="">No change</option>{options.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
              <div><label className={label}>New team</label><select className={input} value={teamId} onChange={(e) => setTeamId(e.target.value)}><option value="">No change</option>{options.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
              <div><label className={label}>New manager</label><select className={input} value={managerId} onChange={(e) => setManagerId(e.target.value)}><option value="">No change</option>{options.managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
            </>
          )}
          <div><label className={label}>Effective date (blank = immediate)</label><input type="date" className={input} value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} /></div>
          <div><label className={label}>Reason</label><textarea className={input} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this change?" /></div>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setModal(null)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={submit} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:brightness-95 disabled:opacity-50">{busy ? <Loader2 className="size-4 animate-spin" /> : null} Submit request</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
