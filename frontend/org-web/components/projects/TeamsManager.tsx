"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, UserCog } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import type { ProjectPerson, TeamOverview } from "@/lib/api";

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
const label = "mb-1.5 block text-sm font-medium text-slate-700";
const CUSTOM = "__custom__";

type ProjectOption = { id: string; name: string; teamId: string | null };
type Form = { id: string | null; name: string; departmentId: string; leadEmployeeId: string; basedOnProjectId: string };

export function TeamsManager({ teams, people, departments, projects, canManage }: { teams: TeamOverview[]; people: ProjectPerson[]; departments: { id: string; name: string }[]; projects: ProjectOption[]; canManage: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<Form | null>(null);
  // "custom" = free text name; otherwise a projectId the team is based on.
  const [nameMode, setNameMode] = useState<string>(CUSTOM);
  const [members, setMembers] = useState<{ team: TeamOverview; selected: Set<string> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openNew = () => { setError(null); setNameMode(CUSTOM); setForm({ id: null, name: "", departmentId: "", leadEmployeeId: "", basedOnProjectId: "" }); };
  const openEdit = (t: TeamOverview) => { setError(null); setNameMode(CUSTOM); setForm({ id: t.id, name: t.name, departmentId: t.departmentId ?? "", leadEmployeeId: t.leadEmployeeId ?? "", basedOnProjectId: "" }); };
  const openMembers = (t: TeamOverview) => setMembers({ team: t, selected: new Set(people.filter((p) => p.teamId === t.id).map((p) => p.id)) });

  function pickBase(value: string) {
    setNameMode(value);
    if (!form) return;
    if (value === CUSTOM) { setForm({ ...form, basedOnProjectId: "", name: "" }); return; }
    const proj = projects.find((p) => p.id === value);
    setForm({ ...form, basedOnProjectId: value, name: proj?.name ?? form.name });
  }

  async function saveForm() {
    if (!form) return;
    setError(null);
    if (!form.name.trim()) { setError("Team name is required."); return; }
    const payload = { name: form.name.trim(), departmentId: form.departmentId || null, leadEmployeeId: form.leadEmployeeId || null };
    setBusy(true);
    try {
      const res = await fetch(form.id ? `/api/teams/${form.id}` : "/api/teams", { method: form.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { const d = (await res.json().catch(() => ({}))) as { error?: string }; setError(d.error ?? "Could not save team."); return; }
      // When based on a project, link that project to the new team.
      if (!form.id && form.basedOnProjectId) {
        const team = (await res.json().catch(() => ({}))) as { id?: string };
        if (team.id) await fetch(`/api/projects/${form.basedOnProjectId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamId: team.id }) });
      }
      setForm(null);
      router.refresh();
    } finally { setBusy(false); }
  }
  async function saveMembers() {
    if (!members) return;
    setBusy(true);
    try {
      await fetch(`/api/teams/${members.team.id}/members`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeIds: [...members.selected] }) });
      setMembers(null);
      router.refresh();
    } finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (typeof window !== "undefined" && !window.confirm("Delete this team? Members will be detached.")) return;
    await fetch(`/api/teams/${id}`, { method: "DELETE" });
    router.refresh();
  }

  // For the lead picker: employees currently on the team (or all, on create).
  const leadCandidates = useMemo(() => {
    if (!form?.id) return people;
    return people.filter((p) => p.teamId === form.id);
  }, [form, people]);

  return (
    <Card>
      <CardHeader title="Team performance" subtitle="Size, projects & task completion per team" action={canManage ? <button onClick={openNew} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-soft"><Plus className="size-3.5" /> New team</button> : undefined} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead><tr className="border-b border-hairline text-xs text-slate-500">
            <th className="px-5 py-3 text-left font-medium">Team</th>
            <th className="px-5 py-3 text-left font-medium">Department</th>
            <th className="px-5 py-3 text-left font-medium">Lead</th>
            <th className="px-5 py-3 text-right font-medium">Members</th>
            <th className="px-5 py-3 text-right font-medium">Active / Total</th>
            <th className="px-5 py-3 text-left font-medium">Completion</th>
            {canManage ? <th className="px-5 py-3 text-right font-medium">Manage</th> : null}
          </tr></thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                <td className="px-5 py-3 font-medium text-slate-900">{t.name}{t.memberNames.length ? <div className="mt-0.5 line-clamp-1 text-xs text-slate-400">{t.memberNames.join(", ")}</div> : null}</td>
                <td className="px-5 py-3 text-slate-600">{t.departmentName ?? "—"}</td>
                <td className="px-5 py-3 text-slate-600">{t.leadName ?? "—"}</td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-700">{t.size}</td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-600">{t.activeProjects} / {t.totalProjects}</td>
                <td className="px-5 py-3"><div className="flex items-center gap-2"><span className="block h-1.5 w-24 overflow-hidden rounded-full bg-panel-2"><span className="block h-full rounded-full bg-brand" style={{ width: `${t.progress}%` }} /></span><span className="tabular-nums text-xs text-slate-500">{t.progress}%</span></div></td>
                {canManage ? (
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-1">
                      <button title="Members" onClick={() => openMembers(t)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><UserCog className="size-4" /></button>
                      <button title="Edit" onClick={() => openEdit(t)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="size-3.5" /></button>
                      <button title="Delete" onClick={() => remove(t.id)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600"><Trash2 className="size-3.5" /></button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
            {teams.length === 0 ? <tr><td colSpan={canManage ? 7 : 6} className="px-5 py-10 text-center text-sm text-slate-500">No teams yet.{canManage ? " Create one to get started." : ""}</td></tr> : null}
          </tbody>
        </table>
      </div>

      <Modal open={Boolean(form)} onClose={() => setForm(null)} title={form?.id ? "Edit team" : "New team"}>
        {form ? (
          <div className="space-y-4">
            {!form.id ? (
              <div>
                <label className={label}>Base team on a project</label>
                <select className={input} value={nameMode} onChange={(e) => pickBase(e.target.value)}>
                  <option value={CUSTOM}>＋ Custom name…</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.teamId ? " (has a team)" : ""}</option>)}
                </select>
                <p className="mt-1 text-xs text-slate-400">Pick a project to create its team (and link the project), or choose “Custom name” to make a standalone team.</p>
              </div>
            ) : null}
            <div><label className={label}>Team name</label><input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Platform" /></div>
            <div><label className={label}>Department</label><select className={input} value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}><option value="">No department</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
            <div><label className={label}>Team lead</label><select className={input} value={form.leadEmployeeId} onChange={(e) => setForm({ ...form, leadEmployeeId: e.target.value })}><option value="">No lead</option>{leadCandidates.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>{form.id ? <p className="mt-1 text-xs text-slate-400">Leads are chosen from team members.</p> : null}</div>
            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
            <div className="flex justify-end gap-2"><button onClick={() => setForm(null)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button><button onClick={saveForm} disabled={busy} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">{busy ? "Saving…" : "Save"}</button></div>
          </div>
        ) : null}
      </Modal>

      <Modal open={Boolean(members)} onClose={() => setMembers(null)} title={members ? `Members · ${members.team.name}` : ""}>
        {members ? (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">Toggle who belongs to this team. An employee can only be on one team, so adding them here moves them from any other team.</p>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {people.map((p) => {
                const on = members.selected.has(p.id);
                return (
                  <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                    <input type="checkbox" checked={on} onChange={() => { const s = new Set(members.selected); if (on) s.delete(p.id); else s.add(p.id); setMembers({ ...members, selected: s }); }} />
                    <span className="text-sm text-slate-800">{p.name}</span>
                    {p.title ? <span className="text-xs text-slate-400">{p.title}</span> : null}
                    {p.teamId && p.teamId !== members.team.id ? <span className="ml-auto text-[10px] text-amber-600">on another team</span> : null}
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
