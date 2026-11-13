import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";

export async function GET(req: Request) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  // Forward every supported filter through to identity, not just pagination.
  const url = new URL(req.url);
  const qs = new URLSearchParams();
  qs.set("page", url.searchParams.get("page") ?? "1");
  qs.set("pageSize", url.searchParams.get("pageSize") ?? "10");
  for (const key of ["category", "priority", "unread", "archived", "q"]) {
    const v = url.searchParams.get(key);
    if (v) qs.set(key, v);
  }
  const res = await fetch(`${IDENTITY_URL}/v1/notifications?${qs.toString()}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  return NextResponse.json(await res.json().catch(() => ({ items: [], total: 0 })), { status: res.status, headers: { "Cache-Control": "no-store" } });
}
