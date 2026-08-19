/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  poweredByHeader: false,
  // Local private/workspace data must never become part of a standalone or
  // serverless deployment artifact. Runtime storage is mounted separately.
  outputFileTracingExcludes: {
    "/api/private-files": [
      "./data/**/*",
      "./uploads/**/*",
      "./outputs/**/*",
      "./**/*.pdf",
      "./**/*.doc",
      "./**/*.docx",
      "./**/*.pptx",
      "./**/*.xlsx",
      "./**/*.zip"
    ],
    "/api/private-files/*": [
      "./data/**/*",
      "./uploads/**/*",
      "./outputs/**/*",
      "./**/*.pdf",
      "./**/*.doc",
      "./**/*.docx",
      "./**/*.pptx",
      "./**/*.xlsx",
      "./**/*.zip"
    ],
    "/api/regulation-review": [
      "./data/**/*",
      "./uploads/**/*",
      "./outputs/**/*",
      "./services/lightrag/storage/**/*",
      "./**/*.pdf",
      "./**/*.doc",
      "./**/*.docx",
      "./**/*.pptx",
      "./**/*.xlsx",
      "./**/*.zip"
    ],
    "/api/regulation-review/*": [
      "./data/**/*",
      "./uploads/**/*",
      "./outputs/**/*",
      "./services/lightrag/storage/**/*",
      "./**/*.pdf",
      "./**/*.doc",
      "./**/*.docx",
      "./**/*.pptx",
      "./**/*.xlsx",
      "./**/*.zip"
    ]
  }
};

export default nextConfig;
