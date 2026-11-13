import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL, REFRESH_COOKIE } from "@/lib/auth";

export async function POST() {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    try {
      await fetch(`${IDENTITY_URL}/v1/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Logging out of the panel also signs out and closes this person's desktop agent.
        body: JSON.stringify({ refreshToken, signOutAgent: true }),
        cache: "no-store",
      });
    } catch {
      // Cookie clear below logs the browser out regardless.
    }
  }
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
  return new NextResponse(null, { status: 204 });
}
