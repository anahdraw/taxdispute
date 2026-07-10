import type { AnalysisResult, AnalyzeInput } from "./analyze";
import type { ExtractionResult } from "./extraction";

export type StoredReport = {
  id: string;
  reportKey: string;
  title: string;
  taxpayerName: string;
  caseNumber: string;
  taxType: string;
  issueType: string;
  language: "id" | "en";
  input: AnalyzeInput;
  extraction?: ExtractionResult | null;
  analysis: AnalysisResult;
  modelChoice?: string;
  createdAt: string;
  updatedAt: string;
};

function normalizePart(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function buildReportKey(input: AnalyzeInput, extraction?: ExtractionResult | null, modelChoice?: string) {
  const decisionNumber = extraction?.putusanNumber || extraction?.skpNumber || extraction?.djpDecisionNumber || "";
  return [
    normalizePart(decisionNumber),
    normalizePart(input.taxpayerName || extraction?.taxpayerName),
    normalizePart(input.taxType || extraction?.taxType),
    normalizePart(input.issueType || extraction?.issueType),
    normalizePart(input.stage),
    normalizePart(input.correctionAmount || extraction?.correctionAmount),
    modelChoice ? `model:${normalizePart(modelChoice)}` : ""
  ]
    .filter(Boolean)
    .join("|");
}

export function buildStoredReport({
  input,
  extraction,
  analysis,
  language,
  modelChoice
}: {
  input: AnalyzeInput;
  extraction?: ExtractionResult | null;
  analysis: AnalysisResult;
  language: "id" | "en";
  modelChoice?: string;
}): StoredReport {
  const reportKey = buildReportKey(input, extraction, modelChoice);
  const caseNumber = extraction?.putusanNumber || extraction?.skpNumber || extraction?.djpDecisionNumber || input.issueType || "case";
  const taxpayerName = input.taxpayerName || extraction?.taxpayerName || "Taxpayer";
  const title = `${taxpayerName} - ${caseNumber}`;
  const now = new Date().toISOString();
  return {
    id: `report-${language}-${hashString(reportKey || title)}`,
    reportKey: reportKey || hashString(title),
    title,
    taxpayerName,
    caseNumber,
    taxType: input.taxType || extraction?.taxType || "",
    issueType: input.issueType || extraction?.issueType || "",
    language,
    input,
    extraction: extraction || null,
    analysis,
    modelChoice,
    createdAt: now,
    updatedAt: now
  };
}
