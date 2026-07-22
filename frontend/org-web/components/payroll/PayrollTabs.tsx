"use client";

import { useState } from "react";
import { OverviewPanel } from "./OverviewPanel";
import { PayrollWorkspace } from "./PayrollWorkspace";
import { InvoicesPanel } from "./InvoicesPanel";
import { ReportsPanel } from "./ReportsPanel";
import type { ClientRow, InvoiceRow, PayrollCycleRow, PayrollDashboard, PayrollReport, PayrollSettings } from "@/lib/api";

type Tab = "overview" | "cycles" | "invoices" | "reports";

export function PayrollTabs({
  dashboard,
  cycles,
  invoices,
  clients,
  report,
  settings,
}: {
  dashboard: PayrollDashboard | null;
  cycles: PayrollCycleRow[];
  invoices: InvoiceRow[];
  clients: ClientRow[];
  report: PayrollReport | null;
  settings: PayrollSettings | null;
}) {
  const [tab, setTab] = useState<Tab>("overview");

  const TabBtn = ({ k, labelText, count }: { k: Tab; labelText: string; count?: number }) => (
    <button
      onClick={() => setTab(k)}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
        tab === k ? "bg-panel text-slate-900 shadow-sm ring-1 ring-hairline" : "text-slate-500 hover:text-slate-800"
      }`}
    >
      {labelText}
      {count ? <span className="rounded-full bg-amber-100 px-1.5 text-xs tabular-nums text-amber-700">{count}</span> : null}
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1 rounded-xl border border-hairline bg-panel-2 p-1">
        <TabBtn k="overview" labelText="Overview" />
        <TabBtn k="cycles" labelText="Pay cycles" />
        <TabBtn k="invoices" labelText="Invoices" count={invoices.filter((i) => i.status === "DRAFT").length || undefined} />
        <TabBtn k="reports" labelText="Reports & exports" />
      </div>

      {tab === "overview" ? (
        dashboard ? <OverviewPanel data={dashboard} onGoto={setTab} /> : <p className="text-sm text-slate-500">Dashboard unavailable.</p>
      ) : null}
      {tab === "cycles" ? <PayrollWorkspace cycles={cycles} settings={settings} /> : null}
      {tab === "invoices" ? <InvoicesPanel invoices={invoices} clients={clients} /> : null}
      {tab === "reports" ? <ReportsPanel report={report} /> : null}
    </div>
  );
}
