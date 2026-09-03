"use client";

import { useCallback, useEffect, useState } from "react";
import { Landmark, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { inputCls, labelCls, primaryBtn, readError } from "./workspace-shared";
import { EmptyState } from "./payout-ui";
import type { PayrollAccess } from "./access";
import { TaxSettingsPanel } from "./TaxSettingsPanel";

/* ------------------------------- types ---------------------------------- */
interface Slab { seq?: number; lowerBound: string; upperBound: string | null; ratePercent: string }
interface RuleSet {
  id: string; orgId: string | null; countryCode: string; regime: string; taxYear: string; name: string;
  currencyCode: string; standardDeduction: string; rebateLimit: string | null; rebateMaxAmount: string | null;
  surchargePercent: string; cessPercent: string; effectiveFrom: string; effectiveTo: string | null;
  version: number; status: string; source: string | null; slabs: Slab[];
}
interface StatRule {
  id: string; orgId: string | null; countryCode: string; kind: string; name: string;
  employeeRate: string; employerRate: string; wageCeiling: string | null; applicableUpto: string | null;
  flatAmount: string | null; effectiveFrom: string; version: number; status: string; source: string | null;
}

const REGIMES = ["NEW", "OLD", "DEFAULT"];
// Suggestions only — the field is free-form so any country's statutory kinds work
// (India PF/ESI/PT/LWF, US SS/MEDICARE, …). The engine keys off whatever is entered.
const KINDS = ["PF", "ESI", "PT", "LWF", "SS", "MEDICARE", "FUTA", "SUTA"];
const num = (v: string | null) => (v == null || v === "" ? "—" : Number(v).toLocaleString("en-IN"));
const pct = (v: string) => `${Number(v)}%`;
const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * Phase-2 tax & statutory configuration (§13). The org opt-in toggle, plus the
 * versioned income-tax rule sets (slabs, standard deduction, rebate, cess) and
 * PF/ESI/PT statutory rules the engine reads. Rates are DATA entered here — the
 * engine never invents them. Adding is gated on payroll.tax/statutory.configure.
 */
export function TaxConfigPanel({ can }: { can: PayrollAccess }) {
  return (
    <div className="space-y-6">
      <TaxSettingsPanel can={can} />
      <RuleSetsSection can={can} />
      <StatutorySection can={can} />
      <p className="text-xs text-slate-400">
        Slabs and rates are effective-dated and versioned — editing opens a new version, so past payroll stays reproducible.
        Verify every figure against the current statutory notifications before running production payroll.
      </p>
    </div>
  );
}

/* =============================== INCOME TAX ============================== */
function RuleSetsSection({ can }: { can: PayrollAccess }) {
  const [rows, setRows] = useState<RuleSet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    fetch("/api/payroll/tax/rule-sets", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d: RuleSet[]) => setRows(Array.isArray(d) ? d : []))
      .catch(async (r) => setError(await readError(r, "Could not load tax rule sets.")));
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <Card>
      <CardHeader
        title="Income tax rule sets"
        subtitle="Slabs, standard deduction, rebate & cess per country + regime (effective-dated)"
        action={can.canTaxConfigure ? <button onClick={() => setOpen((o) => !o)} className={primaryBtn}><Plus className="size-4" /> {open ? "Close" : "Add rule set"}</button> : null}
      />
      <CardBody className="space-y-4">
        {error ? <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">{error}</div> : null}
        {open && can.canTaxConfigure ? <RuleSetForm onDone={() => { setOpen(false); load(); }} onError={setError} /> : null}

        {rows === null ? (
          <p className="py-2 text-sm text-slate-400">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState title="No tax rule sets yet" hint={can.canTaxConfigure ? "Add one above to enable income-tax (TDS) calculation." : "No income-tax rules are configured."} />
        ) : (
          <ul className="space-y-3">
            {rows.map((rs) => (
              <li key={rs.id} className="rounded-xl border border-hairline p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      {rs.name}
                      <span className="rounded-full bg-panel-2 px-2 py-0.5 text-[11px] text-slate-500">{rs.countryCode} · {rs.regime} · {rs.taxYear}</span>
                      {rs.orgId === null ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">platform</span> : null}
                      {rs.status !== "ACTIVE" ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{rs.status.toLowerCase()}</span> : null}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      from {rs.effectiveFrom.slice(0, 10)} · v{rs.version} · std ded {num(rs.standardDeduction)} · rebate ≤{num(rs.rebateLimit)} · cess {pct(rs.cessPercent)}
                    </p>
                    {rs.source ? <p className="mt-0.5 text-[11px] italic text-amber-600">{rs.source}</p> : null}
                  </div>
                </div>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[360px] text-xs">
                    <thead><tr className="text-slate-400"><th className="py-1 text-left font-medium">From</th><th className="py-1 text-left font-medium">To</th><th className="py-1 text-right font-medium">Rate</th></tr></thead>
                    <tbody>
                      {rs.slabs.map((s, i) => (
                        <tr key={i} className="border-t border-hairline/60 tabular-nums">
                          <td className="py-1 text-slate-700">{num(s.lowerBound)}</td>
                          <td className="py-1 text-slate-700">{s.upperBound == null ? "and above" : num(s.upperBound)}</td>
                          <td className="py-1 text-right font-medium text-slate-900">{pct(s.ratePercent)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function RuleSetForm({ onDone, onError }: { onDone: () => void; onError: (e: string) => void }) {
  const [f, setF] = useState({ countryCode: "IN", regime: "NEW", taxYear: "2025-26", name: "", currencyCode: "INR", standardDeduction: "75000", fiscalYearStartMonth: "4", rebateLimit: "1200000", rebateMaxAmount: "60000", surchargePercent: "0", cessPercent: "4", effectiveFrom: todayISO(), source: "" });
  const [slabs, setSlabs] = useState<Slab[]>([{ lowerBound: "0", upperBound: "400000", ratePercent: "0" }, { lowerBound: "400000", upperBound: "800000", ratePercent: "5" }, { lowerBound: "800000", upperBound: null, ratePercent: "10" }]);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const setSlab = (i: number, k: keyof Slab, v: string | null) => setSlabs((p) => p.map((s, j) => (j === i ? { ...s, [k]: v } : s)));

  async function submit() {
    setBusy(true); onError("");
    try {
      const body = {
        countryCode: f.countryCode.trim().toUpperCase(), regime: f.regime, taxYear: f.taxYear.trim(), name: f.name.trim(),
        currencyCode: f.currencyCode.trim().toUpperCase(), standardDeduction: Number(f.standardDeduction || 0),
        fiscalYearStartMonth: Number(f.fiscalYearStartMonth || 4),
        rebateLimit: f.rebateLimit ? Number(f.rebateLimit) : null, rebateMaxAmount: f.rebateMaxAmount ? Number(f.rebateMaxAmount) : null,
        surchargePercent: Number(f.surchargePercent || 0), cessPercent: Number(f.cessPercent || 0),
        effectiveFrom: f.effectiveFrom, source: f.source.trim() || null,
        slabs: slabs.map((s) => ({ lowerBound: Number(s.lowerBound || 0), upperBound: s.upperBound == null || s.upperBound === "" ? null : Number(s.upperBound), ratePercent: Number(s.ratePercent || 0) })),
      };
      const res = await fetch("/api/payroll/tax/rule-sets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw res;
      onDone();
    } catch (r) { onError(await readError(r, "Could not create the rule set.")); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3 rounded-xl border border-hairline bg-panel-2/40 p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div><label className={labelCls}>Country</label><input className={inputCls} value={f.countryCode} maxLength={2} onChange={(e) => set("countryCode")(e.target.value.toUpperCase())} /></div>
        <div><label className={labelCls}>Regime</label><select className={inputCls} value={f.regime} onChange={(e) => set("regime")(e.target.value)}>{REGIMES.map((r) => <option key={r}>{r}</option>)}</select></div>
        <div><label className={labelCls}>Tax year</label><input className={inputCls} value={f.taxYear} onChange={(e) => set("taxYear")(e.target.value)} placeholder="2025-26" /></div>
        <div><label className={labelCls}>Currency</label><input className={inputCls} value={f.currencyCode} maxLength={3} onChange={(e) => set("currencyCode")(e.target.value.toUpperCase())} /></div>
      </div>
      <div><label className={labelCls}>Name</label><input className={inputCls} value={f.name} onChange={(e) => set("name")(e.target.value)} placeholder="e.g. India — New Regime (FY 2025-26)" /></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div><label className={labelCls}>Std deduction</label><input type="number" className={inputCls} value={f.standardDeduction} onChange={(e) => set("standardDeduction")(e.target.value)} /></div>
        <div><label className={labelCls}>FY start month</label><select className={inputCls} value={f.fiscalYearStartMonth} onChange={(e) => set("fiscalYearStartMonth")(e.target.value)}>{["1","2","3","4","5","6","7","8","9","10","11","12"].map((m) => <option key={m} value={m}>{new Date(2020, Number(m)-1).toLocaleString("en", { month: "short" })} ({m})</option>)}</select></div>
        <div><label className={labelCls}>Rebate ≤ taxable</label><input type="number" className={inputCls} value={f.rebateLimit} onChange={(e) => set("rebateLimit")(e.target.value)} /></div>
        <div><label className={labelCls}>Max rebate</label><input type="number" className={inputCls} value={f.rebateMaxAmount} onChange={(e) => set("rebateMaxAmount")(e.target.value)} /></div>
        <div><label className={labelCls}>Cess %</label><input type="number" className={inputCls} value={f.cessPercent} onChange={(e) => set("cessPercent")(e.target.value)} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className={labelCls}>Effective from</label><input type="date" className={inputCls} value={f.effectiveFrom} onChange={(e) => set("effectiveFrom")(e.target.value)} /></div>
        <div><label className={labelCls}>Source (provenance)</label><input className={inputCls} value={f.source} onChange={(e) => set("source")(e.target.value)} placeholder="Finance Act …" /></div>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between"><label className={labelCls}>Slabs</label><button type="button" onClick={() => setSlabs((p) => [...p, { lowerBound: "", upperBound: null, ratePercent: "" }])} className="text-xs font-medium text-brand">+ add slab</button></div>
        <div className="space-y-1.5">
          {slabs.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="number" className={inputCls} value={s.lowerBound} onChange={(e) => setSlab(i, "lowerBound", e.target.value)} placeholder="from" />
              <input type="number" className={inputCls} value={s.upperBound ?? ""} onChange={(e) => setSlab(i, "upperBound", e.target.value === "" ? null : e.target.value)} placeholder="to (blank = top)" />
              <input type="number" className={`${inputCls} max-w-[90px]`} value={s.ratePercent} onChange={(e) => setSlab(i, "ratePercent", e.target.value)} placeholder="%" />
              <button type="button" onClick={() => setSlabs((p) => p.filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-600"><Trash2 className="size-4" /></button>
            </div>
          ))}
        </div>
      </div>
      <button onClick={submit} disabled={busy || f.name.trim().length < 1 || slabs.length < 1} className={primaryBtn}><ShieldCheck className="size-4" /> Create rule set</button>
    </div>
  );
}

/* =============================== STATUTORY =============================== */
function StatutorySection({ can }: { can: PayrollAccess }) {
  const [rows, setRows] = useState<StatRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    fetch("/api/payroll/statutory/rules", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d: StatRule[]) => setRows(Array.isArray(d) ? d : []))
      .catch(async (r) => setError(await readError(r, "Could not load statutory rules.")));
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <Card>
      <CardHeader
        title="Statutory rules (PF / ESI / PT)"
        subtitle="Contribution rates, wage ceilings and applicability (effective-dated)"
        action={can.canStatutoryConfigure ? <button onClick={() => setOpen((o) => !o)} className={primaryBtn}><Plus className="size-4" /> {open ? "Close" : "Add rule"}</button> : null}
      />
      <CardBody className="space-y-4">
        {error ? <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">{error}</div> : null}
        {open && can.canStatutoryConfigure ? <StatutoryForm onDone={() => { setOpen(false); load(); }} onError={setError} /> : null}

        {rows === null ? (
          <p className="py-2 text-sm text-slate-400">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Landmark className="size-5" />} title="No statutory rules yet" hint={can.canStatutoryConfigure ? "Add PF / ESI / PT rules above." : "No statutory rules are configured."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-b border-hairline text-xs text-slate-500">
                <th className="px-3 py-2 text-left font-medium">Kind</th><th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-right font-medium">Employee</th><th className="px-3 py-2 text-right font-medium">Employer</th>
                <th className="px-3 py-2 text-right font-medium">Ceiling / Flat</th><th className="px-3 py-2 text-left font-medium">From</th>
              </tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="border-b border-hairline/60 last:border-0">
                    <td className="px-3 py-2"><span className="rounded-full bg-panel-2 px-2 py-0.5 text-xs font-medium text-slate-700">{s.kind}</span>{s.orgId === null ? <span className="ml-1 text-[10px] text-blue-600">platform</span> : null}</td>
                    <td className="px-3 py-2 text-slate-700">{s.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.flatAmount ? "—" : pct(s.employeeRate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.flatAmount ? "—" : pct(s.employerRate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{s.flatAmount ? `flat ${num(s.flatAmount)}` : s.wageCeiling ? `≤ ${num(s.wageCeiling)}` : "—"}{s.applicableUpto ? ` (if ≤ ${num(s.applicableUpto)})` : ""}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{s.effectiveFrom.slice(0, 10)} · v{s.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function StatutoryForm({ onDone, onError }: { onDone: () => void; onError: (e: string) => void }) {
  const [f, setF] = useState({ countryCode: "IN", kind: "PF", name: "Provident Fund (EPF)", employeeRate: "12", employerRate: "12", wageCeiling: "15000", applicableUpto: "", flatAmount: "", effectiveFrom: todayISO(), source: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  async function submit() {
    setBusy(true); onError("");
    try {
      const body = {
        countryCode: f.countryCode.trim().toUpperCase(), kind: f.kind, name: f.name.trim(),
        employeeRate: Number(f.employeeRate || 0), employerRate: Number(f.employerRate || 0),
        wageCeiling: f.wageCeiling ? Number(f.wageCeiling) : null, applicableUpto: f.applicableUpto ? Number(f.applicableUpto) : null,
        flatAmount: f.flatAmount ? Number(f.flatAmount) : null, effectiveFrom: f.effectiveFrom, source: f.source.trim() || null,
      };
      const res = await fetch("/api/payroll/statutory/rules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw res;
      onDone();
    } catch (r) { onError(await readError(r, "Could not create the statutory rule.")); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3 rounded-xl border border-hairline bg-panel-2/40 p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div><label className={labelCls}>Country</label><input className={inputCls} value={f.countryCode} maxLength={2} onChange={(e) => set("countryCode")(e.target.value.toUpperCase())} /></div>
        <div><label className={labelCls}>Kind</label><input className={inputCls} list="statutory-kinds" value={f.kind} onChange={(e) => set("kind")(e.target.value.toUpperCase())} placeholder="PF / SS / …" /><datalist id="statutory-kinds">{KINDS.map((k) => <option key={k} value={k} />)}</datalist></div>
        <div className="col-span-2"><label className={labelCls}>Name</label><input className={inputCls} value={f.name} onChange={(e) => set("name")(e.target.value)} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div><label className={labelCls}>Employee %</label><input type="number" className={inputCls} value={f.employeeRate} onChange={(e) => set("employeeRate")(e.target.value)} /></div>
        <div><label className={labelCls}>Employer %</label><input type="number" className={inputCls} value={f.employerRate} onChange={(e) => set("employerRate")(e.target.value)} /></div>
        <div><label className={labelCls}>Wage ceiling</label><input type="number" className={inputCls} value={f.wageCeiling} onChange={(e) => set("wageCeiling")(e.target.value)} placeholder="cap the base" /></div>
        <div><label className={labelCls}>Flat amount</label><input type="number" className={inputCls} value={f.flatAmount} onChange={(e) => set("flatAmount")(e.target.value)} placeholder="PT" /></div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div><label className={labelCls}>Applies if base ≤</label><input type="number" className={inputCls} value={f.applicableUpto} onChange={(e) => set("applicableUpto")(e.target.value)} placeholder="ESI 21000" /></div>
        <div><label className={labelCls}>Effective from</label><input type="date" className={inputCls} value={f.effectiveFrom} onChange={(e) => set("effectiveFrom")(e.target.value)} /></div>
        <div><label className={labelCls}>Source</label><input className={inputCls} value={f.source} onChange={(e) => set("source")(e.target.value)} placeholder="EPFO / ESIC …" /></div>
      </div>
      <button onClick={submit} disabled={busy || f.name.trim().length < 1} className={primaryBtn}><ShieldCheck className="size-4" /> Create statutory rule</button>
    </div>
  );
}
