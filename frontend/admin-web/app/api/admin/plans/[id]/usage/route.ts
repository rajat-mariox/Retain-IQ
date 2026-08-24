import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";

// Which orgs are subscribed to a plan — used by the plan-manager delete modal to
// block deletion and list the affected organizations. Proxies to identity's
// platform-admin API (which resolves org names from identity + subs from billing).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;

  const res = await fetch(`${IDENTITY_URL}/v1/platform/admin/plans/${encodeURIComponent(id)}/usage`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json({ error: "Could not load plan usage." }, { status: res.status });
  return NextResponse.json(data);
}
