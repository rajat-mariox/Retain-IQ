import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";
import { errorMessage } from "@/lib/api-error";

/** Manually grant (or debit) comp-off for a managed employee. */
export async function POST(req: Request) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const res = await fetch(`${IDENTITY_URL}/v1/leave/comp-off/grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(await req.json().catch(() => ({}))),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string; error?: { message?: string } };
  if (!res.ok) return NextResponse.json({ error: errorMessage(data, "Could not grant comp-off.") }, { status: res.status });
  return NextResponse.json(data);
}
