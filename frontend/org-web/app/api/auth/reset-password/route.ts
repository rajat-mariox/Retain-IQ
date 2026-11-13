import { NextResponse } from "next/server";
import { IDENTITY_URL } from "@/lib/auth";
import { errorMessage } from "@/lib/api-error";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { email?: unknown; token?: unknown; newPassword?: unknown } | null;
  const email = body?.email;
  const token = body?.token;
  const newPassword = body?.newPassword;
  if (typeof email !== "string" || typeof token !== "string" || typeof newPassword !== "string") {
    return NextResponse.json({ error: "Email, token, and a new password are required." }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(`${IDENTITY_URL}/v1/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, token, newPassword }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Authentication service is unavailable." }, { status: 502 });
  }

  const data = (await res.json().catch(() => ({}))) as { message?: string; ok?: boolean };
  if (!res.ok) {
    return NextResponse.json({ error: errorMessage(data, "Unable to reset password.") }, { status: res.status });
  }

  return NextResponse.json({ ok: data.ok ?? true, message: "Password reset complete. You can sign in now." });
}
