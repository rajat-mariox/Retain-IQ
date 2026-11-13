import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";
import { errorMessage } from "@/lib/api-error";

export async function POST(req: Request) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { currentPassword?: unknown; newPassword?: unknown } | null;
  if (typeof body?.currentPassword !== "string" || typeof body?.newPassword !== "string") {
    return NextResponse.json({ error: "Both passwords are required." }, { status: 400 });
  }

  const res = await fetch(`${IDENTITY_URL}/v1/auth/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword: body.currentPassword, newPassword: body.newPassword }),
    cache: "no-store",
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    return NextResponse.json({ error: errorMessage(data, "Could not change password.") }, { status: res.status });
  }
  return new NextResponse(null, { status: 204 });
}
