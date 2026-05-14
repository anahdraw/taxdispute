import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RSM Tax Dispute Simple Advisor",
  description: "Next.js prototype for tax dispute document review, comparable decisions, VAT regulations, and taxpayer recommendations."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
