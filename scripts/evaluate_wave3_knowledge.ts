import fs from "node:fs";
import path from "node:path";
import { buildKnowledgeHub, queryKnowledgeHub, type KnowledgeDomain } from "../lib/knowledge-hub";
import { loadLocalRegulationSnapshot } from "../lib/regulation-snapshot";
import { loadRegulationGraphSnapshot } from "../lib/regulation-timeline";
import { loadOfficialKnowledgeChunks, loadOfficialKnowledgeSnapshot } from "../lib/official-knowledge";

const outputPath = path.resolve(process.argv[2] || "tests/evaluation/results/wave3-knowledge-parity.json");
const snapshotPath = process.env.TDP_LOCAL_REGULATION_SNAPSHOT || path.resolve("data/regulation-pipeline-import/next-regulations.jsonl.gz");
const records = loadLocalRegulationSnapshot(snapshotPath);
const official = loadOfficialKnowledgeSnapshot();
const officialChunks = loadOfficialKnowledgeChunks();
const hub = buildKnowledgeHub(records, loadRegulationGraphSnapshot(), official.items, officialChunks.chunks);
const domains: KnowledgeDomain[] = ["treaty", "guides", "manual", "changes", "glossary", "forms", "rates"];

const retrievalCases = domains.flatMap((domain) => hub.items.filter((item) => item.domain === domain).slice(0, 20).map((item) => {
  const query = item.title;
  const result = queryKnowledgeHub(hub, { domain, query, limit: 10 });
  return {
    id: item.id,
    domain,
    query,
    returned: result.items.length,
    rank: result.items.findIndex((entry) => entry.id === item.id) + 1,
    passed: result.items.some((entry) => entry.id === item.id)
  };
}));

const scenarioDefinitions: Array<{ id: string; domain: KnowledgeDomain; query: string; expected: string }> = [
  { id: "treaty-malaysia", domain: "treaty", query: "P3B Indonesia Malaysia", expected: "Malaysia" },
  { id: "treaty-australia-mli", domain: "treaty", query: "MLI Australia", expected: "Australia" },
  { id: "treaty-vietnam", domain: "treaty", query: "P3B Viet Nam", expected: "Viet Nam" },
  { id: "coretax-email", domain: "guides", query: "Coretax alamat email wajib pajak", expected: "Pendaftaran wajib pajak orang pribadi" },
  { id: "coretax-invoice", domain: "guides", query: "Coretax nomor seri faktur", expected: "Pelaporan SPT masa PPN" },
  { id: "coretax-nppn", domain: "guides", query: "pemberitahuan penggunaan NPPN Coretax", expected: "Pemberitahuan penggunaan norma" },
  { id: "guide-doctor", domain: "guides", query: "panduan pajak dokter tenaga medis", expected: "Dokter dan tenaga medis" },
  { id: "guide-affiliate", domain: "guides", query: "transaksi afiliasi dokumentasi transfer pricing", expected: "Transaksi afiliasi" },
  { id: "manual-pph21", domain: "manual", query: "Bagaimana cara menghitung PPh Pasal 21 bulanan pegawai tetap?", expected: "menghitung PPh Pasal 21 bulanan" },
  { id: "manual-pph22", domain: "manual", query: "Berapa tarif PPh Pasal 22 atas impor?", expected: "tarif PPh Pasal 22 atas impor" },
  { id: "glossary-beneficial-owner", domain: "glossary", query: "apa arti beneficial owner", expected: "Beneficial Owner" },
  { id: "glossary-skpkb", domain: "glossary", query: "definisi SKPKB", expected: "Kurang Bayar" },
  { id: "form-dgt", domain: "forms", query: "Form DGT PMK 112 Tahun 2025", expected: "Form DGT" },
  { id: "form-efin", domain: "forms", query: "formulir permohonan EFIN PDF isian", expected: "EFIN" },
  { id: "form-spt-op", domain: "forms", query: "SPT Tahunan Orang Pribadi 2025", expected: "SPT Tahunan Orang Pribadi 2025" },
  { id: "rate-usd", domain: "rates", query: "kurs pajak USD 19 Agustus 2026", expected: "USD" },
  { id: "rate-jpy", domain: "rates", query: "kurs pajak JPY per 100 yen", expected: "JPY" }
];
const scenarioCases = scenarioDefinitions.map((scenario) => {
  const result = queryKnowledgeHub(hub, { domain: scenario.domain, query: scenario.query, limit: 10 });
  const rank = result.items.findIndex((item) => item.title.toLowerCase().includes(scenario.expected.toLowerCase())) + 1;
  return { ...scenario, rank, passed: rank > 0, returnedIds: result.items.map((item) => item.id) };
});

