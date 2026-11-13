import { NextResponse, type NextRequest } from "next/server";

const ACCESS_COOKIE = "org_access";
const REFRESH_COOKIE = "org_refresh";
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60; // mirrors lib/auth.ts (server-only, not importable here)

/** Refresh this many seconds BEFORE expiry, so a request mid-flight can't land on a dead token. */
const RENEW_SKEW_SECONDS = 60;

/** Edge-safe: decode (not verify) the JWT. Signature checking is the API's job. */
function expiresAt(token: string | undefined): number | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

function loginRedirect(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("from", req.nextUrl.pathname);
  const res = NextResponse.redirect(url);
  // A dead session shouldn't leave cookies behind to retry with.
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
  return res;
}

/**
 * Trade the refresh token for a new access token, straight against identity-service.
 * The BFF route can't be reused here: middleware runs before routing, and calling
 * our own /api/auth/refresh would need an absolute URL plus a second network hop.
 */
async function renew(req: NextRequest, refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number } | null> {
  const base = process.env.IDENTITY_URL ?? "http://localhost:3001";
  try {
    const res = await fetch(`${base}/v1/auth/refresh`, {
      method: "POST",
      // Forward the browser's user-agent so the rotated session stays labelled as
      // a browser. Without it every renewal records "Next.js Middleware", which
      // makes a real person look like a machine client in the audit trail.
      headers: { "Content-Type": "application/json", "user-agent": req.headers.get("user-agent") ?? "unknown" },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    });
    if (!res.ok) return null; // revoked, reused, or expired — treat as logged out
    return (await res.json()) as { accessToken: string; refreshToken: string; expiresIn: number };
  } catch {
    return null; // identity-service unreachable
  }
}

function setSession(res: NextResponse, req: NextRequest, tokens: { accessToken: string; refreshToken: string; expiresIn: number }) {
  const secure = req.nextUrl.protocol === "https:";
  const opts = { httpOnly: true, sameSite: "lax" as const, secure, path: "/" };
  res.cookies.set(ACCESS_COOKIE, tokens.accessToken, { ...opts, maxAge: tokens.expiresIn ?? 900 });
  res.cookies.set(REFRESH_COOKIE, tokens.refreshToken, { ...opts, maxAge: REFRESH_MAX_AGE });
  return res;
}

/**
 * Rewrite the REQUEST's cookie header so this render sees the new token.
 *
 * Response cookies only reach the *next* request — but server components read
 * `cookies()` off the incoming one. Without this the page would render right now
 * using the expired token and fail its API calls, even though we just renewed.
 */
function withRenewedRequest(req: NextRequest, tokens: { accessToken: string; refreshToken: string }) {
  const headers = new Headers(req.headers);
  const jar = req.cookies;
  jar.set(ACCESS_COOKIE, tokens.accessToken);
  jar.set(REFRESH_COOKIE, tokens.refreshToken);
  headers.set("cookie", jar.toString());
  return headers;
}

/**
 * Session gate + silent renewal.
 *
 * Access tokens live 15 minutes; refresh tokens live 30 days. This used to bounce
 * to /login the moment the access token expired — so anyone idle (or simply
 * working) for 15 minutes was logged out while holding a perfectly valid refresh
 * token that nothing ever used. Now an expired access token is renewed in place
 * and only a dead REFRESH sends someone to /login.
 */
export async function middleware(req: NextRequest) {
  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  const exp = expiresAt(access);
  const fresh = exp != null && exp > Date.now() + RENEW_SKEW_SECONDS * 1000;
  const isLogin = req.nextUrl.pathname === "/login";

  if (fresh) {
    if (isLogin) {
      const url = req.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // Access is gone or about to go. Renew it rather than ending the session.
  if (refresh) {
    const tokens = await renew(req, refresh);
    if (tokens) {
      if (isLogin) {
        const url = req.nextUrl.clone();
        url.pathname = "/";
        url.search = "";
        return setSession(NextResponse.redirect(url), req, tokens);
      }
      // Pass the fresh token to THIS render (request headers) and back to the
      // browser (response cookies) — both, or the page renders with a dead token.
      return setSession(NextResponse.next({ request: { headers: withRenewedRequest(req, tokens) } }), req, tokens);
    }
  }

  if (isLogin) return NextResponse.next();
  return loginRedirect(req);
}

export const config = {
  matcher: ["/((?!api/auth|api/attendance|_next/static|_next/image|favicon.ico|logo-mark.svg).*)"],
};
