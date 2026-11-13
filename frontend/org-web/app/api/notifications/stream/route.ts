import { cookies } from "next/headers";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";

// Long-lived SSE proxy: forward the browser's EventSource connection to the
// identity-service stream, attaching the httpOnly access token the browser can't
// send itself. The backend body is already a text/event-stream — we pass it
// through untouched rather than buffering (no JSON parse, no cache).
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return new Response("Unauthorized", { status: 401 });

  const upstream = await fetch(`${IDENTITY_URL}/v1/notifications/stream`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
    // Abort the upstream fetch when the browser disconnects, so we don't leak a
    // dangling connection on the backend.
    signal: request.signal,
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    return new Response("Stream unavailable", { status: upstream.status || 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
    },
  });
}
