import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";
import { errorMessage } from "@/lib/api-error";

/** Delete a leave request attachment (S3 + DB). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; attId: string }> }) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id, attId } = await params;
  const res = await fetch(`${IDENTITY_URL}/v1/leave/requests/${id}/attachments/${attId}/delete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string; error?: { message?: string } };
  if (!res.ok) return NextResponse.json({ error: errorMessage(data, "Could not remove the file.") }, { status: res.status });
  return NextResponse.json(data);
}
