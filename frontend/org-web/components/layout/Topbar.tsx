import { getSession } from "@/lib/api";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { MobileMenuButton } from "@/components/layout/MobileNav";
import { NotificationBell } from "@/components/notifications/NotificationBell";

interface TopbarProps {
  title: string;
  subtitle?: string;
}

export async function Topbar({ title, subtitle }: TopbarProps) {
  const session = await getSession().catch(() => null);
  const name = session?.employee
    ? `${session.employee.firstName} ${session.employee.lastName}`.trim()
    : (session?.user.email ?? "User");
  const role = session?.role.name ?? "Member";
  const initials =
    name
      .split(/[\s@.]+/)
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "U";

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-hairline bg-canvas/70 px-5 py-4 backdrop-blur lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <MobileMenuButton />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle ? <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p> : null}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <NotificationBell />
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
