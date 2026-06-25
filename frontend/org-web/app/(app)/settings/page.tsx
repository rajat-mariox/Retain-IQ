import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { getMembers, getOrg } from "@/lib/api";
import { formatDate } from "@/lib/format";

export default async function SettingsPage() {
  const [org, members] = await Promise.all([getOrg().catch(() => null), getMembers().catch(() => [])]);

  return (
    <>
      <Topbar title="Settings" subtitle="Organization profile & members" />
      <PageBody>
        <Card>
          <CardHeader title="Organization" subtitle="Profile" />
          <CardBody>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
              <Field label="Name" value={org?.name ?? "—"} />
              <Field label="Slug" value={org?.slug ?? "—"} />
              <Field label="Region" value={org?.region ?? "—"} />
              <Field label="Timezone" value={org?.timezone ?? "—"} />
              <Field label="Status" value={org?.status ?? "—"} />
              <Field label="Created" value={org ? formatDate(org.createdAt) : "—"} />
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Members" subtitle={`${members.length} people with access`} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-xs text-slate-500">
                  <th className="px-5 py-3 text-left font-medium">Member</th>
                  <th className="px-5 py-3 text-left font-medium">Email</th>
                  <th className="px-5 py-3 text-left font-medium">Role</th>
                  <th className="px-5 py-3 text-left font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Joined</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-900">{m.name ?? m.email}</td>
                    <td className="px-5 py-3 text-slate-600">{m.email}</td>
                    <td className="px-5 py-3">
                      <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-brand/20">{m.role}</span>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{m.status.toLowerCase()}</td>
                    <td className="px-5 py-3 text-right text-xs text-slate-500">{formatDate(m.joinedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </PageBody>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-800">{value}</dd>
    </div>
  );
}
