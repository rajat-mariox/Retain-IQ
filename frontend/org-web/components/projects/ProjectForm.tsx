"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import type { ProjectDetail, ProjectPerson, ProjectSettings, ProjectSummary, ProjectTeamOption } from "@/lib/api";

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
const label = "mb-1.5 block text-sm font-medium text-slate-700";
const FALLBACK_STATUSES = [
  { key: "PLANNING", label: "Planning" },
  { key: "ACTIVE", label: "Active" },
  { key: "ON_HOLD", label: "On hold" },
  { key: "COMPLETED", label: "Completed" },
  { key: "ARCHIVED", label: "Archived" },
];
const toIso = (d: string) => (d ? new Date(`${d}T00:00:00.000Z`).toISOString() : null);

type Editable = ProjectSummary | ProjectDetail;

export function ProjectForm({
  open,
  onClose,
  project,
  people,
  teams,
  settings,
}: {
  open: boolean;
  onClose: () => void;
  project?: Editable | null;
  people: ProjectPerson[];
  teams: ProjectTeamOption[];
  settings?: ProjectSettings | null;
}) {
  const router = useRouter();
  const editing = Boolean(project);
  const statusOptions = settings?.statuses?.length ? settings.statuses : FALLBACK_STATUSES;
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [status, setStatus] = useState(project?.status ?? settings?.defaultProjectStatus ?? "ACTIVE");
  const [ownerEmployeeId, setOwner] = useState(project?.ownerEmployeeId ?? "");
  const [teamId, setTeamId] = useState(project?.teamId ?? "");
  const [startDate, setStartDate] = useState(project?.startDate?.slice(0, 10) ?? "");
  const [dueDate, setDueDate] = useState(project?.dueDate?.slice(0, 10) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!name.trim()) { setError("Project name is required."); return; }
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      status,
      ownerEmployeeId: ownerEmployeeId || null,
      teamId: teamId || null,
      startDate: toIso(startDate),
      dueDate: toIso(dueDate),
    };
    setBusy(true);
    try {
      const res = await fetch(editing ? `/api/projects/${project!.id}` : "/api/projects", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const d = (await res.json().catch(() => ({}))) as { error?: string }; setError(d.error ?? "Could not save project."); return; }
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit project" : "New project"} size="lg">
      <div className="space-y-4">
        <div><label className={label}>Project name</label><input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3 Website Revamp" /></div>
        <div><label className={label}>Description</label><textarea rows={2} className={input} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this project about?" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Status</label>
            <select className={input} value={status} onChange={(e) => setStatus(e.target.value)}>{statusOptions.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
          </div>
          <div>
            <label className={label}>Owner</label>
            <select className={input} value={ownerEmployeeId} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Unassigned</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Team</label>
            <select className={input} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">No team</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Start</label><input type="date" className={input} value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
            <div><label className={label}>Due</label><input type="date" className={input} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          </div>
        </div>
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={busy} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">{busy ? "Saving…" : editing ? "Save changes" : "Create project"}</button>
        </div>
      </div>
    </Modal>
  );
}
