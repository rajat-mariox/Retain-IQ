"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Archive, Building2, Coins, Pencil, Plus, Trash2 } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import type { BillRateRow, ClientRow, EmployeeRateRow, PayrollSettings, ProjectSummary } from "@/lib/api";

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
const label = "mb-1.5 block text-sm font-medium text-slate-700";

/** Cents ↔ display dollars. Money is integer cents everywhere below the UI. */
const money = (cents: number | null, currency = "USD") =>
  cents == null ? "—" : `${currency === "USD" ? "$" : ""}${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const toCents = (v: string) => Math.round((Number(v) || 0) * 100);

const SCOPE_LABEL: Record<string, string> = {
  project_employee: "Project · person",
  project: "Project",
  client_employee: "Client · person",
  client: "Client",
};

type Person = { id: string; name: string };

export function ClientsRatesPanel({
  clients: initialClients,
  billRates: initialBillRates,
  settings,
  projects,
  people,
}: {
  clients: ClientRow[];
  billRates: BillRateRow[];
  settings: PayrollSettings | null;
  projects: ProjectSummary[];
  people: Person[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [clients, setClients] = useState(initialClients);
  const [billRates, setBillRates] = useState(initialBillRates);
  const currency = settings?.currency ?? "USD";

  // client modal
  const [clientOpen, setClientOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientRow | null>(null);
  const [clientForm, setClientForm] = useState({ name: "", code: "", contactEmail: "" });

  // employee-rate modal
  const [rateOpen, setRateOpen] = useState(false);
  const [ratePerson, setRatePerson] = useState<string>("");
  const [rateHistory, setRateHistory] = useState<EmployeeRateRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [rateForm, setRateForm] = useState({ cost: "", bill: "", effectiveFrom: "", note: "" });

  // bill-rate modal
  const [billOpen, setBillOpen] = useState(false);
  const [billForm, setBillForm] = useState({ anchor: "client", clientId: "", projectId: "", employeeId: "", rate: "", effectiveFrom: "", note: "" });

  const reloadClients = useCallback(() => {
    fetch("/api/clients", { cache: "no-store" }).then((r) => r.json()).then((d) => Array.isArray(d) && setClients(d)).catch(() => undefined);
  }, []);
  const reloadBillRates = useCallback(() => {
    fetch("/api/payroll/rates/bill-rates", { cache: "no-store" }).then((r) => r.json()).then((d) => Array.isArray(d) && setBillRates(d)).catch(() => undefined);
  }, []);

  const loadHistory = useCallback((employeeId: string) => {
    if (!employeeId) return setRateHistory([]);
    setHistoryLoading(true);
    fetch(`/api/payroll/rates/employees/${employeeId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setRateHistory(Array.isArray(d) ? d : []))
      .catch(() => setRateHistory([]))
      .finally(() => setHistoryLoading(false));
  }, []);
  useEffect(() => { if (rateOpen) loadHistory(ratePerson); }, [rateOpen, ratePerson, loadHistory]);

  // ---- clients ----
  function openClient(c: ClientRow | null) {
    setEditingClient(c);
    setClientForm({ name: c?.name ?? "", code: c?.code ?? "", contactEmail: c?.contactEmail ?? "" });
    setError(null);
    setClientOpen(true);
  }
  const saveClient = () =>
    start(async () => {
      setError(null);
      const body = { name: clientForm.name.trim(), code: clientForm.code.trim() || null, contactEmail: clientForm.contactEmail.trim() || null };
      if (!body.name) return setError("Name is required.");
      const res = await fetch(editingClient ? `/api/clients/${editingClient.id}` : "/api/clients", {
        method: editingClient ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        return setError(d.error?.message ?? "Could not save client.");
      }
      setClientOpen(false);
      reloadClients();
    });

  const archiveClient = (c: ClientRow) =>
    start(async () => {
      setError(null);
      const res = await fetch(`/api/clients/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: c.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE" }),
      });
      if (!res.ok) return setError("Could not change client status.");
      reloadClients();
    });

  const deleteClient = (c: ClientRow) =>
    start(async () => {
      setError(null);
      if (typeof window !== "undefined" && !window.confirm(`Delete ${c.name}?`)) return;
      const res = await fetch(`/api/clients/${c.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        return setError(d.error?.message ?? "Could not delete client.");
      }
      reloadClients();
    });

  // ---- rates ----
  const saveRate = () =>
    start(async () => {
      setError(null);
      if (!ratePerson) return setError("Pick an employee.");
      if (!rateForm.cost) return setError("Cost rate is required.");
      const res = await fetch(`/api/payroll/rates/employees/${ratePerson}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          costRateCents: toCents(rateForm.cost),
          billRateCents: rateForm.bill ? toCents(rateForm.bill) : null,
          effectiveFrom: rateForm.effectiveFrom || undefined,
          note: rateForm.note || undefined,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        return setError(d.error?.message ?? "Could not save rate.");
      }
      setRateForm({ cost: "", bill: "", effectiveFrom: "", note: "" });
      loadHistory(ratePerson);
    });

  const saveBillRate = () =>
    start(async () => {
      setError(null);
      const isClient = billForm.anchor === "client";
      if (isClient && !billForm.clientId) return setError("Pick a client.");
      if (!isClient && !billForm.projectId) return setError("Pick a project.");
      if (!billForm.rate) return setError("Rate is required.");
      const res = await fetch("/api/payroll/rates/bill-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: isClient ? billForm.clientId : null,
          projectId: isClient ? null : billForm.projectId,
          employeeId: billForm.employeeId || null,
          billRateCents: toCents(billForm.rate),
          effectiveFrom: billForm.effectiveFrom || undefined,
          note: billForm.note || undefined,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        return setError(d.error?.message ?? "Could not save bill rate.");
      }
      setBillOpen(false);
      setBillForm({ anchor: "client", clientId: "", projectId: "", employeeId: "", rate: "", effectiveFrom: "", note: "" });
      reloadBillRates();
    });

  return (
    <>
      {/* ---------------- Clients ---------------- */}
      <Card>
        <CardHeader
          title="Clients"
          subtitle="Companies you deliver billable work for — projects attribute their hours here"
          action={
            <button onClick={() => openClient(null)} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Plus className="size-4" /> Add client
            </button>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-hairline text-xs text-slate-500">
                <th className="px-5 py-3 text-left font-medium">Client</th>
                <th className="px-5 py-3 text-left font-medium">Code</th>
                <th className="px-5 py-3 text-left font-medium">Contact</th>
                <th className="px-5 py-3 text-right font-medium">Projects</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-2 font-medium text-slate-900">
                      <Building2 className="size-3.5 text-slate-400" />
                      {c.name}
                      {c.status === "ARCHIVED" ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">archived</span> : null}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{c.code ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{c.contactEmail ?? "—"}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-700">{c.projectCount}</td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => openClient(c)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="size-3.5" /></button>
                      <button onClick={() => archiveClient(c)} disabled={pending} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-amber-600 disabled:opacity-50" title={c.status === "ACTIVE" ? "Archive" : "Restore"}><Archive className="size-3.5" /></button>
                      <button onClick={() => deleteClient(c)} disabled={pending || c.projectCount > 0} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-30" title={c.projectCount > 0 ? "Archive instead — this client has projects" : "Delete"}><Trash2 className="size-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {clients.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-500">No clients yet — add one, then link a project to it.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ---------------- Rates ---------------- */}
      <Card>
        <CardHeader
          title="Pay & bill rates"
          subtitle="Cost rate is what you pay; bill rate is what the client pays. Rates are effective-dated — changing one never rewrites past payroll."
          action={
            <div className="flex gap-2">
              <button onClick={() => { setRatePerson(""); setRateHistory([]); setError(null); setRateOpen(true); }} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <Coins className="size-4" /> Employee rates
              </button>
              <button onClick={() => { setError(null); setBillOpen(true); }} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <Plus className="size-4" /> Bill rate override
              </button>
            </div>
          }
        />
        <CardBody className="space-y-3">
          {error && !clientOpen && !rateOpen && !billOpen ? <p className="text-sm text-rose-600">{error}</p> : null}
          <p className="text-xs text-slate-500">
            A charge-out rate resolves most-specific first: <span className="font-medium text-slate-600">project · person → project → client · person → client → the employee&apos;s default</span>.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-xs text-slate-500">
                  <th className="px-4 py-3 text-left font-medium">Scope</th>
                  <th className="px-4 py-3 text-left font-medium">Applies to</th>
                  <th className="px-4 py-3 text-left font-medium">Person</th>
                  <th className="px-4 py-3 text-right font-medium">Rate / h</th>
                  <th className="px-4 py-3 text-right font-medium">Effective</th>
                </tr>
              </thead>
              <tbody>
                {billRates.filter((r) => r.current).map((r) => (
                  <tr key={r.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand ring-1 ring-inset ring-brand/20">{SCOPE_LABEL[r.scope] ?? r.scope}</span>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">{r.projectName ?? r.clientName ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{r.employeeName ?? "Anyone"}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-800">{money(r.billRateCents, currency)}</td>
                    <td className="px-4 py-3 text-right text-xs text-slate-500">from {r.effectiveFrom}</td>
                  </tr>
                ))}
                {billRates.filter((r) => r.current).length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">No overrides — every project bills at the employee&apos;s default rate.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* ---------------- client modal ---------------- */}
      <Modal open={clientOpen} onClose={() => setClientOpen(false)} title={editingClient ? "Edit client" : "Add client"}>
        <div className="space-y-4">
          <div><label className={label}>Name</label><input className={input} value={clientForm.name} onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })} placeholder="e.g. Acme Retail" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Code (optional)</label><input className={input} value={clientForm.code} onChange={(e) => setClientForm({ ...clientForm, code: e.target.value })} placeholder="ACME" /></div>
            <div><label className={label}>Contact email (optional)</label><input className={input} value={clientForm.contactEmail} onChange={(e) => setClientForm({ ...clientForm, contactEmail: e.target.value })} placeholder="ops@acme.com" /></div>
          </div>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setClientOpen(false)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={saveClient} disabled={pending} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">{pending ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </Modal>

      {/* ---------------- employee rate modal ---------------- */}
      <Modal open={rateOpen} onClose={() => setRateOpen(false)} title="Employee rates" size="lg">
        <div className="space-y-4">
          <div>
            <label className={label}>Employee</label>
            <select className={input} value={ratePerson} onChange={(e) => setRatePerson(e.target.value)}>
              <option value="">Select an employee…</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {ratePerson ? (
            <>
              <div className="rounded-xl border border-hairline/70">
                <p className="border-b border-hairline/60 bg-panel-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Rate history</p>
                {historyLoading ? (
                  <p className="px-4 py-6 text-center text-sm text-slate-400">Loading rate history…</p>
                ) : rateHistory.length ? (
                  <ul className="divide-y divide-hairline/60">
                    {rateHistory.map((r) => (
                      <li key={r.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                        <span>
                          <span className="font-medium text-slate-800">{money(r.costRateCents, currency)}</span>
                          <span className="text-slate-400"> cost</span>
                          {r.billRateCents != null ? <><span className="ml-2 font-medium text-slate-800">{money(r.billRateCents, currency)}</span><span className="text-slate-400"> bill</span></> : null}
                          {r.note ? <span className="ml-2 text-xs text-slate-400">· {r.note}</span> : null}
                        </span>
                        <span className="flex items-center gap-2 text-xs">
                          <span className="tabular-nums text-slate-500">{r.effectiveFrom} → {r.effectiveTo ?? "now"}</span>
                          {r.current ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">current</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-4 py-6 text-center text-sm text-slate-500">No rate set — payroll can&apos;t be calculated for this person yet.</p>
                )}
              </div>

              <div className="rounded-xl bg-panel-2 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Set a new rate</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={label}>Cost / hour</label><input type="number" min={0} step="0.01" className={input} value={rateForm.cost} onChange={(e) => setRateForm({ ...rateForm, cost: e.target.value })} placeholder="40.00" /></div>
                  <div><label className={label}>Default bill / hour</label><input type="number" min={0} step="0.01" className={input} value={rateForm.bill} onChange={(e) => setRateForm({ ...rateForm, bill: e.target.value })} placeholder="120.00" /></div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div><label className={label}>Effective from</label><input type="date" className={input} value={rateForm.effectiveFrom} onChange={(e) => setRateForm({ ...rateForm, effectiveFrom: e.target.value })} /></div>
                  <div><label className={label}>Note</label><input className={input} value={rateForm.note} onChange={(e) => setRateForm({ ...rateForm, note: e.target.value })} placeholder="Annual raise" /></div>
                </div>
                <p className="mt-2 text-xs text-slate-400">The current rate is closed the day before this date. History is kept, so past payroll stays correct.</p>
                {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
                <div className="mt-3 flex justify-end">
                  <button onClick={saveRate} disabled={pending} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">{pending ? "Saving…" : "Set rate"}</button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </Modal>

      {/* ---------------- bill rate modal ---------------- */}
      <Modal open={billOpen} onClose={() => setBillOpen(false)} title="Bill rate override">
        <div className="space-y-4">
          <div>
            <label className={label}>Applies to</label>
            <div className="flex gap-1 rounded-lg border border-hairline bg-panel-2 p-1">
              {[{ v: "client", t: "A client" }, { v: "project", t: "A project" }].map((o) => (
                <button key={o.v} type="button" onClick={() => setBillForm({ ...billForm, anchor: o.v, clientId: "", projectId: "" })}
                  className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${billForm.anchor === o.v ? "bg-panel text-slate-900 shadow-sm ring-1 ring-hairline" : "text-slate-500 hover:text-slate-800"}`}>
                  {o.t}
                </button>
              ))}
            </div>
          </div>

          {billForm.anchor === "client" ? (
            <div>
              <label className={label}>Client</label>
              <select className={input} value={billForm.clientId} onChange={(e) => setBillForm({ ...billForm, clientId: e.target.value })}>
                <option value="">Select a client…</option>
                {clients.filter((c) => c.status === "ACTIVE").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label className={label}>Project</label>
              <select className={input} value={billForm.projectId} onChange={(e) => setBillForm({ ...billForm, projectId: e.target.value })}>
                <option value="">Select a project…</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.clientName ? ` · ${p.clientName}` : ""}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className={label}>Person (optional)</label>
            <select className={input} value={billForm.employeeId} onChange={(e) => setBillForm({ ...billForm, employeeId: e.target.value })}>
              <option value="">Anyone on it</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-slate-400">Narrow the override to one person; otherwise it applies to everyone.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Rate / hour</label><input type="number" min={0} step="0.01" className={input} value={billForm.rate} onChange={(e) => setBillForm({ ...billForm, rate: e.target.value })} placeholder="150.00" /></div>
            <div><label className={label}>Effective from</label><input type="date" className={input} value={billForm.effectiveFrom} onChange={(e) => setBillForm({ ...billForm, effectiveFrom: e.target.value })} /></div>
          </div>
          <div><label className={label}>Note</label><input className={input} value={billForm.note} onChange={(e) => setBillForm({ ...billForm, note: e.target.value })} placeholder="Acme MSA rate" /></div>

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setBillOpen(false)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={saveBillRate} disabled={pending} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">{pending ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
