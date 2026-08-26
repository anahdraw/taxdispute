const localDevelopmentExcludes = [
  "./docs/**/*",
  "./tests/**/*",
  "./tools/**/*",
  "./scripts/**/*",
  "./browser-extensions/**/*",
  "./.codex-review/**/*",
  "./tmp/**/*",
  "./services/lightrag/tests/**/*",
  "./services/lightrag/**/__pycache__/**/*"
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/knowledge": ["./content/official-knowledge/**/*"],
    "/knowledge/*": ["./content/official-knowledge/**/*"]
  },
  // Local private/workspace data must never become part of a standalone or
  // serverless deployment artifact. Runtime storage is mounted separately.
  outputFileTracingExcludes: {
    "/api/private-files": [
      ...localDevelopmentExcludes,
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
      ...localDevelopmentExcludes,
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
      ...localDevelopmentExcludes,
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
      ...localDevelopmentExcludes,
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
    "/api/regulation-chat": [...localDevelopmentExcludes, "./uploads/**/*", "./**/*.pdf", "./**/*.docx", "./**/*.xlsx", "./**/*.zip"],
    "/api/smart-chat": [...localDevelopmentExcludes, "./uploads/**/*", "./**/*.pdf", "./**/*.docx", "./**/*.xlsx", "./**/*.zip"],
    "/api/search": [...localDevelopmentExcludes, "./uploads/**/*", "./**/*.pdf", "./**/*.docx", "./**/*.xlsx", "./**/*.zip"],
    "/api/watchlist": [...localDevelopmentExcludes, "./uploads/**/*", "./**/*.pdf", "./**/*.docx", "./**/*.xlsx", "./**/*.zip"],
    "/api/enterprise/*": [...localDevelopmentExcludes, "./data/**/*", "./outputs/**/*", "./uploads/**/*", "./services/lightrag/storage/**/*", "./**/*.pdf", "./**/*.docx", "./**/*.xlsx", "./**/*.zip"],
    "/enterprise": [...localDevelopmentExcludes, "./data/**/*", "./outputs/**/*", "./uploads/**/*", "./services/lightrag/storage/**/*", "./**/*.pdf", "./**/*.docx", "./**/*.xlsx", "./**/*.zip"],
    "/sources/regulation/*": [...localDevelopmentExcludes, "./uploads/**/*", "./**/*.pdf", "./**/*.docx", "./**/*.xlsx", "./**/*.zip"],
    "/api/knowledge": [...localDevelopmentExcludes, "./data/**/*", "./outputs/**/*", "./uploads/**/*", "./**/*.pdf", "./**/*.docx", "./**/*.xlsx", "./**/*.zip", "./**/*.rar"],
    "/knowledge": [...localDevelopmentExcludes, "./data/**/*", "./outputs/**/*", "./uploads/**/*", "./**/*.pdf", "./**/*.docx", "./**/*.xlsx", "./**/*.zip", "./**/*.rar"],
    "/knowledge/*": [...localDevelopmentExcludes, "./data/**/*", "./outputs/**/*", "./uploads/**/*", "./**/*.pdf", "./**/*.docx", "./**/*.xlsx", "./**/*.zip", "./**/*.rar"]
  }
};

export default nextConfig;
