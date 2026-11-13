import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";
import { errorMessage } from "@/lib/api-error";

/**
 * Payroll reports proxy — /api/payroll/reports/:kind → identity-service
 * /v1/payroll/reports/:kind (cookie → Bearer). A dedicated route (not the
 * /api/payroll catch-all) because the sibling /api/payroll/reports folder shadows
 * the catch-all for this depth, and because ?format=csv needs special handling.
 *
 * The workspace reports endpoint returns the CSV as a JSON envelope
 * ({ filename, contentType, body }) rather than a streamed attachment, so for a
 * CSV request we unwrap that envelope here and re-emit it as a real downloadable
 * file (with a UTF-8 BOM so Excel reads accents correctly), exactly like the
 * legacy /api/payroll/export route does.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { kind } = await params;
  const qs = req.nextUrl.searchParams;
  const isCsv = qs.get("format") === "csv";
  const url = `${IDENTITY_URL}/v1/payroll/reports/${encodeURIComponent(kind)}${qs.toString() ? `?${qs.toString()}` : ""}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    return NextResponse.json({ error: errorMessage(data, "Could not build this report.") }, { status: res.status });
  }

  if (isCsv && data && typeof data === "object" && typeof (data as { body?: unknown }).body === "string") {
    const env = data as { filename?: string; contentType?: string; body: string };
    return new NextResponse(`﻿${env.body}`, {
      status: 200,
      headers: {
        "Content-Type": env.contentType ?? "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${env.filename ?? `payroll-${kind}.csv`}"`,
        "cache-control": "no-store",
      },
    });
  }

  return NextResponse.json(data, { status: 200, headers: { "cache-control": "no-store" } });
}
