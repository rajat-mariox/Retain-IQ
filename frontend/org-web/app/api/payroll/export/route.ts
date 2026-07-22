import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";

/**
 * Passes the CSV body straight through — unlike the other BFF routes this must
 * NOT re-encode as JSON, and must carry the download headers so the browser
 * saves a file instead of rendering text.
 */
export async function GET(req: NextRequest) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const qs = req.nextUrl.searchParams.toString();
  const res = await fetch(`${IDENTITY_URL}/v1/payroll/export${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) return NextResponse.json(await res.json().catch(() => null), { status: res.status });

  return new NextResponse(await res.text(), {
    status: 200,
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "text/csv; charset=utf-8",
      "Content-Disposition": res.headers.get("content-disposition") ?? "attachment; filename=export.csv",
    },
  });
}
