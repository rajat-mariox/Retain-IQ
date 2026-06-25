"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { NAV_ITEMS } from "@/lib/nav";
import { cn } from "@/lib/cn";

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-hairline bg-panel/60 px-4 py-5 backdrop-blur lg:flex">
      <div className="flex items-center gap-2.5 px-2">
        <span className="grid size-9 place-items-center rounded-xl bg-brand/15 text-brand ring-1 ring-inset ring-brand/30">
          <ShieldCheck className="size-5" />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-slate-900">RetainIQ</p>
          <p className="text-[11px] font-medium uppercase tracking-wider text-brand-soft">Super Admin</p>
        </div>
      </div>

      <nav className="mt-7 flex flex-1 flex-col gap-1">
        <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Platform</p>
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-brand/10 text-indigo-700 ring-1 ring-inset ring-brand/20"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <item.icon className={cn("size-4.5", active ? "text-brand-soft" : "text-slate-500 group-hover:text-slate-700")} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="rounded-xl border border-hairline bg-panel-2/60 p-3">
        <p className="text-xs font-medium text-slate-700">Mock data</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
          Figures are generated locally. Swap <code className="text-slate-600">lib/data/*</code> for the admin API.
        </p>
      </div>
    </aside>
  );
}
