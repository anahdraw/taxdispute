import type { StoredDecisionFile } from "./stored-decisions";
import type { Regulation } from "./mock-data";
import { DEFAULT_LLM_MODEL_CHOICE, type LlmModelChoice } from "./model-options";
import { callOpenAIText, configuredModel, hasRemoteLlm, missingKeyStatus, type LlmStatus } from "./openai";
import { tierWorkProfiles, type TierWorkProfile } from "./tier-profiles";
import { normalizeSmartAnswerMarkdown } from "./answer-format";
import { officialRegulationSourceLabel } from "./regulation-sources";
import { localizeRegulationRecord } from "./regulation-knowledge";

export type SmartChatSourceMode = "all" | "decisions" | "regulations";

export type SmartChatDecisionHit = {
  id: string;
  number: string;
  taxpayer: string;
  taxType: string;
  issue: string;
  outcome: string;
  score: number;
  snippet: string;
  matchReasons?: string[];
  url: string;
};

export type SmartChatRuleHit = {
  id: string;
  title: string;
  citation: string;
  topic: string;
  source: string;
  sourceUrl: string;
  score: number;
  snippet: string;
};

export type SmartChatChart = {
  title: string;
  type: "donut" | "bar";
  items: Array<{ label: string; value: number; color: string }>;
};

export type SmartChatResponse = {
  answer: string;
  decisionHits: SmartChatDecisionHit[];
  ruleHits: SmartChatRuleHit[];
  charts: SmartChatChart[];
  llmStatus: LlmStatus;
  retrieval: {
    mode: SmartChatSourceMode;
    totalDecisions: number;
    totalRegulations: number;
    usedDecisions: number;
    usedRegulations: number;
    tier: string;
    analysisDepth: string;
    regulationDepth: string;
    modelChoice: string;
  };
};

const COLORS = ["#009CDE", "#43A047", "#54585A", "#8A8F93", "#66C7EE", "#2E7D32", "#006F9F"];

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
  "berapa",
  "tentang",
  "putusan",
  "keputusan",
  "aturan",
  "peraturan",
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
  "how",
  "many",
  "is",
  "are",
  "was",
  "were",
  "does",
  "did",
  "do",
  "ever",
  "only",
  "show",
  "shows",
  "dispute",
  "disputes",
  "case",
  "cases",
  "decision",
  "decisions",
  "rule",
  "rules",
  "tax",
  "pajak",
  "sengketa",
  "apakah",
  "pernah",
  "wp",
  "djp"
]);

const RANKING_INTENT_WORDS = new Set([
  "win",
  "lose",
  "full",
  "partial",
  "outcome",
  "relevant",
  "similar",
  "matched",
  "terkait",
  "mirip",
  "dikabulkan",
  "ditolak",
  "menang",
  "kalah"
]);

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/transfer pricing|harga transfer|penentuan harga transfer/g, "transferpricing")
    .replace(/hubungan istimewa|pihak afiliasi|afiliasi/g, "relatedparty")
    .replace(/arm'?s length|kewajaran dan kelaziman|prinsip kewajaran/g, "armslength")
    .replace(/ppn|pajak pertambahan nilai/g, "vat")
    .replace(/pajak masukan/g, "inputvat")
    .replace(/dpp|dasar pengenaan pajak/g, "taxbase")
    .replace(/faktur pajak/g, "taxinvoice")
    .replace(/spt masa/g, "taxreturn")
    .replace(/menang|dikabulkan/g, "win")
    .replace(/kalah|ditolak/g, "lose")
    .replace(/sebagian|partial/g, "partial")
    .replace(/seluruhnya|full/g, "full")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenFrequency(text: string) {
  const frequency = new Map<string, number>();
  for (const token of normalize(text).split(" ")) {
    if (token.length <= 2 || STOP_WORDS.has(token)) continue;
    frequency.set(token, (frequency.get(token) || 0) + 1);
  }
  return frequency;
}

function cosineSimilarity(left: Map<string, number>, right: Map<string, number>) {
  if (!left.size || !right.size) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const value of left.values()) leftNorm += value * value;
  for (const value of right.values()) rightNorm += value * value;
  for (const [token, value] of left.entries()) {
    dot += value * (right.get(token) || 0);
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function shorten(text: string, length = 620) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, length);
}

