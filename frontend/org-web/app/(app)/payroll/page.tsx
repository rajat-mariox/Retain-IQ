import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card } from "@/components/ui/Card";
import { PayoutWorkspace } from "@/components/payroll/PayoutWorkspace";
import { canViewPayroll } from "@/components/payroll/access";
import { apiFetch, getSession, type PayoutDashboard } from "@/lib/api";

/**
 * Payroll & Payout workspace (spec §2) — replaces the legacy /payroll page.
 * The server page resolves the session and preloads the §6 dashboard; the client
 * workspace renders the permission-aware tab bar and each panel. Every payroll
 * surface is permission-gated: a role without any payroll read grant gets the
 * empty state, not a crash.
 */
export default async function PayrollPage() {
  const [session, dashboard] = await Promise.all([
    getSession().catch(() => null),
    // §6 dashboard is payroll.dashboard.read-gated; a role without it (or an org
    // without the payroll feature) simply preloads null and the panel shows empty.
    apiFetch<PayoutDashboard>("payroll/dashboard").catch(() => null),
  ]);

  const canView = Boolean(session) && canViewPayroll(session?.role.permissions ?? []);

  return (
    <>
      <Topbar title="Payroll & Payout" subtitle="Run payroll, approve batches and pay employees" />
      <PageBody>
        {canView && session ? (
          <PayoutWorkspace session={session} dashboard={dashboard} />
        ) : (
          <Card>
            <p className="px-5 py-12 text-center text-sm text-slate-500">You don&apos;t have access to payroll.</p>
          </Card>
        )}
      </PageBody>
    </>
  );
}
