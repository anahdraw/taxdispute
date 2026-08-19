import { isAllowedOfficialRegulationUrl } from "./regulation-sources";
import { normalizeSearchText, searchTokens } from "./hybrid-search";
import type { SearchHit } from "./search-contracts";

export type CitationIssueCode =
  | "NO_EVIDENCE"
  | "LOW_RETRIEVAL_SCORE"
  | "NO_VERIFIED_SOURCE"
  | "MISSING_LOCATOR"
  | "UNKNOWN_LEGAL_STATUS"
  | "UNSUPPORTED_CLAIM"
  | "UNKNOWN_CITATION"
  | "INELIGIBLE_CITATION"
  | "MALFORMED_CITATION";

export type CitationIssue = {
  code: CitationIssueCode;
  message: string;
  claim?: string;
  citationId?: string;
};

export type CitationValidation = {
  valid: boolean;
  citedIds: string[];
  supportedClaims: number;
  substantiveClaims: number;
  coverage: number;
  issues: CitationIssue[];
};

export type TrustDecision = {
  allowAnswer: boolean;
  abstain: boolean;
  level: "high" | "medium" | "insufficient";
  score: number;
  summary: string;
  reasons: CitationIssue[];
  citationValidation?: CitationValidation;
  evidence: {
    retrieved: number;
    verified: number;
    located: number;
    officialRegulations: number;
  };
};

export type TrustPolicy = {
  minimumRetrievalScore: number;
  minimumEvidence: number;
  minimumCitationCoverage: number;
  requireLocator: boolean;
  requireVerifiedSource: boolean;
  requireKnownRegulationStatus: boolean;
};

export const DEFAULT_TRUST_POLICY: TrustPolicy = {
  minimumRetrievalScore: 30,
  minimumEvidence: 1,
  minimumCitationCoverage: 0.8,
  requireLocator: true,
  requireVerifiedSource: true,
  requireKnownRegulationStatus: true
};

