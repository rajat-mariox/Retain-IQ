import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card, CardHeader } from "@/components/ui/Card";
import { AddMemberForm } from "@/components/members/AddMemberForm";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";

interface Employee {
  id: string;
  employeeCode: string | null;
  email: string | null;
  firstName: string;
  lastName: string;
  status: string;
  createdAt: string;
}

export default async function EmployeesPage() {
  const data = await apiFetch<{ items: Employee[]; nextCursor: string | null }>("employees").catch(() => ({ items: [] as Employee[], nextCursor: null }));
  const employees = data.items;

  return (
    <>
      <Topbar title="Employees" subtitle="Your team directory" />
      <PageBody>
        <AddMemberForm />
        <Card>
          <CardHeader title="Employees" subtitle={`${employees.length} in your organization`} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-xs text-slate-500">
                  <th className="px-5 py-3 text-left font-medium">Name</th>
                  <th className="px-5 py-3 text-left font-medium">Email</th>
                  <th className="px-5 py-3 text-left font-medium">Code</th>
                  <th className="px-5 py-3 text-left font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Joined</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-panel-2 text-[11px] font-semibold text-slate-700 ring-1 ring-inset ring-hairline">
                          {`${e.firstName[0] ?? ""}${e.lastName[0] ?? ""}`.toUpperCase()}
                        </span>
                        <span className="font-medium text-slate-900">{e.firstName} {e.lastName}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{e.email ?? "—"}</td>
                    <td className="px-5 py-3 tabular-nums text-slate-600">{e.employeeCode ?? "—"}</td>
                    <td className="px-5 py-3">
                      <span className="rounded-full bg-panel-2 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-hairline">
                        {e.status.toLowerCase().replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-xs text-slate-500">{formatDate(e.createdAt)}</td>
                  </tr>
                ))}
                {employees.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-500">No employees yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      </PageBody>
    </>
  );
}
