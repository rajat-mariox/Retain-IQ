"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Ban, Check, Gift, Plus, TrendingUp, Wallet, X } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { LocalTime } from "@/components/ui/LocalTime";
import { SkeletonTableCard } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";
import type { OrgSession } from "@/lib/api";
import {
  EmployeePicker,
  NoAccess,
  VariablePayBadge,
  can,
  employeeName,
  inputCls,
  labelCls,
  money,
  primaryBtn,
  readError,
  secondaryBtn,
  useEmployeeDirectory,
  type VariablePayStatus,
} from "./workspace-shared";

/* ------------------------------- types ---------------------------------- */

type Kind = "bonuses" | "incentives" | "reimbursements";

interface VpRow {
  id: string;
  employeeId: string;
  status: VariablePayStatus;
  currencyCode: string;
  requestedBy: string | null;
  createdAt: string;
  // bonus
  bonusType?: string;
  reason?: string | null;
  amount?: number;
  // incentive
  incentiveType?: string;
  // reimbursement
  category?: string;
  claimedAmount?: number;
  approvedAmount?: number | null;
  taxable?: boolean;
}

const KINDS: { key: Kind; label: string; singular: string; icon: typeof Gift }[] = [
  { key: "bonuses", label: "Bonuses", singular: "bonus", icon: Gift },
  { key: "incentives", label: "Incentives", singular: "incentive", icon: TrendingUp },
  { key: "reimbursements", label: "Reimbursements", singular: "reimbursement", icon: Wallet },
];

const STATUSES: VariablePayStatus[] = ["DRAFT", "MANAGER_APPROVAL", "REVIEW", "APPROVED", "INCLUDED_IN_PAYROLL", "REJECTED", "CANCELLED"];
const TERMINAL = new Set<VariablePayStatus>(["INCLUDED_IN_PAYROLL", "REJECTED", "CANCELLED"]);
const BONUS_TYPES = ["ONE_TIME", "PERFORMANCE", "FESTIVAL", "RETENTION", "REFERRAL", "SALES", "CUSTOM"];
const REIMBURSEMENT_CATEGORIES = ["TRAVEL", "FOOD", "EQUIPMENT", "CUSTOM"];

/** The one-step advance available from a status (null when it can't advance here). */
function advanceLabel(status: VariablePayStatus): string | null {
  if (status === "DRAFT") return "Submit";
  if (status === "MANAGER_APPROVAL" || status === "REVIEW") return "Approve";
  return null; // APPROVED → INCLUDED needs a payroll batch (done in the batch workflow)
}

/* ------------------------------ component -------------------------------- */

