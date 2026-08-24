import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";

/** Attendance intelligence — per-employee attendance/punctuality/consistency/risk scores. */
export async function GET(req: Request) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const qs = new URL(req.url).searchParams.toString();
  const res = await fetch(`${IDENTITY_URL}/v1/attendance/scores${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
