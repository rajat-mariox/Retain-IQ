"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquare, Plus, Trash2, Lock, Loader2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { LocalTime } from "@/components/ui/LocalTime";

interface Remark {
  id: string; visibility: string; reason: string | null; content: string;
  createdByName: string | null; canDelete: boolean; createdAt: string;
}

const VIS_LABEL: Record<string, string> = {
  MANAGER_ONLY: "Manager only", HR_ONLY: "HR only", HR_AND_MANAGER: "HR & manager",
  EMPLOYEE_VISIBLE: "Employee-visible", ADMIN_ONLY: "Admin only",
};
const VIS_OPTIONS = Object.keys(VIS_LABEL);

/** Remarks tab: visibility-scoped manager/HR notes. The list is server-filtered to
 *  what the caller may see; a private remark never arrives here for the wrong viewer. */
export function EmployeeRemarksPanel({ employeeId, canManage }: { employeeId: string; canManage: boolean }) {
  const [rows, setRows] = useState<Remark[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState("MANAGER_ONLY");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/employees/${employeeId}/remarks`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [employeeId]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!content.trim()) return;
    setBusy(true); setError(null);
    const res = await fetch(`/api/employees/${employeeId}/remarks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: content.trim(), visibility, reason: reason.trim() || undefined }) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? "That didn't work."); }
    else { setOpen(false); setContent(""); setReason(""); load(); }
    setBusy(false);
  }
  async function del(id: string) {
    const res = await fetch(`/api/employees/remarks/${id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm";
  return (
    <Card>
      <CardHeader
        title="Remarks"
        subtitle="Visibility-scoped manager & HR notes"
        action={canManage ? (
          <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"><Plus className="size-3.5" /> Add remark</button>
        ) : null}
      />
      <div className="p-4">
        {open && canManage ? (
          <div className="mb-3 space-y-2 rounded-lg border border-hairline bg-panel-2 p-3">
            <textarea className={input} rows={3} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Write a remark…" />
            <div className="grid gap-2 sm:grid-cols-2">
              <div><label className="mb-1 block text-xs text-slate-500">Visibility</label><select className={input} value={visibility} onChange={(e) => setVisibility(e.target.value)}>{VIS_OPTIONS.map((v) => <option key={v} value={v}>{VIS_LABEL[v]}</option>)}</select></div>
              <div><label className="mb-1 block text-xs text-slate-500">Reason (optional)</label><input className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. 1:1 note" /></div>
            </div>
            {error ? <p className="text-xs text-rose-600">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={add} disabled={busy || !content.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:brightness-95 disabled:opacity-50">{busy ? <Loader2 className="size-4 animate-spin" /> : null} Save</button>
            </div>
          </div>
        ) : null}

        {loading ? <p className="py-4 text-center text-sm text-slate-500">Loading…</p> : rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">No remarks you can view.</p>
        ) : (
          <ul className="space-y-2.5">
            {rows.map((r) => (
              <li key={r.id} className="rounded-xl border border-hairline p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <MessageSquare className="size-3.5 text-slate-400" />
                  <span className="inline-flex items-center gap-1 rounded-full bg-panel-2 px-2 py-0.5 text-[11px] font-medium text-slate-500"><Lock className="size-2.5" /> {VIS_LABEL[r.visibility] ?? r.visibility}</span>
                  {r.reason ? <span className="text-[11px] text-slate-400">{r.reason}</span> : null}
                  {r.canDelete ? <button onClick={() => del(r.id)} className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600" title="Delete"><Trash2 className="size-3.5" /></button> : null}
                </div>
                <p className="whitespace-pre-wrap text-sm text-slate-700">{r.content}</p>
                <p className="mt-1 text-[11px] text-slate-400">{r.createdByName ?? "Someone"} · <LocalTime iso={r.createdAt} /></p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
