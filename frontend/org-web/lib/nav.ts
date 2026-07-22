import {
  CalendarCheck,
  CalendarDays,
  CreditCard,
  FolderKanban,
  BarChart3,
  Bell,
  Gauge,
  Images,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  MonitorSmartphone,
  Settings,
  Sparkles,
  Timer,
  UserPlus,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  employeeOnly?: boolean; // hidden from anyone who can manage projects (Owner/Manager)
  flag?: string; // hidden when this platform feature flag is off
}

/** A collapsible section of related links. Visibility rules match NavItem. */
export interface NavGroup {
  label: string;
  icon: LucideIcon;
  children: NavItem[];
  adminOnly?: boolean;
  flag?: string;
}

export type NavEntry = NavItem | NavGroup;

export function isNavGroup(entry: NavEntry): entry is NavGroup {
  return "children" in entry;
}

export const NAV_ITEMS: NavEntry[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "My Time", href: "/time", icon: Timer, flag: "timeTracking" },
  { label: "Attendance", href: "/attendance", icon: CalendarCheck, flag: "attendance" },
  { label: "Leave", href: "/leave", icon: CalendarDays, flag: "attendance" },
  { label: "Projects & Teams", href: "/projects", icon: FolderKanban, flag: "projects" },
  { label: "My Tasks", href: "/tasks", icon: ListTodo, flag: "projects", employeeOnly: true },
  { label: "Notifications", href: "/notifications", icon: Bell },
  { label: "Screenshots", href: "/screenshots", icon: Images, flag: "screenshots" },
  {
    label: "Human Resources",
    icon: UsersRound,
    adminOnly: true,
    children: [
      { label: "Employees", href: "/employees", icon: Users },
      { label: "Recruitment", href: "/recruitment", icon: UserPlus },
      { label: "Onboarding", href: "/onboarding", icon: ListChecks },
      { label: "Performance", href: "/performance", icon: Gauge },
      { label: "HR Analytics", href: "/hr-analytics", icon: BarChart3 },
    ],
  },
  { label: "Monitoring", href: "/monitoring", icon: MonitorSmartphone, adminOnly: true },
  { label: "AI Insights", href: "/insights", icon: Sparkles, adminOnly: true, flag: "aiInsights" },
  // Payroll is computed from tracked hours, so it rides the timeTracking flag.
  { label: "Payroll", href: "/payroll", icon: Wallet, adminOnly: true, flag: "timeTracking" },
  { label: "Billing", href: "/billing", icon: CreditCard, adminOnly: true, flag: "billing" },
  { label: "Settings", href: "/settings", icon: Settings, adminOnly: true },
];
