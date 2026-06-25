"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, UserPlus, X } from "lucide-react";

const DEPARTMENTS = ["HR", "Product", "Project", "Sales", "Developer", "UI/UX", "Finance", "Operations"];

export function AddMemberForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Employee");
  const [department, setDepartment] = useState("Product");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ email: string; tempPassword: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, role, department, title: title || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not add member.");
        return;
      }
      setResult({ email: data.employee.email, tempPassword: data.tempPassword });
      setFirstName(""); setLastName(""); setEmail(""); setTitle("");
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
          <UserPlus className="size-4" /> Add employee
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-hairline bg-panel/80 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Add employee</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="size-4" /></button>
      </div>

      {result ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800">
            <Check className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">{result.email} added.</p>
              <p className="mt-1 text-emerald-700">Share this temporary password — they'll set a new one on first login:</p>
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
          <button type="button" onClick={() => { setResult(null); setCopied(false); }} className="text-sm font-medium text-brand hover:text-brand-soft">
            Add another
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          {error ? <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="First name" value={firstName} onChange={setFirstName} required />
            <Input label="Last name" value={lastName} onChange={setLastName} required />
          </div>
          <Input label="Work email" type="email" value={email} onChange={setEmail} required />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Select label="Role" value={role} onChange={setRole} options={["Employee", "Manager"]} />
            <Select label="Department" value={department} onChange={setDepartment} options={DEPARTMENTS} />
            <Input label="Title" value={title} onChange={setTitle} />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-soft disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />} Create account
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

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-hairline bg-panel-2/60 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand/30"
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
