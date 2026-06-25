import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, cookieOptions, IDENTITY_URL, REFRESH_COOKIE, REFRESH_MAX_AGE } from "@/lib/auth";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  const email = body?.email;
  const password = body?.password;
  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(`${IDENTITY_URL}/v1/platform/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Authentication service is unavailable." }, { status: 502 });
  }

  if (!res.ok) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const data = (await res.json()) as { accessToken: string; refreshToken: string; expiresIn: number; admin: unknown };
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, data.accessToken, cookieOptions(req.url, data.expiresIn));
  jar.set(REFRESH_COOKIE, data.refreshToken, cookieOptions(req.url, REFRESH_MAX_AGE));
  return NextResponse.json({ admin: data.admin });
}
