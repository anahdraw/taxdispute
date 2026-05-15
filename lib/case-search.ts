import { comparableDecisions, outcomeLabels, type ComparableDecision } from "./mock-data";
import type { ExtractionResult } from "./extraction";

export type SimilarCaseResult = {
  decision: ComparableDecision;
  similarity: number;
  sharedTerms: string[];
  whySimilar: string;
  differences: string;
  useInArgument: string;
};

const STOP_WORDS = new Set([
  "yang",
  "dan",
  "atau",
  "dengan",
  "untuk",
  "pada",
  "dalam",
  "atas",
  "dari",
  "oleh",
  "karena",
  "bahwa",
  "ini",
  "itu",
  "the",
  "and",
  "or",
  "with",
  "for",
  "from",
  "that",
  "this",
  "tax",
  "pajak",
  "wp",
  "djp"
]);

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/ppn/g, "vat")
    .replace(/pajak pertambahan nilai/g, "vat")
    .replace(/pajak masukan/g, "input vat")
    .replace(/dpp/g, "tax base")
    .replace(/dasar pengenaan pajak/g, "tax base")
    .replace(/faktur pajak/g, "tax invoice")
    .replace(/spt masa/g, "vat return")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string) {
  return Array.from(
    new Set(
      normalize(text)
        .split(" ")
        .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
    )
  );
}

function overlapScore(queryTokens: string[], decisionTokens: string[]) {
  if (!queryTokens.length || !decisionTokens.length) return { score: 0, shared: [] as string[] };
  const decisionSet = new Set(decisionTokens);
  const shared = queryTokens.filter((token) => decisionSet.has(token));
  const jaccard = shared.length / new Set([...queryTokens, ...decisionTokens]).size;
  const queryCoverage = shared.length / queryTokens.length;
  return { score: jaccard * 0.45 + queryCoverage * 0.55, shared };
}

function decisionText(decision: ComparableDecision) {
  return [
    decision.number,
    decision.taxType,
    decision.issue,
    decision.amount,
    decision.reasoning,
    decision.implication,
    decision.matchPoints.join(" ")
  ].join(" ");
}

export function extractionToSearchText(extraction: ExtractionResult | null) {
  if (!extraction) return "";
  return [
    extraction.taxpayerName,
    extraction.taxType,
    extraction.taxPeriod,
    extraction.issueType,
    extraction.issueSubtype,
    extraction.correctionObject,
    extraction.correctionReason,
    extraction.taxpayerRebuttal,
    extraction.taxAuthorityPosition,
    extraction.taxpayerPosition,
    extraction.evidence.join(" "),
    extraction.legalReferences.join(" "),
    extraction.courtReasoning,
    extraction.summary
  ]
    .filter(Boolean)
    .join("\n");
}

export function searchSimilarCases(query: string, language: "id" | "en", limit = 5): SimilarCaseResult[] {
  const queryTokens = tokens(query);
  const queryNorm = normalize(query);
  const isVat = /\b(vat|ppn)\b/i.test(queryNorm);
  const isTaxBase = queryNorm.includes("tax base") || queryNorm.includes("dpp");
  const isInputVat = queryNorm.includes("input vat") || queryNorm.includes("masukan");
  const hasEvidenceTheme = /(evidence|bukti|invoice|faktur|payment|pembayaran|reconciliation|rekonsiliasi|spt|return)/i.test(queryNorm);
  const hasFormalTheme = /(formal|kuasa|banding|keberatan|jangka|gugur|diterima)/i.test(queryNorm);

  return comparableDecisions
    .map((decision) => {
      const decisionTokens = tokens(decisionText(decision));
      const { score, shared } = overlapScore(queryTokens, decisionTokens);
      let weighted = score * 62 + Math.min(shared.length * 4, 18);
      if (isVat && /vat|ppn/i.test(decision.taxType)) weighted += 14;
      if (isTaxBase && /tax base|dpp/i.test(decision.issue)) weighted += 22;
      if (isInputVat && /input vat|masukan/i.test(decision.issue)) weighted += 22;
      if (hasEvidenceTheme && /evidence|document|invoice|payment|reconciliation|bukti|faktur|spt/i.test(decisionText(decision))) weighted += 12;
      if (hasFormalTheme && /formal|dismissed|kuasa|prosedur|jangka/i.test(decisionText(decision))) weighted += 12;
      weighted += Math.min(decision.score / 10, 8);
      const similarity = Math.max(12, Math.min(96, Math.round(weighted)));
      const outcome = outcomeLabels[decision.outcome][language];
      const sharedReadable = shared.slice(0, 9).map((term) =>
        term
          .replace("vat", language === "id" ? "PPN" : "VAT")
          .replace("base", language === "id" ? "DPP" : "base")
          .replace("invoice", language === "id" ? "faktur" : "invoice")
          .replace("return", language === "id" ? "SPT" : "return")
      );

      const whySimilar =
        language === "en"
          ? `This decision is similar because it shares ${sharedReadable.length ? sharedReadable.join(", ") : "the same VAT dispute pattern"} with the input, has the ${decision.issue} issue profile, and turns on the way evidence is linked to the disputed correction. Outcome: ${outcome}.`
          : `Putusan ini mirip karena memiliki irisan ${sharedReadable.length ? sharedReadable.join(", ") : "pola sengketa PPN yang sama"} dengan input, berada pada profil isu ${decision.issue}, dan menilai hubungan bukti dengan koreksi yang disengketakan. Outcome: ${outcome}.`;

      const differences =
        language === "en"
          ? `Do not rely on it mechanically. Check the tax period, correction object, evidentiary chain, and whether the panel accepted or rejected the same type of rebuttal.`
          : `Jangan dipakai secara mekanis. Cek kembali masa pajak, objek koreksi, rantai bukti, dan apakah Majelis menerima atau menolak jenis bantahan yang sama.`;

      const useInArgument =
        language === "en"
          ? `Use it to map the factual similarity first, then cite only the reasoning that matches the taxpayer's evidence posture. ${decision.implication}`
          : `Gunakan untuk memetakan kemiripan fakta terlebih dahulu, lalu kutip hanya pertimbangan yang cocok dengan posisi bukti WP. ${decision.implication}`;

      return { decision, similarity, sharedTerms: sharedReadable, whySimilar, differences, useInArgument };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
