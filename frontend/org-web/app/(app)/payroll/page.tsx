import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card } from "@/components/ui/Card";
import { PayrollTabs } from "@/components/payroll/PayrollTabs";
import { getClients, getInvoices, getPayrollCycles, getPayrollDashboard, getPayrollReport, getPayrollSettings } from "@/lib/api";

export default async function PayrollPage() {
  // Everything here is payroll.read-gated; a role without it gets the empty
  // state rather than a crash. Clients ride project.read.
  const [dashboard, cycles, invoices, clients, report, settings] = await Promise.all([
    getPayrollDashboard().catch(() => null),
    getPayrollCycles().catch(() => null),
    getInvoices().catch(() => []),
    getClients().catch(() => []),
    getPayrollReport().catch(() => null),
    getPayrollSettings().catch(() => null),
  ]);

  return (
    <>
      <Topbar title="Payroll & Timesheets" subtitle="Pay cycles, client invoices & reports from approved hours" />
      <PageBody>
        {cycles ? (
          <PayrollTabs dashboard={dashboard} cycles={cycles} invoices={invoices} clients={clients} report={report} settings={settings} />
        ) : (
          <Card>
            <p className="px-5 py-12 text-center text-sm text-slate-500">You don&apos;t have access to payroll.</p>
          </Card>
        )}
      </PageBody>
    </>
  );
}
