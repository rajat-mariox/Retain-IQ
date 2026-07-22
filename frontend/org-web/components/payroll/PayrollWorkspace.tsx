"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { AlertTriangle, BadgeCheck, Lock, Play, Plus } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import type { PayrollCycleRow, PayrollRun, PayrollSettings } from "@/lib/api";

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
const label = "mb-1.5 block text-sm font-medium text-slate-700";

const fmtMins = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
const money = (cents: number, currency = "USD") =>
  `${currency === "USD" ? "$" : ""}${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600 ring-slate-200",
  LOCKED: "bg-amber-50 text-amber-700 ring-amber-200",
  PAID: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  PREVIEW: "bg-brand/10 text-brand ring-brand/20",
};

/** First and last day of the month `d` falls in, as YYYY-MM-DD. */
function monthBounds(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const p = (n: number) => String(n).padStart(2, "0");
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return { periodStart: `${y}-${p(m + 1)}-01`, periodEnd: `${y}-${p(m + 1)}-${p(last)}` };
}

export function PayrollWorkspace({ cycles: initialCycles, settings }: { cycles: PayrollCycleRow[]; settings: PayrollSettings | null }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cycles, setCycles] = useState(initialCycles);
  const currency = settings?.currency ?? "USD";

  const [openCycle, setOpenCycle] = useState<PayrollRun | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // preview / create
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ ...monthBounds(), note: "" });
  const [preview, setPreview] = useState<PayrollRun | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const reload = useCallback(() => {
    fetch("/api/payroll/cycles", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setCycles(d))
      .catch(() => undefined);
  }, []);

  const openDetail = (id: string) => {
    setOpenCycle(null);
    setDetailLoading(true);
    fetch(`/api/payroll/cycles/${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: PayrollRun) => setOpenCycle(d?.totals ? d : null))
      .catch(() => undefined)
      .finally(() => setDetailLoading(false));
  };

  // Dry-run the period as the dates change, so "what will this cost?" is
  // answered before a cycle exists.
  const loadPreview = useCallback((periodStart: string, periodEnd: string) => {
    // Editing one date at a time transiently inverts the range; don't fire a
    // request the backend will (rightly) reject — just hold the last preview.
    if (!periodStart || !periodEnd || periodEnd < periodStart) return;
    setPreviewLoading(true);
    fetch(`/api/payroll/cycles/preview?periodStart=${periodStart}&periodEnd=${periodEnd}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: PayrollRun) => setPreview(d?.totals ? d : null))
      .catch(() => setPreview(null))
      .finally(() => setPreviewLoading(false));
  }, []);
  useEffect(() => {
    if (createOpen) loadPreview(form.periodStart, form.periodEnd);
  }, [createOpen, form.periodStart, form.periodEnd, loadPreview]);

  const createCycle = () =>
    start(async () => {
      setError(null);
      const res = await fetch("/api/payroll/cycles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodStart: form.periodStart, periodEnd: form.periodEnd, note: form.note || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setError(d?.error?.message ?? "Could not create the cycle.");
      // Run it immediately — an empty cycle is never what someone wants.
      await fetch(`/api/payroll/cycles/${d.id}/run`, { method: "POST" });
      setCreateOpen(false);
      reload();
      openDetail(d.id);
    });

  const act = (id: string, action: "run" | "lock" | "paid") =>
    start(async () => {
      setError(null);
      const res = await fetch(`/api/payroll/cycles/${id}/${action}`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setError(d?.error?.message ?? `Could not ${action} the cycle.`);
      setOpenCycle(d?.totals ? d : null);
      reload();
    });

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <Card>
        <CardHeader
          title="Payroll cycles"
          subtitle={settings?.requireApproval ? "Computed from approved timesheet hours only" : "Computed from all tracked hours (approval not required)"}
          action={
            <button onClick={() => { setError(null); setForm({ ...monthBounds(), note: "" }); setCreateOpen(true); }} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-soft">
              <Plus className="size-4" /> New cycle
            </button>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-hairline text-xs text-slate-500">
                <th className="px-5 py-3 text-left font-medium">Period</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Employees</th>
                <th className="px-5 py-3 text-right font-medium">Gross</th>
                <th className="px-5 py-3 text-right font-medium">Run</th>
              </tr>
            </thead>
            <tbody>
              {cycles.map((c) => (
                <tr key={c.id} onClick={() => openDetail(c.id)} className="cursor-pointer border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3 tabular-nums text-slate-700">
                    {c.periodStart} <span className="text-slate-400">→</span> {c.periodEnd}
                    {c.note ? <span className="ml-2 text-xs text-slate-400">{c.note}</span> : null}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS[c.status]}`}>{c.status.toLowerCase()}</span>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-600">{c.employeeCount}</td>
                  <td className="px-5 py-3 text-right tabular-nums font-medium text-slate-800">{money(c.totalGrossCents, c.currency)}</td>
                  <td className="px-5 py-3 text-right text-xs text-slate-500">{c.runAt ? c.runAt.slice(0, 10) : "not run"}</td>
                </tr>
              ))}
              {cycles.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-500">No payroll cycles yet — create one for the current month.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ---------------- create + preview ---------------- */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New payroll cycle" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Period start</label><input type="date" className={input} value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} /></div>
            <div><label className={label}>Period end</label><input type="date" className={input} value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} /></div>
          </div>
          <div><label className={label}>Note (optional)</label><input className={input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. July 2026" /></div>

          <div className="rounded-xl border border-hairline/70">
            <p className="border-b border-hairline/60 bg-panel-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Preview — what this period will pay
            </p>
            {previewLoading ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">Calculating…</p>
            ) : preview ? (
              <div className="p-4">
                <div className="mb-3 flex flex-wrap gap-4 text-sm">
                  <span><span className="text-slate-500">Employees</span> <span className="font-semibold text-slate-900">{preview.totals.employeeCount}</span></span>
                  <span><span className="text-slate-500">Regular</span> <span className="font-semibold text-slate-900">{fmtMins(preview.totals.regularMinutes)}</span></span>
                  <span><span className="text-slate-500">Overtime</span> <span className="font-semibold text-slate-900">{fmtMins(preview.totals.overtimeMinutes)}</span></span>
                  <span><span className="text-slate-500">Gross</span> <span className="font-semibold text-slate-900">{money(preview.totals.grossPayCents, preview.currency)}</span></span>
                </div>
                {preview.excluded.length ? (
                  <div className="mb-3 flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      <span className="font-medium">{preview.excluded.length} employee{preview.excluded.length === 1 ? "" : "s"} will be skipped:</span>{" "}
                      {preview.excluded.map((e) => e.employeeName).join(", ")} — no cost rate set for these dates.
                    </span>
                  </div>
                ) : null}
                <ul className="max-h-48 divide-y divide-hairline/60 overflow-y-auto">
                  {preview.lines.map((l) => (
                    <li key={l.employeeId} className="flex items-center justify-between py-1.5 text-sm">
                      <span className="text-slate-700">{l.employeeName}</span>
                      <span className="flex items-center gap-3 text-xs">
                        <span className="tabular-nums text-slate-500">{fmtMins(l.regularMinutes)}{l.overtimeMinutes ? ` + ${fmtMins(l.overtimeMinutes)} OT` : ""}</span>
                        {l.problem ? <span className="text-amber-700">no rate</span> : <span className="tabular-nums font-medium text-slate-800">{money(l.grossPayCents, preview.currency)}</span>}
                      </span>
                    </li>
                  ))}
                  {preview.lines.length === 0 ? <li className="py-6 text-center text-sm text-slate-500">No approved hours in this period.</li> : null}
                </ul>
              </div>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-slate-500">Pick a period to preview it.</p>
            )}
          </div>

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreateOpen(false)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={createCycle} disabled={pending || !preview || preview.lines.length === 0} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">
              <Play className="size-4" /> {pending ? "Creating…" : "Create & run"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ---------------- cycle detail ---------------- */}
      <Modal open={detailLoading || Boolean(openCycle)} onClose={() => setOpenCycle(null)} title="Payroll cycle" size="lg">
        {detailLoading || !openCycle ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading cycle…</p>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-panel-2 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">{openCycle.periodStart} → {openCycle.periodEnd}</p>
                <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                  <span className={`rounded-full px-2 py-0.5 font-medium ring-1 ring-inset ${STATUS[openCycle.status]}`}>{openCycle.status.toLowerCase()}</span>
                  {openCycle.lockedAt ? <span>locked {openCycle.lockedAt.slice(0, 10)}</span> : openCycle.runAt ? <span>run {openCycle.runAt.slice(0, 10)}</span> : null}
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-semibold tabular-nums text-slate-900">{money(openCycle.totals.grossPayCents, openCycle.currency)}</p>
                <p className="text-xs text-slate-500">{openCycle.totals.employeeCount} employee{openCycle.totals.employeeCount === 1 ? "" : "s"} · {openCycle.totals.utilization}% billable</p>
              </div>
            </div>

            {openCycle.excluded.length ? (
              <div className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span><span className="font-medium">Skipped:</span> {openCycle.excluded.map((e) => `${e.employeeName} (no rate)`).join(", ")}</span>
              </div>
            ) : null}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-hairline text-xs text-slate-500">
                    <th className="px-3 py-2 text-left font-medium">Employee</th>
                    <th className="px-3 py-2 text-right font-medium">Regular</th>
                    <th className="px-3 py-2 text-right font-medium">Overtime</th>
                    <th className="px-3 py-2 text-right font-medium">Rate</th>
                    <th className="px-3 py-2 text-right font-medium">Gross</th>
                  </tr>
                </thead>
                <tbody>
                  {openCycle.lines.map((l) => (
                    <tr key={l.employeeId} className="border-b border-hairline/60 last:border-0">
                      <td className="px-3 py-2 font-medium text-slate-800">{l.employeeName}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{fmtMins(l.regularMinutes)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{l.overtimeMinutes ? fmtMins(l.overtimeMinutes) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{l.costRateCents != null ? `${money(l.costRateCents, openCycle.currency)}/h` : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-900">{money(l.grossPayCents, openCycle.currency)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-hairline">
                    <td className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmtMins(openCycle.totals.regularMinutes)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmtMins(openCycle.totals.overtimeMinutes)}</td>
                    <td />
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">{money(openCycle.totals.grossPayCents, openCycle.currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {openCycle.status === "LOCKED" ? (
              <p className="text-xs text-slate-500">Locked cycles are frozen — the rates above are the ones used at run time, and a later rate change won&apos;t move them.</p>
            ) : null}

            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
            <div className="flex justify-end gap-2">
              {openCycle.status === "DRAFT" && openCycle.id ? (
                <>
                  <button onClick={() => act(openCycle.id as string, "run")} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                    <Play className="size-4" /> Re-run
                  </button>
                  <button onClick={() => act(openCycle.id as string, "lock")} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">
                    <Lock className="size-4" /> Lock
                  </button>
                </>
              ) : null}
              {openCycle.status === "LOCKED" && openCycle.id ? (
                <button onClick={() => act(openCycle.id as string, "paid")} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">
                  <BadgeCheck className="size-4" /> Mark paid
                </button>
              ) : null}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
