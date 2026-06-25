"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, Lock } from "lucide-react";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 12) return setError("New password must be at least 12 characters.");
    if (newPassword !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not change password.");
        setBusy(false);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-brand/10 text-brand ring-1 ring-inset ring-brand/30">
            <KeyRound className="size-6" />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">Set a new password</h1>
          <p className="mt-1 text-sm text-slate-500">You're using a temporary password — choose a new one to continue.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-hairline bg-panel/80 p-6 shadow-[0_1px_2px_0_rgba(15,23,42,0.04),0_12px_28px_-18px_rgba(15,23,42,0.16)] backdrop-blur">
          {error ? <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
          <PasswordField label="Temporary password" value={currentPassword} onChange={setCurrent} autoFocus autoComplete="current-password" />
          <PasswordField label="New password" value={newPassword} onChange={setNew} autoComplete="new-password" hint="At least 12 characters" />
          <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-soft disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {busy ? "Saving…" : "Set password & continue"}
          </button>
        </form>
      </div>
    </main>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  hint,
  autoFocus,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  autoFocus?: boolean;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-600">{label}</span>
      <span className="flex items-center gap-2 rounded-xl border border-hairline bg-panel-2/60 px-3 py-2.5 focus-within:ring-2 focus-within:ring-brand/30">
        <Lock className="size-4 text-slate-400" />
        <input
          type="password"
          required
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="••••••••••"
          className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
        />
      </span>
      {hint ? <span className="mt-1 block text-[11px] text-slate-400">{hint}</span> : null}
    </label>
  );
}
