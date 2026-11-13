import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";

/** The caller's comp-off balance + ledger (or a report's via ?employeeId). */
export async function GET(req: Request) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const employeeId = new URL(req.url).searchParams.get("employeeId");
  const qs = employeeId ? `?employeeId=${encodeURIComponent(employeeId)}` : "";
  const res = await fetch(`${IDENTITY_URL}/v1/leave/comp-off/balance${qs}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