function focusedSnippet(text: string, query: string, length = 720) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  const lower = clean.toLowerCase();
  const tokens = Array.from(new Set([...queryFocusTokens(query), ...queryTokens(query)])).filter((token) => token.length > 2);
  const hit = tokens
    .map((token) => lower.indexOf(token.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  if (hit === undefined || hit < 180) return shorten(clean, length);
  return `... ${shorten(clean.slice(Math.max(0, hit - 220)), length)}`;
}

function classifyOutcome(outcome: string, language: "id" | "en") {
  const text = outcome.toLowerCase();
  if (/dikabulkan seluruh|fully|granted in full|seluruhnya/.test(text)) {
    return language === "en" ? "Taxpayer fully prevailed" : "WP dikabulkan seluruhnya";
  }
  if (/dikabulkan sebagian|partial|partially|sebagian/.test(text)) {
    return language === "en" ? "Taxpayer partially prevailed" : "WP dikabulkan sebagian";
  }
  if (/tidak dapat diterima|gugur|formal|dismiss/.test(text)) {
    return language === "en" ? "Formal dismissal" : "Tidak dapat diterima / gugur";
  }
  if (/ditolak|djp|terbanding|authority|rejected|lose/.test(text)) {
    return language === "en" ? "Tax authority prevailed" : "DJP menang / banding ditolak";
  }
  return language === "en" ? "Unclassified" : "Belum terklasifikasi";
}

function decisionText(item: StoredDecisionFile) {
  const extraction = item.extraction;
  return [
    item.filename,
    extraction?.putusanNumber,
    extraction?.putusanYear,
    extraction?.taxpayerName,
    extraction?.taxType,
    extraction?.taxPeriod,
    extraction?.issueType,
    extraction?.issueSubtype,
    extraction?.correctionObject,
    extraction?.correctionReason,
    extraction?.taxAuthorityPosition,
    extraction?.taxpayerPosition,
    extraction?.taxpayerRebuttal,
    extraction?.courtReasoning,
    extraction?.outcome,
    extraction?.summary,
    extraction?.evidence?.join(" "),
    extraction?.legalReferences?.join(" ")
  ]
    .filter(Boolean)
    .join(" ");
}

function ruleText(item: Regulation) {
  return [item.topic, item.title, item.citation, item.focus, item.content, item.source].filter(Boolean).join(" ");
}

function queryTokens(query: string) {
  return normalize(query)
    .split(" ")
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function queryFocusTokens(query: string) {
  return queryTokens(query).filter((token) => !RANKING_INTENT_WORDS.has(token));
}

function tokenHits(text: string, tokens: string[]) {
  if (!tokens.length) return 0;
  const normalized = normalize(text);
  return tokens.filter((token) => normalized.includes(token)).length;
}

function regulationTopicIntent(query: string) {
  const text = normalize(query);
  if (/transferpricing|relatedparty|armslength|afiliasi|benchmark|p3b|treaty|map|apa/.test(text)) return "transfer_pricing";
  if (/vat|inputvat|taxbase|taxinvoice|bkp|jkp|ppnbm/.test(text)) return "vat";
  return "";
}

function regulationAuthorityBoost(item: Regulation) {
  const text = normalize([item.title, item.citation, item.content].filter(Boolean).join(" "));
  if (/undang undang|law|uu no|perpu/.test(text)) return 10;
  if (/government regulation|peraturan pemerintah|pp no/.test(text)) return 8;
  if (/minister|menteri keuangan|pmk/.test(text)) return 7;
  if (/direktur jenderal pajak|dgt|per pj|se pj/.test(text)) return 5;
  return 2;
}

function hybridRegulationScore(query: string, item: Regulation, text: string) {
  const queryVector = tokenFrequency(query);
  const cosineScore = cosineSimilarity(queryVector, tokenFrequency(text)) * 100;
  const focusTokens = queryFocusTokens(query);
  const fullTextHits = tokenHits(text, focusTokens);
  const titleHits = tokenHits([item.title, item.citation].filter(Boolean).join(" "), focusTokens);
  const focusCoverage = focusTokens.length ? fullTextHits / focusTokens.length : 0;
  const topicIntent = regulationTopicIntent(query);
  const normalizedQuery = normalize(query);
  const normalizedTitle = normalize([item.title, item.citation].filter(Boolean).join(" "));

  let score = cosineScore * 0.38;
  if (focusTokens.length) {
    score += focusCoverage * 26;
    if (titleHits) score += Math.min(28, 12 + titleHits * 5);
    if (!fullTextHits) score *= 0.4;
  }

  if (topicIntent && item.topic === topicIntent) score += 14;
  if (normalizedTitle.includes(normalizedQuery) || normalizedQuery.includes(normalizedTitle.slice(0, 24))) score += 18;
  if (/[0-9]{2,4}/.test(query) && tokenHits([item.title, item.citation].join(" "), queryTokens(query).filter((token) => /[0-9]/.test(token)))) {
    score += 16;
  }

  score += regulationAuthorityBoost(item) * 0.65;
  score += Math.min(8, Math.max(0, Number(item.relevance || 0) - 70) / 4);
  if (/berlaku|status|dicabut|diubah|amend|effective|revoked|current/i.test(query) && /status|berlaku|dicabut|diubah|amend|effective/i.test(item.content || "")) {
    score += 8;
  }
  if (/source|sumber|where|di mana|unduh|download|official/i.test(query) && item.sourceUrl) {
    score += 6;
  }

  return Math.max(0, Math.min(100, score));
}

function outcomeIntent(query: string) {
  const text = normalize(query);
  if (/\b(partial|sebagian)\b/.test(text)) return "partial";
  if (/\b(full|seluruhnya)\b/.test(text)) return "full";
  if (/\b(win|menang|dikabulkan)\b/.test(text)) return "win";
  if (/\b(lose|kalah|ditolak)\b/.test(text)) return "lose";
  return "";
}

function outcomeMatchesIntent(outcome: string, intent: string) {
  const text = normalize(outcome);
  if (!intent) return false;
  if (intent === "full") return /\bwin\b/.test(text) && /\bfull\b/.test(text);
  if (intent === "partial") return /\bwin\b/.test(text) && /\bpartial\b/.test(text);
  if (intent === "win") return /\bwin\b/.test(text);
  if (intent === "lose") return /\blose\b/.test(text);
  return false;
}

function hybridDecisionScore(query: string, item: StoredDecisionFile, text: string) {
  const queryVector = tokenFrequency(query);
  const cosineScore = cosineSimilarity(queryVector, tokenFrequency(text)) * 100;
  const focusTokens = queryFocusTokens(query);
  const extraction = item.extraction;
  const taxpayerHits = tokenHits(extraction?.taxpayerName || "", focusTokens);
  const numberHits = tokenHits(extraction?.putusanNumber || "", focusTokens);
  const issueHits = tokenHits([extraction?.taxType, extraction?.issueType, extraction?.issueSubtype, extraction?.correctionObject].filter(Boolean).join(" "), focusTokens);
  const fullTextHits = tokenHits(text, focusTokens);
  const focusCoverage = focusTokens.length ? fullTextHits / focusTokens.length : 0;
  const intent = outcomeIntent(query);
  const outcomeHit = outcomeMatchesIntent(extraction?.outcome || "", intent);
  const reasons: string[] = [];

  let score = cosineScore * 0.42;
  if (focusTokens.length) {
    score += focusCoverage * 30;
    if (taxpayerHits) {
      score += Math.min(34, 22 + taxpayerHits * 8);
      reasons.push("taxpayer/entity match");
    }
    if (numberHits) {
      score += 28;
      reasons.push("decision number match");
    }
    if (issueHits) {
      score += Math.min(18, 8 + issueHits * 5);
      reasons.push("tax/issue match");
    }
    if (!fullTextHits) {
      score *= 0.35;
      reasons.push("no specific keyword match");
    }
  }
  if (outcomeHit) {
    score += focusTokens.length ? 8 : 20;
    reasons.push("outcome intent match");
  }

  if (!reasons.length && cosineScore > 0) reasons.push("text similarity");
  return {
    score: Math.max(0, Math.min(100, score)),
    cosineScore,
    reasons
  };
}

export function rankDecisionDocuments(query: string, documents: StoredDecisionFile[], limit = 8) {
  return documents
    .filter((item) => item.extraction)
    .map((item) => {
      const text = decisionText(item);
      const scoring = hybridDecisionScore(query, item, text);
      return { item, score: scoring.score, text, reasons: scoring.reasons };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item, score, text, reasons }) => ({
      id: item.id,
      number: item.extraction?.putusanNumber || item.filename,
      taxpayer: item.extraction?.taxpayerName || "-",
      taxType: item.extraction?.taxType || "-",
      issue: item.extraction?.issueType || item.extraction?.issueSubtype || item.extraction?.correctionObject || "-",
      outcome: item.extraction?.outcome || "-",
      score: Math.round(score * 10) / 10,
      snippet: shorten(text),
      matchReasons: reasons,
      url: item.downloadUrl || item.url || ""
    }));
}

export function rankRegulations(query: string, records: Regulation[], limit = 8) {
  return records
    .map((item) => {
      const text = ruleText(item);
      return { item, score: hybridRegulationScore(query, item, text), text };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item, score, text }) => ({
      id: item.id,
      title: item.title,
      citation: item.citation,
      topic: item.topic || "general",
      source: officialRegulationSourceLabel(item.sourceUrl),
      sourceUrl: item.sourceUrl || "",
      score: Math.round(score * 10) / 10,
      snippet: focusedSnippet(text, query)
    }));
}

