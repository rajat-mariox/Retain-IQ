import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;

  const res = await fetch(`${IDENTITY_URL}/v1/storage/screenshots/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    return NextResponse.json({ error: data.message ?? "Could not delete screenshot." }, { status: res.status });
  }
  return NextResponse.json(await res.json().catch(() => ({})));
}
