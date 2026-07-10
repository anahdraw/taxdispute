import type { SubscriptionTier, UserRole } from "./admin";

export const TIER_PREVIEW_HEADER = "x-tdp-preview-tier";

export function parsePreviewTier(value: unknown): SubscriptionTier | null {
  const tier = String(value || "").trim().toLowerCase();
  return tier === "silver" || tier === "gold" || tier === "platinum" ? tier : null;
}

export function resolveRequestTier(
  session: { role: UserRole; tier: SubscriptionTier },
  requestedTier: unknown
): SubscriptionTier {
  if (session.role !== "admin") return session.tier;
  return parsePreviewTier(requestedTier) || session.tier;
}
