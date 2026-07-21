import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from "docx";
import { tpDocumentKinds, tpExtractionScopes, tpGenerationReadiness, type TpLocalFileProject } from "./tp-local-file";

const NAVY = "00153F";
const BLUE = "00A7E1";
const GREEN = "43A62A";
const LIGHT = "EEF3F6";
const PALE_BLUE = "EAF7FC";
const PALE_GREEN = "EDF7EC";
const GREY = "66727E";
const TEXT = "243141";
const BORDER = "D7E2E8";

type Language = "id" | "en";

function clean(value: unknown) {
  return String(value ?? "").replace(/\\n/g, "\n").trim();
}

function display(value: unknown, language: Language) {
  return clean(value) || (language === "en" ? "Not available in the source documents" : "Belum tersedia dalam dokumen sumber");
}

function textCell(text: unknown, options: { bold?: boolean; shade?: string; color?: string; size?: number } = {}) {
  return new TableCell({
    shading: options.shade ? { type: ShadingType.CLEAR, fill: options.shade } : undefined,
    margins: { top: 100, bottom: 100, left: 130, right: 130 },
    children: [new Paragraph({
      spacing: { after: 0 },
      children: [new TextRun({
        text: clean(text),
        bold: options.bold,
        color: options.color || TEXT,
        size: options.size || 18
      })]
    })]
  });
}

function keyValueTable(rows: Array<[string, unknown]>, language: Language) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(([label, entry]) => new TableRow({
      children: [
        textCell(label, { bold: true, shade: LIGHT, color: NAVY }),
        textCell(display(entry, language))
      ]
    }))
  });
}

function dataTable(headers: string[], rows: string[][], language: Language) {
  const normalized = rows.length ? rows : [[language === "en" ? "No data extracted" : "Belum ada data terekstraksi", ...headers.slice(1).map(() => "-")]];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((header) => textCell(header, { bold: true, shade: NAVY, color: "FFFFFF", size: 17 })) }),
      ...normalized.map((row, rowIndex) => new TableRow({
        children: headers.map((_, index) => textCell(display(row[index], language), { shade: rowIndex % 2 ? "F8FAFB" : "FFFFFF", size: 17 }))
      }))
    ]
  });
}

function heading(text: string, level: typeof HeadingLevel.HEADING_1 | typeof HeadingLevel.HEADING_2, pageBreakBefore = false) {
  return new Paragraph({
    heading: level,
    pageBreakBefore,
    spacing: { before: level === HeadingLevel.HEADING_1 ? 260 : 200, after: 110 },
    border: level === HeadingLevel.HEADING_1 ? { bottom: { color: BLUE, style: BorderStyle.SINGLE, size: 9 } } : undefined,
    children: [new TextRun({ text, color: level === HeadingLevel.HEADING_1 ? NAVY : BLUE })]
  });
}

function paragraphs(value: unknown, language: Language) {
  const source = display(value, language);
  return source.split(/\n{2,}/).filter(Boolean).map((text) => new Paragraph({
    spacing: { after: 130, line: 290 },
    children: [new TextRun({ text, color: TEXT, size: 19 })]
  }));
}

function bullets(items: string[], language: Language) {
  const source = items.filter((item) => clean(item));
  const normalized = source.length ? source : [language === "en" ? "No item identified from the available source documents." : "Belum ada item yang teridentifikasi dari dokumen sumber."];
  return normalized.map((item) => new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 75, line: 270 },
    children: [new TextRun({ text: clean(item), size: 19, color: TEXT })]
  }));
}

function callout(title: string, message: string, tone: "blue" | "green" = "blue") {
  const fill = tone === "green" ? PALE_GREEN : PALE_BLUE;
  const accent = tone === "green" ? GREEN : BLUE;
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: [new TableCell({
      shading: { type: ShadingType.CLEAR, fill },
      borders: { left: { color: accent, style: BorderStyle.SINGLE, size: 22 } },
      margins: { top: 150, bottom: 150, left: 180, right: 180 },
      children: [
        new Paragraph({ spacing: { after: 45 }, children: [new TextRun({ text: title, bold: true, color: NAVY, size: 20 })] }),
        new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: message, color: TEXT, size: 18 })] })
      ]
    })] })]
  });
}

