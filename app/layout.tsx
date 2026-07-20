import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AtlasLM | Evidence Instrument",
  description: "An interactive evidence instrument for source-grounded document research."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
