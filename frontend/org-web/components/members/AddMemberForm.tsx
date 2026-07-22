"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, UserPlus, X } from "lucide-react";
import type { OrgDepartment, OrgRole, OrgTeam } from "@/lib/api";

type ScopeType = "SELF" | "DEPARTMENT" | "TEAM" | "ORG";

const selectCls = "w-full rounded-xl border border-hairline bg-panel-2/60 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand/30";

export function AddMemberForm({ departments, roles, teams }: { departments: OrgDepartment[]; roles: OrgRole[]; teams: OrgTeam[] }) {
  const router = useRouter();
  const activeDepts = departments.filter((d) => d.status !== "ARCHIVED");
  // Fall back to the two basic roles by name when the caller can't list org roles.
  const roleOptions = roles.length ? roles.map((r) => ({ id: r.id, name: r.name })) : [{ id: "", name: "Employee" }, { id: "", name: "Manager" }];

  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [roleName, setRoleName] = useState(roleOptions[0]?.name ?? "Employee");
  const [departmentId, setDepartmentId] = useState("");
  const [scopeType, setScopeType] = useState<ScopeType>("SELF");
  const [teamId, setTeamId] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Per-field messages, keyed like the API's `path` so server errors map straight on. */
  const [fields, setFields] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ email: string; tempPassword: string } | null>(null);
  const [copied, setCopied] = useState(false);

  /** Catch what we can before a round-trip; the server still validates everything. */
  function validate(): Record<string, string> {
    const f: Record<string, string> = {};
    if (!firstName.trim()) f.firstName = "First name is required.";
    if (!lastName.trim()) f.lastName = "Last name is required.";
    if (!email.trim()) f.email = "Work email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) f.email = "Enter a valid email address.";
    // Scoped roles are meaningless without the thing they're scoped to.
    if (scopeType === "DEPARTMENT" && !departmentId) f.scopeId = "Pick a department for this role scope.";
    if (scopeType === "TEAM" && !teamId) f.scopeId = "Pick a team for this role scope.";
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
      const picked = roleOptions.find((r) => r.name === roleName);
      const scopeId = scopeType === "DEPARTMENT" ? departmentId : scopeType === "TEAM" ? teamId : null;
      const body: Record<string, unknown> = {
        firstName,
        lastName,
        email,
        departmentId: departmentId || undefined,
        scopeType,
        scopeId: scopeId || undefined,
        title: title || undefined,
      };
      if (picked?.id) body.roleId = picked.id;
      else body.role = roleName; // legacy name fallback
      const res = await fetch("/api/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not add member.");
        setFields(data.fields ?? {});
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
        <button type="button" onClick={() => { setOpen(true); setResult(null); }} className="inline-flex items-center gap-2 rounded-xl bg-brand px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-soft">
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
              <p className="mt-1 text-emerald-700">Share this temporary password — they&apos;ll set a new one on first login:</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="rounded-lg bg-panel px-2.5 py-1 font-mono text-slate-900 ring-1 ring-inset ring-hairline">{result.tempPassword}</code>
                <button type="button" onClick={() => { navigator.clipboard.writeText(result.tempPassword); setCopied(true); }} className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-900">
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="First name" value={firstName} onChange={edit("firstName", setFirstName)} required error={fields.firstName} />
            <Input label="Last name" value={lastName} onChange={edit("lastName", setLastName)} required error={fields.lastName} />
          </div>
          <Input label="Work email" type="email" value={email} onChange={edit("email", setEmail)} required error={fields.email} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Select label="Role" value={roleName} onChange={setRoleName} options={roleOptions.map((r) => r.name)} />
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Department
                {/* Only required once the role is scoped to a department. */}
                {scopeType === "DEPARTMENT" ? <span className="ml-0.5 text-rose-600" aria-hidden="true">*</span> : null}
              </span>
              <select
                value={departmentId}
                onChange={(e) => edit("scopeId", setDepartmentId)(e.target.value)}
                aria-invalid={scopeType === "DEPARTMENT" && fields.scopeId ? true : undefined}
                className={scopeType === "DEPARTMENT" && fields.scopeId ? `${selectCls} border-rose-400` : selectCls}
              >
                <option value="">No department</option>
                {activeDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              {scopeType === "DEPARTMENT" && fields.scopeId ? <p className="mt-1 text-xs text-rose-600">{fields.scopeId}</p> : null}
            </label>
            <Input label="Title" value={title} onChange={setTitle} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Role scope</span>
              <select value={scopeType} onChange={(e) => { setScopeType(e.target.value as ScopeType); setTeamId(""); }} className={selectCls}>
                <option value="SELF">Just themselves (own data)</option>
                <option value="DEPARTMENT">Their department</option>
                <option value="TEAM">A team</option>
                <option value="ORG">Whole organization</option>
              </select>
            </label>
            {scopeType === "TEAM" ? (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  Team<span className="ml-0.5 text-rose-600" aria-hidden="true">*</span>
                </span>
                <select
                  value={teamId}
                  onChange={(e) => edit("scopeId", setTeamId)(e.target.value)}
                  aria-invalid={fields.scopeId ? true : undefined}
                  className={fields.scopeId ? `${selectCls} border-rose-400` : selectCls}
                >
                  <option value="">Select…</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                {fields.scopeId ? <p className="mt-1 text-xs text-rose-600">{fields.scopeId}</p> : null}
              </label>
            ) : null}
          </div>
          {scopeType === "DEPARTMENT" && !departmentId ? (
            <p className="text-xs text-amber-600">Pick a department above to scope the role to it.</p>
          ) : null}
          <button
            type="submit"
            disabled={busy || (scopeType === "DEPARTMENT" && !departmentId) || (scopeType === "TEAM" && !teamId)}
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-soft disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />} Create account
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * A labelled field. Required fields carry a visible asterisk (the HTML `required`
 * attribute alone tells a sighted user nothing until they try to submit), and any
 * error shows against the field rather than only at the top of the form.
 */
function Input({
  label,
  value,
  onChange,
  type = "text",
  required,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  error?: string;
}) {
  const id = `m-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
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
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={error ? `${selectCls} border-rose-400` : selectCls}
      />
      {error ? (
        <p id={`${id}-err`} className="mt-1 text-xs text-rose-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={selectCls}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
