import fs from "node:fs";
import path from "node:path";
import { canonicalRegulationKey, normalizeRegulationText, normalizeRegulationTopic } from "./regulation-knowledge";
import type { Regulation, RegulationProvision } from "./mock-data";

type GraphNode = {
  canonicalKey?: string;
  canonical?: string;
  id?: string;
  sourceUrl?: string;
  sourceHash?: string;
  statusSite?: string;
  qualityFlags?: string[];
  validity?: { statusDerived?: string; validFrom?: string; validTo?: string | null };
};

type GraphEdge = {
  source?: string;
  target?: string;
  type?: string;
  confidence?: number;
  verified?: boolean;
  eligibleForAnswer?: boolean;
  flags?: string[];
};

type GraphPath = {
  from: string;
  to: string;
  relation: string;
  confidence: number | null;
  eligibleForAnswer: boolean;
  navigationOnly: boolean;
};

type GraphIndex = {
  nodes: Map<string, GraphNode>;
  adjacency: Map<string, GraphPath[]>;
};

export function graphEdgeEligibleForAnswer(edge: Pick<GraphEdge, "eligibleForAnswer" | "verified" | "flags">) {
  return edge.eligibleForAnswer === true && edge.verified === true && !(edge.flags || []).length;
}

export type RegulationRerankDiagnostics = {
  explicitCitationKeys: string[];
  inferredTopic: string;
  graphAvailable: boolean;
  graphExpandedKeys: string[];
  topScores: Array<{ canonicalKey: string; score: number; reasons: string[] }>;
  bestScore: number;
  answerable: boolean;
  abstentionReason?: string;
};

export type RegulationAnswerContext = {
  records: Regulation[];
  graphPaths: GraphPath[];
  diagnostics: RegulationRerankDiagnostics;
};

let graphCache: { file: string; stamp: string; index: GraphIndex } | null = null;
// The imported snapshot is reused between requests.  Normalizing the full
// extracted text for every score was making a simple question scan tens of
// thousands of long records repeatedly.  Keep these derived strings per
// record so only the first query pays the extraction cost.
const evidenceTextCache = new WeakMap<Regulation, string>();
const provisionTextCache = new WeakMap<Regulation, string>();
const metadataTextCache = new WeakMap<Regulation, string>();

function graphFiles() {
  const root = process.env.TDP_REGULATION_QUALITY_ROOT || "outputs/regulation-quality";
  return [
    path.resolve(/* turbopackIgnore: true */ root, "regulation-graph.json"),
    path.resolve(/* turbopackIgnore: true */ "data/reference-knowledge/buku-praktis-pajak-graph.json")
  ];
}

function graphKey(value: unknown) {
  return String(value || "").replace(/^law:/i, "").trim().toLowerCase();
}

function loadGraphIndex(): GraphIndex | null {
  const files = graphFiles();
  try {
    const stats = files.map((file) => {
      try {
        const stat = fs.statSync(file);
        return `${file}:${stat.mtimeMs}:${stat.size}`;
      } catch {
        return `${file}:missing`;
      }
    });
    const cacheFile = files.join("|");
    const cacheMtime = stats.join("|");
    if (graphCache && graphCache.file === cacheFile && graphCache.stamp === cacheMtime) return graphCache.index;
    const nodes = new Map<string, GraphNode>();
    const adjacency = new Map<string, GraphPath[]>();
    const add = (key: string, pathValue: GraphPath) => adjacency.set(key, [...(adjacency.get(key) || []), pathValue]);
    let loaded = false;
    for (const file of files) {
      let payload: { nodes?: GraphNode[]; edges?: GraphEdge[] };
      try {
        payload = JSON.parse(fs.readFileSync(file, "utf8")) as { nodes?: GraphNode[]; edges?: GraphEdge[] };
      } catch {
        continue;
      }
      loaded = true;
      for (const node of payload.nodes || []) {
        const key = graphKey(node.canonicalKey || node.id);
        if (key && !nodes.has(key)) nodes.set(key, node);
      }
      for (const edge of payload.edges || []) {
        const source = graphKey(edge.source);
        const target = graphKey(edge.target);
        if (!source || !target) continue;
        const eligibleForAnswer = graphEdgeEligibleForAnswer(edge);
        const pathValue = { from: source, to: target, relation: String(edge.type || "related"), confidence: Number.isFinite(edge.confidence) ? Number(edge.confidence) : null, eligibleForAnswer, navigationOnly: !eligibleForAnswer };
        add(source, pathValue);
        add(target, { ...pathValue, from: target, to: source, relation: `${pathValue.relation} (incoming)` });
      }
    }
    if (!loaded) return null;
    const index = { nodes, adjacency };
    graphCache = { file: cacheFile, stamp: cacheMtime, index };
    return index;
  } catch {
    return null;
  }
}

