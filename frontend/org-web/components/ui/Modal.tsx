"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

const SIZE: Record<string, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

/** Accessible centered modal: dimmed backdrop, click-outside / Escape to close, body-scroll lock. */
export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  // Portal to <body> so the fixed overlay escapes any ancestor stacking context
  // (a parent with transform/filter/backdrop-filter would otherwise trap it).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal>
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      {/* Cap the whole dialog at the viewport and let the BODY scroll, so the
          header and footer stay put for tall content (long forms, permission
          lists) instead of the modal overflowing off-screen. */}
      <div className={cn("relative z-10 flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-hairline bg-panel shadow-2xl", SIZE[size])}>
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-hairline px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 transition-colors hover:text-slate-700">
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
