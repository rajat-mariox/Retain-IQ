"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Clock, Coffee, Info, Timer } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { LocalTime } from "@/components/ui/LocalTime";
import { cn } from "@/lib/cn";
import type { OrgSession } from "@/lib/api";
import {
  EmployeePicker,
  NoAccess,
  can,
  fmtHoursFromMinutes,
  inputCls,
  labelCls,
  money,
  primaryBtn,
  readError,
  useEmployeeDirectory,
} from "./workspace-shared";

/* ------------------------------- types ---------------------------------- */

type DayType = "WEEKDAY" | "WEEKEND" | "HOLIDAY" | "NIGHT";
type OtMode = "PAID" | "COMP_OFF" | "PENDING_CHOICE";

interface OvertimeResult {
  id: string;
  employeeId: string;
  workDate: string;
  hours: number;
  dayType: string;
  mode: OtMode;
  multiplier: number | null;
  amount: number;
  compOffMinutes: number;
}
interface CompOffEntry {
  id: string;
  deltaMinutes: number;
  entryType: string;
  source: string;
  expiresAt: string | null;
  expired: boolean;
  note: string | null;
  createdAt: string;
}
interface CompOffLedger {
  employeeId: string;
  balanceMinutes: number;
  balanceHours: number;
  entries: CompOffEntry[];
}

const DAY_TYPES: DayType[] = ["WEEKDAY", "WEEKEND", "HOLIDAY", "NIGHT"];
const todayISO = () => new Date().toISOString().slice(0, 10);

