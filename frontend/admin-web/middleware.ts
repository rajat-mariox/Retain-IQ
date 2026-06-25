import { NextResponse, type NextRequest } from "next/server";

const ACCESS_COOKIE = "pa_access";

/** Edge-safe: decode (not verify) the JWT and check it hasn't expired. */
function hasValidSession(token: string | undefined): boolean {
  if (!token) return false;
  try {
    const part = token.split(".")[1];
    if (!part) return false;
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.exp === "number" && json.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export function middleware(req: NextRequest) {
  const authed = hasValidSession(req.cookies.get(ACCESS_COOKIE)?.value);
  const isLogin = req.nextUrl.pathname === "/login";

  // Unauthenticated → bounce to login, remembering where they were headed.
  if (!authed && !isLogin) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("from", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // Already authenticated visitors shouldn't see the login page.
  if (authed && isLogin) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// Gate everything except the auth BFF, Next internals, and static assets.
export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
