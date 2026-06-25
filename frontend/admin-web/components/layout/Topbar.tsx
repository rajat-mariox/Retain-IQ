import { cookies } from "next/headers";
import { Bell, Search } from "lucide-react";
import { ACCESS_COOKIE, decodeClaims } from "@/lib/auth";
import { LogoutButton } from "@/components/auth/LogoutButton";

interface TopbarProps {
  title: string;
  subtitle?: string;
}

function titleCase(role: string): string {
  return role
    .split("_")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

export async function Topbar({ title, subtitle }: TopbarProps) {
  const claims = decodeClaims((await cookies()).get(ACCESS_COOKIE)?.value);
  const name = claims?.name ?? "Admin";
  const role = claims?.role ? titleCase(claims.role) : "Platform Owner";
  const initials =
    name
      .split(" ")
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "AD";

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-hairline bg-canvas/70 px-5 py-4 backdrop-blur lg:px-8">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-2 rounded-xl border border-hairline bg-panel/70 px-3 py-2 text-sm text-slate-500 md:flex">
          <Search className="size-4" />
          <input
            placeholder="Search organizations…"
            className="w-48 bg-transparent text-slate-800 placeholder:text-slate-400 focus:outline-none"
          />
          <kbd className="rounded border border-hairline px-1.5 text-[10px] text-slate-500">⌘K</kbd>
        </div>

        <button
          type="button"
          className="grid size-9 place-items-center rounded-xl border border-hairline bg-panel/70 text-slate-600 transition-colors hover:text-slate-900"
          aria-label="Notifications"
        >
          <Bell className="size-4.5" />
        </button>

        <div className="flex items-center gap-2.5 rounded-xl border border-hairline bg-panel/70 py-1 pl-1 pr-3">
          <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-emerald-500 to-green-600 text-xs font-semibold text-white">
            {initials}
          </span>
          <div className="hidden leading-tight sm:block">
            <p className="text-xs font-semibold text-slate-800">{name}</p>
            <p className="text-[10px] text-slate-500">{role}</p>
          </div>
        </div>

        <LogoutButton />
      </div>
    </header>
  );
}
