"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Plus, Trash2, Users } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import type { OrgDepartment, OrgTeam } from "@/lib/api";

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
const label = "mb-1.5 block text-sm font-medium text-slate-700";

export function StructureView({ kind, departments, teams }: { kind: "departments" | "teams"; departments: OrgDepartment[]; teams: OrgTeam[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [teamDept, setTeamDept] = useState("");
  const [error, setError] = useState<string | null>(null);
  const activeDepts = departments.filter((d) => d.status !== "ARCHIVED");

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

  const create = () =>
    run(
      () =>
        kind === "departments"
          ? fetch("/api/departments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) })
          : fetch("/api/teams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, departmentId: teamDept || null }) }),
      () => {
        setOpen(false);
        setName("");
        setTeamDept("");
      },
    );
  const removeDept = (id: string) => run(() => fetch(`/api/departments/${id}`, { method: "DELETE" }), () => undefined);
  const removeTeam = (id: string) => run(() => fetch(`/api/teams/${id}`, { method: "DELETE" }), () => undefined);

  if (kind === "departments") {
    return (
      <>
        <Card>
          <CardHeader
            title="Departments"
            subtitle={`${activeDepts.length} active`}
            action={<button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-soft"><Plus className="size-4" /> Department</button>}
          />
          <ul className="divide-y divide-hairline/60">
            {departments.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="flex items-center gap-2.5 text-sm">
                  <span className="grid size-8 place-items-center rounded-lg bg-panel-2 text-slate-500 ring-1 ring-inset ring-hairline"><Building2 className="size-4" /></span>
                  <span>
                    <span className="font-medium text-slate-900">{d.name}</span>
                    {d.status === "ARCHIVED" ? <span className="ml-2 text-[11px] text-slate-400">archived</span> : null}
                    <span className="block text-xs text-slate-500">{d.employeeCount} people · {d.teamCount} teams</span>
                  </span>
                </span>
                {d.status !== "ARCHIVED" ? <button onClick={() => removeDept(d.id)} disabled={pending} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-50" title="Archive"><Trash2 className="size-4" /></button> : null}
              </li>
            ))}
            {departments.length === 0 ? <li className="px-5 py-8 text-center text-sm text-slate-500">No departments yet.</li> : null}
          </ul>
        </Card>
        <Modal open={open} onClose={() => setOpen(false)} title="New department">
          <div className="space-y-4">
            <div><label className={label}>Name</label><input className={input} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={create} disabled={pending || !name.trim()} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">{pending ? "Creating…" : "Create"}</button>
            </div>
          </div>
        </Modal>
      </>
    );
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Teams"
          subtitle={`${teams.length} teams`}
          action={<button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-soft"><Plus className="size-4" /> Team</button>}
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
              <button onClick={() => removeTeam(t.id)} disabled={pending} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-50" title="Delete team"><Trash2 className="size-4" /></button>
            </li>
          ))}
          {teams.length === 0 ? <li className="px-5 py-8 text-center text-sm text-slate-500">No teams yet.</li> : null}
        </ul>
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="New team">
        <div className="space-y-4">
          <div><label className={label}>Name</label><input className={input} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
          <div>
            <label className={label}>Department (optional)</label>
            <select className={input} value={teamDept} onChange={(e) => setTeamDept(e.target.value)}>
              <option value="">No department</option>
              {activeDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={create} disabled={pending || !name.trim()} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">{pending ? "Creating…" : "Create"}</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
