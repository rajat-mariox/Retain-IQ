import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { getSettings } from "@/lib/admin-api";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getSettings();
  return (
    <>
      <Topbar title="SaaS Configuration" subtitle="Global platform settings · branding, notifications, feature flags & maintenance" />
      <PageBody>
        <SettingsForm initial={settings} />
      </PageBody>
    </>
  );
}
