import type { Metadata, Viewport } from "next";
import { BRAND } from "@/components/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: `${BRAND.name} — A little clarity for your money`,
  description: BRAND.tagline,
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f6f7ed",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
