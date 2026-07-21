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
import type { TpLocalFileProject } from "./tp-local-file";

const NAVY = "00153F";
const BLUE = "00A7E1";
const GREEN = "43A62A";
const LIGHT = "EEF3F6";
const GREY = "5E6A75";

function value(value: unknown) {
  const text = String(value ?? "").trim();
  return text || "Not available in source documents";
}

function cell(text: string, bold = false, shade = "FFFFFF") {
  return new TableCell({
    shading: { type: ShadingType.CLEAR, fill: shade },
    margins: { top: 100, bottom: 100, left: 130, right: 130 },
    children: [new Paragraph({ children: [new TextRun({ text, bold, color: bold ? NAVY : "26313C", size: 19 })] })]
  });
}

function keyValueTable(rows: Array<[string, unknown]>) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(([label, entry]) => new TableRow({ children: [cell(label, true, LIGHT), cell(value(entry))] }))
  });
}

function dataTable(headers: string[], rows: string[][]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: headers.map((header) => cell(header, true, NAVY)) }),
      ...(rows.length ? rows : [["No data extracted", ...headers.slice(1).map(() => "-")]]).map((row) =>
        new TableRow({ children: headers.map((_, index) => cell(value(row[index]))) })
      )
    ]
  });
}

function heading(text: string, level: typeof HeadingLevel.HEADING_1 | typeof HeadingLevel.HEADING_2) {
  return new Paragraph({ heading: level, spacing: { before: level === HeadingLevel.HEADING_1 ? 320 : 220, after: 120 }, children: [new TextRun({ text, color: NAVY })] });
}

function body(text: unknown) {
  return new Paragraph({ spacing: { after: 150, line: 300 }, children: [new TextRun({ text: value(text), color: "26313C", size: 21 })] });
}

function bullets(items: string[]) {
  return (items.length ? items : ["No item identified from the available source documents."]).map((item) =>
    new Paragraph({ bullet: { level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: item, size: 21 })] })
  );
}

