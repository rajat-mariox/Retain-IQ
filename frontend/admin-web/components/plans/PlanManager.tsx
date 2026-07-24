"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import type { AdminPlan } from "@/lib/plans-api";

// Features that can be mapped onto a plan. `unlocks` ones actually gate a
// product feature — a plan must include them for the org to use that feature
// (time_tracking → Time Tracking, ai_analytics → AI Insights). The rest are
// descriptive (shown on the plan, no enforcement).
const FEATURES: { key: string; label: string; unlocks?: string }[] = [
  { key: "core", label: "Core" },
  { key: "time_tracking", label: "Time tracking", unlocks: "Time Tracking" },
  { key: "ai_analytics", label: "AI analytics", unlocks: "AI Insights" },
  { key: "monitoring", label: "Employee monitoring", unlocks: "Employee Monitoring" },
  { key: "recruitment", label: "HR Suite", unlocks: "HR Suite (Hiring, Onboarding, Performance)" },
  { key: "attendance", label: "Attendance" },
  { key: "screenshots", label: "Screenshots" },
  { key: "sso", label: "SSO" },
  { key: "priority_support", label: "Priority support" },
];
const FEATURE_LABEL = Object.fromEntries(FEATURES.map((f) => [f.key, f.label]));

interface Form {
  id: string;
  name: string;
  description: string;
  priceDollars: string;
  billingPeriod: string;
  seatLimit: string;
  storageGb: string;
  features: string[];
  color: string;
  sortOrder: string;
  isActive: boolean;
}

const emptyForm = (): Form => ({
  id: "",
  name: "",
  description: "",
  priceDollars: "0",
  billingPeriod: "monthly",
  seatLimit: "",
  storageGb: "",
  features: ["core"],
  color: "#1f883d",
  sortOrder: "0",
  isActive: true,
});

const planToForm = (p: AdminPlan): Form => ({
  id: p.id,
  name: p.name,
  description: p.description ?? "",
  priceDollars: String(p.pricePerSeat / 100),
  billingPeriod: p.billingPeriod,
  seatLimit: p.seatLimit == null ? "" : String(p.seatLimit),
  storageGb: p.storageLimitMb == null ? "" : String(p.storageLimitMb / 1024),
  features: [...p.features],
  color: p.color,
  sortOrder: String(p.sortOrder),
  isActive: p.isActive,
});

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const limitLabel = (n: number | null, unit: string) => (n == null ? "Unlimited" : `${n.toLocaleString()} ${unit}`);

