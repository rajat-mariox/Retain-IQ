import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";

export async function GET() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ count: 0 }, { status: 401 });
  const res = await fetch(`${IDENTITY_URL}/v1/notifications/unread-count`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  return NextResponse.json(await res.json().catch(() => ({ count: 0 })), { status: res.status, headers: { "Cache-Control": "no-store" } });
}
