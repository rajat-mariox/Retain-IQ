import "server-only";

/** Base URL of identity-service (org auth + tenant APIs). */
export const IDENTITY_URL = process.env.IDENTITY_URL ?? "http://localhost:3001";

/**
 * Base URL of payroll-service — the SEPARATE enterprise payroll platform
 * microservice (policies, runs, analytics, AI). It verifies identity's org
 * access token (same JWT secret), so the BFF forwards the same Bearer to it.
 */

export const ACCESS_COOKIE = "org_access";
export const REFRESH_COOKIE = "org_refresh";
export const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;

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
