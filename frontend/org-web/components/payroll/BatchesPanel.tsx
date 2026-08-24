"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Layers, Plus } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { SkeletonTableCard } from "@/components/ui/Skeleton";
import { LocalTime } from "@/components/ui/LocalTime";
import { formatDate } from "@/lib/format";
import type { EmployeeRow, OffsetPage, PayoutBatch, PayoutBatchDetail, PayoutPeriod, PayoutRecord } from "@/lib/api";
import type { PayrollAccess } from "./access";
import { RecordPanel } from "./RecordPanel";
import { EmployeeRef, EmptyState, PayoutStatusBadge, btn, field, money } from "./payout-ui";

function shortRange(start: string, end: string): string {
  return `${formatDate(start).replace(/, \d{4}$/, "")} – ${formatDate(end)}`;
}

// A lifecycle action, shown only when the caller holds `perm` AND the batch is in
// one of `statuses`. Mirrors the batch/approval service's allowed-state guards.
interface Action {
  key: "freeze" | "calculate" | "validate" | "submit" | "approve" | "reject" | "hold" | "release" | "close";
  label: string;
  perm: keyof PayrollAccess;
  statuses: string[];
  variant: keyof typeof btn;
  needsReason?: boolean;
}

const LIFECYCLE: Action[] = [
  { key: "freeze", label: "Freeze inputs", perm: "canCalculate", statuses: ["DRAFT", "INPUT_COLLECTION"], variant: "ghost" },
  { key: "calculate", label: "Calculate", perm: "canCalculate", statuses: ["INPUT_COLLECTION", "CALCULATION", "VALIDATION", "REVIEW"], variant: "primary" },
  { key: "validate", label: "Validate", perm: "canValidate", statuses: ["CALCULATION", "VALIDATION", "REVIEW"], variant: "ghost" },
  { key: "submit", label: "Submit for approval", perm: "canSubmit", statuses: ["REVIEW"], variant: "primary" },
  { key: "approve", label: "Approve", perm: "canApprove", statuses: ["PENDING_APPROVAL"], variant: "primary" },
  { key: "reject", label: "Reject", perm: "canReject", statuses: ["PENDING_APPROVAL"], variant: "danger", needsReason: true },
  { key: "hold", label: "Hold", perm: "canHold", statuses: ["INPUT_COLLECTION", "CALCULATION", "VALIDATION", "REVIEW", "PENDING_APPROVAL", "APPROVED"], variant: "ghost", needsReason: true },
  { key: "release", label: "Release hold", perm: "canRelease", statuses: ["ON_HOLD"], variant: "primary" },
  { key: "close", label: "Close", perm: "canClose", statuses: ["APPROVED", "PAID"], variant: "ghost" },
];

const deductionsOf = (r: PayoutRecord) => r.preTaxDeductions + r.employeeStatutory + r.postTaxDeductions + r.taxDeduction;

