"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, Plus } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { inputCls, labelCls, readError } from "./workspace-shared";
import { EmptyState, humanizeStatus } from "./payout-ui";
import type { PayrollAccess } from "./access";

interface Calendar {
  id: string;
  name: string;
  frequency: string;
  currencyCode: string;
  countryCode: string | null;
  active: boolean;
}
interface Period {
  id: string;
  calendarId: string;
  periodStart: string;
  periodEnd: string;
  payDate: string | null;
  status: string;
}

const FREQUENCIES = ["MONTHLY", "WEEKLY", "BIWEEKLY", "SEMI_MONTHLY", "DAILY", "CUSTOM"];

/**
 * Setup tab (§9): create payroll calendars and their pay periods. A batch cannot
 * exist without a period, so this is the entry point — it is shown first when the
 * caller can create batches. Gated by payroll.batch.create.
 */
export function CalendarPanel({ can }: { can: PayrollAccess }) {
  const [calendars, setCalendars] = useState<Calendar[] | null>(null);
  const [periods, setPeriods] = useState<Period[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [calForm, setCalForm] = useState({ name: "", frequency: "MONTHLY", currencyCode: "USD", countryCode: "" });
  const [perForm, setPerForm] = useState({ periodStart: "", periodEnd: "", payDate: "" });
  const [busy, setBusy] = useState(false);

  const loadCalendars = useCallback(() => {
    fetch("/api/payroll/calendars", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((rows: Calendar[]) => {
        setCalendars(rows);
        if (!selected && rows[0]) setSelected(rows[0].id);
      })
      .catch(async (r) => setError(await readError(r, "Could not load calendars.")));
  }, [selected]);

  useEffect(() => { loadCalendars(); }, [loadCalendars]);

  useEffect(() => {
    if (!selected) { setPeriods(null); return; }
    fetch(`/api/payroll/periods?calendarId=${selected}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((rows: Period[]) => setPeriods(rows))
      .catch(async (r) => setError(await readError(r, "Could not load pay periods.")));
  }, [selected]);

  async function createCalendar() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/payroll/calendars", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: calForm.name.trim(),
          frequency: calForm.frequency,
          currencyCode: calForm.currencyCode.trim().toUpperCase(),
          countryCode: calForm.countryCode.trim() ? calForm.countryCode.trim().toUpperCase() : null,
        }),
      });
      if (!res.ok) throw res;
      const cal: Calendar = await res.json();
      setCalForm({ name: "", frequency: "MONTHLY", currencyCode: "USD", countryCode: "" });
      setSelected(cal.id);
      loadCalendars();
    } catch (r) {
      setError(await readError(r, "Could not create the calendar."));
    } finally { setBusy(false); }
  }

  async function createPeriod() {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/payroll/periods", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          calendarId: selected,
          periodStart: perForm.periodStart,
          periodEnd: perForm.periodEnd,
          payDate: perForm.payDate || null,
        }),
      });
      if (!res.ok) throw res;
      setPerForm({ periodStart: "", periodEnd: "", payDate: "" });
      // reload periods
      const rows: Period[] = await fetch(`/api/payroll/periods?calendarId=${selected}`, { cache: "no-store" }).then((r) => r.json());
      setPeriods(rows);
    } catch (r) {
      setError(await readError(r, "Could not create the pay period."));
    } finally { setBusy(false); }
  }

  if (!can.canBatchCreate) {
    return <EmptyState title="No access" hint="You do not have permission to configure payroll calendars." />;
  }

  return (
    <div className="space-y-4">
      {error ? <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">{error}</div> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Calendars */}
        <Card>
          <CardHeader title="Payroll calendars" subtitle="Pay frequency, currency and country for a group of employees" />
          <CardBody className="space-y-3">
            {calendars === null ? (
              <p className="py-2 text-sm text-slate-400">Loading…</p>
            ) : calendars.length === 0 ? (
              <p className="text-sm text-slate-500">No calendars yet — create one below to get started.</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {calendars.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => setSelected(c.id)}
                      className={`flex w-full items-center justify-between px-1 py-2 text-left text-sm ${selected === c.id ? "font-medium text-brand" : "text-slate-700 hover:text-slate-900"}`}
                    >
                      <span>{c.name}</span>
                      <span className="text-xs text-slate-400">{humanizeStatus(c.frequency)} · {c.currencyCode}{c.countryCode ? ` · ${c.countryCode}` : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="space-y-2 rounded-xl border border-hairline p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">New calendar</p>
              <div>
                <label className={labelCls}>Name</label>
                <input className={inputCls} value={calForm.name} onChange={(e) => setCalForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. India Monthly" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={labelCls}>Frequency</label>
                  <select className={inputCls} value={calForm.frequency} onChange={(e) => setCalForm((f) => ({ ...f, frequency: e.target.value }))}>
                    {FREQUENCIES.map((x) => <option key={x} value={x}>{humanizeStatus(x)}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Currency</label>
                  <input className={inputCls} value={calForm.currencyCode} maxLength={3} onChange={(e) => setCalForm((f) => ({ ...f, currencyCode: e.target.value }))} placeholder="USD" />
                </div>
                <div>
                  <label className={labelCls}>Country</label>
                  <input className={inputCls} value={calForm.countryCode} maxLength={2} onChange={(e) => setCalForm((f) => ({ ...f, countryCode: e.target.value }))} placeholder="IN" />
                </div>
              </div>
              <button
                onClick={createCalendar}
                disabled={busy || calForm.name.trim().length < 1 || calForm.currencyCode.trim().length !== 3}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                <CalendarPlus className="size-4" /> Create calendar
              </button>
            </div>
          </CardBody>
        </Card>

        {/* Periods for the selected calendar */}
        <Card>
          <CardHeader title="Pay periods" subtitle={selected ? "Periods in the selected calendar" : "Select a calendar to manage its periods"} />
          <CardBody className="space-y-3">
            {!selected ? (
              <p className="text-sm text-slate-500">Select or create a calendar first.</p>
            ) : periods === null ? (
              <p className="py-2 text-sm text-slate-400">Loading…</p>
            ) : periods.length === 0 ? (
              <p className="text-sm text-slate-500">No pay periods yet — create the first one below. A payroll batch runs against a period.</p>
            ) : (
              <ul className="divide-y divide-hairline text-sm">
                {periods.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2">
                    <span className="tabular-nums text-slate-700">{p.periodStart} → {p.periodEnd}</span>
                    <span className="text-xs text-slate-400">{p.payDate ? `pay ${p.payDate} · ` : ""}{humanizeStatus(p.status)}</span>
                  </li>
                ))}
              </ul>
            )}

            {selected ? (
              <div className="space-y-2 rounded-xl border border-hairline p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">New pay period</p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className={labelCls}>Start</label>
                    <input type="date" className={inputCls} value={perForm.periodStart} onChange={(e) => setPerForm((f) => ({ ...f, periodStart: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelCls}>End</label>
                    <input type="date" className={inputCls} value={perForm.periodEnd} onChange={(e) => setPerForm((f) => ({ ...f, periodEnd: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelCls}>Pay date</label>
                    <input type="date" className={inputCls} value={perForm.payDate} onChange={(e) => setPerForm((f) => ({ ...f, payDate: e.target.value }))} />
                  </div>
                </div>
                <button
                  onClick={createPeriod}
                  disabled={busy || !perForm.periodStart || !perForm.periodEnd}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  <Plus className="size-4" /> Add pay period
                </button>
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