function hasChartIntent(question: string) {
  return /berapa|jumlah|distribusi|visual|chart|grafik|menang|kalah|win|lose|outcome|dikabulkan|ditolak|ratio|persentase|percentage/i.test(question);
}

function filterForStats(question: string, documents: StoredDecisionFile[]) {
  const ranked = rankDecisionDocuments(question, documents, Math.min(120, documents.length));
  const focusTokens = queryFocusTokens(question);
  const minimumScore = focusTokens.length ? 18 : 6;
  const scored = ranked.filter((item) => item.score >= minimumScore);
  const fallbackSize = focusTokens.length ? 12 : 60;
  const selectedIds = new Set((scored.length ? scored : ranked.slice(0, fallbackSize)).map((item) => item.id));
  return documents.filter((item) => selectedIds.has(item.id));
}

function buildCharts(question: string, documents: StoredDecisionFile[], language: "id" | "en"): SmartChatChart[] {
  if (!hasChartIntent(question)) return [];
  const selected = filterForStats(question, documents).filter((item) => item.extraction);
  if (!selected.length) return [];

  const outcomeCounts = new Map<string, number>();
  const issueCounts = new Map<string, number>();
  for (const item of selected) {
    const extraction = item.extraction;
    const outcome = classifyOutcome(extraction?.outcome || "", language);
    const issue = extraction?.issueType || extraction?.issueSubtype || extraction?.correctionObject || (language === "en" ? "Unclassified" : "Belum terklasifikasi");
    outcomeCounts.set(outcome, (outcomeCounts.get(outcome) || 0) + 1);
    issueCounts.set(issue, (issueCounts.get(issue) || 0) + 1);
  }

  return [
    {
      type: "donut",
      title: language === "en" ? "Outcome distribution for matched decisions" : "Distribusi outcome putusan yang relevan",
      items: Array.from(outcomeCounts.entries()).map(([label, value], index) => ({
        label,
        value,
        color: COLORS[index % COLORS.length]
      }))
    },
    {
      type: "bar",
      title: language === "en" ? "Top issues in matched decisions" : "Isu utama pada putusan yang relevan",
      items: Array.from(issueCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([label, value], index) => ({
          label,
          value,
          color: COLORS[(index + 1) % COLORS.length]
        }))
    }
  ];
}

