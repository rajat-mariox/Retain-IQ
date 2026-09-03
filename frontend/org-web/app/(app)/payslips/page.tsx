import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { MyPayslips } from "@/components/payroll/MyPayslips";

/**
 * Employee self-service payslips. Lists the signed-in employee's own published
 * payslips (from /api/me/payroll/statements) with a download link to each PDF.
 */
export default async function PayslipsPage() {
  return (
    <>
      <Topbar title="Payslips" subtitle="Your monthly payslips" />
      <PageBody>
        <MyPayslips />
      </PageBody>
    </>
  );
}
