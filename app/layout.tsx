import type { Metadata } from "next";
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alpha AI Jurist",
  description: "Tax Intelligence. Trusted Judgment. A one-stop tax and legal AI platform for dispute analysis, regulatory research, and advisor-ready drafting.",
  icons: {
    icon: [
      { url: "/favicon.svg?v=alpha-ai-jurist-2", type: "image/svg+xml" }
    ],
    shortcut: "/favicon.svg?v=alpha-ai-jurist-2",
    apple: "/favicon.svg?v=alpha-ai-jurist-2"
  },
  manifest: "/site.webmanifest"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
