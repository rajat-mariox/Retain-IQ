"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, FolderKanban, Gauge, LayoutDashboard, Settings, Target, Building2, Users } from "lucide-react";

// Everyone sees Overview / Projects / Goals / Reports (scoped to their own work).
// Teams & Departments are for anyone who can manage projects (Owner + Manager).
// The Manager tab is Manager-only; the Admin tab is Owner-only.
const BASE_TABS = [
  { href: "/projects", label: "Overview", icon: LayoutDashboard },
  { href: "/projects/all", label: "Projects", icon: FolderKanban },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/reports", label: "Reports", icon: BarChart3 },
];
const STRUCTURE_TABS = [
  { href: "/teams", label: "Teams", icon: Users },
  { href: "/departments", label: "Departments", icon: Building2 },
];
const MANAGER_TAB = { href: "/manager", label: "Manager", icon: Gauge };
const ADMIN_TAB = { href: "/project-admin", label: "Admin", icon: Settings };

export function ProjectsTabs({ canManage = false, roleName }: { canManage?: boolean; roleName?: string }) {
  const pathname = usePathname();
  // Keep Teams/Departments in their natural spot (after Projects) for managers.
  // Manager tab → Manager role only; Admin tab → Owner role only.
  const roleTabs = [
    ...(roleName === "Manager" ? [MANAGER_TAB] : []),
    ...(roleName === "Owner" ? [ADMIN_TAB] : []),
  ];
  const tabs = canManage
    ? [BASE_TABS[0], BASE_TABS[1], ...STRUCTURE_TABS, BASE_TABS[2], BASE_TABS[3], ...roleTabs]
    : BASE_TABS;
  return (
    <div className="flex flex-wrap gap-1 rounded-xl border border-hairline bg-panel-2 p-1">
      {tabs.map((t) => {
        // "Projects" owns every /projects/* route (list + detail); "Overview" is only the exact /projects.
        const active =
          t.href === "/projects"
            ? pathname === "/projects"
            : t.href === "/projects/all"
              ? pathname === "/projects/all" || (pathname.startsWith("/projects/") && pathname !== "/projects")
              : pathname === t.href;
        const Icon = t.icon;
        return (
          <Link key={t.href} href={t.href} className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${active ? "bg-panel text-slate-900 shadow-sm ring-1 ring-hairline" : "text-slate-500 hover:text-slate-800"}`}>
            <Icon className="size-4" /> {t.label}
          </Link>
        );
      })}
    </div>
  );
}
