"use client";

import { useState, type ReactNode } from "react";
import { PlanManager } from "@/components/plans/PlanManager";
import type { AdminPlan } from "@/lib/plans-api";
import { cn } from "@/lib/cn";

/** Subscriptions screen: "Overview" (distribution/analytics) + "Plans" (catalog management). */
export function SubscriptionsTabs({ overview, plans }: { overview: ReactNode; plans: AdminPlan[] }) {
  const [tab, setTab] = useState<"overview" | "plans">("overview");
  return (
    <div className="space-y-6">
      <div className="flex gap-6 border-b border-hairline">
        <TabBtn active={tab === "overview"} onClick={() => setTab("overview")}>Overview</TabBtn>
        <TabBtn active={tab === "plans"} onClick={() => setTab("plans")}>Plans</TabBtn>
      </div>
      {tab === "overview" ? overview : <PlanManager plans={plans} />}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mb-px border-b-2 px-1 pb-3 text-sm font-medium transition-colors",
        active ? "border-brand text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800",
      )}
    >
      {children}
    </button>
  );
}
