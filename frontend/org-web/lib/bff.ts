import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";
import { errorMessage } from "@/lib/api-error";

/**
 * Forward a request to the identity service with the caller's bearer token.
 * A thin, reusable BFF proxy: reads the httpOnly access cookie, attaches it as a
 * Bearer, forwards method + JSON body, and surfaces nested backend error messages.
 */
export async function forward(
  path: string,
  init: { method?: string; body?: unknown; fallbackError?: string } = {},
) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const method = init.method ?? "GET";
  const hasBody = init.body !== undefined && method !== "GET";
  const res = await fetch(`${IDENTITY_URL}/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(hasBody ? { "Content-Type": "application/json" } : {}) },
    body: hasBody ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => (method === "GET" ? [] : {}));
  if (!res.ok) {
    return NextResponse.json({ error: errorMessage(data, init.fallbackError ?? "Request failed.") }, { status: res.status });
  }
  return NextResponse.json(data, { status: res.status, headers: { "Cache-Control": "no-store" } });
}
