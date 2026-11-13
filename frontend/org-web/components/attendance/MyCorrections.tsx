"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { LocalTime } from "@/components/ui/LocalTime";
import { cn } from "@/lib/cn";
import type { AttendanceCorrection } from "@/lib/api";

const TYPES = [
  { key: "MISSED_CHECK_IN", label: "I forgot to check in", needs: "in" },
  { key: "MISSED_CHECK_OUT", label: "I forgot to check out", needs: "out" },
  { key: "WRONG_TIME", label: "The recorded time is wrong", needs: "both" },
  { key: "OVERTIME", label: "Claim overtime I worked", needs: "ot" },
  { key: "OTHER", label: "Something else", needs: "none" },
] as const;

const STATUS_TINT: Record<string, string> = {
  PENDING: "bg-amber-500/10 text-amber-700 ring-amber-600/20",
  APPROVED: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20",
  REJECTED: "bg-rose-500/10 text-rose-700 ring-rose-600/20",
  CANCELLED: "bg-slate-500/10 text-slate-500 ring-slate-500/20",
};

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
const label = "mb-1.5 block text-sm font-medium text-slate-700";
const btnPrimary = "inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60";
const btnGhost = "inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-panel-2";

const pill = (s: string) =>
  cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", STATUS_TINT[s] ?? "bg-panel-2 text-slate-600 ring-hairline");
const pretty = (t: string) => t.replace(/_/g, " ").toLowerCase();

/**
 * The employee's side of attendance corrections: raise a request for a day the
 * clock got wrong, and see where it stands. Nothing here edits attendance —
 * the request goes to their approver, who decides.
 */
export function MyCorrections({ initial, canRequest }: { initial: AttendanceCorrection[]; canRequest: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const [day, setDay] = useState(today);
  const [type, setType] = useState<string>("MISSED_CHECK_OUT");
  const [reason, setReason] = useState("");
  const [timeIn, setTimeIn] = useState("");
  const [timeOut, setTimeOut] = useState("");
  const [otMinutes, setOtMinutes] = useState("60");

  const needs = TYPES.find((t) => t.key === type)?.needs ?? "none";
  const hasPending = initial.some((c) => c.status === "PENDING");

  /** A local datetime-local value on the chosen day, as an ISO instant. */
  const isoFor = (hhmm: string) => (hhmm ? new Date(`${day}T${hhmm}:00`).toISOString() : undefined);

  async function submit() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { day, type, reason: reason.trim() };
    if (needs === "in" || needs === "both") body.checkInAt = isoFor(timeIn);
    if (needs === "out" || needs === "both") body.checkOutAt = isoFor(timeOut);
    if (needs === "ot") body.overtimeMinutes = Number(otMinutes) || undefined;

    const res = await fetch("/api/attendance/corrections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setError(d.error ?? "Could not raise the request.");
      return;
    }
    setOpen(false);
    setReason("");
    setTimeIn("");
    setTimeOut("");
    router.refresh();
  }

  async function withdraw(id: string) {
    setBusy(true);
    await fetch(`/api/attendance/corrections/${id}/cancel`, { method: "POST" });
    setBusy(false);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader
        title="Attendance corrections"
        subtitle="Ask your manager to fix a missed punch or approve overtime you worked"
        action={
          canRequest ? (
            <button type="button" onClick={() => setOpen(true)} disabled={hasPending} className={btnPrimary} title={hasPending ? "You already have a request awaiting a decision" : undefined}>
              <Plus className="size-4" /> Request a fix
            </button>
          ) : undefined
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-hairline text-xs text-slate-500">
              <th className="px-5 py-3 text-left font-medium">Day</th>
              <th className="px-5 py-3 text-left font-medium">Type</th>
              <th className="px-5 py-3 text-left font-medium">Asked for</th>
              <th className="px-5 py-3 text-left font-medium">Reason</th>
              <th className="px-5 py-3 text-left font-medium">Status</th>
              <th className="px-5 py-3 text-right font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {initial.map((c) => (
              <tr key={c.id} className="border-b border-hairline/60 last:border-0">
                <td className="px-5 py-3 tabular-nums text-slate-700">{c.day}</td>
                <td className="px-5 py-3 text-slate-600">{pretty(c.type)}</td>
                <td className="px-5 py-3 text-slate-600">
                  {c.requestedOvertimeMinutes ? `${c.requestedOvertimeMinutes} min OT` : null}
                  {c.requestedCheckInAt ? <>in <LocalTime iso={c.requestedCheckInAt} /> </> : null}
                  {c.requestedCheckOutAt ? <>out <LocalTime iso={c.requestedCheckOutAt} /></> : null}
                  {!c.requestedOvertimeMinutes && !c.requestedCheckInAt && !c.requestedCheckOutAt ? "—" : null}
                </td>
                <td className="px-5 py-3 text-slate-500">{c.reason}</td>
                <td className="px-5 py-3">
                  <span className={pill(c.status)}>{c.status.toLowerCase()}</span>
                  {c.decisionNote ? <span className="mt-0.5 block text-[11px] text-slate-400">{c.decisionNote}</span> : null}
                </td>
                <td className="px-5 py-3 text-right">
                  {c.status === "PENDING" ? (
                    <button onClick={() => withdraw(c.id)} disabled={busy} className={btnGhost}>
                      <X className="size-3.5" /> Withdraw
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {initial.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-500">No corrections raised.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Request an attendance fix">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Day</label>
              <input type="date" max={today} value={day} onChange={(e) => setDay(e.target.value)} className={input} />
            </div>
            <div>
              <label className={label}>What happened</label>
              <select value={type} onChange={(e) => setType(e.target.value)} className={input}>
                {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
          </div>

          {needs === "in" || needs === "both" ? (
            <div>
              <label className={label}>Actual check-in time</label>
              <input type="time" value={timeIn} onChange={(e) => setTimeIn(e.target.value)} className={input} />
            </div>
          ) : null}
          {needs === "out" || needs === "both" ? (
            <div>
              <label className={label}>Actual check-out time</label>
              <input type="time" value={timeOut} onChange={(e) => setTimeOut(e.target.value)} className={input} />
            </div>
          ) : null}
          {needs === "ot" ? (
            <div>
              <label className={label}>Overtime minutes</label>
              <input type="number" min={1} max={1440} value={otMinutes} onChange={(e) => setOtMinutes(e.target.value)} className={input} />
              <p className="mt-1 text-xs text-slate-500">Your manager can approve this or less — never more than the system measured.</p>
            </div>
          ) : null}

          <div>
            <label className={label}>Why</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Client meeting ran late" className={input} />
          </div>

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={submit} disabled={busy || reason.trim().length < 3} className={btnPrimary}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Send to my manager
            </button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