export function PlanManager({ plans }: { plans: AdminPlan[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<null | "new" | string>(null);
  const [form, setForm] = useState<Form>(emptyForm());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminPlan | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  /** Per-field messages, keyed like the API's `path` so server errors map straight on. */
  const [fields, setFields] = useState<Record<string, string>>({});

  /** Setting a field clears its error — stale red is its own problem. */
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (fields[k as string]) setFields((prev) => ({ ...prev, [k as string]: "" }));
  };
  const toggleFeature = (key: string) =>
    setForm((f) => ({ ...f, features: f.features.includes(key) ? f.features.filter((x) => x !== key) : [...f.features, key] }));

  /** Catch what we can before a round-trip; the server still validates everything. */
  function validate(isNew: boolean): Record<string, string> {
    const f: Record<string, string> = {};
    if (isNew) {
      if (!form.id.trim()) f.id = "Plan id is required.";
      // The id becomes part of URLs and billing records — keep it a safe slug.
      else if (!/^[a-z0-9][a-z0-9_-]*$/.test(form.id.trim())) f.id = "Use lowercase letters, numbers, dashes or underscores.";
    }
    if (!form.name.trim()) f.name = "Name is required.";
    const price = Number(form.priceDollars);
    if (form.priceDollars.trim() === "") f.priceDollars = "Price is required — use 0 for a free plan.";
    else if (!Number.isFinite(price) || price < 0) f.priceDollars = "Price must be 0 or more.";
    if (form.seatLimit.trim() !== "" && (!Number.isInteger(Number(form.seatLimit)) || Number(form.seatLimit) < 1)) {
      f.seatLimit = "Seat limit must be a whole number of 1 or more, or blank for unlimited.";
    }
    if (form.storageGb.trim() !== "" && (!Number.isFinite(Number(form.storageGb)) || Number(form.storageGb) < 0)) {
      f.storageGb = "Storage must be 0 or more, or blank for unlimited.";
    }
    return f;
  }

  function openCreate() {
    setForm(emptyForm());
    setError(null);
    setFields({});
    setEditing("new");
  }
  function openEdit(p: AdminPlan) {
    setForm(planToForm(p));
    setError(null);
    setFields({});
    setEditing(p.id);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const found = validate(editing === "new");
    if (Object.keys(found).length > 0) {
      setFields(found);
      const count = Object.keys(found).length;
      setError(count === 1 ? Object.values(found)[0] : `Fix ${count} fields below to continue.`);
      return;
    }
    setFields({});

    setBusy(true);
    const payload = {
      name: form.name,
      description: form.description.trim() || undefined,
      pricePerSeat: Math.round(Number(form.priceDollars || 0) * 100),
      billingPeriod: form.billingPeriod,
      seatLimit: form.seatLimit.trim() === "" ? null : Math.round(Number(form.seatLimit)),
      storageLimitMb: form.storageGb.trim() === "" ? null : Math.round(Number(form.storageGb) * 1024),
      features: form.features,
      color: form.color,
      sortOrder: Number(form.sortOrder || 0),
      isActive: form.isActive,
    };
    const isNew = editing === "new";
    try {
      const res = await fetch(isNew ? "/api/admin/plans" : `/api/admin/plans/${editing}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isNew ? { id: form.id, ...payload } : payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not save plan.");
        return;
      }
      setEditing(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function askDelete(p: AdminPlan) {
    setDeleteTarget(p);
    setDeleteError(null);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/plans/${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteError(data.error ?? "Could not delete plan.");
        return;
      }
      setDeleteTarget(null);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-soft"
        >
          <Plus className="size-4" /> New plan
        </button>
      </div>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Create plan" : `Edit ${form.name}`} size="lg">
        <form onSubmit={submit} noValidate className="space-y-4">
          <p className="text-xs text-slate-400">
            Fields marked <span className="text-rose-600">*</span> are required.
          </p>
          {error ? (
            <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {editing === "new" ? (
              <Field label="Plan id" hint="lowercase, e.g. team" required error={fields.id}>
                <input value={form.id} onChange={(e) => set("id", e.target.value)} className={fields.id ? `${inputCls} border-rose-400` : inputCls} placeholder="team" />
              </Field>
            ) : (
              // The id is baked into subscriptions and URLs — it can't be changed after creation.
              <Field label="Plan id" hint="can't be changed"><input value={form.id} disabled className={`${inputCls} opacity-60`} /></Field>
            )}
            <Field label="Name" required error={fields.name}>
              <input value={form.name} onChange={(e) => set("name", e.target.value)} className={fields.name ? `${inputCls} border-rose-400` : inputCls} />
            </Field>
          </div>

          <Field label="Description">
            <input value={form.description} onChange={(e) => set("description", e.target.value)} className={inputCls} placeholder="Optional" />
          </Field>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Price / seat (USD)" required error={fields.priceDollars}>
              <input type="number" min="0" step="0.01" value={form.priceDollars} onChange={(e) => set("priceDollars", e.target.value)} className={fields.priceDollars ? `${inputCls} border-rose-400` : inputCls} />
            </Field>
            <Field label="Billing period">
              <select value={form.billingPeriod} onChange={(e) => set("billingPeriod", e.target.value)} className={inputCls}>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </Field>
            <Field label="Seat limit" hint="blank = ∞" error={fields.seatLimit}>
              <input type="number" min="1" value={form.seatLimit} onChange={(e) => set("seatLimit", e.target.value)} className={fields.seatLimit ? `${inputCls} border-rose-400` : inputCls} placeholder="Unlimited" />
            </Field>
            <Field label="Storage (GB)" hint="blank = ∞" error={fields.storageGb}>
              <input type="number" min="0" value={form.storageGb} onChange={(e) => set("storageGb", e.target.value)} className={fields.storageGb ? `${inputCls} border-rose-400` : inputCls} placeholder="Unlimited" />
            </Field>
          </div>

          {/* Feature mapping */}
          <Field label="Features">
            <p className="mb-2 text-xs text-slate-500">
              A ★ feature actually unlocks a product module for orgs on this plan — without it, they can't turn that module on. The rest describe the plan.
            </p>
            <div className="flex flex-wrap gap-2">
              {FEATURES.map((f) => {
                const on = form.features.includes(f.key);
                return (
                  <button
                    key={f.key}
                    type="button"
                    title={f.unlocks ? `Unlocks "${f.unlocks}" for orgs on this plan` : "Descriptive — shown on the plan"}
                    onClick={() => toggleFeature(f.key)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      on ? "border-brand/30 bg-brand/10 text-brand" : "border-hairline bg-panel-2 text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {on ? <Check className="size-3.5" /> : <Plus className="size-3.5" />} {f.unlocks ? "★ " : ""}{f.label}
                  </button>
                );
              })}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Accent color">
              <input type="color" value={form.color} onChange={(e) => set("color", e.target.value)} className="h-9 w-full rounded-xl border border-hairline bg-panel-2/60 px-1" />
            </Field>
            <Field label="Sort order"><input type="number" min="0" value={form.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} className={inputCls} /></Field>
            <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} className="size-4 rounded border-hairline" />
              Active
            </label>
          </div>

          <div className="flex justify-end gap-2 border-t border-hairline pt-4">
            <button type="button" onClick={() => setEditing(null)} className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900">
              Cancel
            </button>
            <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-soft disabled:opacity-60">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} {editing === "new" ? "Create plan" : "Save changes"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Plan cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((p) => (
          <div key={p.id} className="flex flex-col rounded-2xl border border-hairline bg-panel/80">
            <div className="h-1.5 rounded-t-2xl" style={{ backgroundColor: p.color }} />
            <div className="flex flex-1 flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900">{p.name}</p>
                  <p className="text-xs text-slate-500">{p.id}{p.isActive ? "" : " · inactive"}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => openEdit(p)} aria-label="Edit" className="grid size-7 place-items-center rounded-lg border border-hairline text-slate-500 hover:bg-panel-2"><Pencil className="size-3.5" /></button>
                  <button type="button" onClick={() => askDelete(p)} aria-label="Delete" className="grid size-7 place-items-center rounded-lg border border-rose-500/30 text-rose-600 hover:bg-rose-500/10"><Trash2 className="size-3.5" /></button>
                </div>
              </div>
              <p className="text-2xl font-semibold tabular-nums text-slate-900">
                {p.pricePerSeat === 0 ? "Free" : usd(p.pricePerSeat)}
                {p.pricePerSeat > 0 ? <span className="text-sm font-normal text-slate-500"> /seat/{p.billingPeriod === "yearly" ? "yr" : "mo"}</span> : null}
              </p>
              <dl className="space-y-1 text-xs text-slate-500">
                <div className="flex justify-between"><dt>Seats</dt><dd className="text-slate-700">{limitLabel(p.seatLimit, "seats")}</dd></div>
                <div className="flex justify-between"><dt>Storage</dt><dd className="text-slate-700">{p.storageLimitMb == null ? "Unlimited" : `${(p.storageLimitMb / 1024).toLocaleString()} GB`}</dd></div>
              </dl>
              <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
                {p.features.length === 0 ? <span className="text-xs text-slate-400">No features</span> : null}
                {p.features.map((k) => (
                  <span key={k} className="rounded-full bg-panel-2 px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-inset ring-hairline">
                    {FEATURE_LABEL[k] ?? k}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Delete confirmation */}
      <Modal open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Delete plan" size="sm">
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-rose-500/10 text-rose-600">
              <AlertTriangle className="size-5" />
            </span>
            <p className="text-sm text-slate-600">
              Delete the <span className="font-semibold text-slate-900">{deleteTarget?.name}</span> plan? This can’t be undone. Plans
              with active subscriptions can’t be deleted.
            </p>
          </div>
          {deleteError ? <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700">{deleteError}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDeleteTarget(null)} className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900">
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={deleting}
              className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Delete plan
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-hairline bg-panel-2/60 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand/30";

/**
 * A labelled field. Required ones carry a visible asterisk — the HTML `required`
 * attribute alone tells a sighted user nothing until they try to submit — and an
 * error shows against the field rather than only in the banner.
 */
function Field({
  label,
  hint,
  required,
  error,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
        {label}
        {required ? (
          <span className="-ml-1 text-rose-600" aria-hidden="true">
            *
          </span>
        ) : null}
        {hint ? <span className="text-slate-400">· {hint}</span> : null}
      </span>
      {children}
      {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
    </label>
  );
}
