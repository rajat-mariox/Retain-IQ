"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, FileText, Layers, Plus, Search, Send, UserPlus } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { SkeletonTableCard } from "@/components/ui/Skeleton";
import { LocalTime } from "@/components/ui/LocalTime";
import { formatDate } from "@/lib/format";
import type { PayoutBatch, PayoutBatchDetail, PayoutPeriod, PayoutRecord } from "@/lib/api";
import type { PayrollAccess } from "./access";
import { RecordPanel } from "./RecordPanel";
import { EmployeeRef, EmptyState, PayoutStatusBadge, btn, field, money } from "./payout-ui";
import { useEmployeeDirectory } from "./workspace-shared";

function shortRange(start: string, end: string): string {
  return `${formatDate(start).replace(/, \d{4}$/, "")} – ${formatDate(end)}`;
}

// A lifecycle action, shown only when the caller holds `perm` AND the batch is in
// one of `statuses`. Mirrors the batch/approval service's allowed-state guards.
interface Action {
  key: "freeze" | "calculate" | "validate" | "submit" | "approve" | "reject" | "hold" | "release" | "close" | "cancel";
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
  // Abandon a run before payment. Releases any claimed variable pay/overtime.
  { key: "cancel", label: "Cancel batch", perm: "canClose", statuses: ["DRAFT", "INPUT_COLLECTION", "CALCULATION", "VALIDATION", "REVIEW", "PENDING_APPROVAL", "ON_HOLD", "REJECTED"], variant: "danger", needsReason: true },
];

// Payslips are produced only AFTER payment — mirrors the statement service's
// PAYABLE_STATEMENT_STATUSES. (Generation also runs automatically on payment.)
const PAID_BATCH = new Set(["PAID", "CLOSED"]);

const deductionsOf = (r: PayoutRecord) => r.preTaxDeductions + r.employeeStatutory + r.postTaxDeductions + r.taxDeduction;

