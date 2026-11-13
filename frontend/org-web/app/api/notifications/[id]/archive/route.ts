import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  const res = await fetch(`${IDENTITY_URL}/v1/notifications/${id}/archive`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) return NextResponse.json({ error: data.error?.message ?? "Could not archive." }, { status: res.status });
  return NextResponse.json(data);
}
