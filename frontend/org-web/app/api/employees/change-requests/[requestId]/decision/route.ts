import { forward } from "@/lib/bff";

export async function POST(req: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  return forward(`/employees/change-requests/${requestId}/decision`, { method: "POST", body: await req.json().catch(() => ({})), fallbackError: "Could not record the decision." });
}
