import { graphEdgeEligibleForAnswer } from "./regulation-answer";
import { canonicalRegulationKey } from "./regulation-knowledge";
import type { Regulation } from "./mock-data";
import type { OfficialKnowledgeChunk } from "./official-knowledge";

export type KnowledgeDomain = "treaty" | "guides" | "manual" | "changes" | "glossary" | "forms" | "rates";
export type KnowledgeReadiness = "ready" | "partial" | "gap";
export type KnowledgeEvidenceStatus = "verified" | "review_required" | "reference_only";

export type KnowledgeLocator = {
  article?: string;
  page?: number;
};

export type KnowledgeItem = {
  id: string;
  domain: KnowledgeDomain;
  subtype: string;
  title: string;
  citation: string;
  summary: string;
  tags: string[];
  evidenceStatus: KnowledgeEvidenceStatus;
  legalStatus: string;
  effectiveFrom?: string;
  officialUrl: string;
  pdfUrl: string;
  internalUrl: string;
  sourceHash: string;
  locator?: KnowledgeLocator;
  sourceKind: "primary_law" | "official_guidance" | "manual" | "reviewed_graph" | "editorial_glossary" | "editorial_guide";
  metadata?: Record<string, string | number | boolean | null>;
};

export type KnowledgeSourceConnector = {
  id: string;
  domain: KnowledgeDomain;
  title: string;
  authority: string;
  url: string;
  updateCadence: "event_driven" | "weekly" | "periodic";
  ingestion: "catalogued" | "not_ingested";
  note: string;
};

export type KnowledgeDomainReadiness = {
  domain: KnowledgeDomain;
  label: string;
  status: KnowledgeReadiness;
  itemCount: number;
  verifiedCount: number;
  officialUrlCoverage: number;
  pdfCoverage: number;
  locatorCoverage: number;
  explanation: string;
  missing: string[];
};

export type KnowledgeHub = {
  generatedAt: string;
  items: KnowledgeItem[];
  connectors: KnowledgeSourceConnector[];
  readiness: KnowledgeDomainReadiness[];
  totals: {
    sourceRecords: number;
    primaryLawRecords: number;
    manualRecords: number;
    knowledgeItems: number;
    verifiedItems: number;
  };
  searchChunks?: OfficialKnowledgeChunk[];
};

export type KnowledgeQuery = {
  domain?: KnowledgeDomain | "all";
  subtype?: string;
  status?: KnowledgeEvidenceStatus;
  query?: string;
  limit?: number;
  offset?: number;
};

export type KnowledgeQueryResult = {
  items: KnowledgeItem[];
  total: number;
  hasMore: boolean;
  facets: {
    domains: Array<{ value: KnowledgeDomain; count: number }>;
    subtypes: Array<{ value: string; count: number }>;
    statuses: Array<{ value: KnowledgeEvidenceStatus; count: number }>;
  };
};

type GraphPayload = {
  edges?: Array<Record<string, unknown>>;
};

const DOMAIN_LABELS: Record<KnowledgeDomain, string> = {
  treaty: "P3B & MLI",
  guides: "Panduan transaksi, profesi & Coretax",
  manual: "Tax manual",
  changes: "Rekap perubahan",
  glossary: "Glosarium",
  forms: "Formulir",
  rates: "Kurs pajak"
};

export const knowledgeSourceConnectors: KnowledgeSourceConnector[] = [
  {
    id: "djp-tax-treaty-mli",
    domain: "treaty",
    title: "Tax Treaty and Multilateral Instrument",
    authority: "Direktorat Jenderal Pajak",
    url: "https://www.pajak.go.id/id/taxtreaty-mli",
    updateCadence: "event_driven",
    ingestion: "not_ingested",
    note: "Matriks negara, tanggal penandatanganan, entry into force, dan entry into effect perlu disinkronkan sebagai data terstruktur."
  },
  {
    id: "oecd-mli-matching",
    domain: "treaty",
    title: "BEPS MLI Matching Database",
    authority: "OECD",
    url: "https://www.oecd.org/en/data/tools/beps-mli-matching-database.html",
    updateCadence: "event_driven",
    ingestion: "not_ingested",
    note: "Diperlukan untuk matching pilihan pasal, reservasi, dan notifikasi masing-masing yurisdiksi."
  },
  {
    id: "djp-coretax-manual",
    domain: "guides",
    title: "Buku Panduan Coretax DJP",
    authority: "Direktorat Jenderal Pajak",
    url: "https://www.pajak.go.id/coretaxpedia/buku-panduan-coretax-djp",
    updateCadence: "event_driven",
    ingestion: "not_ingested",
    note: "Manual resmi per proses bisnis dan segmen wajib pajak belum menjadi corpus PDF terversi."
  },
  {
    id: "djp-tax-forms",
    domain: "forms",
    title: "Formulir Perpajakan",
    authority: "Direktorat Jenderal Pajak",
    url: "https://www.pajak.go.id/id/formulir-page",
    updateCadence: "event_driven",
    ingestion: "not_ingested",
    note: "File PDF/XLSX, jenis formulir, tahun pajak, dan aturan dasarnya perlu diunduh dan diberi versi."
  },
  {
    id: "kemenkeu-tax-rates",
    domain: "rates",
    title: "Kurs Pajak",
    authority: "Direktorat Jenderal Strategi Ekonomi dan Fiskal, Kementerian Keuangan",
    url: "https://fiskal.kemenkeu.go.id/informasi-publik/kurs-pajak",
    updateCadence: "weekly",
    ingestion: "not_ingested",
    note: "Tabel mata uang mingguan perlu diambil sebagai seri waktu; corpus saat ini terutama berisi instrumen KMK historis."
  }
];

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clip(value: unknown, length = 360) {
  const text = clean(value);
  return text.length <= length ? text : `${text.slice(0, Math.max(0, length - 1)).trim()}…`;
}

function sourceText(record: Regulation) {
  return clean([
    record.title,
    record.citation,
    record.focus,
    record.extraction?.summary,
    record.extraction?.scope?.join(" "),
    record.extraction?.keywords?.join(" ")
  ].filter(Boolean).join(" "));
}

function isBookRecord(record: Regulation) {
  return String(record.canonicalKey || record.id).startsWith("book:");
}

function validHash(record: Regulation) {
  const hash = String(record.fileHash || "").replace(/^sha256:/i, "");
  return /^[a-f0-9]{64}$/i.test(hash) && !hash.startsWith("e3b0c44298fc1c149afbf4c8996fb924");
}

