import { forward } from "@/lib/bff";

export async function POST(_req: Request, { params }: { params: Promise<{ exitId: string }> }) {
  const { exitId } = await params;
  return forward(`/employees/exits/${exitId}/cancel`, { method: "POST", fallbackError: "Could not cancel the exit." });
}
