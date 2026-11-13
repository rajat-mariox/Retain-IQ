import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";

export async function GET(req: Request) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const url = new URL(req.url);
  const page = url.searchParams.get("page") ?? "1";
  const pageSize = url.searchParams.get("pageSize") ?? "10";
  const q = url.searchParams.get("q") ?? "";
  const qs = `page=${encodeURIComponent(page)}&pageSize=${encodeURIComponent(pageSize)}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const res = await fetch(`${IDENTITY_URL}/v1/rbac/access?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
