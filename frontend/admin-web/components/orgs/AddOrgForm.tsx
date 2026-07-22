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
  const [planId, setPlanId] = useState(plans.find((p) => p.id === "basic")?.id ?? plans[0]?.id ?? "");
  const [seats, setSeats] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Per-field messages, keyed the same as the API's `path` so server errors map straight on. */
  const [fields, setFields] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ org: string; email: string; tempPassword: string; plan?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  /** Catch what we can before a round-trip; the server still validates everything. */
  function validate(): Record<string, string> {
    const f: Record<string, string> = {};
    if (!orgName.trim()) f.orgName = "Organization name is required.";
    else if (orgName.trim().length < 2) f.orgName = "Organization name must be at least 2 characters.";
    if (!ownerEmail.trim()) f.ownerEmail = "Owner email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail.trim())) f.ownerEmail = "Enter a valid email address.";
    if (!ownerFirstName.trim()) f.ownerFirstName = "Owner first name is required.";
    if (!ownerLastName.trim()) f.ownerLastName = "Owner last name is required.";
    const n = Number(seats);
    if (!seats.trim()) f.seats = "Seats is required.";
    else if (!Number.isInteger(n) || n < 1) f.seats = "Seats must be a whole number of 1 or more.";
    return f;
  }

  /** Clear a field's error as soon as it's edited — stale red is its own problem. */
  const edit = (key: string, set: (v: string) => void) => (v: string) => {
    set(v);
    if (fields[key]) setFields((prev) => ({ ...prev, [key]: "" }));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const found = validate();
    if (Object.keys(found).length > 0) {
      setFields(found);
      const count = Object.keys(found).length;
      setError(count === 1 ? Object.values(found)[0] : `Fix ${count} fields below to continue.`);
      return;
    }
    setFields({});

    setBusy(true);
    try {
      const res = await fetch("/api/admin/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgName, ownerEmail, ownerFirstName, ownerLastName, planId, seats: Number(seats) }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string>; org?: { name: string }; owner?: { email: string; tempPassword: string }; plan?: { name: string } };
      if (!res.ok) {
        setError(data.error ?? "Could not create organization.");
        setFields(data.fields ?? {});
        return;
      }
      setResult({ org: data.org!.name, email: data.owner!.email, tempPassword: data.owner!.tempPassword, plan: data.plan?.name });
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
        <form onSubmit={submit} noValidate className="space-y-3">
          <p className="text-xs text-slate-400">
            Fields marked <span className="text-rose-600">*</span> are required.
          </p>
          {error ? (
            <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
          <Input label="Organization name" value={orgName} onChange={edit("orgName", setOrgName)} required error={fields.orgName} />
          <Input label="Owner email" type="email" value={ownerEmail} onChange={edit("ownerEmail", setOwnerEmail)} required error={fields.ownerEmail} hint="They'll get a temporary password to sign in with." />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Owner first name" value={ownerFirstName} onChange={edit("ownerFirstName", setFirst)} required error={fields.ownerFirstName} />
            <Input label="Owner last name" value={ownerLastName} onChange={edit("ownerLastName", setLast)} required error={fields.ownerLastName} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Subscription plan<span className="ml-0.5 text-rose-600" aria-hidden="true">*</span>
              </span>
              <select
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                className="w-full rounded-xl border border-hairline bg-panel-2/60 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand/30"
              >
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <Input label="Seats" type="number" min={1} value={seats} onChange={edit("seats", setSeats)} required error={fields.seats} hint="Can be raised later." />
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

/**
 * A labelled field. Required fields carry a visible asterisk (the HTML `required`
 * attribute alone tells a sighted user nothing until they try to submit), and any
 * error is shown against the field itself rather than only at the top of the form.
 */
function Input({
  label,
  value,
  onChange,
  type = "text",
  required,
  error,
  hint,
  min,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  min?: number;
}) {
  const id = `f-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="block">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">
        {label}
        {required ? (
          <span className="ml-0.5 text-rose-600" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      <input
        id={id}
        type={type}
        min={min}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-xl border bg-panel-2/60 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 ${
          error ? "border-rose-400 focus:ring-rose-400/30" : "border-hairline focus:ring-brand/30"
        }`}
      />
      {error ? (
        <p id={`${id}-err`} className="mt-1 text-xs text-rose-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
