import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  const res = await fetch(`${IDENTITY_URL}/v1/performance/cycles/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(await req.json().catch(() => ({}))), cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) return NextResponse.json({ error: data.error?.message ?? "Could not save." }, { status: res.status });
  return NextResponse.json(data);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  const res = await fetch(`${IDENTITY_URL}/v1/performance/cycles/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) return NextResponse.json({ error: data.error?.message ?? "Could not delete." }, { status: res.status });
  return NextResponse.json(data);
}
