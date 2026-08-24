import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";

/** Reachable scope options (departments/teams/employees) for the report pickers. */
export async function GET() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const res = await fetch(`${IDENTITY_URL}/v1/attendance/report/scope-options`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
