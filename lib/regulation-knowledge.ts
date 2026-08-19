import { regulations, type Regulation, type RegulationRelation, type RegulationRelationType, type RegulationTranslation } from "./mock-data";
import { isAllowedLocalPdfReference, isAllowedOfficialRegulationUrl, officialRegulationSourceLabel } from "./regulation-sources";

export type RegulationTopic = "vat" | "income_tax" | "transfer_pricing" | "general";

export const regulationTopicOptions: Array<{ key: RegulationTopic; id: string; en: string }> = [
  { key: "transfer_pricing", id: "Transfer Pricing", en: "Transfer Pricing" },
  { key: "vat", id: "PPN / VAT", en: "VAT / PPN" },
  { key: "income_tax", id: "PPh", en: "Income Tax" },
  { key: "general", id: "Umum", en: "General" }
];

export function normalizeRegulationText(value: unknown) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/(?:\\r\\n|\\n|\\r)+/g, "\n")
    .replace(/&#10;|&#13;|&NewLine;/gi, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\.{2,}/g, ".")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function removeThirdPartySourceMentions(value: unknown) {
  return normalizeRegulationText(value)
    .replace(/\s*(?:ortax|hukumonline|ddtc)\s+(?:source|sumber)[^\n.]*\.?/gi, "")
    .replace(/^\s*(?:source|sumber)\s*:\s*(?:ortax|hukumonline|ddtc)[^\n]*$/gim, "")
    .replace(/\n{2,}/g, "\n")
    .replace(/\bcoretax\b/gi, "sistem inti administrasi perpajakan DJP")
    .trim();
}

function removeExternalProductNames(value: unknown) {
  return normalizeRegulationText(value).replace(/\bcoretax\b/gi, "sistem inti administrasi perpajakan DJP");
}

