import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { RecruitmentWorkspace } from "@/components/recruitment/RecruitmentWorkspace";
import { getCandidates, getDepartments, getDesignations, getRecRequisitions, getRecruitmentPipeline, getTeams } from "@/lib/api";

export default async function RecruitmentPage() {
  const [pipeline, requisitions, candidates, departments, designations, teams] = await Promise.all([
    getRecruitmentPipeline().catch(() => ({ stages: ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED", "REJECTED"], byStage: {}, total: 0 })),
    getRecRequisitions().catch(() => []),
    getCandidates().catch(() => []),
    getDepartments().catch(() => []),
    getDesignations().catch(() => []),
    getTeams().catch(() => []),
  ]);

  return (
    <>
      <Topbar title="Recruitment" subtitle="Requisitions, candidates & hiring pipeline" />
      <PageBody>
        <RecruitmentWorkspace
          pipeline={pipeline}
          requisitions={requisitions}
          candidates={candidates}
          departments={departments}
          designations={designations}
          teams={teams}
        />
      </PageBody>
    </>
  );
}
