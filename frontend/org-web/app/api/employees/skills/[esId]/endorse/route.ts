import { forward } from "@/lib/bff";

export async function POST(_req: Request, { params }: { params: Promise<{ esId: string }> }) {
  const { esId } = await params;
  return forward(`/employees/skills/${esId}/endorse`, { method: "POST", fallbackError: "Could not endorse the skill." });
}
