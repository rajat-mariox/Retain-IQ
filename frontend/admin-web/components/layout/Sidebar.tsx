"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { ShieldCheck, X } from "lucide-react";
import { NAV_ITEMS } from "@/lib/nav";
import { cn } from "@/lib/cn";
import { useMobileNav } from "./MobileNav";

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function Sidebar({
  platformName = "RetainIQ",
  featureFlags = {},
  logoUrl,
}: {
  platformName?: string;
  featureFlags?: Record<string, boolean>;
  logoUrl?: string;
}) {
  const pathname = usePathname();
  const { open, setOpen } = useMobileNav();
  const navItems = NAV_ITEMS.filter((item) => !item.flag || featureFlags[item.flag] !== false);

  // Close the drawer after navigating.
  useEffect(() => {
    setOpen(false);
  }, [pathname, setOpen]);

  // While open on mobile: close on Escape and lock background scroll.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, setOpen]);

  return (
    <>
      {/* Mobile backdrop */}
      {open ? (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-hairline bg-panel px-4 py-5 transition-transform duration-200 ease-out lg:z-30 lg:bg-panel/60 lg:backdrop-blur",
          open ? "translate-x-0" : "-translate-x-full",
          "lg:translate-x-0",
        )}
      >
        <div className="flex items-center justify-between gap-2.5 px-2">
          <div className="flex min-w-0 items-center gap-2.5">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={platformName} className="size-9 shrink-0 rounded-xl object-cover ring-1 ring-inset ring-brand/20" />
            ) : (
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand/15 text-brand ring-1 ring-inset ring-brand/30">
                <ShieldCheck className="size-5" />
              </span>
            )}
            <div className="leading-tight">
              <p className="truncate text-sm font-semibold text-slate-900">{platformName}</p>
              <p className="text-[11px] font-medium uppercase tracking-wider text-brand-soft">Super Admin</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation menu"
            className="-mr-1 inline-grid size-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 lg:hidden"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="mt-7 flex flex-1 flex-col gap-1">
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Platform</p>
          {navItems.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-brand/10 text-brand ring-1 ring-inset ring-brand/20"
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
    </>
  );
}
