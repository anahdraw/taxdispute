import type { AnalyzeInput } from "./analyze";
import { callOpenAIWithPdf, configuredModel, extractJsonObject } from "./openai";

export type ExtractionResult = {
  filename: string;
  documentType: string;
  putusanNumber: string;
  putusanYear: string;
  courtPanel: string;
  judgeNames: string[];
  clerkName: string;
  procedureType: string;
  examinationLevel: string;
  caseFileNumber: string;
  decisionDate: string;
  hearingDate: string;
  taxpayerName: string;
  taxpayerNpwp: string;
  taxpayerAddress: string;
  representativeName: string;
  legalCounselName: string;
  legalCounselLicense: string;
  appelleeName: string;
  djpUnit: string;
  taxType: string;
  taxPeriod: string;
  skpNumber: string;
  djpDecisionNumber: string;
  issueType: string;
  issueSubtype: string;
  correctionAmount: string;
  correctionObject: string;
  correctionReason: string;
  taxpayerRebuttal: string;
  taxAuthorityPosition: string;
  taxpayerPosition: string;
  evidence: string[];
  legalReferences: string[];
  courtReasoning: string;
  outcome: string;
  summary: string;
  extractedAt: string;
  llmStatus: {
    used: boolean;
    model: string;
    message: string;
  };
};

export function extractionToAnalyzeInput(extraction: ExtractionResult, language: "id" | "en"): AnalyzeInput {
  return {
    taxpayerName: extraction.taxpayerName,
    taxType: extraction.taxType || (language === "en" ? "VAT" : "PPN"),
    issueType: extraction.issueType || extraction.issueSubtype || (language === "en" ? "VAT dispute" : "Sengketa PPN"),
    stage: extraction.documentType?.toLowerCase().includes("banding") ? (language === "en" ? "Appeal" : "Banding") : language === "en" ? "Appeal" : "Banding",
    correctionAmount: extraction.correctionAmount,
    taxAuthorityPosition: extraction.taxAuthorityPosition || extraction.correctionReason,
    taxpayerPosition: extraction.taxpayerPosition || extraction.taxpayerRebuttal,
    evidence: extraction.evidence || [],
    language
  };
}

function normalizeExtraction(raw: Partial<ExtractionResult>, filename: string): ExtractionResult {
  const evidence = Array.isArray(raw.evidence) ? raw.evidence.map(String).filter(Boolean).slice(0, 12) : [];
  const legalReferences = Array.isArray(raw.legalReferences) ? raw.legalReferences.map(String).filter(Boolean).slice(0, 12) : [];
  const judgeNames = Array.isArray(raw.judgeNames) ? raw.judgeNames.map(String).filter(Boolean).slice(0, 8) : [];
  return {
    filename,
    documentType: String(raw.documentType || ""),
    putusanNumber: String(raw.putusanNumber || ""),
    putusanYear: String(raw.putusanYear || ""),
    courtPanel: String(raw.courtPanel || ""),
    judgeNames,
    clerkName: String(raw.clerkName || ""),
    procedureType: String(raw.procedureType || ""),
    examinationLevel: String(raw.examinationLevel || ""),
    caseFileNumber: String(raw.caseFileNumber || ""),
    decisionDate: String(raw.decisionDate || ""),
    hearingDate: String(raw.hearingDate || ""),
    taxpayerName: String(raw.taxpayerName || ""),
    taxpayerNpwp: String(raw.taxpayerNpwp || ""),
    taxpayerAddress: String(raw.taxpayerAddress || ""),
    representativeName: String(raw.representativeName || ""),
    legalCounselName: String(raw.legalCounselName || ""),
    legalCounselLicense: String(raw.legalCounselLicense || ""),
    appelleeName: String(raw.appelleeName || ""),
    djpUnit: String(raw.djpUnit || ""),
    taxType: String(raw.taxType || ""),
    taxPeriod: String(raw.taxPeriod || ""),
    skpNumber: String(raw.skpNumber || ""),
    djpDecisionNumber: String(raw.djpDecisionNumber || ""),
    issueType: String(raw.issueType || ""),
    issueSubtype: String(raw.issueSubtype || ""),
    correctionAmount: String(raw.correctionAmount || ""),
    correctionObject: String(raw.correctionObject || ""),
    correctionReason: String(raw.correctionReason || ""),
    taxpayerRebuttal: String(raw.taxpayerRebuttal || ""),
    taxAuthorityPosition: String(raw.taxAuthorityPosition || raw.correctionReason || ""),
    taxpayerPosition: String(raw.taxpayerPosition || raw.taxpayerRebuttal || ""),
    evidence,
    legalReferences,
    courtReasoning: String(raw.courtReasoning || ""),
    outcome: String(raw.outcome || ""),
    summary: String(raw.summary || ""),
    extractedAt: new Date().toISOString(),
    llmStatus: {
      used: true,
      model: configuredModel(),
      message: "PDF extracted with LLM"
    }
  };
}

