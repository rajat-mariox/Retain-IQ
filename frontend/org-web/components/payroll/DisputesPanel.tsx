"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { CheckCircle2, Inbox, MessageSquarePlus, Send, UserCheck } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { StatTile } from "@/components/ui/StatTile";
import { SkeletonTableCard } from "@/components/ui/Skeleton";
import { PaginatedTable } from "@/components/ui/Pagination";
import type { OrgSession } from "@/lib/api";
import { humanizeStatus, PayoutStatusBadge } from "./payout-ui";
import { can, inputCls, labelCls, NoAccess, primaryBtn, readError, secondaryBtn } from "./workspace-shared";

const CATEGORIES = ["INCORRECT_BASE", "MISSING_INCENTIVE", "WRONG_DEDUCTION", "TAX", "NOT_RECEIVED", "OTHER"] as const;
const RESOLVE_STATUSES = ["UNDER_REVIEW", "EMPLOYEE_INPUT_REQUIRED", "RESOLVED", "CLOSED"] as const;
const ALL_STATUSES = ["SUBMITTED", "ASSIGNED", "UNDER_REVIEW", "EMPLOYEE_INPUT_REQUIRED", "RESOLVED", "CLOSED"] as const;

interface Dispute {
  id: string;
  employeeId: string;
  employeeName: string | null;
  recordId: string | null;
  category: string;
  description: string;
  status: string;
  assignedTo: string | null;
  hrCaseRef: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
}
interface Summary {
  total: number;
  open: number;
  unassigned: number;
  resolved: number;
}

/**
 * Payroll disputes (§19). Staff raise and track disputes about their own payout;
 * HR/Finance work the queue — assign, review, request input, resolve — each action
 * on its own payroll.dispute.* permission. Employees never see anyone else's.
 */
