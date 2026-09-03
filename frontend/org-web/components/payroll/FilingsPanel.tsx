"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, FileCheck2, Landmark, Plus, Send, ShieldCheck } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { inputCls, labelCls, primaryBtn, readError, secondaryBtn } from "./workspace-shared";
import { EmptyState, humanizeStatus } from "./payout-ui";
import type { PayrollAccess } from "./access";

interface Filing {
  id: string; kind: string; label: string; countryCode: string; periodLabel: string;
  periodStart: string; periodEnd: string; status: string; employeeCount: number; lineCount?: number;
  totalWages: number; totalEmployee: number; totalEmployer: number; totalTax: number;
  reference: string | null; generatedAt: string; submittedAt: string | null;
}

const KINDS = [
  { v: "PF_ECR", label: "PF ECR (EPFO)" },
  { v: "ESI", label: "ESI contribution" },
  { v: "PT", label: "Professional Tax" },
  { v: "FORM24Q", label: "Form 24Q — quarterly TDS" },
  { v: "FORM16", label: "Form 16 — annual TDS" },
];
const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const statusCls = (s: string) =>
  ({ PREPARED: "bg-amber-50 text-amber-700 ring-amber-200", REVIEWED: "bg-blue-50 text-blue-700 ring-blue-200", APPROVED: "bg-emerald-50 text-emerald-700 ring-emerald-200", SUBMITTED: "bg-green-50 text-green-700 ring-green-200", FILED: "bg-green-50 text-green-700 ring-green-200", REJECTED: "bg-rose-50 text-rose-700 ring-rose-200", DRAFT: "bg-slate-100 text-slate-600 ring-slate-200" }[s] ?? "bg-slate-100 text-slate-600 ring-slate-200");
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthStart = () => todayISO().slice(0, 8) + "01";

/**
 * Phase-3 statutory filings (§14). Generate PF ECR / ESI / PT / Form-24Q / Form-16
 * returns from finalized payroll, then walk each through approve (separation of
 * duties) → submit, and download the per-employee CSV.
 */
export function FilingsPanel({ can }: { can: PayrollAccess }) {
  const [rows, setRows] = useState<Filing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [gen, setGen] = useState({ kind: "PF_ECR", periodStart: monthStart(), periodEnd: todayISO(), periodLabel: "" });

  const load = useCallback(() => {
    fetch("/api/payroll/filings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d: Filing[]) => setRows(Array.isArray(d) ? d : []))
      .catch(async (r) => setError(await readError(r, "Could not load filings.")));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(id: string, path: string, body?: unknown) {
    setBusyId(id); setError(null);
    try {
      const res = await fetch(`/api/payroll/filings/${id}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      if (!res.ok) throw res;
      load();
    } catch (r) { setError(await readError(r, "Action failed.")); } finally { setBusyId(null); }
  }

  async function download(id: string) {
    try {
      const res = await fetch(`/api/payroll/filings/${id}/export`, { cache: "no-store" });
      if (!res.ok) throw res;
      const { filename, body } = (await res.json()) as { filename: string; body: string };
      const url = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (r) { setError(await readError(r, "Could not export the filing.")); }
  }

  async function generate() {
    setBusyId("gen"); setError(null);
    try {
      const res = await fetch("/api/payroll/filings/generate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: gen.kind, periodStart: gen.periodStart, periodEnd: gen.periodEnd, periodLabel: gen.periodLabel.trim() || undefined }),
      });
      if (!res.ok) throw res;
      setOpen(false); load();
    } catch (r) { setError(await readError(r, "Could not generate the filing.")); } finally { setBusyId(null); }
  }

  return (
    <Card>
      <CardHeader
        title="Statutory filings & returns"
        subtitle="PF ECR · ESI · PT · Form-24Q · Form-16 — generated from finalized payroll, then approved & submitted"
        action={can.canFilingPrepare ? <button onClick={() => setOpen((o) => !o)} className={primaryBtn}><Plus className="size-4" /> {open ? "Close" : "Generate return"}</button> : null}
      />
      <CardBody className="space-y-4">
        {error ? <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">{error}</div> : null}

        {open && can.canFilingPrepare ? (
          <div className="space-y-3 rounded-xl border border-hairline bg-panel-2/40 p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              <div className="sm:col-span-2"><label className={labelCls}>Return</label>
                <select className={inputCls} value={gen.kind} onChange={(e) => setGen((g) => ({ ...g, kind: e.target.value }))}>{KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}</select>
              </div>
              <div><label className={labelCls}>Period start</label><input type="date" className={inputCls} value={gen.periodStart} onChange={(e) => setGen((g) => ({ ...g, periodStart: e.target.value }))} /></div>
              <div><label className={labelCls}>Period end</label><input type="date" className={inputCls} value={gen.periodEnd} onChange={(e) => setGen((g) => ({ ...g, periodEnd: e.target.value }))} /></div>
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1"><label className={labelCls}>Label (optional)</label><input className={inputCls} value={gen.periodLabel} onChange={(e) => setGen((g) => ({ ...g, periodLabel: e.target.value }))} placeholder="2025-07 / 2025-Q2 / FY2025-26" /></div>
              <button onClick={generate} disabled={busyId === "gen"} className={primaryBtn}><FileCheck2 className="size-4" /> Generate</button>
            </div>
            <p className="text-xs text-slate-400">Aggregates APPROVED/PAID payroll records in the window. CSV layout is best-effort — verify against the portal spec before filing.</p>
          </div>
        ) : null}

        {rows === null ? (
          <p className="py-2 text-sm text-slate-400">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Landmark className="size-5" />} title="No filings yet" hint={can.canFilingPrepare ? "Generate a return above." : "No statutory returns have been generated."} />
        ) : (
          <ul className="space-y-3">
            {rows.map((f) => (
              <li key={f.id} className="rounded-xl border border-hairline p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      {f.label}
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${statusCls(f.status)}`}>{humanizeStatus(f.status)}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">{f.periodLabel} · {f.periodStart} → {f.periodEnd} · {f.employeeCount} employee{f.employeeCount === 1 ? "" : "s"}{f.reference ? ` · ref ${f.reference}` : ""}</p>
                  </div>
                  <div className="text-right text-xs tabular-nums text-slate-600">
                    {f.totalTax > 0 ? <p>TDS <span className="font-semibold text-slate-900">₹{inr(f.totalTax)}</span></p> : null}
                    {f.totalEmployee > 0 ? <p>Employee <span className="font-semibold text-slate-900">₹{inr(f.totalEmployee)}</span></p> : null}
                    {f.totalEmployer > 0 ? <p>Employer ₹{inr(f.totalEmployer)}</p> : null}
                    {f.totalWages > 0 ? <p className="text-slate-400">wages ₹{inr(f.totalWages)}</p> : null}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {["PREPARED", "REVIEWED"].includes(f.status) && can.canFilingApprove ? (
                    <button onClick={() => act(f.id, "/approve")} disabled={busyId === f.id} className={secondaryBtn}><ShieldCheck className="size-4" /> Approve</button>
                  ) : null}
                  {f.status === "APPROVED" && can.canFilingSubmit ? (
                    <button onClick={() => { const ref = window.prompt("Challan / acknowledgement number (optional):") ?? undefined; act(f.id, "/submit", { reference: ref }); }} disabled={busyId === f.id} className={primaryBtn}><Send className="size-4" /> Submit</button>
                  ) : null}
                  <button onClick={() => download(f.id)} className={secondaryBtn}><Download className="size-4" /> CSV</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
