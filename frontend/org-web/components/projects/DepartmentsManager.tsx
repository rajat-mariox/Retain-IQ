"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Pencil, Plus, UserCog } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import type { DepartmentOverview, ProjectPerson } from "@/lib/api";

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
const label = "mb-1.5 block text-sm font-medium text-slate-700";

type Form = { id: string | null; name: string; leadEmployeeId: string };

export function DepartmentsManager({ departments, people, canManage }: { departments: DepartmentOverview[]; people: ProjectPerson[]; canManage: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<Form | null>(null);
  const [members, setMembers] = useState<{ dept: DepartmentOverview; selected: Set<string> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openNew = () => { setError(null); setForm({ id: null, name: "", leadEmployeeId: "" }); };
  const openEdit = (d: DepartmentOverview) => { setError(null); setForm({ id: d.id, name: d.name, leadEmployeeId: d.leadEmployeeId ?? "" }); };
  const openMembers = (d: DepartmentOverview) => setMembers({ dept: d, selected: new Set(people.filter((p) => p.departmentId === d.id).map((p) => p.id)) });

  async function saveForm() {
    if (!form) return;
    setError(null);
    if (!form.name.trim()) { setError("Department name is required."); return; }
    const payload = form.id ? { name: form.name.trim(), leadEmployeeId: form.leadEmployeeId || null } : { name: form.name.trim() };
    setBusy(true);
    try {
      const res = await fetch(form.id ? `/api/departments/${form.id}` : "/api/departments", { method: form.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { const d = (await res.json().catch(() => ({}))) as { error?: string }; setError(d.error ?? "Could not save department."); return; }
      setForm(null);
      router.refresh();
    } finally { setBusy(false); }
  }
  async function saveMembers() {
    if (!members) return;
    setBusy(true);
    try {
      await fetch(`/api/departments/${members.dept.id}/members`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeIds: [...members.selected] }) });
      setMembers(null);
      router.refresh();
    } finally { setBusy(false); }
  }
  async function archive(id: string) {
    if (typeof window !== "undefined" && !window.confirm("Archive this department?")) return;
    await fetch(`/api/departments/${id}`, { method: "DELETE" });
    router.refresh();
  }

  const leadCandidates = useMemo(() => (form?.id ? people.filter((p) => p.departmentId === form.id) : people), [form, people]);

  return (
    <Card>
      <CardHeader title="Department productivity" subtitle="Headcount, teams, projects & task completion" action={canManage ? <button onClick={openNew} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-soft"><Plus className="size-3.5" /> New department</button> : undefined} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead><tr className="border-b border-hairline text-xs text-slate-500">
            <th className="px-5 py-3 text-left font-medium">Department</th>
            <th className="px-5 py-3 text-right font-medium">Employees</th>
            <th className="px-5 py-3 text-right font-medium">Teams</th>
            <th className="px-5 py-3 text-right font-medium">Active / Total projects</th>
            <th className="px-5 py-3 text-right font-medium">Tasks</th>
            <th className="px-5 py-3 text-left font-medium">Productivity</th>
            {canManage ? <th className="px-5 py-3 text-right font-medium">Manage</th> : null}
          </tr></thead>
          <tbody>
            {departments.map((d) => (
              <tr key={d.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                <td className="px-5 py-3 font-medium text-slate-900">{d.name}{d.status !== "ACTIVE" ? <span className="ml-2 rounded bg-slate-100 px-1.5 text-[10px] text-slate-500">{d.status.toLowerCase()}</span> : null}</td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-700">{d.employees}</td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-600">{d.teams}</td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-600">{d.activeProjects} / {d.projects}</td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-600">{d.doneTasks}/{d.totalTasks}</td>
                <td className="px-5 py-3"><div className="flex items-center gap-2"><span className="block h-1.5 w-24 overflow-hidden rounded-full bg-panel-2"><span className="block h-full rounded-full bg-brand" style={{ width: `${d.productivity}%` }} /></span><span className="tabular-nums text-xs text-slate-500">{d.productivity}%</span></div></td>
                {canManage ? (
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-1">
                      <button title="Members" onClick={() => openMembers(d)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><UserCog className="size-4" /></button>
                      <button title="Edit" onClick={() => openEdit(d)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="size-3.5" /></button>
                      <button title="Archive" onClick={() => archive(d.id)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600"><Archive className="size-3.5" /></button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
            {departments.length === 0 ? <tr><td colSpan={canManage ? 7 : 6} className="px-5 py-10 text-center text-sm text-slate-500">No departments yet.{canManage ? " Create one to get started." : ""}</td></tr> : null}
          </tbody>
        </table>
      </div>

      <Modal open={Boolean(form)} onClose={() => setForm(null)} title={form?.id ? "Edit department" : "New department"}>
        {form ? (
          <div className="space-y-4">
            <div><label className={label}>Department name</label><input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Engineering" /></div>
            {form.id ? <div><label className={label}>Department lead</label><select className={input} value={form.leadEmployeeId} onChange={(e) => setForm({ ...form, leadEmployeeId: e.target.value })}><option value="">No lead</option>{leadCandidates.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><p className="mt-1 text-xs text-slate-400">Leads are chosen from department members.</p></div> : null}
            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
            <div className="flex justify-end gap-2"><button onClick={() => setForm(null)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button><button onClick={saveForm} disabled={busy} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">{busy ? "Saving…" : "Save"}</button></div>
          </div>
        ) : null}
      </Modal>

      <Modal open={Boolean(members)} onClose={() => setMembers(null)} title={members ? `Members · ${members.dept.name}` : ""}>
        {members ? (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">Toggle who belongs to this department. An employee can only be in one department.</p>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {people.map((p) => {
                const on = members.selected.has(p.id);
                return (
                  <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                    <input type="checkbox" checked={on} onChange={() => { const s = new Set(members.selected); if (on) s.delete(p.id); else s.add(p.id); setMembers({ ...members, selected: s }); }} />
                    <span className="text-sm text-slate-800">{p.name}</span>
                    {p.title ? <span className="text-xs text-slate-400">{p.title}</span> : null}
                    {p.departmentId && p.departmentId !== members.dept.id ? <span className="ml-auto text-[10px] text-amber-600">in another dept</span> : null}
                  </label>
                );
              })}
              {people.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">No employees to assign.</p> : null}
            </div>
            <div className="flex items-center justify-between"><span className="text-xs text-slate-500">{members.selected.size} selected</span><div className="flex gap-2"><button onClick={() => setMembers(null)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button><button onClick={saveMembers} disabled={busy} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">{busy ? "Saving…" : "Save members"}</button></div></div>
          </div>
        ) : null}
      </Modal>
    </Card>
  );
}