export function DisputesPanel({ session }: { session: OrgSession }) {
  const canRead = can(session, "payroll.dispute.read");
  const canAssign = can(session, "payroll.dispute.assign");
  const canResolve = can(session, "payroll.dispute.resolve");
  const canCreate = can(session, "payroll.dispute.create");

  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // admin queue
  const [queue, setQueue] = useState<Dispute[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [detail, setDetail] = useState<Dispute | null>(null);
  const [resolveForm, setResolveForm] = useState({ status: "UNDER_REVIEW", resolution: "" });

  // employee self
  const [mine, setMine] = useState<Dispute[] | null>(null);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [raiseForm, setRaiseForm] = useState({ category: "INCORRECT_BASE", recordId: "", description: "" });
  const [respondFor, setRespondFor] = useState<Dispute | null>(null);
  const [respondNote, setRespondNote] = useState("");

  const loadQueue = useCallback(() => {
    const qs = statusFilter ? `?status=${statusFilter}` : "";
    fetch(`/api/payroll/disputes${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setQueue(Array.isArray(d?.items) ? d.items : []);
        setSummary(d?.summary ?? null);
      })
      .catch(() => setQueue([]));
  }, [statusFilter]);
  useEffect(() => {
    if (canRead) loadQueue();
  }, [canRead, loadQueue]);

  const loadMine = useCallback(() => {
    fetch("/api/me/payroll/disputes", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setMine(Array.isArray(d?.items) ? d.items : []))
      .catch(() => setMine([]));
  }, []);
  useEffect(() => {
    if (canCreate) loadMine();
  }, [canCreate, loadMine]);

  const assign = (id: string) =>
    start(async () => {
      setError(null);
      const res = await fetch(`/api/payroll/disputes/${id}/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setError(readError(d, "Could not assign this dispute."));
      setDetail(d?.id ? d : detail);
      loadQueue();
    });

  const resolve = () =>
    start(async () => {
      if (!detail) return;
      setError(null);
      const res = await fetch(`/api/payroll/disputes/${detail.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: resolveForm.status, resolution: resolveForm.resolution.trim() || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setError(readError(d, "Could not update this dispute."));
      setDetail(d?.id ? d : null);
      loadQueue();
    });

  const raise = () =>
    start(async () => {
      setError(null);
      const res = await fetch("/api/payroll/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: raiseForm.category,
          recordId: raiseForm.recordId.trim() || undefined,
          description: raiseForm.description.trim(),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setError(readError(d, "Could not raise the dispute."));
      setRaiseOpen(false);
      loadMine();
    });

  const respond = () =>
    start(async () => {
      if (!respondFor) return;
      setError(null);
      const res = await fetch(`/api/me/payroll/disputes/${respondFor.id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: respondNote.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setError(readError(d, "Could not send your response."));
      setRespondFor(null);
      setRespondNote("");
      loadMine();
    });

  if (!canRead && !canCreate) {
    return (
      <Card>
        <NoAccess>You don&apos;t have access to payroll disputes.</NoAccess>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {error && !detail && !raiseOpen && !respondFor ? <p className="text-sm text-rose-600">{error}</p> : null}

      {/* ---------------- admin queue ---------------- */}
      {canRead ? (
        <>
          {summary ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatTile label="Total" value={String(summary.total)} icon={Inbox} />
              <StatTile label="Open" value={String(summary.open)} icon={MessageSquarePlus} accent="#d97706" />
              <StatTile label="Unassigned" value={String(summary.unassigned)} icon={UserCheck} accent="#e11d48" />
              <StatTile label="Resolved" value={String(summary.resolved)} icon={CheckCircle2} />
            </div>
          ) : null}

          <Card>
            <CardHeader
              title="Dispute queue"
              subtitle="Disputes raised by staff within your reach"
              action={
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm text-slate-700 focus:border-brand focus:outline-none">
                  <option value="">All statuses</option>
                  {ALL_STATUSES.map((s) => <option key={s} value={s}>{humanizeStatus(s)}</option>)}
                </select>
              }
            />
            {queue === null ? (
              <div className="p-5"><SkeletonTableCard rows={5} cols={4} /></div>
            ) : (
              <PaginatedTable
                minWidth="min-w-[720px]"
                head={
                  <tr className="border-b border-hairline text-xs text-slate-500">
                    <th className="px-5 py-3 text-left font-medium">Employee</th>
                    <th className="px-5 py-3 text-left font-medium">Category</th>
                    <th className="px-5 py-3 text-left font-medium">Status</th>
                    <th className="px-5 py-3 text-left font-medium">Assigned</th>
                    <th className="px-5 py-3 text-right font-medium">Raised</th>
                  </tr>
                }
                empty={<tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-500">No disputes in the queue.</td></tr>}
                rows={queue.map((d) => (
                  <tr key={d.id} onClick={() => { setError(null); setResolveForm({ status: "UNDER_REVIEW", resolution: d.resolution ?? "" }); setDetail(d); }} className="cursor-pointer border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-900">{d.employeeName ?? "—"}</td>
                    <td className="px-5 py-3 text-xs text-slate-500">{humanizeStatus(d.category)}</td>
                    <td className="px-5 py-3"><PayoutStatusBadge status={d.status} /></td>
                    <td className="px-5 py-3 text-xs text-slate-500">{d.assignedTo ? `${d.assignedTo.slice(0, 8)}…` : <span className="text-amber-600">unassigned</span>}</td>
                    <td className="px-5 py-3 text-right text-xs text-slate-500">{d.createdAt.slice(0, 10)}</td>
                  </tr>
                ))}
              />
            )}
          </Card>
        </>
      ) : null}

      {/* ---------------- employee self-service ---------------- */}
      {canCreate ? (
        <Card>
          <CardHeader
            title="My disputes"
            subtitle="Raise and track disputes about your own payout"
            action={
              <button onClick={() => { setError(null); setRaiseForm({ category: "INCORRECT_BASE", recordId: "", description: "" }); setRaiseOpen(true); }} className={primaryBtn}>
                <MessageSquarePlus className="size-4" /> Raise dispute
              </button>
            }
          />
          {mine === null ? (
            <div className="p-5"><SkeletonTableCard rows={3} cols={3} /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-hairline text-xs text-slate-500">
                    <th className="px-5 py-3 text-left font-medium">Category</th>
                    <th className="px-5 py-3 text-left font-medium">Description</th>
                    <th className="px-5 py-3 text-left font-medium">Status</th>
                    <th className="px-5 py-3 text-right font-medium">Raised</th>
                    <th className="px-5 py-3 text-right font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {mine.map((d) => (
                    <tr key={d.id} className="border-b border-hairline/60 align-top last:border-0">
                      <td className="px-5 py-3 text-xs text-slate-500">{humanizeStatus(d.category)}</td>
                      <td className="max-w-[22rem] px-5 py-3 text-slate-700">
                        <p className="truncate">{d.description}</p>
                        {d.resolution ? <p className="mt-1 text-xs text-emerald-700">Resolution: {d.resolution}</p> : null}
                      </td>
                      <td className="px-5 py-3"><PayoutStatusBadge status={d.status} /></td>
                      <td className="px-5 py-3 text-right text-xs text-slate-500">{d.createdAt.slice(0, 10)}</td>
                      <td className="px-5 py-3 text-right">
                        {d.status === "EMPLOYEE_INPUT_REQUIRED" ? (
                          <button onClick={() => { setError(null); setRespondNote(""); setRespondFor(d); }} className="inline-flex items-center gap-1 rounded-lg border border-hairline px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"><Send className="size-3.5" /> Respond</button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {mine.length === 0 ? (
                    <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-500">You haven&apos;t raised any disputes.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {/* ---- admin detail ---- */}
      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title="Dispute" size="lg">
        {detail ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-panel-2 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">{detail.employeeName ?? "—"}</p>
                <p className="mt-1 flex items-center gap-2 text-xs text-slate-500"><PayoutStatusBadge status={detail.status} /> {humanizeStatus(detail.category)}</p>
              </div>
              <p className="text-xs text-slate-400">raised {detail.createdAt.slice(0, 10)}</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Description</p>
              <p className="whitespace-pre-wrap rounded-xl border border-hairline/70 bg-panel p-3 text-sm text-slate-700">{detail.description}</p>
            </div>
            {detail.resolution ? (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Resolution</p>
                <p className="whitespace-pre-wrap rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{detail.resolution}</p>
              </div>
            ) : null}

            {canResolve && detail.status !== "CLOSED" ? (
              <div className="space-y-3 rounded-xl border border-hairline/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Move forward</p>
                <div>
                  <label className={labelCls}>To status</label>
                  <select className={inputCls} value={resolveForm.status} onChange={(e) => setResolveForm({ ...resolveForm, status: e.target.value })}>
                    {RESOLVE_STATUSES.map((s) => <option key={s} value={s}>{humanizeStatus(s)}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Resolution note {["RESOLVED", "CLOSED"].includes(resolveForm.status) ? "(required)" : "(optional)"}</label>
                  <textarea className={inputCls} rows={3} value={resolveForm.resolution} onChange={(e) => setResolveForm({ ...resolveForm, resolution: e.target.value })} placeholder="What was decided and why" />
                </div>
              </div>
            ) : null}

            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
            <div className="flex justify-end gap-2">
              {canAssign && detail.status !== "RESOLVED" && detail.status !== "CLOSED" ? (
                <button onClick={() => assign(detail.id)} disabled={pending} className={secondaryBtn}><UserCheck className="size-4" /> Assign to me</button>
              ) : null}
              {canResolve && detail.status !== "CLOSED" ? (
                <button onClick={resolve} disabled={pending} className={primaryBtn}><CheckCircle2 className="size-4" /> {pending ? "Saving…" : "Update"}</button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ---- raise dispute ---- */}
      <Modal open={raiseOpen} onClose={() => setRaiseOpen(false)} title="Raise a payout dispute" size="md">
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Category</label>
            <select className={inputCls} value={raiseForm.category} onChange={(e) => setRaiseForm({ ...raiseForm, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{humanizeStatus(c)}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Payroll record id <span className="font-normal text-slate-400">(optional)</span></label>
            <input className={inputCls} value={raiseForm.recordId} onChange={(e) => setRaiseForm({ ...raiseForm, recordId: e.target.value })} placeholder="the payout you're disputing" />
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <textarea className={inputCls} rows={4} value={raiseForm.description} onChange={(e) => setRaiseForm({ ...raiseForm, description: e.target.value })} placeholder="Explain what looks wrong with your payout" />
          </div>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setRaiseOpen(false)} className={secondaryBtn}>Cancel</button>
            <button onClick={raise} disabled={pending || raiseForm.description.trim().length < 3} className={primaryBtn}><MessageSquarePlus className="size-4" /> {pending ? "Submitting…" : "Submit"}</button>
          </div>
        </div>
      </Modal>

      {/* ---- respond ---- */}
      <Modal open={Boolean(respondFor)} onClose={() => setRespondFor(null)} title="Respond to dispute" size="md">
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Add the information HR/Finance asked for. This moves your dispute back into review.</p>
          <div>
            <label className={labelCls}>Your response</label>
            <textarea className={inputCls} rows={4} value={respondNote} onChange={(e) => setRespondNote(e.target.value)} />
          </div>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setRespondFor(null)} className={secondaryBtn}>Cancel</button>
            <button onClick={respond} disabled={pending || !respondNote.trim()} className={primaryBtn}><Send className="size-4" /> {pending ? "Sending…" : "Send"}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
