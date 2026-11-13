"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { useSubmitLock } from "@/lib/hooks";
import type { OrgRole, PermissionGroup } from "@/lib/api";

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
const labelCls = "mb-1.5 block text-sm font-medium text-slate-700";
const btnPrimary = "inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60";

type Draft = { id: string | null; name: string; description: string; permissions: Set<string>; system: boolean };
const emptyDraft = (): Draft => ({ id: null, name: "", description: "", permissions: new Set(), system: false });

/**
 * Create and manage the roles your organization uses. Deliberately plain
 * language for a non-technical admin: "roles" are just named sets of what
 * someone is allowed to see and do. Built-in roles are read-only; the admin
 * builds their own (e.g. Finance, HR) by ticking the options they should have.
 */
export function RolesManager({ initial, catalog }: { initial: OrgRole[]; catalog: PermissionGroup[] }) {
  const router = useRouter();
  const { busy, run } = useSubmitLock();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Map a permission key → its friendly label, for showing what a role includes.
  const labelOf = new Map<string, string>();
  for (const g of catalog) for (const it of g.items) labelOf.set(it.key, it.label);

  const openNew = () => { setError(null); setDraft(emptyDraft()); };
  const openEdit = (r: OrgRole) => {
    setError(null);
    setDraft({ id: r.id, name: r.name, description: r.description ?? "", permissions: new Set(r.permissions), system: r.isSystem });
  };

  const toggle = (key: string) =>
    setDraft((d) => {
      if (!d) return d;
      const next = new Set(d.permissions);
      next.has(key) ? next.delete(key) : next.add(key);
      return { ...d, permissions: next };
    });

  async function save() {
    if (!draft) return;
    setError(null);
    if (draft.name.trim().length < 2) { setError("Give the role a name."); return; }
    if (draft.permissions.size === 0) { setError("Tick at least one thing this role can do."); return; }
    const body = { name: draft.name.trim(), description: draft.description.trim() || null, permissions: [...draft.permissions] };
    await run(async () => {
      const url = draft.id ? `/api/rbac/roles/${draft.id}` : "/api/rbac/roles";
      const res = await fetch(url, {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "That didn't work.");
        return;
      }
      setDraft(null);
      router.refresh();
    });
  }

  async function remove(r: OrgRole) {
    if (!confirm(`Delete the "${r.name}" role? This can't be undone.`)) return;
    setError(null);
    await run(async () => {
      const res = await fetch(`/api/rbac/roles/${r.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "Could not delete the role.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader
        title="Roles"
        subtitle="A role is a named set of what someone can see and do. Edit the built-in ones or create your own, like Finance."
        action={
          <button type="button" onClick={openNew} className={btnPrimary}>
            <Plus className="size-4" /> New role
          </button>
        }
      />

      {error && !draft ? <p className="mx-5 mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 ring-1 ring-inset ring-rose-200">{error}</p> : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-hairline text-xs text-slate-500">
              <th className="px-5 py-3 text-left font-medium">Role</th>
              <th className="px-5 py-3 text-left font-medium">Can do</th>
              <th className="px-5 py-3 text-left font-medium">People with this role</th>
              <th className="px-5 py-3 text-right font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {initial.map((r) => (
              <tr key={r.id} className="border-b border-hairline/60 last:border-0">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2 font-medium text-slate-900">
                    {r.isSystem ? <ShieldCheck className="size-4 text-slate-400" /> : null}
                    {r.name}
                    {r.isSystem ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Built-in</span> : null}
                  </div>
                  {r.description ? <p className="mt-0.5 text-xs text-slate-400">{r.description}</p> : null}
                </td>
                <td className="px-5 py-3 text-slate-600">
                  {r.permissions.length === 0
                    ? "—"
                    : r.permissions.slice(0, 3).map((p) => labelOf.get(p) ?? p).join(", ") +
                      (r.permissions.length > 3 ? ` +${r.permissions.length - 3} more` : "")}
                </td>
                <td className="px-5 py-3 tabular-nums text-slate-600">{r.assignedCount}</td>
                <td className="px-5 py-3">
                  <div className="flex justify-end gap-1.5">
                    {/* Owner is fixed. Other built-in roles can be edited (not renamed or deleted). */}
                    {r.isSystem && r.name === "Owner" ? (
                      <span className="text-xs text-slate-400">Fixed</span>
                    ) : r.isSystem ? (
                      <button onClick={() => openEdit(r)} title="Edit" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                        <Pencil className="size-4" />
                      </button>
                    ) : (
                      <>
                        <button onClick={() => openEdit(r)} title="Edit" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                          <Pencil className="size-4" />
                        </button>
                        <button onClick={() => remove(r)} disabled={busy} title="Delete" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-50">
                          <Trash2 className="size-4" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={draft !== null} onClose={() => setDraft(null)} title={draft?.id ? "Edit role" : "New role"} size="lg">
        {draft ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Role name</label>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. Finance"
                  disabled={draft.system}
                  title={draft.system ? "Built-in roles can't be renamed" : undefined}
                  className={`${input} disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500`}
                />
              </div>
              <div>
                <label className={labelCls}>Short description <span className="font-normal text-slate-400">(optional)</span></label>
                <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="e.g. Can view salaries" className={input} />
              </div>
            </div>

            <div>
              <label className={labelCls}>What can this role do?</label>
              <p className="mb-3 text-xs text-slate-500">Tick everything a person with this role should be allowed to see or do.</p>
              <div className="space-y-4">
                {catalog.map((group) => (
                  <div key={group.group}>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{group.group}</p>
                    <div className="space-y-1.5">
                      {group.items.map((opt) => (
                        <label key={opt.key} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-hairline bg-panel px-3 py-2 hover:bg-slate-50">
                          <input type="checkbox" checked={draft.permissions.has(opt.key)} onChange={() => toggle(opt.key)} className="mt-0.5" />
                          <span>
                            <span className="block text-sm font-medium text-slate-800">{opt.label}</span>
                            <span className="block text-xs text-slate-400">{opt.hint}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 ring-1 ring-inset ring-rose-200">{error}</p> : null}

            <div className="flex justify-end gap-2">
              <button onClick={() => setDraft(null)} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <X className="size-4" /> Cancel
              </button>
              <button onClick={save} disabled={busy} className={btnPrimary}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null} {draft.id ? "Save changes" : "Create role"}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </Card>
  );
}
