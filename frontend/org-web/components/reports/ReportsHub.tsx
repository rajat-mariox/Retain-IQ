import Link from "next/link";
import { CalendarCheck, CalendarDays, Wallet, Activity, FolderKanban, ShieldAlert, ArrowRight, Sparkles, type LucideIcon } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";

interface HubItem {
  title: string;
  desc: string;
  href: string;
  icon: LucideIcon;
  tint: string;
  flag?: string;
  permission?: string;
  /** What the surface actually offers (e.g. "CSV · Excel", "Dashboard"). */
  badge?: string;
}

// The report surfaces that live around the app — this hub is the single place to
// find them. Each is gated by its feature flag and (optionally) a permission.
const ITEMS: HubItem[] = [
  { title: "Attendance reports", desc: "Daily, monthly & department views, plus a configurable scope/period report. Custom date range, CSV & Excel export, scheduled email.", href: "/attendance", icon: CalendarCheck, tint: "text-emerald-600 bg-emerald-50", flag: "attendance", permission: "attendance.read", badge: "CSV · Excel · Scheduled" },
  { title: "Leave reports", desc: "The org leave calendar, approval analytics by type, and an exportable list of all leave requests.", href: "/leave", icon: CalendarDays, tint: "text-sky-600 bg-sky-50", flag: "leave", permission: "attendance.read", badge: "CSV · Excel" },
  { title: "Payroll & billing", desc: "Per-employee pay, overtime and history; client-billable hours and invoices — over any date range.", href: "/payroll", icon: Wallet, tint: "text-violet-600 bg-violet-50", flag: "payroll", permission: "payroll.read", badge: "CSV · Excel" },
  { title: "Productivity & insights", desc: "Workforce health, per-employee and team productivity, focus and activity — a live dashboard.", href: "/insights", icon: Sparkles, tint: "text-amber-600 bg-amber-50", flag: "aiInsights", permission: "ai_risk.read", badge: "Dashboard" },
  { title: "Monitoring", desc: "App & website usage, work sessions, idle time and the activity timeline — a live monitoring view.", href: "/monitoring", icon: Activity, tint: "text-teal-600 bg-teal-50", flag: "monitoring", permission: "ai_risk.read", badge: "Dashboard" },
  { title: "Observations & incidents", desc: "Open cases across the observation → escalation → incident workflow, by person, team and department.", href: "/observations", icon: ShieldAlert, tint: "text-rose-600 bg-rose-50", permission: "observation.read", badge: "Live queue" },
  { title: "Project & task reports", desc: "Project progress, task throughput and team delivery, with CSV & Excel export — see below.", href: "#project-reports", icon: FolderKanban, tint: "text-indigo-600 bg-indigo-50", flag: "projects", badge: "CSV · Excel" },
];

/**
 * Central reports hub — one landing that surfaces every report area the caller
 * can reach. Each card is hidden when its feature flag is off or the caller
 * lacks the permission, so people only see the reports they can actually open.
 */
export function ReportsHub({ featureFlags, permissions, roleName }: { featureFlags: Record<string, boolean>; permissions: string[]; roleName?: string }) {
  const isOwner = roleName === "Owner";
  const canSee = (it: HubItem) =>
    (!it.flag || featureFlags[it.flag] !== false) &&
    (!it.permission || isOwner || permissions.includes(it.permission));

  const items = ITEMS.filter(canSee);

  return (
    <Card>
      <CardHeader title="Reports hub" subtitle="Everything you can report on, in one place" />
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => {
          const Icon = it.icon;
          const isAnchor = it.href.startsWith("#");
          const body = (
            <div className="group flex h-full flex-col rounded-xl border border-hairline bg-panel p-4 transition-colors hover:border-brand/40 hover:bg-slate-50">
              <div className="mb-2 flex items-center gap-2">
                <span className={`grid size-8 place-items-center rounded-lg ${it.tint}`}><Icon className="size-4" /></span>
                <span className="text-sm font-semibold text-slate-900">{it.title}</span>
              </div>
              <p className="flex-1 text-xs text-slate-500">{it.desc}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="inline-flex items-center gap-1 text-xs font-medium text-brand">
                  {isAnchor ? "View below" : "Open"} <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
                {it.badge ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">{it.badge}</span> : null}
              </div>
            </div>
          );
          return isAnchor ? <a key={it.title} href={it.href}>{body}</a> : <Link key={it.title} href={it.href}>{body}</Link>;
        })}
        {items.length === 0 ? <p className="col-span-full px-2 py-8 text-center text-sm text-slate-500">No report areas are available for your access level.</p> : null}
      </div>
    </Card>
  );
}
