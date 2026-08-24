import { forward } from "@/lib/bff";

export async function PATCH(req: Request, { params }: { params: Promise<{ certId: string }> }) {
  const { certId } = await params;
  return forward(`/employees/certifications/${certId}`, { method: "PATCH", body: await req.json().catch(() => ({})), fallbackError: "Could not update the certification." });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ certId: string }> }) {
  const { certId } = await params;
  return forward(`/employees/certifications/${certId}`, { method: "DELETE", fallbackError: "Could not remove the certification." });
}
