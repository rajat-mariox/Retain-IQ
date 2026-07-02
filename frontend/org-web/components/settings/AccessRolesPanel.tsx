"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Search, ShieldCheck, X } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import type { AccessMember, AccessPage, OrgDepartment, OrgRole, OrgTeam } from "@/lib/api";

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
const label = "mb-1.5 block text-sm font-medium text-slate-700";

type ScopeType = "ORG" | "DEPARTMENT" | "TEAM";

export function AccessRolesPanel({
  initial,
  roles,
  departments,
  teams,
}: {
  initial: AccessPage;
  roles: OrgRole[];
  departments: OrgDepartment[];
  teams: OrgTeam[];
}) {
  const [pending, start] = useTransition();
  const [data, setData] = useState<AccessPage>(initial);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  // Modal state
  const [open, setOpen] = useState(false);
  const [forUser, setForUser] = useState<AccessMember | null>(null);
  const [roleId, setRoleId] = useState("");
  const [scopeType, setScopeType] = useState<ScopeType>("ORG");
  const [scopeId, setScopeId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const pageSize = initial.pageSize || 10;

  const load = useCallback(
    (page: number, query: string) => {
      setLoading(true);
      fetch(`/api/rbac/access?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((d: AccessPage) => setData(d))
        .catch(() => undefined)
        .finally(() => setLoading(false));
    },
    [pageSize],
  );

  // Debounced search — resets to page 1. Skips the very first render (server data already loaded).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => load(1, q), 300);
    return () => clearTimeout(t);
  }, [q, load]);

  const refresh = () => load(data.page, q);

  function openFor(m: AccessMember) {
    setForUser(m);
    setRoleId(roles[0]?.id ?? "");
    setScopeType("ORG");
    setScopeId("");
    setError(null);
    setOpen(true);
  }

  function assign() {
    if (!forUser) return;
    setError(null);
    start(async () => {
      const res = await fetch("/api/rbac/grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: forUser.userId, roleId, scopeType, scopeId: scopeType === "ORG" ? null : scopeId || null }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "Could not assign role.");
        return;
      }
      setOpen(false);
      refresh();
    });
  }

  function revoke(grantId: string) {
    start(async () => {
      await fetch(`/api/rbac/grants/${grantId}`, { method: "DELETE" });
      refresh();
    });
  }

  const activeDepts = departments.filter((d) => d.status !== "ARCHIVED");
  const total = data.total;
  const from = total === 0 ? 0 : (data.page - 1) * pageSize + 1;
  const to = Math.min(data.page * pageSize, total);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <Card>
        <CardHeader
          title="Access & roles"
          subtitle="Assign roles to people, scoped to the whole org, a department or a team"
          action={
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name or email…"
                className="w-56 rounded-lg border border-hairline bg-panel py-1.5 pl-8 pr-3 text-sm text-slate-900 focus:border-brand focus:outline-none"
              />
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-hairline text-xs text-slate-500">
                <th className="px-5 py-3 text-left font-medium">Member</th>
                <th className="px-5 py-3 text-left font-medium">Roles &amp; scope</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className={loading ? "opacity-50 transition-opacity" : "transition-opacity"}>
              {data.items.map((m) => (
                <tr key={m.userId} className="border-b border-hairline/60 last:border-0 align-top hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-900">{m.name ?? m.email}</p>
                    {m.name ? <p className="text-xs text-slate-500">{m.email}</p> : null}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {m.grants.length === 0 ? (
                        <span className="text-xs text-slate-400">No roles</span>
                      ) : (
                        m.grants.map((g) => (
                          <span key={g.id} className="inline-flex items-center gap-1 rounded-full bg-brand/10 py-0.5 pl-2 pr-1 text-xs font-medium text-brand ring-1 ring-inset ring-brand/20">
                            {g.roleName} · {g.scopeLabel}
                            <button onClick={() => revoke(g.id)} disabled={pending} className="rounded-full p-0.5 text-brand/70 hover:bg-brand/20 hover:text-brand disabled:opacity-50" title="Revoke">
                              <X className="size-3" />
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => openFor(m)} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                      <ShieldCheck className="size-3.5 text-slate-500" /> Assign
                    </button>
                  </td>
                </tr>
              ))}
              {data.items.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-5 py-8 text-center text-sm text-slate-500">{q ? "No members match your search." : "No members."}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-hairline px-5 py-3 text-xs text-slate-500">
          <span>{total === 0 ? "No members" : `Showing ${from}–${to} of ${total}`}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => load(data.page - 1, q)}
              disabled={loading || data.page <= 1}
              className="rounded-lg border border-hairline bg-panel px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Prev
            </button>
            <span className="px-1 tabular-nums">
              {data.page} / {lastPage}
            </span>
            <button
              onClick={() => load(data.page + 1, q)}
              disabled={loading || data.page >= lastPage}
              className="rounded-lg border border-hairline bg-panel px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={forUser ? `Assign role — ${forUser.name ?? forUser.email}` : "Assign role"}>
        <div className="space-y-4">
          <div>
            <label className={label}>Role</label>
            <select className={input} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Scope</label>
            <select
              className={input}
              value={scopeType}
              onChange={(e) => {
                setScopeType(e.target.value as ScopeType);
                setScopeId("");
              }}
            >
              <option value="ORG">Whole organization</option>
              <option value="DEPARTMENT">A department</option>
              <option value="TEAM">A team</option>
            </select>
          </div>
          {scopeType === "DEPARTMENT" ? (
            <div>
              <label className={label}>Department</label>
              <select className={input} value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
                <option value="">Select…</option>
                {activeDepts.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          ) : null}
          {scopeType === "TEAM" ? (
            <div>
              <label className={label}>Team</label>
              <select className={input} value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
                <option value="">Select…</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          ) : null}
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button
              onClick={assign}
              disabled={pending || !roleId || (scopeType !== "ORG" && !scopeId)}
              className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60"
            >
              {pending ? "Assigning…" : "Assign"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
