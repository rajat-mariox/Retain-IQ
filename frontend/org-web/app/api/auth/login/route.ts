import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, cookieOptions, IDENTITY_URL, REFRESH_COOKIE, REFRESH_MAX_AGE } from "@/lib/auth";

function orgLogin(email: string, password: string, orgId?: string) {
  return fetch(`${IDENTITY_URL}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(orgId ? { email, password, orgId } : { email, password }),
    cache: "no-store",
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  const email = body?.email;
  const password = body?.password;
  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  let res: Response;
  try {
    res = await orgLogin(email, password);
  } catch {
    return NextResponse.json({ error: "Authentication service is unavailable." }, { status: 502 });
  }
  if (!res.ok) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  let data = (await res.json()) as {
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
    requiresOrgSelection?: boolean;
    memberships?: { orgId: string }[];
  };

  // Multi-org accounts: bind to the first membership (a real org picker is a follow-up).
  if (data.requiresOrgSelection) {
    const orgId = data.memberships?.[0]?.orgId;
    if (!orgId) return NextResponse.json({ error: "No organization membership." }, { status: 401 });
    res = await orgLogin(email, password, orgId);
    if (!res.ok) return NextResponse.json({ error: "Login failed." }, { status: 401 });
    data = await res.json();
  }

  if (!data.accessToken || !data.refreshToken) {
    return NextResponse.json({ error: "Login failed." }, { status: 401 });
  }

  const jar = await cookies();
  jar.set(ACCESS_COOKIE, data.accessToken, cookieOptions(req.url, data.expiresIn ?? 900));
  jar.set(REFRESH_COOKIE, data.refreshToken, cookieOptions(req.url, REFRESH_MAX_AGE));
  return NextResponse.json({ ok: true });
}
