"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      title="Sign out"
      aria-label="Sign out"
      className="grid size-9 place-items-center rounded-xl border border-hairline bg-panel/70 text-slate-600 transition-colors hover:text-rose-600 disabled:opacity-60"
    >
      <LogOut className="size-4.5" />
    </button>
  );
}
