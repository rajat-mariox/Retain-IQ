import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";
import { errorMessage } from "@/lib/api-error";

/** Change the org's own plan / seats / auto-renew. Forwards to identity, which
 *  proxies to billing-service. Read the session cookie, forward as Bearer. */
export async function PATCH(req: Request) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  const res = await fetch(`${IDENTITY_URL}/v1/billing/subscription`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json({ error: errorMessage(data, "Could not update your plan.") }, { status: res.status });
  }
  return NextResponse.json(data);
}
