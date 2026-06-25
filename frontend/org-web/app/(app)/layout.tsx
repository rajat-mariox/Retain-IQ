import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { MobileNavProvider } from "@/components/layout/MobileNav";
import { getSession } from "@/lib/api";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession().catch(() => null);

  // Force the first-login password change before anything else.
  if (session?.user.mustChangePassword) {
    redirect("/change-password");
  }

  const isAdmin = Boolean(
    session && (session.role.permissions.includes("employee.read") || session.role.name === "Owner"),
  );
  return (
    <MobileNavProvider>
      <div className="min-h-screen">
        <Sidebar orgName={session?.org.name ?? "Organization"} isAdmin={isAdmin} />
        <div className="lg:pl-64">{children}</div>
      </div>
    </MobileNavProvider>
  );
}
