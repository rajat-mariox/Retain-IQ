import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";
import { toFormError } from "@/lib/api-error";

export async function POST(req: Request) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  const res = await fetch(`${IDENTITY_URL}/v1/platform/admin/organizations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    // Forward the API's per-field reasons instead of collapsing everything to a
    // generic message — the form needs to know WHICH field is wrong.
    return NextResponse.json(await toFormError(res, "Could not create organization."), { status: res.status });
  }
  return NextResponse.json(await res.json());
}