/** Friendly copy for an employee's effective overtime policy mode (read-only). */
const OT_POLICY: Record<string, { label: string; tone: string; note: string }> = {
  PAID_OVERTIME: { label: "Paid overtime", tone: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20", note: "Recorded overtime is paid at the multiplier below." },
  COMP_OFF: { label: "Comp-off", tone: "bg-sky-500/10 text-sky-700 ring-sky-600/20", note: "Overtime accrues time off in lieu — no extra pay." },
  EMPLOYEE_CHOICE: { label: "Employee's choice", tone: "bg-amber-500/10 text-amber-700 ring-amber-600/20", note: "The record waits for the employee to pick paid or comp-off." },
  MIXED_POLICY: { label: "Mixed policy", tone: "bg-violet-500/10 text-violet-700 ring-violet-600/20", note: "Rest-day / holiday work is paid; ordinary overtime accrues comp-off." },
  NOT_APPLICABLE: { label: "Not applicable", tone: "bg-slate-500/10 text-slate-600 ring-slate-500/20", note: "This employee's policy does not recognise overtime — recording will be rejected." },
};

/* ------------------------------ component -------------------------------- */

export function OvertimePanel({ session }: { session: OrgSession }) {
  const canRecord = can(session, "payroll.overtime.approve");
  const canReadCompOff = can(session, "payroll.record.read");

  const { list: employees, byId } = useEmployeeDirectory();

  const [employeeId, setEmployeeId] = useState("");
  const [policyMode, setPolicyMode] = useState<string | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [profileMissing, setProfileMissing] = useState(false);
  const [ledger, setLedger] = useState<CompOffLedger | null>(null);

  const [form, setForm] = useState({ workDate: todayISO(), hours: "", dayType: "WEEKDAY" as DayType, multiplier: "", note: "" });
  const [result, setResult] = useState<OvertimeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Resolve the selected employee's effective OT policy + currency (read-only).
  useEffect(() => {
    setPolicyMode(null);
    setProfileMissing(false);
    if (!employeeId) return;
    let alive = true;
    fetch(`/api/payroll/profiles/${employeeId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { version?: { overtimePolicyMode?: string; currencyCode?: string } } | null) => {
        if (!alive) return;
        if (!d?.version) {
          setProfileMissing(true);
          return;
        }
        setPolicyMode(d.version.overtimePolicyMode ?? null);
        if (d.version.currencyCode) setCurrency(d.version.currencyCode);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [employeeId]);

  const loadLedger = useCallback(() => {
    if (!employeeId || !canReadCompOff) {
      setLedger(null);
      return;
    }
    fetch(`/api/payroll/employees/${employeeId}/comp-off`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: CompOffLedger | null) => setLedger(d?.entries ? d : null))
      .catch(() => setLedger(null));
  }, [employeeId, canReadCompOff]);
  useEffect(() => {
    loadLedger();
  }, [loadLedger]);

  const record = () =>
    start(async () => {
      setError(null);
      setResult(null);
      const res = await fetch("/api/payroll/overtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId,
          workDate: form.workDate,
          hours: Number(form.hours),
          dayType: form.dayType,
          multiplier: form.multiplier === "" ? undefined : Number(form.multiplier),
          note: form.note.trim() || undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(readError(d, "Could not record overtime."));
        return;
      }
      setResult(d as OvertimeResult);
      setForm({ ...form, hours: "", multiplier: "", note: "" });
      loadLedger();
    });

  if (!canRecord && !canReadCompOff) {
    return (
      <Card>
        <NoAccess>You don&apos;t have access to overtime.</NoAccess>
      </Card>
    );
  }

  const policy = policyMode ? OT_POLICY[policyMode] : null;

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-5">
        {/* ---- record overtime ---- */}
        <Card className="lg:col-span-3">
          <CardHeader title="Record overtime" subtitle="Signing off records the overtime — the employee's payroll policy decides paid vs comp-off" />
          <CardBody className="space-y-4">
            <div>
              <label className={labelCls}>Employee</label>
              <EmployeePicker value={employeeId} onChange={setEmployeeId} employees={employees} />
            </div>

            {/* read-only policy reflection */}
            {employeeId ? (
              profileMissing ? (
                <p className="inline-flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
                  <Info className="size-3.5 shrink-0" /> No payroll profile — set this employee&apos;s compensation before recording overtime.
                </p>
              ) : policy ? (
                <div className="rounded-lg border border-hairline/70 bg-panel-2 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Overtime policy</span>
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", policy.tone)}>{policy.label}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">{policy.note}</p>
                </div>
              ) : null
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Work date</label>
                <input type="date" max={todayISO()} className={inputCls} value={form.workDate} onChange={(e) => setForm({ ...form, workDate: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>Hours</label>
                <input type="number" min={0} max={24} step="0.25" className={inputCls} value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} placeholder="e.g. 2.5" />
              </div>
              <div>
                <label className={labelCls}>Day type</label>
                <select className={inputCls} value={form.dayType} onChange={(e) => setForm({ ...form, dayType: e.target.value as DayType })}>
                  {DAY_TYPES.map((d) => <option key={d} value={d}>{d.toLowerCase()}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Multiplier <span className="font-normal text-slate-400">(optional)</span></label>
                <input type="number" min={1} max={5} step="0.1" className={inputCls} value={form.multiplier} onChange={(e) => setForm({ ...form, multiplier: e.target.value })} placeholder="defaults by day type" />
              </div>
            </div>
            <div>
              <label className={labelCls}>Note <span className="font-normal text-slate-400">(optional)</span></label>
              <input className={inputCls} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Context for this overtime" />
            </div>

            {result ? (
              <div className="rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 ring-1 ring-inset ring-emerald-200">
                <p className="font-medium">Overtime recorded for {result.workDate}.</p>
                <p className="mt-0.5 text-xs">
                  {result.mode === "PAID" ? `Paid · ${money(result.amount, currency)}${result.multiplier ? ` (×${result.multiplier})` : ""}` : null}
                  {result.mode === "COMP_OFF" ? `Comp-off earned · ${fmtHoursFromMinutes(result.compOffMinutes)}` : null}
                  {result.mode === "PENDING_CHOICE" ? "Awaiting the employee's paid / comp-off choice." : null}
                </p>
              </div>
            ) : null}

            {canRecord ? (
              <div className="flex justify-end">
                <button onClick={record} disabled={pending || !employeeId || form.hours === "" || profileMissing} className={primaryBtn}>
                  <Timer className="size-4" /> {pending ? "Recording…" : "Record overtime"}
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-400">You can view comp-off balances but not record overtime.</p>
            )}
          </CardBody>
        </Card>

        {/* ---- comp-off balance ---- */}
        <Card className="lg:col-span-2">
          <CardHeader title="Comp-off balance" subtitle="Time off in lieu earned from overtime" />
          <CardBody>
            {!employeeId ? (
              <p className="py-8 text-center text-sm text-slate-500">Select an employee to see their comp-off ledger.</p>
            ) : !canReadCompOff ? (
              <p className="py-8 text-center text-sm text-slate-500">You don&apos;t have permission to view comp-off balances.</p>
            ) : !ledger ? (
              <p className="py-8 text-center text-sm text-slate-500">No comp-off entries for {byId.get(employeeId)?.name ?? "this employee"} yet.</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3 rounded-xl bg-panel-2 px-4 py-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-brand/10 text-brand ring-1 ring-inset ring-brand/20">
                    <Coffee className="size-5" />
                  </span>
                  <div>
                    <p className="text-2xl font-semibold tabular-nums text-slate-900">{ledger.balanceHours}h</p>
                    <p className="text-xs text-slate-500">available balance ({fmtHoursFromMinutes(ledger.balanceMinutes)})</p>
                  </div>
                </div>
                <ul className="max-h-64 divide-y divide-hairline/60 overflow-y-auto">
                  {ledger.entries.map((e) => (
                    <li key={e.id} className={cn("flex items-center justify-between gap-3 py-2 text-sm", e.expired && "opacity-50")}>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <Clock className="size-3.5 text-slate-400" />
                          <span className={cn("font-medium tabular-nums", e.deltaMinutes >= 0 ? "text-emerald-700" : "text-rose-700")}>
                            {e.deltaMinutes >= 0 ? "+" : ""}{fmtHoursFromMinutes(e.deltaMinutes)}
                          </span>
                          <span className="text-xs text-slate-400">{e.entryType.toLowerCase()} · {e.source.toLowerCase()}</span>
                        </span>
                        {e.note ? <span className="mt-0.5 block truncate text-xs text-slate-400">{e.note}</span> : null}
                      </span>
                      <span className="shrink-0 text-right text-[11px] text-slate-400">
                        <LocalTime iso={e.createdAt} mode="date" />
                        {e.expiresAt ? <span className="block">{e.expired ? "expired" : "expires"} {e.expiresAt.slice(0, 10)}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
