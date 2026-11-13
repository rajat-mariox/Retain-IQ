import Link from "next/link";
import { LogIn, CreditCard, ArrowLeftRight, Building2, ShieldCheck, type LucideIcon } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card } from "@/components/ui/Card";
import { PageNav } from "@/components/ui/PageNav";
import { getAudit, type ApiAuditEntry, type AuditCategory } from "@/lib/admin-api";
import { formatCompact, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All events" },
  { key: "login", label: "Login Logs" },
  { key: "subscription", label: "Subscription Changes" },
  { key: "plan", label: "Plan Changes" },
  { key: "organization", label: "Organization Activities" },
];

const CAT: Record<AuditCategory, { icon: LucideIcon; tone: string; label: string }> = {
  login: { icon: LogIn, tone: "bg-sky-50 text-sky-700 ring-sky-200", label: "Login" },
  subscription: { icon: CreditCard, tone: "bg-emerald-50 text-emerald-700 ring-emerald-200", label: "Subscription" },
  plan: { icon: ArrowLeftRight, tone: "bg-teal-50 text-teal-700 ring-teal-200", label: "Plan" },
  organization: { icon: Building2, tone: "bg-violet-50 text-violet-700 ring-violet-200", label: "Organization" },
};

function CategoryBadge({ category }: { category: AuditCategory }) {
  const c = CAT[category];
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${c.tone}`}>
      <Icon className="size-3" />
      {c.label}
    </span>
  );
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ category?: string; page?: string }> }) {
  const sp = await searchParams;
  const category = (FILTERS.some((f) => f.key === sp.category) ? sp.category : "all") as string;
  const page = Math.max(1, Number(sp.page) || 1);
  const data = await getAudit(category, page, PAGE_SIZE).catch(() => null);
  const now = Date.now();

  return (
    <>
      <Topbar title="Audit Logs" subtitle="Audit & compliance · login, subscription, plan & organization events" />
      <PageBody>
        {/* Category filter */}
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const active = category === f.key;
            return (
              <Link
                key={f.key}
                href={f.key === "all" ? "/audit" : `/audit?category=${f.key}`}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors ${
                  active ? "bg-brand/10 text-brand ring-brand/30" : "bg-panel text-slate-600 ring-hairline hover:bg-slate-50"
                }`}
              >
                {f.label}
              </Link>
            );
          })}
        </div>

        <Card>
          {!data ? (
            <p className="px-5 py-12 text-center text-sm text-slate-500">Audit log is unavailable.</p>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-hairline px-5 py-3 text-sm text-slate-500">
                <ShieldCheck className="size-4 text-slate-400" />
                {formatCompact(data.total)} {category === "all" ? "events" : `${category} events`}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-xs text-slate-500">
                      <th className="px-5 py-3 text-left font-medium">When</th>
                      <th className="px-5 py-3 text-left font-medium">Category</th>
                      <th className="px-5 py-3 text-left font-medium">Event</th>
                      <th className="px-5 py-3 text-left font-medium">Actor</th>
                      <th className="px-5 py-3 text-left font-medium">Organization</th>
                      <th className="px-5 py-3 text-left font-medium">IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((e: ApiAuditEntry) => (
                      <tr key={e.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                        <td className="whitespace-nowrap px-5 py-3 text-slate-500" title={e.createdAt}>{timeAgo(e.createdAt, now)}</td>
                        <td className="px-5 py-3"><CategoryBadge category={e.category} /></td>
                        <td className="px-5 py-3 text-slate-800">{e.summary}</td>
                        <td className="px-5 py-3 text-slate-600">{e.actor ?? <span className="text-slate-300">—</span>}</td>
                        <td className="px-5 py-3">
                          {e.orgId && e.orgName ? (
                            <Link href={`/organizations/${e.orgId}`} className="text-slate-700 hover:text-brand">{e.orgName}</Link>
                          ) : (
                            <span className="text-slate-400">{e.orgName ?? "—"}</span>
                          )}
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-slate-500">{e.ip ?? "—"}</td>
                      </tr>
                    ))}
                    {data.items.length === 0 ? (
                      <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">No events in this category.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <PageNav page={data.page} pageSize={data.pageSize} total={data.total} basePath={category === "all" ? "/audit" : `/audit?category=${category}`} />
            </>
          )}
        </Card>
      </PageBody>
    </>
  );
}
