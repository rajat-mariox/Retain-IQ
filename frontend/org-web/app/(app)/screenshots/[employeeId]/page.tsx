import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card } from "@/components/ui/Card";
import { PageNav } from "@/components/ui/PageNav";
import { ScreenshotGrid } from "@/components/screenshots/ScreenshotGrid";
import { getScreenshots, getSession } from "@/lib/api";

const PAGE_SIZE = 24;

export default async function EmployeeScreenshotsPage({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { employeeId } = await params;
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const [data, session] = await Promise.all([
    getScreenshots(employeeId, page, PAGE_SIZE).catch(() => ({ items: [], total: 0, page, pageSize: PAGE_SIZE })),
    getSession().catch(() => null),
  ]);
  const canDelete = Boolean(session?.role.permissions.includes("screenshots.delete"));
  const employeeName = data.items[0]?.employeeName ?? "Employee";

  return (
    <>
      <Topbar title={employeeName} subtitle="Screenshots" />
      <PageBody>
        <div>
          <Link href="/screenshots" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-4" />
            All employees
          </Link>
        </div>

        {data.items.length === 0 ? (
          <Card>
            <p className="px-5 py-12 text-center text-sm text-slate-500">No screenshots for this employee.</p>
          </Card>
        ) : (
          <>
            <ScreenshotGrid shots={data.items} showDelete={canDelete} />

            <Card>
              <PageNav page={data.page} pageSize={data.pageSize} total={data.total} basePath={`/screenshots/${employeeId}`} />
            </Card>
          </>
        )}
      </PageBody>
    </>
  );
}
