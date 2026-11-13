import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { HrAnalyticsWorkspace } from "@/components/hr-analytics/HrAnalyticsWorkspace";
import { getHrAnalyticsOverview, getTalentRisk } from "@/lib/api";

const EMPTY_OVERVIEW = {
  headcount: { current: 0, series: [] },
  attrition: { exits12m: 0, avgHeadcount: 0, ratePct: 0 },
  tenure: { avgMonths: 0, buckets: [] },
  distribution: { byDepartment: [], byTeam: [], byEmploymentType: [], byGender: [] },
  lifecycle: { onboarding: 0, probation: 0, confirmed: 0, exited: 0 },
  performance: { rated: 0, avgRating: null, distribution: [], byDepartment: [] },
  onboarding: { total: 0, completed: 0, inProgress: 0, completionPct: 0, avgDaysToComplete: null },
};
const EMPTY_RISK = { summary: { headcount: 0, atRiskDepartments: 0, burnoutEmployees: 0, burnoutPct: 0, trackedForActivity: 0 }, departments: [] };

export default async function HrAnalyticsPage() {
  const [overview, risk] = await Promise.all([
    getHrAnalyticsOverview().catch(() => EMPTY_OVERVIEW),
    getTalentRisk().catch(() => EMPTY_RISK),
  ]);

  return (
    <>
      <Topbar title="HR Analytics" subtitle="Workforce trends, performance & talent risk" />
      <PageBody>
        <HrAnalyticsWorkspace overview={overview} risk={risk} />
      </PageBody>
    </>
  );
}
