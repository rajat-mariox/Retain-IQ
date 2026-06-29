import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card } from "@/components/ui/Card";
import { PageNav } from "@/components/ui/PageNav";
import { ScreenshotThumb } from "@/components/screenshots/ScreenshotThumb";
import { DeleteScreenshotButton } from "@/components/screenshots/DeleteScreenshotButton";
import { getScreenshots, getSession } from "@/lib/api";
import { formatBytes } from "@/lib/format";

const PAGE_SIZE = 24;

function clock(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
}

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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {data.items.map((shot) => (
                <div key={shot.id} className="group relative overflow-hidden rounded-xl border border-hairline bg-panel">
                  <div className="aspect-video w-full bg-panel-2">
                    <ScreenshotThumb src={shot.viewUrl} alt={`Screenshot ${clock(shot.capturedAt)}`} />
                  </div>
                  {canDelete ? <DeleteScreenshotButton id={shot.id} /> : null}
                  <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] text-slate-500">
                    <span className="truncate">{clock(shot.capturedAt)}</span>
                    <span className="shrink-0 tabular-nums">{formatBytes(shot.sizeBytes)}</span>
                  </div>
                </div>
              ))}
            </div>

            <Card>
              <PageNav page={data.page} pageSize={data.pageSize} total={data.total} basePath={`/screenshots/${employeeId}`} />
            </Card>
          </>
        )}
      </PageBody>
    </>
  );
}
