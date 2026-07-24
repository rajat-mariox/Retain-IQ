import Link from "next/link";
import { ChevronRight, HardDrive, Images } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card, CardBody } from "@/components/ui/Card";
import { PageNav } from "@/components/ui/PageNav";
import { LocalTime } from "@/components/ui/LocalTime";
import { ScreenshotThumb } from "@/components/screenshots/ScreenshotThumb";
import { getMyScreenshots, getScreenshotEmployees, getSession, getStorageUsage } from "@/lib/api";
import { formatBytes, formatCompact, timeAgo } from "@/lib/format";

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

const PAGE_SIZE = 24;

export default async function ScreenshotsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const session = await getSession().catch(() => null);
  // Managers/admins (screenshots.read) get the org gallery grouped by employee;
  // everyone else sees only their OWN screenshots (self-view, no permission).
  const canSeeGallery = Boolean(session?.role.permissions.includes("screenshots.read"));

  if (!canSeeGallery) {
    const page = Math.max(1, Number((await searchParams).page) || 1);
    const mine = await getMyScreenshots(page, PAGE_SIZE).catch(() => ({ items: [], total: 0, page, pageSize: PAGE_SIZE }));
    return (
      <>
        <Topbar title="Screenshots" subtitle="Your own captured activity" />
        <PageBody>
          {mine.items.length === 0 ? (
            <Card>
              <p className="px-5 py-12 text-center text-sm text-slate-500">No screenshots of your activity yet.</p>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {mine.items.map((shot) => (
                  <div key={shot.id} className="group relative overflow-hidden rounded-xl border border-hairline bg-panel">
                    <div className="aspect-video w-full bg-panel-2">
                      <ScreenshotThumb src={shot.viewUrl} alt={`Screenshot from ${shot.capturedAt.slice(0, 10)}`} />
                    </div>
                    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] text-slate-500">
                      <span className="truncate"><LocalTime iso={shot.capturedAt} mode="datetime" /></span>
                      <span className="shrink-0 tabular-nums">{formatBytes(shot.sizeBytes)}</span>
                    </div>
                  </div>
                ))}
              </div>

              <Card>
                <PageNav page={mine.page} pageSize={mine.pageSize} total={mine.total} basePath="/screenshots" />
              </Card>
            </>
          )}
        </PageBody>
      </>
    );
  }

  const [groups, usage] = await Promise.all([
    getScreenshotEmployees().catch(() => ({ items: [] })),
    getStorageUsage().catch(() => null),
  ]);
  const now = Date.now();
  const employees = groups.items;
  const totalShots = employees.reduce((s, e) => s + e.count, 0);

  return (
    <>
      <Topbar title="Screenshots" subtitle="Employee monitoring screenshots · grouped by employee" />
      <PageBody>
        {/* Storage usage banner */}
        {usage ? (
          <Card>
            <CardBody className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-brand/10 text-brand ring-1 ring-inset ring-brand/20">
                  <HardDrive className="size-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {formatBytes(usage.usedBytes)} used
                    <span className="font-normal text-slate-500">
                      {" "}
                      of {usage.limitBytes == null ? "Unlimited" : formatBytes(usage.limitBytes)} ({usage.planName} plan)
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatCompact(totalShots)} screenshots · {formatCompact(employees.length)} employees
                  </p>
                </div>
              </div>
              {usage.limitBytes != null ? (
                <div className="w-full max-w-xs">
                  {(() => {
                    const pct = Math.min(100, Math.round((usage.usedBytes / usage.limitBytes!) * 100));
                    const tone = pct >= 90 ? "#e5484d" : pct >= 75 ? "#d97706" : "#1f883d";
                    return (
                      <>
                        <span className="block h-2 overflow-hidden rounded-full bg-panel-2">
                          <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: tone }} />
                        </span>
                        <p className="mt-1 text-right text-xs text-slate-500">{pct}% used</p>
                      </>
                    );
                  })()}
                </div>
              ) : null}
            </CardBody>
          </Card>
        ) : null}

        {employees.length === 0 ? (
          <Card>
            <CardBody className="flex flex-col items-center gap-2 py-14 text-center">
              <Images className="size-7 text-slate-300" />
              <p className="text-sm text-slate-500">No screenshots yet.</p>
            </CardBody>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {employees.map((e) => {
              const body = (
                <Card className="group h-full transition-colors hover:border-brand/40">
                  <div className="flex items-center gap-3 p-5">
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-panel-2 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-hairline">
                      {initials(e.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-900 group-hover:text-brand">{e.name}</p>
                      <p className="truncate text-xs text-slate-500">{e.title ?? "—"}</p>
                    </div>
                    {e.employeeId ? <ChevronRight className="size-4 shrink-0 text-slate-400 group-hover:text-brand" /> : null}
                  </div>
                  <div className="flex items-center justify-between border-t border-hairline px-5 py-3 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1.5">
                      <Images className="size-3.5" /> {formatCompact(e.count)} shots · {formatBytes(e.totalBytes)}
                    </span>
                    <span>{e.lastCapturedAt ? timeAgo(e.lastCapturedAt, now) : "—"}</span>
                  </div>
                </Card>
              );
              return e.employeeId ? (
                <Link key={e.employeeId} href={`/screenshots/${e.employeeId}`}>
                  {body}
                </Link>
              ) : (
                <div key="unassigned">{body}</div>
              );
            })}
          </div>
        )}
      </PageBody>
    </>
  );
}