function financialRows(project: TpLocalFileProject, language: Language) {
  const current = project.state.financialData;
  const prior = project.state.financialDataPrior;
  const labels: Array<[keyof typeof current, string, string]> = [
    ["revenue", "Pendapatan", "Revenue"],
    ["costOfGoodsSold", "Harga pokok penjualan", "Cost of goods sold"],
    ["grossProfit", "Laba kotor", "Gross profit"],
    ["operatingExpenses", "Beban usaha", "Operating expenses"],
    ["operatingProfit", "Laba usaha", "Operating profit"],
    ["netIncome", "Laba bersih", "Net income"]
  ];
  return labels.map(([key, id, en]) => [language === "en" ? en : id, current[key], prior[key]]);
}

export async function buildTpLocalFileDocx(project: TpLocalFileProject, language: Language) {
  const s = project.state;
  const en = language === "en";
  const readiness = tpGenerationReadiness(s);
  const title = en ? "TRANSFER PRICING LOCAL FILE" : "DOKUMEN LOKAL TRANSFER PRICING";
  const disclaimer = en
    ? "Advisor working draft generated from uploaded source documents. Facts, calculations, legal references, comparables, and conclusions require professional review before filing or external use."
    : "Draft kerja advisor yang disusun dari dokumen sumber yang diunggah. Fakta, perhitungan, dasar hukum, pembanding, dan kesimpulan wajib direview profesional sebelum pelaporan atau penggunaan eksternal.";
  const statusLabel = readiness.blockers.length
    ? `${readiness.blockers.length} ${en ? "final review item(s) remain" : "item review final masih terbuka"}`
    : (en ? "Ready for final professional review" : "Siap untuk review profesional final");

  const contents = [
    en ? "1. Executive summary and review status" : "1. Ringkasan eksekutif dan status review",
    en ? "2. Regulatory and documentation framework" : "2. Kerangka regulasi dan dokumentasi",
    en ? "3. Company, group, and business profile" : "3. Profil perusahaan, grup, dan usaha",
    en ? "4. Related parties, transactions, and FAR" : "4. Pihak afiliasi, transaksi, dan FAR",
    en ? "5. Method selection and comparability" : "5. Pemilihan metode dan kesebandingan",
    en ? "6. Financial and non-financial information" : "6. Informasi keuangan dan non-keuangan",
    en ? "7. Conclusion and advisor sign-off" : "7. Kesimpulan dan persetujuan advisor",
    en ? "Appendices: source map and unresolved items" : "Lampiran: peta sumber dan item terbuka"
  ];

  const children = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 650, after: 70 }, children: [new TextRun({ text: "ALPHA", bold: true, color: NAVY, size: 30 }), new TextRun({ text: " AI", bold: true, color: BLUE, size: 30 }), new TextRun({ text: " JURIST", bold: true, color: NAVY, size: 30 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 420 }, children: [new TextRun({ text: "Tax Intelligence. Trusted Judgment.", bold: true, color: NAVY, size: 17 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 190 }, children: [new TextRun({ text: title, bold: true, color: NAVY, size: 42 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 95 }, children: [new TextRun({ text: display(s.companyName, language), bold: true, size: 29, color: BLUE })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 420 }, children: [new TextRun({ text: `${en ? "Fiscal year" : "Tahun pajak"}: ${display(s.fiscalYear, language)}`, size: 22, color: GREY })] }),
    callout(en ? "DOCUMENT STATUS" : "STATUS DOKUMEN", statusLabel, readiness.blockers.length ? "blue" : "green"),
    new Paragraph({ spacing: { before: 380, after: 110 }, children: [new TextRun({ text: disclaimer, italics: true, color: GREY, size: 17 })] }),
    new Paragraph({ children: [new PageBreak()] }),

    heading(en ? "Document Control" : "Kontrol Dokumen", HeadingLevel.HEADING_1),
    keyValueTable([
      [en ? "Project" : "Proyek", project.name],
      [en ? "Entity" : "Entitas", s.companyName],
      [en ? "Fiscal year" : "Tahun pajak", s.fiscalYear],
      [en ? "Document status" : "Status dokumen", project.status],
      [en ? "Source documents" : "Dokumen sumber", project.documents.length],
      [en ? "Generated" : "Dibuat", new Date().toLocaleDateString(en ? "en-GB" : "id-ID")]
    ], language),
    heading(en ? "Document Guide" : "Panduan Dokumen", HeadingLevel.HEADING_2),
    ...bullets(contents, language),

    heading(en ? "1. Executive Summary and Review Status" : "1. Ringkasan Eksekutif dan Status Review", HeadingLevel.HEADING_1, true),
    ...paragraphs(s.analysis.executiveSummary, language),
    heading(en ? "Key analysis parameters" : "Parameter utama analisis", HeadingLevel.HEADING_2),
    keyValueTable([
      [en ? "Controlled transaction" : "Transaksi afiliasi", s.transactionType || s.transactionDetails],
      [en ? "Selected method" : "Metode terpilih", s.selectedMethod],
      [en ? "Profit level indicator" : "Indikator tingkat laba", s.selectedPli],
      [en ? "Tested party" : "Pihak yang diuji", s.testedParty],
      [en ? "Analysis period" : "Periode analisis", s.analysisPeriod],
      [en ? "Arm's-length range" : "Rentang kewajaran", `Q1 ${display(s.quartileRange.q1, language)} | Median ${display(s.quartileRange.median, language)} | Q3 ${display(s.quartileRange.q3, language)}`],
      [en ? "Tested-party result" : "Hasil pihak yang diuji", s.testedPartyRatio]
    ], language),
    heading(en ? "Generation readiness" : "Kesiapan generasi", HeadingLevel.HEADING_2),
    dataTable(
      [en ? "Content group" : "Kelompok konten", en ? "Complete" : "Lengkap", en ? "Total" : "Total"],
      readiness.summary.map((item) => [item.category, String(item.ready), String(item.total)]),
      language
    ),

    heading(en ? "2. Regulatory and Documentation Framework" : "2. Kerangka Regulasi dan Dokumentasi", HeadingLevel.HEADING_1, true),
    ...paragraphs(en
      ? "This chapter records only the legal references supplied to the advisor analysis. Applicability, effective dates, amendments, and the relevant fiscal period must be validated before external use."
      : "Bab ini hanya mencatat referensi hukum yang tersedia dalam analisis advisor. Keberlakuan, tanggal efektif, perubahan, dan kesesuaian dengan tahun pajak wajib divalidasi sebelum penggunaan eksternal.", language),
    heading(en ? "Regulatory references used" : "Referensi peraturan yang digunakan", HeadingLevel.HEADING_2),
    ...bullets(s.analysis.regulatoryReferences, language),
    heading(en ? "Documentation scope" : "Ruang lingkup dokumentasi", HeadingLevel.HEADING_2),
    ...paragraphs(s.analysis.businessCharacterization, language),

    heading(en ? "3. Company, Group, and Business Profile" : "3. Profil Perusahaan, Grup, dan Usaha", HeadingLevel.HEADING_1, true),
    keyValueTable([
      [en ? "Legal name" : "Nama legal", s.companyName],
      [en ? "Short name" : "Nama singkat", s.companyShortName],
      ["NPWP", s.npwp],
      [en ? "Address" : "Alamat", s.companyAddress],
      [en ? "Establishment" : "Pendirian", s.establishmentInfo],
      [en ? "Parent company" : "Entitas induk", s.parentCompany],
      [en ? "Group" : "Grup", s.parentGroup],
      [en ? "Brand" : "Merek", s.brandName],
      [en ? "Employees" : "Jumlah pegawai", s.employeeCount]
    ], language),
    heading(en ? "Ownership" : "Kepemilikan", HeadingLevel.HEADING_2),
    dataTable([en ? "Shareholder" : "Pemegang saham", en ? "Shares" : "Saham", en ? "Capital" : "Modal", "%"], s.shareholders.map((item) => [item.name, item.shares, item.capital, item.percentage]), language),
    heading(en ? "Management" : "Manajemen", HeadingLevel.HEADING_2),
    dataTable([en ? "Position" : "Jabatan", en ? "Name" : "Nama"], s.management.map((item) => [item.position, item.name]), language),
    heading(en ? "Organization" : "Organisasi", HeadingLevel.HEADING_2),
    ...paragraphs(s.organizationStructure, language),
    dataTable([en ? "Department" : "Departemen", en ? "Head" : "Pimpinan", en ? "Employees" : "Pegawai"], s.organizationDepartments.map((item) => [item.name, item.head, item.employees]), language),
    heading(en ? "Business activities, products, and strategy" : "Kegiatan usaha, produk, dan strategi", HeadingLevel.HEADING_2),
    ...paragraphs(s.businessActivities, language),
    dataTable([en ? "Product / service" : "Produk / jasa", en ? "Description" : "Deskripsi"], s.products.map((item) => [item.name, item.description]), language),
    ...paragraphs(s.businessStrategy, language),
    ...paragraphs(s.businessRestructuring, language),
    heading(en ? "Industry analysis" : "Analisis industri", HeadingLevel.HEADING_2),
    ...paragraphs(s.analysis.industryAnalysis, language),
    ...(s.analysis.externalResearchSummary ? [
      heading(en ? "External research synthesis" : "Sintesis riset eksternal", HeadingLevel.HEADING_2),
      ...paragraphs(s.analysis.externalResearchSummary, language)
    ] : []),

    heading(en ? "4. Related Parties, Transactions, and FAR" : "4. Pihak Afiliasi, Transaksi, dan FAR", HeadingLevel.HEADING_1, true),
    dataTable([en ? "Related party" : "Pihak afiliasi", en ? "Country" : "Negara", en ? "Relationship" : "Hubungan", en ? "Transaction" : "Transaksi"], s.affiliatedParties.map((item) => [item.name, item.country, item.relationship, item.transactionType]), language),
    heading(en ? "Transaction background and commercial rationale" : "Latar belakang dan rasional komersial transaksi", HeadingLevel.HEADING_2),
    ...paragraphs(s.backgroundTransaction || s.transactionDetails, language),
    heading(en ? "Controlled transactions" : "Transaksi afiliasi", HeadingLevel.HEADING_2),
    dataTable([en ? "Counterparty" : "Lawan transaksi", en ? "Country" : "Negara", en ? "Type" : "Jenis", en ? "Value" : "Nilai", en ? "Notes" : "Catatan"], s.affiliatedTransactions.map((item) => [item.counterparty, item.country, item.transactionType, `${item.currency} ${item.value}`, item.note]), language),
    heading(en ? "Independent transactions" : "Transaksi independen", HeadingLevel.HEADING_2),
    dataTable([en ? "Counterparty" : "Lawan transaksi", en ? "Country" : "Negara", en ? "Type" : "Jenis", en ? "Value" : "Nilai"], s.independentTransactions.map((item) => [item.counterparty, item.country, item.transactionType, `${item.currency} ${item.value}`]), language),
    heading(en ? "Pricing policy and supply chain" : "Kebijakan harga dan rantai pasok", HeadingLevel.HEADING_2),
    ...paragraphs(s.pricingPolicy, language),
    ...paragraphs(s.supplyChainManagement, language),
    heading(en ? "Functional, asset, and risk analysis" : "Analisis fungsi, aset, dan risiko", HeadingLevel.HEADING_2),
    ...paragraphs(s.analysis.functionalAnalysis, language),

    heading(en ? "5. Method Selection and Comparability" : "5. Pemilihan Metode dan Kesebandingan", HeadingLevel.HEADING_1, true),
    heading(en ? "Method and PLI rationale" : "Rasional metode dan PLI", HeadingLevel.HEADING_2),
    ...paragraphs(s.analysis.methodSelectionJustification, language),
    ...paragraphs(s.analysis.pliSelectionRationale, language),
    heading(en ? "Comparable search trail" : "Jejak pencarian pembanding", HeadingLevel.HEADING_2),
    dataTable([en ? "Step" : "Tahap", en ? "Criterion" : "Kriteria", en ? "Results" : "Hasil"], s.searchCriteriaResults.map((item) => [item.step, item.criteria, item.resultCount]), language),
    heading(en ? "Acceptance / rejection matrix" : "Matriks penerimaan / penolakan", HeadingLevel.HEADING_2),
    dataTable([en ? "Candidate" : "Kandidat", en ? "Decision" : "Keputusan", en ? "Reason" : "Alasan"], s.rejectionMatrix.map((item) => [item.name, item.accepted ? (en ? "Accepted" : "Diterima") : (en ? "Rejected" : "Ditolak"), item.reason]), language),
    heading(en ? "Accepted comparable companies" : "Perusahaan pembanding yang diterima", HeadingLevel.HEADING_2),
    dataTable([en ? "Company" : "Perusahaan", en ? "Country" : "Negara", en ? "Business description" : "Deskripsi usaha", en ? "Ratio" : "Rasio"], s.comparableCompanies.map((item) => [item.name, item.country, item.description, item.ratio]), language),
    heading(en ? "Preliminary external comparable candidates" : "Kandidat pembanding eksternal awal", HeadingLevel.HEADING_2),
    callout(
      en ? "SCREENING LIMITATION" : "BATASAN SCREENING",
      en
        ? "Web research is discovery evidence only. These candidates are not accepted comparables until independence, ownership, business activity, financial period, persistent losses, data availability, and commercial-database criteria have been screened and documented."
        : "Riset web hanya merupakan bukti discovery. Kandidat ini belum menjadi pembanding yang diterima sebelum independensi, kepemilikan, kegiatan usaha, periode keuangan, kerugian berulang, ketersediaan data, dan kriteria database komersial selesai diperiksa dan didokumentasikan."
    ),
    dataTable(
      [en ? "Candidate" : "Kandidat", en ? "Country" : "Negara", en ? "Potential fit" : "Potensi kecocokan", en ? "Material differences / limitation" : "Perbedaan / batasan material", en ? "Status" : "Status", en ? "Source" : "Sumber"],
      s.analysis.externalComparableCandidates.map((item) => [item.name, item.country, item.matchRationale, [...item.keyDifferences, item.limitation].filter(Boolean).join("; "), `${item.screeningStatus}; ${item.sourceQuality}`, item.sourceUrl]),
      language
    ),
    heading(en ? "Comparability conclusion" : "Kesimpulan kesebandingan", HeadingLevel.HEADING_2),
    ...paragraphs(s.analysis.comparabilityAnalysis || s.comparabilityFactors, language),

    heading(en ? "6. Financial and Non-financial Information" : "6. Informasi Keuangan dan Non-keuangan", HeadingLevel.HEADING_1, true),
    dataTable([en ? "Financial item" : "Pos keuangan", en ? "Current year" : "Tahun berjalan", en ? "Prior year" : "Tahun sebelumnya"], financialRows(project, language), language),
    heading(en ? "Non-financial events" : "Peristiwa non-keuangan", HeadingLevel.HEADING_2),
    ...paragraphs(s.nonFinancialEvents, language),

    heading(en ? "7. Conclusion and Advisor Sign-off" : "7. Kesimpulan dan Persetujuan Advisor", HeadingLevel.HEADING_1, true),
    ...paragraphs(s.analysis.conclusion, language),
    heading(en ? "Risk flags" : "Faktor risiko", HeadingLevel.HEADING_2),
    ...bullets(s.analysis.riskFlags, language),
    heading(en ? "Evidence still required" : "Bukti yang masih diperlukan", HeadingLevel.HEADING_2),
    ...bullets(s.analysis.requiredEvidence, language),
    heading(en ? "Assumptions requiring confirmation" : "Asumsi yang perlu dikonfirmasi", HeadingLevel.HEADING_2),
    ...bullets(s.analysis.assumptions, language),
    heading(en ? "Likely counterarguments" : "Counterargument yang mungkin", HeadingLevel.HEADING_2),
    ...bullets(s.analysis.counterarguments, language),
    heading(en ? "Sequenced advisor action plan" : "Rencana tindakan advisor berurutan", HeadingLevel.HEADING_2),
    ...bullets(s.analysis.actionPlan, language),
    new Paragraph({ spacing: { before: 360, after: 90 }, children: [new TextRun({ text: en ? "Prepared by:" : "Disusun oleh:", bold: true, color: NAVY, size: 19 })] }),
    new Paragraph({ spacing: { after: 260 }, children: [new TextRun({ text: "____________________________________", color: GREY, size: 19 })] }),
    new Paragraph({ spacing: { after: 90 }, children: [new TextRun({ text: en ? "Reviewed and approved by:" : "Direview dan disetujui oleh:", bold: true, color: NAVY, size: 19 })] }),
    new Paragraph({ spacing: { after: 260 }, children: [new TextRun({ text: "____________________________________", color: GREY, size: 19 })] }),

    heading(en ? "Appendix A. Source Map" : "Lampiran A. Peta Sumber", HeadingLevel.HEADING_1, true),
    dataTable(
      [en ? "File" : "File", en ? "Category" : "Kategori", en ? "Detected content" : "Konten terdeteksi", en ? "Status / extraction note" : "Status / catatan ekstraksi"],
      project.documents.map((item) => {
        const kind = tpDocumentKinds.find((entry) => entry.id === item.kind);
        const scopes = (item.detectedScopes || []).map((scope) => {
          const definition = tpExtractionScopes.find((entry) => entry.id === scope);
          return en ? definition?.en : definition?.idLabel;
        }).filter(Boolean).join(", ");
        return [item.filename, en ? (kind?.en || item.kind) : (kind?.idLabel || item.kind), scopes, `${item.status}: ${item.extractionMessage}`];
      }),
      language
    ),
    heading(en ? "Appendix B. Unresolved Final-review Items" : "Lampiran B. Item Review Final yang Belum Selesai", HeadingLevel.HEADING_1, true),
    dataTable(
      [en ? "Section" : "Bagian", en ? "Required item" : "Item wajib", en ? "Status" : "Status", en ? "Typical source / action" : "Sumber / tindakan"],
      readiness.blockers.map((item) => [item.section, en ? item.en : item.idLabel, item.status, item.expectedSources.join(", ") || (en ? "Advisor confirmation" : "Konfirmasi advisor")]),
      language
    ),
    heading(en ? "Appendix C. External Research Audit Trail" : "Lampiran C. Audit Trail Riset Eksternal", HeadingLevel.HEADING_1, true),
    callout(
      en ? "RESEARCH STATUS" : "STATUS RISET",
      `${s.analysis.externalResearchStatus} · ${s.analysis.externalResearchSources.length} ${en ? "source(s) retained" : "sumber tersimpan"}`,
      s.analysis.externalResearchStatus === "completed" ? "green" : "blue"
    ),
    ...(s.analysis.externalResearchWarnings.length ? [
      heading(en ? "Research Limitations" : "Keterbatasan Riset", HeadingLevel.HEADING_2),
      ...bullets(s.analysis.externalResearchWarnings, language)
    ] : []),
    dataTable(
      [en ? "Type" : "Jenis", en ? "Source" : "Sumber", en ? "Quality" : "Kualitas", en ? "Retrieval score" : "Skor retrieval", "URL"],
      s.analysis.externalResearchSources.map((item) => [item.sourceType, item.title, item.qualityTier, `${Math.round(item.score * 100)}%`, item.url]),
      language
    )
  ];

  const document = new Document({
    styles: {
      default: { document: { run: { font: "Plus Jakarta Sans", size: 19, color: TEXT }, paragraph: { spacing: { line: 285 } } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { bold: true, size: 28, color: NAVY }, paragraph: { spacing: { before: 280, after: 130 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { bold: true, size: 22, color: BLUE }, paragraph: { spacing: { before: 190, after: 90 }, outlineLevel: 1 } }
      ]
    },
    sections: [{
      properties: { page: { margin: { top: 760, right: 720, bottom: 760, left: 720 } } },
      headers: { default: new Header({ children: [new Paragraph({ border: { bottom: { color: BLUE, style: BorderStyle.SINGLE, size: 9 } }, spacing: { after: 40 }, children: [new TextRun({ text: "ALPHA", bold: true, color: NAVY, size: 16 }), new TextRun({ text: " AI", bold: true, color: BLUE, size: 16 }), new TextRun({ text: " JURIST  |  Tax Intelligence. Trusted Judgment.", bold: true, color: NAVY, size: 16 })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, border: { top: { color: BORDER, style: BorderStyle.SINGLE, size: 5 } }, children: [new TextRun({ text: en ? "Confidential advisor working draft  |  " : "Draft kerja advisor rahasia  |  ", color: GREY, size: 15 }), new TextRun({ children: [PageNumber.CURRENT], color: GREY, size: 15 })] })] }) },
      children
    }]
  });
  return Packer.toBuffer(document);
}
