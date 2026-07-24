"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Building2, ChevronDown, X } from "lucide-react";
import { NAV_ITEMS, isNavGroup, type NavEntry, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/cn";
import { useMobileNav } from "./MobileNav";

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

const linkClass = (active: boolean) =>
  cn(
    "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
    active ? "bg-brand/10 text-brand ring-1 ring-inset ring-brand/20" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  );
const iconClass = (active: boolean) => cn("size-4.5", active ? "text-brand-soft" : "text-slate-500 group-hover:text-slate-700");

export function Sidebar({
  orgName,
  isAdmin,
  permissions = [],
  platformName = "RetainIQ",
  featureFlags = {},
  logoUrl,
}: {
  orgName: string;
  isAdmin: boolean;
  permissions?: string[];
  platformName?: string;
  featureFlags?: Record<string, boolean>;
  logoUrl?: string;
}) {
  const pathname = usePathname();
  const { open, setOpen } = useMobileNav();
  const [groupOverrides, setGroupOverrides] = useState<Record<string, boolean>>({});
  const canDo = (p?: string) => !p || permissions.includes(p);

  const visible = (entry: { adminOnly?: boolean; employeeOnly?: boolean; flag?: string; permission?: string }) =>
    (!entry.adminOnly || isAdmin) &&
    (!entry.employeeOnly || !isAdmin) &&
    (!entry.flag || featureFlags[entry.flag] !== false) &&
    canDo(entry.permission);

  // Filter groups' children too, and drop a group once nothing inside it is visible.
  const items: NavEntry[] = NAV_ITEMS.filter(visible)
    .map((entry) => (isNavGroup(entry) ? { ...entry, children: entry.children.filter(visible) } : entry))
    .filter((entry) => !isNavGroup(entry) || entry.children.length > 0);

  // A group is open when it holds the active route, unless the user toggled it.
  const groupHasActive = (children: NavItem[]) => children.some((c) => isActive(pathname, c.href));
  const isExpanded = (label: string, children: NavItem[]) => groupOverrides[label] ?? groupHasActive(children);

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
        <div className="flex shrink-0 items-center justify-between gap-2.5 px-2">
          <div className="flex min-w-0 items-center gap-2.5">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={platformName} className="size-9 shrink-0 rounded-xl object-cover ring-1 ring-inset ring-brand/20" />
            ) : (
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand/15 text-brand ring-1 ring-inset ring-brand/30">
                <Building2 className="size-5" />
              </span>
            )}
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold text-slate-900">{orgName}</p>
              <p className="truncate text-[11px] font-medium uppercase tracking-wider text-brand-soft">{platformName}</p>
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

        <nav className="scrollbar-thin mt-7 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain pr-1">
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Workspace</p>
          {items.map((entry) => {
            if (!isNavGroup(entry)) {
              const active = isActive(pathname, entry.href);
              return (
                <Link key={entry.href} href={entry.href} onClick={() => setOpen(false)} className={linkClass(active)}>
                  <entry.icon className={iconClass(active)} />
                  {entry.label}
                </Link>
              );
            }

            const hasActive = groupHasActive(entry.children);
            const expanded = isExpanded(entry.label, entry.children);
            return (
              <div key={entry.label}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setGroupOverrides((prev) => ({ ...prev, [entry.label]: !expanded }))}
                  className={cn(
                    "group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                    hasActive && !expanded ? "text-brand" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  <entry.icon className={iconClass(hasActive && !expanded)} />
                  <span className="flex-1 text-left">{entry.label}</span>
                  <ChevronDown className={cn("size-4 shrink-0 text-slate-400 transition-transform", expanded && "rotate-180")} />
                </button>

                {expanded ? (
                  <div className="ml-5 mt-1 flex flex-col gap-1 border-l border-hairline pl-2">
                    {entry.children.map((child) => {
                      const active = isActive(pathname, child.href);
                      return (
                        <Link key={child.href} href={child.href} onClick={() => setOpen(false)} className={linkClass(active)}>
                          <child.icon className={iconClass(active)} />
                          {child.label}
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
