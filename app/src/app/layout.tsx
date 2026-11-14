import type { Metadata, Viewport } from "next";
import { Instrument_Sans } from "next/font/google";
import { BRAND } from "@/components/brand";
import "./globals.css";

// Self-hosted at build time by next/font: no request to Google from the browser.
const sans = Instrument_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

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
    <html lang="en" className={sans.variable}>
      <body>{children}</body>
    </html>
  );
}
