"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { AddMemberForm } from "@/components/members/AddMemberForm";
import type { EmployeePage, OrgDepartment, OrgDesignation, OrgRole, OrgShift, OrgTeam } from "@/lib/api";

const STAGE_TONE: Record<string, string> = {
  ONBOARDING: "bg-sky-50 text-sky-700 ring-sky-200",
  PROBATION: "bg-amber-50 text-amber-700 ring-amber-200",
  CONFIRMED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  EXITED: "bg-slate-100 text-slate-500 ring-slate-200",
};
const select = "rounded-lg border border-hairline bg-panel py-1.5 pl-2.5 pr-7 text-sm text-slate-700 focus:border-brand focus:outline-none";

export function AllEmployeesView({
  initial,
  departments,
  teams,
  designations,
  roles,
}: {
  initial: EmployeePage;
  departments: OrgDepartment[];
  teams: OrgTeam[];
  designations: OrgDesignation[];
  shifts: OrgShift[];
  roles: OrgRole[];
}) {
  const [data, setData] = useState<EmployeePage>(initial);
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [team, setTeam] = useState("");
  const [designation, setDesignation] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const pageSize = initial.pageSize || 10;

  const load = useCallback(
    (page: number, f: { q: string; dept: string; team: string; designation: string; status: string }) => {
      setLoading(true);
      const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (f.q) qs.set("q", f.q);
      if (f.dept) qs.set("departmentId", f.dept);
      if (f.team) qs.set("teamId", f.team);
      if (f.designation) qs.set("designationId", f.designation);
      if (f.status) qs.set("status", f.status);
      fetch(`/api/employees?${qs}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d: EmployeePage) => setData(d))
        .catch(() => undefined)
        .finally(() => setLoading(false));
    },
    [pageSize],
  );

  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => load(1, { q, dept, team, designation, status }), 300);
    return () => clearTimeout(t);
  }, [q, dept, team, designation, status, load]);

  const activeDepts = departments.filter((d) => d.status !== "ARCHIVED");
  const activeDesigs = designations.filter((d) => d.status !== "ARCHIVED");
  const total = data.total;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (data.page - 1) * pageSize + 1;
  const to = Math.min(data.page * pageSize, total);
  const go = (page: number) => load(page, { q, dept, team, designation, status });

  return (
    <div className="space-y-5">
      <AddMemberForm departments={departments} roles={roles} teams={teams} />

      <Card>
        <CardHeader title="Employee directory" subtitle={`${total} people`} />
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, code…" className="w-56 rounded-lg border border-hairline bg-panel py-1.5 pl-8 pr-3 text-sm text-slate-900 focus:border-brand focus:outline-none" />
          </div>
          <select value={dept} onChange={(e) => setDept(e.target.value)} className={select}><option value="">All departments</option>{activeDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <select value={team} onChange={(e) => setTeam(e.target.value)} className={select}><option value="">All teams</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <select value={designation} onChange={(e) => setDesignation(e.target.value)} className={select}><option value="">All designations</option>{activeDesigs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={select}><option value="">All statuses</option>{["ACTIVE", "ON_LEAVE", "NOTICE_PERIOD", "SUSPENDED", "EXITED"].map((s) => <option key={s} value={s}>{s.toLowerCase().replace("_", " ")}</option>)}</select>
          {(q || dept || team || designation || status) ? <button onClick={() => { setQ(""); setDept(""); setTeam(""); setDesignation(""); setStatus(""); }} className="text-xs text-slate-500 hover:text-slate-800">Clear</button> : null}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
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
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-panel-2 text-[11px] font-semibold text-slate-700 ring-1 ring-inset ring-hairline">{`${e.firstName[0] ?? ""}${e.lastName[0] ?? ""}`.toUpperCase()}</span>
                      <span>
                        <Link href={`/employees/${e.id}`} className="font-medium text-slate-900 hover:text-brand hover:underline">{e.firstName} {e.lastName}</Link>
                        <span className="block text-xs text-slate-500">{e.email ?? e.employeeCode ?? "—"}</span>
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{e.designationRef ? `${e.designationRef.title}${e.designationRef.level ? ` · ${e.designationRef.level}` : ""}` : "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{e.departmentRef?.name ?? "—"}</td>
                  <td className="px-5 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STAGE_TONE[e.lifecycleStage] ?? "bg-slate-100 text-slate-600 ring-slate-200"}`}>{e.lifecycleStage.toLowerCase()}</span></td>
                  <td className="px-5 py-3 text-slate-600">{e.status.toLowerCase().replace("_", " ")}</td>
                  <td className="px-5 py-3 text-right">
                    <Link href={`/employees/${e.id}`} className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">View profile <ChevronRight className="size-3.5" /></Link>
                  </td>
                </tr>
              ))}
              {data.items.length === 0 ? <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-500">No employees match.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-hairline px-5 py-3 text-xs text-slate-500">
          <span>{total === 0 ? "No employees" : `Showing ${from}–${to} of ${total}`}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => go(data.page - 1)} disabled={loading || data.page <= 1} className="rounded-lg border border-hairline bg-panel px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">Prev</button>
            <span className="px-1 tabular-nums">{data.page} / {lastPage}</span>
            <button onClick={() => go(data.page + 1)} disabled={loading || data.page >= lastPage} className="rounded-lg border border-hairline bg-panel px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">Next</button>
          </div>
        </div>
      </Card>
    </div>
  );
}
