"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, X } from "lucide-react";

export interface NotifItem {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

interface NotificationsContextValue {
  items: NotifItem[];
  unread: number;
  soundOn: boolean;
  toggleSound: () => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  refresh: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);
export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationsProvider");
  return ctx;
}

const POLL_MS = 15_000;
const SOUND_KEY = "retainiq:notif-sound";
const isReal = (id: string) => id !== "platform-announcement" && !id.startsWith("draft:");

/** A short, pleasant two-tone "ding" synthesized via Web Audio — no asset needed. */
function playDing(ctxRef: React.MutableRefObject<AudioContext | null>) {
  try {
    if (typeof window === "undefined") return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!ctxRef.current) ctxRef.current = new AC();
    const ac = ctxRef.current;
    if (ac.state === "suspended") void ac.resume();
    const now = ac.currentTime;
    const notes = [880, 1174.7]; // A5 → D6
    notes.forEach((freq, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t0 = now + i * 0.12;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      osc.connect(gain).connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + 0.24);
    });
  } catch {
    /* audio not available — ignore */
  }
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<NotifItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [soundOn, setSoundOn] = useState(true);
  const [toasts, setToasts] = useState<NotifItem[]>([]);

  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false); // skip toasting the initial page-load batch
  const audioCtx = useRef<AudioContext | null>(null);
  const soundOnRef = useRef(true);

  // load persisted sound preference
  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(SOUND_KEY) : null;
    const on = saved !== "off";
    setSoundOn(on);
    soundOnRef.current = on;
  }, []);

  const toggleSound = useCallback(() => {
    setSoundOn((prev) => {
      const next = !prev;
      soundOnRef.current = next;
      if (typeof window !== "undefined") window.localStorage.setItem(SOUND_KEY, next ? "on" : "off");
      if (next) playDing(audioCtx); // preview + unlock the AudioContext on the user gesture
      return next;
    });
  }, []);

  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const refresh = useCallback(async () => {
    try {
      const [listRes, countRes] = await Promise.all([
        fetch("/api/notifications?page=1&pageSize=12", { cache: "no-store" }),
        fetch("/api/notifications/unread-count", { cache: "no-store" }),
      ]);
      const list = (await listRes.json().catch(() => ({ items: [] }))) as { items?: NotifItem[] };
      const count = (await countRes.json().catch(() => ({ count: 0 }))) as { count?: number };
      const next = Array.isArray(list.items) ? list.items : [];
      setItems(next);
      setUnread(count.count ?? 0);

      // Detect genuinely new, unread notifications since we primed → toast + sound.
      const fresh = next.filter((n) => isReal(n.id) && !n.readAt && !seen.current.has(n.id));
      for (const n of next) seen.current.add(n.id);
      if (primed.current && fresh.length) {
        setToasts((t) => [...fresh.slice(0, 3), ...t].slice(0, 4));
        if (soundOnRef.current) playDing(audioCtx);
      }
      primed.current = true;
    } catch {
      /* offline / transient — keep last state */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    // catch up promptly when the user returns to the tab
    const onVis = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  const markRead = useCallback((id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)));
    setUnread((u) => Math.max(0, u - 1));
    setToasts((t) => t.filter((x) => x.id !== id));
    if (isReal(id)) void fetch(`/api/notifications/${id}/read`, { method: "POST", cache: "no-store" }).catch(() => undefined);
  }, []);

  const markAllRead = useCallback(() => {
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    setUnread(0);
    setToasts([]);
    void fetch("/api/notifications/read-all", { method: "POST", cache: "no-store" }).catch(() => undefined);
  }, []);

  return (
    <NotificationsContext.Provider value={{ items, unread, soundOn, toggleSound, markRead, markAllRead, refresh }}>
      {children}
      <ToastHost toasts={toasts} onDismiss={dismissToast} onOpen={markRead} />
    </NotificationsContext.Provider>
  );
}

function ToastHost({ toasts, onDismiss, onOpen }: { toasts: NotifItem[]; onDismiss: (id: string) => void; onOpen: (id: string) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[min(22rem,calc(100vw-2.5rem))] flex-col gap-2.5">
      {toasts.map((t) => (
        <Toast key={t.id} item={t} onDismiss={onDismiss} onOpen={onOpen} />
      ))}
    </div>
  );
}

function Toast({ item, onDismiss, onOpen }: { item: NotifItem; onDismiss: (id: string) => void; onOpen: (id: string) => void }) {
  useEffect(() => {
    const id = window.setTimeout(() => onDismiss(item.id), 6500);
    return () => window.clearTimeout(id);
  }, [item.id, onDismiss]);

  return (
    <div className="pointer-events-auto flex items-start gap-3 rounded-xl border border-hairline bg-panel p-3.5 shadow-lg ring-1 ring-black/5 animate-[slideIn_.2s_ease-out]">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand ring-1 ring-inset ring-brand/20">
        <Bell className="size-4" />
      </span>
      <button onClick={() => onOpen(item.id)} className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-semibold text-slate-900">{item.title}</p>
        <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{item.body}</p>
      </button>
      <button onClick={() => onDismiss(item.id)} aria-label="Dismiss" className="shrink-0 text-slate-400 hover:text-slate-700">
        <X className="size-4" />
      </button>
    </div>
  );
}
