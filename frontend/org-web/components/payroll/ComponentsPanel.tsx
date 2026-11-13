"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Archive, Layers, Plus } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { SkeletonTableCard } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";
import type { OrgSession } from "@/lib/api";
import { NoAccess, can, inputCls, labelCls, primaryBtn, readError, secondaryBtn } from "./workspace-shared";

/* ------------------------------- types ---------------------------------- */

type Direction = "EARNING" | "DEDUCTION";
type CalcType = "FIXED" | "PERCENTAGE" | "FORMULA" | "INPUT_BASED" | "PER_UNIT";
type Status = "DRAFT" | "ACTIVE" | "ARCHIVED";

interface ComponentVersion {
  id: string;
  componentId: string;
  version: number;
  category: string;
  direction: Direction;
  calcType: CalcType;
  config: Record<string, unknown> | null;
  countryCode: string | null;
  currencyCode: string | null;
  taxable: boolean;
  statutory: boolean;
  employerPaid: boolean;
  proratable: boolean;
  minAmount: number | null;
  maxAmount: number | null;
  rounding: string;
  payslipVisible: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: Status;
  createdAt: string;
}
interface ComponentRow {
  id: string;
  code: string;
  name: string;
  archived: boolean;
  latestVersion: ComponentVersion | null;
  createdAt: string;
  updatedAt: string;
}
interface ComponentDetail extends Omit<ComponentRow, "latestVersion"> {
  versions: ComponentVersion[];
}

const CALC_TYPES: { value: CalcType; label: string; hint: string }[] = [
  { value: "FIXED", label: "Fixed amount", hint: "A flat amount." },
  { value: "PERCENTAGE", label: "Percentage", hint: "A percent of another figure (e.g. base pay)." },
  { value: "PER_UNIT", label: "Per unit", hint: "A rate multiplied by a unit count." },
  { value: "INPUT_BASED", label: "Input-based", hint: "Value supplied per run via an input key." },
  { value: "FORMULA", label: "Formula", hint: "A safe expression using MIN/MAX/ROUND." },
];

const todayISO = () => new Date().toISOString().slice(0, 10);

const DIRECTION_BADGE: Record<Direction, string> = {
  EARNING: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20",
  DEDUCTION: "bg-rose-500/10 text-rose-700 ring-rose-600/20",
};
const STATUS_BADGE: Record<Status, string> = {
  ACTIVE: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20",
  DRAFT: "bg-slate-500/10 text-slate-600 ring-slate-500/20",
  ARCHIVED: "bg-slate-500/10 text-slate-500 ring-slate-500/20",
};

function Chip({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", on ? "bg-brand/10 text-brand ring-brand/20" : "bg-panel-2 text-slate-400 ring-hairline")}>
      {children}
    </span>
  );
}

/* ------------------------------ form state ------------------------------- */

interface VersionFormState {
  category: string;
  direction: Direction;
  calcType: CalcType;
  taxable: boolean;
  statutory: boolean;
  employerPaid: boolean;
  proratable: boolean;
  payslipVisible: boolean;
  effectiveFrom: string;
  currencyCode: string;
  minAmount: string;
  maxAmount: string;
  // calc-type specific config
  amount: string;
  percent: string;
  percentOf: string;
  rate: string;
  unit: string;
  inputKey: string;
  expression: string;
}

const emptyVersion = (): VersionFormState => ({
  category: "",
  direction: "EARNING",
  calcType: "FIXED",
  taxable: true,
  statutory: false,
  employerPaid: false,
  proratable: true,
  payslipVisible: true,
  effectiveFrom: todayISO(),
  currencyCode: "",
  minAmount: "",
  maxAmount: "",
  amount: "",
  percent: "",
  percentOf: "BASE",
  rate: "",
  unit: "",
  inputKey: "",
  expression: "",
});

function buildConfig(f: VersionFormState): Record<string, unknown> {
  switch (f.calcType) {
    case "FIXED":
      return { amount: Number(f.amount) || 0 };
    case "PERCENTAGE":
      return { percent: Number(f.percent) || 0, of: f.percentOf.trim() || "BASE" };
    case "PER_UNIT":
      return { rate: Number(f.rate) || 0, unit: f.unit.trim() || "unit" };
    case "INPUT_BASED":
      return { inputKey: f.inputKey.trim() };
    case "FORMULA":
      return { expression: f.expression.trim() };
    default:
      return {};
  }
}

