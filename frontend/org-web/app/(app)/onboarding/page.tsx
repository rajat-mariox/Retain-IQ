import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { OnboardingWorkspace } from "@/components/onboarding/OnboardingWorkspace";
import { getOnboardingOverview, getOnboardingTemplates } from "@/lib/api";

export default async function OnboardingPage() {
  const [overview, templates] = await Promise.all([
    getOnboardingOverview().catch(() => ({ rows: [], counts: { onboarding: 0, notStarted: 0, inProgress: 0, completed: 0 } })),
    getOnboardingTemplates().catch(() => []),
  ]);

  return (
    <>
      <Topbar title="Onboarding" subtitle="Checklists & new-hire journeys" />
      <PageBody>
        <OnboardingWorkspace overview={overview} templates={templates} />
      </PageBody>
    </>
  );
}
