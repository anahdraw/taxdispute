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
import { hasPpnComponentData, ppnClassificationRows, ppnComponentRows, ppnFormulaRows } from "./ppn-components";

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
  | { type: "numbered"; number: string; text: string }
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
const APP_NAME = "RSM Tax Dispute Agentic Advisor";

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

    if (/^[A-Z0-9 /&(),.'-]+$/.test(raw) && /[A-Z]/.test(raw) && raw.length >= 5 && raw.length <= 80) {
      blocks.push({ type: "heading", level: 3, text: cleanMarkdown(raw) });
      continue;
    }

    const numberedHeading = raw.match(/^(\d+)[.)]\s+(.+)$/);
    if (numberedHeading && raw.length < 80 && !/[.!?;:]$/.test(raw)) {
      blocks.push({ type: "heading", level: 2, text: cleanMarkdown(`${numberedHeading[1]}. ${numberedHeading[2]}`) });
      continue;
    }
    if (numberedHeading) {
      blocks.push({ type: "numbered", number: numberedHeading[1], text: cleanMarkdown(numberedHeading[2]) });
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

function ppnReportRows(payload: ReportPayload): LabelValue[] {
  const { extraction, language } = payload;
  if (!extraction || !hasPpnComponentData(extraction)) return [];
  const rows = [...ppnComponentRows(extraction.ppnComponents, language), ...ppnClassificationRows(extraction.ppnComponents, language)];
  return rows.map((row) => [`${row.label} (${row.key})`, value(row.value)]);
}

function ppnFormulaReportRows(payload: ReportPayload): LabelValue[] {
  const { extraction, language } = payload;
  if (!extraction || !hasPpnComponentData(extraction)) return [];
  return ppnFormulaRows(extraction.ppnComponents, language).map((row) => [row.formula, value(`${row.result}${row.basis ? ` - ${row.basis}` : ""}`)]);
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

function scoreBreakdownRows(payload: ReportPayload): string[][] {
  const { analysis, language } = payload;
  const en = isEn(language);
  return (analysis.scoringBreakdown?.components || []).map((component) => [
    component.label,
    `${component.maxPoints}`,
    `${component.earnedPoints}`,
    component.rationale,
    component.signals.slice(0, 4).join("; ") || (en ? "No signal recorded" : "Tidak ada sinyal tercatat")
  ]);
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
    keepNext: true,
    spacing: { before: 260, after: 120 },
    children: [new TextRun({ text, bold: true, color: COLORS.blue, size: 28, font: "Arial" })]
  });
}

function subTitle(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    keepNext: true,
    spacing: { before: 180, after: 80 },
    children: [new TextRun({ text, bold: true, color: COLORS.charcoal, size: 23, font: "Arial" })]
  });
}

function spacer(spacingAfter = 80) {
  return new Paragraph({ spacing: { after: spacingAfter }, children: [] });
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

function noBorders() {
  return {
    top: { style: BorderStyle.NONE, size: 0, color: COLORS.white },
    bottom: { style: BorderStyle.NONE, size: 0, color: COLORS.white },
    left: { style: BorderStyle.NONE, size: 0, color: COLORS.white },
    right: { style: BorderStyle.NONE, size: 0, color: COLORS.white },
    insideHorizontal: { style: BorderStyle.NONE, size: 0, color: COLORS.white },
    insideVertical: { style: BorderStyle.NONE, size: 0, color: COLORS.white }
  };
}

function brandBarCell(width: number, fill?: string) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    shading: fill ? { fill } : undefined,
    borders: noBorders(),
    children: [
      new Paragraph({
        spacing: { before: 0, after: 0, line: 70 },
        children: [new TextRun({ text: " ", size: 2, font: "Arial" })]
      })
    ]
  });
}

