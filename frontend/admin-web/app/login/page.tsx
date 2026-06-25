"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Lock, Mail, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Login failed.");
        setBusy(false);
        return;
      }
      const from = params.get("from");
      router.replace(from && from.startsWith("/") ? from : "/");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-brand/10 text-brand ring-1 ring-inset ring-brand/30">
            <ShieldCheck className="size-6" />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">RetainIQ Super Admin</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to the platform console</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-2xl border border-hairline bg-panel/80 p-6 shadow-[0_1px_2px_0_rgba(15,23,42,0.04),0_12px_28px_-18px_rgba(15,23,42,0.16)] backdrop-blur"
        >
          {error ? (
            <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700">{error}</p>
          ) : null}

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">Email</span>
            <span className="flex items-center gap-2 rounded-xl border border-hairline bg-panel-2/60 px-3 py-2.5 focus-within:ring-2 focus-within:ring-brand/30">
              <Mail className="size-4 text-slate-400" />
              <input
                type="email"
                required
                autoFocus
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@retainiq.com"
                className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />
            </span>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">Password</span>
            <span className="flex items-center gap-2 rounded-xl border border-hairline bg-panel-2/60 px-3 py-2.5 focus-within:ring-2 focus-within:ring-brand/30">
              <Lock className="size-4 text-slate-400" />
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
                className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />
            </span>
          </label>

          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-soft disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-400">Platform owners only. Org members sign in elsewhere.</p>
      </div>
    </main>
  );
}
