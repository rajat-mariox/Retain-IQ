import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  const res = await fetch(`${IDENTITY_URL}/v1/clients/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(await req.json()),
    cache: "no-store",
  });
  return NextResponse.json(await res.json().catch(() => null), { status: res.status });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  const res = await fetch(`${IDENTITY_URL}/v1/clients/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return NextResponse.json(await res.json().catch(() => null), { status: res.status });
}
