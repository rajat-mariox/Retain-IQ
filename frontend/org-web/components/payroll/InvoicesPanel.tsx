"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { AlertTriangle, Ban, BadgeCheck, FileText, Plus, Send } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import type { ClientRow, InvoiceDetail, InvoicePreview, InvoiceRow } from "@/lib/api";

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
const label = "mb-1.5 block text-sm font-medium text-slate-700";
const fmtMins = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
const money = (c: number, cur = "USD") =>
  `${cur === "USD" ? "$" : ""}${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600 ring-slate-200",
  SENT: "bg-amber-50 text-amber-700 ring-amber-200",
  PAID: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  VOID: "bg-rose-50 text-rose-600 ring-rose-200",
};
const SOURCE_LABEL: Record<string, string> = {
  project_employee: "project · person rate",
  project: "project rate",
  client_employee: "client · person rate",
  client: "client rate",
  employee_default: "employee default rate",
};

function monthBounds(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const p = (n: number) => String(n).padStart(2, "0");
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return { periodStart: `${y}-${p(m + 1)}-01`, periodEnd: `${y}-${p(m + 1)}-${p(last)}` };
}

export function InvoicesPanel({ invoices: initial, clients }: { invoices: InvoiceRow[]; clients: ClientRow[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState(initial);

  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [genOpen, setGenOpen] = useState(false);
  const [form, setForm] = useState({ clientId: "", ...monthBounds(), dueInDays: "30", note: "" });
  const [preview, setPreview] = useState<InvoicePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const reload = useCallback(() => {
    fetch("/api/payroll/invoices", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setInvoices(d))
      .catch(() => undefined);
  }, []);

  const openDetail = (id: string) => {
    setDetail(null);
    setDetailLoading(true);
    fetch(`/api/payroll/invoices/${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: InvoiceDetail) => setDetail(d?.lines ? d : null))
      .catch(() => undefined)
      .finally(() => setDetailLoading(false));
  };

  const loadPreview = useCallback((clientId: string, periodStart: string, periodEnd: string) => {
    // An inverted range is a transient state while typing — don't fire a
    // request the backend will rightly reject.
    if (!clientId || !periodStart || !periodEnd || periodEnd < periodStart) return setPreview(null);
    setPreviewLoading(true);
    fetch(`/api/payroll/invoices/preview?clientId=${clientId}&periodStart=${periodStart}&periodEnd=${periodEnd}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: InvoicePreview) => setPreview(d?.totals ? d : null))
      .catch(() => setPreview(null))
      .finally(() => setPreviewLoading(false));
  }, []);
  useEffect(() => {
    if (genOpen) loadPreview(form.clientId, form.periodStart, form.periodEnd);
  }, [genOpen, form.clientId, form.periodStart, form.periodEnd, loadPreview]);

  const generate = () =>
    start(async () => {
      setError(null);
      const res = await fetch("/api/payroll/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: form.clientId,
          periodStart: form.periodStart,
          periodEnd: form.periodEnd,
          dueInDays: form.dueInDays ? Number(form.dueInDays) : undefined,
          note: form.note || undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setError(d?.error?.message ?? "Could not generate the invoice.");
      setGenOpen(false);
      reload();
      openDetail(d.id);
    });

  const act = (id: string, action: "send" | "paid" | "void") =>
    start(async () => {
      setError(null);
      if (action === "void" && typeof window !== "undefined" && !window.confirm("Void this invoice? The number stays on record.")) return;
      const res = await fetch(`/api/payroll/invoices/${id}/${action}`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setError(d?.error?.message ?? `Could not ${action} the invoice.`);
      setDetail(d?.lines ? d : null);
      reload();
    });

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <Card>
        <CardHeader
          title="Client invoices"
          subtitle="Generated from approved billable hours, priced with the rate in effect on the work"
          action={
            <button
              onClick={() => { setError(null); setPreview(null); setForm({ clientId: "", ...monthBounds(), dueInDays: "30", note: "" }); setGenOpen(true); }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-soft"
            >
              <Plus className="size-4" /> New invoice
            </button>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-hairline text-xs text-slate-500">
                <th className="px-5 py-3 text-left font-medium">Invoice</th>
                <th className="px-5 py-3 text-left font-medium">Client</th>
                <th className="px-5 py-3 text-left font-medium">Period</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Due</th>
                <th className="px-5 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} onClick={() => openDetail(i.id)} className="cursor-pointer border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-900">{i.invoiceNumber}</td>
                  <td className="px-5 py-3 text-slate-700">{i.clientName}</td>
                  <td className="px-5 py-3 tabular-nums text-xs text-slate-500">{i.periodStart} → {i.periodEnd}</td>
                  <td className="px-5 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS[i.status]}`}>{i.status.toLowerCase()}</span></td>
                  <td className="px-5 py-3 text-right text-xs text-slate-500">{i.dueAt ?? "—"}</td>
                  <td className="px-5 py-3 text-right tabular-nums font-medium text-slate-800">{money(i.totalCents, i.currency)}</td>
                </tr>
              ))}
              {invoices.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-500">No invoices yet — generate one from a client&apos;s billable hours.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ---------------- generate + preview ---------------- */}
      <Modal open={genOpen} onClose={() => setGenOpen(false)} title="New client invoice" size="lg">
        <div className="space-y-4">
          <div>
            <label className={label}>Client</label>
            <select className={input} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
              <option value="">Select a client…</option>
              {clients.filter((c) => c.status === "ACTIVE").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className={label}>Period start</label><input type="date" className={input} value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} /></div>
            <div><label className={label}>Period end</label><input type="date" className={input} value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} /></div>
            <div><label className={label}>Due in (days)</label><input type="number" min={0} className={input} value={form.dueInDays} onChange={(e) => setForm({ ...form, dueInDays: e.target.value })} /></div>
          </div>
          <div><label className={label}>Note (optional)</label><input className={input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. July 2026 services" /></div>

          <div className="rounded-xl border border-hairline/70">
            <p className="border-b border-hairline/60 bg-panel-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Preview — what this client will be billed</p>
            {!form.clientId ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">Pick a client to preview their billable hours.</p>
            ) : previewLoading ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">Calculating…</p>
            ) : preview ? (
              <div className="p-4">
                <div className="mb-3 flex flex-wrap gap-4 text-sm">
                  <span><span className="text-slate-500">Hours</span> <span className="font-semibold text-slate-900">{fmtMins(preview.totals.minutes)}</span></span>
                  <span><span className="text-slate-500">Lines</span> <span className="font-semibold text-slate-900">{preview.totals.lineCount}</span></span>
                  <span><span className="text-slate-500">Total</span> <span className="font-semibold text-slate-900">{money(preview.totals.totalCents, preview.currency)}</span></span>
                </div>
                {preview.skipped.length ? (
                  <div className="mb-3 flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span><span className="font-medium">Not billed:</span> {preview.skipped.join("; ")}</span>
                  </div>
                ) : null}
                <ul className="max-h-44 divide-y divide-hairline/60 overflow-y-auto">
                  {preview.lines.map((l, idx) => (
                    <li key={idx} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                      <span className="min-w-0 truncate text-slate-700">
                        {l.description}
                        {l.rateSource ? <span className="ml-1.5 text-xs text-slate-400">· {SOURCE_LABEL[l.rateSource] ?? l.rateSource}</span> : null}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-slate-500">
                        {fmtMins(l.minutes)} @ {money(l.billRateCents, preview.currency)} = <span className="font-medium text-slate-800">{money(l.amountCents, preview.currency)}</span>
                      </span>
                    </li>
                  ))}
                  {preview.lines.length === 0 ? <li className="py-6 text-center text-sm text-slate-500">No billable hours for this client in this period.</li> : null}
                </ul>
              </div>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-slate-500">No billable hours for this client in this period.</p>
            )}
          </div>

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setGenOpen(false)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={generate} disabled={pending || !preview || preview.lines.length === 0} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">
              <FileText className="size-4" /> {pending ? "Generating…" : "Generate invoice"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ---------------- invoice detail ---------------- */}
      <Modal open={detailLoading || Boolean(detail)} onClose={() => setDetail(null)} title="Invoice" size="lg">
        {detailLoading || !detail ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading invoice…</p>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-panel-2 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">{detail.invoiceNumber}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {detail.orgName} <span className="text-slate-400">→</span> {detail.clientName}
                  {detail.clientEmail ? <span className="text-slate-400"> · {detail.clientEmail}</span> : null}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{detail.periodStart} → {detail.periodEnd}{detail.dueAt ? ` · due ${detail.dueAt}` : ""}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-semibold tabular-nums text-slate-900">{money(detail.totalCents, detail.currency)}</p>
                <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS[detail.status]}`}>{detail.status.toLowerCase()}</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-hairline text-xs text-slate-500">
                    <th className="px-3 py-2 text-left font-medium">Description</th>
                    <th className="px-3 py-2 text-right font-medium">Hours</th>
                    <th className="px-3 py-2 text-right font-medium">Rate</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((l) => (
                    <tr key={l.id} className="border-b border-hairline/60 last:border-0">
                      <td className="px-3 py-2 text-slate-800">{l.description}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{fmtMins(l.minutes)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{money(l.billRateCents, detail.currency)}/h</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-900">{money(l.amountCents, detail.currency)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-hairline">
                    <td className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmtMins(detail.totals.minutes)}</td>
                    <td />
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">{money(detail.totalCents, detail.currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {detail.note ? <p className="text-xs text-slate-500">{detail.note}</p> : null}
            {detail.status !== "DRAFT" ? (
              <p className="text-xs text-slate-500">Issued invoices are fixed — the rates above are the ones resolved at generation, and a later rate change won&apos;t restate them.</p>
            ) : null}

            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
            <div className="flex justify-end gap-2">
              {detail.status === "DRAFT" ? (
                <>
                  <button onClick={() => act(detail.id, "void")} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-60">
                    <Ban className="size-4" /> Void
                  </button>
                  <button onClick={() => act(detail.id, "send")} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">
                    <Send className="size-4" /> Mark sent
                  </button>
                </>
              ) : null}
              {detail.status === "SENT" ? (
                <button onClick={() => act(detail.id, "paid")} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">
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
