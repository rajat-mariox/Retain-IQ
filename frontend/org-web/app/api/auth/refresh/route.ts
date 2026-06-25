import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, cookieOptions, IDENTITY_URL, REFRESH_COOKIE, REFRESH_MAX_AGE } from "@/lib/auth";

export async function POST(req: Request) {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let res: Response;
  try {
    res = await fetch(`${IDENTITY_URL}/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }

  if (!res.ok) {
    jar.delete(ACCESS_COOKIE);
    jar.delete(REFRESH_COOKIE);
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const data = (await res.json()) as { accessToken: string; refreshToken: string; expiresIn: number };
  jar.set(ACCESS_COOKIE, data.accessToken, cookieOptions(req.url, data.expiresIn));
  jar.set(REFRESH_COOKIE, data.refreshToken, cookieOptions(req.url, REFRESH_MAX_AGE));
  return NextResponse.json({ ok: true });
}
