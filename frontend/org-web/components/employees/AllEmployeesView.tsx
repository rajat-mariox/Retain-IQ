"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, SlidersHorizontal } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { AddMemberForm } from "@/components/members/AddMemberForm";
import type { EmployeePage, EmployeeRow, OrgDepartment, OrgDesignation, OrgRole, OrgShift, OrgTeam } from "@/lib/api";

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
const label = "mb-1.5 block text-sm font-medium text-slate-700";

const STAGE_TONE: Record<string, string> = {
  ONBOARDING: "bg-sky-50 text-sky-700 ring-sky-200",
  PROBATION: "bg-amber-50 text-amber-700 ring-amber-200",
  CONFIRMED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  EXITED: "bg-slate-100 text-slate-500 ring-slate-200",
};

export function AllEmployeesView({
  initial,
  departments,
  teams,
  designations,
  shifts,
  roles,
}: {
  initial: EmployeePage;
  departments: OrgDepartment[];
  teams: OrgTeam[];
  designations: OrgDesignation[];
  shifts: OrgShift[];
  roles: OrgRole[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [data, setData] = useState<EmployeePage>(initial);
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [loading, setLoading] = useState(false);
  const pageSize = initial.pageSize || 10;

  const [edit, setEdit] = useState<EmployeeRow | null>(null);
  const [form, setForm] = useState({ designationId: "", departmentId: "", teamId: "", shiftId: "", status: "" });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (page: number, query: string, departmentId: string) => {
      setLoading(true);
      const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (query) qs.set("q", query);
      if (departmentId) qs.set("departmentId", departmentId);
      fetch(`/api/employees?${qs}`)
        .then((r) => r.json())
        .then((d: EmployeePage) => setData(d))
        .catch(() => undefined)
        .finally(() => setLoading(false));
    },
    [pageSize],
  );

  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => load(1, q, dept), 300);
    return () => clearTimeout(t);
  }, [q, dept, load]);

  const refresh = () => load(data.page, q, dept);
  const activeDepts = departments.filter((d) => d.status !== "ARCHIVED");
  const activeDesigs = designations.filter((d) => d.status !== "ARCHIVED");
  const activeShifts = shifts.filter((s) => s.status !== "ARCHIVED");

  function openEdit(e: EmployeeRow) {
    setEdit(e);
    setForm({ designationId: e.designationId ?? "", departmentId: e.departmentId ?? "", teamId: e.teamId ?? "", shiftId: e.shiftId ?? "", status: e.status });
    setError(null);
  }

  function save() {
    if (!edit) return;
    setError(null);
    start(async () => {
      const res = await fetch(`/api/employees/${edit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          designationId: form.designationId || null,
          departmentId: form.departmentId || null,
          teamId: form.teamId || null,
          shiftId: form.shiftId || null,
          status: form.status,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "Update failed.");
        return;
      }
      setEdit(null);
      refresh(); // refresh the employee table
      router.refresh(); // refresh server-fetched directory counts (department/designation/shift)
    });
  }

  const total = data.total;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (data.page - 1) * pageSize + 1;
  const to = Math.min(data.page * pageSize, total);

  return (
    <div className="space-y-6">
      <AddMemberForm departments={departments} roles={roles} teams={teams} />

      <Card>
        <CardHeader
          title="All employees"
          subtitle={`${total} in your organization`}
          action={
            <div className="flex items-center gap-2">
              <select value={dept} onChange={(e) => setDept(e.target.value)} className="rounded-lg border border-hairline bg-panel py-1.5 pl-2.5 pr-7 text-sm text-slate-700 focus:border-brand focus:outline-none">
                <option value="">All departments</option>
                {activeDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-48 rounded-lg border border-hairline bg-panel py-1.5 pl-8 pr-3 text-sm text-slate-900 focus:border-brand focus:outline-none" />
              </div>
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-hairline text-xs text-slate-500">
                <th className="px-5 py-3 text-left font-medium">Name</th>
                <th className="px-5 py-3 text-left font-medium">Designation</th>
                <th className="px-5 py-3 text-left font-medium">Department</th>
                <th className="px-5 py-3 text-left font-medium">Stage</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody className={loading ? "opacity-50 transition-opacity" : "transition-opacity"}>
              {data.items.map((e) => (
                <tr key={e.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-panel-2 text-[11px] font-semibold text-slate-700 ring-1 ring-inset ring-hairline">
                        {`${e.firstName[0] ?? ""}${e.lastName[0] ?? ""}`.toUpperCase()}
                      </span>
                      <span>
                        <span className="font-medium text-slate-900">{e.firstName} {e.lastName}</span>
                        <span className="block text-xs text-slate-500">{e.email ?? e.employeeCode ?? "—"}</span>
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{e.designationRef ? `${e.designationRef.title}${e.designationRef.level ? ` · ${e.designationRef.level}` : ""}` : "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{e.departmentRef?.name ?? "—"}</td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STAGE_TONE[e.lifecycleStage] ?? "bg-slate-100 text-slate-600 ring-slate-200"}`}>{e.lifecycleStage.toLowerCase()}</span>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{e.status.toLowerCase().replace("_", " ")}</td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => openEdit(e)} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                      <SlidersHorizontal className="size-3.5 text-slate-500" /> Manage
                    </button>
                  </td>
                </tr>
              ))}
              {data.items.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-500">{q || dept ? "No employees match." : "No employees yet."}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-hairline px-5 py-3 text-xs text-slate-500">
          <span>{total === 0 ? "No employees" : `Showing ${from}–${to} of ${total}`}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => load(data.page - 1, q, dept)} disabled={loading || data.page <= 1} className="rounded-lg border border-hairline bg-panel px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">Prev</button>
            <span className="px-1 tabular-nums">{data.page} / {lastPage}</span>
            <button onClick={() => load(data.page + 1, q, dept)} disabled={loading || data.page >= lastPage} className="rounded-lg border border-hairline bg-panel px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">Next</button>
          </div>
        </div>
      </Card>

      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit ? `Manage — ${edit.firstName} ${edit.lastName}` : "Manage"}>
        <div className="space-y-4">
          <div>
            <label className={label}>Designation</label>
            <select className={input} value={form.designationId} onChange={(e) => setForm({ ...form, designationId: e.target.value })}>
              <option value="">None</option>
              {activeDesigs.map((d) => <option key={d.id} value={d.id}>{d.title}{d.level ? ` · ${d.level}` : ""}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Department</label>
              <select className={input} value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                <option value="">None</option>
                {activeDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Team</label>
              <select className={input} value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })}>
                <option value="">None</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Shift</label>
              <select className={input} value={form.shiftId} onChange={(e) => setForm({ ...form, shiftId: e.target.value })}>
                <option value="">Default shift</option>
                {activeShifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Status</label>
              <select className={input} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {["ACTIVE", "ON_LEAVE", "NOTICE_PERIOD", "SUSPENDED"].map((s) => <option key={s} value={s}>{s.toLowerCase().replace("_", " ")}</option>)}
              </select>
            </div>
          </div>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setEdit(null)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={save} disabled={pending} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">{pending ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
