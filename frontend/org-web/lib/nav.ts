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
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "My Time", href: "/time", icon: Timer },
  { label: "Attendance", href: "/attendance", icon: CalendarCheck },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Notifications", href: "/notifications", icon: Bell },
  { label: "Screenshots", href: "/screenshots", icon: Images },
  { label: "Employees", href: "/employees", icon: Users, adminOnly: true },
  { label: "AI Insights", href: "/insights", icon: Sparkles, adminOnly: true },
  { label: "Billing", href: "/billing", icon: CreditCard, adminOnly: true },
  { label: "Settings", href: "/settings", icon: Settings, adminOnly: true },
];
