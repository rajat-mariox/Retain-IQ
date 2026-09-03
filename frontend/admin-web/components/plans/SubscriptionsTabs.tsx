"use client";

import { useState, type ReactNode } from "react";
import { PlanManager } from "@/components/plans/PlanManager";
import { ChangeRequestsQueue } from "@/components/plans/ChangeRequestsQueue";
import type { AdminPlan } from "@/lib/plans-api";
import type { ApiChangeRequest } from "@/lib/admin-api";
import { cn } from "@/lib/cn";

/** Subscriptions screen: "Overview" (distribution) + "Plans" (catalog) + "Change requests" (approval queue). */
export function SubscriptionsTabs({ overview, plans, changeRequests }: { overview: ReactNode; plans: AdminPlan[]; changeRequests: ApiChangeRequest[] }) {
  const [tab, setTab] = useState<"overview" | "plans" | "requests">("overview");
  const pending = changeRequests.length;
  return (
    <div className="space-y-6">
      <div className="flex gap-6 border-b border-hairline">
        <TabBtn active={tab === "overview"} onClick={() => setTab("overview")}>Overview</TabBtn>
        <TabBtn active={tab === "plans"} onClick={() => setTab("plans")}>Plans</TabBtn>
        <TabBtn active={tab === "requests"} onClick={() => setTab("requests")}>
          Change requests
          {pending > 0 ? <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">{pending}</span> : null}
        </TabBtn>
      </div>
      {tab === "overview" ? overview : tab === "plans" ? <PlanManager plans={plans} /> : <ChangeRequestsQueue requests={changeRequests} />}
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