export function BatchesPanel({ can }: { can: PayrollAccess }) {
  const [batches, setBatches] = useState<PayoutBatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Reachable employees for name display + the add-to-batch picker (Owner excluded, ABAC-scoped).
  const { byId: dirById, list: directory } = useEmployeeDirectory();

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

  // add-employees picker
  const [addOpen, setAddOpen] = useState(false);
  const [addSel, setAddSel] = useState<Set<string>>(new Set());
  const [addSearch, setAddSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // generate payslips (payout statements) for a finalized batch
  const [genBusy, setGenBusy] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);

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
    setGenMsg(null);
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

  // Add selected employees to the open batch. Only allowed while the batch is still
  // collecting inputs (DRAFT / INPUT_COLLECTION); the backend enforces reach, the
  // Owner exclusion and currency/entity compatibility and surfaces any rejection.
  const addEmployees = () => {
    if (!detail || addSel.size === 0) return;
    setAdding(true);
    setAddError(null);
    fetch(`/api/payroll/batches/${detail.id}/employees`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeIds: [...addSel] }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof d?.error === "string" ? d.error : "Could not add employees to the batch.");
      })
      .then(() => {
        setAddOpen(false);
        setAddSel(new Set());
        setAddSearch("");
        loadDetail(detail.id);
        loadBatches();
      })
      .catch((e) => setAddError(e.message))
      .finally(() => setAdding(false));
  };

  // Reachable employees not already in the batch, filtered by the search box.
  const addCandidates = useMemo(() => {
    const memberIds = new Set((detail?.members ?? []).filter((m) => m.included).map((m) => m.employeeId));
    const q = addSearch.trim().toLowerCase();
    return directory
      .filter((e) => !memberIds.has(e.id))
      .filter((e) => !q || e.name.toLowerCase().includes(q) || (e.title ?? "").toLowerCase().includes(q) || (e.department ?? "").toLowerCase().includes(q));
  }, [directory, detail, addSearch]);

  const includedCount = detail?.members?.filter((m) => m.included).length ?? 0;
  const canAddMembers = can.canBatchCreate && (detail?.status === "DRAFT" || detail?.status === "INPUT_COLLECTION");

  // Payslips are generated automatically on payment; these admin actions let you
  // (re)generate and then publish (release) them to employees. Paid batches only.
  const canGenPayslips = Boolean(can.canStatementGenerate && detail && PAID_BATCH.has(detail.status));
  const postStatements = (path: string, ok: (d: { generated?: number; published?: number }) => string) => {
    if (!detail) return;
    setGenBusy(true);
    setGenMsg(null);
    fetch(`/api/payroll/batches/${detail.id}/statements${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof d?.error === "string" ? d.error : "Could not complete the payslip action.");
        return d as { generated?: number; published?: number };
      })
      .then((d) => setGenMsg(ok(d)))
      .catch((e) => setGenMsg(e.message))
      .finally(() => setGenBusy(false));
  };
  const generatePayslips = () => postStatements("", (d) => {
    const n = d.generated ?? 0;
    return n === 0 ? "No payslips to generate — the batch has no paid records yet." : `✓ ${n} payslip${n === 1 ? "" : "s"} generated.`;
  });
  const publishPayslips = () => postStatements("/publish", (d) => {
    const n = d.published ?? 0;
    return n === 0
      ? "Nothing to publish — these payslips are already published (or none are generated yet)."
      : `✓ ${n} payslip${n === 1 ? "" : "s"} published — those employees were notified.`;
  });

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

  const nameFor = (id: string) => dirById.get(id)?.name;

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

            {/* Members + add employees */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Members · {includedCount}</p>
              {canAddMembers ? (
                <button onClick={() => { setAddSel(new Set()); setAddSearch(""); setAddError(null); setAddOpen(true); }} className={btn.ghost}>
                  <UserPlus className="size-4" /> Add employees
                </button>
              ) : null}
            </div>

            {includedCount === 0 && canAddMembers ? (
              <div className="flex gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800 ring-1 ring-inset ring-blue-200">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>This batch has no employees yet. Add employees first — then Freeze inputs and Calculate to populate it.</span>
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
            {genMsg ? <p className={`text-sm ${genMsg.startsWith("✓") ? "text-emerald-700" : "text-rose-600"}`}>{genMsg}</p> : null}

            {/* Payslips + lifecycle actions */}
            {availableActions.length > 0 || canGenPayslips ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-4">
                <div className="flex flex-wrap gap-2">
                  {canGenPayslips ? (
                    <>
                      <button onClick={generatePayslips} disabled={genBusy} className={btn.ghost}>
                        <FileText className="size-4" /> {genBusy ? "Working…" : "Generate payslips"}
                      </button>
                      <button onClick={publishPayslips} disabled={genBusy} className={btn.ghost}>
                        <Send className="size-4" /> Publish to employees
                      </button>
                    </>
                  ) : null}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {availableActions.map((a) => (
                    <button key={a.key} onClick={() => onAction(a)} disabled={acting !== null} className={btn[a.variant]}>
                      {acting === a.key ? "Working…" : a.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="border-t border-hairline pt-4 text-right text-xs text-slate-400">
                No further actions available to you for a {detail.status.replace(/_/g, " ").toLowerCase()} batch.
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* add employees picker */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add employees to batch" size="md">
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Only employees within your reach are shown; the Owner is excluded. Each employee&rsquo;s pay profile must match this batch&rsquo;s currency and entity — the server will flag any that don&rsquo;t.
          </p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input className={`${field.input} pl-9`} placeholder="Search employees…" value={addSearch} onChange={(e) => setAddSearch(e.target.value)} />
          </div>
          <div className="max-h-72 divide-y divide-hairline/60 overflow-y-auto rounded-xl border border-hairline/70">
            {addCandidates.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                {directory.length === 0 ? "No reachable employees found." : "Everyone within your reach is already in this batch."}
              </p>
            ) : (
              addCandidates.map((e) => {
                const on = addSel.has(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setAddSel((prev) => { const n = new Set(prev); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; })}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50"
                  >
                    <span className={`flex size-5 items-center justify-center rounded border ${on ? "border-brand bg-brand text-white" : "border-hairline"}`}>
                      {on ? <Check className="size-3.5" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-800">{e.name}</span>
                      {e.title || e.department ? <span className="block truncate text-xs text-slate-400">{[e.title, e.department].filter(Boolean).join(" · ")}</span> : null}
                    </span>
                    {e.status !== "ACTIVE" ? <span className="ml-auto shrink-0 text-xs text-slate-400">{e.status.toLowerCase()}</span> : null}
                  </button>
                );
              })
            )}
          </div>
          {addError ? <p className="text-sm text-rose-600">{addError}</p> : null}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500">{addSel.size} selected</span>
            <div className="flex gap-2">
              <button onClick={() => setAddOpen(false)} className={btn.ghost}>Cancel</button>
              <button onClick={addEmployees} disabled={adding || addSel.size === 0} className={btn.primary}>
                <UserPlus className="size-4" /> {adding ? "Adding…" : addSel.size ? `Add ${addSel.size}` : "Add"}
              </button>
            </div>
          </div>
        </div>
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
