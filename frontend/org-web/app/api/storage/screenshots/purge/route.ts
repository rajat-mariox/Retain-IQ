import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";
import { errorMessage } from "@/lib/api-error";

export async function POST() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const res = await fetch(`${IDENTITY_URL}/v1/storage/screenshots/purge`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) return NextResponse.json({ error: errorMessage(data, "We couldn't clear these screenshots. Please try again.") }, { status: res.status });
  return NextResponse.json(data);
}
