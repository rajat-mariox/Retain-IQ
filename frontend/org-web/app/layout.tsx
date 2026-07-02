import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { getPublicConfig } from "@/lib/config";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "RetainIQ",
  description: "Workforce intelligence — attendance, productivity, team and billing for your organization.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Brand colour applied at the root so it covers EVERY page incl. the login screen.
  const { branding } = await getPublicConfig();
  const brandStyle = branding.primaryColor
    ? ({ "--color-brand": branding.primaryColor, "--color-brand-soft": branding.primaryColor } as React.CSSProperties)
    : undefined;
  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased" style={brandStyle}>{children}</body>
    </html>
  );
}
