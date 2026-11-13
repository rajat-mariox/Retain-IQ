"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, BadgeCheck, Trash2, ExternalLink, ShieldCheck, Loader2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";

type Expiry = "VALID" | "EXPIRING_SOON" | "EXPIRED" | "NO_EXPIRY";
interface Cert {
  id: string; name: string; issuer: string | null; credentialId: string | null;
  issueDate: string | null; expiresAt: string | null; expiry: Expiry; daysUntilExpiry: number | null;
  verification: "SELF_DECLARED" | "VERIFIED" | "REJECTED"; documentName: string | null; documentUrl: string | null;
}

const EXPIRY: Record<Expiry, { label: string; cls: string }> = {
  VALID: { label: "Valid", cls: "bg-emerald-500/10 text-emerald-700" },
  EXPIRING_SOON: { label: "Expiring soon", cls: "bg-amber-500/10 text-amber-700" },
  EXPIRED: { label: "Expired", cls: "bg-rose-500/10 text-rose-700" },
  NO_EXPIRY: { label: "No expiry", cls: "bg-slate-100 text-slate-500" },
};

/** Certifications tab: structured certs with expiry status + verification. */
export function EmployeeCertificationsPanel({ employeeId, canManage }: { employeeId: string; canManage: boolean }) {
  const [certs, setCerts] = useState<Cert[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", issuer: "", credentialId: "", issueDate: "", expiresAt: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/employees/${employeeId}/certifications`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setCerts(Array.isArray(d) ? d : []))
      .catch(() => setCerts([]))
      .finally(() => setLoading(false));
  }, [employeeId]);
  useEffect(() => { load(); }, [load]);

  async function post(url: string, body?: unknown, method = "POST") {
    setBusy(true); setError(null);
    const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? "That didn't work."); }
    setBusy(false);
    return res.ok;
  }

  async function add() {
    if (!f.name.trim()) return;
    const ok = await post(`/api/employees/${employeeId}/certifications`, {
      name: f.name.trim(), issuer: f.issuer.trim() || undefined, credentialId: f.credentialId.trim() || undefined,
      issueDate: f.issueDate || undefined, expiresAt: f.expiresAt || undefined,
    });
    if (ok) { setOpen(false); setF({ name: "", issuer: "", credentialId: "", issueDate: "", expiresAt: "" }); load(); }
  }

  const input = "w-full rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-sm";
  return (
    <Card>
      <CardHeader
        title="Certifications"
        subtitle="Credentials, issuers & expiry tracking"
        action={canManage ? (
          <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"><Plus className="size-3.5" /> Add certification</button>
        ) : null}
      />
      <div className="p-4">
        {open && canManage ? (
          <div className="mb-3 grid gap-2 rounded-lg border border-hairline bg-panel-2 p-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className="mb-1 block text-xs text-slate-500">Name</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. AWS Solutions Architect" className={input} /></div>
            <div><label className="mb-1 block text-xs text-slate-500">Issuer</label><input value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} placeholder="e.g. Amazon" className={input} /></div>
            <div><label className="mb-1 block text-xs text-slate-500">Credential ID</label><input value={f.credentialId} onChange={(e) => setF({ ...f, credentialId: e.target.value })} className={input} /></div>
            <div><label className="mb-1 block text-xs text-slate-500">Issued</label><input type="date" value={f.issueDate} onChange={(e) => setF({ ...f, issueDate: e.target.value })} className={input} /></div>
            <div><label className="mb-1 block text-xs text-slate-500">Expires</label><input type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} className={input} /></div>
            <div className="sm:col-span-2 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-hairline px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={add} disabled={busy || !f.name.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:brightness-95 disabled:opacity-50">{busy ? <Loader2 className="size-4 animate-spin" /> : null} Add</button>
            </div>
          </div>
        ) : null}
        {error ? <p className="mb-2 text-sm text-rose-600">{error}</p> : null}

        {loading ? (
          <p className="py-6 text-center text-sm text-slate-500">Loading…</p>
        ) : certs.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No certifications recorded yet.</p>
        ) : (
          <ul className="divide-y divide-hairline/60">
            {certs.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-48 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{c.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${EXPIRY[c.expiry].cls}`}>{EXPIRY[c.expiry].label}{c.daysUntilExpiry !== null && c.expiry === "EXPIRING_SOON" ? ` · ${c.daysUntilExpiry}d` : ""}</span>
                    {c.verification === "VERIFIED" ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700"><ShieldCheck className="size-3" /> Verified</span> : null}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {[c.issuer, c.credentialId ? `ID ${c.credentialId}` : null, c.expiresAt ? `expires ${c.expiresAt}` : null].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {c.documentUrl ? <a href={c.documentUrl} target="_blank" rel="noreferrer" title={c.documentName ?? "Certificate"} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand"><ExternalLink className="size-4" /></a> : null}
                  {canManage && c.verification !== "VERIFIED" ? <button onClick={async () => { if (await post(`/api/employees/certifications/${c.id}/verify`, { approve: true })) load(); }} title="Verify" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600"><BadgeCheck className="size-4" /></button> : null}
                  {canManage ? <button onClick={async () => { if (await post(`/api/employees/certifications/${c.id}`, undefined, "DELETE")) load(); }} title="Remove" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600"><Trash2 className="size-4" /></button> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