export function BatchesPanel({ can }: { can: PayrollAccess }) {
  const [batches, setBatches] = useState<PayoutBatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  // create
  const [createOpen, setCreateOpen] = useState(false);
  const [periods, setPeriods] = useState<PayoutPeriod[] | null>(null);
  const [form, setForm] = useState({ periodId: "", name: "", note: "" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // detail
  const [detail, setDetail] = useState<PayoutBatchDetail | null>(null);
  const [records, setRecords] = useState<PayoutRecord[] | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // reason prompt (reject / hold) + record modal
  const [reasonFor, setReasonFor] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [recordId, setRecordId] = useState<string | null>(null);

  const loadBatches = useCallback(() => {
    fetch("/api/payroll/batches", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(typeof d?.error === "string" ? d.error : "Could not load batches.");
        return d as PayoutBatch[];
      })
      .then((d) => setBatches(Array.isArray(d) ? d : []))
      .catch((e) => {
        setBatches([]);
        setError(e.message);
      });
  }, []);

  useEffect(() => {
    loadBatches();
    // Best-effort directory for display names; a finance role without employee.read
    // simply sees short employee references instead.
    fetch("/api/employees?page=1&pageSize=500", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: OffsetPage<EmployeeRow> | null) => {
        if (!d?.items) return;
        const map: Record<string, string> = {};
        for (const e of d.items) map[e.id] = `${e.firstName} ${e.lastName}`.trim();
        setNames(map);
      })
      .catch(() => undefined);
  }, [loadBatches]);

  const openCreate = () => {
    setForm({ periodId: "", name: "", note: "" });
    setCreateError(null);
    setCreateOpen(true);
    if (!periods) {
      fetch("/api/payroll/periods", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .then((d: PayoutPeriod[]) => setPeriods(Array.isArray(d) ? d : []))
        .catch(() => setPeriods([]));
    }
  };

  const loadDetail = useCallback((id: string) => {
    setDetailLoading(true);
    setActionError(null);
    Promise.all([
      fetch(`/api/payroll/batches/${id}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/payroll/batches/${id}/records`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([d, recs]) => {
        setDetail(d as PayoutBatchDetail);
        setRecords(Array.isArray(recs) ? (recs as PayoutRecord[]) : []);
      })
      .catch(() => undefined)
      .finally(() => setDetailLoading(false));
  }, []);

  const openDetail = (id: string) => {
    setDetail(null);
    setRecords(null);
    setDetailOpen(true);
    loadDetail(id);
  };

  const createBatch = () => {
    if (!form.periodId || !form.name.trim()) {
      setCreateError("Pick a pay period and give the batch a name.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    fetch("/api/payroll/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ periodId: form.periodId, name: form.name.trim(), note: form.note.trim() || undefined }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof d?.error === "string" ? d.error : "Could not create the batch.");
        return d as PayoutBatch;
      })
      .then((b) => {
        setCreateOpen(false);
        loadBatches();
        openDetail(b.id);
      })
      .catch((e) => setCreateError(e.message))
      .finally(() => setCreating(false));
  };

  const runAction = (action: Action, body?: Record<string, unknown>) => {
    if (!detail) return;
    setActing(action.key);
    setActionError(null);
    fetch(`/api/payroll/batches/${detail.id}/${action.key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof d?.error === "string" ? d.error : `Could not ${action.label.toLowerCase()}.`);
      })
      .then(() => {
        loadDetail(detail.id);
        loadBatches();
      })
      .catch((e) => setActionError(e.message))
      .finally(() => setActing(null));
  };

  const onAction = (action: Action) => {
    if (action.needsReason) {
      setReason("");
      setReasonFor(action);
    } else {
      runAction(action);
    }
  };

  const submitReason = () => {
    if (!reasonFor) return;
    if (reason.trim().length < 3) return;
    runAction(reasonFor, { reason: reason.trim() });
    setReasonFor(null);
  };

  const availableActions = useMemo(() => {
    if (!detail) return [];
    return LIFECYCLE.filter((a) => can[a.perm] && a.statuses.includes(detail.status));
  }, [detail, can]);

  const nameFor = (id: string) => names[id];

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <Card>
        <CardHeader
          title="Payroll batches"
          subtitle="Each batch runs one period in a single currency through the full lifecycle"
          action={
            can.canBatchCreate ? (
              <button onClick={openCreate} className={btn.primary}>
                <Plus className="size-4" /> New batch
              </button>
            ) : null
          }
        />
        {batches === null ? (
          <div className="p-5"><SkeletonTableCard rows={5} cols={5} /></div>
        ) : batches.length === 0 ? (
          <EmptyState
            icon={<Layers className="size-5" />}
            title="No batches yet"
            hint={can.canBatchCreate ? "Create a batch for the current pay period to start a payroll run." : "Batches will appear here once payroll is run for a period."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-xs text-slate-500">
                  <th className="px-5 py-3 text-left font-medium">Batch</th>
                  <th className="px-5 py-3 text-left font-medium">Period</th>
                  <th className="px-5 py-3 text-left font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Employees</th>
                  <th className="px-5 py-3 text-right font-medium">Net total</th>
                  <th className="px-5 py-3 text-right font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} onClick={() => openDetail(b.id)} className="cursor-pointer border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <span className="font-medium text-slate-800">{b.name}</span>
                      <span className="ml-2 text-xs text-slate-400">{b.currencyCode}{b.countryCode ? ` · ${b.countryCode}` : ""}</span>
                    </td>
                    <td className="px-5 py-3 tabular-nums text-slate-600">{b.period ? shortRange(b.period.periodStart, b.period.periodEnd) : "—"}</td>
                    <td className="px-5 py-3"><PayoutStatusBadge status={b.status} /></td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-600">{b.employeeCount}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-medium text-slate-900">{money(b.netTotal, b.currencyCode)}</td>
                    <td className="px-5 py-3 text-right text-xs text-slate-400"><LocalTime iso={b.updatedAt} mode="date" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ---------------- create ---------------- */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New payroll batch" size="md">
        <div className="space-y-4">
          <div>
            <label className={field.label}>Pay period</label>
            <select className={field.input} value={form.periodId} onChange={(e) => setForm({ ...form, periodId: e.target.value })}>
              <option value="">{periods === null ? "Loading periods…" : "Select a period"}</option>
              {(periods ?? []).map((p) => (
                <option key={p.id} value={p.id} disabled={p.status === "CLOSED"}>
                  {shortRange(p.periodStart, p.periodEnd)} · {p.status.toLowerCase()}{p.status === "CLOSED" ? " (closed)" : ""}
                </option>
              ))}
            </select>
            {periods !== null && periods.length === 0 ? (
              <p className="mt-1.5 text-xs text-slate-400">No pay periods exist yet — create one in the payroll calendar first.</p>
            ) : null}
          </div>
          <div>
            <label className={field.label}>Batch name</label>
            <input className={field.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. August 2026 — Full-time" />
          </div>
          <div>
            <label className={field.label}>Note (optional)</label>
            <input className={field.input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Anything reviewers should know" />
          </div>
          {createError ? <p className="text-sm text-rose-600">{createError}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreateOpen(false)} className={btn.ghost}>Cancel</button>
            <button onClick={createBatch} disabled={creating} className={btn.primary}>
              <Plus className="size-4" /> {creating ? "Creating…" : "Create batch"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ---------------- detail ---------------- */}
      <Modal open={detailOpen} onClose={() => setDetailOpen(false)} title={detail?.name ?? "Payroll batch"} size="lg">
        {detailLoading || !detail ? (
          <p className="py-10 text-center text-sm text-slate-500">Loading batch…</p>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-panel-2 px-4 py-3">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  {detail.name} <PayoutStatusBadge status={detail.status} />
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {detail.period ? shortRange(detail.period.periodStart, detail.period.periodEnd) : "—"} · {detail.currencyCode}
                  {detail.calculatedAt ? <> · calculated <LocalTime iso={detail.calculatedAt} mode="date" /></> : null}
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-semibold tabular-nums text-slate-900">{money(detail.netTotal, detail.currencyCode)}</p>
                <p className="text-xs text-slate-500">{detail.employeeCount} employee{detail.employeeCount === 1 ? "" : "s"} · gross {money(detail.grossTotal, detail.currencyCode)}</p>
              </div>
            </div>

            {/* Excluded members */}
            {detail.members?.some((m) => !m.included) ? (
              <div className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  <span className="font-medium">Excluded:</span>{" "}
                  {detail.members.filter((m) => !m.included).map((m) => `${nameFor(m.employeeId) ?? m.employeeId.slice(0, 6)}${m.excludeReason ? ` (${m.excludeReason})` : ""}`).join(", ")}
                </span>
              </div>
            ) : null}

            {/* Records */}
            <div className="overflow-x-auto rounded-xl border border-hairline/70">
              <table className="w-full min-w-[620px] text-sm">
                <thead>
                  <tr className="border-b border-hairline text-xs text-slate-500">
                    <th className="px-4 py-2.5 text-left font-medium">Employee</th>
                    <th className="px-4 py-2.5 text-left font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Gross</th>
                    <th className="px-4 py-2.5 text-right font-medium">Deductions</th>
                    <th className="px-4 py-2.5 text-right font-medium">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {(records ?? []).map((r) => (
                    <tr key={r.id} onClick={() => can.canRecordRead && setRecordId(r.id)} className={`border-b border-hairline/60 last:border-0 ${can.canRecordRead ? "cursor-pointer hover:bg-slate-50" : ""}`}>
                      <td className="px-4 py-2.5 font-medium text-slate-800">{nameFor(r.employeeId) ?? <EmployeeRef id={r.employeeId} />}</td>
                      <td className="px-4 py-2.5"><PayoutStatusBadge status={r.status} /></td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{money(r.grossEarnings, r.currencyCode)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{money(deductionsOf(r), r.currencyCode)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium text-slate-900">{money(r.netPayable, r.currencyCode)}</td>
                    </tr>
                  ))}
                  {records !== null && records.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">No records yet — freeze inputs and calculate to populate this batch.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            {actionError ? <p className="text-sm text-rose-600">{actionError}</p> : null}

            {/* Lifecycle actions */}
            {availableActions.length > 0 ? (
              <div className="flex flex-wrap justify-end gap-2 border-t border-hairline pt-4">
                {availableActions.map((a) => (
                  <button key={a.key} onClick={() => onAction(a)} disabled={acting !== null} className={btn[a.variant]}>
                    {acting === a.key ? "Working…" : a.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="border-t border-hairline pt-4 text-right text-xs text-slate-400">
                No further actions available to you for a {detail.status.replace(/_/g, " ").toLowerCase()} batch.
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* reason prompt for reject / hold */}
      <Modal open={Boolean(reasonFor)} onClose={() => setReasonFor(null)} title={reasonFor?.label ?? "Reason"} size="sm">
        <div className="space-y-4">
          <div>
            <label className={field.label}>Reason</label>
            <textarea
              className={`${field.input} min-h-[90px] resize-y`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why (visible in the audit trail)"
            />
            <p className="mt-1 text-xs text-slate-400">At least 3 characters.</p>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setReasonFor(null)} className={btn.ghost}>Cancel</button>
            <button onClick={submitReason} disabled={reason.trim().length < 3} className={reasonFor?.variant === "danger" ? btn.danger : btn.primary}>
              {reasonFor?.label}
            </button>
          </div>
        </div>
      </Modal>

      <RecordPanel recordId={recordId} employeeName={recordId ? nameFor((records ?? []).find((r) => r.id === recordId)?.employeeId ?? "") : undefined} onClose={() => setRecordId(null)} />
    </div>
  );
}
