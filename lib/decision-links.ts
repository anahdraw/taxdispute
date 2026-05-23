export function encodeDecisionId(id: string) {
  const value = String(id || "");
  if (typeof window === "undefined") {
    return Buffer.from(value, "utf8").toString("base64url");
  }
  return btoa(unescape(encodeURIComponent(value)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function decodeDecisionSlug(slug: string) {
  const value = String(slug || "");
  if (typeof window === "undefined") {
    return Buffer.from(value, "base64url").toString("utf8");
  }
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return decodeURIComponent(escape(atob(padded)));
}

export function decisionDetailPath(id: string) {
  return `/decisions/${encodeDecisionId(id)}`;
}
