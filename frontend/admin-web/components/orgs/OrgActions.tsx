"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, CircleCheck, Loader2, Pencil, Trash2, X } from "lucide-react";

interface Org {
  id: string;
  name: string;
  status: string;
  region?: string;
  timezone?: string;
}

type Mode = "idle" | "edit" | "confirmDelete";

export function OrgActions({ org }: { org: Org }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState<null | "edit" | "status" | "delete">(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(org.name);
  const [region, setRegion] = useState(org.region ?? "");
  const [timezone, setTimezone] = useState(org.timezone ?? "");

  const isActive = org.status === "ACTIVE";

  async function call(method: "PATCH" | "DELETE", body?: unknown): Promise<boolean> {
    setError(null);
    const res = await fetch(`/api/admin/organizations/${org.id}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Something went wrong.");
      return false;
    }
    return true;
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    setBusy("edit");
    try {
      if (await call("PATCH", { name, region: region || undefined, timezone: timezone || undefined })) {
        setMode("idle");
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function toggleStatus() {
    setBusy("status");
    try {
      if (await call("PATCH", { status: isActive ? "SUSPENDED" : "ACTIVE" })) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    try {
      if (await call("DELETE")) router.push("/organizations");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => { setMode(mode === "edit" ? "idle" : "edit"); setError(null); }}
          className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-panel px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-panel-2"
        >
          <Pencil className="size-3.5" /> Edit
        </button>
        <button
          type="button"
          onClick={toggleStatus}
          disabled={busy === "status"}
          className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-medium disabled:opacity-60 ${
            isActive
              ? "border-amber-500/30 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15"
          }`}
        >
          {busy === "status" ? <Loader2 className="size-3.5 animate-spin" /> : isActive ? <Ban className="size-3.5" /> : <CircleCheck className="size-3.5" />}
          {isActive ? "Suspend" : "Activate"}
        </button>
        <button
          type="button"
          onClick={() => { setMode("confirmDelete"); setError(null); }}
          className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-500/15"
        >
          <Trash2 className="size-3.5" /> Delete
        </button>
      </div>

      {error ? <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-700">{error}</p> : null}

      {mode === "edit" ? (
        <form onSubmit={saveEdit} className="w-80 space-y-3 rounded-2xl border border-hairline bg-panel/90 p-4 text-left shadow-lg">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Edit organization</h3>
            <button type="button" onClick={() => setMode("idle")} className="text-slate-400 hover:text-slate-700"><X className="size-4" /></button>
          </div>
          <Field label="Name" value={name} onChange={setName} required />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Region" value={region} onChange={setRegion} placeholder="ap-south-1" />
            <Field label="Timezone" value={timezone} onChange={setTimezone} placeholder="Asia/Kolkata" />
          </div>
          <button
            type="submit"
            disabled={busy === "edit"}
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-soft disabled:opacity-60"
          >
            {busy === "edit" ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-4" />} Save changes
          </button>
        </form>
      ) : null}

      {mode === "confirmDelete" ? (
        <div className="w-80 space-y-3 rounded-2xl border border-rose-500/30 bg-panel/90 p-4 text-left shadow-lg">
          <p className="text-sm font-semibold text-slate-900">Delete {org.name}?</p>
          <p className="text-xs text-slate-600">
            The organization is removed from the dashboards and its members can no longer sign in. This is a soft delete — data is
            retained, not destroyed.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={remove}
              disabled={busy === "delete"}
              className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
            >
              {busy === "delete" ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Delete
            </button>
            <button type="button" onClick={() => setMode("idle")} className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900">
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, required }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <input
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-hairline bg-panel-2/60 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand/30"
      />
    </label>
  );
}
