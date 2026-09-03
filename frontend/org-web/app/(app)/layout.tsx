import { redirect } from "next/navigation";
import { AlertTriangle, Megaphone, Wrench } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { MobileNavProvider } from "@/components/layout/MobileNav";
import { NotificationsProvider } from "@/components/notifications/NotificationsProvider";
import { getSession } from "@/lib/api";
import { getPublicConfig } from "@/lib/config";

const NOTIF_TONE = {
  info: "bg-sky-50 text-sky-800 ring-sky-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  critical: "bg-rose-50 text-rose-800 ring-rose-200",
} as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [session, config] = await Promise.all([getSession().catch(() => null), getPublicConfig()]);

  // Platform-wide maintenance: the tenant app is unavailable until it's turned off.
  if (config.maintenance.enabled) {
    return (
      <div className="grid min-h-screen place-items-center bg-canvas px-6">
        <div className="max-w-md text-center">
          <span className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-200">
            <Wrench className="size-7" />
          </span>
          <h1 className="text-xl font-semibold text-slate-900">{config.branding.platformName} is under maintenance</h1>
          <p className="mt-2 text-sm text-slate-600">
            {config.maintenance.message || "We're performing scheduled maintenance. Please check back shortly."}
          </p>
        </div>
      </div>
    );
  }

  // Force the first-login password change before anything else.
  if (session?.user.mustChangePassword) {
    redirect("/change-password");
  }

  const isAdmin = Boolean(
    session && (session.role.permissions.includes("employee.read") || session.role.name === "Owner"),
  );
  // The Owner isn't payroll staff, so self-service items like Payslips are hidden for them.
  const isOwner = session?.role.name === "Owner";
  const notification = config.notification;

  return (
    <NotificationsProvider>
      <MobileNavProvider>
      <div className="min-h-screen">
        <Sidebar
          orgName={session?.org.name ?? "Organization"}
          isAdmin={isAdmin}
          isOwner={isOwner}
          permissions={session?.role.permissions ?? []}
          platformName={config.branding.platformName}
          // Org-resolved flags (global ∩ this org's override), not the public
          // global set — /v1/config can't know which tenant is asking.
          featureFlags={session?.featureFlags ?? config.featureFlags}
          logoUrl={config.branding.logoUrl || undefined}
        />
        <div className="lg:pl-64">
          {notification.enabled && notification.message ? (
            <div className={`flex items-center gap-2.5 border-b px-5 py-2.5 text-sm font-medium ring-1 ring-inset lg:px-8 ${NOTIF_TONE[notification.level] ?? NOTIF_TONE.info}`}>
              {notification.level === "critical" ? <AlertTriangle className="size-4 shrink-0" /> : <Megaphone className="size-4 shrink-0" />}
              <span>{notification.message}</span>
            </div>
          ) : null}
          {children}
        </div>
      </div>
      </MobileNavProvider>
    </NotificationsProvider>
  );
}
