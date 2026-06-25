import { Activity, Building2, CreditCard, DollarSign, LayoutDashboard, type LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Organizations", href: "/organizations", icon: Building2 },
  { label: "Usage & Analytics", href: "/usage", icon: Activity },
  { label: "Subscriptions", href: "/subscriptions", icon: CreditCard },
  { label: "Revenue", href: "/revenue", icon: DollarSign },
];
