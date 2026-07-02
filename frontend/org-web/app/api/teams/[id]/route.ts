import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";

async function token() {
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const t = await token();
  if (!t) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${IDENTITY_URL}/v1/teams/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) return NextResponse.json({ error: data.message ?? "Could not update team." }, { status: res.status });
  return NextResponse.json(data);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const t = await token();
  if (!t) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  const res = await fetch(`${IDENTITY_URL}/v1/teams/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${t}` },
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) return NextResponse.json({ error: data.message ?? "Could not delete team." }, { status: res.status });
  return NextResponse.json(data);
}
