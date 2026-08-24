"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { CheckCheck, ClipboardCheck, Coins, Plus, ScrollText, XCircle } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { StatTile } from "@/components/ui/StatTile";
import { SkeletonTableCard } from "@/components/ui/Skeleton";
import { PaginatedTable } from "@/components/ui/Pagination";
import type { OrgSession } from "@/lib/api";
import { btn, humanizeStatus, PayoutStatusBadge } from "./payout-ui";
import { can, EmployeePicker, inputCls, labelCls, money, NoAccess, primaryBtn, readError, secondaryBtn, useEmployeeDirectory } from "./workspace-shared";

const TYPES = ["POSITIVE", "NEGATIVE", "ARREAR", "RECOVERY", "TAX_CORRECTION", "REVERSAL"] as const;
const ALL_STATUSES = ["CORRECTION_REQUESTED", "REVIEWED", "APPROVED", "REJECTED", "SETTLED"] as const;

const numOrUndef = (s: string): number | undefined => (s.trim() === "" ? undefined : Number(s));
const signedMoney = (amount: number, currency = "USD") => `${amount > 0 ? "+" : amount < 0 ? "-" : ""}${money(Math.abs(amount), currency)}`;

interface Adjustment {
  id: string;
  employeeId: string;
  employeeName: string | null;
  originalRecordId: string | null;
  componentCode: string | null;
  adjustmentType: string;
  previousValue: number | null;
  correctedValue: number | null;
  difference: number;
  currencyCode: string;
  reason: string;
  evidenceKey: string | null;
  status: string;
  settlementBatchId: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}
interface Summary {
  total: number;
  pendingReview: number;
  pendingApproval: number;
  approved: number;
  settled: number;
}

/**
 * Payroll adjustments / corrections (§20). A locked record is never mutated in
 * place — a correction captures the delta and flows CORRECTION_REQUESTED →
 * REVIEWED → APPROVED → SETTLED. Approval enforces separation of duties (you can't
 * approve your own), which the backend rejects and this surfaces.
 */