const CITE_PATTERN = /\[\[cite:([a-zA-Z0-9._:/-]+)\]\]/g;
const ANY_CITE_START = /\[\[cite:/g;
const SHA256_HASH = /^(?:sha256:)?[a-f0-9]{64}$/i;
const SHORT_LEGAL_CLAIM = /\b(?:tarif|rate|ppn|vat|pph|pajak|tax|pasal|article|ayat|paragraph|denda|penalty|sanksi|bunga|interest|wajib|required|dilarang|prohibited|berlaku|effective|dicabut|revoked|sah|valid|batal|invalid)\b|(?:\b(?:rp|idr)\s*)\d|\d+(?:[.,]\d+)*\s*%/i;

export function citationMarker(sourceId: string) {
  if (!/^[a-zA-Z0-9._:/-]+$/.test(sourceId)) throw new Error("Citation source id contains unsupported characters.");
  return `[[cite:${sourceId}]]`;
}

function substantiveClaims(answer: string) {
  // Accept the common legal-writing style where a citation follows sentence
  // punctuation by moving the marker into that sentence before segmentation.
  return answer
    .replace(/([.!?])\s+((?:\[\[cite:[a-zA-Z0-9._:/-]+\]\]\s*)+)/g, " $2$1 ")
    .replace(/^#{1,6}\s+.*$/gm, "")
    .split(/\n+|(?<=[.!?])\s+/)
    .map((claim) => claim.replace(/^[-*+]\s+|^\d+[.)]\s+/, "").trim())
    .filter((claim) => {
      const plainClaim = claim.replace(CITE_PATTERN, " ").replace(/\s+/g, " ").trim();
      if (!plainClaim || /^(catatan|note|sumber|sources?)\s*:/i.test(plainClaim)) return false;
      return plainClaim.length >= 24 || SHORT_LEGAL_CLAIM.test(plainClaim);
    });
}

function numericFacts(value: string) {
  return Array.from(
    value.replace(CITE_PATTERN, " ").matchAll(/(?:\b(?:rp|idr)\s*)?\d+(?:[.,]\d+)*(?:\s*%)?/gi),
    (match) => match[0].toLowerCase().replace(/\s+/g, "").replace(/[.,]+$/, "")
  ).filter(Boolean);
}

function claimSupport(claim: string, source: SearchHit) {
  const withoutCitation = claim.replace(CITE_PATTERN, " ");
  const claimTerms = Array.from(new Set(searchTokens(withoutCitation)));
  if (!claimTerms.length) return 1;
  const evidence = [
    source.title,
    source.citation,
    source.snippet,
    source.locator?.page,
    source.locator?.paragraph,
    source.locator?.section
  ].filter((value) => value !== undefined && value !== null && String(value).trim()).join(" ");
  const claimNumbers = numericFacts(withoutCitation);
  const evidenceNumbers = new Set(numericFacts(evidence));
  if (claimNumbers.some((fact) => !evidenceNumbers.has(fact))) return 0;
  const evidenceTerms = new Set(searchTokens(normalizeSearchText(evidence)));
  const matched = claimTerms.filter((term) => evidenceTerms.has(term));
  return matched.length / claimTerms.length;
}

function sourceHasLocator(source: SearchHit) {
  return Boolean(
    source.locator && (
      (Number.isInteger(source.locator.page) && Number(source.locator.page) > 0) ||
      String(source.locator.paragraph || "").trim() ||
      String(source.locator.section || "").trim()
    )
  );
}

function sourceIsCitationEligible(source: SearchHit, minimumScore: number) {
  if (!Number.isFinite(source.score) || source.score < minimumScore || source.status !== "verified" || !SHA256_HASH.test(String(source.sourceHash || "").trim()) || !sourceHasLocator(source)) return false;
  return source.corpus === "decision" || isAllowedOfficialRegulationUrl(source.sourceUrl);
}

function currentLawStatusIsEligible(source: SearchHit) {
  if (source.corpus !== "regulation") return true;
  return ["active", "amended", "partially_revoked"].includes(String(source.metadata.legalStatus || ""));
}

function withCurrentLawCitationChecks(validation: CitationValidation, sources: readonly SearchHit[]) {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const issues = [...validation.issues];
  for (const citedId of validation.citedIds) {
    const source = sourceById.get(citedId);
    if (source?.corpus === "regulation" && !currentLawStatusIsEligible(source)) {
      issues.push({
        code: "INELIGIBLE_CITATION",
        citationId: citedId,
        message: `Citation ${citedId} does not have a verified in-force legal status for a current-law answer.`
      });
    }
  }
  if (issues.length === validation.issues.length) return validation;
  return { ...validation, valid: false, issues };
}

export function validateCitations(answer: string, sources: readonly SearchHit[], policy: Partial<TrustPolicy> = {}): CitationValidation {
  const effective = { ...DEFAULT_TRUST_POLICY, ...policy };
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const citedIds = Array.from(answer.matchAll(CITE_PATTERN), (match) => match[1]);
  const issues: CitationIssue[] = [];
  const markerStarts = Array.from(answer.matchAll(ANY_CITE_START)).length;
  if (markerStarts !== citedIds.length) {
    issues.push({ code: "MALFORMED_CITATION", message: "At least one citation marker is malformed." });
  }
  for (const citedId of new Set(citedIds)) {
    const source = sourceById.get(citedId);
    if (!source) {
      issues.push({ code: "UNKNOWN_CITATION", citationId: citedId, message: `Citation ${citedId} is not present in retrieved evidence.` });
    } else if (!sourceIsCitationEligible(source, effective.minimumRetrievalScore)) {
      issues.push({
        code: "INELIGIBLE_CITATION",
        citationId: citedId,
        message: `Citation ${citedId} is below the trust threshold or lacks verified immutable provenance and an inspectable locator.`
      });
    }
  }

  const claims = substantiveClaims(answer);
  let supportedClaims = 0;
  for (const claim of claims) {
    const claimIds = Array.from(claim.matchAll(CITE_PATTERN), (match) => match[1]);
    const candidates = claimIds
      .map((id) => sourceById.get(id))
      .filter((source): source is SearchHit => source !== undefined)
      .filter((source) => sourceIsCitationEligible(source, effective.minimumRetrievalScore));
    const supported = candidates.some((source) => claimSupport(claim, source) >= 0.22);
    if (supported) {
      supportedClaims += 1;
    } else {
      issues.push({
        code: "UNSUPPORTED_CLAIM",
        claim: claim.slice(0, 240),
        message: claimIds.length ? "The cited evidence has insufficient lexical support for this claim." : "This substantive claim has no citation."
      });
    }
  }
  const coverage = claims.length ? supportedClaims / claims.length : 0;
  const valid = !issues.some((issue) => issue.code === "MALFORMED_CITATION" || issue.code === "UNKNOWN_CITATION" || issue.code === "INELIGIBLE_CITATION") && coverage >= effective.minimumCitationCoverage;
  return { valid, citedIds: Array.from(new Set(citedIds)), supportedClaims, substantiveClaims: claims.length, coverage, issues };
}

export function assessTrust(
  sources: readonly SearchHit[],
  options: { answer?: string; asksCurrentLaw?: boolean; policy?: Partial<TrustPolicy>; language?: "id" | "en" } = {}
): TrustDecision {
  const policy = { ...DEFAULT_TRUST_POLICY, ...(options.policy || {}) };
  const language = options.language === "en" ? "en" : "id";
  const reasons: CitationIssue[] = [];
  const relevant = sources.filter((source) => source.score >= policy.minimumRetrievalScore);
  const verified = relevant.filter((source) => sourceIsCitationEligible(source, policy.minimumRetrievalScore));
  const located = relevant.filter(sourceHasLocator);
  const officialRegulations = relevant.filter((source) => source.corpus === "regulation" && isAllowedOfficialRegulationUrl(source.sourceUrl));

  if (relevant.length < policy.minimumEvidence) {
    reasons.push({ code: sources.length ? "LOW_RETRIEVAL_SCORE" : "NO_EVIDENCE", message: "Tidak ada bukti hasil retrieval yang memenuhi ambang minimum." });
  }
  if (policy.requireVerifiedSource && verified.length < policy.minimumEvidence) {
    reasons.push({ code: "NO_VERIFIED_SOURCE", message: "Belum ada sumber terverifikasi dengan provenance yang memadai." });
  }
  if (policy.requireLocator && located.length < policy.minimumEvidence) {
    reasons.push({ code: "MISSING_LOCATOR", message: "Belum ada penunjuk halaman, paragraf, atau bagian yang dapat diperiksa." });
  }
  if (options.asksCurrentLaw && policy.requireKnownRegulationStatus) {
    const knownStatus = verified.some((source) => source.corpus === "regulation" && currentLawStatusIsEligible(source));
    if (!knownStatus) reasons.push({ code: "UNKNOWN_LEGAL_STATUS", message: "Belum ada peraturan berstatus berlaku yang terverifikasi dari sumber resmi." });
  }

  let citationValidation: CitationValidation | undefined;
  if (options.answer !== undefined) {
    citationValidation = validateCitations(options.answer, sources, policy);
    if (options.asksCurrentLaw) citationValidation = withCurrentLawCitationChecks(citationValidation, sources);
    reasons.push(...citationValidation.issues);
    if (!citationValidation.valid && !citationValidation.issues.some((issue) => issue.code === "UNSUPPORTED_CLAIM")) {
      reasons.push({ code: "UNSUPPORTED_CLAIM", message: "Cakupan sitasi pada jawaban belum memenuhi kebijakan minimum." });
    }
  }

  const uniqueReasons = Array.from(new Map(reasons.map((reason) => [`${reason.code}:${reason.claim || ""}:${reason.citationId || ""}`, reason])).values());
  const score = Math.max(0, Math.min(100, Math.round(
    (Math.min(1, relevant.length / Math.max(1, policy.minimumEvidence)) * 25) +
      (relevant.length ? verified.length / relevant.length : 0) * 35 +
      (relevant.length ? located.length / relevant.length : 0) * 25 +
      (relevant[0] ? Math.min(1, relevant[0].score / 100) * 15 : 0)
  )));
  const abstain = uniqueReasons.length > 0;
  const level: TrustDecision["level"] = abstain ? "insufficient" : score >= 80 ? "high" : "medium";
  const summary = abstain
    ? language === "en"
      ? "The available sources are insufficient for a reliable answer. Verify the source document before relying on a conclusion."
      : "Sumber yang tersedia belum cukup untuk jawaban yang dapat diandalkan. Verifikasi dokumen sumber sebelum memakai kesimpulan."
    : language === "en"
      ? `Answer supported by ${verified.length} verified source(s) with inspectable locators.`
      : `Jawaban didukung ${verified.length} sumber terverifikasi dengan lokasi yang dapat diperiksa.`;

  return {
    allowAnswer: !abstain,
    abstain,
    level,
    score,
    summary,
    reasons: uniqueReasons,
    ...(citationValidation ? { citationValidation } : {}),
    evidence: { retrieved: relevant.length, verified: verified.length, located: located.length, officialRegulations: officialRegulations.length }
  };
}