function versionPayload(f: VersionFormState) {
  return {
    category: f.category.trim(),
    direction: f.direction,
    calcType: f.calcType,
    config: buildConfig(f),
    currencyCode: f.currencyCode.trim() || undefined,
    taxable: f.taxable,
    statutory: f.statutory,
    employerPaid: f.employerPaid,
    proratable: f.proratable,
    payslipVisible: f.payslipVisible,
    minAmount: f.minAmount === "" ? undefined : Number(f.minAmount),
    maxAmount: f.maxAmount === "" ? undefined : Number(f.maxAmount),
    effectiveFrom: f.effectiveFrom,
  };
}

/* ------------------------------ component -------------------------------- */

export function ComponentsPanel({ session }: { session: OrgSession }) {
  const canRead = can(session, "payroll.component.read");
  const canManage = can(session, "payroll.component.manage");

  const [rows, setRows] = useState<ComponentRow[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reload = useCallback(() => {
    fetch(`/api/payroll/components${showArchived ? "?includeArchived=true" : ""}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d) ? (d as ComponentRow[]) : []))
      .catch(() => setRows([]));
  }, [showArchived]);
  useEffect(() => {
    if (canRead) reload();
  }, [canRead, reload]);

  // create / add-version modal — `target` null = create a new component
  const [modalOpen, setModalOpen] = useState(false);
  const [target, setTarget] = useState<ComponentRow | null>(null);
  const [meta, setMeta] = useState({ code: "", name: "" });
  const [form, setForm] = useState<VersionFormState>(emptyVersion());

  const openCreate = () => {
    setError(null);
    setTarget(null);
    setMeta({ code: "", name: "" });
    setForm(emptyVersion());
    setModalOpen(true);
  };
  const openAddVersion = (c: ComponentRow) => {
    setError(null);
    setTarget(c);
    setMeta({ code: c.code, name: c.name });
    // Seed from the latest version so a revision only changes what's needed.
    const lv = c.latestVersion;
    setForm(
      lv
        ? {
            ...emptyVersion(),
            category: lv.category,
            direction: lv.direction,
            calcType: lv.calcType,
            taxable: lv.taxable,
            statutory: lv.statutory,
            employerPaid: lv.employerPaid,
            proratable: lv.proratable,
            payslipVisible: lv.payslipVisible,
            currencyCode: lv.currencyCode ?? "",
            minAmount: lv.minAmount?.toString() ?? "",
            maxAmount: lv.maxAmount?.toString() ?? "",
            amount: typeof lv.config?.amount === "number" ? String(lv.config.amount) : "",
            percent: typeof lv.config?.percent === "number" ? String(lv.config.percent) : "",
            percentOf: typeof lv.config?.of === "string" ? lv.config.of : "BASE",
            rate: typeof lv.config?.rate === "number" ? String(lv.config.rate) : "",
            unit: typeof lv.config?.unit === "string" ? lv.config.unit : "",
            inputKey: typeof lv.config?.inputKey === "string" ? lv.config.inputKey : "",
            expression: typeof lv.config?.expression === "string" ? lv.config.expression : "",
          }
        : emptyVersion(),
    );
    setModalOpen(true);
  };

  const submit = () =>
    start(async () => {
      setError(null);
      const url = target ? `/api/payroll/components/${target.id}/versions` : "/api/payroll/components";
      const body = target ? versionPayload(form) : { code: meta.code.trim(), name: meta.name.trim(), ...versionPayload(form) };
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(readError(d, "Could not save the component."));
        return;
      }
      setModalOpen(false);
      reload();
    });

  const archive = (c: ComponentRow) =>
    start(async () => {
      setError(null);
      if (typeof window !== "undefined" && !window.confirm(`Archive component ${c.code}? It stops applying to new runs.`)) return;
      const res = await fetch(`/api/payroll/components/${c.id}/archive`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(readError(d, "Could not archive the component."));
        return;
      }
      reload();
    });

  // versions viewer
  const [viewFor, setViewFor] = useState<ComponentRow | null>(null);
  const [detail, setDetail] = useState<ComponentDetail | null>(null);
  const openViewer = (c: ComponentRow) => {
    setViewFor(c);
    setDetail(null);
    fetch(`/api/payroll/components/${c.id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: ComponentDetail) => setDetail(d?.versions ? d : null))
      .catch(() => setDetail(null));
  };

  if (!canRead) {
    return (
      <Card>
        <NoAccess>You don&apos;t have access to pay components.</NoAccess>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <Card>
        <CardHeader
          title="Pay components"
          subtitle="Earning & deduction building blocks — each version is effective-dated so past runs stay reproducible"
          action={
            <div className="flex items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-500">
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="rounded border-hairline" />
                Show archived
              </label>
              {canManage ? (
                <button onClick={openCreate} className={primaryBtn}>
                  <Plus className="size-4" /> New component
                </button>
              ) : null}
            </div>
          }
        />

        {rows === null ? (
          <div className="p-5">
            <SkeletonTableCard rows={5} cols={5} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-xs text-slate-500">
                  <th className="px-5 py-3 text-left font-medium">Code</th>
                  <th className="px-5 py-3 text-left font-medium">Name</th>
                  <th className="px-5 py-3 text-left font-medium">Direction</th>
                  <th className="px-5 py-3 text-left font-medium">Calc</th>
                  <th className="px-5 py-3 text-left font-medium">Flags</th>
                  <th className="px-5 py-3 text-left font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const lv = c.latestVersion;
                  return (
                    <tr key={c.id} className={cn("border-b border-hairline/60 last:border-0 hover:bg-slate-50", c.archived && "opacity-60")}>
                      <td className="px-5 py-3 font-mono text-xs font-medium text-slate-800">{c.code}</td>
                      <td className="px-5 py-3 text-slate-700">
                        {c.name}
                        {lv ? <span className="ml-2 text-xs text-slate-400">{lv.category}</span> : null}
                      </td>
                      <td className="px-5 py-3">
                        {lv ? <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", DIRECTION_BADGE[lv.direction])}>{lv.direction.toLowerCase()}</span> : "—"}
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-600">{lv ? lv.calcType.replace(/_/g, " ").toLowerCase() : "—"}</td>
                      <td className="px-5 py-3">
                        {lv ? (
                          <div className="flex flex-wrap gap-1">
                            <Chip on={lv.taxable}>taxable</Chip>
                            <Chip on={lv.statutory}>statutory</Chip>
                            <Chip on={lv.employerPaid}>employer</Chip>
                          </div>
                        ) : "—"}
                      </td>
                      <td className="px-5 py-3">
                        <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", c.archived ? STATUS_BADGE.ARCHIVED : STATUS_BADGE[lv?.status ?? "DRAFT"])}>
                          {c.archived ? "archived" : (lv?.status ?? "draft").toLowerCase()}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button onClick={() => openViewer(c)} className="inline-flex items-center gap-1 rounded-lg border border-hairline px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                            <Layers className="size-3.5" /> Versions
                          </button>
                          {canManage && !c.archived ? (
                            <>
                              <button onClick={() => openAddVersion(c)} className="inline-flex items-center gap-1 rounded-lg border border-hairline px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                                <Plus className="size-3.5" /> Version
                              </button>
                              <button onClick={() => archive(c)} disabled={pending} title="Archive" className="inline-flex items-center gap-1 rounded-lg border border-hairline px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-60">
                                <Archive className="size-3.5" />
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-500">
                      No pay components yet{canManage ? " — create an earning or deduction to build payslips from." : "."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ---------------- create / add-version modal ---------------- */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={target ? `New version — ${target.code}` : "New pay component"} size="lg">
        <div className="space-y-4">
          {!target ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Code</label>
                <input maxLength={40} className={inputCls} value={meta.code} onChange={(e) => setMeta({ ...meta, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })} placeholder="HRA" />
              </div>
              <div>
                <label className={labelCls}>Name</label>
                <input maxLength={120} className={inputCls} value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} placeholder="House rent allowance" />
              </div>
            </div>
          ) : (
            <p className="rounded-lg bg-panel-2 px-3 py-2 text-xs text-slate-500">Adding a new effective-dated version closes the current one the day before its start.</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Category</label>
              <input maxLength={40} className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Allowance / Tax / Benefit" />
            </div>
            <div>
              <label className={labelCls}>Direction</label>
              <select className={inputCls} value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as Direction })}>
                <option value="EARNING">Earning</option>
                <option value="DEDUCTION">Deduction</option>
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Calculation type</label>
            <select className={inputCls} value={form.calcType} onChange={(e) => setForm({ ...form, calcType: e.target.value as CalcType })}>
              {CALC_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-slate-400">{CALC_TYPES.find((c) => c.value === form.calcType)?.hint}</p>
          </div>

          {/* calc-type specific config */}
          <div className="rounded-xl border border-hairline/70 bg-panel-2 p-3">
            {form.calcType === "FIXED" ? (
              <div>
                <label className={labelCls}>Amount</label>
                <input type="number" step="0.01" className={inputCls} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
            ) : null}
            {form.calcType === "PERCENTAGE" ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Percent</label>
                  <input type="number" step="0.01" className={inputCls} value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} placeholder="40" />
                </div>
                <div>
                  <label className={labelCls}>Of</label>
                  <input className={inputCls} value={form.percentOf} onChange={(e) => setForm({ ...form, percentOf: e.target.value })} placeholder="BASE" />
                </div>
              </div>
            ) : null}
            {form.calcType === "PER_UNIT" ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Rate</label>
                  <input type="number" step="0.01" className={inputCls} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>Unit</label>
                  <input className={inputCls} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="day / km" />
                </div>
              </div>
            ) : null}
            {form.calcType === "INPUT_BASED" ? (
              <div>
                <label className={labelCls}>Input key</label>
                <input className={inputCls} value={form.inputKey} onChange={(e) => setForm({ ...form, inputKey: e.target.value })} placeholder="e.g. incentive_units" />
              </div>
            ) : null}
            {form.calcType === "FORMULA" ? (
              <div>
                <label className={labelCls}>Expression</label>
                <input className={cn(inputCls, "font-mono")} value={form.expression} onChange={(e) => setForm({ ...form, expression: e.target.value })} placeholder="MIN(BASE * 0.5, 15000)" />
                <p className="mt-1 text-[11px] text-slate-400">Only + - * / ( ) and MIN / MAX / ROUND are allowed.</p>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Effective from</label>
              <input type="date" className={inputCls} value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Currency <span className="font-normal text-slate-400">(opt)</span></label>
              <input maxLength={3} className={inputCls} value={form.currencyCode} onChange={(e) => setForm({ ...form, currencyCode: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} placeholder="USD" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Min</label>
                <input type="number" step="0.01" className={inputCls} value={form.minAmount} onChange={(e) => setForm({ ...form, minAmount: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>Max</label>
                <input type="number" step="0.01" className={inputCls} value={form.maxAmount} onChange={(e) => setForm({ ...form, maxAmount: e.target.value })} />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 rounded-xl border border-hairline/70 px-3 py-2.5 text-sm">
            {([
              ["taxable", "Taxable"],
              ["statutory", "Statutory"],
              ["employerPaid", "Employer paid"],
              ["proratable", "Proratable"],
              ["payslipVisible", "Show on payslip"],
            ] as const).map(([key, lbl]) => (
              <label key={key} className="inline-flex cursor-pointer items-center gap-1.5 text-slate-700">
                <input type="checkbox" checked={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} className="rounded border-hairline" />
                {lbl}
              </label>
            ))}
          </div>

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setModalOpen(false)} className={secondaryBtn}>Cancel</button>
            <button
              onClick={submit}
              disabled={pending || !form.category.trim() || !form.effectiveFrom || (!target && (!meta.code.trim() || !meta.name.trim()))}
              className={primaryBtn}
            >
              {pending ? "Saving…" : target ? "Add version" : "Create component"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ---------------- versions viewer ---------------- */}
      <Modal open={Boolean(viewFor)} onClose={() => setViewFor(null)} title={viewFor ? `${viewFor.code} — versions` : "Versions"} size="lg">
        {!detail ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading versions…</p>
        ) : (
          <ol className="space-y-3">
            {detail.versions.map((v, idx) => (
              <li key={v.id} className={cn("rounded-xl border px-4 py-3", idx === 0 && v.effectiveTo === null ? "border-brand/40 bg-brand/5" : "border-hairline bg-panel")}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
                    v{v.version}
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", DIRECTION_BADGE[v.direction])}>{v.direction.toLowerCase()}</span>
                    <span className="text-xs font-normal text-slate-500">{v.calcType.replace(/_/g, " ").toLowerCase()}</span>
                  </p>
                  <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", STATUS_BADGE[v.status])}>{v.status.toLowerCase()}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{v.effectiveFrom} <span className="text-slate-400">→</span> {v.effectiveTo ?? "present"} · {v.category}</p>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-panel-2 px-3 py-2 text-[11px] text-slate-600">{JSON.stringify(v.config ?? {}, null, 0)}</pre>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Chip on={v.taxable}>taxable</Chip>
                  <Chip on={v.statutory}>statutory</Chip>
                  <Chip on={v.employerPaid}>employer</Chip>
                  <Chip on={v.proratable}>proratable</Chip>
                  <Chip on={v.payslipVisible}>payslip</Chip>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Modal>
    </div>
  );
}
