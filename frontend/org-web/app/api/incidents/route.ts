import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";
import { errorMessage } from "@/lib/api-error";

/** List incidents (with summary counts). */
export async function GET(req: Request) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const qs = new URL(req.url).searchParams.toString();
  const res = await fetch(`${IDENTITY_URL}/v1/incidents${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

/** Open an incident manually. */
export async function POST(req: Request) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${IDENTITY_URL}/v1/incidents`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string; error?: { message?: string } };
  if (!res.ok) return NextResponse.json({ error: errorMessage(data, "Could not open the incident.") }, { status: res.status });
  return NextResponse.json(data);
}
