import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, IDENTITY_URL } from "@/lib/auth";

const BASE = `${IDENTITY_URL}/v1/platform/admin/organizations`;

async function authToken() {
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}

function forward(res: Response, fallback: string) {
  return res
    .json()
    .catch(() => ({}))
    .then((data) => {
      if (!res.ok) {
        const msg = (data as { message?: string }).message ?? fallback;
        return NextResponse.json({ error: msg }, { status: res.status });
      }
      return NextResponse.json(data);
    });
}

// Edit profile ({ name, region, timezone }) OR change status ({ status:
// 'ACTIVE' | 'SUSPENDED' }). Status maps to the dedicated activate/suspend
// endpoints; everything else is a profile edit.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = await authToken();
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const bearer = { Authorization: `Bearer ${token}` };

  if (typeof body.status === "string") {
    // No request body — do NOT set Content-Type: application/json, or Fastify
    // rejects the empty body with 400.
    const verb = body.status === "SUSPENDED" ? "suspend" : "activate";
    const res = await fetch(`${BASE}/${id}/${verb}`, { method: "POST", headers: bearer, cache: "no-store" });
    return forward(res, `Could not ${verb} organization.`);
  }

  const res = await fetch(`${BASE}/${id}`, {
    method: "PATCH",
    headers: { ...bearer, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return forward(res, "Could not update organization.");
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = await authToken();
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  const res = await fetch(`${BASE}/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return forward(res, "Could not delete organization.");
}
