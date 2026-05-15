import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { AnalysisResult, AnalyzeInput } from "./analyze";
import type { ExtractionResult } from "./extraction";

export type ReportPayload = {
  input: AnalyzeInput;
  analysis: AnalysisResult;
  extraction?: ExtractionResult | null;
  language: "id" | "en";
};

function linesFromText(text: string) {
  return String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function buildReportLines(payload: ReportPayload) {
  const { input, analysis, extraction, language } = payload;
  const isEn = language === "en";
  const lines = [
    "RSM Tax Dispute Simple Advisor",
    isEn ? "Taxpayer Recommendation Report" : "Laporan Rekomendasi Wajib Pajak",
    "",
    `${isEn ? "Generated" : "Dibuat"}: ${new Date().toLocaleString(isEn ? "en-US" : "id-ID")}`,
    `${isEn ? "Taxpayer" : "Wajib Pajak"}: ${input.taxpayerName || "-"}`,
    `${isEn ? "Tax type" : "Jenis pajak"}: ${input.taxType || "-"}`,
    `${isEn ? "Issue" : "Isu"}: ${input.issueType || "-"}`,
    `${isEn ? "Stage" : "Tahap"}: ${input.stage || "-"}`,
    `${isEn ? "Correction amount" : "Nilai koreksi"}: ${input.correctionAmount || "-"}`,
    "",
    isEn ? "Executive Assessment" : "Penilaian Eksekutif",
    `${isEn ? "Score" : "Skor"}: ${analysis.score}`,
    `${isEn ? "Confidence" : "Confidence"}: ${analysis.confidence}`,
    `${isEn ? "Evidence score" : "Skor bukti"}: ${analysis.evidenceScore}`,
    `${isEn ? "Indication" : "Indikasi"}: ${analysis.indication}`,
    "",
    isEn ? "Extracted Document Information" : "Informasi Dokumen Terekstraksi",
    `${isEn ? "File" : "File"}: ${extraction?.filename || "-"}`,
    `${isEn ? "Decision number" : "Nomor putusan"}: ${extraction?.putusanNumber || "-"}`,
    `${isEn ? "Tax period" : "Masa pajak"}: ${extraction?.taxPeriod || "-"}`,
    `${isEn ? "DGT unit" : "Unit DJP"}: ${extraction?.djpUnit || "-"}`,
    `${isEn ? "Legal counsel" : "Kuasa hukum"}: ${extraction?.legalCounselName || "-"}`,
    `${isEn ? "Summary" : "Ringkasan"}: ${extraction?.summary || "-"}`,
    "",
    isEn ? "Tax Authority Position" : "Posisi DJP",
    input.taxAuthorityPosition || "-",
    "",
    isEn ? "Taxpayer Position" : "Posisi Wajib Pajak",
    input.taxpayerPosition || "-",
    "",
    isEn ? "Most Relevant Decisions" : "Putusan Paling Terkait",
    ...analysis.topCases.flatMap((item, idx) => [
      `${idx + 1}. ${item.number}`,
      `${item.taxType} | ${item.issue} | ${isEn ? "Score" : "Skor"} ${item.score}`,
      item.reasoning,
      item.implication
    ]),
    "",
    isEn ? "Evidence Gaps" : "Celah Bukti",
    ...(analysis.evidenceGaps.length ? analysis.evidenceGaps.map((gap) => `- ${gap}`) : ["-"]),
    "",
    isEn ? "Regulatory Basis" : "Dasar Peraturan",
    ...analysis.regulations.map((item) => `- ${item.title} (${item.citation}): ${item.focus}`),
    "",
    isEn ? "Recommendation Draft" : "Draft Rekomendasi",
    ...linesFromText(analysis.recommendation)
  ];
  return lines;
}

export async function buildReportDocx(payload: ReportPayload) {
  const lines = buildReportLines(payload);
  const children = lines.map((line, index) => {
    const isTitle = index < 2;
    const isSection = Boolean(line) && !line.includes(":") && line.length < 60 && index > 4;
    return new Paragraph({
      heading: isTitle ? HeadingLevel.TITLE : isSection ? HeadingLevel.HEADING_2 : undefined,
      spacing: { after: isTitle || isSection ? 180 : 90 },
      children: [
        new TextRun({
          text: line || " ",
          bold: isTitle || isSection,
          color: isTitle ? "54585A" : isSection ? "009CDE" : "2F3340"
        })
      ]
    });
  });
  const doc = new Document({
    creator: "RSM Tax Dispute Simple Advisor",
    title: "Tax Dispute Analysis Report",
    sections: [{ children }]
  });
  return Packer.toBuffer(doc);
}

function escapePdfText(text: string) {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapLine(line: string, width = 92) {
  const words = line.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > width) {
      lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export function buildReportPdf(payload: ReportPayload) {
  const wrapped = buildReportLines(payload).flatMap((line) => wrapLine(line));
  const pages: string[][] = [];
  for (let idx = 0; idx < wrapped.length; idx += 48) {
    pages.push(wrapped.slice(idx, idx + 48));
  }
  if (!pages.length) pages.push([""]);
  const objects: Buffer[] = [];
  const add = (body: string) => {
    objects.push(Buffer.from(body, "latin1"));
    return objects.length;
  };
  const catalogId = add("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = add("PAGES_PLACEHOLDER");
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds: number[] = [];
  for (const pageLines of pages) {
    const commands = [
      "0.541 0.561 0.576 rg",
      "50 814 12 10 re f",
      "0.263 0.627 0.278 rg",
      "70 814 40 10 re f",
      "0.000 0.612 0.871 rg",
      "118 814 128 10 re f",
      "0.329 0.345 0.353 rg",
      "BT",
      "/F1 20 Tf",
      "50 788 Td",
      "(RSM) Tj",
      "ET",
      "0 0 0 rg",
      "BT",
      "/F1 10 Tf",
      "50 760 Td",
      "14 TL"
    ];
    for (const line of pageLines) {
      commands.push(`(${escapePdfText(line)}) Tj`);
      commands.push("T*");
    }
    commands.push("ET");
    const stream = commands.join("\n");
    const streamId = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${streamId} 0 R >>`
      )
    );
  }
  objects[pagesId - 1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`, "latin1");

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  const offsets = [0];
  for (let idx = 0; idx < objects.length; idx += 1) {
    offsets.push(Buffer.concat(chunks).length);
    chunks.push(Buffer.from(`${idx + 1} 0 obj\n`, "ascii"), objects[idx], Buffer.from("\nendobj\n", "ascii"));
  }
  const beforeXref = Buffer.concat(chunks);
  const xrefStart = beforeXref.length;
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  ].join("");
  return Buffer.concat([beforeXref, Buffer.from(xref, "ascii")]);
}