const manualItems = hub.items.filter((item) => item.domain === "manual");
const changeItems = hub.items.filter((item) => item.domain === "changes");
const glossaryItems = hub.items.filter((item) => item.domain === "glossary");
const treatyItems = hub.items.filter((item) => item.domain === "treaty");
const guideItems = hub.items.filter((item) => item.domain === "guides");
const formItems = hub.items.filter((item) => item.domain === "forms");
const rateItems = hub.items.filter((item) => item.domain === "rates");
const officialTreatyItems = treatyItems.filter((item) => item.id.startsWith("official:treaty:"));
const officialCoretaxItems = guideItems.filter((item) => item.id.startsWith("official:coretax:"));
const officialFormItems = formItems.filter((item) => item.id.startsWith("official:form:"));
const officialRateItems = rateItems.filter((item) => item.id.startsWith("official:rate:"));
const ratio = (values: boolean[]) => values.length ? Math.round(values.filter(Boolean).length / values.length * 10_000) / 10_000 : 0;
const coverage = (items: typeof hub.items, check: (item: typeof hub.items[number]) => boolean) => ratio(items.map(check));

const sourceAudit = Object.fromEntries(domains.map((domain) => {
  const items = hub.items.filter((item) => item.domain === domain);
  return [domain, {
    count: items.length,
    verified: items.filter((item) => item.evidenceStatus === "verified").length,
    officialUrlCoverage: coverage(items, (item) => Boolean(item.officialUrl)),
    pdfCoverage: coverage(items, (item) => Boolean(item.pdfUrl)),
    hashCoverage: coverage(items, (item) => Boolean(item.sourceHash)),
    locatorCoverage: coverage(items, (item) => Boolean(item.locator?.article || item.locator?.page))
  }];
}));

const summary = {
  benchmarkCases: retrievalCases.length,
  sourceRecords: hub.totals.sourceRecords,
  primaryLawRecords: hub.totals.primaryLawRecords,
  manualRecords: hub.totals.manualRecords,
  knowledgeItems: hub.totals.knowledgeItems,
  retrievalHitAt10: ratio(retrievalCases.map((item) => item.passed)),
  scenarioCases: scenarioCases.length,
  scenarioHitAt10: ratio(scenarioCases.map((item) => item.passed)),
  treatyItems: treatyItems.length,
  p3bItems: treatyItems.filter((item) => item.subtype === "P3B" || item.subtype === "Protokol P3B").length,
  mliItems: treatyItems.filter((item) => item.subtype === "MLI").length,
  structuredTreatyPartners: officialTreatyItems.length,
  coretaxItems: guideItems.filter((item) => item.subtype === "Coretax").length,
  officialCoretaxManuals: officialCoretaxItems.length,
  coretaxSearchablePages: officialChunks.chunks.length,
  transactionGuideItems: guideItems.filter((item) => item.subtype === "Transaksi").length,
  professionGuideItems: guideItems.filter((item) => item.subtype === "Profesi").length,
  taxManualItems: manualItems.length,
  verifiedGraphChanges: changeItems.length,
  glossaryItems: glossaryItems.length,
  formKnowledgeItems: formItems.length,
  formFileCoverage: coverage(formItems, (item) => Boolean(item.pdfUrl)),
  officialFormFiles: officialFormItems.length,
  officialFormFileCoverage: coverage(officialFormItems, (item) => Boolean(item.pdfUrl && item.sourceHash)),
  rateRegulationItems: rateItems.length,
  structuredCurrentRateRows: rateItems.filter((item) => item.subtype === "Kurs mingguan" && Number(item.metadata?.value || 0) > 0).length,
  verifiedCurrentRateRows: officialRateItems.filter((item) => item.evidenceStatus === "verified").length,
  officialConnectors: hub.connectors.length,
  readyDomains: hub.readiness.filter((item) => item.status === "ready").length,
  partialDomains: hub.readiness.filter((item) => item.status === "partial").length,
  gapDomains: hub.readiness.filter((item) => item.status === "gap").length
};