export function canonicalRegulationKey(record: Pick<Regulation, "citation" | "title">) {
  const normalized = normalizeRegulationText(`${record.citation || ""} ${record.title || ""}`)
    .toLowerCase()
    .replace(/peraturan menteri keuangan/g, "pmk")
    .replace(/peraturan direktur jenderal pajak/g, "per")
    .replace(/keputusan direktur jenderal pajak/g, "kep")
    .replace(/surat edaran direktur jenderal pajak/g, "se")
    .replace(/peraturan pemerintah/g, "pp")
    .replace(/undang[ -]undang/g, "uu")
    .replace(/minister(?:ial)? of finance regulation/g, "pmk")
    .replace(/government regulation/g, "pp")
    .replace(/dgt regulation/g, "per")
    .replace(/value added tax law|vat law|\blaw\b/g, "uu")
    .replace(/nomor|number|no\.?/g, " ")
    .replace(/tahun|year/g, " ")
    .replace(/sebagaimana.*$|as amended.*$/g, " ")
    .replace(/[^a-z0-9/.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Capture the first regulation number after its type and the first four-digit
  // year that follows. Older citations such as `141/PMK.03/2015` contain an
  // internal administrative code (`03`) that must not replace the actual
  // regulation number (`141`).
  const match = normalized.match(/\b(uu|pp|pmk|per|kep|se)\b[^0-9]*([0-9]+)[\s\S]*?\b((?:19|20)\d{2})\b/i);
  return match ? `${match[1].toLowerCase()}-${Number(match[2])}-${match[3]}` : normalized || "unknown-regulation";
}

const CURATED_EN_TRANSLATIONS: Record<string, RegulationTranslation> = {
  "uu-8-1983": {
    title: "Value Added Tax and Luxury Goods Sales Tax Law",
    focus: "VAT objects, taxable entrepreneurs, tax base, rates, tax invoices, input VAT, exports/imports, and luxury goods sales tax."
  },
  "pp-44-2022": {
    title: "Implementing Regulation for VAT and Luxury Goods Sales Tax",
    focus: "Implementing rules on taxable supplies, VAT objects, tax base, and the timing of VAT becoming payable."
  },
  "uu-7-2021": {
    title: "Tax Regulation Harmonization Law",
    focus: "Amendments covering general tax procedure, income tax, VAT, voluntary disclosure, carbon tax, and excise."
  },
  "pmk-172-2023": {
    title: "Arm's-Length Principle and Related-Party Transactions",
    focus: "Transfer-pricing framework covering related parties, comparability, method selection, documentation, APA, and MAP."
  }
};

export function localizeRegulationRecord(record: Regulation, language: "id" | "en"): Regulation {
  const explicit = record.translations?.[language];
  const curated = language === "en" ? CURATED_EN_TRANSLATIONS[record.canonicalKey || canonicalRegulationKey(record)] : undefined;
  const translation = explicit || curated;
  return translation
    ? { ...record, title: translation.title || record.title, focus: translation.focus || record.focus, content: translation.content || record.content }
    : record;
}

export function normalizeRegulationTopic(value: string | undefined | null): RegulationTopic {
  const topic = String(value || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (["transfer_pricing", "tp", "transfer", "harga_transfer", "hubungan_istimewa"].includes(topic)) {
    return "transfer_pricing";
  }
  if (["vat", "ppn", "pajak_pertambahan_nilai"].includes(topic)) {
    return "vat";
  }
  if (["income_tax", "income", "pph", "pajak_penghasilan"].includes(topic)) {
    return "income_tax";
  }
  return "general";
}

export function regulationTopicLabel(topic: RegulationTopic, language: "id" | "en") {
  return regulationTopicOptions.find((item) => item.key === topic)?.[language] || topic;
}

function relationTypeFromSentence(sentence: string): RegulationRelationType {
  if (/dicabut\s+oleh/i.test(sentence)) return "revoked_by";
  if (/diubah\s+oleh/i.test(sentence)) return "amended_by";
  if (/mencabut|menggantikan|tidak berlaku/i.test(sentence)) return "revokes";
  if (/mengubah|perubahan atas/i.test(sentence)) return "amends";
  if (/melaksanakan|pelaksanaan|aturan pelaksana/i.test(sentence)) return "implements";
  if (/berdasarkan|mengingat|merujuk|rujukan/i.test(sentence)) return "references";
  return "related";
}

export function deriveRegulationRelations(record: Regulation): RegulationRelation[] {
  // An imported record may deliberately carry an empty relation list after a
  // graph quality gate.  Treat that as an explicit decision, not as a signal
  // to rerun the permissive seed regex over a large full-text snapshot.
  const hasExplicitRelations = Array.isArray(record.relations);
  const explicit = hasExplicitRelations ? record.relations || [] : record.extraction?.relations || [];
  if (hasExplicitRelations || explicit.length) return explicit;
  const text = normalizeRegulationText(`${record.focus || ""}\n${record.content || ""}`);
  // Do not treat the dot in the ubiquitous legal abbreviation `No.` as the
  // end of a sentence; otherwise the instrument type and its number are split
  // into different fragments before citation extraction.
  const sentenceSafeText = text.replace(/\bNo\.\s+/gi, "No ");
  const relations: RegulationRelation[] = [];
  const seen = new Set<string>();
  const recordKey = record.canonicalKey || canonicalRegulationKey(record);
  // A legal citation must begin with a digit after the instrument type.
  // Requiring that digit prevents `PER`/`SE` from matching ordinary words
  // such as "perubahan", "perpajakan", or "sejak".
  const citationPattern = /\b(?:UU|PERPU|PP|PMK|PER|KEP|SE)\s*(?:No\.?|Nomor)?\s*\d[0-9A-Z./-]*(?:\s+Tahun\s+\d{4})?/gi;
  for (const sentence of sentenceSafeText.split(/(?<=[.!?])\s+|\n+/).filter(Boolean)) {
    if (!/mencabut|menggantikan|mengubah|perubahan|melaksanakan|pelaksanaan|berdasarkan|mengingat|merujuk|dicabut|diubah/i.test(sentence)) continue;
    for (const match of sentence.matchAll(citationPattern)) {
      const citation = normalizeRegulationText(match[0]).replace(/[.,;:]+$/, "");
      const citationKey = canonicalRegulationKey({ citation, title: "" });
      if (!citation || citationKey === recordKey) continue;
      const type = relationTypeFromSentence(sentence);
      const key = `${type}:${citationKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      relations.push({ type, citation, note: sentence, source: "seed" });
    }
  }
  return relations;
}

function recordQuality(item: Regulation) {
  let score = item.source === "official" ? 40 : item.source === "manual" ? 25 : 0;
  if (isAllowedOfficialRegulationUrl(item.sourceUrl)) score += 100;
  if (/\b(?:uu|pp|pmk|per|kep|se)\b/i.test(`${item.title} ${item.citation}`)) score += 12;
  if (item.sourceLanguage === "id") score += 50;
  if (item.updatedAt) score += 10;
  if (item.officialPdfUrl || item.pdfUrl) score += 60;
  if (item.storedPdfUrl) score += 80;
  if (item.extraction) score += 120;
  if (item.ingestionStatus === "ready") score += 70;
  if (item.ingestionStatus === "review_required") score += 30;
  return score;
}

export function mergeRegulationRecords(records: Regulation[]) {
  const merged = new Map<string, Regulation>();
  for (const item of [...regulations, ...records]) {
    const sourceUrl = isAllowedOfficialRegulationUrl(item.sourceUrl) ? String(item.sourceUrl) : "";
    const officialPdfUrl = isAllowedOfficialRegulationUrl(item.officialPdfUrl || item.pdfUrl) ? String(item.officialPdfUrl || item.pdfUrl) : "";
    const localPdfUrl = isAllowedLocalPdfReference(item.storedPdfUrl || item.pdfUrl) ? String(item.storedPdfUrl || item.pdfUrl) : "";
    const canonicalKey = item.canonicalKey || canonicalRegulationKey(item);
    const normalized: Regulation = {
      ...item,
      title: normalizeRegulationText(item.title),
      citation: normalizeRegulationText(item.citation),
      focus: removeExternalProductNames(item.focus),
      content: removeThirdPartySourceMentions(item.content),
      canonicalKey,
      sourceLanguage: item.sourceLanguage || (/\b(?:undang-undang|peraturan|pajak|tahun)\b/i.test(`${item.title} ${item.focus}`) ? "id" : "en"),
      topic: item.topic || normalizeRegulationTopic(item.topic),
      source: sourceUrl || officialPdfUrl ? "official" : item.source === "seed" ? "seed" : "manual",
      sourceUrl,
      officialPdfUrl,
      pdfUrl: localPdfUrl || item.storedPdfUrl || officialPdfUrl,
      pdfUrls: Array.from(new Set([...(item.pdfUrls || []), ...(localPdfUrl ? [localPdfUrl] : []), ...(officialPdfUrl ? [officialPdfUrl] : [])])),
      sourceAuthority: officialRegulationSourceLabel(sourceUrl || officialPdfUrl),
      relevance: item.relevance || 70,
      ingestionStatus: item.ingestionStatus || (item.extraction ? "ready" : "seed")
    };
    normalized.relations = deriveRegulationRelations(normalized);
    const previous = merged.get(canonicalKey);
    if (!previous) {
      merged.set(canonicalKey, normalized);
      continue;
    }
    const preferred = recordQuality(normalized) >= recordQuality(previous) ? normalized : previous;
    const fallback = preferred === normalized ? previous : normalized;
    merged.set(canonicalKey, {
      ...fallback,
      ...preferred,
      sourceUrl: preferred.sourceUrl || fallback.sourceUrl,
      pdfUrl: preferred.pdfUrl || fallback.pdfUrl,
      officialPdfUrl: preferred.officialPdfUrl || fallback.officialPdfUrl,
      storedPdfUrl: preferred.storedPdfUrl || fallback.storedPdfUrl,
      pdfUrls: Array.from(new Set([...(preferred.pdfUrls || []), ...(fallback.pdfUrls || [])])),
      sourceAuthority: preferred.sourceAuthority || fallback.sourceAuthority,
      canonicalKey,
      sourceLanguage: preferred.sourceLanguage || fallback.sourceLanguage,
      translations: { ...(fallback.translations || {}), ...(preferred.translations || {}) },
      content: preferred.content || fallback.content,
      ingestionMessage: preferred.ingestionMessage || fallback.ingestionMessage,
      fileHash: preferred.fileHash || fallback.fileHash,
      extraction: preferred.extraction || fallback.extraction || null,
      relations: preferred.relations?.length ? preferred.relations : fallback.relations || [],
      extractedAt: preferred.extractedAt || fallback.extractedAt,
      updatedAt: preferred.updatedAt || fallback.updatedAt
    });
  }
  return Array.from(merged.values()).sort((a, b) => {
    const topicOrder = String(a.topic || "").localeCompare(String(b.topic || ""));
    return topicOrder || (b.relevance || 0) - (a.relevance || 0);
  });
}

export function filterRegulationsByTopic(records: Regulation[], topic: RegulationTopic | "all") {
  if (topic === "all") return records;
  return records.filter((item) => (item.topic || "general") === topic);
}

function normalizeSearch(text: string) {
  return String(text || "")
    .toLowerCase()
    .replace(/transfer pricing|harga transfer|penentuan harga transfer/g, "transferpricing")
    .replace(/hubungan istimewa|pihak afiliasi|afiliasi/g, "relatedparty")
    .replace(/arm'?s length|kewajaran dan kelaziman|prinsip kewajaran/g, "armslength")
    .replace(/ppn|pajak pertambahan nilai/g, "vat")
    .replace(/pajak masukan/g, "inputvat")
    .replace(/dpp|dasar pengenaan pajak/g, "taxbase")
    .replace(/faktur pajak/g, "taxinvoice")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function regulationSearchScore(item: Regulation, question: string, inferredTopic: RegulationTopic) {
  const queryTokens = normalizeSearch(question)
    .split(" ")
    .filter((token) => token.length > 2);
  const text = normalizeSearch([item.title, item.citation, item.focus, item.content].filter(Boolean).join(" "));
  const title = normalizeSearch([item.title, item.citation].filter(Boolean).join(" "));
  const hits = queryTokens.filter((token) => text.includes(token)).length;
  const titleHits = queryTokens.filter((token) => title.includes(token)).length;
  const coverage = queryTokens.length ? hits / queryTokens.length : 0;
  let score = coverage * 56 + titleHits * 8 + Number(item.relevance || 0) * 0.16;
  if ((item.topic || "general") === inferredTopic) score += 18;
  if (/[0-9]{2,4}/.test(question) && queryTokens.some((token) => /[0-9]/.test(token) && title.includes(token))) score += 18;
  if (/berlaku|status|dicabut|diubah|amend|effective|revoked/i.test(question) && /status|berlaku|dicabut|diubah|amend|effective/i.test(item.content || "")) score += 8;
  if (item.ingestionStatus === "ready") score += 14;
  if (item.extraction) score += 12;
  if (item.storedPdfUrl) score += 6;
  return score;
}

export function buildOfficialRegulationSeeds(topicValue: string): Regulation[] {
  const topic = normalizeRegulationTopic(topicValue);
  const now = new Date().toISOString();
  if (topic === "transfer_pricing") {
    return [
      {
        id: "official-pmk-172-transfer-pricing",
        topic,
        title: "Penerapan Prinsip Kewajaran dan Kelaziman Usaha",
        citation: "PMK No. 172 Tahun 2023",
        focus:
          "Kerangka utama transfer pricing: hubungan istimewa, penerapan prinsip kewajaran dan kelaziman usaha, analisis kesebandingan, metode transfer pricing, dokumentasi, secondary adjustment, APA, dan MAP.",
        relevance: 98,
        source: "official",
        sourceUrl: "https://jdih.kemenkeu.go.id/dok/pmk-172-tahun-2023",
        content:
          "Gunakan sebagai rujukan utama untuk sengketa transfer pricing modern, terutama ketika isu berkaitan dengan hubungan istimewa, metode pembanding, kewajaran margin, dokumentasi, dan pembuktian substansi transaksi.",
        updatedAt: now
      },
      {
        id: "official-pmk-213-tp-doc",
        topic,
        title: "Jenis Dokumen dan/atau Informasi Tambahan yang Wajib Disimpan oleh Wajib Pajak yang Melakukan Transaksi dengan Pihak Afiliasi",
        citation: "PMK No. 213/PMK.03/2016",
        focus:
          "Kewajiban dokumentasi transfer pricing, termasuk master file, local file, dan country-by-country report untuk WP dengan transaksi afiliasi.",
        relevance: 92,
        source: "seed",
        sourceUrl: "",
        content:
          "Pakai untuk mengecek kesiapan dokumen TP, ambang batas, waktu penyediaan dokumen, dan risiko ketika dokumentasi tidak lengkap pada proses pemeriksaan atau sengketa.",
        updatedAt: now
      },
      {
        id: "official-per-22-tp-audit",
        topic,
        title: "Pedoman Pemeriksaan terhadap Wajib Pajak yang Mempunyai Hubungan Istimewa",
        citation: "PER-22/PJ/2013",
        focus:
          "Pedoman pemeriksaan TP: identifikasi transaksi afiliasi, analisis fungsi/aset/risiko, pemilihan metode, pembanding, tested party, dan dokumentasi pendukung.",
        relevance: 90,
        source: "seed",
        sourceUrl: "",
        content:
          "Berguna untuk memahami cara DJP membangun koreksi TP dan bukti apa yang biasanya diuji dalam sengketa, seperti FAR analysis, benchmarking, dan rekonsiliasi transaksi afiliasi.",
        updatedAt: now
      },
      {
        id: "official-per-32-alp",
        topic,
        title: "Penerapan Prinsip Kewajaran dan Kelaziman Usaha dalam Transaksi antara Wajib Pajak dengan Pihak yang Mempunyai Hubungan Istimewa",
        citation: "PER-32/PJ/2011",
        focus:
          "Panduan operasional penerapan arm's length principle, faktor kesebandingan, metode CUP/RPM/CPM/TNMM/Profit Split, dan dokumentasi analisis.",
        relevance: 84,
        source: "seed",
        sourceUrl: "",
        content:
          "Tetap berguna untuk perkara tahun pajak lama atau analisis historis, sambil memeriksa apakah ketentuan terbaru sudah menggantikannya untuk masa pajak terkait.",
        updatedAt: now
      },
      {
        id: "official-pmk-22-apa",
        topic,
        title: "Tata Cara Pelaksanaan Kesepakatan Harga Transfer",
        citation: "PMK No. 22/PMK.03/2020",
        focus:
          "Prosedur Advance Pricing Agreement untuk mitigasi risiko transfer pricing ke depan dan referensi pendekatan penyelesaian sengketa.",
        relevance: 78,
        source: "official",
        sourceUrl: "https://jdih.kemenkeu.go.id/dok/22-pmk-03-2020",
        content:
          "Gunakan sebagai konteks tambahan jika rekomendasi sengketa juga membutuhkan strategi pencegahan koreksi berulang melalui APA.",
        updatedAt: now
      }
    ];
  }

  if (topic === "vat") {
    return [
      {
        id: "official-uu-ppn",
        topic,
        title: "Undang-Undang Pajak Pertambahan Nilai",
        citation: "UU No. 8 Tahun 1983 sebagaimana diubah terakhir",
        focus:
          "Dasar objek PPN, penyerahan BKP/JKP, DPP, saat terutang, pengkreditan Pajak Masukan, dan dokumentasi formal.",
        relevance: 96,
        source: "official",
        sourceUrl: "https://peraturan.bpk.go.id/Details/46990/uu-no-8-tahun-1983",
        content:
          "Rujukan utama untuk menilai apakah transaksi merupakan objek PPN, apakah pajak masukan dapat dikreditkan, dan apakah koreksi DJP menyasar elemen material atau formal.",
        updatedAt: now
      },
      {
        id: "official-pp-44-2022",
        topic,
        title: "Penerapan terhadap Pajak Pertambahan Nilai Barang dan Jasa dan Pajak Penjualan atas Barang Mewah",
        citation: "PP No. 44 Tahun 2022",
        focus:
          "Aturan pelaksanaan PPN setelah UU HPP, termasuk perlakuan transaksi, DPP, objek pajak, dan waktu terutang.",
        relevance: 88,
        source: "official",
        sourceUrl: "https://jdih.kemenkeu.go.id/dok/pp-44-tahun-2022",
        content:
          "Gunakan untuk memperkuat analisis teknis PPN ketika sengketa berkaitan dengan klasifikasi penyerahan, DPP, atau saat terutang.",
        updatedAt: now
      },
      {
        id: "official-per-faktur-ppn",
        topic,
        title: "Ketentuan Faktur Pajak",
        citation: "Peraturan Direktur Jenderal Pajak tentang Faktur Pajak",
        focus:
          "Validitas faktur pajak, penggantian/pembetulan faktur, administrasi faktur, dan pembuktian formal Pajak Masukan.",
        relevance: 82,
        source: "seed",
        sourceUrl: "",
        content:
          "Pakai untuk sengketa yang menilai apakah bukti faktur pajak cukup kuat, cacat formal bisa diperbaiki, atau perlu ditopang bukti material transaksi.",
        updatedAt: now
      }
    ];
  }

  return [
    {
      id: `official-general-${Date.now()}`,
      topic,
      title: "Repository Peraturan Resmi",
      citation: "JDIH Kementerian Keuangan / JDIH BPK",
      focus: "Rujukan umum peraturan pajak Indonesia dari repository pemerintah.",
      relevance: 70,
      source: "official",
      sourceUrl: "https://jdih.kemenkeu.go.id/",
      content: "Gunakan repository pemerintah sebagai titik awal, lalu tambahkan kartu peraturan spesifik setelah nomor aturan teridentifikasi.",
      updatedAt: now
    }
  ];
}

export function chooseRegulationContext(records: Regulation[], question: string, topic?: string) {
  const normalizedTopic = normalizeRegulationTopic(topic);
  const text = question.toLowerCase();
  const inferredTopic =
    /transfer|pricing|afiliasi|hubungan istimewa|arm.?s length|kewajaran|kelaziman|benchmark|pembanding/i.test(text)
      ? "transfer_pricing"
      : /ppn|vat|pajak masukan|faktur|dpp|bkp|jkp/i.test(text)
        ? "vat"
        : normalizedTopic;
  const topicMatches = records.filter((item) => (item.topic || "general") === inferredTopic);
  const selected = topicMatches.length ? topicMatches : records;
  return selected
    .map((item) => ({ item, score: regulationSearchScore(item, question, inferredTopic) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ item }) => item);
}
