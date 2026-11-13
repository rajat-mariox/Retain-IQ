"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MonitorSmartphone, X } from "lucide-react";

type Status = { tracked: boolean; connected: boolean; lastSeenAt: string | null };

const TRIED_KEY = "retainiq.agentAutoOpen"; // auto-open once per browser tab session
const HIDDEN_KEY = "retainiq.agentBannerHidden";

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Keeps the desktop agent in step with the web panel. After sign-in, if this
 * person is tracked and their agent isn't running, it opens the agent through a
 * `retainiq://login?code=…` link carrying a one-time code, so the agent signs in
 * without a password. The browser asks "Open RetainIQ Agent?" the first time.
 *
 * Monitoring itself still starts only on check-in. The Owner isn't tracked, so
 * the server answers `tracked: false` and nothing is shown.
 */
export function AgentConnectBanner() {
  const [status, setStatus] = useState<Status | null>(null);
  const [opening, setOpening] = useState(false);
  const [waitedLong, setWaitedLong] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(true); // until we know, show nothing
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (): Promise<Status | null> => {
    const res = await fetch("/api/agent/status", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return null;
    const s = (await res.json()) as Status;
    setStatus(s);
    return s;
  }, []);

  const stopPolling = () => {
    if (poll.current) clearInterval(poll.current);
    poll.current = null;
  };

  const openAgent = useCallback(async () => {
    setError(null);
    setOpening(true);
    setWaitedLong(false);
    try {
      const res = await fetch("/api/agent/link-code", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
      if (!res.ok || !data.code) {
        setError(data.error ?? "Couldn't prepare the agent sign-in.");
        setOpening(false);
        return;
      }
      window.location.href = `retainiq://login?code=${encodeURIComponent(data.code)}`;
      // Watch for the agent's first heartbeat (it pings right after signing in).
      stopPolling();
      const started = Date.now();
      poll.current = setInterval(async () => {
        const s = await load();
        if (s?.connected) {
          stopPolling();
          setOpening(false);
        } else if (Date.now() - started > 15_000) {
          setWaitedLong(true);
          if (Date.now() - started > 60_000) {
            stopPolling();
            setOpening(false);
          }
        }
      }, 3000);
    } catch {
      setError("Couldn't reach the server.");
      setOpening(false);
    }
  }, [load]);

  useEffect(() => {
    const store = storage();
    setHidden(store?.getItem(HIDDEN_KEY) === "1");
    void (async () => {
      const s = await load();
      if (!s || !s.tracked || s.connected) return;
      if (store?.getItem(TRIED_KEY)) return;
      store?.setItem(TRIED_KEY, "1");
      void openAgent();
    })();
    return stopPolling;
  }, [load, openAgent]);

  if (hidden || !status || !status.tracked || status.connected) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-sky-200 bg-sky-50 px-5 py-2.5 text-sm text-sky-900 lg:px-8">
      <MonitorSmartphone className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        {opening
          ? waitedLong
            ? "Still waiting for the desktop agent. If your browser asked, choose “Open”. Not installed? Ask your admin for the RetainIQ Agent installer."
            : "Opening the RetainIQ desktop agent…"
          : "The RetainIQ desktop agent isn't running on this computer. Open it to record attendance and activity."}
        {error ? <span className="ml-2 text-rose-600">{error}</span> : null}
      </span>
      <button
        type="button"
        onClick={() => void openAgent()}
        disabled={opening && !waitedLong}
        className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-60"
      >
        {opening && !waitedLong ? <Loader2 className="size-3.5 animate-spin" /> : null}
        {waitedLong ? "Try again" : "Open agent"}
      </button>
      <button
        type="button"
        title="Hide for now"
        onClick={() => {
          storage()?.setItem(HIDDEN_KEY, "1");
          setHidden(true);
          stopPolling();
        }}
        className="rounded p-1 text-sky-700 hover:bg-sky-100"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
