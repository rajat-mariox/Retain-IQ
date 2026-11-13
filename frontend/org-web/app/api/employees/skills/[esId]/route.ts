import { forward } from "@/lib/bff";

export async function PATCH(req: Request, { params }: { params: Promise<{ esId: string }> }) {
  const { esId } = await params;
  return forward(`/employees/skills/${esId}`, { method: "PATCH", body: await req.json().catch(() => ({})), fallbackError: "Could not update the skill." });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ esId: string }> }) {
  const { esId } = await params;
  return forward(`/employees/skills/${esId}`, { method: "DELETE", fallbackError: "Could not remove the skill." });
}
