import { Sidebar } from "@/components/layout/Sidebar";
import { MobileNavProvider } from "@/components/layout/MobileNav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <MobileNavProvider>
      <div className="min-h-screen">
        <Sidebar />
        <div className="lg:pl-64">{children}</div>
      </div>
    </MobileNavProvider>
  );
}
