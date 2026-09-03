"use client";

import { useEffect, useState } from "react";
import { Download, FileText, ShieldCheck } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, money } from "./payout-ui";

interface Payslip {
  id: string;
  documentVersion: number;
  currencyCode: string;
  grossAmount: number;
  netAmount: number;
  status: string;
  publishedAt: string | null;
  generatedAt: string;
  downloadUrl: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  periodLabel: string | null;
}

/** "August 2026" from a period end (or a YYYY-MM label). */
function monthLabel(label: string | null, end: string | null): string {
  const src = end ?? (label ? `${label}-01` : null);
  if (!src) return "—";
  const d = new Date(src);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

/**
 * An employee's own payslips (self-service). Each row links to the checksummed PDF
 * via a short-lived presigned URL. Only PUBLISHED payslips are returned by the API,
 * so a payslip appears here only once its month's payroll is paid and released.
 */
export function MyPayslips() {
  const [items, setItems] = useState<Payslip[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me/payroll/statements", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d: { items?: Payslip[] }) => setItems(Array.isArray(d.items) ? d.items : []))
      .catch(() => {
        setItems([]);
        setError("Could not load your payslips. Please try again.");
      });
  }, []);

  return (
    <Card>
      <CardHeader title="My payslips" subtitle="Every month's payslip, available after your salary is paid" />
      <CardBody>
        {error ? <p className="mb-3 text-sm text-rose-600">{error}</p> : null}
        {items === null ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-5" />}
            title="No payslips yet"
            hint="Your payslip appears here after each month's payroll is paid and released."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-xs text-slate-500">
                  <th className="px-4 py-2.5 text-left font-medium">Pay period</th>
                  <th className="px-4 py-2.5 text-right font-medium">Gross</th>
                  <th className="px-4 py-2.5 text-right font-medium">Deductions</th>
                  <th className="px-4 py-2.5 text-right font-medium">Net pay</th>
                  <th className="px-4 py-2.5 text-right font-medium">Payslip</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className="border-b border-hairline/60 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {monthLabel(p.periodLabel, p.periodEnd)}
                      {p.documentVersion > 1 ? <span className="ml-2 text-xs text-slate-400">v{p.documentVersion}</span> : null}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">{money(p.grossAmount, p.currencyCode)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">{money(p.grossAmount - p.netAmount, p.currencyCode)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">{money(p.netAmount, p.currencyCode)}</td>
                    <td className="px-4 py-3 text-right">
                      {p.downloadUrl ? (
                        <a
                          href={p.downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Download className="size-3.5" /> PDF
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">unavailable</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
              <ShieldCheck className="size-3.5" /> Each payslip is checksummed and tamper-evident.
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