function primaryEvidenceStatus(record: Regulation): KnowledgeEvidenceStatus {
  const legalStatus = record.extraction?.legalStatus || "unknown";
  const hasLocator = Boolean(record.extraction?.keyProvisions?.some((item) => item.page || item.article));
  return record.sourceUrl && validHash(record) && hasLocator && legalStatus !== "unknown" ? "verified" : "review_required";
}

function firstLocator(record: Regulation): KnowledgeLocator | undefined {
  const item = record.extraction?.keyProvisions?.find((entry) => entry.page || entry.article);
  return item ? { article: item.article, page: item.page } : undefined;
}

function baseItem(record: Regulation, domain: KnowledgeDomain, subtype: string, sourceKind: KnowledgeItem["sourceKind"]): KnowledgeItem {
  const canonicalKey = record.canonicalKey || canonicalRegulationKey(record);
  const manual = isBookRecord(record);
  return {
    id: `${domain}:${canonicalKey}`,
    domain,
    subtype,
    title: clean(record.title),
    citation: clean(record.citation),
    summary: clip(record.extraction?.summary || record.focus || record.content),
    tags: [...new Set([...(record.extraction?.scope || []), ...(record.extraction?.keywords || [])].map(clean).filter(Boolean))].slice(0, 10),
    evidenceStatus: manual ? "reference_only" : primaryEvidenceStatus(record),
    legalStatus: record.extraction?.legalStatus || "unknown",
    effectiveFrom: record.extraction?.effectiveDate,
    officialUrl: record.sourceUrl || "",
    pdfUrl: record.storedPdfUrl || record.officialPdfUrl || record.pdfUrl || "",
    internalUrl: manual ? (record.storedPdfUrl || record.pdfUrl || "") : `/sources/regulation/${encodeURIComponent(canonicalKey)}`,
    sourceHash: record.fileHash || "",
    locator: firstLocator(record),
    sourceKind
  };
}

function treatySubtype(text: string) {
  if (/multilateral instrument|konvensi multilateral|\bmli\b/i.test(text)) return "MLI";
  if (/protokol perubahan|protocol/i.test(text)) return "Protokol P3B";
  return "P3B";
}

function guideSubtypes(record: Regulation): string[] {
  const title = clean(record.title);
  const text = sourceText(record);
  const subtypes: string[] = [];
  if (/coretax|sistem inti administrasi perpajakan/i.test(text)) subtypes.push("Coretax");
  if (/\b(?:dokter|pengacara|advokat|notaris|konsultan|freelancer|bendahara|karyawan|pegawai|umkm)\b|pekerja bebas|usaha mikro|content creator/i.test(title)) {
    subtypes.push("Profesi");
  }
  if (/jual beli|\b(?:penjualan|pembelian|sewa|dividen|bunga|royalti|impor|ekspor|properti)\b|penyerahan jasa|perdagangan melalui sistem elektronik|transaksi afiliasi/i.test(title)) {
    subtypes.push("Transaksi");
  }
  return [...new Set(subtypes)];
}

function formSubtype(title: string) {
  if (/spt tahunan/i.test(title)) return "SPT Tahunan";
  if (/spt masa/i.test(title)) return "SPT Masa";
  if (/bukti potong|pemotongan/i.test(title)) return "Bukti potong";
  if (/faktur pajak/i.test(title)) return "Faktur pajak";
  if (/pendaftaran|npwp|pengukuhan/i.test(title)) return "Registrasi";
  return "Formulir lain";
}

function graphKey(value: unknown) {
  return String(value || "").replace(/^law:/i, "").trim().toLowerCase();
}

function graphChangeItems(records: Regulation[], graph: GraphPayload): KnowledgeItem[] {
  const recordMap = new Map(records.filter((record) => !isBookRecord(record)).map((record) => [record.canonicalKey || canonicalRegulationKey(record), record]));
  const result: KnowledgeItem[] = [];
  for (const [index, edge] of (graph.edges || []).entries()) {
    if (!graphEdgeEligibleForAnswer({
      verified: edge.verified === true,
      eligibleForAnswer: edge.eligibleForAnswer === true,
      flags: Array.isArray(edge.flags) ? edge.flags.map(String) : []
    })) continue;
    const sourceKey = graphKey(edge.source);
    const targetKey = graphKey(edge.target);
    const source = recordMap.get(sourceKey);
    const target = recordMap.get(targetKey);
    if (!source || !target) continue;
    const type = clean(edge.type || "related");
    const effectiveDate = clean(edge.effectiveDate) || undefined;
    result.push({
      id: `changes:${clean(edge.id) || `${sourceKey}:${targetKey}:${index}`}`,
      domain: "changes",
      subtype: type,
      title: `${source.citation} ${type.replaceAll("_", " ")} ${target.citation}`,
      citation: `${source.citation} → ${target.citation}`,
      summary: clip(edge.note || `${source.title} memiliki relasi hukum ${type.replaceAll("_", " ")} dengan ${target.title}.`),
      tags: [type, source.citation, target.citation],
      evidenceStatus: "verified",
      legalStatus: source.extraction?.legalStatus || "unknown",
      effectiveFrom: effectiveDate,
      officialUrl: source.sourceUrl || "",
      pdfUrl: source.storedPdfUrl || source.officialPdfUrl || source.pdfUrl || "",
      internalUrl: `/sources/regulation/${encodeURIComponent(sourceKey)}`,
      sourceHash: source.fileHash || "",
      locator: firstLocator(source),
      sourceKind: "reviewed_graph",
      metadata: {
        sourceKey,
        targetKey,
        confidence: Number(edge.confidence || 0),
        verified: true,
        verificationMethod: clean(edge.method || "unknown"),
        evidence: clip(edge.evidence, 220)
      }
    });
  }
  return result;
}

type GlossarySeed = { term: string; definition: string; aliases?: string[]; sourcePattern: RegExp };

