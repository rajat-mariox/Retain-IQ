import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL, REFRESH_COOKIE } from "@/lib/auth";

export async function POST() {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;

  // Best-effort server-side revocation (refresh session + access denylist).
  if (refreshToken) {
    try {
      await fetch(`${IDENTITY_URL}/v1/platform/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
        cache: "no-store",
      });
    } catch {
      // Clearing the cookies below is enough to log the browser out regardless.
    }
  }

  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
  return new NextResponse(null, { status: 204 });
}