export function AdjustmentsPanel({ session }: { session: OrgSession }) {
  const canReview = can(session, "payroll.adjustment.review");
  const canCreate = can(session, "payroll.adjustment.create");
  const canApprove = can(session, "payroll.adjustment.approve");

  const { list: employees } = useEmployeeDirectory();

  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Adjustment[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [statusFilter, setStatusFilter] = useState("");

  const [detail, setDetail] = useState<Adjustment | null>(null);
  const [note, setNote] = useState("");
  const [settlementBatchId, setSettlementBatchId] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const emptyForm = { employeeId: "", adjustmentType: "POSITIVE", componentCode: "", previousValue: "", correctedValue: "", difference: "", reason: "" };
  const [form, setForm] = useState(emptyForm);

  const reload = useCallback(() => {
    const qs = statusFilter ? `?status=${statusFilter}` : "";
    fetch(`/api/payroll/adjustments${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setRows(Array.isArray(d?.items) ? d.items : []);
        setSummary(d?.summary ?? null);
      })
      .catch(() => setRows([]));
  }, [statusFilter]);
  useEffect(() => {
    if (canReview) reload();
  }, [canReview, reload]);

  const openDetail = (a: Adjustment) => {
    setError(null);
    setNote("");
    setSettlementBatchId("");
    setDetail(a);
  };

  const act = (id: string, action: "review" | "approve" | "reject") =>
    start(async () => {
      setError(null);
      const res = await fetch(`/api/payroll/adjustments/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setError(readError(d, `Could not ${action} this correction.`));
      setDetail(d?.id ? d : null);
      reload();
    });

  const settle = () =>
    start(async () => {
      if (!detail) return;
      setError(null);
      const res = await fetch(`/api/payroll/adjustments/${detail.id}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settlementBatchId: settlementBatchId.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setError(readError(d, "Could not settle this correction."));
      setDetail(d?.id ? d : null);
      reload();
    });

  const create = () =>
    start(async () => {
      setError(null);
      const res = await fetch("/api/payroll/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: form.employeeId.trim(),
          adjustmentType: form.adjustmentType,
          componentCode: form.componentCode.trim() || undefined,
          previousValue: numOrUndef(form.previousValue),
          correctedValue: numOrUndef(form.correctedValue),
          difference: numOrUndef(form.difference),
          reason: form.reason.trim(),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setError(readError(d, "Could not create the correction."));
      setCreateOpen(false);
      setForm(emptyForm);
      reload();
    });

  if (!canReview && !canCreate) {
    return (
      <Card>
        <NoAccess>You don&apos;t have access to payroll corrections.</NoAccess>
      </Card>
    );
  }

  const createValid = Boolean(form.employeeId.trim() && form.reason.trim().length >= 3 && (form.difference.trim() || form.previousValue.trim() || form.correctedValue.trim()));

  return (
    <div className="space-y-6">
      {error && !detail && !createOpen ? <p className="text-sm text-rose-600">{error}</p> : null}

      {canReview && summary ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Pending review" value={String(summary.pendingReview)} icon={ClipboardCheck} accent="#d97706" />
          <StatTile label="Pending approval" value={String(summary.pendingApproval)} icon={ScrollText} accent="#0284c7" />
          <StatTile label="Approved" value={String(summary.approved)} icon={CheckCheck} />
          <StatTile label="Settled" value={String(summary.settled)} icon={Coins} />
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Corrections"
          subtitle="Post-payroll adjustments raised against locked records"
          action={
            <div className="flex items-center gap-2">
              {canReview ? (
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm text-slate-700 focus:border-brand focus:outline-none">
                  <option value="">All statuses</option>
                  {ALL_STATUSES.map((s) => <option key={s} value={s}>{humanizeStatus(s)}</option>)}
                </select>
              ) : null}
              {canCreate ? (
                <button onClick={() => { setError(null); setForm(emptyForm); setCreateOpen(true); }} className={primaryBtn}>
                  <Plus className="size-4" /> New correction
                </button>
              ) : null}
            </div>
          }
        />
        {!canReview ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">You can raise corrections; reviewing the queue needs the review permission.</p>
        ) : rows === null ? (
          <div className="p-5"><SkeletonTableCard rows={5} cols={5} /></div>
        ) : (
          <PaginatedTable
            minWidth="min-w-[760px]"
            head={
              <tr className="border-b border-hairline text-xs text-slate-500">
                <th className="px-5 py-3 text-left font-medium">Employee</th>
                <th className="px-5 py-3 text-left font-medium">Type</th>
                <th className="px-5 py-3 text-left font-medium">Component</th>
                <th className="px-5 py-3 text-right font-medium">Difference</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Raised</th>
              </tr>
            }
            empty={<tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">No corrections raised yet.</td></tr>}
            rows={rows.map((a) => (
              <tr key={a.id} onClick={() => openDetail(a)} className="cursor-pointer border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                <td className="px-5 py-3 font-medium text-slate-900">{a.employeeName ?? "—"}</td>
                <td className="px-5 py-3 text-xs text-slate-500">{humanizeStatus(a.adjustmentType)}</td>
                <td className="px-5 py-3 text-xs text-slate-500">{a.componentCode ?? "—"}</td>
                <td className={`px-5 py-3 text-right tabular-nums font-medium ${a.difference < 0 ? "text-rose-600" : "text-emerald-700"}`}>{signedMoney(a.difference, a.currencyCode)}</td>
                <td className="px-5 py-3"><PayoutStatusBadge status={a.status} /></td>
                <td className="px-5 py-3 text-right text-xs text-slate-500">{a.createdAt.slice(0, 10)}</td>
              </tr>
            ))}
          />
        )}
      </Card>

      {/* ---- detail ---- */}
      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title="Correction" size="lg">
        {detail ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-panel-2 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">{detail.employeeName ?? "—"}</p>
                <p className="mt-1 flex items-center gap-2 text-xs text-slate-500"><PayoutStatusBadge status={detail.status} /> {humanizeStatus(detail.adjustmentType)}{detail.componentCode ? ` · ${detail.componentCode}` : ""}</p>
              </div>
              <p className={`text-lg font-semibold tabular-nums ${detail.difference < 0 ? "text-rose-600" : "text-emerald-700"}`}>{signedMoney(detail.difference, detail.currencyCode)}</p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div><p className="text-xs text-slate-500">Previous</p><p className="tabular-nums text-slate-800">{detail.previousValue == null ? "—" : money(detail.previousValue, detail.currencyCode)}</p></div>
              <div><p className="text-xs text-slate-500">Corrected</p><p className="tabular-nums text-slate-800">{detail.correctedValue == null ? "—" : money(detail.correctedValue, detail.currencyCode)}</p></div>
              <div><p className="text-xs text-slate-500">Settlement batch</p><p className="truncate text-xs text-slate-600">{detail.settlementBatchId ?? "—"}</p></div>
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Reason</p>
              <p className="whitespace-pre-wrap rounded-xl border border-hairline/70 bg-panel p-3 text-sm text-slate-700">{detail.reason}</p>
            </div>

            {(canReview || canApprove) && detail.status !== "SETTLED" && detail.status !== "REJECTED" ? (
              <div className="space-y-2 rounded-xl border border-hairline/70 p-4">
                {detail.status === "APPROVED" ? (
                  <>
                    <label className={labelCls}>Settlement batch id</label>
                    <input className={inputCls} value={settlementBatchId} onChange={(e) => setSettlementBatchId(e.target.value)} placeholder="batch that carries this correction" />
                  </>
                ) : (
                  <>
                    <label className={labelCls}>Note <span className="font-normal text-slate-400">(optional)</span></label>
                    <textarea className={inputCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Context for this decision" />
                  </>
                )}
              </div>
            ) : null}

            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
            <div className="flex flex-wrap justify-end gap-2">
              {canReview && detail.status === "CORRECTION_REQUESTED" ? (
                <button onClick={() => act(detail.id, "review")} disabled={pending} className={secondaryBtn}><ClipboardCheck className="size-4" /> Mark reviewed</button>
              ) : null}
              {canReview && detail.status !== "SETTLED" && detail.status !== "REJECTED" && detail.status !== "APPROVED" ? (
                <button onClick={() => act(detail.id, "reject")} disabled={pending} className={btn.danger}><XCircle className="size-4" /> Reject</button>
              ) : null}
              {canApprove && detail.status === "REVIEWED" ? (
                <button onClick={() => act(detail.id, "approve")} disabled={pending} className={primaryBtn}><CheckCheck className="size-4" /> Approve</button>
              ) : null}
              {canApprove && detail.status === "APPROVED" ? (
                <button onClick={settle} disabled={pending || !settlementBatchId.trim()} className={primaryBtn}><Coins className="size-4" /> Settle</button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ---- create ---- */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New correction" size="lg">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Employee</label>
              <EmployeePicker value={form.employeeId} onChange={(id) => setForm({ ...form, employeeId: id })} employees={employees} />
            </div>
            <div>
              <label className={labelCls}>Type</label>
              <select className={inputCls} value={form.adjustmentType} onChange={(e) => setForm({ ...form, adjustmentType: e.target.value })}>
                {TYPES.map((t) => <option key={t} value={t}>{humanizeStatus(t)}</option>)}
              </select>
            </div>
          </div>
          <div><label className={labelCls}>Component code <span className="font-normal text-slate-400">(optional)</span></label><input className={inputCls} value={form.componentCode} onChange={(e) => setForm({ ...form, componentCode: e.target.value })} placeholder="e.g. BASIC, HRA" /></div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><label className={labelCls}>Previous</label><input type="number" step="0.01" className={inputCls} value={form.previousValue} onChange={(e) => setForm({ ...form, previousValue: e.target.value })} /></div>
            <div><label className={labelCls}>Corrected</label><input type="number" step="0.01" className={inputCls} value={form.correctedValue} onChange={(e) => setForm({ ...form, correctedValue: e.target.value })} /></div>
            <div><label className={labelCls}>Difference</label><input type="number" step="0.01" className={inputCls} value={form.difference} onChange={(e) => setForm({ ...form, difference: e.target.value })} /></div>
          </div>
          <p className="text-xs text-slate-400">Provide a difference, or previous and corrected values — the difference must be non-zero.</p>
          <div><label className={labelCls}>Reason</label><textarea className={inputCls} rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Why this correction is needed" /></div>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreateOpen(false)} className={secondaryBtn}>Cancel</button>
            <button onClick={create} disabled={pending || !createValid} className={primaryBtn}><Plus className="size-4" /> {pending ? "Creating…" : "Create correction"}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
