import { forward } from "@/lib/bff";

export async function POST(_req: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  return forward(`/employees/change-requests/${requestId}/cancel`, { method: "POST", fallbackError: "Could not cancel the request." });
}
