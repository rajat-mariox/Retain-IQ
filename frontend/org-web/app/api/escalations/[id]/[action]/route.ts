import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";
import { errorMessage } from "@/lib/api-error";

const ALLOWED = new Set(["acknowledge", "bump", "resolve"]);

/** Escalation actions: acknowledge / bump (next level) / resolve. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id, action } = await params;
  if (!ALLOWED.has(action)) return NextResponse.json({ error: "unknown action" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${IDENTITY_URL}/v1/escalations/${id}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string; error?: { message?: string } };
  if (!res.ok) return NextResponse.json({ error: errorMessage(data, `Could not ${action} the escalation.`) }, { status: res.status });
  return NextResponse.json(data);
}
