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
  title: `${BRAND.name} — Know what you can spend until payday`,
  description: "See how much you can spend until your next paycheck, with your bills and a reserve set aside. No bank login.",
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
