import { Suspense } from "react";
import { getPublicConfig } from "@/lib/config";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const { branding } = await getPublicConfig();
  return (
    <Suspense>
      <LoginForm platformName={branding.platformName} logoUrl={branding.logoUrl || undefined} />
    </Suspense>
  );
}
