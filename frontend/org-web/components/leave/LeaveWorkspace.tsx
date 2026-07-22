"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CalendarPlus, Check, Plus, Trash2, X } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { LeaveCalendar } from "./LeaveCalendar";
import { OrgLeaveCalendar } from "./OrgLeaveCalendar";
import type { Holiday, LeaveBalances, LeaveRequest, LeaveType, OrgDepartment, OrgTeam } from "@/lib/api";

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
const label = "mb-1.5 block text-sm font-medium text-slate-700";

const STATUS: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700 ring-amber-200",
  APPROVED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  REJECTED: "bg-rose-50 text-rose-700 ring-rose-200",
  CANCELLED: "bg-slate-100 text-slate-500 ring-slate-200",
};
function StatusPill({ s }: { s: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS[s] ?? "bg-slate-100 text-slate-600 ring-slate-200"}`}>{s.toLowerCase()}</span>;
}

export function LeaveWorkspace({
  isAdmin,
  types,
  balances,
  myRequests,
  allRequests,
  holidays,
  departments,
  teams,
}: {
  isAdmin: boolean;
  types: LeaveType[];
  balances: LeaveBalances;
  myRequests: LeaveRequest[];
  allRequests: LeaveRequest[];
  holidays: Holiday[];
  departments: OrgDepartment[];
  teams: OrgTeam[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<"mine" | "orgcal" | "approvals" | "types" | "holidays">("mine");
  const [error, setError] = useState<string | null>(null);

  // request modal
  const [reqOpen, setReqOpen] = useState(false);
  const [reqType, setReqType] = useState(types[0]?.id ?? "");
  const [reqStart, setReqStart] = useState("");
  const [reqEnd, setReqEnd] = useState("");
  const [reqReason, setReqReason] = useState("");
  // type modal
  const [typeOpen, setTypeOpen] = useState(false);
  const [tName, setTName] = useState("");
  const [tCode, setTCode] = useState("");
  const [tQuota, setTQuota] = useState("12");
  const [tPaid, setTPaid] = useState(true);
  // holiday modal
  const [holOpen, setHolOpen] = useState(false);
  const [hName, setHName] = useState("");
  const [hDate, setHDate] = useState("");
  const [hType, setHType] = useState("COMPANY");
  const [hDept, setHDept] = useState("");
  const [calVersion, setCalVersion] = useState(0); // bumps → the calendar re-fetches

  function run(fn: () => Promise<Response>, onOk: () => void) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "Something went wrong.");
        return;
      }
      onOk();
      setCalVersion((v) => v + 1); // reflect the change in the calendar without a manual refresh
      router.refresh();
    });
  }

  const submitRequest = () =>
    run(
      () => fetch("/api/leave/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leaveTypeId: reqType, startDate: reqStart, endDate: reqEnd, reason: reqReason || undefined }) }),
      () => { setReqOpen(false); setReqStart(""); setReqEnd(""); setReqReason(""); },
    );
  const cancelRequest = (id: string) => run(() => fetch(`/api/leave/requests/${id}/cancel`, { method: "POST" }), () => undefined);
  const decide = (id: string, approve: boolean) => run(() => fetch(`/api/leave/requests/${id}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approve }) }), () => undefined);
  const createType = () =>
    run(
      () => fetch("/api/leave/types", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: tName, code: tCode, annualQuota: Number(tQuota) || 0, paid: tPaid }) }),
      () => { setTypeOpen(false); setTName(""); setTCode(""); setTQuota("12"); setTPaid(true); },
    );
  const createHoliday = () =>
    run(
      () => fetch("/api/holidays", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: hName, date: hDate, type: hType, departmentId: hType === "DEPARTMENT" ? hDept || null : null }) }),
      () => { setHolOpen(false); setHName(""); setHDate(""); setHType("COMPANY"); setHDept(""); },
    );
  const deleteHoliday = (id: string) => run(() => fetch(`/api/holidays/${id}`, { method: "DELETE" }), () => undefined);

  const pendingCount = allRequests.filter((r) => r.status === "PENDING").length;
  const activeDepts = departments.filter((d) => d.status !== "ARCHIVED");
  const today = new Date().toISOString().slice(0, 10); // leave can't be backdated
  const fmtRange = (r: LeaveRequest) => (r.startDate === r.endDate ? r.startDate : `${r.startDate} → ${r.endDate}`);

  const TabBtn = ({ k, labelText, count }: { k: typeof tab; labelText: string; count?: number }) => (
    <button onClick={() => setTab(k)} className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${tab === k ? "bg-panel text-slate-900 shadow-sm ring-1 ring-hairline" : "text-slate-500 hover:text-slate-800"}`}>
      {labelText}
      {count ? <span className="rounded-full bg-amber-100 px-1.5 text-xs tabular-nums text-amber-700">{count}</span> : null}
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1 rounded-xl border border-hairline bg-panel-2 p-1">
        <TabBtn k="mine" labelText="My Leave" />
        {isAdmin ? <TabBtn k="orgcal" labelText="Org Calendar" /> : null}
        {isAdmin ? <TabBtn k="approvals" labelText="Approvals" count={pendingCount} /> : null}
        {isAdmin ? <TabBtn k="types" labelText="Leave Types" /> : null}
        <TabBtn k="holidays" labelText="Holidays" />
      </div>

      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 ring-1 ring-inset ring-rose-200">{error}</p> : null}

      {/* My Leave */}
      {tab === "mine" ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {balances.balances.map((b) => (
              <Card key={b.leaveTypeId}>
                <CardBody className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: b.color ?? "#64748b" }} />
                    <span className="text-sm font-medium text-slate-700">{b.name}</span>
                  </div>
                  <p className="text-2xl font-semibold tabular-nums text-slate-900">{b.remaining ?? "∞"}<span className="text-sm font-normal text-slate-400">{b.remaining !== null ? ` / ${b.allocated}` : " days"}</span></p>
                  <p className="text-xs text-slate-500">{b.used} used · {b.pending} pending</p>
                </CardBody>
              </Card>
            ))}
          </div>

          <LeaveCalendar refreshSignal={calVersion} />

          <Card>
            <CardHeader title="My requests" subtitle={`${balances.year} leave requests`} action={<button onClick={() => { setReqType(types[0]?.id ?? ""); setReqOpen(true); }} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-soft"><CalendarPlus className="size-4" /> Request leave</button>} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="border-b border-hairline text-xs text-slate-500">
                  <th className="px-5 py-3 text-left font-medium">Type</th><th className="px-5 py-3 text-left font-medium">Dates</th><th className="px-5 py-3 text-right font-medium">Days</th><th className="px-5 py-3 text-left font-medium">Reason</th><th className="px-5 py-3 text-left font-medium">Status</th><th className="px-5 py-3 text-right font-medium"></th>
                </tr></thead>
                <tbody>
                  {myRequests.map((r) => (
                    <tr key={r.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                      <td className="px-5 py-3 font-medium text-slate-900">{r.leaveType.name}</td>
                      <td className="px-5 py-3 tabular-nums text-slate-600">{fmtRange(r)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-600">{r.days}</td>
                      <td className="px-5 py-3 text-slate-500">{r.reason ?? "—"}</td>
                      <td className="px-5 py-3"><StatusPill s={r.status} /></td>
                      <td className="px-5 py-3 text-right">{r.status === "PENDING" || r.status === "APPROVED" ? <button onClick={() => cancelRequest(r.id)} disabled={pending} className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-50">Cancel</button> : null}</td>
                    </tr>
                  ))}
                  {myRequests.length === 0 ? <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-500">No leave requests yet.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      {/* Org Calendar */}
      {tab === "orgcal" && isAdmin ? <OrgLeaveCalendar departments={departments} teams={teams} /> : null}

      {/* Approvals */}
      {tab === "approvals" && isAdmin ? (
        <Card>
          <CardHeader title="Approval center" subtitle={`${pendingCount} pending`} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className="border-b border-hairline text-xs text-slate-500">
                <th className="px-5 py-3 text-left font-medium">Employee</th><th className="px-5 py-3 text-left font-medium">Type</th><th className="px-5 py-3 text-left font-medium">Dates</th><th className="px-5 py-3 text-right font-medium">Days</th><th className="px-5 py-3 text-left font-medium">Reason</th><th className="px-5 py-3 text-left font-medium">Status</th><th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr></thead>
              <tbody>
                {allRequests.map((r) => (
                  <tr key={r.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-900">{r.employeeName ?? "—"}</td>
                    <td className="px-5 py-3 text-slate-600">{r.leaveType.name}</td>
                    <td className="px-5 py-3 tabular-nums text-slate-600">{fmtRange(r)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-600">{r.days}</td>
                    <td className="px-5 py-3 text-slate-500">{r.reason ?? "—"}</td>
                    <td className="px-5 py-3"><StatusPill s={r.status} /></td>
                    <td className="px-5 py-3 text-right">
                      {r.status === "PENDING" ? (
                        <div className="flex justify-end gap-1.5">
                          <button onClick={() => decide(r.id, true)} disabled={pending} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"><Check className="size-3.5" /> Approve</button>
                          <button onClick={() => decide(r.id, false)} disabled={pending} className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"><X className="size-3.5" /> Reject</button>
                        </div>
                      ) : <span className="text-xs text-slate-400">—</span>}
                    </td>
                  </tr>
                ))}
                {allRequests.length === 0 ? <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-slate-500">No leave requests.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* Leave Types */}
      {tab === "types" && isAdmin ? (
        <Card>
          <CardHeader title="Leave types" subtitle="Policies & annual quotas" action={<button onClick={() => setTypeOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-soft"><Plus className="size-4" /> Leave type</button>} />
          <ul className="divide-y divide-hairline/60">
            {types.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <span className="flex items-center gap-2.5">
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: t.color ?? "#64748b" }} />
                  <span><span className="font-medium text-slate-900">{t.name}</span> <span className="text-xs text-slate-400">{t.code}</span>{t.status === "ARCHIVED" ? <span className="ml-2 text-[11px] text-slate-400">archived</span> : null}<span className="block text-xs text-slate-500">{t.annualQuota > 0 ? `${t.annualQuota} days/yr` : "uncapped"} · {t.paid ? "paid" : "unpaid"}</span></span>
                </span>
              </li>
            ))}
            {types.length === 0 ? <li className="px-5 py-8 text-center text-sm text-slate-500">No leave types.</li> : null}
          </ul>
        </Card>
      ) : null}

      {/* Holidays */}
      {tab === "holidays" ? (
        <Card>
          <CardHeader title="Holidays" subtitle={`${holidays.length} in ${balances.year}`} action={isAdmin ? <button onClick={() => setHolOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-soft"><Plus className="size-4" /> Holiday</button> : undefined} />
          <ul className="divide-y divide-hairline/60">
            {holidays.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <span className="flex items-center gap-2.5">
                  <span className="grid size-8 place-items-center rounded-lg bg-panel-2 text-slate-500 ring-1 ring-inset ring-hairline"><CalendarDays className="size-4" /></span>
                  <span><span className="font-medium text-slate-900">{h.name}</span><span className="block text-xs text-slate-500">{h.date} · {h.type.toLowerCase()}{h.departmentName ? ` · ${h.departmentName}` : ""}</span></span>
                </span>
                {isAdmin ? <button onClick={() => deleteHoliday(h.id)} disabled={pending} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-50" title="Delete"><Trash2 className="size-4" /></button> : null}
              </li>
            ))}
            {holidays.length === 0 ? <li className="px-5 py-8 text-center text-sm text-slate-500">No holidays configured.</li> : null}
          </ul>
        </Card>
      ) : null}

      {/* Request leave modal */}
      <Modal open={reqOpen} onClose={() => setReqOpen(false)} title="Request leave">
        <div className="space-y-4">
          <div><label className={label}>Leave type</label><select className={input} value={reqType} onChange={(e) => setReqType(e.target.value)}>{types.filter((t) => t.status !== "ARCHIVED").map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>From</label><input type="date" min={today} className={input} value={reqStart} onChange={(e) => setReqStart(e.target.value)} /></div>
            <div><label className={label}>To</label><input type="date" min={reqStart || today} className={input} value={reqEnd} onChange={(e) => setReqEnd(e.target.value)} /></div>
          </div>
          <div><label className={label}>Reason (optional)</label><input className={input} value={reqReason} onChange={(e) => setReqReason(e.target.value)} placeholder="e.g. Family vacation" /></div>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2"><button onClick={() => setReqOpen(false)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button><button onClick={submitRequest} disabled={pending || !reqType || !reqStart || !reqEnd} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">{pending ? "Submitting…" : "Submit"}</button></div>
        </div>
      </Modal>

      {/* Leave type modal */}
      <Modal open={typeOpen} onClose={() => setTypeOpen(false)} title="New leave type">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Name</label><input className={input} value={tName} onChange={(e) => setTName(e.target.value)} placeholder="e.g. Maternity" autoFocus /></div>
            <div><label className={label}>Code</label><input className={input} value={tCode} onChange={(e) => setTCode(e.target.value)} placeholder="e.g. ML" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Annual quota (days)</label><input type="number" min={0} className={input} value={tQuota} onChange={(e) => setTQuota(e.target.value)} /></div>
            <label className="mt-7 flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={tPaid} onChange={(e) => setTPaid(e.target.checked)} className="size-4 rounded border-hairline text-brand focus:ring-brand" /> Paid leave</label>
          </div>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2"><button onClick={() => setTypeOpen(false)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button><button onClick={createType} disabled={pending || !tName.trim() || !tCode.trim()} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">{pending ? "Creating…" : "Create"}</button></div>
        </div>
      </Modal>

      {/* Holiday modal */}
      <Modal open={holOpen} onClose={() => setHolOpen(false)} title="New holiday">
        <div className="space-y-4">
          <div><label className={label}>Name</label><input className={input} value={hName} onChange={(e) => setHName(e.target.value)} placeholder="e.g. Independence Day" autoFocus /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Date</label><input type="date" className={input} value={hDate} onChange={(e) => setHDate(e.target.value)} /></div>
            <div><label className={label}>Type</label><select className={input} value={hType} onChange={(e) => setHType(e.target.value)}><option value="COMPANY">Company</option><option value="REGIONAL">Regional</option><option value="DEPARTMENT">Department</option></select></div>
          </div>
          {hType === "DEPARTMENT" ? <div><label className={label}>Department</label><select className={input} value={hDept} onChange={(e) => setHDept(e.target.value)}><option value="">Select…</option>{activeDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div> : null}
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2"><button onClick={() => setHolOpen(false)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button><button onClick={createHoliday} disabled={pending || !hName.trim() || !hDate || (hType === "DEPARTMENT" && !hDept)} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">{pending ? "Creating…" : "Create"}</button></div>
        </div>
      </Modal>
    </div>
  );
}
