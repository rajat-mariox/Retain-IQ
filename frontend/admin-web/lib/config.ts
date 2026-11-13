import "server-only";
import { IDENTITY_URL } from "./auth";

export interface PublicConfig {
  branding: { platformName: string; primaryColor: string; supportEmail: string; logoUrl: string };
  notification: { enabled: boolean; message: string; level: "info" | "warning" | "critical" };
  featureFlags: Record<string, boolean>;
  maintenance: { enabled: boolean; message: string };
}

const FALLBACK: PublicConfig = {
  branding: { platformName: "RetainIQ", primaryColor: "#1f883d", supportEmail: "", logoUrl: "" },
  notification: { enabled: false, message: "", level: "info" },
  featureFlags: {},
  maintenance: { enabled: false, message: "" },
};

/** Public platform config (branding, banner, flags, maintenance). Fails safe to defaults. */
export async function getPublicConfig(): Promise<PublicConfig> {
  try {
    const res = await fetch(`${IDENTITY_URL}/v1/config`, { cache: "no-store" });
    if (!res.ok) return FALLBACK;
    return (await res.json()) as PublicConfig;
  } catch {
    return FALLBACK;
  }
}