function localSmartAnswer(
  question: string,
  language: "id" | "en",
  decisionHits: SmartChatDecisionHit[],
  ruleHits: SmartChatRuleHit[],
  charts: SmartChatChart[],
  tierProfile: TierWorkProfile
) {
  const decisionLine =
    decisionHits.length > 0
      ? decisionHits
          .slice(0, tierProfile.smartDecisionLimit)
          .map((item) => `- **${item.number}** — ${item.issue}; ${item.outcome}`)
          .join("\n")
      : language === "en"
        ? "- No closely matched decision was found."
        : "- Belum ada putusan yang cukup dekat.";
  const ruleLine =
    ruleHits.length > 0
      ? ruleHits
          .slice(0, tierProfile.smartRegulationLimit)
          .map((item) => `- **${item.citation}** — ${item.title}`)
          .join("\n")
      : language === "en"
        ? "- No closely matched regulation was found."
        : "- Belum ada aturan yang cukup dekat.";
  const chartLine = charts[0]
    ? charts[0].items.map((item) => `${item.label}: ${item.value}`).join(", ")
    : "";

  if (tierProfile.tier === "silver") {
    return language === "en"
      ? [
          "## Short answer",
          `The closest stored rules were screened for this question: **${question}**. This is a concise rule-level orientation, not a full case opinion.`,
          "## Main rule",
          ruleLine,
          "## Next step",
          "- Confirm the transaction facts and tax period.\n- Open the cited rule before relying on it.\n- Upgrade the review when decision comparisons or argument strategy are required."
        ].join("\n\n")
      : [
          "## Jawaban singkat",
          `Aturan tersimpan yang paling dekat telah disaring untuk pertanyaan: **${question}**. Ini merupakan orientasi aturan secara ringkas, bukan opini kasus penuh.`,
          "## Aturan utama",
          ruleLine,
          "## Langkah berikutnya",
          "- Konfirmasi fakta transaksi dan masa pajak.\n- Buka aturan yang dirujuk sebelum digunakan.\n- Lakukan pendalaman bila memerlukan pembanding putusan atau strategi argumentasi."
        ].join("\n\n");
  }

  if (tierProfile.tier === "gold") {
    return language === "en"
      ? [
          "## Executive answer",
          `The database was screened for both regulations and comparable decisions relevant to: **${question}**.`,
          "## Applicable rules",
          ruleLine,
          "## Relevant decisions",
          decisionLine,
          "## Practical implications",
          chartLine ? `- Matched outcome pattern: ${chartLine}.\n- Confirm that the cited facts and evidence align with the current case.` : "- Compare the facts, evidence chain, and procedural stage before relying on an outcome.",
          "## Next steps",
          "- Validate citations and decision texts.\n- Reconcile invoices, payments, returns, and correspondence.\n- Prepare an advisor review note for unresolved differences."
        ].join("\n\n")
      : [
          "## Jawaban eksekutif",
          `Database peraturan dan putusan pembanding telah disaring untuk pertanyaan: **${question}**.`,
          "## Aturan yang berlaku",
          ruleLine,
          "## Putusan relevan",
          decisionLine,
          "## Implikasi praktis",
          chartLine ? `- Pola outcome pembanding: ${chartLine}.\n- Pastikan fakta dan rantai bukti kasus saat ini sejalan dengan sumber.` : "- Bandingkan fakta, rantai bukti, dan tahap prosedural sebelum mengandalkan outcome.",
          "## Langkah berikutnya",
          "- Validasi sitasi dan teks putusan.\n- Rekonsiliasi faktur, pembayaran, SPT, dan korespondensi.\n- Siapkan catatan review advisor untuk perbedaan yang belum selesai."
        ].join("\n\n");
  }

  if (language === "en") {
    return [
      "## Executive summary",
      `A deep hybrid-RAG review was prepared for: **${question}**. The answer should be treated as a structured senior-review brief, subject to source validation.`,
      "## Issue map",
      "- Identify the disputed tax treatment, period, amount, procedural stage, and burden of proof.\n- Separate factual disagreements from legal interpretation and procedural defects.",
      "## Regulatory analysis",
      ruleLine,
      "## Decision pattern",
      decisionLine,
      "## Evidence assessment",
      "- Test consistency across invoices, contracts, payment flow, accounting records, returns, and third-party confirmation.\n- Record missing documents and contradictions by disputed transaction line.",
      "## Argument strategy",
      "- Lead with the strongest verified facts and controlling rules.\n- Use comparable decisions by analogy, while expressly distinguishing adverse facts.",
      "## Risks and counterarguments",
      chartLine ? `- Retrieved outcome pattern: ${chartLine}.\n- A comparable outcome alone does not establish that the facts are legally equivalent.` : "- Insufficient source coverage or weak evidence reconciliation can materially reduce the argument's reliability.",
      "## Recommended actions",
      "- Verify every citation against the source document.\n- Build an issue-by-issue evidence matrix.\n- Escalate unresolved legal conflicts for senior advisor review before filing or client delivery."
    ].join("\n\n");
  }
  return [
    "## Ringkasan eksekutif",
    `Review hybrid RAG mendalam disusun untuk: **${question}**. Jawaban ini merupakan brief terstruktur untuk review senior dan tetap memerlukan validasi sumber.`,
    "## Peta isu",
    "- Identifikasi perlakuan pajak, masa, nilai sengketa, tahap prosedural, dan beban pembuktian.\n- Pisahkan perbedaan fakta, interpretasi hukum, dan cacat prosedural.",
    "## Analisis peraturan",
    ruleLine,
    "## Pola putusan",
    decisionLine,
    "## Penilaian bukti",
    "- Uji konsistensi faktur, kontrak, aliran pembayaran, pembukuan, SPT, dan konfirmasi pihak ketiga.\n- Catat dokumen yang hilang dan kontradiksi per transaksi yang disengketakan.",
    "## Strategi argumentasi",
    "- Dahulukan fakta terverifikasi dan aturan yang paling mengikat.\n- Gunakan putusan pembanding secara analogi serta bedakan secara tegas fakta yang merugikan.",
    "## Risiko dan counterargument",
    chartLine ? `- Pola outcome hasil retrieval: ${chartLine}.\n- Kesamaan outcome saja tidak membuktikan fakta dan dasar hukum yang identik.` : "- Keterbatasan sumber atau rekonsiliasi bukti yang lemah dapat menurunkan keandalan argumentasi.",
    "## Rekomendasi tindakan",
    "- Verifikasi setiap sitasi pada dokumen sumber.\n- Susun matriks bukti per isu.\n- Eskalasi konflik hukum yang belum selesai untuk review senior sebelum filing atau penyampaian ke klien."
  ].join("\n\n");
}

