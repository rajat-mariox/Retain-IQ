import { forward } from "@/lib/bff";

export async function POST(req: Request, { params }: { params: Promise<{ exitId: string }> }) {
  const { exitId } = await params;
  return forward(`/employees/exits/${exitId}/complete`, { method: "POST", body: await req.json().catch(() => ({})), fallbackError: "Could not complete the exit." });
}
