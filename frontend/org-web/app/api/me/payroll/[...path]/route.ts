import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";

/**
 * Catch-all proxy for the employee-facing payroll surface — /api/me/payroll/* →
 * identity-service /v1/me/payroll/* (cookie → Bearer). Covers "my payslips"
 * (statements), "my disputes" and the respond action. Kept separate from the
 * admin /api/payroll proxy because the backend derives the caller's own employee
 * record from the session, so these routes never take an employee id.
 */
async function forward(req: NextRequest, path: string[], method: string) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const qs = req.nextUrl.searchParams.toString();
  const url = `${IDENTITY_URL}/v1/me/payroll/${path.join("/")}${qs ? `?${qs}` : ""}`;
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}` }, cache: "no-store" };
  if (method !== "GET" && method !== "DELETE") {
    init.headers = { ...init.headers, "content-type": "application/json" };
    init.body = JSON.stringify(await req.json().catch(() => ({})));
  }
  const res = await fetch(url, init);
  return NextResponse.json(await res.json().catch(() => null), { status: res.status });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await params).path, "GET");
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await params).path, "POST");
}
