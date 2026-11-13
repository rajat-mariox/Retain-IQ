"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, Loader2, X } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { LocalTime } from "@/components/ui/LocalTime";
import type { AttendanceCorrection, PendingOvertime } from "@/lib/api";

const btnApprove = "inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50";
const btnReject = "inline-flex items-center gap-1 rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50";
const numInput = "w-20 rounded-lg border border-hairline bg-panel px-2 py-1 text-xs text-slate-900 focus:border-brand focus:outline-none";

const pretty = (t: string) => t.replace(/_/g, " ").toLowerCase();
const hhmm = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;

/**
 * The approver's queue. Both lists are already scoped server-side to the
 * people this approver has reach over — a manager sees their reports, the
 * Owner sees anyone with no manager of their own — so nothing here re-filters.
 */
export function ApprovalQueue({
  corrections,
  overtime,
}: {
  corrections: AttendanceCorrection[];
  overtime: PendingOvertime[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Multi-select for bulk approve/reject of corrections.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allSelected = corrections.length > 0 && selected.size === corrections.length;
  const toggle = (id: string) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(corrections.map((c) => c.id)));
  // Approvers may grant less overtime than was measured; seeded with the full amount.
  const [grant, setGrant] = useState<Record<string, string>>(
    Object.fromEntries(overtime.map((o) => [o.attendanceId, String(o.overtimeMinutes)])),
  );

  async function post(url: string, body?: unknown, key?: string) {
    setBusy(key ?? url);
    setError(null);
    const res = await fetch(url, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setError(d.error ?? "That didn't work.");
    }
    setBusy(null);
    router.refresh();
  }

  async function bulkDecide(approve: boolean) {
    if (selected.size === 0) return;
    setBusy("bulk");
    setError(null);
    const res = await fetch(`/api/attendance/corrections/bulk-decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selected], approve }),
    });
    const d = (await res.json().catch(() => ({}))) as { skipped?: { reason: string }[]; error?: string };
    if (!res.ok) setError(d.error ?? "That didn't work.");
    else if (d.skipped?.length) setError(`${d.skipped.length} could not be decided (${d.skipped[0]!.reason}).`);
    setSelected(new Set());
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 ring-1 ring-inset ring-rose-200">{error}</p> : null}

      <Card>
        <CardHeader
          title="Attendance corrections"
          subtitle={`${corrections.length} awaiting your decision`}
          action={
            selected.size > 0 ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">{selected.size} selected</span>
                <button onClick={() => bulkDecide(true)} disabled={busy !== null} className={btnApprove}>
                  {busy === "bulk" ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Approve selected
                </button>
                <button onClick={() => bulkDecide(false)} disabled={busy !== null} className={btnReject}>
                  <X className="size-3.5" /> Reject selected
                </button>
              </div>
            ) : null
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-sm">
            <thead>
              <tr className="border-b border-hairline text-xs text-slate-500">
                <th className="w-10 px-5 py-3 text-left font-medium">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all corrections" className="size-3.5 accent-emerald-600" />
                </th>
                <th className="px-5 py-3 text-left font-medium">Employee</th>
                <th className="px-5 py-3 text-left font-medium">Day</th>
                <th className="px-5 py-3 text-left font-medium">Type</th>
                <th className="px-5 py-3 text-left font-medium">Asked for</th>
                <th className="px-5 py-3 text-left font-medium">Reason</th>
                <th className="px-5 py-3 text-right font-medium">Decision</th>
              </tr>
            </thead>
            <tbody>
              {corrections.map((c) => (
                <tr key={c.id} className={`border-b border-hairline/60 last:border-0 hover:bg-slate-50 ${selected.has(c.id) ? "bg-emerald-50/50" : ""}`}>
                  <td className="px-5 py-3">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select correction for ${c.employeeName ?? "employee"}`} className="size-3.5 accent-emerald-600" />
                  </td>
                  <td className="px-5 py-3 font-medium text-slate-900">{c.employeeName ?? "—"}</td>
                  <td className="px-5 py-3 tabular-nums text-slate-600">{c.day}</td>
                  <td className="px-5 py-3 text-slate-600">{pretty(c.type)}</td>
                  <td className="px-5 py-3 text-slate-600">
                    {c.requestedOvertimeMinutes ? `${c.requestedOvertimeMinutes} min OT` : null}
                    {c.requestedCheckInAt ? <>in <LocalTime iso={c.requestedCheckInAt} /> </> : null}
                    {c.requestedCheckOutAt ? <>out <LocalTime iso={c.requestedCheckOutAt} /></> : null}
                    {!c.requestedOvertimeMinutes && !c.requestedCheckInAt && !c.requestedCheckOutAt ? "—" : null}
                  </td>
                  <td className="px-5 py-3 text-slate-500">{c.reason}</td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => post(`/api/attendance/corrections/${c.id}/decision`, { approve: true }, c.id)} disabled={busy !== null} className={btnApprove}>
                        {busy === c.id ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Approve
                      </button>
                      <button onClick={() => post(`/api/attendance/corrections/${c.id}/decision`, { approve: false }, c.id)} disabled={busy !== null} className={btnReject}>
                        <X className="size-3.5" /> Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {corrections.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-slate-500">Nothing to review.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Overtime awaiting sign-off"
          subtitle="Measured overtime isn't payable until you approve it — you can grant less, never more"
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-hairline text-xs text-slate-500">
                <th className="px-5 py-3 text-left font-medium">Employee</th>
                <th className="px-5 py-3 text-left font-medium">Day</th>
                <th className="px-5 py-3 text-left font-medium">Worked</th>
                <th className="px-5 py-3 text-left font-medium">Hours</th>
                <th className="px-5 py-3 text-right font-medium">Measured OT</th>
                <th className="px-5 py-3 text-right font-medium">Approve</th>
              </tr>
            </thead>
            <tbody>
              {overtime.map((o) => (
                <tr key={o.attendanceId} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-900">{o.employeeName ?? "—"}</td>
                  <td className="px-5 py-3 tabular-nums text-slate-600">{o.day}</td>
                  <td className="px-5 py-3 tabular-nums text-slate-600">{hhmm(o.workMinutes)}</td>
                  <td className="px-5 py-3 text-xs text-slate-500">
                    <LocalTime iso={o.checkInAt} /> → <LocalTime iso={o.checkOutAt} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span className="inline-flex items-center gap-1 font-medium text-amber-600">
                      <Clock className="size-3.5" /> {hhmm(o.overtimeMinutes)}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <input
                        type="number"
                        min={0}
                        max={o.overtimeMinutes}
                        value={grant[o.attendanceId] ?? String(o.overtimeMinutes)}
                        onChange={(e) => setGrant((g) => ({ ...g, [o.attendanceId]: e.target.value }))}
                        className={numInput}
                      />
                      <span className="text-xs text-slate-400">min</span>
                      <button
                        onClick={() =>
                          post(`/api/attendance/overtime/${o.attendanceId}/approve`, { minutes: Number(grant[o.attendanceId] ?? o.overtimeMinutes) }, o.attendanceId)
                        }
                        disabled={busy !== null}
                        className={btnApprove}
                      >
                        {busy === o.attendanceId ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Approve
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {overtime.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-500">No overtime awaiting sign-off.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
