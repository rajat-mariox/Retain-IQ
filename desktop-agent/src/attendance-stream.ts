/**
 * Live attendance sync over Server-Sent Events.
 *
 * Attendance changes (from the web app, another device, or the auto-checkout
 * sweep) are already published on the user's notification channel, which the
 * identity service exposes as an SSE stream. Rather than poll status every few
 * seconds, the agent opens that stream once and reacts the moment an attendance
 * frame arrives.
 *
 * This runs in the main process because the access token lives here and the
 * stream needs a Bearer header — a renderer EventSource can't set one. On any
 * drop it reconnects with capped backoff, and the renderer's slow poll stays on
 * as a safety net, so a dead stream degrades to the old behaviour rather than
 * going stale.
 */
import { getConfig, getSession } from "./store.js";
import { refreshAccessToken } from "./api.js";

let controller: AbortController | null = null;
let stopped = false;
let attempt = 0;

const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

/** Backoff that grows 1s → 2s → 4s … capped, so a flapping server isn't hammered. */
function backoffMs(): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(attempt, 5));
}

/**
 * Open the stream and invoke onAttendance() for every attendance frame until
 * the connection ends. Returns "retry" to reconnect, "reauth" if the token was
 * rejected (caller refreshes first), or "stop" when we've been told to stop.
 */
async function consume(onAttendance: () => void, onSignOut?: (at: string) => void): Promise<"retry" | "reauth" | "stop"> {
  const session = getSession();
  if (!session) return "stop";
  controller = new AbortController();

  let res: Response;
  try {
    res = await fetch(`${getConfig().identityUrl}/v1/notifications/stream`, {
      headers: { Authorization: `Bearer ${session.accessToken}`, Accept: "text/event-stream" },
      signal: controller.signal,
    });
  } catch {
    return "retry"; // network hiccup — reconnect after backoff
  }

  if (res.status === 401) return "reauth";
  if (!res.ok || !res.body) return "retry";

  attempt = 0; // a successful connect resets the backoff
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return "retry"; // server closed the stream; reopen
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line; each carries one or more
      // "data:" lines. We only care about the JSON payloads.
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;
          try {
            const data = JSON.parse(raw) as { type?: string; at?: string };
            if (data.type === "attendance") onAttendance();
            // The person logged out of the web panel: sign this agent out too.
            else if (data.type === "agent.signout") onSignOut?.(data.at ?? new Date().toISOString());
          } catch {
            // ping / connected / non-JSON keep-alives — ignore
          }
        }
      }
    }
  } catch {
    return "retry"; // read aborted or errored — reconnect
  } finally {
    reader.releaseLock();
  }
}

/**
 * Start the live-sync loop. Safe to call repeatedly — a running loop is stopped
 * first. `onAttendance` is called (in the main process) whenever an attendance
 * change arrives; wire it to push a refresh to the renderer.
 */
export function startAttendanceStream(onAttendance: () => void, onSignOut?: (at: string) => void): void {
  stopAttendanceStream();
  stopped = false;
  attempt = 0;

  void (async () => {
    while (!stopped && getSession()) {
      const outcome = await consume(onAttendance, onSignOut);
      if (stopped) break;
      if (outcome === "stop") break;
      if (outcome === "reauth") {
        const fresh = await refreshAccessToken();
        if (!fresh) break; // refresh failed — give up; the poll fallback covers us
        continue; // reconnect immediately with the new token
      }
      // "retry": wait out the backoff, then reconnect.
      attempt += 1;
      await new Promise((r) => setTimeout(r, backoffMs()));
    }
  })();
}

/** Stop the loop and abort any open connection. */
export function stopAttendanceStream(): void {
  stopped = true;
  controller?.abort();
  controller = null;
}