function smartAnswerFormatContract(language: "id" | "en") {
  return language === "en"
    ? [
        "Mandatory response-format contract:",
        "- Return Markdown only; never return JSON or a Markdown table.",
        "- Put every section heading on its own line and prefix it with ##.",
        "- Add a blank line after every heading.",
        "- Except for the executive/short answer, use one concise idea per bullet or numbered action; never place numbered actions inline in a paragraph.",
        "- Keep paragraphs to at most 3 sentences and bullets to at most 45 words.",
        "- Use bold only for the key conclusion or citation, never for a complete paragraph.",
        "- Do not dump a chain of source identifiers in prose. Cite at most two strongest decision numbers or rule citations per section; the UI shows the complete source register below.",
        "- Do not repeat a section heading inside its body."
      ].join("\n")
    : [
        "Kontrak format jawaban wajib:",
        "- Kembalikan Markdown saja; jangan gunakan JSON atau tabel Markdown.",
        "- Tulis setiap heading bagian pada baris tersendiri dengan awalan ##.",
        "- Beri satu baris kosong setelah setiap heading.",
        "- Kecuali ringkasan/jawaban singkat, gunakan satu gagasan ringkas per bullet atau langkah bernomor; jangan menaruh langkah bernomor di dalam paragraf.",
        "- Batasi paragraf maksimal 3 kalimat dan bullet maksimal 45 kata.",
        "- Gunakan bold hanya untuk kesimpulan atau sitasi kunci, bukan seluruh paragraf.",
        "- Jangan menumpuk rangkaian nomor sumber di dalam narasi. Sebutkan maksimal dua nomor putusan atau sitasi aturan terkuat per bagian; daftar sumber lengkap ditampilkan UI di bawah.",
        "- Jangan mengulang heading bagian di dalam isi."
      ].join("\n");
}

