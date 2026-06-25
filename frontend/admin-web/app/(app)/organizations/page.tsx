import { Building2, CircleCheck, CircleDashed, CirclePause } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { OrgsTable } from "@/components/orgs/OrgsTable";
import { AddOrgForm } from "@/components/orgs/AddOrgForm";
import { getKpiSummary, getOrganizations } from "@/lib/data/orgs";
import { getPlanDistribution } from "@/lib/data/billing";
import { formatCompact } from "@/lib/format";

export default async function OrganizationsPage() {
  const [kpi, orgs, plans] = await Promise.all([getKpiSummary(), getOrganizations(), getPlanDistribution()]);

  return (
    <>
      <Topbar title="Organizations" subtitle="Every tenant on the platform" />
      <PageBody>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Total organizations" value={formatCompact(kpi.totalOrgs)} icon={Building2} accent="#1f883d" />
          <StatTile label="Active" value={formatCompact(kpi.activeOrgs)} icon={CircleCheck} accent="#16a34a" />
          <StatTile label="Total employees" value={formatCompact(kpi.totalEmployees)} icon={CircleDashed} accent="#0d9488" />
          <StatTile label="Suspended" value={formatCompact(kpi.suspendedOrgs)} icon={CirclePause} accent="#fbbf24" />
        </div>

        <AddOrgForm plans={plans.map((p) => ({ id: p.plan, name: p.name }))} />

        <Card>
          <OrgsTable organizations={orgs} now={Date.now()} />
        </Card>
      </PageBody>
    </>
  );
}
