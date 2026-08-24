"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock, Plus, Star, Trash2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import type { OrgShift } from "@/lib/api";

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
const label = "mb-1.5 block text-sm font-medium text-slate-700";

const minToTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const timeToMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function formatDays(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) return "Every day";
  if (sorted.join(",") === "1,2,3,4,5") return "Mon–Fri";
  if (sorted.join(",") === "1,2,3,4,5,6") return "Mon–Sat";
  return sorted.map((d) => DOW[d]).join(", ");
}

export function ShiftsView({ shifts }: { shifts: OrgShift[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [startT, setStartT] = useState("09:00");
  const [endT, setEndT] = useState("17:30");
  const [grace, setGrace] = useState("10");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [breaks, setBreaks] = useState<{ name: string; start: string; end: string }[]>([]);
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-weekday custom hours. Off = uniform start/end above. On = each working
  // day gets its own window (seeded from the flat times).
  const [perDay, setPerDay] = useState(false);
  const [dayHours, setDayHours] = useState<Record<number, { start: string; end: string }>>({});
  const setDayHour = (d: number, patch: Partial<{ start: string; end: string }>) =>
    setDayHours((prev) => ({ ...prev, [d]: { start: prev[d]?.start ?? startT, end: prev[d]?.end ?? endT, ...patch } }));

  const toggleDay = (d: number) => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  const addBreak = () => setBreaks((prev) => [...prev, { name: prev.length === 0 ? "Lunch" : "Break", start: "13:00", end: "13:45" }]);
  const setBreak = (i: number, patch: Partial<{ name: string; start: string; end: string }>) => setBreaks((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  const removeBreak = (i: number) => setBreaks((prev) => prev.filter((_, idx) => idx !== i));

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
        fetch("/api/shifts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            startMinute: timeToMin(startT),
            endMinute: timeToMin(endT),
            graceMinutes: Math.max(0, Number(grace) || 0),
            workingDays: [...days].sort((a, b) => a - b),
            daySchedule: perDay
              ? [...days]
                  .sort((a, b) => a - b)
                  .map((d) => ({ day: d, startMinute: timeToMin(dayHours[d]?.start ?? startT), endMinute: timeToMin(dayHours[d]?.end ?? endT) }))
              : null,
            breaks: breaks.map((b) => ({ name: b.name.trim() || "Break", startMinute: timeToMin(b.start), endMinute: timeToMin(b.end) })).filter((b) => b.endMinute > b.startMinute),
            isDefault,
          }),
        }),
      () => {
        setOpen(false);
        setName("");
        setStartT("09:00");
        setEndT("17:30");
        setGrace("10");
        setDays([1, 2, 3, 4, 5]);
        setBreaks([]);
        setIsDefault(false);
        setPerDay(false);
        setDayHours({});
      },
    );
  const makeDefault = (id: string) => run(() => fetch(`/api/shifts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isDefault: true }) }), () => undefined);
  const archive = (id: string) => run(() => fetch(`/api/shifts/${id}`, { method: "DELETE" }), () => undefined);

  return (
    <>
      <Card>
        <CardHeader
          title="Shifts"
          subtitle="Work schedules — late & early-exit are measured against each employee's shift"
          action={<button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-soft"><Plus className="size-4" /> Shift</button>}
        />
        <ul className="divide-y divide-hairline/60">
          {shifts.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <span className="flex items-center gap-2.5 text-sm">
                <span className="grid size-8 place-items-center rounded-lg bg-panel-2 text-slate-500 ring-1 ring-inset ring-hairline"><Clock className="size-4" /></span>
                <span>
                  <span className="font-medium text-slate-900">{s.name}</span>
                  {s.isDefault ? <span className="ml-2 inline-flex items-center gap-1 rounded bg-brand/10 px-1.5 py-0.5 text-[11px] font-medium text-brand"><Star className="size-3" /> default</span> : null}
                  {s.status === "ARCHIVED" ? <span className="ml-2 text-[11px] text-slate-400">archived</span> : null}
                  {(s.daySchedule?.length ?? 0) > 0 ? <span className="ml-2 inline-flex items-center rounded bg-panel-2 px-1.5 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-inset ring-hairline">custom hours</span> : null}
                  <span className="block text-xs text-slate-500">{minToTime(s.startMinute)}–{minToTime(s.endMinute)}{s.endMinute <= s.startMinute ? " (+1d)" : ""} · {formatDays(s.workingDays)} · {s.graceMinutes}m grace{(s.breaks?.length ?? 0) > 0 ? ` · ${s.breaks.reduce((t, b) => t + (b.endMinute - b.startMinute), 0)}m break` : ""} · {s.employeeCount} assigned</span>
                  {(s.daySchedule?.length ?? 0) > 0 ? <span className="mt-0.5 block text-[11px] text-slate-400">{s.daySchedule!.map((d) => `${DOW[d.day]} ${minToTime(d.startMinute)}–${minToTime(d.endMinute)}`).join(" · ")}</span> : null}
                  {(s.breaks?.length ?? 0) > 0 ? <span className="mt-0.5 block text-[11px] text-slate-400">{s.breaks.map((b) => `${b.name} ${minToTime(b.startMinute)}–${minToTime(b.endMinute)}`).join(" · ")}</span> : null}
                </span>
              </span>
              {s.status !== "ARCHIVED" ? (
                <div className="flex items-center gap-1">
                  {!s.isDefault ? <button onClick={() => makeDefault(s.id)} disabled={pending} className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50">Set default</button> : null}
                  {!s.isDefault ? <button onClick={() => archive(s.id)} disabled={pending} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-50" title="Archive"><Trash2 className="size-4" /></button> : null}
                </div>
              ) : null}
            </li>
          ))}
          {shifts.length === 0 ? <li className="px-5 py-8 text-center text-sm text-slate-500">No shifts yet.</li> : null}
        </ul>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="New shift">
        <div className="space-y-4">
          <div><label className={label}>Name</label><input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. General, Night, Early" autoFocus /></div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className={label}>Start</label><input type="time" className={input} value={startT} onChange={(e) => setStartT(e.target.value)} /></div>
            <div><label className={label}>End</label><input type="time" className={input} value={endT} onChange={(e) => setEndT(e.target.value)} /></div>
            <div><label className={label}>Grace (min)</label><input type="number" min={0} className={input} value={grace} onChange={(e) => setGrace(e.target.value)} /></div>
          </div>
          <div>
            <label className={label}>Working days</label>
            <div className="flex flex-wrap gap-1.5">
              {DOW.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(i)}
                  className={`w-11 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${days.includes(i) ? "border-brand bg-brand/10 text-brand" : "border-hairline bg-panel text-slate-500 hover:bg-slate-50"}`}
                >
                  {d}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-400">Late/absent are measured only on these days. Overnight shifts (end ≤ start) are supported.</p>
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={perDay} onChange={(e) => setPerDay(e.target.checked)} className="size-4 rounded border-hairline text-brand focus:ring-brand" />
              Custom hours per day
            </label>
            {perDay ? (
              days.length === 0 ? (
                <p className="mt-1.5 text-xs text-slate-400">Pick working days above to set their hours.</p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {[...days].sort((a, b) => a - b).map((d) => (
                    <div key={d} className="flex items-center gap-2">
                      <span className="w-10 text-xs font-medium text-slate-600">{DOW[d]}</span>
                      <input type="time" className={`${input} w-28`} value={dayHours[d]?.start ?? startT} onChange={(e) => setDayHour(d, { start: e.target.value })} />
                      <span className="text-xs text-slate-400">to</span>
                      <input type="time" className={`${input} w-28`} value={dayHours[d]?.end ?? endT} onChange={(e) => setDayHour(d, { end: e.target.value })} />
                    </div>
                  ))}
                  <p className="mt-1 text-xs text-slate-400">Each day uses its own window; days left blank fall back to the shift start/end above.</p>
                </div>
              )
            ) : null}
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className={`${label} mb-0`}>Breaks</label>
              <button type="button" onClick={addBreak} className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-panel px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"><Plus className="size-3.5" /> Add break</button>
            </div>
            {breaks.length === 0 ? (
              <p className="text-xs text-slate-400">No breaks — add lunch/dinner/tea. Break time is deducted from worked hours.</p>
            ) : (
              <div className="space-y-2">
                {breaks.map((b, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input className={`${input} flex-1`} value={b.name} onChange={(e) => setBreak(i, { name: e.target.value })} placeholder="e.g. Lunch" />
                    <input type="time" className={`${input} w-28`} value={b.start} onChange={(e) => setBreak(i, { start: e.target.value })} />
                    <input type="time" className={`${input} w-28`} value={b.end} onChange={(e) => setBreak(i, { end: e.target.value })} />
                    <button type="button" onClick={() => removeBreak(i)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600" title="Remove"><Trash2 className="size-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="size-4 rounded border-hairline text-brand focus:ring-brand" />
            Set as default shift for the organization
          </label>
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
