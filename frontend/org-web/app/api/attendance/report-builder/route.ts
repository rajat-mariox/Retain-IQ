import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";

/** Configurable attendance report — proxies scope/period/format to identity. */
export async function GET(req: Request) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const qs = new URL(req.url).searchParams.toString();
  const res = await fetch(`${IDENTITY_URL}/v1/attendance/report${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  // xlsx (and any non-JSON) is a file download — pass the body + download headers
  // straight through. JSON responses (the view, and the CSV { filename, body })
  // are re-encoded as JSON as before.
  const ct = res.headers.get("content-type") ?? "";
  if (res.ok && !ct.includes("application/json")) {
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: {
        "Content-Type": ct || "application/octet-stream",
        "Content-Disposition": res.headers.get("content-disposition") ?? "attachment; filename=attendance-report.xls",
      },
    });
  }
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
