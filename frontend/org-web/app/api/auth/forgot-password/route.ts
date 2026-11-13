import { NextResponse } from "next/server";
import { IDENTITY_URL } from "@/lib/auth";
import { errorMessage } from "@/lib/api-error";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = body?.email;
  if (typeof email !== "string") {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(`${IDENTITY_URL}/v1/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Authentication service is unavailable." }, { status: 502 });
  }

  const data = (await res.json().catch(() => ({}))) as { message?: string; resetToken?: string };
  if (!res.ok) {
    return NextResponse.json({ error: errorMessage(data, "Unable to start password reset.") }, { status: res.status });
  }

  return NextResponse.json({ message: data.message ?? "If an account exists for that email, a reset token has been generated.", resetToken: data.resetToken ?? "" });
}