function normalizeSearch(value: unknown) {
  return normalizeRegulationText(value)
    .toLowerCase()
    .replace(/pajak pertambahan nilai/g, "ppn")
    .replace(/value added tax/g, "vat")
    .replace(/pajak penghasilan/g, "pph")
    .replace(/pajak masukan/g, "inputvat")
    .replace(/dasar pengenaan pajak/g, "dpp")
    .replace(/faktur pajak/g, "taxinvoice")
    .replace(/pengusaha kena pajak/g, "pkp")
    .replace(/[^a-z0-9%/\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set("apa saja dan atau yang dengan untuk dari pada dalam menurut setelah sebelum bagaimana berapa adalah apakah ini itu serta oleh sebagai atas akan dapat harus ke di the is are of and for how what which to from".split(" "));

function tokens(value: unknown) {
  return [...new Set(normalizeSearch(value).split(/\s+/).filter((token) => token.length > 2 && !STOPWORDS.has(token)))];
}

function extractExplicitCitationKeys(question: string) {
  const matches = question.match(/\b(?:uu|pp|pmk|perpu|per|kep|se)\s*(?:no\.?|nomor)?\s*[0-9][0-9a-z./-]*(?:\s*tahun\s*[0-9]{4})?/gi) || [];
  return [...new Set(matches.map((match) => canonicalRegulationKey({ citation: match, title: "" })).filter((key) => key && key !== "unknown-regulation"))];
}

function inferTopic(question: string): "vat" | "income_tax" | "transfer_pricing" | "general" {
  if (/transfer pricing|harga transfer|afiliasi|hubungan istimewa|arm.?s length|kewajaran|kelaziman/i.test(question)) return "transfer_pricing";
  if (/ppn|vat|pajak masukan|faktur|dpp|bkp|jkp|pajak pertambahan/i.test(question)) return "vat";
  if (/\bpph\b|pajak penghasilan|income\s+tax|ptkp|angsuran/i.test(question)) return "income_tax";
  return normalizeRegulationTopic(undefined);
}

function intentPhrases(question: string) {
  const phrases: string[] = [];
  if (/spt\s+masa|surat pemberitahuan|batas waktu.*ppn|pelaporan.*ppn/i.test(question)) {
    phrases.push("spt masa ppn", "surat pemberitahuan", "pengusaha kena pajak");
  }
  if (/tarif|rate|dpp|11\s*\/\s*12|12\s*%|non.?mewah|mewah/i.test(question)) phrases.push("tarif", "dpp", "11/12", "12%", "nilai lain");
  if (/batas|deadline|setor|lapor|pelaporan|penyetoran|jatuh tempo/i.test(question)) phrases.push("akhir bulan berikutnya", "tanggal 10", "tanggal 20", "batas waktu", "dilaporkan");
  if (/pph\s*(pasal)?\s*23|pasal\s*23|jasa teknik|jasa manajemen|jasa konsultan/i.test(question)) phrases.push("pph pasal 23", "2%", "jasa teknik", "jasa manajemen", "jasa konsultan");
  if (/\bpph\b|pajak\s+penghasilan|income\s+tax/i.test(question)) phrases.push("pph", "pajak penghasilan", "penghasilan", "tarif", "pemotongan", "pemungutan");
  if (/pph\s*(?:pasal)?\s*21|pasal\s*21|pegawai|karyawan|gaji|upah|honorarium|ptkp|ter\b/i.test(question)) phrases.push("pph pasal 21", "pegawai", "penghasilan bruto", "ptkp", "ter");
  if (/pph\s*(?:pasal)?\s*22|pasal\s*22|impor|bendahara|api\b/i.test(question)) phrases.push("pph pasal 22", "impor", "bendahara", "nilai impor");
  if (/pph\s*(?:pasal)?\s*25|pasal\s*25|angsuran/i.test(question)) phrases.push("pph pasal 25", "angsuran", "kredit pajak", "spt tahunan");
  if (/pph\s*final|pasal\s*4\s*ayat|umkm|omzet|peredaran bruto/i.test(question)) phrases.push("pph final", "pasal 4 ayat 2", "umkm", "penghasilan bruto", "omzet");
  if (/pajak masukan|input vat|dikreditkan|pengkreditan/i.test(question)) phrases.push("pajak masukan", "dapat dikreditkan", "faktur pajak", "hubungan langsung");
  if (/bendaharawan|pemungut\s+(?:ppn|pajak)|instansi\s+pemerintah|rekanan\s+pemerintah/i.test(question)) {
    phrases.push("bendaharawan", "pemungut pajak pertambahan nilai", "instansi pemerintah", "dpp", "tarif", "dipungut");
  }
  if (/status|berlaku|dicabut|diubah|effective|revoked/i.test(question)) phrases.push("status", "berlaku", "dicabut", "diubah");
  if (/surat\s+paksa|penagihan\s+pajak|penyitaan|penyanderaan/i.test(question)) phrases.push("penagihan pajak dengan surat paksa", "surat paksa", "penyitaan", "penyanderaan");
  if (/pengadilan\s+pajak|banding\s+pajak|gugatan\s+pajak|tax\s+court/i.test(question)) phrases.push("pengadilan pajak", "banding", "gugatan");
  if (/natura|kenikmatan|benefit\s+in\s+kind/i.test(question)) phrases.push("natura", "kenikmatan");
  if (/penyusutan|amortisasi|depreciation|amortization/i.test(question)) phrases.push("penyusutan", "amortisasi");
  if (/pajak\s+daerah|retribusi\s+daerah|local\s+tax/i.test(question)) phrases.push("pajak daerah", "retribusi daerah");
  if (/bea\s+meterai|meterai\s+elektronik|stamp\s+duty/i.test(question)) phrases.push("bea meterai", "meterai elektronik");
  return [...new Set(phrases)];
}

function priorityCanonicalKeys(question: string) {
  const keys: string[] = [];
  if (/surat\s+paksa|penagihan\s+pajak|penyitaan|penyanderaan/i.test(question)) keys.push("uu-19-1997", "uu-19-2000", "pmk-61-2023");
  if (/pengadilan\s+pajak|banding\s+pajak|gugatan\s+pajak|tax\s+court/i.test(question)) keys.push("uu-14-2002");
  if (/natura|kenikmatan|benefit\s+in\s+kind/i.test(question)) keys.push("pmk-66-2023", "pp-55-2022");
  if (/penyusutan|amortisasi|depreciation|amortization/i.test(question)) keys.push("pmk-72-2023");
  if (/pajak\s+daerah|retribusi\s+daerah|local\s+tax/i.test(question)) keys.push("uu-1-2022", "pp-35-2023");
  if (/bea\s+meterai|meterai\s+elektronik|stamp\s+duty/i.test(question)) keys.push("uu-10-2020", "pp-86-2021", "pmk-78-2024");
  if (/transfer[-\s]+pricing|harga\s+transfer|arm'?s[-\s]+length|kewajaran\s+dan\s+kelaziman|documentation|cbcr/i.test(question)) keys.push("pmk-172-2023");
  if (/pph\s*(?:pasal)?\s*21|employee\s+income[-\s]+tax|employee\s+withholding|tarif\s+efektif\s+rata/i.test(question)) keys.push("pp-58-2023", "pmk-168-2023");
  return keys;
}

function evidenceText(item: Regulation) {
  const cached = evidenceTextCache.get(item);
  if (cached) return cached;
  const provisions = item.extraction?.keyProvisions || [];
  const value = normalizeSearch([
    item.title,
    item.citation,
    item.focus,
    item.content,
    item.extraction?.summary,
    item.extraction?.statusNote,
    item.extraction?.keywords?.join(" "),
    provisions.map((provision) => provision.text).join(" ")
  ].filter(Boolean).join(" "));
  evidenceTextCache.set(item, value);
  return value;
}

function citationIdentity(item: Regulation) {
  return normalizeSearch(item.citation || item.canonicalKey || item.id)
    .replace(/^(?:per|pj)[-\s]*/i, "")
    .replace(/[^a-z0-9]/g, "");
}

function recordQuality(item: Regulation) {
  return (item.sourceUrl || item.officialPdfUrl ? 80 : 0)
    + (item.ingestionStatus === "ready" ? 30 : 0)
    + (item.extraction?.keyProvisions?.length || 0)
    + (item.extraction?.legalStatus === "active" ? 15 : 0)
    + (item.content?.length || 0) / 100000;
}

function dedupeRecords(records: Regulation[]) {
  const byCitation = new Map<string, Regulation>();
  for (const item of records) {
    const key = citationIdentity(item);
    const current = byCitation.get(key);
    if (!current || recordQuality(item) > recordQuality(current)) byCitation.set(key, item);
  }
  return [...byCitation.values()];
}

function graphNodeQuality(index: GraphIndex | null, item: Regulation) {
  const key = graphKey(item.canonicalKey || canonicalRegulationKey(item));
  const node = index?.nodes.get(key);
  if (!node) return { node: undefined, score: 0 };
  let score = 0;
  if (String(node.statusSite || "").toLowerCase() === "active") score += 18;
  if (node.sourceHash && /^[a-f0-9]{64}$/i.test(node.sourceHash)) score += 8;
  if (node.qualityFlags?.length) score -= 40;
  return { node, score };
}

function scoreRecord(item: Regulation, question: string, inferredTopic: string, explicitKeys: Set<string>, graph: GraphIndex | null) {
  const query = normalizeSearch(question);
  const queryTokens = tokens(question);
  const body = evidenceText(item);
  const title = normalizeSearch(`${item.title} ${item.citation}`);
  const cachedProvisionText = provisionTextCache.get(item);
  const provisionText = cachedProvisionText || normalizeSearch((item.extraction?.keyProvisions || []).map((provision) => provision.text).join(" "));
  if (!cachedProvisionText) provisionTextCache.set(item, provisionText);
  const phrases = intentPhrases(question);
  const itemKey = item.canonicalKey || canonicalRegulationKey(item);
  const bodyHits = queryTokens.filter((token) => body.includes(token)).length;
  const titleHits = queryTokens.filter((token) => title.includes(token)).length;
  const provisionHits = queryTokens.filter((token) => provisionText.includes(token)).length;
  const phraseHits = phrases.filter((phrase) => body.includes(normalizeSearch(phrase))).length;
  const bodyCoverage = queryTokens.length ? bodyHits / queryTokens.length : 0;
  let score = bodyCoverage * 55 + titleHits * 13 + provisionHits * 18 + phraseHits * 15 + Number(item.relevance || 0) * 0.12;
  const reasons: string[] = [];
  if (explicitKeys.has(itemKey)) { score += 280; reasons.push("exact citation"); }
  if (priorityCanonicalKeys(question).includes(itemKey)) { score += 460; reasons.push("controlling-rule intent"); }
  if ((item.topic || "general") === inferredTopic) { score += 28; reasons.push("topic match"); }
  const cachedMetadataText = metadataTextCache.get(item);
  const metadata = cachedMetadataText || normalizeSearch([item.title, item.focus, item.extraction?.summary, item.extraction?.keywords?.join(" ")].filter(Boolean).join(" "));
  if (!cachedMetadataText) metadataTextCache.set(item, metadata);
  if (/spt\s+masa|surat pemberitahuan/i.test(question) && /spt\s+masa\s+ppn|surat pemberitahuan masa.*ppn/i.test(metadata)) {
    score += 85;
    reasons.push("SPT Masa PPN match");
  }
  if (item.source === "official" || item.sourceUrl || item.officialPdfUrl) { score += 22; reasons.push("official source"); }
  if (item.extraction?.keyProvisions?.length) { score += 22; reasons.push("key provisions"); }
  if (item.ingestionStatus === "ready") { score += 18; reasons.push("ready extraction"); }
  if (item.extraction?.legalStatus === "active") { score += 18; reasons.push("active status"); }
  if (item.extraction?.legalStatus === "revoked") score -= 100;
  if (phrases.some((phrase) => phrase === "11/12") && /11\s*\/\s*12/.test(body)) { score += 130; reasons.push("11/12 formula"); }
  if (phrases.includes("2%") && /2\s*%|dua persen/.test(body)) { score += 120; reasons.push("PPh 23 rate"); }
  if (phrases.includes("akhir bulan berikutnya") && /akhir bulan berikutnya/.test(body)) { score += 120; reasons.push("deadline provision"); }
  if (phrases.includes("tanggal 10") && /tanggal\s*10/.test(body)) { score += 120; reasons.push("10th-day deadline"); }
  if (phrases.includes("tanggal 20") && /tanggal\s*20|20\s*hari/.test(body)) { score += 120; reasons.push("20th-day deadline"); }
  if (phrases.includes("dapat dikreditkan") && /dapat dikreditkan/.test(body)) { score += 100; reasons.push("input VAT provision"); }
  if (/bendaharawan|pemungut\s+(?:ppn|pajak)|instansi\s+pemerintah|rekanan\s+pemerintah/i.test(question)) {
    const governmentCollectorText = `${item.title} ${item.citation} ${item.focus} ${item.extraction?.summary || ""}`;
    if (/bendaharawan|pemungut\s+pajak\s+pertambahan\s+nilai|instansi\s+pemerintah|pemungutan.*ppn/i.test(governmentCollectorText)) {
      score += 320;
      reasons.push("government collector match");
    }
    if (/pmk[-\s]?59[-\s]?pmk[-\s]?03[-\s]?2022|59\/pmk\.03\/2022/i.test(`${item.canonicalKey} ${item.citation}`)) {
      score += 560;
      reasons.push("current government-institution framework");
    }
    if (/selain\s+instansi\s+pemerintah/i.test(governmentCollectorText)) score -= 220;
    if (/revoked|dicabut/i.test(`${item.extraction?.legalStatus || ""} ${item.extraction?.statusNote || ""}`)) score -= 260;
  }
  if (/(?:bagaimana|cara|menghitung|hitung|berapa|tarif)/i.test(question) && /ppn|pajak\s+pertambahan/i.test(question)) {
    if (/pmk-131-2024|pmk\s+131\s+tahun\s+2024/i.test(`${item.canonicalKey} ${item.citation} ${item.title}`)) {
      score += 520;
      reasons.push("current VAT calculation framework");
    }
  }
  if (/pph\s*(pasal)?\s*23|pasal\s*23|jasa teknik|jasa manajemen|jasa konsultan/i.test(question)) {
    if (/pph\s*(pasal)?\s*23|pasal\s*23|jasa teknik|jasa manajemen|jasa konsultan/i.test(`${item.title} ${item.citation} ${item.focus}`)) {
      score += 170;
      reasons.push("PPh 23 subject match");
    } else if (/pajak pertambahan nilai|ppn|vat/i.test(`${item.title} ${item.citation} ${item.focus}`)) {
      score -= 90;
    }
    if (/pmk[-\s]?(?:141|242|9)|uu[-\s]?7|uu[-\s]?36/i.test(`${item.canonicalKey} ${item.citation}`)) {
      score += 110;
      reasons.push("PPh withholding framework");
    }
    if (/pmk[-\s]?(?:141|242|9)|141\/pmk\.03\/2015|242\/pmk\.03\/2014/i.test(`${item.canonicalKey} ${item.citation}`) && /batas|setor|lapor|tanggal/i.test(question)) {
      score += 220;
      reasons.push("PPh deadline framework");
    }
  }
  if (/\bpph\b|pajak\s+penghasilan|income\s+tax/i.test(question)) {
    const incomeTaxText = `${item.title} ${item.citation} ${item.focus} ${item.extraction?.summary || ""}`;
    if (/\bpph\b|pajak\s+penghasilan|income\s+tax|penghasilan/i.test(incomeTaxText)) {
      score += 210;
      reasons.push("income-tax subject match");
    } else if (/ppn|pajak pertambahan nilai|vat/i.test(incomeTaxText)) {
      score -= 75;
    }
    if (/pph\s*(?:pasal)?\s*21|pasal\s*21|pegawai|karyawan|gaji|upah|ptkp|ter\b/i.test(question) && /pph\s*(?:pasal)?\s*21|pegawai|karyawan|ptkp|ter\b/i.test(incomeTaxText)) {
      score += 170;
      reasons.push("PPh 21 subject match");
    }
    if (/pph\s*(?:pasal)?\s*22|pasal\s*22|impor|bendahara/i.test(question) && /pph\s*(?:pasal)?\s*22|impor|bendahara/i.test(incomeTaxText)) {
      score += 170;
      reasons.push("PPh 22 subject match");
    }
    if (/pph\s*(?:pasal)?\s*25|pasal\s*25|angsuran/i.test(question) && /pph\s*(?:pasal)?\s*25|angsuran|kredit pajak/i.test(incomeTaxText)) {
      score += 170;
      reasons.push("PPh 25 subject match");
    }
    if (/pph\s*final|pasal\s*4\s*ayat|umkm|omzet|peredaran bruto/i.test(question) && /pph\s*final|pasal\s*4\s*ayat|umkm|omzet|peredaran bruto/i.test(incomeTaxText)) {
      score += 170;
      reasons.push("final income-tax subject match");
    }
  }
  if (/pajak masukan|input vat|dikreditkan|pengkreditan/i.test(question) && /uu[-\s]?8|uu\s+no\.?\s*8/i.test(`${item.canonicalKey} ${item.citation} ${item.title}`)) {
    score += 1000;
    reasons.push("VAT credit framework");
  }
  if (/kripto|aset kripto/i.test(body) && !/kripto|aset digital|aset crypto/i.test(question)) score -= 90;
  if (/perdagangan melalui sistem elektronik|pmse/i.test(body) && !/pmse|platform|digital|elektronik|e-commerce/i.test(question)) score -= 55;
  if (/non.?mewah/i.test(question) && /barang kena pajak tergolong mewah|konsumen akhir/i.test(body)) score -= 45;
  if (/spt\s+masa|surat pemberitahuan/i.test(question) && /spt\s+masa\s+ppn/i.test(metadata) && /\bpmk[-\s]?(?:9|81)\b|\b2018\b|\b2024\b/i.test(`${item.citation} ${item.title}`)) {
    score += 45;
    reasons.push("newer SPT rule");
  }
  if (/spt\s+masa|surat pemberitahuan/i.test(question) && /\bpmk[-\s]?(?:9|81)\b|9\/pmk\.03\/2018/i.test(`${item.canonicalKey} ${item.citation}`)) {
    score += 180;
    reasons.push("current SPT framework");
  }
  const graphQuality = graphNodeQuality(graph, item);
  score += graphQuality.score;
  if (graphQuality.node?.statusSite) reasons.push(`graph status ${graphQuality.node.statusSite}`);
  if (query.includes("current") || /berlaku|terkini|saat ini/i.test(question)) {
    if (String(graphQuality.node?.statusSite || item.extraction?.legalStatus || "").toLowerCase() === "active") score += 30;
  }
  return { item, score, reasons };
}

function graphPathsFor(records: Regulation[], graph: GraphIndex | null) {
  if (!graph) return [] as GraphPath[];
  const keys = new Set(records.map((item) => graphKey(item.canonicalKey || canonicalRegulationKey(item))));
  const paths: GraphPath[] = [];
  for (const key of keys) {
    for (const pathValue of graph.adjacency.get(key) || []) {
      if (!pathValue.eligibleForAnswer) continue;
      if (!keys.has(pathValue.to)) continue;
      if (paths.some((item) => item.from === pathValue.from && item.to === pathValue.to && item.relation === pathValue.relation)) continue;
      paths.push(pathValue);
    }
  }
  return paths.slice(0, 12);
}

function focusRecordsForQuestion(records: Regulation[], question: string) {
  if (records.length < 2_000) return records;
  const focusedIntent = /bendaharawan|pemungut\s+(?:ppn|pajak)|instansi\s+pemerintah|rekanan\s+pemerintah|pajak\s+masukan|input\s+vat|\bpph\b|pajak\s+penghasilan|income\s+tax|transfer\s+pricing|harga\s+transfer/i.test(question);
  if (!focusedIntent) return records;
  const candidates = records.filter((item) => {
    const searchable = `${item.title} ${item.citation} ${item.focus.slice(0, 1800)} ${(item.extraction?.keywords || []).join(" ")}`.toLowerCase();
    return /bendaharawan|pemungut|instansi\s+pemerintah|rekanan\s+pemerintah|pajak\s+masukan|input\s+vat|\bpph\b|pajak\s+penghasilan|income\s+tax|transfer\s+pricing|harga\s+transfer/i.test(searchable);
  });
  // Preserve the current VAT framework even when the title does not mention
  // a treasurer/collector explicitly; it supplies the rate and DPP formula.
  const currentVat = records.filter((item) => /pmk-131-2024|pmk\s+131\s+tahun\s+2024/i.test(`${item.canonicalKey} ${item.citation}`));
  const merged = new Map<string, Regulation>();
  for (const item of [...candidates, ...currentVat]) merged.set(item.canonicalKey || item.id, item);
  return merged.size >= 8 ? [...merged.values()] : records;
}

export function rerankRegulationContext(records: Regulation[], question: string, limit = 8): RegulationAnswerContext {
  const graph = loadGraphIndex();
  const inferredTopic = inferTopic(question);
  const explicitCitationKeys = extractExplicitCitationKeys(question);
  const sourceRecords = focusRecordsForQuestion(dedupeRecords(records), question);
  const scored = sourceRecords.map((item) => scoreRecord(item, question, inferredTopic, new Set(explicitCitationKeys), graph));
  scored.sort((a, b) => b.score - a.score || String(a.item.canonicalKey || a.item.id).localeCompare(String(b.item.canonicalKey || b.item.id)));
  const initial = scored.slice(0, Math.max(limit, 4));
  const recordByKey = new Map(sourceRecords.map((item) => [graphKey(item.canonicalKey || canonicalRegulationKey(item)), item]));
  const graphExpandedKeys: string[] = [];
  if (graph) {
    for (const candidate of initial.slice(0, 4)) {
      const key = graphKey(candidate.item.canonicalKey || canonicalRegulationKey(candidate.item));
      for (const pathValue of graph.adjacency.get(key) || []) {
        if (!pathValue.eligibleForAnswer) continue;
        if (!recordByKey.has(pathValue.to) || graphExpandedKeys.includes(pathValue.to)) continue;
        graphExpandedKeys.push(pathValue.to);
      }
    }
  }
  const poolByKey = new Map<string, Regulation>();
  for (const item of [...initial.map((entry) => entry.item), ...graphExpandedKeys.map((key) => recordByKey.get(key)).filter((item): item is Regulation => Boolean(item))]) {
    poolByKey.set(graphKey(item.canonicalKey || canonicalRegulationKey(item)), item);
  }
  const pool = [...poolByKey.values()];
  const finalScored = pool.map((item) => scoreRecord(item, question, inferredTopic, new Set(explicitCitationKeys), graph));
  finalScored.sort((a, b) => b.score - a.score);
  const selected = finalScored.slice(0, limit).map((entry) => entry.item);
  const bestScore = finalScored[0]?.score || 0;
  const best = finalScored[0]?.item;
  const bestHasEvidence = Boolean(best?.extraction?.keyProvisions?.length || best?.content || best?.focus);
  const answerable = Boolean(best && bestScore >= 55 && bestHasEvidence);
  const diagnostics: RegulationRerankDiagnostics = {
    explicitCitationKeys,
    inferredTopic,
    graphAvailable: Boolean(graph),
    graphExpandedKeys,
    topScores: finalScored.slice(0, 8).map((entry) => ({ canonicalKey: entry.item.canonicalKey || canonicalRegulationKey(entry.item), score: Math.round(entry.score * 100) / 100, reasons: entry.reasons })),
    bestScore: Math.round(bestScore * 100) / 100,
    answerable,
    abstentionReason: answerable ? undefined : "Evidence lokal belum cukup spesifik untuk menjawab pertanyaan secara aman."
  };
  return { records: selected, graphPaths: graphPathsFor(selected, graph), diagnostics };
}

function provisionScore(provision: RegulationProvision, question: string, item?: Regulation) {
  const text = normalizeSearch(provision.text);
  const terms = [...tokens(question), ...intentPhrases(question).map(normalizeSearch)];
  const framingPenalty = provision.article && /kepala|menimbang|mengingat/i.test(provision.article) ? 70 : 0;
  let score = terms.filter((term) => text.includes(term)).length * 10 + (provision.article && !/kepala|menimbang|mengingat/i.test(provision.article) ? 8 : 0) - framingPenalty;
  if (/non.?mewah/i.test(question)) {
    if (/pasal 3/i.test(provision.article || "")) score += 110;
    if (/pasal 5/i.test(provision.article || "")) score -= 110;
  }
  if (/mewah/i.test(question) && !/non.?mewah/i.test(question) && /pasal 5/i.test(provision.article || "")) score += 40;
  if (/pph\s*(pasal)?\s*23|pasal\s*23/i.test(question) && /batas|setor|lapor|tanggal/i.test(question)) {
    if (/tanggal\s*10|tanggal\s*20|20\s*hari|akhir bulan berikutnya|paling lama/i.test(text)) score += 180;
    if (/kepala|menimbang|mengingat/i.test(provision.article || "")) score -= 160;
  }
  if (item && /spt\s+masa|surat pemberitahuan/i.test(question) && /\bpmk[-\s]?(?:9|81)\b|9\/pmk\.03\/2018/i.test(`${item.canonicalKey} ${item.citation}`)) score += 100;
  if (item && /pph\s*(pasal)?\s*23|pasal\s*23|jasa teknik|jasa manajemen|jasa konsultan/i.test(question) && /\bpmk[-\s]?(?:141|242|9)\b|141\/pmk\.03\/2015|242\/pmk\.03\/2014/i.test(`${item.canonicalKey} ${item.citation}`)) score += 100;
  if (item && /pajak masukan|input vat|dikreditkan|pengkreditan/i.test(question) && /uu[-\s]?8|uu\s+no\.?\s*8/i.test(`${item.canonicalKey} ${item.citation}`)) score += 120;
  return Math.max(0, score);
}

function provisionIntent(question: string) {
  return {
    deadline: /batas|deadline|setor|lapor|pelaporan|penyetoran|jatuh tempo/i.test(question),
    pph23: /pph\s*(pasal)?\s*23|pasal\s*23|jasa teknik|jasa manajemen|jasa konsultan/i.test(question),
    incomeTax: /\bpph\b|pajak\s+penghasilan|income\s+tax/i.test(question),
    inputVat: /pajak masukan|input vat|dikreditkan|pengkreditan/i.test(question),
    nonLuxury: /non.?mewah/i.test(question),
    governmentCollector: /bendaharawan|pemungut\s+(?:ppn|pajak)|instansi\s+pemerintah|rekanan\s+pemerintah/i.test(question),
    calculation: /bagaimana|cara|menghitung|hitung|berapa|tarif/i.test(question)
  };
}

function isTargetProvision(text: string, question: string, article = "", item?: Regulation) {
  const normalized = normalizeSearch(text);
  const intent = provisionIntent(question);
  if (intent.pph23) {
    const subject = /(pph\s*(pasal)?\s*23|pasal\s*23|jasa teknik|jasa manajemen|jasa konsultan)/i.test(normalized);
    const rateOrService = /(2\s*%|dua persen|jasa teknik|jasa manajemen|jasa konsultan)/i.test(normalized);
    const source = normalizeSearch(`${item?.citation || ""} ${item?.title || ""} ${item?.focus || ""}`);
    const sourceRelevant = /pmk[^0-9]{0,6}(?:141|242|9)|(?:141|242|9)[^a-z0-9]{0,6}pmk|uu[-\s]?(?:7|36)|se[-\s]?35|pph|penghasilan/i.test(source);
    const sourceExcluded = /ppn|vat|premi asuransi luar negeri/i.test(source) || (/pasal 26/i.test(source) && !/jasa teknik|jasa manajemen|jasa konsultan/i.test(normalized));
    const deadlineRule = intent.deadline && /(tanggal\s*10|tanggal\s*20|20\s*hari|akhir bulan berikutnya|paling lama)/i.test(normalized);
    if (/pmk[^0-9]{0,6}(?:242|9)|(?:242|9)[^a-z0-9]{0,6}pmk/i.test(source) && !/(tanggal\s*10|tanggal\s*20|20\s*hari|akhir bulan berikutnya)/i.test(normalized)) return false;
    return sourceRelevant && subject && (rateOrService || deadlineRule) && !sourceExcluded;
  }
  if (intent.incomeTax) {
    const incomeTaxProvision = /\bpph\b|pajak\s+penghasilan|penghasilan|pemotong|pemungut|angsuran|ptkp|tarif|omzet|peredaran bruto/i.test(normalized);
    const vatOnly = /\bppn\b|pajak\s+pertambahan\s+nilai|vat/i.test(normalized) && !/\bpph\b|pajak\s+penghasilan/i.test(normalized);
    return incomeTaxProvision && !vatOnly;
  }
  if (intent.deadline && /(akhir bulan berikutnya|batas waktu|jatuh tempo|disetor paling lama|disampaikan paling lama|tanggal 10|tanggal 20)/i.test(normalized)) return true;
  if (intent.inputVat && /(pajak masukan|dapat dikreditkan|pengkreditan)/i.test(normalized)) return true;
  if (intent.governmentCollector && /(bendaharawan|pemungut|instansi pemerintah|dpp|tarif|dipungut|disetor|dilaporkan)/i.test(normalized)) return true;
  if (intent.nonLuxury && (/pasal\s*3\s*>?\s*ayat\s*\((?:2|3)\)/i.test(article) || /11\s*\/\s*12/i.test(normalized))) {
    if (!item) return true;
    return /pmk[-\s]?131|131\s*tahun\s*2024/i.test(`${item.canonicalKey} ${item.citation}`);
  }
  return !intent.deadline && !intent.pph23 && !intent.inputVat && !intent.nonLuxury;
}

function compactProvisionText(text: string, question: string) {
  const normalized = normalizeRegulationText(text).replace(/\s+/g, " ").trim();
  const intent = provisionIntent(question);
  const patterns = intent.deadline
    ? [/[^.!?]*(?:akhir bulan berikutnya|batas waktu|jatuh tempo|disetor paling lama|disampaikan paling lama)[^.!?]*[.!?]?/gi]
    : intent.pph23
      ? [/[^.!?]*(?:2\s*%|dua persen|jasa teknik|jasa manajemen|jasa konsultan)[^.!?]*[.!?]?/gi]
      : intent.incomeTax
        ? [/[^.!?]*(?:pph|pajak penghasilan|penghasilan|pemotong|pemungut|angsuran|ptkp|tarif|omzet|peredaran bruto|ter\b)[^.!?]*[.!?]?/gi]
      : intent.inputVat
        ? [/[^.!?]*(?:pajak masukan|dapat dikreditkan|pengkreditan)[^.!?]*[.!?]?/gi]
      : intent.nonLuxury
          ? [/[^.!?]*(?:11\s*\/\s*12|nilai lain|pasal 3)[^.!?]*[.!?]?/gi]
          : intent.governmentCollector
            ? [/[^.!?]*(?:bendaharawan|pemungut|instansi pemerintah|dasar pengenaan pajak|DPP|tarif|dipungut|disetor|dilaporkan)[^.!?]*[.!?]?/gi]
          : [];
  for (const pattern of patterns) {
    const matches = normalized.match(pattern);
    if (matches?.length) return matches.slice(0, 2).join(" ").slice(0, 900);
  }
  return normalized.length > 900 ? `${normalized.slice(0, 897)}...` : normalized;
}

export function generateLocalRegulationAnswer(question: string, language: "id" | "en", context: RegulationAnswerContext) {
  const records = context.records;
  if (!context.diagnostics.answerable || !records.length) {
    const answer = language === "id"
      ? `## Belum cukup bukti\n\n- Saya belum menemukan ketentuan yang cukup spesifik untuk menjawab pertanyaan ini dengan aman.\n- Coba sebutkan nomor aturan, masa pajak, jenis transaksi, atau unggah sumber resmi.\n\n## Status verifikasi\n\n- Jawaban ditahan agar tidak mengarang tarif, tenggat, atau status hukum.`
      : `## Insufficient evidence\n\n- I could not find sufficiently specific provisions to answer safely.\n- Add the regulation number, tax period, transaction type, or an official source.\n\n## Verification status\n\n- The answer is withheld to avoid inventing a rate, deadline, or legal status.`;
    return { answer, abstained: true, matchedProvisions: [] as Array<{ citation: string; article?: string; text: string }> };
  }

  const rankScores = new Map(context.diagnostics.topScores.map((entry) => [entry.canonicalKey, entry.score]));
  const scoredProvisions = records.flatMap((item) => (item.extraction?.keyProvisions || []).map((provision) => ({ item, provision, score: provisionScore(provision, question, item) + (rankScores.get(item.canonicalKey || canonicalRegulationKey(item)) || 0) * 0.5 })))
    .filter((entry) => isTargetProvision(entry.provision.text, question, entry.provision.article, entry.item))
    .filter((entry) => !(/pph\s*(pasal)?\s*23|pasal\s*23/i.test(question) && /batas|setor|lapor|tanggal/i.test(question) && /kepala|menimbang|mengingat/i.test(entry.provision.article || "")))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .filter((entry, index, all) => all.findIndex((other) => citationIdentity(other.item) === citationIdentity(entry.item) && normalizeSearch(other.provision.text) === normalizeSearch(entry.provision.text)) === index)
  const forcedPphDeadline = /pph\s*(pasal)?\s*23|pasal\s*23/i.test(question) && /batas|setor|lapor|tanggal/i.test(question)
    ? records.flatMap((item) => (item.extraction?.keyProvisions || []).map((provision) => ({ item, provision, score: 10000 })))
      .filter(({ item, provision }) => /pmk[-\s]?9|9\/pmk\.03\/2018/i.test(`${item.canonicalKey} ${item.citation}`) && /pph\s+pasal\s+23/i.test(normalizeSearch(provision.text)) && /20\s+dua\s+puluh\s+hari|paling lama 20\s+hari/i.test(normalizeSearch(provision.text)))
    : [];
  const provisions = [...forcedPphDeadline, ...scoredProvisions]
    .filter((entry, index, all) => all.findIndex((other) => citationIdentity(other.item) === citationIdentity(entry.item) && normalizeSearch(other.provision.text) === normalizeSearch(entry.provision.text)) === index)
    .slice(0, 6);
  const top = records.slice(0, 3);
  const matched = provisions.length ? provisions : top.map((item) => ({ item, provision: { article: undefined, text: item.focus }, score: 1 }));
  const uniqueMatched = matched.filter((entry, index, all) => all.findIndex((other) => citationIdentity(other.item) === citationIdentity(entry.item) && normalizeSearch(other.provision.text) === normalizeSearch(entry.provision.text)) === index);
  const governmentCollector = provisionIntent(question).governmentCollector;
  const incomeTax = provisionIntent(question).incomeTax;
  const calculationQuestion = provisionIntent(question).calculation;
  const governmentCollectorId = governmentCollector && language === "id"
    ? [
        "Dalam transaksi dengan instansi pemerintah, bendaharawan pada dasarnya berperan sebagai **pemungut PPN**, bukan sebagai pihak yang menentukan tarif khusus sendiri. PMK 59/PMK.03/2022 Pasal 16–17 mengatur pemungutan atas penyerahan BKP/JKP oleh rekanan pemerintah dengan tarif yang berlaku dikalikan dasar pengenaan pajak (DPP), atau besaran tertentu jika memang diatur.",
        ...(calculationQuestion
          ? [
              "Cara menghitungnya adalah menentukan terlebih dahulu harga jual atau penggantian dan DPP yang tepat untuk transaksi tersebut, lalu menerapkan tarif serta mekanisme DPP pada masa pajak yang bersangkutan. Pada skema non-mewah PMK 131/2024, tarif 12% diterapkan atas nilai lain sebesar 11/12 dari harga jual atau penggantian, sehingga beban efektifnya menjadi 11% dari harga jual atau penggantian. Jika tarif penuh berlaku, perhitungannya adalah 12% dikalikan DPP.",
              "Rumus praktisnya adalah **PPN yang dipungut = tarif × DPP**. Pastikan angka yang dipakai benar-benar DPP untuk skema tersebut; apabila suatu dokumen sudah menyebut DPP nilai lain, jangan mengalikan 11/12 untuk kedua kalinya.",
              "Contoh komprehensif:\n1. Harga jual BKP/JKP non-mewah sebelum PPN = Rp100.000.000. Asumsi: tidak ada fasilitas pembebasan dan skema 12% × 11/12 berlaku.\n2. DPP nilai lain = 11/12 × Rp100.000.000 = Rp91.666.666,67.\n3. PPN yang dipungut = 12% × Rp91.666.666,67 = Rp11.000.000.\n4. Total yang dibayarkan kepada rekanan termasuk PPN = Rp100.000.000 + Rp11.000.000 = Rp111.000.000.\n5. Pembanding tarif penuh: jika 12% berlaku atas DPP Rp100.000.000, PPN = Rp12.000.000 dan total tagihan = Rp112.000.000.",
              "Dalam praktik bendaharawan, hasil tersebut perlu dicocokkan dengan faktur pajak, nilai pembayaran, bukti pemungutan, dan bukti setor. Periksa juga apakah transaksi termasuk pengecualian pemungutan atau menggunakan fasilitas tertentu."
            ]
          : [
              "Alur praktisnya adalah memverifikasi status instansi sebagai pemungut dan memastikan penyerahan tersebut merupakan objek PPN, meminta faktur pajak yang benar dari rekanan, kemudian menghitung, memungut, menyetor, dan melaporkan sesuai tenggat serta formulir yang berlaku."
            ]),
        "Tarif, DPP, saat terutang, dan tenggat dapat berbeda menurut jenis barang/jasa, fasilitas, dan masa pajak. Karena itu, rumus di atas adalah kerangka kerja umum dan tetap harus dicocokkan dengan pasal serta periode transaksi yang spesifik."
      ]
      : governmentCollector
      ? [
          "For transactions with a government entity, the treasurer generally acts as a **VAT collector**, rather than choosing a special rate. PMK 59/PMK.03/2022 Articles 16–17 govern collection on taxable supplies from government suppliers using the applicable rate multiplied by the tax base (DPP), or a specific amount where prescribed.",
          ...(calculationQuestion
            ? [
                "To calculate it, first identify the sale price or consideration and the correct DPP, then apply the rate and tax-base mechanism for the relevant tax period. Under the non-luxury PMK 131/2024 mechanism, 12% is applied to a tax base equal to 11/12 of the sale price or consideration, producing an effective 11% burden. A full-rate transaction uses 12% of the applicable DPP.",
                "The practical formula is **VAT collected = rate × DPP**. Do not apply 11/12 a second time if the document already gives the special tax base.",
                "Comprehensive example:\n1. Pre-VAT sale price of a non-luxury taxable supply = Rp100,000,000. Assumption: no exemption and the 12% × 11/12 mechanism applies.\n2. Special DPP = 11/12 × Rp100,000,000 = Rp91,666,666.67.\n3. VAT collected = 12% × Rp91,666,666.67 = Rp11,000,000.\n4. Total paid to the supplier including VAT = Rp100,000,000 + Rp11,000,000 = Rp111,000,000.\n5. Full-rate comparison: if 12% applies to a DPP of Rp100,000,000, VAT = Rp12,000,000 and the total is Rp112,000,000.",
                "Reconcile the result to the tax invoice, payment, collection evidence, and deposit evidence, and check any collection exemption or facility."
              ]
            : [
                "The practical flow is to confirm collector status and whether the supply is taxable, obtain a valid tax invoice, then calculate, collect, deposit, and report within the applicable deadline."
              ]),
          "The rate, tax base, due date, and reporting form can vary by supply type, facility, and tax period. Verify the cited provision for the actual transaction before filing."
        ]
      : [];
  const governmentCollectorEn = governmentCollector && language !== "id"
    ? [
        "Government treasurers generally act as **VAT collectors**, rather than choosing a special rate themselves. First confirm that the payment relates to a taxable supply and that the government entity is required to collect.",
        ...(calculationQuestion
          ? [
              "Determine the taxable base (DPP), apply the rate and tax-base mechanism for the relevant tax period, and reconcile the result to the invoice and payment records. Under the non-luxury 12% × 11/12 mechanism, the effective burden is 11% of the sale price or consideration; a full-rate transaction uses 12% of the applicable DPP.",
              "For example, on a pre-VAT sale price of Rp100,000,000 under the 12% × 11/12 mechanism, the special DPP is Rp91,666,666.67 and VAT is Rp11,000,000, giving a total payment of Rp111,000,000. If full 12% applies to a DPP of Rp100,000,000, VAT is Rp12,000,000 and the total is Rp112,000,000.",
              "Check exemptions, special tax bases, and collection evidence before filing."
            ]
          : [
              "Confirm collector status and whether the supply is taxable, obtain a valid tax invoice, then calculate, collect, deposit, and report within the applicable deadline."
            ]),
        "The rate, tax base, due date, and reporting form can vary by supply type, facility, and tax period. Verify the cited provision for the actual transaction before filing."
      ]
    : [];
  const vatCalculationId = !governmentCollector && language === "id" && calculationQuestion && /ppn|pajak\s+pertambahan\s+nilai/i.test(question)
    ? [
        "Untuk menghitung PPN, tentukan terlebih dahulu harga jual atau penggantian, DPP yang berlaku, jenis transaksi, dan masa pajaknya. Setelah itu, terapkan tarif atau besaran tertentu yang ditetapkan oleh aturan. Secara umum, PPN terutang dihitung dari tarif dikalikan DPP.",
        "Rumus praktisnya adalah **PPN = tarif × DPP**. Pada skema non-mewah PMK 131/2024, tarif 12% diterapkan atas nilai lain sebesar 11/12 dari harga jual atau penggantian, sehingga beban efektifnya menjadi 11% dari harga jual atau penggantian. Jika dokumen sudah memberikan DPP nilai lain, angka tersebut digunakan langsung dan tidak dikalikan 11/12 lagi.",
        "Contoh komprehensif:\n1. Harga jual BKP/JKP non-mewah sebelum PPN = Rp100.000.000. Asumsi: tidak ada fasilitas dan mekanisme 12% × 11/12 berlaku.\n2. DPP nilai lain = 11/12 × Rp100.000.000 = Rp91.666.666,67.\n3. PPN = 12% × Rp91.666.666,67 = Rp11.000.000.\n4. Total tagihan termasuk PPN = Rp100.000.000 + Rp11.000.000 = Rp111.000.000.\n5. Pembanding tarif penuh: apabila 12% berlaku atas DPP Rp100.000.000, PPN = Rp12.000.000 dan total tagihan = Rp112.000.000.",
        "Sebelum memakai hasil contoh, pastikan transaksi tidak menggunakan fasilitas pembebasan atau tidak dipungut, nilai lain khusus, tarif penuh, atau ketentuan sektoral yang mengubah DPP dan tarif."
      ]
    : [];
  const vatCalculationEn = !governmentCollector && language !== "id" && calculationQuestion && /vat|value\s+added\s+tax/i.test(question)
    ? [
        "To calculate VAT, first identify the sale price or consideration, the applicable tax base (DPP), the transaction type, and the tax period. Then apply the rate or specific amount prescribed by the applicable rule. In general, VAT is the applicable rate multiplied by the DPP.",
        "The practical formula is **VAT = rate × DPP**. Under the non-luxury PMK 131/2024 mechanism, 12% is applied to a tax base equal to 11/12 of the sale price or consideration, producing an effective 11% burden. If the document already states the special DPP, use that figure directly and do not apply 11/12 again.",
        "Comprehensive example:\n1. Pre-VAT sale price of a non-luxury taxable supply = Rp100,000,000. Assumption: no facility applies and the 12% × 11/12 mechanism is used.\n2. Special DPP = 11/12 × Rp100,000,000 = Rp91,666,666.67.\n3. VAT = 12% × Rp91,666,666.67 = Rp11,000,000.\n4. Total including VAT = Rp100,000,000 + Rp11,000,000 = Rp111,000,000.\n5. Full-rate comparison: if 12% applies to a DPP of Rp100,000,000, VAT = Rp12,000,000 and the total = Rp112,000,000.",
        "Before applying the example, check for exemptions, special tax bases, full-rate treatment, or sector-specific rules that change the DPP or rate."
      ]
    : [];
  const incomeTaxId = incomeTax && language === "id" && !governmentCollector
    ? [
        "PPh adalah pajak atas penghasilan, tetapi cara menentukan subjek, objek, pemotong atau penyetor, tarif, DPP, dan tenggat bergantung pada jenisnya—misalnya PPh Pasal 21, 22, 23, 25, PPh Final Pasal 4 ayat (2), atau PPh Final UMKM.",
        ...(calculationQuestion
          ? ["Untuk menghitungnya, tentukan lebih dahulu jenis PPh dan penerima penghasilan, masa pajak, penghasilan bruto atau dasar pengenaan, tarif/fasilitas, serta kredit pajak bila relevan. Jangan langsung memakai satu tarif untuk semua jenis PPh."]
          : ["Jawaban berikut mempertahankan ketentuan minimum dari buku dan menambahkan konteks praktis. Untuk angka dan tenggat yang akan dipakai dalam pelaporan, cocokkan lagi dengan peraturan resmi terbaru dan masa pajak yang bersangkutan."])
      ]
    : [];
  const incomeTaxEn = incomeTax && language !== "id" && !governmentCollector
    ? [
        "Income tax (PPh) covers several regimes. The taxpayer, object, withholding or self-assessment mechanism, rate, tax base, and deadline depend on whether the question concerns Article 21, 22, 23, 25, Final Article 4(2), or Final UMKM tax.",
        ...(calculationQuestion
          ? ["For a calculation, identify the regime and recipient, tax period, gross income or tax base, applicable rate/facility, and any creditable tax before applying a formula. One rate must not be applied to every PPh regime."]
          : ["The answer below preserves the book's minimum rule and adds practical context. Verify the current official regulation and relevant tax period before filing."])
      ]
    : [];
  const derivedId = /non.?mewah/i.test(question) && uniqueMatched.some(({ provision }) => /11\s*\/\s*12/i.test(provision.text))
    ? "Perhitungan efektif pada skema tersebut adalah 12% × 11/12 × harga jual atau penggantian = 11% dari harga jual atau penggantian, berdasarkan Pasal 3 ayat (2) dan ayat (3)."
    : "";
  const derivedEn = /non.?luxury/i.test(question) && uniqueMatched.some(({ provision }) => /11\s*\/\s*12/i.test(provision.text))
    ? "The effective calculation under that mechanism is 12% × 11/12 × the sale price or consideration = 11% of the sale price or consideration, based on Article 3 paragraphs (2) and (3)."
    : "";
  const matchedRuleTextId = uniqueMatched.slice(0, 4)
    .map(({ item, provision }) => `Menurut ${item.citation}${provision.article ? ` ${provision.article}` : ""}, ${compactProvisionText(provision.text, question)}`)
    .join("\n\n");
  const matchedRuleTextEn = uniqueMatched.slice(0, 4)
    .map(({ item, provision }) => `Under ${item.citation}${provision.article ? ` ${provision.article}` : ""}, ${compactProvisionText(provision.text, question)}`)
    .join("\n\n");
  const genericId = [
    ...(derivedId ? [derivedId] : []),
    matchedRuleTextId || "Saya belum menemukan ketentuan yang cukup spesifik untuk menjelaskan pertanyaan ini secara aman.",
    "Sebelum diterapkan, cocokkan jenis transaksi, masa pajak, fasilitas, dan status aturan pada sumber utama yang ditampilkan di atas."
  ];
  const genericEn = [
    ...(derivedEn ? [derivedEn] : []),
    matchedRuleTextEn || "I could not find sufficiently specific provisions to explain this question safely.",
    "Before applying the result, confirm the transaction type, tax period, facilities, and legal status against the primary sources shown above."
  ];
  const answer = language === "id"
    ? (governmentCollectorId.length ? governmentCollectorId : vatCalculationId.length ? vatCalculationId : incomeTaxId.length ? incomeTaxId.concat(genericId) : genericId).join("\n\n")
    : (governmentCollectorEn.length ? governmentCollectorEn : vatCalculationEn.length ? vatCalculationEn : incomeTaxEn.length ? incomeTaxEn.concat(genericEn) : genericEn).join("\n\n");
  return { answer, abstained: false, matchedProvisions: uniqueMatched.map(({ item, provision }) => ({ citation: item.citation, article: provision.article, text: compactProvisionText(provision.text, question) })) };
}
