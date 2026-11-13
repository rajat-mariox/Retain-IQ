import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";
import { errorMessage } from "@/lib/api-error";

/**
 * Catch-all BFF proxy for the Payroll & Payout workspace — everything under
 * /v1/payroll/* on the identity-service (batches, periods, calendars, profiles,
 * components, records, variable pay, payments, statements, disputes,
 * adjustments, reports…). Reads the httpOnly access cookie, attaches it as a
 * Bearer, forwards method + query + JSON body, and surfaces nested backend error
 * messages the way the rest of the BFF does.
 *
 * More specific sibling routes (cycles, dashboard, invoices, rates, reports,
 * export) take precedence over this catch-all, so it only handles the new
 * workspace endpoints that have no dedicated route.
 */
async function forward(req: NextRequest, path: string[], method: string) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const qs = req.nextUrl.searchParams.toString();
  const url = `${IDENTITY_URL}/v1/payroll/${path.map(encodeURIComponent).join("/")}${qs ? `?${qs}` : ""}`;
  const hasBody = method !== "GET" && method !== "DELETE";
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(hasBody ? { "content-type": "application/json" } : {}),
    },
    body: hasBody ? JSON.stringify(await req.json().catch(() => ({}))) : undefined,
    cache: "no-store",
  });

  // Reports can answer with a CSV attachment — pass non-JSON bodies through untouched.
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "content-type": contentType || "text/plain", "cache-control": "no-store" },
    });
  }

  const data = await res.json().catch(() => (method === "GET" ? [] : {}));
  if (!res.ok) {
    return NextResponse.json({ error: errorMessage(data, "Request failed.") }, { status: res.status });
  }
  return NextResponse.json(data, { status: res.status, headers: { "cache-control": "no-store" } });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await params).path, "GET");
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await params).path, "POST");
}
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await params).path, "PATCH");
}
