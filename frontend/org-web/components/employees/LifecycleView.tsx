"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import type { EmployeePage, EmployeeRow } from "@/lib/api";

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";

const META: Record<string, { title: string; subtitle: string; dateLabel: string; dateOf: (e: EmployeeRow) => string | null }> = {
  ONBOARDING: { title: "Onboarding", subtitle: "New hires getting set up — move them to probation once started", dateLabel: "Joined", dateOf: (e) => e.joinedAt ?? e.createdAt },
  PROBATION: { title: "Probation", subtitle: "On probation — confirm once they clear the review period", dateLabel: "Probation ends", dateOf: (e) => e.probationEndsAt },
  CONFIRMED: { title: "Confirmation", subtitle: "Confirmed, permanent employees", dateLabel: "Confirmed", dateOf: (e) => e.confirmedAt },
  EXITED: { title: "Exit", subtitle: "Employees who have exited the organization", dateLabel: "Exited", dateOf: (e) => e.exitedAt },
};

function fmt(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

export function LifecycleView({ stage }: { stage: "ONBOARDING" | "PROBATION" | "CONFIRMED" | "EXITED" }) {
  const [pending, start] = useTransition();
  const [data, setData] = useState<EmployeePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [probFor, setProbFor] = useState<EmployeeRow | null>(null);
  const [probDate, setProbDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const meta = META[stage];
  const pageSize = 20;

  const load = useCallback(
    (page: number) => {
      setLoading(true);
      fetch(`/api/employees?page=${page}&pageSize=${pageSize}&lifecycleStage=${stage}`)
        .then((r) => r.json())
        .then((d: EmployeePage) => setData(d))
        .catch(() => undefined)
        .finally(() => setLoading(false));
    },
    [stage],
  );

  useEffect(() => {
    load(1);
  }, [load]);

  function transition(id: string, action: "start_probation" | "confirm" | "exit", extra?: Record<string, unknown>) {
    setError(null);
    start(async () => {
      const res = await fetch(`/api/employees/${id}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "Transition failed.");
        return;
      }
      setProbFor(null);
      load(data?.page ?? 1);
    });
  }

  function openProbation(e: EmployeeRow) {
    const in90 = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
    setProbDate(in90);
    setError(null);
    setProbFor(e);
  }

  function doExit(e: EmployeeRow) {
    if (typeof window !== "undefined" && !window.confirm(`Mark ${e.firstName} ${e.lastName} as exited? This is final.`)) return;
    transition(e.id, "exit");
  }

  const rows = data?.items ?? [];
  const lastPage = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <>
      <Card>
        <CardHeader title={meta.title} subtitle={meta.subtitle} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-hairline text-xs text-slate-500">
                <th className="px-5 py-3 text-left font-medium">Employee</th>
                <th className="px-5 py-3 text-left font-medium">Designation</th>
                <th className="px-5 py-3 text-left font-medium">Department</th>
                <th className="px-5 py-3 text-left font-medium">{meta.dateLabel}</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className={loading ? "opacity-50 transition-opacity" : "transition-opacity"}>
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <span className="font-medium text-slate-900">{e.firstName} {e.lastName}</span>
                    <span className="block text-xs text-slate-500">{e.email ?? e.employeeCode ?? "—"}</span>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{e.designationRef?.title ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{e.departmentRef?.name ?? "—"}</td>
                  <td className="px-5 py-3 tabular-nums text-slate-600">{fmt(meta.dateOf(e))}</td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-2">
                      {stage === "ONBOARDING" ? <ActionBtn onClick={() => openProbation(e)} disabled={pending}>Start probation</ActionBtn> : null}
                      {stage === "ONBOARDING" || stage === "PROBATION" ? <ActionBtn primary onClick={() => transition(e.id, "confirm")} disabled={pending}>Confirm</ActionBtn> : null}
                      {stage !== "EXITED" ? <ActionBtn danger onClick={() => doExit(e)} disabled={pending}>Exit</ActionBtn> : null}
                      {stage === "EXITED" ? <span className="text-xs text-slate-400">—</span> : null}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && loading ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">Loading…</td></tr>
              ) : null}
              {rows.length === 0 && !loading ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-500">No employees in this stage.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {data && data.total > pageSize ? (
          <div className="flex items-center justify-between border-t border-hairline px-5 py-3 text-xs text-slate-500">
            <span>{data.total} total</span>
            <div className="flex items-center gap-1">
              <button onClick={() => load(data.page - 1)} disabled={loading || data.page <= 1} className="rounded-lg border border-hairline bg-panel px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">Prev</button>
              <span className="px-1 tabular-nums">{data.page} / {lastPage}</span>
              <button onClick={() => load(data.page + 1)} disabled={loading || data.page >= lastPage} className="rounded-lg border border-hairline bg-panel px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">Next</button>
            </div>
          </div>
        ) : null}
        {error ? <p className="px-5 py-3 text-sm text-rose-600">{error}</p> : null}
      </Card>

      <Modal open={Boolean(probFor)} onClose={() => setProbFor(null)} title={probFor ? `Start probation — ${probFor.firstName} ${probFor.lastName}` : "Start probation"}>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Probation ends</label>
            <input type="date" className={input} value={probDate} onChange={(e) => setProbDate(e.target.value)} />
          </div>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setProbFor(null)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button
              onClick={() => probFor && transition(probFor.id, "start_probation", probDate ? { probationEndsAt: new Date(probDate).toISOString() } : {})}
              disabled={pending}
              className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60"
            >
              {pending ? "Saving…" : "Start probation"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function ActionBtn({ children, onClick, disabled, primary, danger }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean; danger?: boolean }) {
  const cls = primary
    ? "bg-brand text-white hover:bg-brand-soft"
    : danger
      ? "border border-hairline bg-panel text-rose-600 hover:bg-rose-50"
      : "border border-hairline bg-panel text-slate-700 hover:bg-slate-50";
  return (
    <button onClick={onClick} disabled={disabled} className={`rounded-lg px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 ${cls}`}>
      {children}
    </button>
  );
}
