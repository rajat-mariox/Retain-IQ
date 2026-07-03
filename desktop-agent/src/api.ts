/**
 * Thin client for the two backend surfaces the agent talks to:
 *  - identity-service: login, whoami (→ employeeId), token refresh
 *  - activity-ingestion: batched activity upload
 * Uses the global fetch bundled with Electron/Node 18+.
 */
import { getConfig, getSession, saveSession, clearSession, type Session } from "./store.js";

export interface ActivityEvent {
  eventType: string;
  occurredAt: string;
  employeeId: string;
  sourceEventId?: string;
  payload: Record<string, unknown>;
}

/** Log in with org credentials; resolves employeeId via /auth/me. `remember` persists the session across restarts. */
export async function login(email: string, password: string, remember = true): Promise<Session> {
  const { identityUrl } = getConfig();
  const res = await fetch(`${identityUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Login failed (${res.status}).`);
  }
  const tokens = (await res.json()) as { accessToken: string; refreshToken: string };

  const me = await fetch(`${identityUrl}/v1/auth/me`, { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
  if (!me.ok) throw new Error("Could not load your profile.");
  const membership = (await me.json()) as { org?: { name?: string }; user?: { email?: string }; employee?: { id?: string } | null };
  if (!membership.employee?.id) throw new Error("Your account is not linked to an employee record — monitoring can't attribute activity.");

  const session: Session = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    employeeId: membership.employee.id,
    email: membership.user?.email ?? email,
    orgName: membership.org?.name ?? "Organization",
  };
  saveSession(session, remember);
  return session;
}

async function refresh(): Promise<string | null> {
  const { identityUrl } = getConfig();
  const session = getSession();
  if (!session) return null;
  const res = await fetch(`${identityUrl}/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });
  if (!res.ok) {
    clearSession();
    return null;
  }
  const tokens = (await res.json()) as { accessToken: string; refreshToken: string };
  saveSession({ ...session, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
  return tokens.accessToken;
}

/**
 * Reserve screenshot storage quota and get a presigned PUT URL from identity.
 * Returns null on 403 (screenshots disabled for the org), quota exceeded, or error.
 */
export async function requestScreenshotUpload(sizeBytes: number, contentType: string): Promise<{ key: string; uploadUrl: string } | null> {
  const { identityUrl } = getConfig();
  const session = getSession();
  if (!session) return null;
  const post = (token: string) =>
    fetch(`${identityUrl}/v1/storage/screenshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ contentType, sizeBytes, capturedAt: new Date().toISOString() }),
    });
  let res = await post(session.accessToken);
  if (res.status === 401) {
    const fresh = await refresh();
    if (!fresh) return null;
    res = await post(fresh);
  }
  if (!res.ok) return null;
  const data = (await res.json()) as { key: string; uploadUrl: string };
  return { key: data.key, uploadUrl: data.uploadUrl };
}

export interface MonitoringPolicy {
  screenshotsEnabled: boolean;
  screenshotIntervalSeconds: number;
  screenshotQuality: number;
  screenshotMaxWidth: number;
}

/** Fetch the org's monitoring policy (admin-configurable screenshot cadence). */
export async function fetchPolicy(): Promise<MonitoringPolicy | null> {
  const { identityUrl } = getConfig();
  const session = getSession();
  if (!session) return null;
  const get = (token: string) => fetch(`${identityUrl}/v1/monitoring/policy`, { headers: { Authorization: `Bearer ${token}` } });
  try {
    let res = await get(session.accessToken);
    if (res.status === 401) {
      const fresh = await refresh();
      if (!fresh) return null;
      res = await get(fresh);
    }
    if (!res.ok) return null;
    return (await res.json()) as MonitoringPolicy;
  } catch {
    return null;
  }
}

/** Upload the screenshot bytes directly to the presigned URL (object storage). */
export async function putBinary(url: string, body: Uint8Array, contentType: string): Promise<boolean> {
  try {
    // Electron's fetch accepts a Uint8Array/Buffer body at runtime; the DOM types
    // are stricter than reality, so cast to BodyInit.
    const res = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body: body as unknown as BodyInit });
    return res.ok;
  } catch {
    return false;
  }
}

/** Upload a batch of activity events; retries once after a token refresh on 401. */
export async function uploadBatch(events: ActivityEvent[]): Promise<{ ok: boolean; status: number }> {
  const { ingestionUrl } = getConfig();
  let session = getSession();
  if (!session || events.length === 0) return { ok: false, status: 0 };

  const post = (token: string) =>
    fetch(`${ingestionUrl}/v1/ingest/activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ events }),
    });

  let res = await post(session.accessToken);
  if (res.status === 401) {
    const fresh = await refresh();
    if (!fresh) return { ok: false, status: 401 };
    res = await post(fresh);
  }
  return { ok: res.ok, status: res.status };
}