const glossarySeeds: GlossarySeed[] = [
  { term: "Pajak Penghasilan (PPh)", definition: "Pajak atas penghasilan yang diterima atau diperoleh wajib pajak dalam suatu tahun pajak.", aliases: ["PPh"], sourcePattern: /undang-undang pajak penghasilan|\bpph\b/i },
  { term: "Pajak Pertambahan Nilai (PPN)", definition: "Pajak atas konsumsi Barang Kena Pajak dan/atau Jasa Kena Pajak di dalam daerah pabean.", aliases: ["PPN", "VAT"], sourcePattern: /pajak pertambahan nilai|\bppn\b/i },
  { term: "Pengusaha Kena Pajak", definition: "Pengusaha yang melakukan penyerahan kena pajak dan telah atau wajib dikukuhkan sesuai ketentuan PPN.", aliases: ["PKP"], sourcePattern: /pengusaha kena pajak/i },
  { term: "Dasar Pengenaan Pajak", definition: "Nilai yang digunakan sebagai dasar untuk menghitung pajak terutang sesuai jenis transaksi dan ketentuan yang berlaku.", aliases: ["DPP"], sourcePattern: /dasar pengenaan pajak|\bdpp\b/i },
  { term: "Pajak Masukan", definition: "PPN yang seharusnya sudah dibayar oleh PKP karena perolehan atau pemanfaatan BKP/JKP dan impor BKP.", sourcePattern: /pajak masukan/i },
  { term: "Pajak Keluaran", definition: "PPN terutang yang wajib dipungut PKP atas penyerahan kena pajak.", sourcePattern: /pajak keluaran/i },
  { term: "Penghasilan Tidak Kena Pajak", definition: "Pengurang penghasilan neto bagi wajib pajak orang pribadi dalam penghitungan Penghasilan Kena Pajak, sesuai status dan tanggungan.", aliases: ["PTKP"], sourcePattern: /penghasilan tidak kena pajak|\bptkp\b/i },
  { term: "Persetujuan Penghindaran Pajak Berganda", definition: "Perjanjian perpajakan antara Indonesia dan negara/yurisdiksi mitra untuk membagi hak pemajakan dan mencegah pajak berganda serta pengelakan pajak.", aliases: ["P3B", "tax treaty"], sourcePattern: /penghindaran pajak berganda|tax treaty/i },
  { term: "Multilateral Instrument", definition: "Konvensi multilateral yang memodifikasi P3B yang tercakup apabila pilihan pasal, notifikasi, dan reservasi para pihak saling cocok.", aliases: ["MLI"], sourcePattern: /multilateral instrument|konvensi multilateral/i },
  { term: "Norma Penghitungan Penghasilan Neto", definition: "Pedoman persentase untuk menentukan penghasilan neto wajib pajak orang pribadi tertentu yang melakukan kegiatan usaha atau pekerjaan bebas.", aliases: ["NPPN"], sourcePattern: /norma penghitungan penghasilan neto|\bnppn\b/i },
  { term: "Tarif Efektif Rata-rata", definition: "Tarif pemotongan PPh Pasal 21 yang diterapkan pada penghasilan bruto bulanan atau harian untuk masa pajak tertentu sesuai kategorinya.", aliases: ["TER"], sourcePattern: /tarif efektif rata-rata|\bter\b/i },
  { term: "Surat Pemberitahuan", definition: "Surat yang digunakan wajib pajak untuk melaporkan penghitungan dan/atau pembayaran pajak, objek pajak, bukan objek pajak, harta, dan kewajiban sesuai ketentuan.", aliases: ["SPT"], sourcePattern: /surat pemberitahuan|\bspt\b/i },
  { term: "Nomor Pokok Wajib Pajak", definition: "Nomor identitas wajib pajak yang digunakan dalam administrasi perpajakan.", aliases: ["NPWP"], sourcePattern: /nomor pokok wajib pajak|\bnpwp\b/i },
  { term: "Kurs Pajak", definition: "Nilai tukar yang ditetapkan pemerintah untuk pelunasan kewajiban kepabeanan dan perpajakan pada periode berlaku tertentu.", sourcePattern: /nilai kurs sebagai dasar pelunasan|kurs pajak/i },
  { term: "Wajib Pajak", definition: "Orang pribadi atau badan yang mempunyai hak dan kewajiban perpajakan sesuai ketentuan perpajakan.", aliases: ["WP"], sourcePattern: /wajib pajak/i },
  { term: "Wajib Pajak Orang Pribadi", definition: "Orang pribadi yang memenuhi persyaratan subjektif dan objektif perpajakan.", aliases: ["WP OP"], sourcePattern: /wajib pajak orang pribadi/i },
  { term: "Badan Usaha Tetap", definition: "Bentuk usaha yang digunakan subjek pajak luar negeri untuk menjalankan usaha atau kegiatan di Indonesia menurut kriteria hukum pajak.", aliases: ["BUT", "Permanent Establishment"], sourcePattern: /bentuk usaha tetap|permanent establishment/i },
  { term: "Masa Pajak", definition: "Jangka waktu yang menjadi dasar bagi wajib pajak untuk menghitung, menyetor, dan melaporkan pajak yang terutang.", sourcePattern: /masa pajak/i },
  { term: "Tahun Pajak", definition: "Jangka waktu satu tahun kalender, kecuali wajib pajak menggunakan tahun buku yang berbeda sesuai ketentuan.", sourcePattern: /tahun pajak/i },
  { term: "Penghasilan Kena Pajak", definition: "Dasar penghitungan Pajak Penghasilan setelah penghasilan neto fiskal dikurangi pengurang yang diperkenankan.", aliases: ["PKP PPh"], sourcePattern: /penghasilan kena pajak/i },
  { term: "Kredit Pajak", definition: "Pajak yang telah dibayar atau dipotong/dipungut yang dapat diperhitungkan dengan pajak terutang sesuai persyaratan.", sourcePattern: /kredit pajak/i },
  { term: "Surat Pemberitahuan Masa", definition: "SPT untuk melaporkan kewajiban perpajakan pada suatu masa pajak.", aliases: ["SPT Masa"], sourcePattern: /surat pemberitahuan masa|spt masa/i },
  { term: "Surat Pemberitahuan Tahunan", definition: "SPT untuk suatu tahun pajak atau bagian tahun pajak.", aliases: ["SPT Tahunan"], sourcePattern: /surat pemberitahuan tahunan|spt tahunan/i },
  { term: "Surat Setoran Pajak", definition: "Bukti pembayaran atau penyetoran pajak yang dilakukan dengan sarana administrasi yang ditetapkan.", aliases: ["SSP"], sourcePattern: /surat setoran pajak/i },
  { term: "Surat Tagihan Pajak", definition: "Surat untuk melakukan tagihan pajak dan/atau sanksi administrasi berupa bunga dan/atau denda sesuai ketentuan.", aliases: ["STP"], sourcePattern: /surat tagihan pajak/i },
  { term: "Surat Ketetapan Pajak Kurang Bayar", definition: "Surat ketetapan yang menetapkan besarnya pokok pajak, kredit pajak, kekurangan pembayaran, sanksi administrasi, dan jumlah yang masih harus dibayar.", aliases: ["SKPKB"], sourcePattern: /surat ketetapan pajak kurang bayar|skpkb/i },
  { term: "Surat Ketetapan Pajak Kurang Bayar Tambahan", definition: "Surat ketetapan tambahan atas jumlah pajak yang telah ditetapkan sebelumnya ketika syarat penerbitannya terpenuhi.", aliases: ["SKPKBT"], sourcePattern: /surat ketetapan pajak kurang bayar tambahan|skpkbt/i },
  { term: "Surat Ketetapan Pajak Lebih Bayar", definition: "Surat ketetapan yang menentukan jumlah kelebihan pembayaran pajak sesuai hasil pemeriksaan atau penelitian.", aliases: ["SKPLB"], sourcePattern: /surat ketetapan pajak lebih bayar|skplb/i },
  { term: "Surat Ketetapan Pajak Nihil", definition: "Surat ketetapan ketika jumlah pokok pajak sama dengan kredit pajak atau pajak tidak terutang dan tidak ada kredit pajak.", aliases: ["SKPN"], sourcePattern: /surat ketetapan pajak nihil|skpn/i },
  { term: "Keberatan", definition: "Upaya administratif wajib pajak atas materi atau isi ketetapan/pemotongan/pemungutan tertentu yang diajukan kepada otoritas pajak sesuai prosedur.", sourcePattern: /keberatan/i },
  { term: "Banding Pajak", definition: "Upaya hukum ke Pengadilan Pajak terhadap keputusan keberatan atau keputusan lain yang menurut undang-undang dapat diajukan banding.", sourcePattern: /banding.*pengadilan pajak|pengadilan pajak.*banding/i },
  { term: "Gugatan Pajak", definition: "Upaya hukum ke Pengadilan Pajak terhadap pelaksanaan penagihan atau keputusan tertentu yang dapat digugat menurut undang-undang.", sourcePattern: /gugatan.*pengadilan pajak|pengadilan pajak.*gugatan/i },
  { term: "Peninjauan Kembali", definition: "Upaya hukum luar biasa ke Mahkamah Agung atas putusan Pengadilan Pajak berdasarkan alasan yang ditentukan undang-undang.", aliases: ["PK"], sourcePattern: /peninjauan kembali/i },
  { term: "Barang Kena Pajak", definition: "Barang yang dikenai PPN berdasarkan Undang-Undang PPN.", aliases: ["BKP"], sourcePattern: /barang kena pajak/i },
  { term: "Jasa Kena Pajak", definition: "Jasa yang dikenai PPN berdasarkan Undang-Undang PPN.", aliases: ["JKP"], sourcePattern: /jasa kena pajak/i },
  { term: "Pajak Penjualan atas Barang Mewah", definition: "Pajak tambahan atas penyerahan atau impor Barang Kena Pajak yang tergolong mewah sesuai ketentuan.", aliases: ["PPnBM"], sourcePattern: /pajak penjualan atas barang mewah|ppnbm/i },
  { term: "Faktur Pajak", definition: "Bukti pungutan pajak yang dibuat Pengusaha Kena Pajak atas penyerahan kena pajak sesuai ketentuan.", sourcePattern: /faktur pajak/i },
  { term: "Pemotongan Pajak", definition: "Mekanisme ketika pihak pembayar memotong pajak dari penghasilan penerima lalu menyetor dan melaporkannya.", sourcePattern: /pemotongan pajak|pemotong pajak/i },
  { term: "Pemungutan Pajak", definition: "Mekanisme ketika pihak yang ditunjuk memungut pajak dari pihak lain lalu menyetor dan melaporkannya.", sourcePattern: /pemungutan pajak|pemungut pajak/i },
  { term: "PPh Pasal 21", definition: "Pemotongan PPh atas penghasilan sehubungan dengan pekerjaan, jasa, atau kegiatan yang diterima orang pribadi sesuai ketentuan.", sourcePattern: /pph pasal 21|pasal 21.*penghasilan/i },
  { term: "PPh Pasal 22", definition: "Pemungutan PPh oleh pihak tertentu atas kegiatan impor atau kegiatan usaha/transaksi tertentu sesuai penunjukan.", sourcePattern: /pph pasal 22|pasal 22.*pemungut/i },
  { term: "PPh Pasal 23", definition: "Pemotongan PPh atas dividen, bunga, royalti, hadiah, sewa, dan imbalan jasa tertentu kepada wajib pajak dalam negeri atau BUT sesuai ketentuan.", sourcePattern: /pph pasal 23|pasal 23.*jasa/i },
  { term: "PPh Pasal 25", definition: "Angsuran bulanan PPh dalam tahun pajak berjalan yang diperhitungkan dengan PPh terutang pada akhir tahun.", sourcePattern: /pph pasal 25|pasal 25.*angsuran/i },
  { term: "PPh Final", definition: "PPh yang pelunasannya bersifat final untuk penghasilan tertentu sehingga tidak diperhitungkan lagi dengan PPh terutang umum, sesuai ketentuan.", sourcePattern: /pajak penghasilan.*final|pph final/i },
  { term: "Hubungan Istimewa", definition: "Hubungan antara pihak-pihak karena penyertaan modal, penguasaan, atau hubungan keluarga yang memenuhi kriteria hukum pajak.", sourcePattern: /hubungan istimewa/i },
  { term: "Prinsip Kewajaran dan Kelaziman Usaha", definition: "Prinsip bahwa transaksi yang dipengaruhi hubungan istimewa harus sebanding dengan kondisi transaksi independen.", aliases: ["PKKU", "Arm's Length Principle"], sourcePattern: /prinsip kewajaran dan kelaziman usaha|arm.?s length/i },
  { term: "Dokumen Penentuan Harga Transfer", definition: "Dokumentasi yang menunjukkan penerapan prinsip kewajaran dan kelaziman usaha pada transaksi afiliasi sesuai persyaratan yang berlaku.", aliases: ["TP Doc", "Local File", "Master File"], sourcePattern: /dokumen penentuan harga transfer|transfer pricing documentation/i },
  { term: "Surat Keterangan Domisili", definition: "Dokumen yang digunakan untuk membuktikan status domisili pajak dalam penerapan P3B sesuai tata cara yang berlaku.", aliases: ["SKD", "Form DGT"], sourcePattern: /surat keterangan domisili|form dgt/i },
  { term: "Beneficial Owner", definition: "Penerima manfaat yang memenuhi persyaratan substantif untuk memperoleh manfaat P3B atas jenis penghasilan tertentu.", aliases: ["Pemilik Manfaat"], sourcePattern: /beneficial owner|pemilik manfaat/i },
  { term: "Coretax DJP", definition: "Sistem inti administrasi perpajakan DJP yang mendukung proses registrasi, pembayaran, pelaporan, layanan, dan proses administrasi terkait.", aliases: ["Coretax"], sourcePattern: /coretax|sistem inti administrasi perpajakan/i }
];

