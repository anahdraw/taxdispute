import {
  AlignmentType,
  BorderStyle,
  Document as DocxDocument,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType
} from "docx";
import { PDFDocument, PageSizes, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { AnalysisResult, AnalyzeInput } from "./analyze";
import type { ExtractionResult } from "./extraction";

export type ReportPayload = {
  input: AnalyzeInput;
  analysis: AnalysisResult;
  extraction?: ExtractionResult | null;
  language: "id" | "en";
};

type LabelValue = [string, string];
type ReportBlock =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullet"; text: string }
  | { type: "table"; headers: string[]; rows: string[][] };

const COLORS = {
  charcoal: "54585A",
  text: "2F3340",
  muted: "667085",
  line: "D8E0E7",
  lightBlue: "EAF7FD",
  lightGreen: "EAF6EB",
  blue: "009CDE",
  green: "43A047",
  grey: "8C949B",
  white: "FFFFFF"
};
const PAGE_TEXT_WIDTH_DXA = 9360;

function isEn(language: "id" | "en") {
  return language === "en";
}

function cleanReportText(text: unknown) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\bChunk\s+\d+\s*:\s*/gi, "\n\n")
    .replace(/\b(?:Section|Bagian|Halaman|Pages?)\s+\d+(?:\s*[-–]\s*\d+)?\s*:\s*/gi, "\n\n")
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function value(text: unknown) {
  const cleaned = cleanReportText(text);
  return cleaned || "-";
}

function cleanMarkdown(text: string) {
  return cleanReportText(text)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#+\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitRecommendation(text: string): ReportBlock[] {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const blocks: ReportBlock[] = [];

  for (let idx = 0; idx < lines.length; idx += 1) {
    const raw = lines[idx].trim();
    if (!raw || raw === "---") continue;

    const next = lines[idx + 1]?.trim() || "";
    const isMarkdownTable =
      raw.includes("|") &&
      next.includes("|") &&
      /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(next);

    if (isMarkdownTable) {
      const tableLines = [raw];
      idx += 2;
      while (idx < lines.length && lines[idx].includes("|")) {
        tableLines.push(lines[idx].trim());
        idx += 1;
      }
      idx -= 1;
      const parsedRows = tableLines.map((line) =>
        line
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((cell) => cleanMarkdown(cell))
      );
      const [headers, ...rows] = parsedRows;
      blocks.push({ type: "table", headers, rows: rows.filter((row) => row.some(Boolean)) });
      continue;
    }

    const headingMatch = raw.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length <= 2 ? 2 : 3,
        text: cleanMarkdown(headingMatch[2])
      });
      continue;
    }

    const numberedHeading = raw.match(/^(\d+)[.)]\s+(.+)$/);
    if (numberedHeading && raw.length < 96) {
      blocks.push({ type: "heading", level: 2, text: cleanMarkdown(`${numberedHeading[1]}. ${numberedHeading[2]}`) });
      continue;
    }

    const subHeading = raw.match(/^([a-zA-Z])\.\s+(.+)$/);
    if (subHeading && raw.length < 96) {
      blocks.push({ type: "heading", level: 3, text: cleanMarkdown(`${subHeading[1]}. ${subHeading[2]}`) });
      continue;
    }

    const bulletMatch = raw.match(/^[-*•]\s+(.+)$/);
    if (bulletMatch) {
      blocks.push({ type: "bullet", text: cleanMarkdown(bulletMatch[1]) });
      continue;
    }

    blocks.push({ type: "paragraph", text: cleanMarkdown(raw) });
  }

  return blocks;
}

