import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TradePilot AI",
  description: "AI market analysis assistant with admin-only teaching space",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
