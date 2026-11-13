import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";

export async function GET() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const res = await fetch(`${IDENTITY_URL}/v1/notifications/preferences`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const res = await fetch(`${IDENTITY_URL}/v1/notifications/preferences`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(await req.json().catch(() => ({}))),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) return NextResponse.json({ error: data.error?.message ?? "Could not save." }, { status: res.status });
  return NextResponse.json(data);
}
