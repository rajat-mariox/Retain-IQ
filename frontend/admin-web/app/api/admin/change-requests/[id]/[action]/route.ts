import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE } from "@/lib/auth";
import { BILLING_ADMIN_URL } from "@/lib/plans-api";

// Super-admin decision on an org's seat/plan change request: approve | reject.
// Proxies to billing-service, which owns the subscription and applies the change.
const ALLOWED = new Set(["approve", "reject"]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const t = (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
  if (!t) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id, action } = await params;
  if (!ALLOWED.has(action)) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const body = await req.json().catch(() => ({}));

  const res = await fetch(`${BILLING_ADMIN_URL}/v1/admin/change-requests/${id}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) return NextResponse.json({ error: data.message ?? "Could not update the request." }, { status: res.status });
  return NextResponse.json(data);
}