function rsmDocumentHeader(): Array<Paragraph | Table> {
  return [
    new Table({
      width: { size: 3860, type: WidthType.DXA },
      columnWidths: [220, 150, 760, 150, 2580],
      layout: TableLayoutType.FIXED,
      borders: noBorders(),
      rows: [
        new TableRow({
          children: [
            brandBarCell(220, COLORS.grey),
            brandBarCell(150),
            brandBarCell(760, COLORS.green),
            brandBarCell(150),
            brandBarCell(2580, COLORS.blue)
          ]
        })
      ]
    }),
    new Paragraph({
      spacing: { before: 95, after: 90 },
      children: [new TextRun({ text: "RSM", bold: true, color: COLORS.charcoal, size: 62, font: "Arial" })]
    })
  ];
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
  const widths = [520, 2400, 1700, 900, 3840];
  return makeTable([
    new TableRow({
      tableHeader: true,
      children: [
        cell("#", { header: true, width: widths[0], align: AlignmentType.CENTER }),
        cell(en ? "Decision" : "Putusan", { header: true, width: widths[1] }),
        cell(en ? "Issue" : "Isu", { header: true, width: widths[2] }),
        cell(en ? "Score %" : "Skor %", { header: true, width: widths[3], align: AlignmentType.CENTER }),
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

function makeScoreBreakdownTable(payload: ReportPayload) {
  const en = isEn(payload.language);
  const widths = [1900, 780, 780, 3000, 2900];
  return makeTable([
    new TableRow({
      tableHeader: true,
      children: [
        cell(en ? "Component" : "Komponen", { header: true, width: widths[0] }),
        cell(en ? "Max" : "Maks.", { header: true, width: widths[1], align: AlignmentType.CENTER }),
        cell(en ? "Pts" : "Poin", { header: true, width: widths[2], align: AlignmentType.CENTER }),
        cell(en ? "Assessment basis" : "Dasar penilaian", { header: true, width: widths[3] }),
        cell(en ? "Signals used" : "Sinyal yang dipakai", { header: true, width: widths[4] })
      ]
    }),
    ...scoreBreakdownRows(payload).map(
      (row) =>
        new TableRow({
          children: [
            cell(row[0], { width: widths[0] }),
            cell(row[1], { width: widths[1], align: AlignmentType.CENTER }),
            cell(row[2], { width: widths[2], align: AlignmentType.CENTER }),
            cell(row[3], { width: widths[3] }),
            cell(row[4], { width: widths[4] })
          ]
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
    } else if (block.type === "numbered") {
      children.push(
        new Paragraph({
          indent: { left: 360, hanging: 260 },
          spacing: { after: 90, line: 280 },
          children: [
            new TextRun({ text: `${block.number}. `, bold: true, color: COLORS.charcoal, size: 21, font: "Arial" }),
            new TextRun({ text: block.text, color: COLORS.text, size: 21, font: "Arial" })
          ]
        })
      );
    } else {
      children.push(bodyParagraph(block.text));
    }
  }
  return children;
}

function decisionChildren(payload: ReportPayload) {
  const en = isEn(payload.language);
  const children: Array<Paragraph | Table> = [];
  payload.analysis.topCases.slice(0, 2).forEach((item, idx) => {
    children.push(subTitle(`${idx + 1}. ${item.number}`));
    children.push(
      makeKeyValueTable([
        [en ? "Tax / issue" : "Pajak / isu", `${value(item.taxType)} | ${value(item.issue)}`],
        [en ? "Indicative similarity" : "Kemiripan indikatif", `${item.score}%`],
        [en ? "Outcome" : "Outcome", value(item.outcome)],
        [en ? "Amount" : "Nilai", value(item.amount)]
      ])
    );
    children.push(spacer(70));
    children.push(bodyParagraph(en ? "Why this decision matters" : "Mengapa putusan ini penting", { bold: true, color: COLORS.charcoal, spacingAfter: 60 }));
    narrativeParagraphs(item.reasoning).forEach((part) => children.push(bodyParagraph(part, { spacingAfter: 90 })));
    children.push(bodyParagraph(en ? "Advisor implication" : "Implikasi untuk advisor", { bold: true, color: COLORS.charcoal, spacingAfter: 60 }));
    narrativeParagraphs(item.implication).forEach((part) => children.push(bodyParagraph(part, { spacingAfter: 90 })));
    if (item.matchPoints.length) {
      children.push(bodyParagraph(`${en ? "Match signals" : "Sinyal kemiripan"}: ${item.matchPoints.slice(0, 6).join("; ")}`, { color: COLORS.muted, spacingAfter: 120 }));
    }
  });
  return children.length ? children : [bodyParagraph(en ? "No comparable decision is available." : "Belum ada putusan pembanding.")];
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
    APP_NAME,
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
    en ? "Scoring Methodology" : "Metodologi Skor",
    payload.analysis.scoringBreakdown?.formula || "",
    ...scoreBreakdownRows(payload).map((row) => `${row[0]}: ${row[2]}/${row[1]} - ${row[3]} (${row[4]})`),
    ...(payload.analysis.scoringBreakdown?.notes || []),
    "",
    en ? "Positions and Evidence" : "Posisi dan Bukti",
    ...positionRows(payload).map(([label, rowValue]) => `${label}: ${rowValue}`),
    ...evidenceRows(payload).map(([label, rowValue]) => `${label}: ${rowValue}`),
    "",
    en ? "Recommendation Draft" : "Draft Rekomendasi",
    ...splitRecommendation(payload.analysis.recommendation).flatMap((block) => {
      if (block.type === "heading") return [block.text];
      if (block.type === "bullet") return [`- ${block.text}`];
      if (block.type === "numbered") return [`${block.number}. ${block.text}`];
      if (block.type === "table") return [block.headers.join(" | "), ...block.rows.map((row) => row.join(" | "))];
      return [block.text];
    })
  ];
}

export async function buildReportDocx(payload: ReportPayload) {
  const en = isEn(payload.language);
  const generatedAt = new Date().toLocaleString(en ? "en-US" : "id-ID");
  const title = en ? `${APP_NAME} Report` : `Laporan ${APP_NAME}`;
  const subtitle = en
    ? "Advisor-ready dispute review based on extracted case data, transparent scorecard, comparable decisions, regulation context, and LLM-assisted drafting."
    : "Telaah sengketa siap-review advisor berdasarkan data kasus terekstraksi, scorecard transparan, putusan pembanding, konteks peraturan, dan drafting berbantuan LLM.";
  const ppnRows = ppnReportRows(payload);
  const ppnFormula = ppnFormulaReportRows(payload);

  const children: Array<Paragraph | Table> = [
    ...rsmDocumentHeader(),
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 120 },
      children: [new TextRun({ text: title, bold: true, color: COLORS.text, size: 34, font: "Arial" })]
    }),
    bodyParagraph(subtitle, { color: COLORS.muted, spacingAfter: 180 }),
    bodyParagraph(`${en ? "Generated" : "Dibuat"}: ${generatedAt}`, { color: COLORS.muted, spacingAfter: 220 }),

    sectionTitle(en ? "1. Case Details" : "1. Detail Kasus"),
    makeKeyValueTable(caseRows(payload)),
    ...(ppnRows.length
      ? [
          subTitle(en ? "VAT Components" : "Komponen PPN"),
          makeKeyValueTable(ppnRows),
          ...(ppnFormula.length ? [subTitle(en ? "Indicative VAT Formula Check" : "Cek Rumus PPN Indikatif"), makeKeyValueTable(ppnFormula)] : [])
        ]
      : []),
    ...(payload.extraction?.summary
      ? [subTitle(en ? "Document Summary" : "Ringkasan Dokumen"), bodyParagraph(payload.extraction.summary, { spacingAfter: 160 })]
      : [bodyParagraph(" ", { spacingAfter: 60 })]),

    sectionTitle(en ? "2. Executive Assessment" : "2. Penilaian Eksekutif"),
    makeKeyValueTable(scoreRows(payload)),
    subTitle(en ? "Transparent Scoring Methodology" : "Metodologi Skor Transparan"),
    bodyParagraph(payload.analysis.scoringBreakdown?.formula || "-", { color: COLORS.charcoal, spacingAfter: 100 }),
    makeScoreBreakdownTable(payload),
    ...(payload.analysis.scoringBreakdown?.notes || []).map((note) => bodyParagraph(note, { color: COLORS.muted, spacingAfter: 70 })),

    sectionTitle(en ? "3. Positions and Evidence" : "3. Posisi dan Bukti"),
    ...positionChildren(payload),
    subTitle(en ? "Evidence Review" : "Review Bukti"),
    makeKeyValueTable(evidenceRows(payload)),

    sectionTitle(en ? "4. Most Relevant Decisions" : "4. Putusan Paling Terkait"),
    ...decisionChildren(payload),

    sectionTitle(en ? "5. Regulatory Basis" : "5. Dasar Peraturan"),
    makeRegulationTable(payload),

    sectionTitle(en ? "6. Advisor Analysis and Recommendation" : "6. Analisis dan Rekomendasi Advisor"),
    ...recommendationChildren(payload)
  ];

  const doc = new DocxDocument({
    creator: APP_NAME,
    title: `${APP_NAME} Report`,
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
                    text: `${APP_NAME} | Indicative analysis, subject to advisor review | Page `,
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
    page.drawRectangle({ x: margin, y: y + 40, width: 12, height: 8, color: rgb(0.541, 0.561, 0.576) });
    page.drawRectangle({ x: margin + 20, y: y + 40, width: 58, height: 8, color: rgb(0.263, 0.627, 0.278) });
    page.drawRectangle({ x: margin + 88, y: y + 40, width: 150, height: 8, color: rgb(0, 0.612, 0.871) });
    page.drawText("RSM", { x: margin, y, size: 30, font: bold, color: rgb(0.329, 0.345, 0.353) });
    y -= 54;
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
  drawHeading(en ? `${APP_NAME} Report` : `Laporan ${APP_NAME}`, 18);
  drawParagraph(
    en
      ? "Advisor-ready dispute review based on extracted case data, transparent scorecard, comparable decisions, regulation context, and LLM-assisted drafting."
      : "Telaah sengketa siap-review advisor berdasarkan data kasus terekstraksi, scorecard transparan, putusan pembanding, konteks peraturan, dan drafting berbantuan LLM.",
    { fontSize: 10.5 }
  );
  drawParagraph(`${en ? "Generated" : "Dibuat"}: ${new Date().toLocaleString(en ? "en-US" : "id-ID")}`, { fontSize: 9 });

  drawHeading(en ? "1. Case Details" : "1. Detail Kasus");
  drawKeyValueTable(caseRows(payload));
  const ppnRows = ppnReportRows(payload);
  const ppnFormula = ppnFormulaReportRows(payload);
  if (ppnRows.length) {
    drawParagraph(en ? "VAT Components" : "Komponen PPN", { strong: true, fontSize: 10.5 });
    drawKeyValueTable(ppnRows);
    if (ppnFormula.length) {
      drawParagraph(en ? "Indicative VAT Formula Check" : "Cek Rumus PPN Indikatif", { strong: true, fontSize: 10.5 });
      drawKeyValueTable(ppnFormula);
    }
  }
  if (payload.extraction?.summary) {
    drawParagraph(en ? "Document Summary" : "Ringkasan Dokumen", { strong: true, fontSize: 10.5 });
    drawParagraph(payload.extraction.summary);
  }

  drawHeading(en ? "2. Executive Assessment" : "2. Penilaian Eksekutif");
  drawKeyValueTable(scoreRows(payload));
  drawParagraph(en ? "Transparent Scoring Methodology" : "Metodologi Skor Transparan", { strong: true, fontSize: 10.5 });
  drawParagraph(payload.analysis.scoringBreakdown?.formula || "-");
  scoreBreakdownRows(payload).forEach((row) => {
    drawParagraph(`${row[0]}: ${row[2]}/${row[1]}`, { strong: true, fontSize: 9.5 });
    drawParagraph(`${row[3]} ${row[4]}`, { indent: 10, fontSize: 8.5 });
  });
  (payload.analysis.scoringBreakdown?.notes || []).forEach((note) => drawParagraph(note, { indent: 10, fontSize: 8.5 }));

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
    if (block.type === "numbered") drawParagraph(`${block.number}. ${block.text}`, { indent: 14 });
    if (block.type === "table") {
      drawParagraph(block.headers.join(" | "), { strong: true });
      block.rows.forEach((row) => drawParagraph(row.join(" | "), { indent: 10 }));
    }
  }

  const pages = pdf.getPages();
  pages.forEach((pdfPage, idx) => {
    pdfPage.drawText(`${APP_NAME} | Indicative analysis, subject to advisor review | ${idx + 1}/${pages.length}`, {
      x: margin,
      y: 28,
      size: 7.5,
      font: regular,
      color: rgb(0.541, 0.561, 0.576)
    });
  });

  return Buffer.from(await pdf.save());
}