export async function answerSmartChat({
  question,
  language,
  documents,
  regulations,
  mode,
  tierProfile = tierWorkProfiles.platinum,
  modelChoice = DEFAULT_LLM_MODEL_CHOICE,
  managedPrompt
}: {
  question: string;
  language: "id" | "en";
  documents: StoredDecisionFile[];
  regulations: Regulation[];
  mode: SmartChatSourceMode;
  tierProfile?: TierWorkProfile;
  modelChoice?: LlmModelChoice;
  managedPrompt?: { system?: string; instruction?: string };
}): Promise<SmartChatResponse> {
  const effectiveMode: SmartChatSourceMode = tierProfile.tier === "silver" ? "regulations" : tierProfile.tier === "gold" ? "all" : mode;
  const wantsDecisions = effectiveMode === "all" || effectiveMode === "decisions";
  const wantsRules = effectiveMode === "all" || effectiveMode === "regulations";
  const decisionHits = wantsDecisions ? rankDecisionDocuments(question, documents, tierProfile.smartDecisionLimit) : [];
  const ruleHits = wantsRules
    ? rankRegulations(question, regulations.map((item) => localizeRegulationRecord(item, language)), tierProfile.smartRegulationLimit)
    : [];
  const charts = wantsDecisions ? buildCharts(question, documents, language) : [];

  const retrieval = {
    mode: effectiveMode,
    totalDecisions: documents.filter((item) => item.extraction).length,
    totalRegulations: regulations.length,
    usedDecisions: decisionHits.length,
    usedRegulations: ruleHits.length,
    tier: tierProfile.tier,
    analysisDepth: tierProfile.analysisDepth,
    regulationDepth: tierProfile.regulationDepth,
    modelChoice
  };

  if (!hasRemoteLlm(modelChoice)) {
    const localAnswer = localSmartAnswer(question, language, decisionHits, ruleHits, charts, tierProfile);
    const status = missingKeyStatus(language, modelChoice);
    return {
      answer: localAnswer,
      decisionHits,
      ruleHits,
      charts,
      llmStatus: {
        ...status,
        message:
          language === "en"
            ? `${status.message} Source-grounded local analysis applied.`
            : `${status.message} Analisis lokal berbasis sumber digunakan.`
      },
      retrieval
    };
  }

  const defaultSystem =
    language === "en"
      ? `You are Smart Dispute Bot, an Indonesian tax dispute RAG assistant. Answer using only the retrieved decision and regulation context. Prioritize exact taxpayer/company matches, decision numbers, and issue matches over generic outcome matches. Cite decision numbers and rule citations, and say when context is insufficient. ${tierProfile.prompts.en.smartChatInstruction}`
      : `Anda adalah Smart Dispute Bot, asisten RAG sengketa pajak Indonesia. Jawab hanya dari konteks putusan dan peraturan yang diambil melalui retrieval. Prioritaskan kecocokan nama WP/perusahaan, nomor putusan, dan isu dibanding kecocokan outcome yang generik. Sebutkan nomor putusan dan sitasi aturan, dan katakan bila konteks belum cukup. ${tierProfile.prompts.id.smartChatInstruction}`;
  const systemBase = managedPrompt?.system?.trim() || defaultSystem;
  const system = `${systemBase}\n\n${smartAnswerFormatContract(language)}`;
  const prompt = JSON.stringify(
    {
      question,
      tierProfile: {
        tier: tierProfile.tier,
        analysisDepth: tierProfile.analysisDepth,
        regulationDepth: tierProfile.regulationDepth,
        decisionContextLimit: tierProfile.smartDecisionLimit,
        regulationContextLimit: tierProfile.smartRegulationLimit
      },
      retrievalPolicy:
        "The app already ranked context with hybrid relevance: cosine similarity plus boosts for exact taxpayer/company, decision number, tax/issue, and outcome intent. Use only these compact top hits to keep token usage efficient.",
      decisionContext: decisionHits.slice(0, tierProfile.smartDecisionLimit).map((item) => ({
        number: item.number,
        taxpayer: item.taxpayer,
        taxType: item.taxType,
        issue: item.issue,
        outcome: item.outcome,
        relevance: item.score,
        matchReasons: item.matchReasons || [],
        snippet: item.snippet
      })),
      regulationContext: ruleHits.slice(0, tierProfile.smartRegulationLimit).map((item) => ({
        title: item.title,
        citation: item.citation,
        topic: item.topic,
        similarity: item.score,
        snippet: item.snippet
      })),
      computedCharts: charts,
      responseLanguage: language,
      managedInstruction: managedPrompt?.instruction || "",
      outputReminder:
        language === "en"
          ? "Follow the mandatory Markdown response-format contract in the system message."
          : "Ikuti kontrak format jawaban Markdown wajib pada system message."
    },
    null,
    2
  );

  try {
    const answer = normalizeSmartAnswerMarkdown(await callOpenAIText(prompt, system, modelChoice));
    return {
      answer,
      decisionHits,
      ruleHits,
      charts,
      llmStatus: {
        used: true,
        model: configuredModel(modelChoice),
        message:
          language === "en"
            ? "Source-grounded hybrid RAG answer"
            : "Jawaban hybrid RAG berbasis sumber"
      },
      retrieval
    };
  } catch (error) {
    const localAnswer = localSmartAnswer(question, language, decisionHits, ruleHits, charts, tierProfile);
    return {
      answer: `${localAnswer}\n\n${
        language === "en" ? "LLM note" : "Catatan LLM"
      }: ${error instanceof Error ? error.message : "Unknown error"}`,
      decisionHits,
      ruleHits,
      charts,
      llmStatus: {
        used: false,
        model: configuredModel(modelChoice),
        message: language === "en" ? "LLM failed; using retrieved local answer." : "LLM gagal; memakai jawaban lokal dari retrieval."
      },
      retrieval
    };
  }
}
