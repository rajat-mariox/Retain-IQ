"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { FileCheck2, FileText, Sparkles } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { SkeletonTableCard } from "@/components/ui/Skeleton";
import type { OrgSession } from "@/lib/api";
import { can, EmployeePicker, inputCls, labelCls, money, NoAccess, primaryBtn, readError, useEmployeeDirectory } from "./workspace-shared";

interface Statement {
  id: string;
  recordId: string;
  employeeId: string;
  kind: string;
  documentVersion: number;
  storageKey: string;
  checksum: string;
  currencyCode: string;
  grossAmount: number;
  netAmount: number;
  generatedAt: string;
}

function StatementTable({ items, empty }: { items: Statement[]; empty: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-sm">
        <thead>
          <tr className="border-b border-hairline text-xs text-slate-500">
            <th className="px-5 py-3 text-left font-medium">Statement</th>
            <th className="px-5 py-3 text-right font-medium">Gross</th>
            <th className="px-5 py-3 text-right font-medium">Net</th>
            <th className="px-5 py-3 text-left font-medium">Checksum</th>
            <th className="px-5 py-3 text-right font-medium">Generated</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
              <td className="px-5 py-3">
                <span className="flex items-center gap-2 font-medium text-slate-800">
                  <FileText className="size-4 text-slate-400" />
                  {s.kind.replace(/_/g, " ").toLowerCase()}
                  <span className="rounded-full bg-panel-2 px-1.5 text-xs tabular-nums text-slate-500">v{s.documentVersion}</span>
                </span>
              </td>
              <td className="px-5 py-3 text-right tabular-nums text-slate-600">{money(s.grossAmount, s.currencyCode)}</td>
              <td className="px-5 py-3 text-right tabular-nums font-medium text-slate-900">{money(s.netAmount, s.currencyCode)}</td>
              <td className="px-5 py-3 font-mono text-xs text-slate-400" title={s.checksum}>{s.checksum.slice(0, 12)}…</td>
              <td className="px-5 py-3 text-right text-xs text-slate-500">{s.generatedAt.slice(0, 10)}</td>
            </tr>
          ))}
          {items.length === 0 ? (
            <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-500">{empty}</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Payout statements (§18). Admins generate deterministic, checksummed statements
 * for a finalized batch and look up any employee's statements (both gated on their
 * own permission); staff read their own payslips. Statement bytes live behind a
 * storage key — the checksum is shown so a downloaded copy can be verified.
 */
export function StatementsPanel({ session }: { session: OrgSession }) {
  const canGenerate = can(session, "payroll.statement.generate");
  const canEmpRead = can(session, "payroll.statement.employee.read");
  const canOwnRead = can(session, "payroll.statement.own.read");

  const { list: employees } = useEmployeeDirectory();

  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // generate
  const [batchId, setBatchId] = useState("");
  const [genResult, setGenResult] = useState<string | null>(null);

  // employee lookup
  const [employeeId, setEmployeeId] = useState("");
  const [empStatements, setEmpStatements] = useState<Statement[] | null>(null);
  const [empLoading, setEmpLoading] = useState(false);

  // mine
  const [mine, setMine] = useState<Statement[] | null>(null);

  const loadMine = useCallback(() => {
    fetch("/api/me/payroll/statements", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setMine(Array.isArray(d?.items) ? d.items : []))
      .catch(() => setMine([]));
  }, []);
  useEffect(() => {
    if (canOwnRead) loadMine();
  }, [canOwnRead, loadMine]);

  const generate = () =>
    start(async () => {
      setError(null);
      setGenResult(null);
      const id = batchId.trim();
      if (!id) return;
      const res = await fetch(`/api/payroll/batches/${id}/statements`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setError(readError(d, "Could not generate statements for that batch."));
      setGenResult(`Generated ${d?.generated ?? 0} statement${d?.generated === 1 ? "" : "s"}.`);
    });

  const lookup = useCallback((id: string) => {
    setError(null);
    if (!id) {
      setEmpStatements(null);
      return;
    }
    setEmpStatements(null);
    setEmpLoading(true);
    fetch(`/api/payroll/employees/${id}/statements`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          setError(readError(d, "Could not load statements for that employee."));
          setEmpStatements([]);
          return;
        }
        setEmpStatements(Array.isArray(d?.items) ? d.items : []);
      })
      .catch(() => setEmpStatements([]))
      .finally(() => setEmpLoading(false));
  }, []);

  if (!canGenerate && !canEmpRead && !canOwnRead) {
    return (
      <Card>
        <NoAccess>You don&apos;t have access to payout statements.</NoAccess>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      {canGenerate ? (
        <Card>
          <CardHeader title="Generate statements" subtitle="Produce a checksummed payout statement for every finalized record in a batch" />
          <CardBody className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[18rem] flex-1">
                <label className={labelCls}>Batch id</label>
                <input className={inputCls} value={batchId} onChange={(e) => setBatchId(e.target.value)} placeholder="payroll batch UUID" />
              </div>
              <button onClick={generate} disabled={pending || !batchId.trim()} className={primaryBtn}>
                <Sparkles className="size-4" /> {pending ? "Generating…" : "Generate"}
              </button>
            </div>
            {genResult ? (
              <p className="flex items-center gap-1.5 text-sm text-emerald-700"><FileCheck2 className="size-4" /> {genResult}</p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {canEmpRead ? (
        <Card>
          <CardHeader title="Employee statements" subtitle="Look up any employee's payout statements within your reach" />
          <CardBody>
            <div className="max-w-md">
              <label className={labelCls}>Employee</label>
              <EmployeePicker value={employeeId} onChange={(id) => { setEmployeeId(id); lookup(id); }} employees={employees} />
            </div>
          </CardBody>
          {empLoading ? (
            <div className="p-5"><SkeletonTableCard rows={4} cols={4} /></div>
          ) : empStatements === null ? (
            <p className="px-5 pb-8 text-center text-sm text-slate-500">Pick an employee to see their statements.</p>
          ) : (
            <StatementTable items={empStatements} empty="No statements for this employee yet." />
          )}
        </Card>
      ) : null}

      {canOwnRead ? (
        <Card>
          <CardHeader title="My payslips" subtitle="Your own payout statements" />
          {mine === null ? (
            <div className="p-5"><SkeletonTableCard rows={4} cols={4} /></div>
          ) : (
            <StatementTable items={mine} empty="You have no payout statements yet." />
          )}
        </Card>
      ) : null}
    </div>
  );
}
