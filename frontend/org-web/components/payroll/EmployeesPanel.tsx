"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { History, Lock, Plus, ShieldCheck, UserRound } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { LocalTime } from "@/components/ui/LocalTime";
import { SkeletonTableCard } from "@/components/ui/Skeleton";
import type { OrgSession } from "@/lib/api";
import {
  EmployeePicker,
  MaskedField,
  NoAccess,
  can,
  employeeName,
  inputCls,
  labelCls,
  money,
  primaryBtn,
  readError,
  secondaryBtn,
  useEmployeeDirectory,
  type Sensitive,
} from "./workspace-shared";

/* ------------------------------- types ---------------------------------- */

interface ProfileVersion {
  id: string;
  profileId: string;
  version: number;
  legalEntityId: string | null;
  payrollEntityId: string | null;
  workCountry: string | null;
  payrollCountry: string | null;
  currencyCode: string;
  payFrequency: string;
  paymentBasis: string;
  baseAmount: Sensitive<number>;
  bankRef: Sensitive<string>;
  taxRegime: Sensitive<string>;
  taxResidencyCountry: Sensitive<string>;
  calendarId: string | null;
  prorationPolicy: string;
  overtimePolicyMode: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  joinDate: string | null;
  exitDate: string | null;
  createdAt: string;
}
interface ProfileListRow {
  employeeId: string;
  status: string;
  current: ProfileVersion | null;
}
interface SalaryHistory {
  employeeId: string;
  status: string;
  versions: ProfileVersion[];
}

const PAY_FREQUENCIES = ["MONTHLY", "SEMI_MONTHLY", "BIWEEKLY", "WEEKLY", "DAILY", "CUSTOM"] as const;
const PAYMENT_BASES = ["FIXED", "HOURLY", "DAILY"] as const;
const PRORATION = ["CALENDAR_DAYS", "WORKING_DAYS"] as const;
const OT_MODES: { value: string; label: string }[] = [
  { value: "NOT_APPLICABLE", label: "Not applicable" },
  { value: "PAID_OVERTIME", label: "Paid overtime" },
  { value: "COMP_OFF", label: "Comp-off (time in lieu)" },
  { value: "EMPLOYEE_CHOICE", label: "Employee's choice" },
  { value: "MIXED_POLICY", label: "Mixed (rest-day paid, weekday comp-off)" },
];

const todayISO = () => new Date().toISOString().slice(0, 10);

const basisLabel = (v: ProfileVersion) => `${v.paymentBasis.toLowerCase()} · ${v.payFrequency.replace(/_/g, " ").toLowerCase()}`;

/* ------------------------------ component -------------------------------- */

