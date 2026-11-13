import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";

export async function PATCH(req: Request) {
  const t = (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
  if (!t) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${IDENTITY_URL}/v1/platform/admin/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string }; message?: string };
  if (!res.ok) {
    return NextResponse.json({ error: data.error?.message ?? data.message ?? "Could not save settings." }, { status: res.status });
  }
  return NextResponse.json(data);
}
