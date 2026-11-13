import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE } from "@/lib/auth";
import { BILLING_ADMIN_URL } from "@/lib/plans-api";

export async function PATCH(req: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const t = (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
  if (!t) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { orgId } = await params;
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${BILLING_ADMIN_URL}/v1/admin/subscriptions/${orgId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) return NextResponse.json({ error: data.message ?? "Could not update subscription." }, { status: res.status });
  return NextResponse.json(data);
}
