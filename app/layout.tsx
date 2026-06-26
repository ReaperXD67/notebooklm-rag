import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AtlasLM RAG",
  description: "A source-grounded document conversation app with hybrid retrieval."
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
