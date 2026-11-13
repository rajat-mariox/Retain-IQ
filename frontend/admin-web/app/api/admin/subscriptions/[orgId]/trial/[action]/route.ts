import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE } from "@/lib/auth";
import { BILLING_ADMIN_URL } from "@/lib/plans-api";

// Super-admin trial actions: convert | extend-trial | cancel-trial. Proxies to
// billing-service, which owns the subscription and validates each transition.
const ALLOWED: Record<string, string> = {
  convert: "convert",
  extend: "extend-trial",
  cancel: "cancel-trial",
};

export async function POST(req: Request, { params }: { params: Promise<{ orgId: string; action: string }> }) {
  const t = (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
  if (!t) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { orgId, action } = await params;
  const target = ALLOWED[action];
  if (!target) return NextResponse.json({ error: "Unknown trial action." }, { status: 400 });
  const body = await req.json().catch(() => ({}));

  const res = await fetch(`${BILLING_ADMIN_URL}/v1/admin/subscriptions/${orgId}/${target}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) return NextResponse.json({ error: data.message ?? "Could not update the trial." }, { status: res.status });
  return NextResponse.json(data);
}
