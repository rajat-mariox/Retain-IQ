// Server-only auth helpers for the BFF route handlers and server components.
// The browser never sees the backend or the tokens — it only gets httpOnly
// cookies set by our own /api/auth/* handlers.

import "server-only";

/** Base URL of identity-service (the platform-auth backend). */
export const IDENTITY_URL = process.env.IDENTITY_URL ?? "http://localhost:3001";

export const ACCESS_COOKIE = "pa_access";
export const REFRESH_COOKIE = "pa_refresh";

/** Refresh cookie lifetime (must match/track PLATFORM_REFRESH_TTL_DAYS). */
export const REFRESH_MAX_AGE = 14 * 24 * 60 * 60;

export interface AdminClaims {
  sub: string;
  name: string;
  role: string;
  exp?: number;
}

/** Decode (not verify) a JWT payload — display-only; the backend verifies signatures. */
export function decodeClaims(token: string | undefined): AdminClaims | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = Buffer.from(part, "base64url").toString("utf8");
    return JSON.parse(json) as AdminClaims;
  } catch {
    return null;
  }
}

/** Cookie options shared by access/refresh cookies. `secure` follows the request scheme. */
export function cookieOptions(requestUrl: string, maxAge: number) {
  const secure = (() => {
    try {
      return new URL(requestUrl).protocol === "https:";
    } catch {
      return false;
    }
  })();
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge };
}
