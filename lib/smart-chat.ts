import type { StoredDecisionFile } from "./stored-decisions";
import type { Regulation } from "./mock-data";
import { callOpenAIText, configuredModel, hasOpenAIKey, missingKeyStatus, type LlmStatus } from "./openai";

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
  const queryVector = tokenFrequency(query);
  return records
    .map((item) => {
      const text = ruleText(item);
      return { item, score: cosineSimilarity(queryVector, tokenFrequency(text)), text };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item, score, text }) => ({
      id: item.id,
      title: item.title,
      citation: item.citation,
      topic: item.topic || "general",
      source: item.source || "seed",
      sourceUrl: item.sourceUrl || "",
      score: Math.round(score * 1000) / 10,
      snippet: shorten(text)
    }));
}

function hasDecisionIntent(question: string) {
  return /putusan|keputusan|case|decision|sengketa|menang|kalah|dikabulkan|ditolak|outcome|similar|mirip/i.test(question);
}

function hasRegulationIntent(question: string) {
  return /aturan|peraturan|pasal|pmk|per-|uu|law|regulation|regulated|diatur|dasar hukum|ortax/i.test(question);
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
  charts: SmartChatChart[]
) {
  const decisionLine =
    decisionHits.length > 0
      ? decisionHits
          .slice(0, 3)
          .map((item) => `${item.number} (${item.issue}; ${item.outcome})`)
          .join("; ")
      : language === "en"
        ? "no closely matched decision was found"
        : "belum ada putusan yang cukup dekat";
  const ruleLine =
    ruleHits.length > 0
      ? ruleHits
          .slice(0, 3)
          .map((item) => `${item.title} (${item.citation})`)
          .join("; ")
      : language === "en"
        ? "no closely matched regulation was found"
        : "belum ada aturan yang cukup dekat";
  const chartLine = charts[0]
    ? charts[0].items.map((item) => `${item.label}: ${item.value}`).join(", ")
    : "";

  if (language === "en") {
    return [
      `I screened the database with hybrid RAG retrieval before forming the answer. Relevant decisions: ${decisionLine}.`,
      `Relevant regulations: ${ruleLine}.`,
      chartLine ? `For the matched decisions, the outcome split is: ${chartLine}.` : "",
      "Use this as an initial research answer. For filing or client advice, review the cited decisions and regulations directly."
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  return [
    `Saya menyaring database dengan hybrid RAG retrieval sebelum menyusun jawaban. Putusan relevan: ${decisionLine}.`,
    `Peraturan relevan: ${ruleLine}.`,
    chartLine ? `Untuk putusan yang relevan, distribusi outcome adalah: ${chartLine}.` : "",
    "Gunakan ini sebagai jawaban riset awal. Untuk filing atau advice ke klien, tetap review langsung putusan dan peraturan yang dirujuk."
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function answerSmartChat({
  question,
  language,
  documents,
  regulations,
  mode
}: {
  question: string;
  language: "id" | "en";
  documents: StoredDecisionFile[];
  regulations: Regulation[];
  mode: SmartChatSourceMode;
}): Promise<SmartChatResponse> {
  const wantsDecisions = mode !== "regulations" && (mode === "decisions" || hasDecisionIntent(question) || !hasRegulationIntent(question));
  const wantsRules = mode !== "decisions" && (mode === "regulations" || hasRegulationIntent(question) || !hasDecisionIntent(question));
  const decisionHits = wantsDecisions ? rankDecisionDocuments(question, documents, 8) : [];
  const ruleHits = wantsRules ? rankRegulations(question, regulations, 8) : [];
  const charts = wantsDecisions ? buildCharts(question, documents, language) : [];

  const retrieval = {
    mode,
    totalDecisions: documents.filter((item) => item.extraction).length,
    totalRegulations: regulations.length,
    usedDecisions: decisionHits.length,
    usedRegulations: ruleHits.length
  };

  if (!hasOpenAIKey()) {
    return {
      answer: localSmartAnswer(question, language, decisionHits, ruleHits, charts),
      decisionHits,
      ruleHits,
      charts,
      llmStatus: missingKeyStatus(language),
      retrieval
    };
  }

  const system =
    language === "en"
      ? "You are Smart Dispute Bot, an Indonesian tax dispute RAG assistant. Answer using only the retrieved decision and regulation context. Prioritize exact taxpayer/company matches, decision numbers, and issue matches over generic outcome matches. Be concise but useful, cite decision numbers and rule citations, and say when context is insufficient."
      : "Anda adalah Smart Dispute Bot, asisten RAG sengketa pajak Indonesia. Jawab hanya dari konteks putusan dan peraturan yang diambil melalui retrieval. Prioritaskan kecocokan nama WP/perusahaan, nomor putusan, dan isu dibanding kecocokan outcome yang generik. Ringkas tetapi berguna, sebutkan nomor putusan dan sitasi aturan, dan katakan bila konteks belum cukup.";
  const prompt = JSON.stringify(
    {
      question,
      retrievalPolicy:
        "The app already ranked context with hybrid relevance: cosine similarity plus boosts for exact taxpayer/company, decision number, tax/issue, and outcome intent. Use only these compact top hits to keep token usage efficient.",
      decisionContext: decisionHits.slice(0, 5).map((item) => ({
        number: item.number,
        taxpayer: item.taxpayer,
        taxType: item.taxType,
        issue: item.issue,
        outcome: item.outcome,
        relevance: item.score,
        matchReasons: item.matchReasons || [],
        snippet: item.snippet
      })),
      regulationContext: ruleHits.slice(0, 5).map((item) => ({
        title: item.title,
        citation: item.citation,
        topic: item.topic,
        similarity: item.score,
        snippet: item.snippet
      })),
      computedCharts: charts,
      responseLanguage: language
    },
    null,
    2
  );

  try {
    const answer = await callOpenAIText(prompt, system);
    return {
      answer,
      decisionHits,
      ruleHits,
      charts,
      llmStatus: {
        used: true,
        model: configuredModel(),
        message: language === "en" ? "Smart Dispute Bot answered with hybrid RAG context" : "Smart Dispute Bot menjawab dengan konteks hybrid RAG"
      },
      retrieval
    };
  } catch (error) {
    return {
      answer: `${localSmartAnswer(question, language, decisionHits, ruleHits, charts)}\n\n${
        language === "en" ? "LLM note" : "Catatan LLM"
      }: ${error instanceof Error ? error.message : "Unknown error"}`,
      decisionHits,
      ruleHits,
      charts,
      llmStatus: {
        used: false,
        model: configuredModel(),
        message: language === "en" ? "LLM failed; using retrieved local answer." : "LLM gagal; memakai jawaban lokal dari retrieval."
      },
      retrieval
    };
  }
}
