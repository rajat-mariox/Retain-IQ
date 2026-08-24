"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { BadgeCheck, Paperclip, RefreshCw, ShieldCheck } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { SkeletonTableCard } from "@/components/ui/Skeleton";
import { PaginatedTable } from "@/components/ui/Pagination";
import type { OrgSession } from "@/lib/api";
import { PayoutStatusBadge } from "./payout-ui";
import { can, inputCls, labelCls, money, NoAccess, primaryBtn, readError, secondaryBtn } from "./workspace-shared";

const METHODS = ["BANK_TRANSFER", "UPI", "CHEQUE", "CASH", "PROVIDER"] as const;
const PROOF_KINDS = ["RECEIPT", "BANK_RESPONSE", "ATTACHMENT"] as const;
// A record's payout can still be settled from any of these payment states.
const PAYABLE = new Set(["PENDING", "PROCESSING", "FAILED"]);

interface PaymentRow {
  id: string;
  recordId: string;
  employeeId: string;
  employeeName: string;
  amount: number;
  currencyCode: string;
  method: string | null;
  reference: string | null;
  status: string;
  paymentDate: string | null;
  createdAt: string;
}
interface PaymentDetail extends PaymentRow {
  attempts: { attemptNo: number; status: string; providerRef: string | null; error: string | null; createdAt: string }[];
  proofs: { id: string; kind: string; storageKey: string; checksum: string | null; createdAt: string }[];
}

/**
 * Payout ledger (§16, §17). Lists every payment scoped to the caller's reach with
 * bank references masked by the backend. Marking a record paid, retrying a failed
 * settlement and attaching proof documents are each gated on their own
 * payroll.payment.* permission.
 */