function caseRows(payload: ReportPayload): LabelValue[] {
  const { input, extraction, language } = payload;
  const en = isEn(language);
  return [
    [en ? "Taxpayer / company" : "Wajib Pajak / perusahaan", value(extraction?.taxpayerName || input.taxpayerName)],
    [en ? "NPWP" : "NPWP", value(extraction?.taxpayerNpwp)],
    [en ? "Address" : "Alamat", value(extraction?.taxpayerAddress)],
    [en ? "Document file" : "Nama dokumen", value(extraction?.filename)],
    [en ? "Document type" : "Jenis dokumen", value(extraction?.documentType)],
    [en ? "Decision number" : "Nomor putusan", value(extraction?.putusanNumber)],
    [en ? "Decision year" : "Tahun putusan", value(extraction?.putusanYear)],
    [en ? "Tax type" : "Jenis pajak", value(extraction?.taxType || input.taxType)],
    [en ? "Tax period" : "Masa pajak", value(extraction?.taxPeriod)],
    [en ? "Dispute stage" : "Tahap sengketa", value(input.stage)],
    [en ? "SKP/STP/SKPLB number" : "Nomor SKP/STP/SKPLB", value(extraction?.skpNumber)],
    [en ? "Objection decision number" : "Nomor keputusan keberatan", value(extraction?.djpDecisionNumber)],
    [en ? "Disputed / correction amount" : "Nilai sengketa / koreksi", value(extraction?.correctionAmount || input.correctionAmount)],
    [en ? "Correction object" : "Objek koreksi", value(extraction?.correctionObject || input.issueType)],
    [en ? "Tax authority / appellee" : "Terbanding", value(extraction?.appelleeName)],
    [en ? "DGT unit" : "Unit DJP", value(extraction?.djpUnit)],
    [en ? "Representative" : "Wakil / perwakilan", value(extraction?.representativeName)],
    [en ? "Legal counsel" : "Kuasa hukum", value(extraction?.legalCounselName)],
    [en ? "Counsel license" : "Izin kuasa", value(extraction?.legalCounselLicense)],
    [en ? "Outcome" : "Amar / outcome", value(extraction?.outcome)]
  ];
}

function scoreRows(payload: ReportPayload): LabelValue[] {
  const { analysis, language } = payload;
  const en = isEn(language);
  return [
    [en ? "Indicative score" : "Skor indikatif", `${analysis.score}/100`],
    [en ? "Confidence" : "Confidence", value(analysis.confidence)],
    [en ? "Evidence score" : "Skor bukti", `${analysis.evidenceScore}/100`],
    [en ? "Initial indication" : "Indikasi awal", value(analysis.indication)],
    [en ? "LLM status" : "Status LLM", value(analysis.llmStatus?.message)],
    [en ? "Model" : "Model", value(analysis.llmStatus?.model)]
  ];
}

function positionRows(payload: ReportPayload): LabelValue[] {
  const { input, extraction, language } = payload;
  const en = isEn(language);
  return [
    [en ? "Tax authority position" : "Posisi DJP / Terbanding", value(input.taxAuthorityPosition || extraction?.taxAuthorityPosition)],
    [en ? "Taxpayer position" : "Posisi Wajib Pajak", value(input.taxpayerPosition || extraction?.taxpayerPosition)],
    [en ? "Correction reason" : "Alasan koreksi", value(extraction?.correctionReason)],
    [en ? "Taxpayer rebuttal" : "Bantahan Wajib Pajak", value(extraction?.taxpayerRebuttal)]
  ];
}

function evidenceRows(payload: ReportPayload): LabelValue[] {
  const { input, analysis, extraction, language } = payload;
  const en = isEn(language);
  return [
    [en ? "Evidence identified" : "Bukti yang teridentifikasi", value((input.evidence?.length ? input.evidence : extraction?.evidence || []).join("; "))],
    [en ? "Evidence gaps" : "Celah bukti", value(analysis.evidenceGaps.join("; "))],
    [en ? "Legal references from document" : "Dasar hukum dari dokumen", value(extraction?.legalReferences?.join("; "))],
    [en ? "Court reasoning summary" : "Ringkasan pertimbangan majelis", value(extraction?.courtReasoning)]
  ];
}

function sectionTitle(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 260, after: 120 },
    children: [new TextRun({ text, bold: true, color: COLORS.blue, size: 28, font: "Arial" })]
  });
}

function subTitle(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 180, after: 80 },
    children: [new TextRun({ text, bold: true, color: COLORS.charcoal, size: 23, font: "Arial" })]
  });
}

function bodyParagraph(text: string, options: { bold?: boolean; color?: string; spacingAfter?: number } = {}) {
  return new Paragraph({
    spacing: { after: options.spacingAfter ?? 120, line: 300 },
    children: [
      new TextRun({
        text: value(text),
        bold: options.bold,
        color: options.color || COLORS.text,
        size: 21,
        font: "Arial"
      })
    ]
  });
}