const quality = {
  manualNeverPresentedAsPrimaryLaw: manualItems.every((item) => item.evidenceStatus === "reference_only" && item.sourceKind === "manual"),
  graphFailClosed: changeItems.every((item) => item.evidenceStatus === "verified" && item.metadata?.verified === true),
  glossaryHasProvenance: glossaryItems.every((item) => item.evidenceStatus === "review_required" || Boolean(item.internalUrl && item.sourceHash)),
  dynamicSourcesTrackedHonestly: hub.connectors.every((item) => item.ingestion === "not_ingested" || item.ingestion === "catalogued"),
  readinessDisclosesGaps: hub.readiness.filter((item) => item.status !== "ready").every((item) => item.missing.length > 0)
};

const gates = {
  benchmarkSize: summary.benchmarkCases >= 100,
  retrieval: summary.retrievalHitAt10 >= 0.9,
  realisticScenarios: summary.scenarioHitAt10 >= 0.9,
  treatyCatalog: summary.treatyItems >= 70 && summary.mliItems > 0,
  taxManual: summary.taxManualItems >= 200,
  glossary: summary.glossaryItems >= 12,
  sourceSeparation: quality.manualNeverPresentedAsPrimaryLaw,
  graphFailClosed: quality.graphFailClosed,
  explicitGaps: quality.readinessDisclosesGaps && quality.dynamicSourcesTrackedHonestly
};

const dataEnoughForProductionParity = hub.readiness.every((item) => item.status === "ready")
  && summary.structuredCurrentRateRows > 0
  && summary.officialFormFileCoverage >= 0.9;
const recommendations = [
  "Ingest matriks resmi P3B/MLI per negara beserta tanggal efektif, CTA, reservasi, notifikasi, dan synthesized text bilingual.",
  "Unduh dan versi-kan seluruh seri manual Coretax resmi; pecah per langkah, layar, peran, dan masa berlaku.",
  "Bangun registry formulir yang menyimpan file PDF/XLSX, tahun pajak, status aktif, checksum, dan aturan dasar.",
  "Tambahkan scheduled weekly ingestion untuk KMK kurs dan tabel mata uang terstruktur dengan deteksi gap/revisi.",
  "Lanjutkan review graph perubahan untuk instrumen prioritas sebelum rekap perubahan dipakai chatbot utama.",
  "Tambah tax manual resmi/berlisensi per industri, profesi, dan jenis transaksi; manual edukatif tetap harus diverifikasi terhadap hukum primer."
];

const output = {
  schemaVersion: "aa-jurist-wave3-knowledge-parity-v1",
  generatedAt: new Date().toISOString(),
  summary,
  sourceAudit,
  readiness: hub.readiness,
  connectors: hub.connectors,
  quality,
  gates,
  implementationPassed: Object.values(gates).every(Boolean),
  dataEnoughForProductionParity,
  recommendations,
  cases: retrievalCases,
  scenarios: scenarioCases
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output: path.relative(process.cwd(), outputPath), summary, quality, gates, implementationPassed: output.implementationPassed, dataEnoughForProductionParity }, null, 2)}\n`);
if (!output.implementationPassed) process.exitCode = 1;
