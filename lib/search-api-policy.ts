import { tierHasFeature, type SubscriptionTier, type TierFeatureKey, type UserRole } from "./admin";
import { InvalidSearchRequestError } from "./hybrid-search";
import type { SearchCorpus } from "./search-contracts";

export function searchAsksCurrentLaw(query: string) {
  return /\b(berlaku|tidak berlaku|saat ini|sekarang|terbaru|status|dicabut|diubah|perubahan|masa pajak|efektif|as of|current|in force|effective|revoked|amended)\b/i.test(query);
}

export function normalizeRequestedSearchCorpora(value: unknown): SearchCorpus[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new InvalidSearchRequestError("corpora must be a non-empty array.");
  }
  const normalized = Array.from(new Set(value.map((item) => String(item)))) as string[];
  if (normalized.some((item) => item !== "decision" && item !== "regulation")) {
    throw new InvalidSearchRequestError("corpora accepts only decision and regulation.");
  }
  return normalized as SearchCorpus[];
}

export function rejectClientManagedSearchFields(body: Record<string, unknown>) {
  if (Object.prototype.hasOwnProperty.call(body, "queryEmbedding")) {
    throw new InvalidSearchRequestError("queryEmbedding is server-managed and cannot be supplied by API clients.");
  }
}

export function requestedCorpusFlags(corpora?: SearchCorpus[]) {
  return {
    wantsDecisions: !corpora || corpora.includes("decision"),
    wantsRegulations: !corpora || corpora.includes("regulation")
  };
}

export function missingSearchCorpusFeature(
  role: UserRole,
  tier: SubscriptionTier,
  { wantsDecisions, wantsRegulations }: ReturnType<typeof requestedCorpusFlags>
): TierFeatureKey | null {
  if (role === "admin") return null;
  if (wantsDecisions && !tierHasFeature(tier, "databaseRead")) return "databaseRead";
  if (wantsRegulations && !tierHasFeature(tier, "regulationRead")) return "regulationRead";
  return null;
}
