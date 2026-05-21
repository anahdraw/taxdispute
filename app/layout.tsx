import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RSM Tax Dispute Agentic Advisor",
  description: "Tax dispute workflow for extraction, comparable decisions, regulation questions, and advisor-ready Word/PDF drafts."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
