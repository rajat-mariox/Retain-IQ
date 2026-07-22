"use client";

import { useState } from "react";
import { GitBranch, Users, type LucideIcon } from "lucide-react";
import type { EmployeePage, LifecycleSummary, OrgChartNode, OrgDepartment, OrgDesignation, OrgRole, OrgShift, OrgTeam } from "@/lib/api";
import { AllEmployeesView } from "./AllEmployeesView";
import { DesignationsView } from "./DesignationsView";
import { ShiftsView } from "./ShiftsView";
import { StructureView } from "./StructureView";
import { LifecycleView } from "./LifecycleView";
import { OrgChartView } from "./OrgChartView";

type DirKey = "all" | "orgchart" | "departments" | "teams" | "designations" | "shifts";
type LifeKey = "ONBOARDING" | "PROBATION" | "CONFIRMED" | "EXITED";

const DIRECTORY: { key: DirKey; label: string }[] = [
  { key: "all", label: "All Employees" },
  { key: "orgchart", label: "Org Chart" },
  { key: "departments", label: "Departments" },
  { key: "teams", label: "Teams" },
  { key: "designations", label: "Designations" },
  { key: "shifts", label: "Shifts" },
];
const LIFECYCLE: { key: LifeKey; label: string }[] = [
  { key: "ONBOARDING", label: "Onboarding" },
  { key: "PROBATION", label: "Probation" },
  { key: "CONFIRMED", label: "Confirmation" },
  { key: "EXITED", label: "Exit" },
];

export function EmployeeManagement({
  initialEmployees,
  departments,
  teams,
  designations,
  shifts,
  roles,
  lifecycle,
  orgChart,
}: {
  initialEmployees: EmployeePage;
  departments: OrgDepartment[];
  teams: OrgTeam[];
  designations: OrgDesignation[];
  shifts: OrgShift[];
  roles: OrgRole[];
  lifecycle: LifecycleSummary;
  orgChart: { roots: OrgChartNode[]; total: number };
}) {
  const [group, setGroup] = useState<"directory" | "lifecycle">("directory");
  const [dirTab, setDirTab] = useState<DirKey>("all");
  const [lifeTab, setLifeTab] = useState<LifeKey>("ONBOARDING");

  const stageCount = (k: LifeKey) =>
    k === "ONBOARDING" ? lifecycle.onboarding : k === "PROBATION" ? lifecycle.probation : k === "CONFIRMED" ? lifecycle.confirmed : lifecycle.exited;

  return (
    <div className="space-y-5">
      {/* Level 1 — section picker */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SectionCard
          active={group === "directory"}
          onClick={() => setGroup("directory")}
          icon={Users}
          title="Directory"
          desc="People, departments, teams & designations"
        />
        <SectionCard
          active={group === "lifecycle"}
          onClick={() => setGroup("lifecycle")}
          icon={GitBranch}
          title="Lifecycle"
          desc="Onboarding → probation → confirmation → exit"
        />
      </div>

      {/* Level 2 — sub-tabs for the active section */}
      <div className="flex flex-wrap gap-x-1 gap-y-2 border-b border-hairline">
        {group === "directory"
          ? DIRECTORY.map((t) => <SubTab key={t.key} active={dirTab === t.key} onClick={() => setDirTab(t.key)} label={t.label} />)
          : LIFECYCLE.map((t) => <SubTab key={t.key} active={lifeTab === t.key} onClick={() => setLifeTab(t.key)} label={t.label} count={stageCount(t.key)} />)}
      </div>

      {/* Content */}
      {group === "directory" ? (
        <>
          {dirTab === "all" ? <AllEmployeesView initial={initialEmployees} departments={departments} teams={teams} designations={designations} shifts={shifts} roles={roles} /> : null}
          {dirTab === "orgchart" ? <OrgChartView roots={orgChart.roots} total={orgChart.total} /> : null}
          {dirTab === "departments" ? <StructureView kind="departments" departments={departments} teams={teams} /> : null}
          {dirTab === "teams" ? <StructureView kind="teams" departments={departments} teams={teams} /> : null}
          {dirTab === "designations" ? <DesignationsView designations={designations} departments={departments} /> : null}
          {dirTab === "shifts" ? <ShiftsView shifts={shifts} /> : null}
        </>
      ) : (
        // key={lifeTab} forces a fresh mount per stage so the previous stage's rows never flash.
        <LifecycleView key={lifeTab} stage={lifeTab} />
      )}
    </div>
  );
}

function SectionCard({ active, onClick, icon: Icon, title, desc }: { active: boolean; onClick: () => void; icon: LucideIcon; title: string; desc: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${active ? "border-brand bg-brand/5 ring-1 ring-brand/30" : "border-hairline bg-panel hover:bg-panel-2"}`}
    >
      <span className={`grid size-10 shrink-0 place-items-center rounded-lg ${active ? "bg-brand text-white" : "bg-panel-2 text-slate-500 ring-1 ring-inset ring-hairline"}`}>
        <Icon className="size-5" />
      </span>
      <span className="min-w-0">
        <span className={`block text-sm font-semibold ${active ? "text-slate-900" : "text-slate-700"}`}>{title}</span>
        <span className="block truncate text-xs text-slate-500">{desc}</span>
      </span>
    </button>
  );
}

function SubTab({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count?: number }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${active ? "border-brand text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}
    >
      {label}
      {typeof count === "number" ? (
        <span className={`rounded-full px-1.5 text-xs tabular-nums ${active ? "bg-brand/10 text-brand" : "bg-slate-200/70 text-slate-600"}`}>{count}</span>
      ) : null}
    </button>
  );
}
