import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";

const base = (id: string) => `${IDENTITY_URL}/v1/platform/admin/organizations/${id}/features`;

async function token() {
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const t = await token();
  if (!t) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  const res = await fetch(base(id), { headers: { Authorization: `Bearer ${t}` }, cache: "no-store" });
  return NextResponse.json(await res.json().catch(() => null), { status: res.status });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const t = await token();
  if (!t) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  const res = await fetch(base(id), {
    method: "PATCH",
    headers: { Authorization: `Bearer ${t}`, "content-type": "application/json" },
    body: JSON.stringify(await req.json()),
    cache: "no-store",
  });
  return NextResponse.json(await res.json().catch(() => null), { status: res.status });
}
