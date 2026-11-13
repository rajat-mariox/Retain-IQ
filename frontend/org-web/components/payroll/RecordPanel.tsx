"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import type { PayoutRecordDetail } from "@/lib/api";
import { EmployeeRef, PayoutStatusBadge, money } from "./payout-ui";

/**
 * A single payroll record (§8/§26): the explainable earnings → deductions → tax →
 * net breakdown, plus the component-level lines that produced it. Opened as a
 * modal from the batch detail; fetches GET /api/payroll/records/:id on open.
 */
export function RecordPanel({
  recordId,
  employeeName,
  onClose,
}: {
  recordId: string | null;
  employeeName?: string;
  onClose: () => void;
}) {
  const [record, setRecord] = useState<PayoutRecordDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!recordId) {
      setRecord(null);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/payroll/records/${recordId}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(typeof d?.error === "string" ? d.error : "Could not load this record.");
        return d as PayoutRecordDetail;
      })
      .then((d) => alive && setRecord(d))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [recordId]);

  const cur = record?.currencyCode ?? "USD";
  const errors = Array.isArray(record?.errors) ? (record!.errors as unknown[]).map(String) : [];
  const warnings = Array.isArray(record?.warnings) ? (record!.warnings as unknown[]).map(String) : [];

  return (
    <Modal open={Boolean(recordId)} onClose={onClose} title="Payroll record" size="lg">
      {loading || !record ? (
        error ? (
          <p className="py-10 text-center text-sm text-rose-600">{error}</p>
        ) : (
          <p className="py-10 text-center text-sm text-slate-500">Loading record…</p>
        )
      ) : (
        <div className="space-y-5">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-panel-2 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">{employeeName ?? <EmployeeRef id={record.employeeId} />}</p>
              <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                <PayoutStatusBadge status={record.status} />
                {record.prorationFactor !== 1 ? <span>prorated ×{record.prorationFactor.toFixed(2)}</span> : null}
              </p>
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold tabular-nums text-slate-900">{money(record.netPayable, cur)}</p>
              <p className="text-xs text-slate-500">net payable</p>
            </div>
          </div>

          {errors.length > 0 ? (
            <div className="flex gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800 ring-1 ring-inset ring-rose-200">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span><span className="font-medium">Validation errors:</span> {errors.join("; ")}</span>
            </div>
          ) : null}
          {warnings.length > 0 ? (
            <div className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span><span className="font-medium">Warnings:</span> {warnings.join("; ")}</span>
            </div>
          ) : null}

          {/* Waterfall: earnings → deductions → tax → net */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Section title="Earnings" tone="up">
              <Line label="Regular" value={money(record.regularEarnings, cur)} />
              <Line label="Variable pay" value={money(record.variableEarnings, cur)} />
              <Line label="Overtime" value={money(record.overtimeAmount, cur)} />
              <Line label="Reimbursements" value={money(record.reimbursements, cur)} />
              <Total label="Gross earnings" value={money(record.grossEarnings, cur)} />
            </Section>

            <Section title="Deductions" tone="down">
              <Line label="Pre-tax deductions" value={money(record.preTaxDeductions, cur)} />
              <Line label="Statutory (employee)" value={money(record.employeeStatutory, cur)} />
              <Line label="Post-tax deductions" value={money(record.postTaxDeductions, cur)} />
              {record.adjustments !== 0 ? <Line label="Adjustments" value={money(record.adjustments, cur)} /> : null}
              <Total label="Total deductions" value={money(record.preTaxDeductions + record.employeeStatutory + record.postTaxDeductions, cur)} />
            </Section>

            <Section title="Tax" tone="down">
              <Line label="Taxable income" value={money(record.taxableIncome, cur)} muted />
              <Total label="Income tax" value={money(record.taxDeduction, cur)} />
            </Section>

            <Section title="Employer cost" tone="up">
              <Line label="Employer contributions" value={money(record.employerContrib, cur)} />
              <Total label="Total employer cost" value={money(record.employerCost, cur)} />
            </Section>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-hairline bg-panel px-4 py-3">
            <span className="text-sm font-medium text-slate-600">Net payable</span>
            <span className="text-lg font-semibold tabular-nums text-slate-900">{money(record.netPayable, cur)}</span>
          </div>

          {/* Component-level explainability */}
          {record.components.length > 0 ? (
            <div className="rounded-xl border border-hairline/70">
              <p className="border-b border-hairline/60 bg-panel-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Component breakdown
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-xs text-slate-500">
                      <th className="px-4 py-2 text-left font-medium">Component</th>
                      <th className="px-4 py-2 text-left font-medium">Type</th>
                      <th className="px-4 py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {record.components.map((c) => (
                      <tr key={c.id} className="border-b border-hairline/60 last:border-0">
                        <td className="px-4 py-2">
                          <span className="font-medium text-slate-800">{c.name}</span>
                          <span className="ml-1.5 font-mono text-xs text-slate-400">{c.code}</span>
                          <span className="mt-0.5 flex flex-wrap gap-1">
                            {c.taxable ? <Tag>taxable</Tag> : null}
                            {c.statutory ? <Tag>statutory</Tag> : null}
                            {c.employerPaid ? <Tag>employer</Tag> : null}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-500">
                          {c.direction === "DEDUCTION" ? "Deduction" : "Earning"} · {c.category}
                        </td>
                        <td className={`px-4 py-2 text-right tabular-nums font-medium ${c.direction === "DEDUCTION" ? "text-rose-600" : "text-slate-800"}`}>
                          {c.direction === "DEDUCTION" ? "−" : ""}{money(Math.abs(c.amount), cur)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function Section({ title, tone, children }: { title: string; tone: "up" | "down"; children: React.ReactNode }) {
  const Icon = tone === "up" ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="rounded-xl border border-hairline/70 p-4">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <Icon className={`size-3.5 ${tone === "up" ? "text-emerald-500" : "text-slate-400"}`} />
        {title}
      </p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Line({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={`tabular-nums ${muted ? "text-slate-500" : "text-slate-700"}`}>{value}</span>
    </div>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-1 flex items-baseline justify-between border-t border-hairline/60 pt-2 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <span className="tabular-nums font-semibold text-slate-900">{value}</span>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-inset ring-hairline">{children}</span>;
}
