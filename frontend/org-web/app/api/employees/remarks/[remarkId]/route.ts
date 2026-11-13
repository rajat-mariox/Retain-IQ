import { forward } from "@/lib/bff";

export async function DELETE(_req: Request, { params }: { params: Promise<{ remarkId: string }> }) {
  const { remarkId } = await params;
  return forward(`/employees/remarks/${remarkId}`, { method: "DELETE", fallbackError: "Could not delete the remark." });
}