function narrativeParagraphs(text: unknown) {
  return value(text)
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function cell(text: string, options: { header?: boolean; width?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) {
  return new TableCell({
    width: options.width ? { size: options.width, type: WidthType.DXA } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 130, bottom: 130, left: 170, right: 170 },
    shading: options.header ? { fill: COLORS.lightBlue } : undefined,
    children: [
      new Paragraph({
        alignment: options.align || AlignmentType.LEFT,
        spacing: { after: 0, line: 260 },
        children: [
          new TextRun({
            text: value(text),
            bold: options.header,
            color: options.header ? COLORS.charcoal : COLORS.text,
            size: options.header ? 19 : 18,
            font: "Arial"
          })
        ]
      })
    ]
  });
}

function makeTable(rows: TableRow[], columnWidths: number[]) {
  return new Table({
    width: { size: PAGE_TEXT_WIDTH_DXA, type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: COLORS.line },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: COLORS.line },
      left: { style: BorderStyle.SINGLE, size: 1, color: COLORS.line },
      right: { style: BorderStyle.SINGLE, size: 1, color: COLORS.line },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: COLORS.line },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: COLORS.line }
    },
    rows
  });
}

function makeKeyValueTable(rows: LabelValue[]) {
  const widths = [2800, PAGE_TEXT_WIDTH_DXA - 2800];
  return makeTable(
    rows.map(
      ([label, rowValue]) =>
        new TableRow({
          children: [cell(label, { header: true, width: widths[0] }), cell(rowValue, { width: widths[1] })]
        })
    ),
    widths
  );
}

function makeDecisionTable(payload: ReportPayload) {
  const en = isEn(payload.language);
  const widths = [560, 2400, 1700, 760, 3940];
  return makeTable([
    new TableRow({
      tableHeader: true,
      children: [
        cell(en ? "No." : "No.", { header: true, width: widths[0], align: AlignmentType.CENTER }),
        cell(en ? "Decision" : "Putusan", { header: true, width: widths[1] }),
        cell(en ? "Issue" : "Isu", { header: true, width: widths[2] }),
        cell(en ? "Score" : "Skor", { header: true, width: widths[3], align: AlignmentType.CENTER }),
        cell(en ? "Relevance / implication" : "Relevansi / implikasi", { header: true, width: widths[4] })
      ]
    }),
    ...payload.analysis.topCases.slice(0, 2).map(
      (item, idx) =>
        new TableRow({
          children: [
            cell(String(idx + 1), { width: widths[0], align: AlignmentType.CENTER }),
            cell(item.number, { width: widths[1] }),
            cell(`${item.taxType} | ${item.issue}`, { width: widths[2] }),
            cell(String(item.score), { width: widths[3], align: AlignmentType.CENTER }),
            cell(`${item.reasoning || ""}\n${item.implication || ""}`, { width: widths[4] })
          ]
        })
    )
  ], widths);
}

function makeRegulationTable(payload: ReportPayload) {
  const en = isEn(payload.language);
  const widths = [3300, 1800, 4260];
  return makeTable([
    new TableRow({
      tableHeader: true,
      children: [
        cell(en ? "Regulation" : "Peraturan", { header: true, width: widths[0] }),
        cell(en ? "Citation" : "Rujukan", { header: true, width: widths[1] }),
        cell(en ? "Focus" : "Fokus analisis", { header: true, width: widths[2] })
      ]
    }),
    ...payload.analysis.regulations.map(
      (item) =>
        new TableRow({
          children: [cell(item.title, { width: widths[0] }), cell(item.citation, { width: widths[1] }), cell(item.focus, { width: widths[2] })]
        })
    )
  ], widths);
}

function makeMarkdownTable(block: Extract<ReportBlock, { type: "table" }>) {
  const columnCount = Math.max(block.headers.length, ...block.rows.map((row) => row.length));
  const width = Math.floor(PAGE_TEXT_WIDTH_DXA / Math.max(columnCount, 1));
  const widths = Array.from({ length: columnCount }, () => width);
  return makeTable([
    new TableRow({
      tableHeader: true,
      children: Array.from({ length: columnCount }, (_, idx) => cell(block.headers[idx] || "-", { header: true, width }))
    }),
    ...block.rows.map(
      (row) =>
        new TableRow({
          children: Array.from({ length: columnCount }, (_, idx) => cell(row[idx] || "-", { width }))
        })
    )
  ], widths);
}