export function EmployeesPanel({ session }: { session: OrgSession }) {
  const canRead = can(session, "payroll.profile.read");
  const canSetComp = can(session, "payroll.profile.create") || can(session, "payroll.profile.update");

  const { list: employees, byId } = useEmployeeDirectory();

  const [rows, setRows] = useState<ProfileListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetch("/api/payroll/profiles", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d) ? (d as ProfileListRow[]) : []))
      .catch(() => setRows([]));
  }, []);
  useEffect(() => {
    if (canRead) reload();
  }, [canRead, reload]);

  // ---- profile drawer (current version + salary history) ----
  const [drawerFor, setDrawerFor] = useState<string | null>(null);
  const [history, setHistory] = useState<SalaryHistory | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const openDrawer = (employeeId: string) => {
    setDrawerFor(employeeId);
    setHistory(null);
    setDrawerLoading(true);
    fetch(`/api/payroll/profiles/${employeeId}/salary-history`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: SalaryHistory) => setHistory(d?.versions ? d : null))
      .catch(() => setHistory(null))
      .finally(() => setDrawerLoading(false));
  };

  // ---- set-compensation form ----
  const [formOpen, setFormOpen] = useState(false);
  const emptyForm = {
    employeeId: "",
    baseAmount: "",
    currencyCode: "USD",
    payFrequency: "MONTHLY",
    paymentBasis: "FIXED",
    prorationPolicy: "CALENDAR_DAYS",
    overtimePolicyMode: "NOT_APPLICABLE",
    effectiveFrom: todayISO(),
    bankRef: "",
    taxRegime: "",
  };
  const [form, setForm] = useState(emptyForm);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await fetch("/api/payroll/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: form.employeeId,
          baseAmount: Number(form.baseAmount),
          currencyCode: form.currencyCode || undefined,
          payFrequency: form.payFrequency,
          paymentBasis: form.paymentBasis,
          prorationPolicy: form.prorationPolicy,
          overtimePolicyMode: form.overtimePolicyMode,
          effectiveFrom: form.effectiveFrom,
          bankRef: form.bankRef.trim() || undefined,
          taxRegime: form.taxRegime.trim() || undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(readError(d, "Could not save compensation."));
        return;
      }
      setFormOpen(false);
      setForm(emptyForm);
      reload();
    });

  if (!canRead) {
    return (
      <Card>
        <NoAccess>You don&apos;t have access to payroll profiles.</NoAccess>
      </Card>
    );
  }

  const canUnmask = can(session, "salary.view_sensitive");

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <Card>
        <CardHeader
          title="Employee payroll profiles"
          subtitle="Effective-dated compensation — a new version is opened each time pay changes, so history stays reproducible"
          action={
            canSetComp ? (
              <button
                onClick={() => {
                  setError(null);
                  setForm({ ...emptyForm, effectiveFrom: todayISO() });
                  setFormOpen(true);
                }}
                className={primaryBtn}
              >
                <Plus className="size-4" /> Set compensation
              </button>
            ) : null
          }
        />

        {!canUnmask ? (
          <p className="mx-5 mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <Lock className="size-3.5" /> Sensitive pay and bank details are masked for your role.
          </p>
        ) : null}

        {rows === null ? (
          <div className="p-5">
            <SkeletonTableCard rows={5} cols={5} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-xs text-slate-500">
                  <th className="px-5 py-3 text-left font-medium">Employee</th>
                  <th className="px-5 py-3 text-left font-medium">Basis</th>
                  <th className="px-5 py-3 text-right font-medium">Base pay</th>
                  <th className="px-5 py-3 text-left font-medium">Effective</th>
                  <th className="px-5 py-3 text-right font-medium">Version</th>
                  <th className="px-5 py-3 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.employeeId} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <span className="font-medium text-slate-800">{employeeName(byId, r.employeeId)}</span>
                      <span className="ml-2 rounded-full bg-panel-2 px-1.5 py-0.5 text-[11px] text-slate-500">{r.status.toLowerCase()}</span>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{r.current ? basisLabel(r.current) : "—"}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-medium text-slate-900">
                      {r.current ? <MaskedField field={r.current.baseAmount} format={(v) => money(v, r.current!.currencyCode)} /> : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-xs text-slate-500">{r.current ? r.current.effectiveFrom : "—"}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-500">{r.current ? `v${r.current.version}` : "—"}</td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => openDrawer(r.employeeId)} className="inline-flex items-center gap-1 rounded-lg border border-hairline px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                        <History className="size-3.5" /> History
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">
                      No payroll profiles yet{canSetComp ? " — set compensation for an employee to begin." : "."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ---------------- salary-history drawer ---------------- */}
      <Modal open={Boolean(drawerFor)} onClose={() => setDrawerFor(null)} title="Compensation history" size="lg">
        {drawerLoading ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading history…</p>
        ) : !history ? (
          <p className="py-8 text-center text-sm text-slate-500">No compensation history for this employee yet.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-xl bg-panel-2 px-4 py-3">
              <span className="grid size-9 place-items-center rounded-xl bg-brand/10 text-brand ring-1 ring-inset ring-brand/20">
                <UserRound className="size-4.5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">{drawerFor ? employeeName(byId, drawerFor) : ""}</p>
                <p className="text-xs text-slate-500">{history.versions.length} version{history.versions.length === 1 ? "" : "s"} · profile {history.status.toLowerCase()}</p>
              </div>
            </div>

            <ol className="space-y-3">
              {history.versions.map((v, idx) => (
                <li key={v.id} className={`rounded-xl border px-4 py-3 ${idx === 0 && v.effectiveTo === null ? "border-brand/40 bg-brand/5" : "border-hairline bg-panel"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
                        v{v.version}
                        {idx === 0 && v.effectiveTo === null ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20"><ShieldCheck className="size-3" /> current</span> : null}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {v.effectiveFrom} <span className="text-slate-400">→</span> {v.effectiveTo ?? "present"} · {basisLabel(v)}
                      </p>
                    </div>
                    <p className="text-right text-sm font-semibold tabular-nums text-slate-900">
                      <MaskedField field={v.baseAmount} format={(a) => money(a, v.currencyCode)} />
                    </p>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
                    <Detail label="Currency" value={v.currencyCode} />
                    <Detail label="Overtime" value={v.overtimePolicyMode.replace(/_/g, " ").toLowerCase()} />
                    <Detail label="Proration" value={v.prorationPolicy.replace(/_/g, " ").toLowerCase()} />
                    <div>
                      <dt className="text-slate-400">Bank</dt>
                      <dd className="text-slate-700"><MaskedField field={v.bankRef} format={(s) => s} /></dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">Tax regime</dt>
                      <dd className="text-slate-700"><MaskedField field={v.taxRegime} format={(s) => s} /></dd>
                    </div>
                    <Detail label="Set" value={<LocalTime iso={v.createdAt} mode="date" />} />
                  </dl>
                </li>
              ))}
            </ol>
          </div>
        )}
      </Modal>

      {/* ---------------- set-compensation form ---------------- */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title="Set compensation" size="lg">
        <div className="space-y-4">
          <p className="rounded-lg bg-panel-2 px-3 py-2 text-xs text-slate-500">
            This opens a new effective-dated version. Existing pay history is never overwritten.
          </p>
          <div>
            <label className={labelCls}>Employee</label>
            <EmployeePicker value={form.employeeId} onChange={(id) => setForm({ ...form, employeeId: id })} employees={employees} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Base amount</label>
              <input type="number" min={0} step="0.01" className={inputCls} value={form.baseAmount} onChange={(e) => setForm({ ...form, baseAmount: e.target.value })} placeholder="e.g. 8500" />
            </div>
            <div>
              <label className={labelCls}>Currency</label>
              <input maxLength={3} className={inputCls} value={form.currencyCode} onChange={(e) => setForm({ ...form, currencyCode: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} placeholder="USD" />
            </div>
            <div>
              <label className={labelCls}>Payment basis</label>
              <select className={inputCls} value={form.paymentBasis} onChange={(e) => setForm({ ...form, paymentBasis: e.target.value })}>
                {PAYMENT_BASES.map((b) => <option key={b} value={b}>{b.toLowerCase()}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Pay frequency</label>
              <select className={inputCls} value={form.payFrequency} onChange={(e) => setForm({ ...form, payFrequency: e.target.value })}>
                {PAY_FREQUENCIES.map((f) => <option key={f} value={f}>{f.replace(/_/g, " ").toLowerCase()}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Effective from</label>
              <input type="date" className={inputCls} value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Proration</label>
              <select className={inputCls} value={form.prorationPolicy} onChange={(e) => setForm({ ...form, prorationPolicy: e.target.value })}>
                {PRORATION.map((p) => <option key={p} value={p}>{p.replace(/_/g, " ").toLowerCase()}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Overtime policy</label>
              <select className={inputCls} value={form.overtimePolicyMode} onChange={(e) => setForm({ ...form, overtimePolicyMode: e.target.value })}>
                {OT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Bank reference <span className="font-normal text-slate-400">(optional)</span></label>
              <input className={inputCls} value={form.bankRef} onChange={(e) => setForm({ ...form, bankRef: e.target.value })} placeholder="Account ref / token" />
            </div>
            <div>
              <label className={labelCls}>Tax regime <span className="font-normal text-slate-400">(optional)</span></label>
              <input className={inputCls} value={form.taxRegime} onChange={(e) => setForm({ ...form, taxRegime: e.target.value })} placeholder="e.g. NEW / OLD" />
            </div>
          </div>

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setFormOpen(false)} className={secondaryBtn}>Cancel</button>
            <button onClick={submit} disabled={pending || !form.employeeId || form.baseAmount === "" || !form.effectiveFrom} className={primaryBtn}>
              {pending ? "Saving…" : "Save version"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-slate-700">{value}</dd>
    </div>
  );
}
