"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { BarChart3, Download, Filter, RefreshCw } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { SkeletonTableCard } from "@/components/ui/Skeleton";
import type { OrgSession } from "@/lib/api";
import { EmptyState } from "./payout-ui";
import { can, EmployeePicker, inputCls, labelCls, NoAccess, primaryBtn, readError, secondaryBtn, useEmployeeDirectory } from "./workspace-shared";

// The seven §31 report kinds, in the order the backend enumerates them. Labels
// are the human-facing names; the value is the :kind path segment.
const KINDS: { value: string; label: string; hint: string }[] = [
  { value: "register", label: "Payroll Register", hint: "One row per employee payout in the current period" },
  { value: "payout-summary", label: "Payout Summary", hint: "Totals per batch" },
  { value: "employee-history", label: "Employee History", hint: "Payouts across periods (filter by employee)" },
  { value: "department-cost", label: "Department Cost", hint: "Gross, net and employer cost by department" },
  { value: "earnings-deductions", label: "Earnings & Deductions", hint: "Totals per pay component" },
  { value: "on-hold", label: "On Hold", hint: "Payouts currently held back" },
  { value: "failed", label: "Failed Payments", hint: "Settlements that failed, with the last error" },
];

interface BuiltReport {
  kind: string;
  title: string;
  columns: string[];
  rows: (string | number | null)[][];
}

/** Numbers right-align and get thousands separators; integers keep no decimals. */
function renderCell(cell: string | number | null): { text: string; numeric: boolean } {
  if (typeof cell === "number" && Number.isFinite(cell)) {
    const numeric = true;
    if (Number.isInteger(cell)) return { text: cell.toLocaleString("en-US"), numeric };
    return { text: cell.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), numeric };
  }
  return { text: cell == null || cell === "" ? "—" : String(cell), numeric: false };
}

/**
 * Payroll reports (§31). Pick one of the seven report kinds, optionally scope it
 * by period / batch / employee, and read the resulting { columns, rows } table.
 * Reading is gated on payroll.report.read; the CSV export is the stronger
 * payroll.report.export action, so the Export button only shows for that grant
 * (the backend enforces it regardless). Every report is already scoped to the
 * caller's reach and excludes the Owner server-side.
 */
