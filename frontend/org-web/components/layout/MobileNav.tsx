"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Menu } from "lucide-react";

const MobileNavContext = createContext<{ open: boolean; setOpen: (v: boolean) => void } | null>(null);

/** Shares the sidebar drawer's open/close state between the Topbar button and the Sidebar. */
export function MobileNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <MobileNavContext.Provider value={{ open, setOpen }}>{children}</MobileNavContext.Provider>;
}

export function useMobileNav() {
  const ctx = useContext(MobileNavContext);
  if (!ctx) throw new Error("useMobileNav must be used within MobileNavProvider");
  return ctx;
}

/** Hamburger toggle — visible only below `lg`. Opens the sidebar drawer. */
export function MobileMenuButton() {
  const { setOpen } = useMobileNav();
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Open navigation menu"
      className="-ml-1 inline-grid size-9 shrink-0 place-items-center rounded-xl border border-hairline bg-panel text-slate-600 transition-colors hover:bg-panel-2 lg:hidden"
    >
      <Menu className="size-5" />
    </button>
  );
}
