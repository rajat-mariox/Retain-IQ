import { forward } from "@/lib/bff";

export async function POST(req: Request, { params }: { params: Promise<{ esId: string }> }) {
  const { esId } = await params;
  return forward(`/employees/skills/${esId}/verify`, { method: "POST", body: await req.json().catch(() => ({})), fallbackError: "Could not verify the skill." });
}
