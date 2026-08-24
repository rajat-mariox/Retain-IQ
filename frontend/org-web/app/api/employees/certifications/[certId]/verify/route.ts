import { forward } from "@/lib/bff";

export async function POST(req: Request, { params }: { params: Promise<{ certId: string }> }) {
  const { certId } = await params;
  return forward(`/employees/certifications/${certId}/verify`, { method: "POST", body: await req.json().catch(() => ({})), fallbackError: "Could not verify the certification." });
}
