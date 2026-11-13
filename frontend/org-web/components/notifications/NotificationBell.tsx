"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck, Volume2, VolumeX } from "lucide-react";
import { useNotifications } from "@/components/notifications/NotificationsProvider";
import { timeAgo } from "@/lib/format";

export function NotificationBell() {
  const { items, unread, soundOn, toggleSound, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const now = Date.now();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        className="relative grid size-9 place-items-center rounded-xl border border-hairline bg-panel/70 text-slate-500 transition-colors hover:text-slate-800"
      >
        <Bell className="size-[18px]" />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 grid min-w-[18px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-[18px] text-white ring-2 ring-canvas">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-11 z-50 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-hairline bg-panel shadow-2xl ring-1 ring-black/5">
          <div className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Notifications{unread ? <span className="ml-1.5 rounded-full bg-rose-100 px-1.5 text-xs text-rose-600">{unread}</span> : null}</p>
            <div className="flex items-center gap-1">
              <button onClick={toggleSound} title={soundOn ? "Mute notification sound" : "Unmute notification sound"} className="grid size-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                {soundOn ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
              </button>
              <button onClick={markAllRead} disabled={unread === 0} title="Mark all as read" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40">
                <CheckCheck className="size-3.5" /> Mark all
              </button>
            </div>
          </div>

          <ul className="max-h-[22rem] divide-y divide-hairline/60 overflow-y-auto">
            {items.map((n) => {
              const isUnread = !n.readAt;
              return (
                <li key={n.id}>
                  <button onClick={() => markRead(n.id)} className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${isUnread ? "bg-brand/[0.04]" : ""}`}>
                    <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset ${isUnread ? "bg-brand/10 text-brand ring-brand/20" : "bg-panel-2 text-slate-400 ring-hairline"}`}>
                      <Bell className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={`truncate text-sm ${isUnread ? "font-semibold text-slate-900" : "font-medium text-slate-700"}`}>{n.title}</span>
                        <span className="shrink-0 text-[11px] text-slate-400">{timeAgo(n.createdAt, now)}</span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">{n.body}</span>
                    </span>
                    {isUnread ? <span className="mt-2 size-2 shrink-0 rounded-full bg-brand" /> : null}
                  </button>
                </li>
              );
            })}
            {items.length === 0 ? <li className="px-4 py-10 text-center text-sm text-slate-500">You're all caught up 🎉</li> : null}
          </ul>

          <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t border-hairline px-4 py-2.5 text-center text-sm font-medium text-brand hover:bg-slate-50">
            See all notifications
          </Link>
        </div>
      ) : null}
    </div>
  );
}
