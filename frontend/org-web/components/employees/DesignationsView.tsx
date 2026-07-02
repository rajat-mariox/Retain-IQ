"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Plus, Trash2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import type { OrgDepartment, OrgDesignation } from "@/lib/api";

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
const label = "mb-1.5 block text-sm font-medium text-slate-700";

export function DesignationsView({ designations, departments }: { designations: OrgDesignation[]; departments: OrgDepartment[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [level, setLevel] = useState("");
  const [deptId, setDeptId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const activeDepts = departments.filter((d) => d.status !== "ARCHIVED");

  function create() {
    setError(null);
    start(async () => {
      const res = await fetch("/api/designations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, level: level || null, departmentId: deptId || null }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "Could not create designation.");
        return;
      }
      setOpen(false);
      setTitle("");
      setLevel("");
      setDeptId("");
      router.refresh();
    });
  }

  function archive(id: string) {
    start(async () => {
      await fetch(`/api/designations/${id}`, { method: "DELETE" });
      router.refresh();
    });
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Designations"
          subtitle={`${designations.filter((d) => d.status !== "ARCHIVED").length} active job titles`}
          action={
            <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-soft">
              <Plus className="size-4" /> Designation
            </button>
          }
        />
        <ul className="divide-y divide-hairline/60">
          {designations.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <span className="flex items-center gap-2.5 text-sm">
                <span className="grid size-8 place-items-center rounded-lg bg-panel-2 text-slate-500 ring-1 ring-inset ring-hairline"><BadgeCheck className="size-4" /></span>
                <span>
                  <span className="font-medium text-slate-900">{d.title}</span>
                  {d.level ? <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">{d.level}</span> : null}
                  {d.status === "ARCHIVED" ? <span className="ml-2 text-[11px] text-slate-400">archived</span> : null}
                  <span className="block text-xs text-slate-500">{d.departmentName ?? "All departments"} · {d.employeeCount} {d.employeeCount === 1 ? "person" : "people"}</span>
                </span>
              </span>
              {d.status !== "ARCHIVED" ? (
                <button onClick={() => archive(d.id)} disabled={pending} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-50" title="Archive">
                  <Trash2 className="size-4" />
                </button>
              ) : null}
            </li>
          ))}
          {designations.length === 0 ? <li className="px-5 py-8 text-center text-sm text-slate-500">No designations yet.</li> : null}
        </ul>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="New designation">
        <div className="space-y-4">
          <div>
            <label className={label}>Job title</label>
            <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Software Engineer" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Level (optional)</label>
              <input className={input} value={level} onChange={(e) => setLevel(e.target.value)} placeholder="e.g. L3 / Senior" />
            </div>
            <div>
              <label className={label}>Department (optional)</label>
              <select className={input} value={deptId} onChange={(e) => setDeptId(e.target.value)}>
                <option value="">All departments</option>
                {activeDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={create} disabled={pending || !title.trim()} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">{pending ? "Creating…" : "Create"}</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
