import { Activity, Bell, Building2, CreditCard, DollarSign, HeartHandshake, HeartPulse, LayoutDashboard, Settings, type LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  flag?: string; // hidden when this feature flag is off
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Organizations", href: "/organizations", icon: Building2 },
  { label: "Usage & Analytics", href: "/usage", icon: Activity },
  { label: "Customer Success", href: "/customer-success", icon: HeartHandshake, flag: "customerSuccess" },
  { label: "Subscriptions", href: "/subscriptions", icon: CreditCard },
  { label: "Revenue", href: "/revenue", icon: DollarSign },
  { label: "Platform Health", href: "/health", icon: HeartPulse, flag: "platformHealth" },
  { label: "Activity", href: "/activity", icon: Bell, flag: "activityFeed" },
  { label: "SaaS Configuration", href: "/settings", icon: Settings },
];
