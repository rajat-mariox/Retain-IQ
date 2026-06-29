import { AlertTriangle, Megaphone, Wrench } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { MobileNavProvider } from "@/components/layout/MobileNav";
import { getSettings, type ApiPlatformSettings } from "@/lib/admin-api";

const NOTIF_TONE = {
  info: "bg-sky-50 text-sky-800 ring-sky-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  critical: "bg-rose-50 text-rose-800 ring-rose-200",
} as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Global settings drive branding, banners and feature-flagged nav. Never let a
  // settings outage break the whole app — fall back to no banners / defaults.
  const settings = await getSettings().catch((): ApiPlatformSettings | null => null);
  const branding = settings?.branding;
  const notification = settings?.notification;
  const maintenance = settings?.maintenance;

  return (
    <MobileNavProvider>
      <div className="min-h-screen">
        <Sidebar platformName={branding?.platformName} featureFlags={settings?.featureFlags} />
        <div className="lg:pl-64">
          {maintenance?.enabled ? (
            <div className="flex items-center gap-2.5 border-b border-amber-200 bg-amber-100 px-5 py-2.5 text-sm font-medium text-amber-900 lg:px-8">
              <Wrench className="size-4 shrink-0" />
              <span>{maintenance.message || "The platform is in maintenance mode."}</span>
            </div>
          ) : null}
          {notification?.enabled && notification.message ? (
            <div className={`flex items-center gap-2.5 border-b px-5 py-2.5 text-sm font-medium ring-1 ring-inset lg:px-8 ${NOTIF_TONE[notification.level] ?? NOTIF_TONE.info}`}>
              {notification.level === "critical" ? <AlertTriangle className="size-4 shrink-0" /> : <Megaphone className="size-4 shrink-0" />}
              <span>{notification.message}</span>
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </MobileNavProvider>
  );
}
