"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, Trash2, X } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import type { OrgShift, ShiftRotation } from "@/lib/api";

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
const label = "mb-1.5 block text-sm font-medium text-slate-700";

const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * Rotating shift schedules — an ordered list of shifts, each held for N days,
 * repeating on a fixed cycle. Employees assigned a rotation get the shift the
 * schedule lands on for the day (assignment is done in the employee edit form).
 */
export function RotationsView({ rotations, shifts }: { rotations: ShiftRotation[]; shifts: OrgShift[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [anchor, setAnchor] = useState(todayISO());
  const [steps, setSteps] = useState<{ shiftId: string; days: number }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const activeShifts = shifts.filter((s) => s.status === "ACTIVE");
  const shiftName = (id: string) => shifts.find((s) => s.id === id)?.name ?? "—";
  const cycleLength = steps.reduce((sum, s) => sum + (Number(s.days) || 0), 0);

  const resetForm = () => {
    setName("");
    setAnchor(todayISO());
    setSteps(activeShifts.length >= 2 ? [{ shiftId: activeShifts[0].id, days: 7 }, { shiftId: activeShifts[1].id, days: 7 }] : []);
    setError(null);
  };
  const openNew = () => { resetForm(); setOpen(true); };

  const addStep = () => setSteps((prev) => [...prev, { shiftId: activeShifts[0]?.id ?? "", days: 7 }]);
  const setStep = (i: number, patch: Partial<{ shiftId: string; days: number }>) => setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const removeStep = (i: number) => setSteps((prev) => prev.filter((_, idx) => idx !== i));

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

  const create = () => {
    if (name.trim().length < 1) { setError("Give the rotation a name."); return; }
    if (steps.length < 2) { setError("A rotation needs at least two steps."); return; }
    if (steps.some((s) => !s.shiftId || !(Number(s.days) > 0))) { setError("Each step needs a shift and at least 1 day."); return; }
    run(
      () => fetch("/api/shift-rotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), anchorDate: anchor, steps: steps.map((s) => ({ shiftId: s.shiftId, days: Number(s.days) })) }),
      }),
      () => setOpen(false),
    );
  };

  const archive = (id: string) => {
    if (typeof window !== "undefined" && !window.confirm("Archive this rotation? Employees on it will fall back to their fixed shift.")) return;
    run(() => fetch(`/api/shift-rotations/${id}`, { method: "DELETE" }), () => undefined);
  };

  return (
    <Card>
      <CardHeader
        title="Shift rotations"
        subtitle="Rotate people through shifts on a repeating cycle (e.g. a week of mornings, then a week of evenings)"
        action={
          <button onClick={openNew} disabled={activeShifts.length < 2} title={activeShifts.length < 2 ? "Create at least two shifts first" : undefined} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-50">
            <Plus className="size-4" /> New rotation
          </button>
        }
      />
      {rotations.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-slate-500">
          {activeShifts.length < 2 ? "Create at least two shifts, then build a rotation between them." : "No rotations yet. Create one to cycle people through shifts."}
        </p>
      ) : (
        <ul className="divide-y divide-hairline/60">
          {rotations.map((r) => {
            const cycle = r.steps.reduce((sum, s) => sum + s.days, 0);
            return (
              <li key={r.id} className="flex items-start justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium text-slate-900"><RefreshCw className="size-4 text-slate-400" /> {r.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {r.steps.map((s, i) => `${shiftName(s.shiftId)} ${s.days}d`).join(" → ")} · {cycle}-day cycle · from {r.anchorDate} · {r.employeeCount} assigned
                  </p>
                </div>
                <button onClick={() => archive(r.id)} disabled={pending} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-50" title="Archive"><Trash2 className="size-4" /></button>
              </li>
            );
          })}
        </ul>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New shift rotation" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>Rotation name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Support 2-shift" className={input} />
            </div>
            <div>
              <label className={label}>Cycle starts on</label>
              <input type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} className={input} />
              <p className="mt-1 text-xs text-slate-500">Day 1 of the pattern.</p>
            </div>
          </div>

          <div>
            <label className={label}>Rotation steps <span className="font-normal text-slate-400">· {cycleLength}-day cycle</span></label>
            <div className="space-y-2">
              {steps.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-panel-2 text-xs font-semibold text-slate-500">{i + 1}</span>
                  <select value={s.shiftId} onChange={(e) => setStep(i, { shiftId: e.target.value })} className={`${input} flex-1`}>
                    {activeShifts.map((sh) => <option key={sh.id} value={sh.id}>{sh.name}</option>)}
                  </select>
                  <div className="flex items-center gap-1.5">
                    <input type="number" min={1} max={60} value={s.days} onChange={(e) => setStep(i, { days: Number(e.target.value) })} className={`${input} w-20`} />
                    <span className="text-sm text-slate-500">days</span>
                  </div>
                  <button onClick={() => removeStep(i)} disabled={steps.length <= 2} className="rounded p-1.5 text-slate-400 hover:text-rose-600 disabled:opacity-30" title="Remove step"><X className="size-4" /></button>
                </div>
              ))}
            </div>
            <button onClick={addStep} className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"><Plus className="size-4" /> Add step</button>
          </div>

          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 ring-1 ring-inset ring-rose-200">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={create} disabled={pending} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">{pending ? "Creating…" : "Create rotation"}</button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
