import { Activity, Ban, Building2, CheckCircle2, RotateCcw, Settings2, ShieldCheck, Siren, ToggleLeft, ToggleRight, UserPlus, XCircle } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card, CardHeader } from "@/components/ui/Card";
import { LocalTime } from "@/components/ui/LocalTime";
import { getOrgActivity, getSession } from "@/lib/api";

const PAGE_SIZE = 30;

// Each event type gets a plain-language look. Unknown types fall back to a
// neutral dot, so a new event kind still renders sensibly.
const LOOK: Record<string, { icon: typeof Activity; tint: string; label: string }> = {
  "org.created": { icon: Building2, tint: "text-emerald-600 bg-emerald-50", label: "Organization created" },
  "org.updated": { icon: Settings2, tint: "text-slate-600 bg-slate-100", label: "Organization updated" },
  "org.suspended": { icon: Ban, tint: "text-rose-600 bg-rose-50", label: "Organization suspended" },
  "org.activated": { icon: CheckCircle2, tint: "text-emerald-600 bg-emerald-50", label: "Organization activated" },
  "user.invited": { icon: UserPlus, tint: "text-sky-600 bg-sky-50", label: "Member invited" },
  "member.added": { icon: UserPlus, tint: "text-sky-600 bg-sky-50", label: "Member added" },
  "feature.enabled": { icon: ToggleRight, tint: "text-emerald-600 bg-emerald-50", label: "Feature turned on" },
  "feature.disabled": { icon: ToggleLeft, tint: "text-amber-600 bg-amber-50", label: "Feature turned off" },
  "feature.reset": { icon: RotateCcw, tint: "text-slate-600 bg-slate-100", label: "Feature reset" },
  // Observation -> Escalation -> Incident resolution history.
  "observation.resolved": { icon: ShieldCheck, tint: "text-emerald-600 bg-emerald-50", label: "Observation resolved" },
  "observation.dismissed": { icon: XCircle, tint: "text-slate-600 bg-slate-100", label: "Observation dismissed" },
  "escalation.resolved": { icon: ShieldCheck, tint: "text-emerald-600 bg-emerald-50", label: "Escalation resolved" },
  "incident.resolved": { icon: ShieldCheck, tint: "text-emerald-600 bg-emerald-50", label: "Incident resolved" },
  "incident.closed": { icon: Siren, tint: "text-violet-600 bg-violet-50", label: "Incident closed" },
};
const lookOf = (type: string) => LOOK[type] ?? { icon: Activity, tint: "text-slate-500 bg-slate-100", label: type.replace(/[._]/g, " ") };

export default async function ActivityPage() {
  const session = await getSession().catch(() => null);
  // Activity is an audit log — only members with audit.read (the Owner has it,
  // and an admin can grant it via a custom role) may see it. A direct visit
  // without it gets a plain message, not the org's event history.
  const canView = Boolean(session && session.role.permissions.includes("audit.read"));
  if (!canView) {
    return (
      <>
        <Topbar title="Activity" subtitle="What's happened across your organization" />
        <PageBody>
          <Card>
            <p className="px-5 py-12 text-center text-sm text-slate-500">
              You don't have access to your organization's activity log.
            </p>
          </Card>
        </PageBody>
      </>
    );
  }

  const data = await getOrgActivity(1, PAGE_SIZE).catch(() => ({ items: [], total: 0, page: 1, pageSize: PAGE_SIZE }));

  return (
    <>
      <Topbar title="Activity" subtitle="What's happened across your organization" />
      <PageBody>
        <Card>
          <CardHeader title="Recent activity" subtitle={`${data.total} event${data.total === 1 ? "" : "s"} in your organization`} />
          {data.items.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-slate-500">Nothing has happened yet — activity will show up here.</p>
          ) : (
            <ul className="divide-y divide-hairline/60">
              {data.items.map((e) => {
                const look = lookOf(e.type);
                const Icon = look.icon;
                return (
                  <li key={e.id} className="flex items-start gap-3 px-5 py-3.5">
                    <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${look.tint}`}>
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-800">{e.summary}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {look.label} · <LocalTime iso={e.createdAt} />
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </PageBody>
    </>
  );
}
