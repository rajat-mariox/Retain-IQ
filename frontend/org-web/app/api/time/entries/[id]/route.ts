import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";
import { errorMessage } from "@/lib/api-error";

async function forward(method: string, id: string, body?: unknown) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  // Only send a JSON content-type when there's actually a body — Fastify rejects an
  // empty body with `Content-Type: application/json` (FST_ERR_CTP_EMPTY_JSON_BODY → 400),
  // which is what broke DELETE (no body).
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${IDENTITY_URL}/v1/time/entries/${id}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) return NextResponse.json({ error: errorMessage(data, "We couldn't update that time entry. Please try again.") }, { status: res.status });
  return NextResponse.json(data);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forward("PATCH", id, await req.json().catch(() => ({})));
}
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forward("DELETE", id);
}
