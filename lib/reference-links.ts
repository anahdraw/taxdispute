import { decodeDecisionSlug, encodeDecisionId } from "./decision-links";

export type ReferenceKind = "decision" | "regulation";

export function encodeReferenceId(id: string) {
  return encodeDecisionId(id);
}

export function decodeReferenceSlug(slug: string) {
  return decodeDecisionSlug(slug);
}

export function referenceDetailPath(kind: ReferenceKind, id: string, query?: string) {
  const params = new URLSearchParams();
  const keyword = String(query || "").trim();
  if (keyword) params.set("q", keyword);
  const suffix = params.toString();
  return `/references/${kind}/${encodeReferenceId(id)}${suffix ? `?${suffix}` : ""}`;
}
