"use client";

import { useState } from "react";
import {
  BarChart3, CalendarClock, Coins, FileText, Gift, LayoutDashboard, Layers,
  MessageSquareWarning, SlidersHorizontal, Users, Wallet, type LucideIcon,
  CalendarPlus,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import type { OrgSession, PayoutDashboard } from "@/lib/api";
import { buildAccess } from "./access";
import { OverviewPanel } from "./OverviewPanel";
import { BatchesPanel } from "./BatchesPanel";
import { CalendarPanel } from "./CalendarPanel";
import { EmployeesPanel } from "./EmployeesPanel";
import { ComponentsPanel } from "./ComponentsPanel";
import { VariablePayPanel } from "./VariablePayPanel";
import { OvertimePanel } from "./OvertimePanel";
import { PaymentsPanel } from "./PaymentsPanel";
import { StatementsPanel } from "./StatementsPanel";
import { DisputesPanel } from "./DisputesPanel";
import { AdjustmentsPanel } from "./AdjustmentsPanel";
import { ReportsPanel } from "./ReportsPanel";
import { EmptyState } from "./payout-ui";

type TabKey =
  | "setup" | "overview" | "batches" | "employees" | "components" | "variable"
  | "overtime" | "payments" | "statements" | "disputes" | "adjustments" | "reports";

interface TabDef {
  key: TabKey;
  label: string;
  visible: boolean;
  icon: LucideIcon;
}

/**
 * The Payroll & Payout workspace shell (§2). A permission-aware tab bar over the
 * §6 dashboard, the batch lifecycle and the surrounding surfaces (profiles,
 * components, variable pay, overtime, payments, statements, disputes,
 * adjustments, reports). Tabs the caller can't read are hidden entirely; each
 * panel additionally enforces its own permissions. Money throughout is plain
 * decimal amounts with an ISO currency code — never cents.
 */
export function PayoutWorkspace({
  session,
  dashboard,
  currency = "USD",
}: {
  session: OrgSession;
  dashboard: PayoutDashboard | null;
  currency?: string;
}) {
  const access = buildAccess(session.role.permissions);

  const tabs: TabDef[] = [
    { key: "setup", label: "Setup", visible: access.canBatchCreate, icon: CalendarPlus },
    { key: "overview", label: "Overview", visible: access.canDashboard, icon: LayoutDashboard },
    { key: "batches", label: "Batches", visible: access.canBatchRead, icon: Layers },
    { key: "employees", label: "Employees", visible: access.canProfileRead, icon: Users },
    { key: "components", label: "Components", visible: access.canComponentRead, icon: SlidersHorizontal },
    { key: "variable", label: "Variable Pay", visible: access.canRecordRead, icon: Gift },
    { key: "overtime", label: "Overtime", visible: access.canRecordRead || access.canOvertimeApprove, icon: CalendarClock },
    { key: "payments", label: "Payments", visible: access.canPaymentRead, icon: Wallet },
    { key: "statements", label: "Statements", visible: access.canStatementEmployeeRead || access.canStatementGenerate, icon: FileText },
    { key: "disputes", label: "Disputes", visible: access.canDisputeRead, icon: MessageSquareWarning },
    { key: "adjustments", label: "Adjustments", visible: access.canAdjustmentReview, icon: Coins },
    { key: "reports", label: "Reports", visible: access.canReportRead, icon: BarChart3 },
  ];

  const visibleTabs = tabs.filter((t) => t.visible);
  const [tab, setTab] = useState<TabKey>(visibleTabs[0]?.key ?? "overview");

  if (visibleTabs.length === 0) {
    return (
      <Card>
        <EmptyState icon={<Wallet className="size-5" />} title="No payroll access" hint="Your role doesn't include any payroll permissions yet." />
      </Card>
    );
  }

  const goto = (key: string) => {
    if (visibleTabs.some((t) => t.key === key)) setTab(key as TabKey);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1 rounded-xl border border-hairline bg-panel-2 p-1">
        {visibleTabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                tab === t.key ? "bg-panel text-slate-900 shadow-sm ring-1 ring-hairline" : "text-slate-500 hover:text-slate-800",
              )}
            >
              <Icon className="size-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === "setup" ? <CalendarPanel can={access} /> : null}
      {tab === "overview" ? <OverviewPanel data={dashboard} currency={currency} onGoto={goto} /> : null}
      {tab === "batches" ? <BatchesPanel can={access} /> : null}
      {tab === "employees" ? <EmployeesPanel session={session} /> : null}
      {tab === "components" ? <ComponentsPanel session={session} /> : null}
      {tab === "variable" ? <VariablePayPanel session={session} /> : null}
      {tab === "overtime" ? <OvertimePanel session={session} /> : null}
      {tab === "payments" ? <PaymentsPanel session={session} /> : null}
      {tab === "statements" ? <StatementsPanel session={session} /> : null}
      {tab === "disputes" ? <DisputesPanel session={session} /> : null}
      {tab === "adjustments" ? <AdjustmentsPanel session={session} /> : null}
      {tab === "reports" ? <ReportsPanel session={session} /> : null}
    </div>
  );
}