export function PaymentsPanel({ session }: { session: OrgSession }) {
  const canRead = can(session, "payroll.payment.read");
  const canMarkPaid = can(session, "payroll.payment.mark_paid");
  const canRetry = can(session, "payroll.payment.retry");
  const canProof = can(session, "payroll.payment.proof.upload");

  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [statusFilter, setStatusFilter] = useState("");

  const [detail, setDetail] = useState<PaymentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [payFor, setPayFor] = useState<PaymentRow | null>(null);
  const [payForm, setPayForm] = useState({ method: "BANK_TRANSFER", paymentDate: "", reference: "" });
  const [proofForm, setProofForm] = useState({ kind: "RECEIPT", storageKey: "", checksum: "" });

  const reload = useCallback(() => {
    const qs = statusFilter ? `?status=${statusFilter}` : "";
    fetch(`/api/payroll/payments${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d?.items) ? d.items : []))
      .catch(() => setRows([]));
  }, [statusFilter]);
  useEffect(() => {
    if (canRead) reload();
  }, [canRead, reload]);

  const openDetail = (id: string) => {
    setDetail(null);
    setProofForm({ kind: "RECEIPT", storageKey: "", checksum: "" });
    setDetailLoading(true);
    fetch(`/api/payroll/payments/${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: PaymentDetail) => setDetail(d?.id ? d : null))
      .catch(() => undefined)
      .finally(() => setDetailLoading(false));
  };

  const markPaid = () =>
    start(async () => {
      if (!payFor) return;
      setError(null);
      const body: Record<string, unknown> = { method: payForm.method };
      if (payForm.paymentDate) body.paymentDate = new Date(payForm.paymentDate).toISOString();
      if (payForm.reference.trim()) body.reference = payForm.reference.trim();
      const res = await fetch(`/api/payroll/records/${payFor.recordId}/mark-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setError(readError(d, "Could not mark this payout as paid."));
      setPayFor(null);
      reload();
    });

  const retry = (id: string) =>
    start(async () => {
      setError(null);
      const res = await fetch(`/api/payroll/payments/${id}/retry`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setError(readError(d, "Could not retry this payment."));
      setDetail(d?.id ? d : detail);
      reload();
    });

  const uploadProof = () =>
    start(async () => {
      if (!detail) return;
      setError(null);
      const res = await fetch(`/api/payroll/payments/${detail.id}/proof`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: proofForm.kind,
          storageKey: proofForm.storageKey.trim(),
          checksum: proofForm.checksum.trim() || undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setError(readError(d, "Could not attach the proof."));
      openDetail(detail.id);
    });

  if (!canRead) {
    return (
      <Card>
        <NoAccess>You don&apos;t have access to payouts.</NoAccess>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <Card>
        <CardHeader
          title="Payouts"
          subtitle="Settlements per approved payroll record — bank references are masked"
          action={
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm text-slate-700 focus:border-brand focus:outline-none">
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="PROCESSING">Processing</option>
              <option value="PAID">Paid</option>
              <option value="FAILED">Failed</option>
            </select>
          }
        />
        {rows === null ? (
          <div className="p-5"><SkeletonTableCard rows={5} cols={5} /></div>
        ) : (
          <PaginatedTable
            minWidth="min-w-[760px]"
            head={
              <tr className="border-b border-hairline text-xs text-slate-500">
                <th className="px-5 py-3 text-left font-medium">Employee</th>
                <th className="px-5 py-3 text-right font-medium">Amount</th>
                <th className="px-5 py-3 text-left font-medium">Method</th>
                <th className="px-5 py-3 text-left font-medium">Reference</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Paid on</th>
                <th className="px-5 py-3 text-right font-medium"></th>
              </tr>
            }
            empty={<tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-500">No payments yet — send an approved batch for payment to open payouts.</td></tr>}
            rows={rows.map((p) => (
              <tr key={p.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                <td className="cursor-pointer px-5 py-3 font-medium text-slate-900" onClick={() => openDetail(p.id)}>{p.employeeName}</td>
                <td className="px-5 py-3 text-right tabular-nums font-medium text-slate-800">{money(p.amount, p.currencyCode)}</td>
                <td className="px-5 py-3 text-xs text-slate-500">{p.method ? p.method.replace(/_/g, " ").toLowerCase() : "—"}</td>
                <td className="px-5 py-3 font-mono text-xs text-slate-500">{p.reference ?? "—"}</td>
                <td className="px-5 py-3"><PayoutStatusBadge status={p.status} /></td>
                <td className="px-5 py-3 text-right text-xs text-slate-500">{p.paymentDate ? p.paymentDate.slice(0, 10) : "—"}</td>
                <td className="px-5 py-3 text-right">
                  <div className="flex justify-end gap-1.5">
                    {canRetry && p.status === "FAILED" ? (
                      <button onClick={() => retry(p.id)} disabled={pending} className="inline-flex items-center gap-1 rounded-lg border border-hairline px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"><RefreshCw className="size-3.5" /> Retry</button>
                    ) : null}
                    {canMarkPaid && PAYABLE.has(p.status) ? (
                      <button onClick={() => { setError(null); setPayForm({ method: p.method ?? "BANK_TRANSFER", paymentDate: "", reference: "" }); setPayFor(p); }} className="inline-flex items-center gap-1 rounded-lg bg-brand px-2 py-1 text-xs font-medium text-white hover:bg-brand-soft"><BadgeCheck className="size-3.5" /> Mark paid</button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          />
        )}
      </Card>

      {/* ---- mark paid ---- */}
      <Modal open={Boolean(payFor)} onClose={() => setPayFor(null)} title="Mark payout as paid" size="sm">
        {payFor ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-panel-2 px-4 py-3 text-sm">
              <p className="font-semibold text-slate-900">{payFor.employeeName}</p>
              <p className="mt-0.5 tabular-nums text-slate-500">{money(payFor.amount, payFor.currencyCode)}</p>
            </div>
            <div>
              <label className={labelCls}>Method</label>
              <select className={inputCls} value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
                {METHODS.map((m) => <option key={m} value={m}>{m.replace(/_/g, " ").toLowerCase()}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Payment date <span className="font-normal text-slate-400">(optional)</span></label>
              <input type="date" className={inputCls} value={payForm.paymentDate} onChange={(e) => setPayForm({ ...payForm, paymentDate: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Reference <span className="font-normal text-slate-400">(optional)</span></label>
              <input className={inputCls} value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} placeholder="UTR / cheque no." />
              <p className="mt-1 text-xs text-slate-400">Only the last 4 characters are ever shown back.</p>
            </div>
            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <button onClick={() => setPayFor(null)} className={secondaryBtn}>Cancel</button>
              <button onClick={markPaid} disabled={pending} className={primaryBtn}><BadgeCheck className="size-4" /> {pending ? "Saving…" : "Mark paid"}</button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ---- payment detail ---- */}
      <Modal open={detailLoading || Boolean(detail)} onClose={() => setDetail(null)} title="Payment" size="lg">
        {detailLoading || !detail ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading payment…</p>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-panel-2 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">{detail.employeeName}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <PayoutStatusBadge status={detail.status} />
                  {detail.method ? <span>{detail.method.replace(/_/g, " ").toLowerCase()}</span> : null}
                  {detail.reference ? <span className="font-mono">{detail.reference}</span> : null}
                </p>
              </div>
              <p className="text-lg font-semibold tabular-nums text-slate-900">{money(detail.amount, detail.currencyCode)}</p>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Attempts</p>
              {detail.attempts.length ? (
                <ul className="divide-y divide-hairline/60 rounded-xl border border-hairline/70">
                  {detail.attempts.map((a) => (
                    <li key={a.attemptNo} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="flex items-center gap-2"><span className="tabular-nums text-slate-400">#{a.attemptNo}</span><PayoutStatusBadge status={a.status} /></span>
                      <span className="min-w-0 flex-1 truncate text-xs text-rose-600">{a.error ?? ""}</span>
                      <span className="shrink-0 text-xs text-slate-400">{a.createdAt.slice(0, 10)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-xl border border-dashed border-hairline px-3 py-4 text-center text-xs text-slate-400">No settlement attempts recorded yet.</p>
              )}
            </div>

            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><ShieldCheck className="size-3.5" /> Proof documents</p>
              {detail.proofs.length ? (
                <ul className="divide-y divide-hairline/60 rounded-xl border border-hairline/70">
                  {detail.proofs.map((pf) => (
                    <li key={pf.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="flex items-center gap-2 text-slate-700"><Paperclip className="size-3.5 text-slate-400" /> {pf.kind.replace(/_/g, " ").toLowerCase()}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-400">{pf.storageKey}</span>
                      <span className="shrink-0 text-xs text-slate-400">{pf.createdAt.slice(0, 10)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-xl border border-dashed border-hairline px-3 py-4 text-center text-xs text-slate-400">No proof attached yet.</p>
              )}
              {canProof ? (
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[9rem_1fr_auto]">
                  <select className={inputCls} value={proofForm.kind} onChange={(e) => setProofForm({ ...proofForm, kind: e.target.value })}>
                    {PROOF_KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ").toLowerCase()}</option>)}
                  </select>
                  <input className={inputCls} value={proofForm.storageKey} onChange={(e) => setProofForm({ ...proofForm, storageKey: e.target.value })} placeholder="storage key (e.g. proofs/…/receipt.pdf)" />
                  <button onClick={uploadProof} disabled={pending || !proofForm.storageKey.trim()} className={primaryBtn}><Paperclip className="size-4" /> Attach</button>
                </div>
              ) : null}
            </div>

            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
            {canRetry && detail.status === "FAILED" ? (
              <div className="flex justify-end">
                <button onClick={() => retry(detail.id)} disabled={pending} className={secondaryBtn}><RefreshCw className="size-4" /> Retry payment</button>
              </div>
            ) : null}
          </div>
        )}
      </Modal>
    </div>
  );
}
