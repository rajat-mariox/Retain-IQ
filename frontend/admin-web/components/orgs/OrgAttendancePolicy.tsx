"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";

export interface AttendancePolicy {
  allowMultipleSessions: boolean;
  allowReEntry: boolean;
  maxSessionsPerDay: number;
  maxBreaksPerDay: number;
  maxBreakMinutesPerDay: number;
  maxSingleBreakMinutes: number;
  paidBreakMinutesPerDay: number;
  allowCheckOutOnBreak: boolean;
  graceMinutes: number;
  autoCheckOutAtShiftEnd: boolean;
  autoCheckOutAfterMinutes: number;
  overtimeAfterMinutes: number;
  minHoursForPresent: number;
  workModel: string;
  allowedLocations: string[];
  requireLocation: boolean;
  allowManualCorrection: boolean;
}

const LOCATIONS = ["OFFICE", "HOME", "CLIENT_SITE", "REMOTE"];
const input =
  "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
const label = "mb-1 block text-xs font-medium text-slate-600";

/**
 * Attendance rules for one tenant — platform-owned, not editable by the org's
 * own owner. Grouped the way an operator thinks about them: how the day may be
 * structured, how breaks behave, and how the system closes an unfinished day.
 */
export function OrgAttendancePolicy({
  orgId,
  orgName,
  configured,
  initial,
}: {
  orgId: string;
  orgName: string;
  configured: boolean;
  initial: AttendancePolicy;
}) {
  const router = useRouter();
  const [p, setP] = useState<AttendancePolicy>(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof AttendancePolicy>(k: K, v: AttendancePolicy[K]) => setP((prev) => ({ ...prev, [k]: v }));

  const toggleLocation = (loc: string) =>
    setP((prev) => ({
      ...prev,
      allowedLocations: prev.allowedLocations.includes(loc)
        ? prev.allowedLocations.filter((l) => l !== loc)
        : [...prev.allowedLocations, loc],
    }));

  const save = () =>
    start(async () => {
      setError(null);
      setMsg(null);
      if (p.allowedLocations.length === 0) {
        setError("Pick at least one work location.");
        return;
      }
      const res = await fetch(`/api/admin/organizations/${orgId}/attendance-policy`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(p),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(d?.error?.message ?? "Could not save the policy.");
        return;
      }
      setMsg("Attendance policy saved.");
      router.refresh();
    });

  const Toggle = ({ k, title, hint }: { k: keyof AttendancePolicy; title: string; hint: string }) => (
    <label className="flex items-start gap-2.5 rounded-lg border border-hairline bg-panel-2 px-3 py-2.5">
      <input
        type="checkbox"
        checked={Boolean(p[k])}
        onChange={(e) => set(k, e.target.checked as AttendancePolicy[typeof k])}
        className="mt-0.5 size-4 rounded border-hairline text-brand focus:ring-brand"
      />
      <span>
        <span className="block text-sm font-medium text-slate-800">{title}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
    </label>
  );

  const Num = ({ k, title, hint, max }: { k: keyof AttendancePolicy; title: string; hint: string; max?: number }) => (
    <div>
      <label className={label}>{title}</label>
      <input
        type="number"
        min={0}
        max={max ?? 1440}
        value={Number(p[k])}
        onChange={(e) => set(k, Number(e.target.value) as AttendancePolicy[typeof k])}
        className={input}
      />
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );

  return (
    <Card>
      <CardHeader
        title="Attendance policy"
        subtitle={configured ? `Rules for ${orgName}` : `${orgName} is running on defaults — save to make them explicit`}
      />
      <CardBody className="space-y-5">
        {/* Shape of the working day */}
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Working day</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            <Toggle k="allowMultipleSessions" title="Multiple sessions per day" hint="Split shifts, client visits, stepping out and back." />
            <Toggle k="allowReEntry" title="Re-entry after check-out" hint="Lets someone check in again once they've checked out." />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Num k="maxSessionsPerDay" title="Max sessions / day" hint="Cap on check-ins. 1 = classic single session." max={20} />
            <Num k="graceMinutes" title="Grace (minutes)" hint="Late only after shift start + this." max={240} />
            <Num k="minHoursForPresent" title="Min minutes for present" hint="Below this, the day reads as a short day." />
          </div>
        </section>

        {/* Breaks */}
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Breaks</h4>
          <Toggle k="allowCheckOutOnBreak" title="Allow check-out during a break" hint="Off means the break must be ended first." />
          <div className="grid gap-3 sm:grid-cols-4">
            <Num k="maxBreaksPerDay" title="Max breaks / day" hint="0 = unlimited." max={50} />
            <Num k="maxBreakMinutesPerDay" title="Max break minutes / day" hint="0 = unlimited." />
            <Num k="maxSingleBreakMinutes" title="Max single break" hint="0 = unlimited." />
            <Num k="paidBreakMinutesPerDay" title="Paid break minutes" hint="First N minutes count as worked." />
          </div>
        </section>

        {/* Unfinished days */}
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Unfinished days & overtime</h4>
          <Toggle
            k="autoCheckOutAtShiftEnd"
            title="Auto check-out when a day is left open"
            hint="Closes at the earlier of last activity or shift end — never the sweep time — so forgetting can't inflate hours."
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Num k="autoCheckOutAfterMinutes" title="Wait after shift end (minutes)" hint="Slack before the system closes the day." />
            <Num k="overtimeAfterMinutes" title="Overtime after (minutes)" hint="0 = past the shift length. Only approved overtime is payable." />
          </div>
          <Toggle k="allowManualCorrection" title="Allow correction requests" hint="Employees can ask their manager to fix a missed punch or claim overtime." />
        </section>

        {/* Work model */}
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Work model</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>Model</label>
              <select value={p.workModel} onChange={(e) => set("workModel", e.target.value)} className={input}>
                <option value="WFO">Work from office</option>
                <option value="WFH">Work from home</option>
                <option value="HYBRID">Hybrid</option>
              </select>
            </div>
            <div>
              <label className={label}>Allowed locations</label>
              <div className="flex flex-wrap gap-1.5">
                {LOCATIONS.map((loc) => (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => toggleLocation(loc)}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      p.allowedLocations.includes(loc)
                        ? "border-brand bg-brand/10 text-brand"
                        : "border-hairline bg-panel text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {loc.replace("_", " ").toLowerCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <Toggle k="requireLocation" title="Require a location on check-in" hint="Employees must say where they're working from." />
        </section>

        <div className="flex items-center gap-3 border-t border-hairline pt-4">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-soft disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save policy"}
          </button>
          {msg ? <span className="text-sm text-emerald-600">{msg}</span> : null}
          {error ? <span className="text-sm text-rose-600">{error}</span> : null}
        </div>
      </CardBody>
    </Card>
  );
}
