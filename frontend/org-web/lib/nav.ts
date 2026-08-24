import {
  Activity,
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
  ShieldAlert,
  Siren,
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
  permission?: string; // hidden unless the member holds this permission
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
  { label: "Leave", href: "/leave", icon: CalendarDays, flag: "leave" },
  { label: "Projects & Teams", href: "/projects", icon: FolderKanban, flag: "projects" },
  { label: "My Tasks", href: "/tasks", icon: ListTodo, flag: "projects", employeeOnly: true },
  { label: "Notifications", href: "/notifications", icon: Bell },
  { label: "Activity", href: "/activity", icon: Activity, flag: "activityFeed", permission: "audit.read" },
  { label: "Screenshots", href: "/screenshots", icon: Images, flag: "screenshots" },
  { label: "Reports", href: "/reports", icon: BarChart3, adminOnly: true },
  {
    label: "Human Resources",
    icon: UsersRound,
    adminOnly: true,
    children: [
      // Employees is core HR — always available. The rest (hiring, onboarding,
      // performance, analytics) are the premium HR suite, gated by one flag.
      { label: "Employees", href: "/employees", icon: Users },
      { label: "Recruitment", href: "/recruitment", icon: UserPlus, flag: "recruitment" },
      { label: "Onboarding", href: "/onboarding", icon: ListChecks, flag: "recruitment" },
      { label: "Performance", href: "/performance", icon: Gauge, flag: "recruitment" },
      { label: "HR Analytics", href: "/hr-analytics", icon: BarChart3, flag: "recruitment" },
      { label: "Alumni", href: "/alumni", icon: UserPlus, adminOnly: true, permission: "employee.read" },
    ],
  },
  { label: "Monitoring", href: "/monitoring", icon: MonitorSmartphone, adminOnly: true, flag: "monitoring" },
  { label: "Observations", href: "/observations", icon: ShieldAlert, adminOnly: true, permission: "observation.read" },
  { label: "Incidents", href: "/incidents", icon: Siren, adminOnly: true, permission: "incident.manage" },
  { label: "AI Insights", href: "/insights", icon: Sparkles, adminOnly: true, flag: "aiInsights" },
  { label: "Payroll", href: "/payroll", icon: Wallet, adminOnly: true, flag: "payroll" },
  { label: "Billing", href: "/billing", icon: CreditCard, adminOnly: true, flag: "billing" },
  { label: "Settings", href: "/settings", icon: Settings, adminOnly: true },
];
