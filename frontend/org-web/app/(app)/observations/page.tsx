import { redirect } from "next/navigation";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { ObservationsWorkspace } from "@/components/observations/ObservationsWorkspace";
import { getEmployees, getSession } from "@/lib/api";

export default async function ObservationsPage() {
  const session = await getSession().catch(() => null);
  const canView = Boolean(session && (session.role.permissions.includes("observation.read") || session.role.name === "Owner"));
  if (!canView) redirect("/");

  // Employee options for the "raise observation" picker (backend still scopes the
  // actual create to the caller's reach; this list is a convenience).
  const page = await getEmployees(1, 500).catch(() => null);
  const employees = (page?.items ?? []).map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`.trim() }));

  return (
    <>
      <Topbar title="Observations" subtitle="Track and resolve AI-detected and manually raised concerns" />
      <PageBody>
        <ObservationsWorkspace employees={employees} />
      </PageBody>
    </>
  );
}
