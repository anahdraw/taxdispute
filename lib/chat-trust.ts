import { assessTrust, type TrustDecision } from "./citation-trust";
import { searchTokens } from "./hybrid-search";
import type { Regulation } from "./mock-data";
import { canonicalRegulationKey } from "./regulation-knowledge";
import { regulationToSearchDocuments } from "./search-corpus";
import type { SearchDocument, SearchHit } from "./search-contracts";

function documentSupport(document: SearchDocument, question: string) {
  const query = new Set(searchTokens(question));
  if (!query.size) return 0;
  const evidence = new Set(searchTokens(`${document.title} ${document.citation || ""} ${document.body}`));
  return [...query].filter((term) => evidence.has(term)).length / query.size;
}

function documentToHit(document: SearchDocument, score: number): SearchHit {
  return {
    id: document.id,
    corpus: document.corpus,
    title: document.title,
    citation: document.citation || "",
    snippet: document.body.slice(0, 1_200),
    sourceUrl: document.sourceUrl || "",
    sourceHash: document.sourceHash || "",
    authority: document.authority || "",
    locator: document.locator,
    effectiveFrom: document.effectiveFrom,
    effectiveTo: document.effectiveTo,
    status: document.status || "unknown",
    score: Math.max(0, Math.min(100, score)),
    lexicalScore: 0,
    semanticScore: null,
    exactMatch: false,
    matchedTerms: [],
    metadata: document.metadata || {},
    detailUrl: document.corpus === "regulation"
      ? `/sources/regulation/${encodeURIComponent(String(document.metadata?.canonicalKey || document.id))}`
      : ""
  };
}

export function regulationTrustHits(
  question: string,
  records: readonly Regulation[],
  scoreByCanonical: ReadonlyMap<string, number> = new Map()
) {
  const hits: SearchHit[] = [];
  for (const record of records) {
    const documents = regulationToSearchDocuments(record);
    if (!documents.length) continue;
    const ranked = [...documents].sort((left, right) => documentSupport(right, question) - documentSupport(left, question));
    const selected = ranked[0];
    const canonical = record.canonicalKey || canonicalRegulationKey(record);
    const rerankScore = scoreByCanonical.get(canonical) || scoreByCanonical.get(record.id) || 0;
    const support = documentSupport(selected, question);
    const score = rerankScore ? Math.min(100, rerankScore) : 30 + support * 55;
    hits.push(documentToHit(selected, score));
  }
  return hits.sort((left, right) => right.score - left.score);
}

export function assessRegulationChatTrust(
  question: string,
  records: readonly Regulation[],
  options: { language?: "id" | "en"; asOf?: string; scoreByCanonical?: ReadonlyMap<string, number> } = {}
): TrustDecision {
  const hits = regulationTrustHits(question, records, options.scoreByCanonical);
  return assessTrust(hits, { question, asOf: options.asOf, language: options.language });
}

export function chatAbstentionAnswer(language: "id" | "en", trust: TrustDecision) {
  const reasons = trust.reasons.slice(0, 4).map((reason) => `- ${reason.message}`).join("\n");
  return language === "en"
    ? `## I cannot answer this reliably yet\n\n${trust.summary}\n\n${reasons || "- The available context did not pass the trust gate."}\n\nAdd a tax type, tax period, regulation number, or an official document so I can retry.`
    : `## Jawaban belum dapat diberikan dengan aman\n\n${trust.summary}\n\n${reasons || "- Konteks yang tersedia belum lolos trust gate."}\n\nTambahkan jenis pajak, masa pajak, nomor aturan, atau dokumen resmi agar saya dapat mencoba kembali.`;
}