function recommendationChildren(payload: ReportPayload) {
  const children: Array<Paragraph | Table> = [];
  for (const block of splitRecommendation(payload.analysis.recommendation)) {
    if (block.type === "heading") {
      children.push(block.level === 2 ? subTitle(block.text) : bodyParagraph(block.text, { bold: true, color: COLORS.charcoal, spacingAfter: 70 }));
    } else if (block.type === "bullet") {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 80, line: 280 },
          children: [new TextRun({ text: block.text, color: COLORS.text, size: 21, font: "Arial" })]
        })
      );
    } else if (block.type === "table") {
      children.push(makeMarkdownTable(block));
      children.push(bodyParagraph(" ", { spacingAfter: 80 }));
    } else {
      children.push(bodyParagraph(block.text));
    }
  }
  return children;
}

function positionChildren(payload: ReportPayload) {
  const children: Array<Paragraph | Table> = [];
  for (const [label, rowValue] of positionRows(payload)) {
    children.push(subTitle(label));
    narrativeParagraphs(rowValue).forEach((part) => children.push(bodyParagraph(part, { spacingAfter: 90 })));
  }
  return children;
}

export function buildReportLines(payload: ReportPayload) {
  const en = isEn(payload.language);
  return [
    "RSM Tax Dispute Simple Advisor",
    en ? "Taxpayer Recommendation Report" : "Laporan Rekomendasi Wajib Pajak",
    "",
    `${en ? "Generated" : "Dibuat"}: ${new Date().toLocaleString(en ? "en-US" : "id-ID")}`,
    "",
    en ? "Case Details" : "Detail Kasus",
    ...caseRows(payload).map(([label, rowValue]) => `${label}: ${rowValue}`),
    "",
    en ? "Executive Assessment" : "Penilaian Eksekutif",
    ...scoreRows(payload).map(([label, rowValue]) => `${label}: ${rowValue}`),
    "",
    en ? "Positions and Evidence" : "Posisi dan Bukti",
    ...positionRows(payload).map(([label, rowValue]) => `${label}: ${rowValue}`),
    ...evidenceRows(payload).map(([label, rowValue]) => `${label}: ${rowValue}`),
    "",
    en ? "Recommendation Draft" : "Draft Rekomendasi",
    ...splitRecommendation(payload.analysis.recommendation).flatMap((block) => {
      if (block.type === "heading") return [block.text];
      if (block.type === "bullet") return [`- ${block.text}`];
      if (block.type === "table") return [block.headers.join(" | "), ...block.rows.map((row) => row.join(" | "))];
      return [block.text];
    })
  ];
}

export async function buildReportDocx(payload: ReportPayload) {
  const en = isEn(payload.language);
  const generatedAt = new Date().toLocaleString(en ? "en-US" : "id-ID");
  const title = en ? "Taxpayer Recommendation Report" : "Laporan Rekomendasi Wajib Pajak";
  const subtitle = en
    ? "Structured tax dispute analysis based on extracted document data, comparable decisions, regulation context, and LLM-assisted advisor review."
    : "Analisis sengketa pajak terstruktur berdasarkan hasil ekstraksi dokumen, putusan pembanding, konteks peraturan, dan telaah advisor berbantuan LLM.";

  const children: Array<Paragraph | Table> = [
    new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({ text: "■ ", color: COLORS.grey, size: 18, font: "Arial" }),
        new TextRun({ text: "━━━━ ", color: COLORS.green, size: 18, font: "Arial" }),
        new TextRun({ text: "━━━━━━━━━━━━", color: COLORS.blue, size: 18, font: "Arial" })
      ]
    }),
    new Paragraph({
      spacing: { after: 70 },
      children: [new TextRun({ text: "RSM", bold: true, color: COLORS.charcoal, size: 48, font: "Arial" })]
    }),
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 120 },
      children: [new TextRun({ text: title, bold: true, color: COLORS.text, size: 34, font: "Arial" })]
    }),
    bodyParagraph(subtitle, { color: COLORS.muted, spacingAfter: 180 }),
    bodyParagraph(`${en ? "Generated" : "Dibuat"}: ${generatedAt}`, { color: COLORS.muted, spacingAfter: 220 }),

    sectionTitle(en ? "1. Case Details" : "1. Detail Kasus"),
    makeKeyValueTable(caseRows(payload)),
    payload.extraction?.summary ? bodyParagraph(payload.extraction.summary, { spacingAfter: 160 }) : bodyParagraph(" ", { spacingAfter: 60 }),

    sectionTitle(en ? "2. Executive Assessment" : "2. Penilaian Eksekutif"),
    makeKeyValueTable(scoreRows(payload)),

    sectionTitle(en ? "3. Positions and Evidence" : "3. Posisi dan Bukti"),
    ...positionChildren(payload),
    subTitle(en ? "Evidence Review" : "Review Bukti"),
    makeKeyValueTable(evidenceRows(payload)),

    sectionTitle(en ? "4. Most Relevant Decisions" : "4. Putusan Paling Terkait"),
    makeDecisionTable(payload),

    sectionTitle(en ? "5. Regulatory Basis" : "5. Dasar Peraturan"),
    makeRegulationTable(payload),

    sectionTitle(en ? "6. Advisor Analysis and Recommendation" : "6. Analisis dan Rekomendasi Advisor"),
    ...recommendationChildren(payload)
  ];

  const doc = new DocxDocument({
    creator: "RSM Tax Dispute Simple Advisor",
    title: "Tax Dispute Analysis Report",
    styles: {
      paragraphStyles: [
        {
          id: "Normal",
          name: "Normal",
          run: { font: "Arial", size: 21, color: COLORS.text },
          paragraph: { spacing: { after: 120, line: 300 } }
        }
      ]
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 900, right: 900, bottom: 900, left: 900 }
          }
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: "RSM Tax Dispute Simple Advisor | Prototype analysis, subject to professional review | Page ",
                    color: COLORS.grey,
                    size: 16,
                    font: "Arial"
                  }),
                  new TextRun({ children: [PageNumber.CURRENT], color: COLORS.grey, size: 16, font: "Arial" })
                ]
              })
            ]
          })
        },
        children
      }
    ]
  });
  return Packer.toBuffer(doc);
}

