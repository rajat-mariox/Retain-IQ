import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";
import { errorMessage } from "@/lib/api-error";

const ALLOWED = new Set(["run", "delete"]);

/** Run-now / delete a saved report schedule. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id, action } = await params;
  if (!ALLOWED.has(action)) return NextResponse.json({ error: "unknown action" }, { status: 404 });
  const res = await fetch(`${IDENTITY_URL}/v1/attendance/report/schedules/${id}/${action}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string; error?: { message?: string } };
  if (!res.ok) return NextResponse.json({ error: errorMessage(data, `Could not ${action} the schedule.`) }, { status: res.status });
  return NextResponse.json(data);
}
