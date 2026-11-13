import { forward } from "@/lib/bff";

export async function POST(req: Request, { params }: { params: Promise<{ probationId: string }> }) {
  const { probationId } = await params;
  return forward(`/employees/probations/${probationId}/review`, { method: "POST", body: await req.json().catch(() => ({})), fallbackError: "Could not submit the review." });
}
