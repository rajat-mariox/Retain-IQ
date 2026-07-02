"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Building2, Plus, Trash2, Users } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import type { OrgDepartment, OrgRequisition, OrgTeam } from "@/lib/api";

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
const label = "mb-1.5 block text-sm font-medium text-slate-700";

export function OrgStructurePanel({ departments, teams, requisitions }: { departments: OrgDepartment[]; teams: OrgTeam[]; requisitions: OrgRequisition[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [deptOpen, setDeptOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [reqOpen, setReqOpen] = useState(false);
  const [deptName, setDeptName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamDept, setTeamDept] = useState("");
  const [reqTitle, setReqTitle] = useState("");
  const [reqDept, setReqDept] = useState("");
  const [reqOpenings, setReqOpenings] = useState("1");
  const [error, setError] = useState<string | null>(null);

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
      router.refresh();
    });
  }

  const createDept = () =>
    run(
      () => fetch("/api/departments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: deptName }) }),
      () => {
        setDeptOpen(false);
        setDeptName("");
      },
    );
  const archiveDept = (id: string) => run(() => fetch(`/api/departments/${id}`, { method: "DELETE" }), () => undefined);
  const createTeam = () =>
    run(
      () => fetch("/api/teams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: teamName, departmentId: teamDept || null }) }),
      () => {
        setTeamOpen(false);
        setTeamName("");
        setTeamDept("");
      },
    );
  const deleteTeam = (id: string) => run(() => fetch(`/api/teams/${id}`, { method: "DELETE" }), () => undefined);
  const createReq = () =>
    run(
      () => fetch("/api/requisitions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: reqTitle, departmentId: reqDept || null, openings: Math.max(1, Number(reqOpenings) || 1) }) }),
      () => {
        setReqOpen(false);
        setReqTitle("");
        setReqDept("");
        setReqOpenings("1");
      },
    );
  const closeReq = (id: string) => run(() => fetch(`/api/requisitions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "CLOSED" }) }), () => undefined);

  const openReqCount = requisitions.filter((r) => r.status === "OPEN").reduce((s, r) => s + r.openings, 0);

  return (
    <>
      {/* Departments */}
      <Card>
        <CardHeader
          title="Departments"
          subtitle={`${departments.length} department${departments.length === 1 ? "" : "s"}`}
          action={
            <button onClick={() => setDeptOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-soft">
              <Plus className="size-4" /> Department
            </button>
          }
        />
        <ul className="divide-y divide-hairline/60">
          {departments.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <span className="flex items-center gap-2.5 text-sm">
                <span className="grid size-8 place-items-center rounded-lg bg-brand/10 text-brand ring-1 ring-inset ring-brand/20"><Building2 className="size-4" /></span>
                <span>
                  <span className="font-medium text-slate-900">{d.name}</span>
                  {d.status === "ARCHIVED" ? <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">Archived</span> : null}
                  <span className="block text-xs text-slate-500">{d.employeeCount} employees · {d.teamCount} teams</span>
                </span>
              </span>
              {d.status !== "ARCHIVED" ? (
                <button onClick={() => archiveDept(d.id)} disabled={pending} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-50" title="Archive department">
                  <Trash2 className="size-4" />
                </button>
              ) : null}
            </li>
          ))}
          {departments.length === 0 ? <li className="px-5 py-8 text-center text-sm text-slate-500">No departments yet.</li> : null}
        </ul>
      </Card>

      {/* Teams */}
      <Card>
        <CardHeader
          title="Teams"
          subtitle={`${teams.length} team${teams.length === 1 ? "" : "s"}`}
          action={
            <button onClick={() => setTeamOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-soft">
              <Plus className="size-4" /> Team
            </button>
          }
        />
        <ul className="divide-y divide-hairline/60">
          {teams.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <span className="flex items-center gap-2.5 text-sm">
                <span className="grid size-8 place-items-center rounded-lg bg-panel-2 text-slate-500 ring-1 ring-inset ring-hairline"><Users className="size-4" /></span>
                <span>
                  <span className="font-medium text-slate-900">{t.name}</span>
                  <span className="block text-xs text-slate-500">{t.departmentName ?? "No department"} · {t.memberCount} members</span>
                </span>
              </span>
              <button onClick={() => deleteTeam(t.id)} disabled={pending} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-50" title="Delete team">
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
          {teams.length === 0 ? <li className="px-5 py-8 text-center text-sm text-slate-500">No teams yet.</li> : null}
        </ul>
      </Card>

      {/* Open positions (requisitions) */}
      <Card>
        <CardHeader
          title="Open positions"
          subtitle={`${openReqCount} opening${openReqCount === 1 ? "" : "s"} across ${requisitions.filter((r) => r.status === "OPEN").length} requisition${requisitions.filter((r) => r.status === "OPEN").length === 1 ? "" : "s"}`}
          action={
            <button onClick={() => setReqOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-soft">
              <Plus className="size-4" /> Position
            </button>
          }
        />
        <ul className="divide-y divide-hairline/60">
          {requisitions.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <span className="flex items-center gap-2.5 text-sm">
                <span className="grid size-8 place-items-center rounded-lg bg-panel-2 text-slate-500 ring-1 ring-inset ring-hairline"><Briefcase className="size-4" /></span>
                <span>
                  <span className="font-medium text-slate-900">{r.title}</span>
                  {r.status !== "OPEN" ? <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">{r.status.toLowerCase()}</span> : null}
                  <span className="block text-xs text-slate-500">{r.departmentName ?? "No department"} · {r.openings} opening{r.openings === 1 ? "" : "s"}</span>
                </span>
              </span>
              {r.status === "OPEN" ? (
                <button onClick={() => closeReq(r.id)} disabled={pending} className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50">
                  Close
                </button>
              ) : null}
            </li>
          ))}
          {requisitions.length === 0 ? <li className="px-5 py-8 text-center text-sm text-slate-500">No open positions.</li> : null}
        </ul>
      </Card>

      {/* Add position modal */}
      <Modal open={reqOpen} onClose={() => setReqOpen(false)} title="New open position">
        <div className="space-y-4">
          <div>
            <label className={label}>Job title</label>
            <input className={input} value={reqTitle} onChange={(e) => setReqTitle(e.target.value)} placeholder="e.g. Senior Engineer" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Department</label>
              <select className={input} value={reqDept} onChange={(e) => setReqDept(e.target.value)}>
                <option value="">No department</option>
                {departments.filter((d) => d.status !== "ARCHIVED").map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Openings</label>
              <input className={input} type="number" min={1} value={reqOpenings} onChange={(e) => setReqOpenings(e.target.value)} />
            </div>
          </div>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setReqOpen(false)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={createReq} disabled={pending || !reqTitle.trim()} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">{pending ? "Creating…" : "Create"}</button>
          </div>
        </div>
      </Modal>

      {/* Add department modal */}
      <Modal open={deptOpen} onClose={() => setDeptOpen(false)} title="New department">
        <div className="space-y-4">
          <div>
            <label className={label}>Name</label>
            <input className={input} value={deptName} onChange={(e) => setDeptName(e.target.value)} placeholder="e.g. Engineering" autoFocus />
          </div>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setDeptOpen(false)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={createDept} disabled={pending || !deptName.trim()} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">{pending ? "Creating…" : "Create"}</button>
          </div>
        </div>
      </Modal>

      {/* Add team modal */}
      <Modal open={teamOpen} onClose={() => setTeamOpen(false)} title="New team">
        <div className="space-y-4">
          <div>
            <label className={label}>Name</label>
            <input className={input} value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="e.g. Platform" autoFocus />
          </div>
          <div>
            <label className={label}>Department</label>
            <select className={input} value={teamDept} onChange={(e) => setTeamDept(e.target.value)}>
              <option value="">No department</option>
              {departments.filter((d) => d.status !== "ARCHIVED").map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setTeamOpen(false)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={createTeam} disabled={pending || !teamName.trim()} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">{pending ? "Creating…" : "Create"}</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
