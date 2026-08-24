import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";

/** Leave requests export — CSV (default) or xlsx. Passes the download through. */
export async function GET(req: Request) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const qs = new URL(req.url).searchParams.toString();
  const res = await fetch(`${IDENTITY_URL}/v1/leave/export${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  return new NextResponse(await res.text(), {
    status: 200,
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "text/csv; charset=utf-8",
      "Content-Disposition": res.headers.get("content-disposition") ?? "attachment; filename=leave.csv",
    },
  });
}
