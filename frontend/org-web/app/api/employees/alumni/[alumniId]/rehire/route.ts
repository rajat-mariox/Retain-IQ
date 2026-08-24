import { forward } from "@/lib/bff";

export async function PATCH(req: Request, { params }: { params: Promise<{ alumniId: string }> }) {
  const { alumniId } = await params;
  return forward(`/employees/alumni/${alumniId}/rehire`, { method: "PATCH", body: await req.json().catch(() => ({})), fallbackError: "Could not update rehire eligibility." });
}