export function VariablePayPanel({ session }: { session: OrgSession }) {
  const canRead = can(session, "payroll.record.read");
  const canCreate = can(session, "payroll.record.update");
  const canApprove = can(session, "payroll.variable_pay.approve");

  const { list: employees, byId } = useEmployeeDirectory();

  const [kind, setKind] = useState<Kind>("bonuses");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [rows, setRows] = useState<VpRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reload = useCallback(() => {
    setRows(null);
    fetch(`/api/payroll/${kind}${statusFilter ? `?status=${statusFilter}` : ""}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d) ? (d as VpRow[]) : []))
      .catch(() => setRows([]));
  }, [kind, statusFilter]);
  useEffect(() => {
    if (canRead) reload();
  }, [canRead, reload]);

  // ---- create ----
  const [createOpen, setCreateOpen] = useState(false);
  const emptyForm = { employeeId: "", bonusType: "ONE_TIME", incentiveType: "", category: "TRAVEL", amount: "", currencyCode: "USD", reason: "", taxable: false };
  const [form, setForm] = useState(emptyForm);

  const create = () =>
    start(async () => {
      setError(null);
      const body: Record<string, unknown> = { employeeId: form.employeeId, currencyCode: form.currencyCode || undefined };
      if (kind === "bonuses") {
        body.bonusType = form.bonusType;
        body.amount = Number(form.amount);
        if (form.reason.trim()) body.reason = form.reason.trim();
      } else if (kind === "incentives") {
        body.incentiveType = form.incentiveType.trim();
        body.amount = Number(form.amount);
      } else {
        body.category = form.category;
        body.claimedAmount = Number(form.amount);
        body.taxable = form.taxable;
      }
      const res = await fetch(`/api/payroll/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(readError(d, "Could not raise the request."));
        return;
      }
      setCreateOpen(false);
      setForm(emptyForm);
      reload();
    });

  const act = (id: string, action: "approve" | "reject" | "cancel") =>
    start(async () => {
      setError(null);
      if (action === "cancel" && typeof window !== "undefined" && !window.confirm("Withdraw this request?")) return;
      const res = await fetch(`/api/payroll/${kind}/${id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(readError(d, `Could not ${action} the request.`));
        return;
      }
      reload();
    });

  if (!canRead) {
    return (
      <Card>
        <NoAccess>You don&apos;t have access to variable pay.</NoAccess>
      </Card>
    );
  }

  const isReimb = kind === "reimbursements";

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      {/* sub-tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-xl border border-hairline bg-panel-2 p-1">
          {KINDS.map((k) => {
            const Icon = k.icon;
            return (
              <button
                key={k.key}
                onClick={() => { setKind(k.key); setStatusFilter(""); }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
                  kind === k.key ? "bg-panel text-slate-900 shadow-sm ring-1 ring-hairline" : "text-slate-500 hover:text-slate-800",
                )}
              >
                <Icon className="size-4" /> {k.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <select className="rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-700 focus:border-brand focus:outline-none" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>)}
          </select>
          {canCreate ? (
            <button onClick={() => { setError(null); setForm(emptyForm); setCreateOpen(true); }} className={primaryBtn}>
              <Plus className="size-4" /> New request
            </button>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader
          title={KINDS.find((k) => k.key === kind)!.label}
          subtitle="Raised requests flow through a manager → review → approval chain before a payroll batch consumes them"
        />
        {rows === null ? (
          <div className="p-5">
            <SkeletonTableCard rows={5} cols={5} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-xs text-slate-500">
                  <th className="px-5 py-3 text-left font-medium">Employee</th>
                  <th className="px-5 py-3 text-left font-medium">{isReimb ? "Category" : "Type"}</th>
                  <th className="px-5 py-3 text-right font-medium">{isReimb ? "Claimed" : "Amount"}</th>
                  {isReimb ? <th className="px-5 py-3 text-right font-medium">Approved</th> : null}
                  <th className="px-5 py-3 text-left font-medium">Status</th>
                  <th className="px-5 py-3 text-left font-medium">Raised</th>
                  <th className="px-5 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const primaryAmount = isReimb ? r.claimedAmount ?? 0 : r.amount ?? 0;
                  const typeText = isReimb ? r.category : r.bonusType ?? r.incentiveType;
                  const nextLabel = advanceLabel(r.status);
                  const isMine = r.requestedBy != null && r.requestedBy === session.user.id;
                  const canCancel = canCreate && isMine && !TERMINAL.has(r.status);
                  const canReject = canApprove && !TERMINAL.has(r.status);
                  return (
                    <tr key={r.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                      <td className="px-5 py-3 font-medium text-slate-800">{employeeName(byId, r.employeeId)}</td>
                      <td className="px-5 py-3 text-slate-600">
                        {(typeText ?? "—").replace(/_/g, " ").toLowerCase()}
                        {isReimb && r.taxable ? <span className="ml-1.5 rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-700 ring-1 ring-inset ring-amber-600/20">taxable</span> : null}
                        {!isReimb && r.reason ? <span className="ml-2 text-xs text-slate-400">{r.reason}</span> : null}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums font-medium text-slate-900">{money(primaryAmount, r.currencyCode)}</td>
                      {isReimb ? (
                        <td className="px-5 py-3 text-right tabular-nums text-slate-600">{r.approvedAmount == null ? "—" : money(r.approvedAmount, r.currencyCode)}</td>
                      ) : null}
                      <td className="px-5 py-3"><VariablePayBadge status={r.status} /></td>
                      <td className="px-5 py-3 text-xs text-slate-500"><LocalTime iso={r.createdAt} mode="date" /></td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          {nextLabel && canApprove ? (
                            <button onClick={() => act(r.id, "approve")} disabled={pending} className="inline-flex items-center gap-1 rounded-lg bg-brand px-2 py-1 text-xs font-medium text-white hover:bg-brand-soft disabled:opacity-60">
                              <Check className="size-3.5" /> {nextLabel}
                            </button>
                          ) : null}
                          {canReject ? (
                            <button onClick={() => act(r.id, "reject")} disabled={pending} className="inline-flex items-center gap-1 rounded-lg border border-hairline px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-60">
                              <X className="size-3.5" /> Reject
                            </button>
                          ) : null}
                          {canCancel ? (
                            <button onClick={() => act(r.id, "cancel")} disabled={pending} title="Withdraw" className="inline-flex items-center gap-1 rounded-lg border border-hairline px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-60">
                              <Ban className="size-3.5" />
                            </button>
                          ) : null}
                          {!nextLabel && !canReject && !canCancel ? <span className="text-xs text-slate-400">—</span> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={isReimb ? 7 : 6} className="px-5 py-10 text-center text-sm text-slate-500">
                      No {KINDS.find((k) => k.key === kind)!.label.toLowerCase()} {statusFilter ? "with this status" : "yet"}.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ---------------- create modal ---------------- */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={`New ${KINDS.find((k) => k.key === kind)!.singular} request`} size="md">
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Employee</label>
            <EmployeePicker value={form.employeeId} onChange={(id) => setForm({ ...form, employeeId: id })} employees={employees} />
          </div>

          {kind === "bonuses" ? (
            <div>
              <label className={labelCls}>Bonus type</label>
              <select className={inputCls} value={form.bonusType} onChange={(e) => setForm({ ...form, bonusType: e.target.value })}>
                {BONUS_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ").toLowerCase()}</option>)}
              </select>
            </div>
          ) : null}
          {kind === "incentives" ? (
            <div>
              <label className={labelCls}>Incentive type</label>
              <input className={inputCls} value={form.incentiveType} onChange={(e) => setForm({ ...form, incentiveType: e.target.value })} placeholder="e.g. Sales commission" />
            </div>
          ) : null}
          {kind === "reimbursements" ? (
            <div>
              <label className={labelCls}>Category</label>
              <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {REIMBURSEMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}
              </select>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{isReimb ? "Claimed amount" : "Amount"}</label>
              <input type="number" min={0} step="0.01" className={inputCls} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Currency</label>
              <input maxLength={3} className={inputCls} value={form.currencyCode} onChange={(e) => setForm({ ...form, currencyCode: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} placeholder="USD" />
            </div>
          </div>

          {kind === "bonuses" ? (
            <div>
              <label className={labelCls}>Reason <span className="font-normal text-slate-400">(optional)</span></label>
              <input className={inputCls} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Why this bonus is awarded" />
            </div>
          ) : null}
          {kind === "reimbursements" ? (
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.taxable} onChange={(e) => setForm({ ...form, taxable: e.target.checked })} className="rounded border-hairline" />
              Taxable reimbursement
            </label>
          ) : null}

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreateOpen(false)} className={secondaryBtn}>Cancel</button>
            <button
              onClick={create}
              disabled={pending || !form.employeeId || form.amount === "" || (kind === "incentives" && form.incentiveType.trim().length < 2)}
              className={primaryBtn}
            >
              {pending ? "Saving…" : "Raise request"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