export function ReportsPanel({ session }: { session: OrgSession }) {
  const canRead = can(session, "payroll.report.read");
  const canExport = can(session, "payroll.report.export");

  const { list: employees } = useEmployeeDirectory();

  const [kind, setKind] = useState<string>("register");
  const [periodId, setPeriodId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const [report, setReport] = useState<BuiltReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, start] = useTransition();

  const buildQuery = useCallback(() => {
    const q = new URLSearchParams();
    if (periodId.trim()) q.set("periodId", periodId.trim());
    if (batchId.trim()) q.set("batchId", batchId.trim());
    if (employeeId) q.set("employeeId", employeeId);
    return q;
  }, [periodId, batchId, employeeId]);

  const load = useCallback(
    (which: string) => {
      setLoading(true);
      setError(null);
      const q = buildQuery();
      fetch(`/api/payroll/reports/${which}${q.toString() ? `?${q.toString()}` : ""}`, { cache: "no-store" })
        .then(async (r) => {
          const d = await r.json().catch(() => null);
          if (!r.ok) {
            setError(readError(d, "Could not build this report."));
            setReport(null);
            return;
          }
          setReport(d && Array.isArray(d.columns) ? (d as BuiltReport) : null);
        })
        .catch(() => setError("Could not build this report."))
        .finally(() => setLoading(false));
    },
    [buildQuery],
  );

  // Load whenever the report kind changes; filters apply on the explicit button.
  useEffect(() => {
    if (canRead) load(kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, kind]);

  const download = () =>
    start(async () => {
      setError(null);
      const q = buildQuery();
      q.set("format", "csv");
      const res = await fetch(`/api/payroll/reports/${kind}?${q.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(readError(d, "Could not export this report."));
        return;
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `payroll-${kind}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    });

  if (!canRead) {
    return (
      <Card>
        <NoAccess>You don&apos;t have access to payroll reports.</NoAccess>
      </Card>
    );
  }

  const active = KINDS.find((k) => k.value === kind);

  return (
    <div className="space-y-4">
      {/* Report picker — a compact segmented row so the seven kinds read at a glance. */}
      <div className="flex flex-wrap gap-1.5">
        {KINDS.map((k) => (
          <button
            key={k.value}
            onClick={() => setKind(k.value)}
            className={
              kind === k.value
                ? "rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white"
                : "rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            }
          >
            {k.label}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader
          title={active?.label ?? "Report"}
          subtitle={active?.hint}
          action={
            <div className="flex items-center gap-2">
              <button onClick={() => setShowFilters((v) => !v)} className={secondaryBtn} aria-pressed={showFilters}>
                <Filter className="size-4" /> Filters
              </button>
              <button onClick={() => load(kind)} disabled={loading} className={secondaryBtn}>
                <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Refresh
              </button>
              {canExport ? (
                <button onClick={download} disabled={downloading || loading} className={primaryBtn}>
                  <Download className="size-4" /> {downloading ? "Exporting…" : "Export CSV"}
                </button>
              ) : null}
            </div>
          }
        />

        {showFilters ? (
          <div className="border-b border-hairline bg-panel-2/40 px-5 py-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className={labelCls}>Employee <span className="font-normal text-slate-400">(optional)</span></label>
                <EmployeePicker value={employeeId} onChange={setEmployeeId} employees={employees} placeholder="All employees" />
              </div>
              <div>
                <label className={labelCls}>Period id <span className="font-normal text-slate-400">(optional)</span></label>
                <input className={inputCls} value={periodId} onChange={(e) => setPeriodId(e.target.value)} placeholder="Defaults to current" />
              </div>
              <div>
                <label className={labelCls}>Batch id <span className="font-normal text-slate-400">(optional)</span></label>
                <input className={inputCls} value={batchId} onChange={(e) => setBatchId(e.target.value)} placeholder="Any batch in the period" />
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => {
                  setEmployeeId("");
                  setPeriodId("");
                  setBatchId("");
                }}
                className={secondaryBtn}
              >
                Clear
              </button>
              <button onClick={() => load(kind)} disabled={loading} className={primaryBtn}>
                Apply filters
              </button>
            </div>
          </div>
        ) : null}

        {error ? <p className="px-5 pt-4 text-sm text-rose-600">{error}</p> : null}

        {loading ? (
          <CardBody>
            <SkeletonTableCard rows={6} cols={5} />
          </CardBody>
        ) : !report ? (
          <EmptyState
            icon={<BarChart3 className="size-5" />}
            title="No report yet"
            hint="Pick a report kind above to build a table."
          />
        ) : report.rows.length === 0 ? (
          <EmptyState
            icon={<BarChart3 className="size-5" />}
            title="No data for this report"
            hint="There are no payroll records matching this report and the current filters yet."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-xs text-slate-500">
                  {report.columns.map((c, i) => {
                    // Header alignment follows the first data row's cell type.
                    const numeric = typeof report.rows[0]?.[i] === "number";
                    return (
                      <th key={`${c}-${i}`} className={`px-5 py-3 font-medium ${numeric ? "text-right" : "text-left"}`}>
                        {c}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row, ri) => (
                  <tr key={ri} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                    {row.map((cell, ci) => {
                      const { text, numeric } = renderCell(cell);
                      return (
                        <td
                          key={ci}
                          className={`px-5 py-3 ${numeric ? "text-right tabular-nums text-slate-800" : "text-slate-600"} ${ci === 0 ? "font-medium text-slate-900" : ""}`}
                        >
                          {text}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {report && report.rows.length > 0 ? (
          <div className="border-t border-hairline px-5 py-3 text-xs text-slate-400">
            {report.rows.length.toLocaleString("en-US")} row{report.rows.length === 1 ? "" : "s"} · scoped to your reach, Owner excluded
          </div>
        ) : null}
      </Card>
    </div>
  );
}