function pdfText(text: string) {
  return cleanMarkdown(text)
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[•]/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

function wrapPdf(text: string, font: PDFFont, fontSize: number, maxWidth: number) {
  const words = pdfText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = `${current} ${word}`.trim();
    if (font.widthOfTextAtSize(test, fontSize) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : ["-"];
}

export async function buildReportPdf(payload: ReportPayload) {
  const en = isEn(payload.language);
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = PageSizes.A4;
  const margin = 44;
  const usableWidth = pageSize[0] - margin * 2;
  let page: PDFPage;
  let y = 0;

  const addPage = () => {
    page = pdf.addPage(pageSize);
    y = pageSize[1] - margin;
    page.drawText("RSM", { x: margin, y, size: 24, font: bold, color: rgb(0.329, 0.345, 0.353) });
    page.drawRectangle({ x: margin, y: y + 34, width: 10, height: 8, color: rgb(0.541, 0.561, 0.576) });
    page.drawRectangle({ x: margin + 18, y: y + 34, width: 42, height: 8, color: rgb(0.263, 0.627, 0.278) });
    page.drawRectangle({ x: margin + 68, y: y + 34, width: 126, height: 8, color: rgb(0, 0.612, 0.871) });
    y -= 42;
  };

  const ensure = (height: number) => {
    if (y - height < margin + 36) addPage();
  };

  const drawHeading = (text: string, size = 15) => {
    ensure(34);
    page.drawText(pdfText(text), { x: margin, y, size, font: bold, color: rgb(0, 0.612, 0.871) });
    y -= size + 12;
  };

  const drawParagraph = (text: string, options: { fontSize?: number; strong?: boolean; indent?: number } = {}) => {
    const fontSize = options.fontSize || 9.5;
    const font = options.strong ? bold : regular;
    const x = margin + (options.indent || 0);
    const maxWidth = usableWidth - (options.indent || 0);
    const lines = wrapPdf(text, font, fontSize, maxWidth);
    ensure(lines.length * (fontSize + 4) + 8);
    for (const line of lines) {
      page.drawText(line, { x, y, size: fontSize, font, color: rgb(0.184, 0.2, 0.251) });
      y -= fontSize + 4;
    }
    y -= 4;
  };

  const drawKeyValueTable = (rows: LabelValue[]) => {
    const labelWidth = 145;
    const valueWidth = usableWidth - labelWidth;
    for (const [label, rowValue] of rows) {
      const lines = wrapPdf(rowValue, regular, 8.2, valueWidth - 16);
      const rowHeight = Math.max(24, lines.length * 11 + 12);
      ensure(rowHeight + 4);
      page.drawRectangle({ x: margin, y: y - rowHeight + 5, width: labelWidth, height: rowHeight, color: rgb(0.918, 0.969, 0.992) });
      page.drawRectangle({
        x: margin + labelWidth,
        y: y - rowHeight + 5,
        width: valueWidth,
        height: rowHeight,
        borderColor: rgb(0.847, 0.878, 0.906),
        borderWidth: 0.5
      });
      page.drawRectangle({
        x: margin,
        y: y - rowHeight + 5,
        width: labelWidth,
        height: rowHeight,
        borderColor: rgb(0.847, 0.878, 0.906),
        borderWidth: 0.5
      });
      page.drawText(pdfText(label), { x: margin + 8, y: y - 11, size: 8.2, font: bold, color: rgb(0.329, 0.345, 0.353) });
      let textY = y - 11;
      for (const line of lines) {
        page.drawText(line, { x: margin + labelWidth + 8, y: textY, size: 8.2, font: regular, color: rgb(0.184, 0.2, 0.251) });
        textY -= 11;
      }
      y -= rowHeight;
    }
    y -= 14;
  };

  addPage();
  drawHeading(en ? "Taxpayer Recommendation Report" : "Laporan Rekomendasi Wajib Pajak", 18);
  drawParagraph(
    en
      ? "Structured tax dispute analysis based on extracted document data, comparable decisions, regulation context, and LLM-assisted advisor review."
      : "Analisis sengketa pajak terstruktur berdasarkan hasil ekstraksi dokumen, putusan pembanding, konteks peraturan, dan telaah advisor berbantuan LLM.",
    { fontSize: 10.5 }
  );
  drawParagraph(`${en ? "Generated" : "Dibuat"}: ${new Date().toLocaleString(en ? "en-US" : "id-ID")}`, { fontSize: 9 });

  drawHeading(en ? "1. Case Details" : "1. Detail Kasus");
  drawKeyValueTable(caseRows(payload));
  if (payload.extraction?.summary) drawParagraph(payload.extraction.summary);

  drawHeading(en ? "2. Executive Assessment" : "2. Penilaian Eksekutif");
  drawKeyValueTable(scoreRows(payload));

  drawHeading(en ? "3. Positions and Evidence" : "3. Posisi dan Bukti");
  positionRows(payload).forEach(([label, rowValue]) => {
    drawParagraph(label, { strong: true, fontSize: 10 });
    narrativeParagraphs(rowValue).forEach((part) => drawParagraph(part));
  });
  drawParagraph(en ? "Evidence Review" : "Review Bukti", { strong: true, fontSize: 10 });
  drawKeyValueTable(evidenceRows(payload));

  drawHeading(en ? "4. Most Relevant Decisions" : "4. Putusan Paling Terkait");
  payload.analysis.topCases.slice(0, 2).forEach((item, idx) => {
    drawParagraph(`${idx + 1}. ${item.number} | ${item.taxType} | ${item.issue} | ${en ? "Score" : "Skor"} ${item.score}`, { strong: true });
    drawParagraph(`${item.reasoning || ""} ${item.implication || ""}`);
  });

  drawHeading(en ? "5. Regulatory Basis" : "5. Dasar Peraturan");
  payload.analysis.regulations.forEach((item) => drawParagraph(`${item.title} (${item.citation}): ${item.focus}`));

  drawHeading(en ? "6. Advisor Analysis and Recommendation" : "6. Analisis dan Rekomendasi Advisor");
  for (const block of splitRecommendation(payload.analysis.recommendation)) {
    if (block.type === "heading") drawHeading(block.text, block.level === 2 ? 13 : 11);
    if (block.type === "paragraph") drawParagraph(block.text);
    if (block.type === "bullet") drawParagraph(`- ${block.text}`, { indent: 14 });
    if (block.type === "table") {
      drawParagraph(block.headers.join(" | "), { strong: true });
      block.rows.forEach((row) => drawParagraph(row.join(" | "), { indent: 10 }));
    }
  }

  const pages = pdf.getPages();
  pages.forEach((pdfPage, idx) => {
    pdfPage.drawText(`RSM Tax Dispute Simple Advisor | Prototype analysis, subject to professional review | ${idx + 1}/${pages.length}`, {
      x: margin,
      y: 28,
      size: 7.5,
      font: regular,
      color: rgb(0.541, 0.561, 0.576)
    });
  });

  return Buffer.from(await pdf.save());
}
