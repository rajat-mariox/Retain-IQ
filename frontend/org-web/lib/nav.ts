import {
  CalendarCheck,
  CreditCard,
  FolderKanban,
  Bell,
  Images,
  LayoutDashboard,
  Settings,
  Sparkles,
  Timer,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  flag?: string; // hidden when this platform feature flag is off
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "My Time", href: "/time", icon: Timer, flag: "timeTracking" },
  { label: "Attendance", href: "/attendance", icon: CalendarCheck, flag: "attendance" },
  { label: "Projects", href: "/projects", icon: FolderKanban, flag: "projects" },
  { label: "Notifications", href: "/notifications", icon: Bell },
  { label: "Screenshots", href: "/screenshots", icon: Images, flag: "screenshots" },
  { label: "Employees", href: "/employees", icon: Users, adminOnly: true },
  { label: "AI Insights", href: "/insights", icon: Sparkles, adminOnly: true, flag: "aiInsights" },
  { label: "Billing", href: "/billing", icon: CreditCard, adminOnly: true, flag: "billing" },
  { label: "Settings", href: "/settings", icon: Settings, adminOnly: true },
];
