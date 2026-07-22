"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Loader2, Lock, Mail, RotateCcw, type LucideIcon } from "lucide-react";

export function LoginForm({ platformName, logoUrl }: { platformName: string; logoUrl?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"signin" | "forgot" | "reset">("signin");
  /**
   * Per-field messages for things the form itself can judge — a blank box, a
   * malformed address, passwords that don't match.
   *
   * Never for authentication failures: "wrong password" would confirm the email
   * exists. Those stay a single generic banner, matching the API, which answers
   * identically whether or not the account is real.
   */
  const [fields, setFields] = useState<Record<string, string>>({});

  const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

  /** Only shape checks — nothing that depends on whether the account exists. */
  function validate(): Record<string, string> {
    const f: Record<string, string> = {};
    if (!email.trim()) f.email = "Email is required.";
    else if (!isEmail(email)) f.email = "Enter a valid email address.";

    if (mode === "signin" && !password) f.password = "Password is required.";

    if (mode === "reset") {
      if (!resetToken.trim()) f.resetToken = "Paste the reset token you were given.";
      if (!newPassword) f.newPassword = "New password is required.";
      else if (newPassword.length < 12) f.newPassword = "Use at least 12 characters.";
      if (!confirmPassword) f.confirmPassword = "Confirm your new password.";
      else if (newPassword && newPassword !== confirmPassword) f.confirmPassword = "Passwords do not match.";
    }
    return f;
  }

  /** Clear a field's error the moment it's edited — stale red is its own problem. */
  const edit = (key: string, set: (v: string) => void) => (v: string) => {
    set(v);
    if (fields[key]) setFields((prev) => ({ ...prev, [key]: "" }));
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

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
      if (mode === "forgot") {
        const res = await fetch("/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; resetToken?: string; message?: string };
        if (!res.ok) {
          setError(data.error ?? "Unable to start password reset.");
          setBusy(false);
          return;
        }
        setSuccess(data.message ?? "Reset instructions are ready.");
        setResetToken(data.resetToken ?? "");
        setMode("reset");
        setBusy(false);
        return;
      }

      if (mode === "reset") {
        const res = await fetch("/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, token: resetToken, newPassword }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        if (!res.ok) {
          setError(data.error ?? "Unable to reset password.");
          setBusy(false);
          return;
        }
        setSuccess(data.message ?? "Password reset complete. You can sign in now.");
        setMode("signin");
        setPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setResetToken("");
        setBusy(false);
        return;
      }

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
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={platformName} className="size-12 rounded-2xl object-cover ring-1 ring-inset ring-brand/20" />
          ) : (
            <span className="grid size-12 place-items-center rounded-2xl bg-brand/10 text-brand ring-1 ring-inset ring-brand/30">
              <Building2 className="size-6" />
            </span>
          )}
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">Sign in to {platformName}</h1>
          <p className="mt-1 text-sm text-slate-500">Your organization workspace</p>
        </div>

        {/* noValidate: use our own messages rather than the browser's native
            popups, so wording and placement match the rest of the app. */}
        <form
          onSubmit={onSubmit}
          noValidate
          className="space-y-4 rounded-2xl border border-hairline bg-panel/80 p-6 shadow-[0_1px_2px_0_rgba(15,23,42,0.04),0_12px_28px_-18px_rgba(15,23,42,0.16)] backdrop-blur"
        >
          {error ? (
            <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
          {success ? (
            <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
              {success}
            </p>
          ) : null}

          <Field
            label="Work email"
            icon={Mail}
            type="email"
            autoFocus
            autoComplete="username"
            value={email}
            onChange={edit("email", setEmail)}
            placeholder="you@company.com"
            error={fields.email}
          />

          {mode === "signin" ? (
            <Field
              label="Password"
              icon={Lock}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={edit("password", setPassword)}
              placeholder="••••••••••"
              error={fields.password}
            />
          ) : null}

          {mode === "reset" ? (
            <>
              <Field
                label="Reset token"
                icon={RotateCcw}
                value={resetToken}
                onChange={edit("resetToken", setResetToken)}
                placeholder="Paste the reset token"
                error={fields.resetToken}
              />
              <Field
                label="New password"
                icon={Lock}
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={edit("newPassword", setNewPassword)}
                placeholder="Minimum 12 characters"
                error={fields.newPassword}
              />
              <Field
                label="Confirm password"
                icon={Lock}
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={edit("confirmPassword", setConfirmPassword)}
                placeholder="Re-enter new password"
                error={fields.confirmPassword}
              />
            </>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-soft disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {busy ? (mode === "forgot" ? "Sending…" : mode === "reset" ? "Resetting…" : "Signing in…") : mode === "forgot" ? "Send reset link" : mode === "reset" ? "Reset password" : "Sign in"}
          </button>
        </form>

        <div className="mt-4 text-center text-sm">
          {mode === "signin" ? (
            <button type="button" className="text-brand hover:underline" onClick={() => { setMode("forgot"); setError(null); setSuccess(null); }}>
              Forgot password?
            </button>
          ) : (
            <button type="button" className="text-brand hover:underline" onClick={() => { setMode("signin"); setError(null); setSuccess(null); setResetToken(""); setNewPassword(""); setConfirmPassword(""); }}>
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

/**
 * A labelled input with a leading icon. Every field on this form is mandatory,
 * so each carries a visible asterisk — the HTML `required` attribute alone tells
 * a sighted user nothing until they try to submit.
 */
function Field({
  label,
  icon: Icon,
  value,
  onChange,
  type = "text",
  placeholder,
  autoComplete,
  autoFocus,
  error,
}: {
  label: string;
  icon: LucideIcon;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  error?: string;
}) {
  const id = `l-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="block">
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-slate-600">
        {label}
        <span className="ml-0.5 text-rose-600" aria-hidden="true">
          *
        </span>
      </label>
      <span
        className={`flex items-center gap-2 rounded-xl border bg-panel-2/60 px-3 py-2.5 focus-within:ring-2 ${
          error ? "border-rose-400 focus-within:ring-rose-400/30" : "border-hairline focus-within:ring-brand/30"
        }`}
      >
        <Icon className="size-4 text-slate-400" />
        <input
          id={id}
          type={type}
          required
          aria-required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
        />
      </span>
      {error ? (
        <p id={`${id}-err`} className="mt-1 text-xs text-rose-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
