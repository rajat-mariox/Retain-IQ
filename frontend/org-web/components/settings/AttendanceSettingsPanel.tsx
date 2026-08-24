"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock, Coffee, LogOut, MapPin } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import type { AttendancePolicy } from "@/lib/api";

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none disabled:cursor-not-allowed disabled:opacity-60";
const label = "mb-1.5 block text-sm font-medium text-slate-700";
const help = "mt-1 text-xs text-slate-500";

const LOCATIONS: AttendancePolicy["allowedLocations"][number][] = ["OFFICE", "HOME", "CLIENT_SITE", "REMOTE"];
const LOCATION_LABEL: Record<string, string> = { OFFICE: "Office", HOME: "Home", CLIENT_SITE: "Client site", REMOTE: "Remote" };

/**
 * Org attendance rules, in plain language. Editable by an admin with
 * attendance.manage (Owner + granted HR managers); read-only for others.
 */
export function AttendanceSettingsPanel({ initial, canEdit }: { initial: AttendancePolicy; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [p, setP] = useState<AttendancePolicy>(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof AttendancePolicy>(k: K, v: AttendancePolicy[K]) => setP((prev) => ({ ...prev, [k]: v }));
  const toggleLocation = (loc: AttendancePolicy["allowedLocations"][number]) =>
    setP((prev) => {
      const has = prev.allowedLocations.includes(loc);
      const next = has ? prev.allowedLocations.filter((l) => l !== loc) : [...prev.allowedLocations, loc];
      return { ...prev, allowedLocations: next.length ? next : prev.allowedLocations }; // keep at least one
    });

  function save() {
    setMsg(null);
    setError(null);
    start(async () => {
      const res = await fetch("/api/attendance/policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "Could not save.");
        return;
      }
      setMsg("Saved — the new rules apply to check-ins right away.");
      router.refresh();
    });
  }

  const disabled = !canEdit;

  return (
    <Card>
      <CardHeader
        title="Attendance rules"
        subtitle={canEdit ? "How check-in, breaks and auto check-out work for your organization" : "How check-in, breaks and auto check-out work (view only)"}
      />
      <CardBody className="space-y-5">
        {/* Timing */}
        <div>
          <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400"><Clock className="size-3.5" /> Timing</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Late-arrival grace</label>
              <select className={input} disabled={disabled} value={p.graceMinutes} onChange={(e) => set("graceMinutes", Number(e.target.value))}>
                {[0, 5, 10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m === 0 ? "No grace" : `${m} min`}</option>)}
              </select>
              <p className={help}>Arriving within this window isn't counted as late.</p>
            </div>
            <div>
              <label className={label}>Overtime starts after</label>
              <select className={input} disabled={disabled} value={p.overtimeAfterMinutes} onChange={(e) => set("overtimeAfterMinutes", Number(e.target.value))}>
                <option value={0}>Full shift length</option>
                {[480, 510, 540, 570, 600].map((m) => <option key={m} value={m}>{Math.floor(m / 60)}h {m % 60 ? `${m % 60}m` : ""}</option>)}
              </select>
              <p className={help}>Time worked beyond this counts as overtime.</p>
            </div>
          </div>
        </div>

        {/* Minimum time after check-in before break / check-out */}
        <div className="border-t border-hairline pt-4">
          <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400"><Clock className="size-3.5" /> Minimum time after check-in</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Before a break is allowed</label>
              <select className={input} disabled={disabled} value={p.minMinutesBeforeBreak} onChange={(e) => set("minMinutesBeforeBreak", Number(e.target.value))}>
                <option value={0}>No minimum</option>
                {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} min after check-in</option>)}
              </select>
              <p className={help}>Someone can't start a break until they've been checked in this long.</p>
            </div>
            <div>
              <label className={label}>Before check-out is allowed</label>
              <select className={input} disabled={disabled} value={p.minMinutesBeforeCheckOut} onChange={(e) => set("minMinutesBeforeCheckOut", Number(e.target.value))}>
                <option value={0}>No minimum</option>
                {[15, 30, 60, 120, 240, 480].map((m) => <option key={m} value={m}>{m >= 60 ? `${m / 60} hr` : `${m} min`} after check-in</option>)}
              </select>
              <p className={help}>Stops someone checking in and immediately checking out. They'll see how long is left.</p>
            </div>
          </div>
        </div>

        {/* Auto check-out — the buffer */}
        <div className="border-t border-hairline pt-4">
          <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400"><LogOut className="size-3.5" /> Auto check-out</p>
          <label className="flex items-center gap-2.5 text-sm text-slate-700">
            <input type="checkbox" disabled={disabled} checked={p.autoCheckOutAtShiftEnd} onChange={(e) => set("autoCheckOutAtShiftEnd", e.target.checked)} className="size-4 rounded border-hairline text-brand focus:ring-brand" />
            Automatically check people out if they forget
          </label>
          <div className={`mt-3 max-w-xs ${p.autoCheckOutAtShiftEnd ? "" : "pointer-events-none opacity-50"}`}>
            <label className={label}>Wait this long after shift end</label>
            <select className={input} disabled={disabled} value={p.autoCheckOutAfterMinutes} onChange={(e) => set("autoCheckOutAfterMinutes", Number(e.target.value))}>
              {[0, 15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m === 0 ? "Right at shift end" : `${m} min buffer`}</option>)}
            </select>
            <p className={help}>A buffer gives late-working staff some margin before their day is closed for them. Overtime isn't credited on an auto check-out.</p>
          </div>
        </div>

        {/* Idle auto-checkout (desktop agent) */}
        <div className="border-t border-hairline pt-4">
          <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400"><LogOut className="size-3.5" /> Idle auto-checkout <span className="font-normal normal-case text-slate-400">· desktop app</span></p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Check out after being idle for</label>
              <select className={input} disabled={disabled} value={p.idleCheckoutMinutes} onChange={(e) => set("idleCheckoutMinutes", Number(e.target.value))}>
                <option value={0}>Off — don't auto check-out on idle</option>
                {[15, 20, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} min of no activity</option>)}
              </select>
              <p className={help}>No keyboard or mouse for this long → the desktop app checks the person out.</p>
            </div>
            <div className={p.idleCheckoutMinutes > 0 ? "" : "pointer-events-none opacity-50"}>
              <label className={label}>Warn them before, with a countdown of</label>
              <select className={input} disabled={disabled} value={p.idleCheckoutWarnMinutes} onChange={(e) => set("idleCheckoutWarnMinutes", Number(e.target.value))}>
                {[1, 2, 3, 5, 10].map((m) => <option key={m} value={m}>{m} min warning</option>)}
              </select>
              <p className={help}>A pop-up with a live countdown appears this long before check-out. Any activity cancels it. (e.g. 30 min idle = 25 min quiet + a 5 min warning.)</p>
            </div>
          </div>
        </div>

        {/* Breaks */}
        <div className="border-t border-hairline pt-4">
          <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400"><Coffee className="size-3.5" /> Breaks</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Paid break time per day</label>
              <select className={input} disabled={disabled} value={p.paidBreakMinutesPerDay} onChange={(e) => set("paidBreakMinutesPerDay", Number(e.target.value))}>
                {[0, 15, 30, 45, 60].map((m) => <option key={m} value={m}>{m === 0 ? "None" : `${m} min`}</option>)}
              </select>
              <p className={help}>The first N minutes of breaks still count as worked time.</p>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2.5 text-sm text-slate-700">
                <input type="checkbox" disabled={disabled} checked={p.allowCheckOutOnBreak} onChange={(e) => set("allowCheckOutOnBreak", e.target.checked)} className="size-4 rounded border-hairline text-brand focus:ring-brand" />
                Allow checking out while on a break
              </label>
            </div>
          </div>
        </div>

        {/* Work model & location */}
        <div className="border-t border-hairline pt-4">
          <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400"><MapPin className="size-3.5" /> Work model</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Default work model</label>
              <select className={input} disabled={disabled} value={p.workModel} onChange={(e) => set("workModel", e.target.value as AttendancePolicy["workModel"])}>
                <option value="WFO">In office (WFO)</option>
                <option value="WFH">Work from home (WFH)</option>
                <option value="HYBRID">Hybrid</option>
              </select>
            </div>
            <div>
              <label className={label}>Where people can check in from</label>
              <div className="flex flex-wrap gap-2">
                {LOCATIONS.map((loc) => {
                  const on = p.allowedLocations.includes(loc);
                  return (
                    <button
                      key={loc}
                      type="button"
                      disabled={disabled}
                      onClick={() => toggleLocation(loc)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${on ? "border-brand bg-brand/10 text-brand" : "border-hairline bg-panel text-slate-500 hover:bg-slate-50"}`}
                    >
                      {LOCATION_LABEL[loc]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <label className="mt-3 flex items-center gap-2.5 text-sm text-slate-700">
            <input type="checkbox" disabled={disabled} checked={p.requireLocation} onChange={(e) => set("requireLocation", e.target.checked)} className="size-4 rounded border-hairline text-brand focus:ring-brand" />
            Require a location when checking in
          </label>
        </div>

        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        {msg ? <p className="text-sm text-emerald-600">{msg}</p> : null}
        {canEdit ? (
          <div className="flex justify-end border-t border-hairline pt-4">
            <button onClick={save} disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">{pending ? "Saving…" : "Save attendance rules"}</button>
          </div>
        ) : (
          <p className="border-t border-hairline pt-4 text-xs text-slate-500">You don't have permission to change these rules. Ask an Owner or an admin with "Set attendance rules" access.</p>
        )}
      </CardBody>
    </Card>
  );
}
