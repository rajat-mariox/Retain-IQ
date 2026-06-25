"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, Copy, Loader2, X } from "lucide-react";

export function AddOrgForm({ plans }: { plans: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerFirstName, setFirst] = useState("");
  const [ownerLastName, setLast] = useState("");
  const [planId, setPlanId] = useState(plans.find((p) => p.id === "starter")?.id ?? plans[0]?.id ?? "");
  const [seats, setSeats] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ org: string; email: string; tempPassword: string; plan?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgName, ownerEmail, ownerFirstName, ownerLastName, planId, seats: Number(seats) || 10 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not create organization.");
        return;
      }
      setResult({ org: data.org.name, email: data.owner.email, tempPassword: data.owner.tempPassword, plan: data.plan?.name });
      setOrgName(""); setOwnerEmail(""); setFirst(""); setLast("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => { setOpen(true); setResult(null); }}
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-soft"
        >
          <Building2 className="size-4" /> Add organization
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-hairline bg-panel/80 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Provision organization</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="size-4" /></button>
      </div>

      {result ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800">
            <Check className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">{result.org} created{result.plan ? ` on the ${result.plan} plan` : ""}.</p>
              <p className="mt-1 text-emerald-700">Send the owner ({result.email}) this temporary password — they'll set a new one on first login:</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="rounded-lg bg-panel px-2.5 py-1 font-mono text-slate-900 ring-1 ring-inset ring-hairline">{result.tempPassword}</code>
                <button
                  type="button"
                  onClick={() => { navigator.clipboard.writeText(result.tempPassword); setCopied(true); }}
                  className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-900"
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          </div>
          <button type="button" onClick={() => { setResult(null); setCopied(false); }} className="text-sm font-medium text-brand hover:text-brand-soft">Add another</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          {error ? <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
          <Input label="Organization name" value={orgName} onChange={setOrgName} required />
          <Input label="Owner email" type="email" value={ownerEmail} onChange={setOwnerEmail} required />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Owner first name" value={ownerFirstName} onChange={setFirst} required />
            <Input label="Owner last name" value={ownerLastName} onChange={setLast} required />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Subscription plan</span>
              <select
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                className="w-full rounded-xl border border-hairline bg-panel-2/60 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand/30"
              >
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <Input label="Seats" type="number" value={seats} onChange={setSeats} required />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-soft disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Building2 className="size-4" />} Create organization
          </button>
        </form>
      )}
    </div>
  );
}

function Input({ label, value, onChange, type = "text", required }: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-hairline bg-panel-2/60 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand/30"
      />
    </label>
  );
}
