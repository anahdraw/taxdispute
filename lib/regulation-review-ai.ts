import { callOpenAIText, configuredModel, extractJsonObject, hasRemoteLlm, missingKeyStatus } from "./openai";
import { modelChoiceMeta, normalizeModelChoice, type LlmModelChoice } from "./model-options";
import type { ReviewItem, ReviewStatus } from "./regulation-review";

export type ReviewAiSuggestion = {
  suggestedStatus: ReviewStatus;
  confidence: number;
  summary: string;
  recommendedAction: string;
  checks: string[];
  risks: string[];
  questions: string[];
  evidenceCitations: string[];
};

export type ReviewAiResult = {
  suggestion: ReviewAiSuggestion;
  llmStatus: {
    used: boolean;
    model: string;
    message: string;
  };
  guardrail: string;
};

const fallbackStatus: ReviewStatus = "In Review";

function compact(value: unknown, max = 1800) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function uniqueStrings(value: unknown, max = 6) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => compact(item, 400)).filter(Boolean))].slice(0, max);
}

function safeConfidence(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.45;
  return Math.max(0, Math.min(1, number > 1 ? number / 100 : number));
}

function guardedStatus(item: ReviewItem, status: unknown): ReviewStatus {
  const candidate = String(status || "");
  if (!["Not Started", "In Review", "Verified", "Rejected", "Needs Source"].includes(candidate)) return fallbackStatus;
  const highRisk = item.flags.some((flag) => [
    "unresolved_target",
    "missing_source",
    "source_conflict",
    "status_site_conflict",
    "metadata_body_identity_mismatch",
    "contradictory_relation_types",
    "self_relation",
    "self_reference",
    "unparsed_reference",
    "missing_official_url",
    "missing_pdf",
    "missing_source_hash",
    "missing_locator",
    "unknown_legal_status",
    "missing_effective_date"
  ].includes(flag));
  // The assistant cannot promote a flagged or non-eligible record to Verified.
  if (candidate === "Verified" && (item.flags.length > 0 || item.eligibleForAnswer === false || item.verified !== true)) {
    return highRisk ? "Needs Source" : "In Review";
  }
  return candidate as ReviewStatus;
}

function fallbackSuggestion(item: ReviewItem): ReviewAiSuggestion {
  const sourceGap = item.flags.some((flag) => ["unresolved_target", "missing_source", "source_conflict", "status_site_conflict", "unparsed_reference", "missing_official_url", "missing_pdf", "missing_source_hash", "missing_locator", "unknown_legal_status", "missing_effective_date"].includes(flag));
  const highRisk = item.severity === "High" || sourceGap;
  return {
    suggestedStatus: highRisk ? "Needs Source" : fallbackStatus,
    confidence: highRisk ? 0.78 : 0.58,
    summary: highRisk
      ? "Item belum aman untuk disahkan karena masih memiliki gap sumber, identitas, status, atau target relasi."
      : "Item perlu pemeriksaan manual terhadap evidence dan konteks sebelum dapat dipublikasikan.",
    recommendedAction: highRisk
      ? "Cari sumber resmi dan locator yang dapat diaudit, lalu cocokkan kembali identitas serta status berlakunya."
      : "Bandingkan metadata dengan naskah sumber, cek relasi dan locator, lalu simpan keputusan reviewer.",
    checks: [
      item.sourceUrl ? "Buka sumber resmi dan pastikan URL dapat diakses." : "Tambahkan sumber resmi yang dapat dibuka.",
      item.locator ? "Validasi locator pasal/halaman terhadap naskah sumber." : "Tambahkan locator pasal/halaman.",
      item.canonical ? `Konfirmasi canonical identity: ${item.canonical}.` : "Konfirmasi nomor, tahun, dan jenis peraturan."
    ],
    risks: item.flags.slice(0, 5).map((flag) => compact(flag.replaceAll("_", " "))),
    questions: [
      "Apakah sumber ini resmi dan merupakan versi konsolidasi yang benar?",
      "Apakah relasi atau sitasi ini didukung teks sumber, bukan hanya metadata?"
    ],
    evidenceCitations: [item.canonical || item.id].filter(Boolean)
  };
}

