import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { NotificationSettings } from "@/components/notifications/NotificationSettings";
import { getNotificationPreferences } from "@/lib/api";

const FALLBACK = {
  preferences: [
    { category: "ATTENDANCE", inApp: true, email: true, push: false },
    { category: "PRODUCTIVITY", inApp: true, email: false, push: false },
    { category: "PROJECT", inApp: true, email: false, push: false },
    { category: "AI", inApp: true, email: false, push: false },
    { category: "SYSTEM", inApp: true, email: true, push: false },
  ],
  settings: { quietHoursEnabled: false, quietStart: 22, quietEnd: 8, timezone: "UTC", digest: "OFF", digestHour: 9 },
};

export default async function NotificationSettingsPage() {
  const data = await getNotificationPreferences().catch(() => FALLBACK);

  return (
    <>
      <Topbar title="Notification settings" subtitle="Choose what you're notified about and how" />
      <PageBody>
        <Link href="/notifications" className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800">
          <ChevronLeft className="size-3.5" /> Back to notifications
        </Link>
        <NotificationSettings initial={data} />
      </PageBody>
    </>
  );
}