export async function buildTpLocalFileDocx(project: TpLocalFileProject, language: "id" | "en") {
  const s = project.state;
  const en = language === "en";
  const title = en ? "TRANSFER PRICING LOCAL FILE" : "DOKUMEN LOKAL TRANSFER PRICING";
  const disclaimer = en
    ? "Advisor working draft generated from uploaded source documents. All facts, calculations, legal references, and conclusions require professional review before use."
    : "Draft kerja advisor yang disusun dari dokumen sumber yang diunggah. Seluruh fakta, perhitungan, dasar hukum, dan kesimpulan wajib direview profesional sebelum digunakan.";
  const children = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 900, after: 260 }, children: [new TextRun({ text: "Alpha AI Jurist", bold: true, color: NAVY, size: 46 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 220 }, children: [new TextRun({ text: title, bold: true, color: BLUE, size: 36 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: value(s.companyName), bold: true, size: 30, color: NAVY })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 500 }, children: [new TextRun({ text: `${en ? "Fiscal year" : "Tahun pajak"}: ${value(s.fiscalYear)}`, size: 24, color: GREY })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 800 }, children: [new TextRun({ text: disclaimer, italics: true, color: GREY, size: 18 })] }),
    new Paragraph({ children: [new PageBreak()] }),

    heading(en ? "1. Executive Summary" : "1. Ringkasan Eksekutif", HeadingLevel.HEADING_1),
    body(s.analysis.executiveSummary),
    heading(en ? "Project profile" : "Profil proyek", HeadingLevel.HEADING_2),
    keyValueTable([
      [en ? "Project" : "Proyek", project.name],
      [en ? "Company" : "Perusahaan", s.companyName],
      ["NPWP", s.npwp],
      [en ? "Fiscal year" : "Tahun pajak", s.fiscalYear],
      [en ? "Analysis period" : "Periode analisis", s.analysisPeriod],
      [en ? "Selected method" : "Metode terpilih", s.selectedMethod],
      [en ? "Selected PLI" : "PLI terpilih", s.selectedPli],
      [en ? "Tested party" : "Pihak yang diuji", s.testedParty]
    ]),

    heading(en ? "2. Company and Group Overview" : "2. Gambaran Perusahaan dan Grup", HeadingLevel.HEADING_1),
    keyValueTable([
      [en ? "Legal name" : "Nama legal", s.companyName],
      [en ? "Short name" : "Nama singkat", s.companyShortName],
      [en ? "Address" : "Alamat", s.companyAddress],
      [en ? "Establishment" : "Pendirian", s.establishmentInfo],
      [en ? "Parent company" : "Entitas induk", s.parentCompany],
      [en ? "Group" : "Grup", s.parentGroup],
      [en ? "Brand" : "Merek", s.brandName],
      [en ? "Employees" : "Jumlah pegawai", s.employeeCount]
    ]),
    heading(en ? "Ownership" : "Kepemilikan", HeadingLevel.HEADING_2),
    dataTable(
      [en ? "Shareholder" : "Pemegang saham", en ? "Shares" : "Saham", en ? "Capital" : "Modal", "%"],
      s.shareholders.map((item) => [item.name, item.shares, item.capital, item.percentage])
    ),
    heading(en ? "Management" : "Manajemen", HeadingLevel.HEADING_2),
    dataTable([en ? "Position" : "Jabatan", en ? "Name" : "Nama"], s.management.map((item) => [item.position, item.name])),

    heading(en ? "3. Business Activities and Environment" : "3. Kegiatan Usaha dan Lingkungan Bisnis", HeadingLevel.HEADING_1),
    heading(en ? "Business activities" : "Kegiatan usaha", HeadingLevel.HEADING_2),
    body(s.businessActivities),
    heading(en ? "Products and services" : "Produk dan jasa", HeadingLevel.HEADING_2),
    dataTable([en ? "Product/service" : "Produk/jasa", en ? "Description" : "Deskripsi"], s.products.map((item) => [item.name, item.description])),
    heading(en ? "Strategy and restructuring" : "Strategi dan restrukturisasi", HeadingLevel.HEADING_2),
    body(s.businessStrategy),
    body(s.businessRestructuring),
    heading(en ? "Industry analysis" : "Analisis industri", HeadingLevel.HEADING_2),
    body(s.analysis.industryAnalysis),

    heading(en ? "4. Related Parties and Controlled Transactions" : "4. Pihak Afiliasi dan Transaksi Terkendali", HeadingLevel.HEADING_1),
    dataTable(
      [en ? "Related party" : "Pihak afiliasi", en ? "Country" : "Negara", en ? "Relationship" : "Hubungan", en ? "Transaction" : "Transaksi"],
      s.affiliatedParties.map((item) => [item.name, item.country, item.relationship, item.transactionType])
    ),
    heading(en ? "Controlled transactions" : "Transaksi afiliasi", HeadingLevel.HEADING_2),
    dataTable(
      [en ? "Counterparty" : "Lawan transaksi", en ? "Country" : "Negara", en ? "Type" : "Jenis", en ? "Value" : "Nilai", en ? "Notes" : "Catatan"],
      s.affiliatedTransactions.map((item) => [item.counterparty, item.country, item.transactionType, `${item.currency} ${item.value}`, item.note])
    ),
    heading(en ? "Pricing policy" : "Kebijakan harga", HeadingLevel.HEADING_2),
    body(s.pricingPolicy),
    heading(en ? "Transaction background" : "Latar belakang transaksi", HeadingLevel.HEADING_2),
    body(s.transactionDetails),

    heading(en ? "5. Functional Analysis" : "5. Analisis Fungsi, Aset, dan Risiko", HeadingLevel.HEADING_1),
    body(s.analysis.functionalAnalysis),
    heading(en ? "Business characterization" : "Karakterisasi usaha", HeadingLevel.HEADING_2),
    body(s.analysis.businessCharacterization),
    heading(en ? "Organization structure" : "Struktur organisasi", HeadingLevel.HEADING_2),
    body(s.organizationStructure),

    heading(en ? "6. Financial Information" : "6. Informasi Keuangan", HeadingLevel.HEADING_1),
    keyValueTable([
      [en ? "Revenue" : "Pendapatan", s.financialData.revenue],
      [en ? "Cost of goods sold" : "Harga pokok penjualan", s.financialData.costOfGoodsSold],
      [en ? "Gross profit" : "Laba kotor", s.financialData.grossProfit],
      [en ? "Operating expenses" : "Beban usaha", s.financialData.operatingExpenses],
      [en ? "Operating profit" : "Laba usaha", s.financialData.operatingProfit],
      [en ? "Net income" : "Laba bersih", s.financialData.netIncome]
    ]),
    heading(en ? "Non-financial events" : "Kejadian non-keuangan", HeadingLevel.HEADING_2),
    body(s.nonFinancialEvents),

    heading(en ? "7. Transfer Pricing Method and Comparability" : "7. Metode Transfer Pricing dan Kesebandingan", HeadingLevel.HEADING_1),
    heading(en ? "Method selection" : "Pemilihan metode", HeadingLevel.HEADING_2),
    body(s.analysis.methodSelectionJustification),
    heading(en ? "PLI selection" : "Pemilihan PLI", HeadingLevel.HEADING_2),
    body(s.analysis.pliSelectionRationale),
    keyValueTable([
      [en ? "Method" : "Metode", s.selectedMethod],
      ["PLI", s.selectedPli],
      [en ? "Tested party" : "Pihak yang diuji", s.testedParty],
      ["Q1", s.quartileRange.q1],
      [en ? "Median" : "Median", s.quartileRange.median],
      ["Q3", s.quartileRange.q3],
      [en ? "Tested-party ratio" : "Rasio pihak diuji", s.testedPartyRatio]
    ]),
    heading(en ? "Comparable companies" : "Perusahaan pembanding", HeadingLevel.HEADING_2),
    dataTable([en ? "Company" : "Perusahaan", en ? "Country" : "Negara", en ? "Description" : "Deskripsi", en ? "Ratio" : "Rasio"], s.comparableCompanies.map((item) => [item.name, item.country, item.description, item.ratio])),
    heading(en ? "Comparability analysis" : "Analisis kesebandingan", HeadingLevel.HEADING_2),
    body(s.analysis.comparabilityAnalysis || s.comparabilityFactors),

    heading(en ? "8. Conclusion and Advisor Review" : "8. Kesimpulan dan Review Advisor", HeadingLevel.HEADING_1),
    body(s.analysis.conclusion),
    heading(en ? "Risk flags" : "Faktor risiko", HeadingLevel.HEADING_2),
    ...bullets(s.analysis.riskFlags),
    heading(en ? "Evidence still required" : "Bukti yang masih diperlukan", HeadingLevel.HEADING_2),
    ...bullets(s.analysis.requiredEvidence),
    heading(en ? "Regulatory references" : "Referensi peraturan", HeadingLevel.HEADING_2),
    ...bullets(s.analysis.regulatoryReferences),

    heading(en ? "Appendix A. Source Documents" : "Lampiran A. Dokumen Sumber", HeadingLevel.HEADING_1),
    dataTable(
      [en ? "File" : "File", en ? "Category" : "Kategori", en ? "Status" : "Status", en ? "Extraction note" : "Catatan ekstraksi"],
      project.documents.map((item) => [item.filename, item.kind, item.status, item.extractionMessage])
    )
  ];

  const document = new Document({
    styles: {
      default: { document: { run: { font: "Plus Jakarta Sans", size: 21, color: "26313C" } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { bold: true, size: 30, color: NAVY }, paragraph: { spacing: { before: 320, after: 140 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { bold: true, size: 24, color: BLUE }, paragraph: { spacing: { before: 220, after: 100 }, outlineLevel: 1 } }
      ]
    },
    sections: [{
      properties: { page: { margin: { top: 850, right: 850, bottom: 850, left: 850 } } },
      headers: { default: new Header({ children: [new Paragraph({ border: { bottom: { color: BLUE, style: BorderStyle.SINGLE, size: 10 } }, children: [new TextRun({ text: "Alpha AI Jurist | Tax Intelligence. Trusted Judgment.", bold: true, color: NAVY, size: 18 })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Confidential | ", color: GREY, size: 17 }), new TextRun({ children: [PageNumber.CURRENT], color: GREY, size: 17 })] })] }) },
      children
    }]
  });
  return Packer.toBuffer(document);
}
