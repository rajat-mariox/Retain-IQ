import { forward } from "@/lib/bff";

export async function PATCH(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return forward(`/employees/offboarding-tasks/${taskId}`, { method: "PATCH", body: await req.json().catch(() => ({})), fallbackError: "Could not update the task." });
}