export async function extractPdfWithLlm(file: File, language: "id" | "en"): Promise<ExtractionResult> {
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength > 4 * 1024 * 1024) {
    throw new Error(language === "en" ? "PDF is too large for this prototype upload. Please use a file below 4 MB." : "PDF terlalu besar untuk upload prototype ini. Gunakan file di bawah 4 MB.");
  }
  const fileData = `data:application/pdf;base64,${bytes.toString("base64")}`;
  const system =
    language === "en"
      ? "You are an expert Indonesian tax dispute document extraction engine. Extract only what is supported by the PDF. Return JSON only."
      : "Anda adalah mesin ekstraksi dokumen sengketa pajak Indonesia. Ekstrak hanya data yang didukung PDF. Kembalikan JSON saja.";
  const prompt =
    language === "en"
      ? `Extract structured information from this tax dispute PDF. Return JSON with exactly these keys:
documentType, putusanNumber, putusanYear, courtPanel, judgeNames, clerkName, procedureType, examinationLevel, caseFileNumber, decisionDate, hearingDate, taxpayerName, taxpayerNpwp, taxpayerAddress, representativeName, legalCounselName, legalCounselLicense, appelleeName, djpUnit, taxType, taxPeriod, skpNumber, djpDecisionNumber, issueType, issueSubtype, correctionAmount, correctionObject, correctionReason, taxpayerRebuttal, taxAuthorityPosition, taxpayerPosition, evidence, legalReferences, courtReasoning, outcome, summary.
Use English for summaries, but keep official names/numbers in source language. judgeNames, evidence, and legalReferences must be arrays. If a field is unavailable, use an empty string or empty array.`
      : `Ekstrak informasi terstruktur dari PDF sengketa pajak ini. Kembalikan JSON dengan key persis berikut:
documentType, putusanNumber, putusanYear, courtPanel, judgeNames, clerkName, procedureType, examinationLevel, caseFileNumber, decisionDate, hearingDate, taxpayerName, taxpayerNpwp, taxpayerAddress, representativeName, legalCounselName, legalCounselLicense, appelleeName, djpUnit, taxType, taxPeriod, skpNumber, djpDecisionNumber, issueType, issueSubtype, correctionAmount, correctionObject, correctionReason, taxpayerRebuttal, taxAuthorityPosition, taxpayerPosition, evidence, legalReferences, courtReasoning, outcome, summary.
Gunakan Bahasa Indonesia untuk ringkasan, tetapi pertahankan nama/nomor resmi sesuai sumber. judgeNames, evidence, dan legalReferences harus array. Jika field tidak tersedia, isi string kosong atau array kosong.`;
  const text = await callOpenAIWithPdf(prompt, system, { filename: file.name, fileData });
  const parsed = extractJsonObject(text) as Partial<ExtractionResult>;
  return normalizeExtraction(parsed, file.name);
}