function normalizeSuggestion(item: ReviewItem, parsed: unknown): ReviewAiSuggestion {
  const value = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const fallback = fallbackSuggestion(item);
  return {
    suggestedStatus: guardedStatus(item, value.suggestedStatus || value.recommendedStatus || fallback.suggestedStatus),
    confidence: safeConfidence(value.confidence ?? fallback.confidence),
    summary: compact(value.summary || fallback.summary, 1200),
    recommendedAction: compact(value.recommendedAction || value.nextAction || fallback.recommendedAction, 1200),
    checks: uniqueStrings(value.checks).length ? uniqueStrings(value.checks) : fallback.checks,
    risks: uniqueStrings(value.risks).length ? uniqueStrings(value.risks) : fallback.risks,
    questions: uniqueStrings(value.questions).length ? uniqueStrings(value.questions) : fallback.questions,
    evidenceCitations: uniqueStrings(value.evidenceCitations || value.citations).length
      ? uniqueStrings(value.evidenceCitations || value.citations)
      : fallback.evidenceCitations
  };
}

function promptFor(item: ReviewItem) {
  return JSON.stringify({
    task: "Assist an internal reviewer of an Indonesian regulation quality queue.",
    rule: "Use only the supplied item. Do not invent legal conclusions or sources. A flagged item must not be promoted to Verified unless the reviewer independently confirms it; recommend Needs Source or In Review when evidence is incomplete.",
    outputSchema: {
      suggestedStatus: "Not Started | In Review | Verified | Rejected | Needs Source",
      confidence: "number from 0 to 1",
      summary: "short Indonesian explanation",
      recommendedAction: "one practical next step",
      checks: ["concrete checks for the employee"],
      risks: ["flags or uncertainty"],
      questions: ["questions the reviewer must answer"],
      evidenceCitations: ["only identifiers present in the item"]
    },
    item: {
      kind: item.kind,
      id: item.id,
      severity: item.severity,
      flags: item.flags,
      source: item.source,
      target: item.target,
      type: item.type,
      canonical: item.canonical,
      title: compact(item.title),
      sourceUrl: item.sourceUrl,
      statusSite: compact(item.statusSite),
      confidence: item.confidence,
      verified: item.verified,
      eligibleForAnswer: item.eligibleForAnswer,
      raw: compact(item.raw),
      evidence: compact(item.evidence),
      context: compact(item.context),
      locator: item.locator
    }
  }, null, 2);
}

export async function buildReviewAiSuggestion(item: ReviewItem, modelChoice: LlmModelChoice | string = "local-rules"): Promise<ReviewAiResult> {
  const choice = normalizeModelChoice(modelChoice);
  const fallback = fallbackSuggestion(item);
  if (!hasRemoteLlm(choice)) {
    return {
      suggestion: fallback,
      llmStatus: missingKeyStatus("id", choice),
      guardrail: "Mode lokal: saran hanya triage berbasis flag; tidak boleh dianggap sebagai verifikasi hukum."
    };
  }

  const system = "Anda adalah asisten quality-control internal untuk database peraturan Indonesia. Berikan saran triage yang konservatif dan dapat diaudit. Jangan mengarang sumber. Jangan menyatakan item verified hanya karena confidence tinggi. Jawab JSON valid sesuai schema.";
  const raw = await callOpenAIText(promptFor(item), system, choice);
  const suggestion = normalizeSuggestion(item, extractJsonObject(raw));
  return {
    suggestion,
    llmStatus: {
      used: true,
      model: configuredModel(choice),
      message: `Saran AI dibuat dengan ${modelChoiceMeta(choice).label}. Semua keputusan tetap memerlukan reviewer.`
    },
    guardrail: "Saran AI dibatasi pada evidence item dan status Verified tetap memerlukan konfirmasi manusia."
  };
}
