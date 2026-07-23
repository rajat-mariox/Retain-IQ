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

/**
 * Exchange the refresh token for a fresh access token, persisting it. Exported
 * as refreshAccessToken so the attendance SSE loop can re-auth on a 401 the same
 * way identityFetch does.
 */
export async function refreshAccessToken(): Promise<string | null> {
  return refresh();
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

export type AttendanceAction = "CHECK_IN" | "CHECK_OUT" | "BREAK_START" | "BREAK_END";

export interface AttendanceStatus {
  tracksAttendance: boolean;
  /** Derived state (WORKING / ON_BREAK / COMPLETED / …). */
  state: string;
  /** Actions the server says are valid right now — the agent renders only these. */
  availableActions: AttendanceAction[];
  checkedIn: boolean;
  checkedOut: boolean;
  onBreak: boolean;
  checkInAt: string | null;
  checkOutAt: string | null;
  breakMinutes: number;
  overtimeMinutes: number;
  openBreakStartedAt: string | null;
  workMinutes: number;
  sessionCount: number;
  source: string | null;
}

/** Authenticated call to identity, refreshing the token once on a 401. */
async function identityFetch(path: string, init: RequestInit = {}): Promise<Response | null> {
  const { identityUrl } = getConfig();
  const session = getSession();
  if (!session) return null;
  const call = (token: string) =>
    fetch(`${identityUrl}/v1${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
  let res = await call(session.accessToken);
  if (res.status === 401) {
    const fresh = await refresh();
    if (!fresh) return null;
    res = await call(fresh);
  }
  return res;
}

/**
 * Attendance from the desktop agent. Signing in marks the employee present and
 * signing out (or quitting) closes the day, so the agent and the web app write
 * to the same record — whichever the person happens to use.
 *
 * All of these are safe to call blindly: the server is idempotent, and owners
 * (who aren't tracked for attendance) simply get a 403 we ignore.
 */
export async function agentCheckIn(): Promise<boolean> {
  const res = await identityFetch("/attendance/check-in?source=agent", { method: "POST" });
  return Boolean(res?.ok);
}

export async function agentCheckOut(): Promise<boolean> {
  const res = await identityFetch("/attendance/check-out?source=agent", { method: "POST" });
  return Boolean(res?.ok);
}

export async function agentStartBreak(kind = "BREAK"): Promise<boolean> {
  const res = await identityFetch(`/attendance/break/start?source=agent&kind=${encodeURIComponent(kind)}`, { method: "POST" });
  return Boolean(res?.ok);
}

export async function agentEndBreak(): Promise<boolean> {
  const res = await identityFetch("/attendance/break/end?source=agent", { method: "POST" });
  return Boolean(res?.ok);
}

// ---- attendance corrections (employee side) ----
// A correction is how an employee asks for a day the clock got wrong to be
// fixed; it goes to their approver and only an approval edits the record. The
// agent surfaces the request + status; approving stays in the web app.

export type CorrectionType = "MISSED_CHECK_IN" | "MISSED_CHECK_OUT" | "WRONG_TIME" | "OVERTIME" | "OTHER";

export interface CorrectionRequest {
  day: string; // YYYY-MM-DD
  type: CorrectionType;
  reason: string;
  checkInAt?: string; // ISO instant
  checkOutAt?: string;
  overtimeMinutes?: number;
}

export interface Correction {
  id: string;
  day: string;
  type: string;
  reason: string;
  requestedCheckInAt: string | null;
  requestedCheckOutAt: string | null;
  requestedOvertimeMinutes: number | null;
  status: string; // PENDING | APPROVED | REJECTED | CANCELLED
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

/** Raise a correction. Returns the server's error message on failure, else null. */
export async function requestCorrection(body: CorrectionRequest): Promise<string | null> {
  const res = await identityFetch("/attendance/corrections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res?.ok) return null;
  if (!res) return "Not signed in.";
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  return data.error?.message ?? "Could not raise the request.";
}

/** The caller's own correction history (most recent first). */
export async function myCorrections(): Promise<Correction[]> {
  const res = await identityFetch("/attendance/corrections/me");
  if (!res?.ok) return [];
  return (await res.json()) as Correction[];
}

/** Withdraw a still-pending request. */
export async function cancelCorrection(id: string): Promise<boolean> {
  const res = await identityFetch(`/attendance/corrections/${id}/cancel`, { method: "POST" });
  return Boolean(res?.ok);
}

/** Current attendance state — used to keep the agent UI in step with the web app. */
export async function fetchAttendanceStatus(): Promise<AttendanceStatus | null> {
  const res = await identityFetch("/attendance/status");
  if (!res?.ok) return null;
  return (await res.json()) as AttendanceStatus;
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