function glossaryItems(records: Regulation[]): KnowledgeItem[] {
  const primary = records.filter((record) => !isBookRecord(record));
  return glossarySeeds.map((seed) => {
    const source = primary.find((record) => seed.sourcePattern.test(sourceText(record)) && primaryEvidenceStatus(record) === "verified")
      || primary.find((record) => seed.sourcePattern.test(sourceText(record)));
    const canonicalKey = source ? source.canonicalKey || canonicalRegulationKey(source) : "";
    return {
      id: `glossary:${seed.term.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      domain: "glossary",
      subtype: "Istilah pajak",
      title: seed.term,
      citation: source?.citation || "Sumber primer belum dipetakan",
      summary: seed.definition,
      tags: seed.aliases || [],
      evidenceStatus: source && primaryEvidenceStatus(source) === "verified" ? "verified" : "review_required",
      legalStatus: source?.extraction?.legalStatus || "unknown",
      effectiveFrom: source?.extraction?.effectiveDate,
      officialUrl: source?.sourceUrl || "",
      pdfUrl: source?.storedPdfUrl || source?.officialPdfUrl || source?.pdfUrl || "",
      internalUrl: canonicalKey ? `/sources/regulation/${encodeURIComponent(canonicalKey)}` : "",
      sourceHash: source?.fileHash || "",
      locator: source ? firstLocator(source) : undefined,
      sourceKind: "editorial_glossary",
      metadata: { editorialDefinition: true, sourceCanonicalKey: canonicalKey || null }
    };
  });
}

type GuideSeed = { title: string; subtype: "Transaksi" | "Profesi"; summary: string; tags: string[]; sourcePattern: RegExp };

const operationalGuideSeeds: GuideSeed[] = [
  { title: "Pegawai: menghitung dan melaporkan PPh Pasal 21", subtype: "Profesi", summary: "Alur kerja: tetapkan status pegawai dan masa pajak; kumpulkan seluruh penghasilan bruto dan pengurang; gunakan tarif efektif untuk masa berjalan jika berlaku; lakukan penghitungan kembali akhir tahun; rekonsiliasi bukti potong dan SPT.", tags: ["pegawai", "PPh 21", "TER"], sourcePattern: /pph pasal 21|tarif efektif rata-rata/i },
  { title: "Dokter dan tenaga medis: petakan penghasilan serta pemotongan", subtype: "Profesi", summary: "Alur kerja: pisahkan penghasilan sebagai pegawai, jasa profesional, dan usaha; cocokkan setiap pembayaran dengan bukti potong; tentukan pembukuan atau NPPN; rekonsiliasi dengan SPT Tahunan dan aset/kewajiban terkait.", tags: ["dokter", "tenaga medis", "NPPN"], sourcePattern: /norma penghitungan penghasilan neto|pekerjaan bebas/i },
  { title: "Pengacara, notaris, dan konsultan: administrasi pajak pekerjaan bebas", subtype: "Profesi", summary: "Alur kerja: klasifikasikan jasa dan pihak pembayar; periksa pemotongan PPh; tentukan kewajiban PPN/PKP; pilih pembukuan atau NPPN sesuai syarat; simpan kontrak, invoice, pembayaran, dan bukti potong untuk rekonsiliasi tahunan.", tags: ["pengacara", "notaris", "konsultan"], sourcePattern: /pekerjaan bebas|jasa konsultan|norma penghitungan/i },
  { title: "UMKM orang pribadi atau badan: cek fasilitas PPh final", subtype: "Profesi", summary: "Alur kerja: identifikasi bentuk dan tahun berdiri usaha; hitung peredaran bruto per bulan dan kumulatif; uji batas serta jangka waktu fasilitas; pisahkan penghasilan yang dikecualikan; dokumentasikan peralihan ke tarif umum bila fasilitas berakhir.", tags: ["UMKM", "peredaran bruto", "PPh final"], sourcePattern: /peredaran bruto tertentu|usaha mikro|pph final/i },
  { title: "Bendahara atau instansi pemerintah: pembelian dari rekanan", subtype: "Profesi", summary: "Alur kerja: identifikasi status rekanan dan objek transaksi; tentukan PPh/PPN yang harus dipungut; hitung dasar pemungutan; buat atau validasi dokumen pajak; setor, lapor, dan rekonsiliasi dengan tagihan serta pembayaran.", tags: ["bendahara", "instansi pemerintah", "rekanan"], sourcePattern: /instansi pemerintah|bendahara.*pemungut|pemungut pajak/i },
  { title: "Jasa teknik, manajemen, dan konsultan: pemotongan PPh Pasal 23", subtype: "Transaksi", summary: "Alur kerja: pastikan penerima penghasilan dan jenis jasanya; pisahkan komponen yang bukan objek bila didukung bukti; tentukan dasar pemotongan dan tarif menurut status penerima; buat bukti potong; setor serta laporkan tepat waktu.", tags: ["PPh 23", "jasa teknik", "jasa manajemen", "jasa konsultan"], sourcePattern: /pph pasal 23|jasa teknik.*jasa manajemen|jasa konsultan/i },
  { title: "Sewa tanah dan/atau bangunan: PPh final dan dokumentasi", subtype: "Transaksi", summary: "Alur kerja: pastikan objek benar-benar tanah/bangunan; identifikasi nilai sewa dan biaya terkait; tentukan pihak pemotong; buat bukti potong dan rekonsiliasi masa pajak; bedakan dari sewa aset selain tanah/bangunan.", tags: ["sewa", "tanah", "bangunan", "PPh final"], sourcePattern: /persewaan tanah|sewa tanah|sewa.*bangunan/i },
  { title: "Sewa aset selain tanah dan bangunan", subtype: "Transaksi", summary: "Alur kerja: identifikasi aset serta pihak penerima; uji apakah penghasilan termasuk objek PPh Pasal 23 atau rezim lain; tentukan dasar dan tarif; dokumentasikan kontrak, invoice, pembayaran, bukti potong, dan pelaporan.", tags: ["sewa aset", "PPh 23"], sourcePattern: /sewa.*harta|penggunaan harta|pph pasal 23/i },
  { title: "Dividen, bunga, dan royalti: tentukan rezim pemotongan", subtype: "Transaksi", summary: "Alur kerja: identifikasi jenis penghasilan, penerima, domisili, dan hubungan istimewa; cek pengecualian atau fasilitas; tentukan aturan domestik atau P3B; validasi beneficial owner dan dokumen domisili; simpan dasar penghitungan serta bukti potong.", tags: ["dividen", "bunga", "royalti", "P3B"], sourcePattern: /dividen.*bunga.*royalti|royalti.*pasal 23|beneficial owner/i },
  { title: "Impor barang: PPh Pasal 22, PPN impor, dan kurs pajak", subtype: "Transaksi", summary: "Alur kerja: tetapkan nilai impor dan klasifikasi barang; cek API/fasilitas serta pemungut; gunakan kurs pajak pada periode yang tepat; hitung pungutan impor; rekonsiliasi PIB, billing, pembayaran, persediaan, dan kredit pajak.", tags: ["impor", "PPh 22", "PPN impor", "kurs pajak"], sourcePattern: /pph pasal 22.*impor|nilai impor|pemasukan barang/i },
  { title: "Ekspor barang atau jasa: tarif PPN dan bukti pendukung", subtype: "Transaksi", summary: "Alur kerja: tentukan apakah penyerahan memenuhi kriteria ekspor; identifikasi saat terutang dan tarif; siapkan pemberitahuan ekspor, kontrak, invoice, pembayaran, dan bukti penyerahan/pemanfaatan; rekonsiliasi dengan SPT Masa PPN.", tags: ["ekspor", "PPN", "dokumen ekspor"], sourcePattern: /ekspor barang kena pajak|ekspor jasa kena pajak|pemberitahuan ekspor/i },
  { title: "Pengkreditan Pajak Masukan", subtype: "Transaksi", summary: "Alur kerja: pastikan transaksi berkaitan dengan kegiatan kena pajak; validasi faktur dan identitas pihak; cocokkan barang/jasa, pembayaran, pembukuan, dan pelaporan; uji pembatasan pengkreditan serta masa pengkreditan; simpan jejak koreksi.", tags: ["Pajak Masukan", "faktur pajak", "PPN"], sourcePattern: /pajak masukan.*dikreditkan|pengkreditan pajak masukan/i },
  { title: "Pembuatan dan pembetulan Faktur Pajak", subtype: "Transaksi", summary: "Alur kerja: tentukan saat pembuatan; isi identitas, DPP, dan PPN secara konsisten; validasi kode transaksi; unggah/terbitkan melalui sistem yang berlaku; lakukan pembetulan atau pembatalan dengan audit trail bila ada kesalahan.", tags: ["faktur pajak", "pembetulan", "PPN"], sourcePattern: /faktur pajak.*bentuk|pembuatan faktur pajak|pembetulan faktur/i },
  { title: "Perdagangan melalui sistem elektronik (PMSE)", subtype: "Transaksi", summary: "Alur kerja: identifikasi pelaku, lokasi konsumen, dan jenis produk digital; cek penunjukan pemungut; tentukan DPP, tarif, dan saat pemungutan; siapkan bukti pungut; rekonsiliasi transaksi platform, pembayaran, dan pelaporan.", tags: ["PMSE", "produk digital", "PPN"], sourcePattern: /perdagangan melalui sistem elektronik|pmse|produk digital/i },
  { title: "Transaksi afiliasi dan dokumentasi transfer pricing", subtype: "Transaksi", summary: "Alur kerja: petakan pihak serta jenis transaksi afiliasi; uji kewajiban dokumentasi dan tenggat; lakukan analisis fungsi-aset-risiko; pilih metode dan pembanding; rekonsiliasi dengan SPT, laporan keuangan, serta perjanjian; dokumentasikan penyesuaian.", tags: ["transfer pricing", "afiliasi", "PKKU", "local file"], sourcePattern: /penentuan harga transfer|transfer pricing|prinsip kewajaran dan kelaziman/i },
  { title: "Menerapkan P3B dan Form DGT", subtype: "Transaksi", summary: "Alur kerja: identifikasi negara domisili dan jenis penghasilan; cek P3B yang efektif pada tanggal pembayaran; uji beneficial owner serta anti-abuse; validasi Form DGT/SKD; bandingkan tarif domestik dan treaty; simpan bukti untuk pemotongan serta pelaporan.", tags: ["P3B", "Form DGT", "SKD", "beneficial owner"], sourcePattern: /persetujuan penghindaran pajak berganda|surat keterangan domisili|form dgt/i }
];

function operationalGuideItems(records: Regulation[]): KnowledgeItem[] {
  const primary = records.filter((record) => !isBookRecord(record));
  return operationalGuideSeeds.map((seed) => {
    const source = primary.find((record) => seed.sourcePattern.test(sourceText(record)) && primaryEvidenceStatus(record) === "verified")
      || primary.find((record) => seed.sourcePattern.test(sourceText(record)));
    const canonicalKey = source ? source.canonicalKey || canonicalRegulationKey(source) : "";
    return {
      id: `guides:editorial:${seed.subtype.toLowerCase()}:${seed.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      domain: "guides", subtype: seed.subtype, title: seed.title,
      citation: source?.citation || "Aturan pengendali perlu dipetakan",
      summary: seed.summary, tags: seed.tags, evidenceStatus: "reference_only",
      legalStatus: source?.extraction?.legalStatus || "unknown", effectiveFrom: source?.extraction?.effectiveDate,
      officialUrl: source?.sourceUrl || "", pdfUrl: source?.storedPdfUrl || source?.officialPdfUrl || source?.pdfUrl || "",
      internalUrl: canonicalKey ? `/sources/regulation/${encodeURIComponent(canonicalKey)}` : "", sourceHash: source?.fileHash || "",
      locator: source ? firstLocator(source) : undefined, sourceKind: "editorial_guide",
      metadata: { editorialWorkflow: true, sourceCanonicalKey: canonicalKey || null, requiresPrimaryLawValidation: true }
    };
  });
}

function coverage(items: KnowledgeItem[], key: "officialUrl" | "pdfUrl" | "locator") {
  if (!items.length) return 0;
  const available = items.filter((item) => key === "locator" ? Boolean(item.locator?.article || item.locator?.page) : Boolean(item[key])).length;
  return Math.round((available / items.length) * 10_000) / 100;
}

function readinessFor(domain: KnowledgeDomain, items: KnowledgeItem[]): KnowledgeDomainReadiness {
  const verifiedCount = items.filter((item) => item.evidenceStatus === "verified").length;
  const officialUrlCoverage = coverage(items, "officialUrl");
  const pdfCoverage = coverage(items, "pdfUrl");
  const locatorCoverage = coverage(items, "locator");
  let status: KnowledgeReadiness = items.length ? "partial" : "gap";
  const missing: string[] = [];
  let explanation = "Corpus tersedia, tetapi masih memerlukan pengayaan dan review sumber.";
  if (domain === "manual") {
    const sourceDocuments = new Set(items.map((item) => item.sourceHash).filter(Boolean)).size;
    status = items.length ? "partial" : "gap";
    explanation = items.length
      ? `Tax manual lokal memiliki pasangan pertanyaan, PDF, hash, dan locator halaman, tetapi baru berasal dari ${sourceDocuments} dokumen manual.`
      : "Belum ada tax manual yang terhubung.";
    missing.push("Tambahan manual resmi/berlisensi per jenis pajak dan industri", "Review hukum dan versi masa berlaku");
  } else if (domain === "changes") {
    status = items.length ? "partial" : "gap";
    explanation = items.length ? "Hanya relasi graph yang lolos verifikasi mesin dan eligible-for-answer yang ditampilkan; sign-off ahli belum lengkap." : "Belum ada relasi graph terverifikasi untuk rekap perubahan.";
    missing.push("Sign-off ahli untuk relasi perubahan instrumen prioritas", "Locator bukti relasi dan ketentuan transisi");
  } else if (domain === "treaty") {
    status = items.length >= 70 && locatorCoverage >= 70 ? "partial" : items.length ? "partial" : "gap";
    explanation = "Naskah P3B/MLI tersedia, tetapi matriks negara, effective date, dan matching reservasi/notifikasi belum terstruktur penuh.";
    missing.push("Sinkronisasi matriks resmi P3B/MLI", "Matching position dan reservasi OECD", "PDF bilingual terkonsolidasi");
  } else if (domain === "guides") {
    status = items.some((item) => item.sourceKind === "official_guidance") ? "partial" : items.length ? "partial" : "gap";
    explanation = "Aturan dan sebagian referensi panduan dapat ditemukan, namun corpus manual operasional resmi belum lengkap dan terversi.";
    missing.push("Seri PDF Coretax resmi", "Panduan per profesi dan transaksi dengan langkah kerja", "Versi dan tanggal pembaruan panduan");
  } else if (domain === "forms") {
    status = items.length ? "partial" : "gap";
    explanation = "Aturan yang menyebut formulir tersedia; file formulir blank/Excel yang dapat digunakan belum menjadi katalog terversi penuh.";
    missing.push("Unduh file PDF/XLSX resmi", "Pemetaan formulir ke tahun pajak dan aturan dasar", "Validasi formulir aktif");
  } else if (domain === "rates") {
    const today = new Date().toISOString().slice(0, 10);
    const currentRows = items.filter((item) => item.subtype === "Kurs mingguan" && item.evidenceStatus === "verified" && String(item.metadata?.validFrom || "") <= today && String(item.metadata?.validTo || "") >= today);
    status = currentRows.length >= 25 ? "ready" : items.length ? "partial" : "gap";
    explanation = status === "ready"
      ? `Feed minggu berjalan memuat ${currentRows.length} mata uang dengan KMK, checksum dokumen, locator, dan rentang berlaku.`
      : "KMK kurs historis tersedia, tetapi tabel nilai per mata uang minggu berjalan belum lengkap atau sudah melewati masa berlaku.";
    if (status !== "ready") missing.push("Ingest tabel kurs mingguan", "Validasi rentang tanggal berlaku", "Deteksi minggu yang hilang dan revisi");
  } else if (domain === "glossary") {
    status = items.length ? "partial" : "gap";
    explanation = "Definisi editorial dasar telah dipautkan ke sumber primer, tetapi cakupan istilah dan sign-off ahli belum memadai untuk glosarium produksi.";
    missing.push("Perluasan istilah per jenis pajak dan proses bisnis", "Review ahli dan versioning definisi");
  }
  return {
    domain,
    label: DOMAIN_LABELS[domain],
    status,
    itemCount: items.length,
    verifiedCount,
    officialUrlCoverage,
    pdfCoverage,
    locatorCoverage,
    explanation,
    missing
  };
}

export function buildKnowledgeHub(records: Regulation[], graph: GraphPayload = {}, officialItems: KnowledgeItem[] = [], searchChunks: OfficialKnowledgeChunk[] = []): KnowledgeHub {
  const items: KnowledgeItem[] = [];
  for (const record of records) {
    const text = sourceText(record);
    if (isBookRecord(record)) {
      items.push(baseItem(record, "manual", clean(record.extraction?.scope?.[0] || record.topic || "Tax manual"), "manual"));
      continue;
    }
    if (/penghindaran pajak berganda|tax treaty|multilateral instrument|konvensi multilateral/i.test(text)) {
      items.push(baseItem(record, "treaty", treatySubtype(text), "primary_law"));
    }
    for (const subtype of guideSubtypes(record)) {
      items.push(baseItem(record, "guides", subtype, "primary_law"));
    }
    const title = clean(record.title);
    if (/formulir|bentuk[, ]+isi[, ]+dan tata cara pengisian|surat pemberitahuan|bukti potong|faktur pajak/i.test(title)) {
      items.push(baseItem(record, "forms", formSubtype(title), "primary_law"));
    }
    if (/nilai kurs sebagai dasar pelunasan|kurs pajak/i.test(title)) {
      items.push(baseItem(record, "rates", "KMK kurs", "primary_law"));
    }
  }
  items.push(...graphChangeItems(records, graph));
  items.push(...glossaryItems(records));
  items.push(...operationalGuideItems(records));
  items.push(...officialItems.map((item) => ({ ...item, internalUrl: item.internalUrl || `/knowledge/${encodeURIComponent(item.id)}` })));
  const deduplicated = [...new Map(items.map((item) => [item.id, item])).values()];
  const domains = Object.keys(DOMAIN_LABELS) as KnowledgeDomain[];
  const readiness = domains.map((domain) => readinessFor(domain, deduplicated.filter((item) => item.domain === domain)));
  return {
    generatedAt: new Date().toISOString(),
    items: deduplicated,
    connectors: knowledgeSourceConnectors.map((connector) => {
      const ingested = connector.id === "djp-tax-treaty-mli"
        ? officialItems.some((item) => item.domain === "treaty" && item.citation.startsWith("DJP Tax Treaty"))
        : connector.id === "djp-coretax-manual"
          ? officialItems.some((item) => item.domain === "guides" && item.subtype === "Coretax")
          : connector.id === "djp-tax-forms"
            ? officialItems.some((item) => item.domain === "forms")
            : connector.id === "kemenkeu-tax-rates"
              ? officialItems.some((item) => item.domain === "rates" && item.subtype === "Kurs mingguan")
              : false;
      return ingested ? { ...connector, ingestion: "catalogued" as const, note: `${connector.note} Snapshot resmi sudah tersambung; pembaruan berikutnya mengikuti cadence sumber.` } : connector;
    }),
    readiness,
    totals: {
      sourceRecords: records.length,
      primaryLawRecords: records.filter((record) => !isBookRecord(record)).length,
      manualRecords: records.filter(isBookRecord).length,
      knowledgeItems: deduplicated.length,
      verifiedItems: deduplicated.filter((item) => item.evidenceStatus === "verified").length
    },
    searchChunks
  };
}

function facet<T extends string>(items: KnowledgeItem[], value: (item: KnowledgeItem) => T) {
  const counts = new Map<T, number>();
  for (const item of items) counts.set(value(item), (counts.get(value(item)) || 0) + 1);
  return [...counts.entries()].map(([entry, count]) => ({ value: entry, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function queryKnowledgeHub(hub: KnowledgeHub, query: KnowledgeQuery = {}): KnowledgeQueryResult {
  const needle = clean(query.query).toLowerCase();
  const queryStopwords = new Set(["apa", "arti", "definisi", "panduan", "cara", "pajak", "peraturan", "formulir", "untuk", "yang", "dan", "atau", "the", "how", "what"]);
  const queryTokens = needle.split(/[^a-z0-9]+/i).filter((token) => token.length > 1 && !queryStopwords.has(token));
  const chunkMatches = new Map<string, { score: number; page: number; excerpt: string }>();
  if (queryTokens.length) for (const chunk of hub.searchChunks || []) {
    const body = clean(chunk.text).toLowerCase();
    const score = queryTokens.filter((token) => body.includes(token)).length;
    if (!score) continue;
    const current = chunkMatches.get(chunk.parentId);
    if (!current || score > current.score) {
      const first = Math.max(0, Math.min(...queryTokens.map((token) => body.indexOf(token)).filter((index) => index >= 0)) - 120);
      chunkMatches.set(chunk.parentId, { score, page: chunk.page, excerpt: `${first ? "… " : ""}${clean(chunk.text).slice(first, first + 620)}` });
    }
  }
  const matching = hub.items.filter((item) => {
    if (query.domain && query.domain !== "all" && item.domain !== query.domain) return false;
    if (query.subtype && item.subtype !== query.subtype) return false;
    if (query.status && item.evidenceStatus !== query.status) return false;
    if (!needle) return true;
    const body = clean([item.title, item.citation, item.summary, item.subtype, item.tags.join(" "), item.effectiveFrom, Object.values(item.metadata || {}).join(" ")].join(" ")).toLowerCase();
    const hits = queryTokens.filter((token) => body.includes(token)).length;
    return body.includes(needle) || (queryTokens.length > 0 && hits >= Math.max(1, Math.ceil(queryTokens.length * 0.6))) || chunkMatches.has(item.id);
  }).map((item) => {
    const match = chunkMatches.get(item.id);
    return match ? { ...item, summary: match.excerpt, locator: { ...item.locator, page: match.page }, metadata: { ...(item.metadata || {}), matchedManualPage: match.page, matchedManualTerms: match.score } } : item;
  });
  const projectedDomains = new Set<KnowledgeDomain>(["treaty", "guides", "forms", "rates"]);
  const domainPriority: Record<KnowledgeDomain, number> = { rates: 0, treaty: 1, forms: 2, guides: 3, manual: 4, changes: 5, glossary: 6 };
  const deduplicated = new Map<string, KnowledgeItem>();
  for (const item of [...matching].sort((left, right) => domainPriority[left.domain] - domainPriority[right.domain])) {
    const key = projectedDomains.has(item.domain) ? item.id.slice(item.domain.length + 1) : item.id;
    if (!deduplicated.has(key)) deduplicated.set(key, item);
  }
  const filtered = query.domain && query.domain !== "all" ? matching : [...deduplicated.values()];
  const relevance = (item: KnowledgeItem) => {
    if (!needle) return 0;
    const title = clean(item.title).toLowerCase();
    const citation = clean(item.citation).toLowerCase();
    const summary = clean(item.summary).toLowerCase();
    const metadata = clean([item.effectiveFrom, Object.values(item.metadata || {}).join(" ")].join(" ")).toLowerCase();
    let score = 0;
    if (item.evidenceStatus === "verified") score += 250;
    else if (item.evidenceStatus === "review_required") score -= 75;
    if (title === needle) score += 2_000;
    else if (title.startsWith(needle)) score += 900;
    else if (title.includes(needle)) score += 600;
    if (citation === needle) score += 1_200;
    else if (citation.includes(needle)) score += 350;
    const titleHits = queryTokens.filter((token) => title.includes(token)).length;
    score += titleHits * 120;
    if (queryTokens.length && titleHits === queryTokens.length) score += 800;
    score += queryTokens.filter((token) => citation.includes(token)).length * 45;
    score += queryTokens.filter((token) => summary.includes(token)).length * 15;
    score += queryTokens.filter((token) => metadata.includes(token)).length * 12;
    if (item.domain === "rates" && item.subtype === "Kurs mingguan" && queryTokens.includes(String(item.metadata?.currency || "").toLowerCase())) score += 1_500;
    score += Number(item.metadata?.matchedManualTerms || 0) * 60;
    return score;
  };
  filtered.sort((left, right) => {
    const evidence = { verified: 0, reference_only: 1, review_required: 2 } as const;
    return relevance(right) - relevance(left)
      || evidence[left.evidenceStatus] - evidence[right.evidenceStatus]
      || String(right.effectiveFrom || "").localeCompare(String(left.effectiveFrom || ""))
      || left.title.localeCompare(right.title);
  });
  const offset = Math.max(0, Math.floor(Number(query.offset) || 0));
  const limit = Math.min(100, Math.max(1, Math.floor(Number(query.limit) || 20)));
  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
    hasMore: offset + limit < filtered.length,
    facets: {
      domains: facet(matching, (item) => item.domain),
      subtypes: facet(matching, (item) => item.subtype),
      statuses: facet(matching, (item) => item.evidenceStatus)
    }
  };
}
