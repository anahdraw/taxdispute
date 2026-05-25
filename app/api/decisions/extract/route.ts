import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { hasDatabase, upsertDecisionExtraction } from "@/lib/db";
import { emptyPpnComponents, extractPdfWithLlm, type ExtractionResult, type PpnComponents } from "@/lib/extraction";

export const runtime = "nodejs";

const MAX_EXTRACT_BYTES = 3.6 * 1024 * 1024;

function cleanMergedText(value: unknown) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\bChunk\s+\d+\s*:\s*/gi, "\n\n")
    .replace(/\b(?:Section|Bagian|Halaman|Pages?)\s+\d+(?:\s*[-–]\s*\d+)?\s*:\s*/gi, "\n\n")
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function combineExtractionText(parts: string[]) {
  const seen = new Set<string>();
  return parts
    .map(cleanMergedText)
    .filter(Boolean)
    .filter((part) => {
      const key = part.toLowerCase().replace(/\s+/g, " ").slice(0, 260);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n\n");
}

function mergeExtractions(parts: ExtractionResult[], originalName: string, language: "id" | "en"): ExtractionResult {
  const first = parts[0];
  const pick = (field: keyof ExtractionResult) => {
    const value = parts.map((part) => part[field]).find((item) => typeof item === "string" && item.trim());
    return typeof value === "string" ? cleanMergedText(value) : "";
  };
  const unique = (values: string[][]) => Array.from(new Set(values.flat().map((item) => item.trim()).filter(Boolean))).slice(0, 24);
  const combined = (field: keyof ExtractionResult) =>
    combineExtractionText(
      parts.map((part) => {
        const value = part[field];
        return typeof value === "string" ? value : "";
      })
    );
  const pickPpn = (field: keyof PpnComponents) => {
    const value = parts.map((part) => part.ppnComponents?.[field]).find((item) => typeof item === "string" && item.trim());
    return typeof value === "string" ? cleanMergedText(value) : "";
  };
  const ppnIsLb = parts.map((part) => part.ppnComponents?.ppn_is_lb).find((value): value is boolean => typeof value === "boolean");

  return {
    ...first,
    filename: originalName,
    documentType: pick("documentType"),
    putusanNumber: pick("putusanNumber"),
    putusanYear: pick("putusanYear"),
    courtPanel: pick("courtPanel"),
    judgeNames: unique(parts.map((part) => part.judgeNames || [])),
    clerkName: pick("clerkName"),
    procedureType: pick("procedureType"),
    examinationLevel: pick("examinationLevel"),
    caseFileNumber: pick("caseFileNumber"),
    decisionDate: pick("decisionDate"),
    hearingDate: pick("hearingDate"),
    taxpayerName: pick("taxpayerName"),
    taxpayerNpwp: pick("taxpayerNpwp"),
    taxpayerAddress: pick("taxpayerAddress"),
    representativeName: pick("representativeName"),
    legalCounselName: pick("legalCounselName"),
    legalCounselLicense: pick("legalCounselLicense"),
    appelleeName: pick("appelleeName"),
    djpUnit: pick("djpUnit"),
    taxType: pick("taxType"),
    taxPeriod: pick("taxPeriod"),
    skpNumber: pick("skpNumber"),
    djpDecisionNumber: pick("djpDecisionNumber"),
    issueType: pick("issueType"),
    issueSubtype: pick("issueSubtype"),
    correctionAmount: pick("correctionAmount"),
    correctionObject: pick("correctionObject"),
    correctionReason: combined("correctionReason") || pick("correctionReason"),
    taxpayerRebuttal: combined("taxpayerRebuttal") || pick("taxpayerRebuttal"),
    taxAuthorityPosition: combined("taxAuthorityPosition") || pick("taxAuthorityPosition"),
    taxpayerPosition: combined("taxpayerPosition") || pick("taxpayerPosition"),
    evidence: unique(parts.map((part) => part.evidence)),
    legalReferences: unique(parts.map((part) => part.legalReferences)),
    courtReasoning: combined("courtReasoning") || pick("courtReasoning"),
    outcome: pick("outcome"),
    summary: combined("summary") || pick("summary"),
    ppnComponents: {
      ...emptyPpnComponents(),
      ppn_dpp: pickPpn("ppn_dpp"),
      ppn_pajak_keluaran: pickPpn("ppn_pajak_keluaran"),
      ppn_pajak_masukan: pickPpn("ppn_pajak_masukan"),
      ppn_kb_lb: pickPpn("ppn_kb_lb"),
      ppn_kompensasi: pickPpn("ppn_kompensasi"),
      ppn_masih_harus_bayar: pickPpn("ppn_masih_harus_bayar"),
      ppn_dpp_djp: pickPpn("ppn_dpp_djp"),
      ppn_pm_djp: pickPpn("ppn_pm_djp"),
      ppn_sanksi_pasal_13: pickPpn("ppn_sanksi_pasal_13"),
      ppn_koreksi_dpp: pickPpn("ppn_koreksi_dpp"),
      ppn_koreksi_pm: pickPpn("ppn_koreksi_pm"),
      ppn_tarif: pickPpn("ppn_tarif"),
      ppn_is_lb: typeof ppnIsLb === "boolean" ? ppnIsLb : null,
      ppn_jenis_penyerahan: (pickPpn("ppn_jenis_penyerahan") as PpnComponents["ppn_jenis_penyerahan"]) || "",
      ppn_objek_sengketa: (pickPpn("ppn_objek_sengketa") as PpnComponents["ppn_objek_sengketa"]) || "",
      ppn_notes: combineExtractionText(parts.map((part) => part.ppnComponents?.ppn_notes || ""))
    },
    extractedAt: new Date().toISOString(),
    llmStatus: {
      used: true,
      model: first.llmStatus.model,
      message:
        parts.length > 1
          ? language === "en"
            ? `PDF extracted with LLM across ${parts.length} document sections`
            : `PDF diekstrak dengan LLM dari ${parts.length} bagian dokumen`
          : first.llmStatus.message
    }
  };
}

async function splitPdfForExtraction(bytes: ArrayBuffer, filename: string) {
  if (bytes.byteLength <= MAX_EXTRACT_BYTES) {
    return [new File([bytes], filename, { type: "application/pdf" })];
  }

  const sourceDoc = await PDFDocument.load(bytes);
  const chunks: File[] = [];
  let pageIndex = 0;
  const baseName = filename.replace(/\.pdf$/i, "");

  while (pageIndex < sourceDoc.getPageCount()) {
    let pageCount = Math.min(5, sourceDoc.getPageCount() - pageIndex);
    let chunkBytes: Uint8Array | null = null;

    while (pageCount >= 1) {
      const chunkDoc = await PDFDocument.create();
      const indices = Array.from({ length: pageCount }, (_, offset) => pageIndex + offset);
      const copiedPages = await chunkDoc.copyPages(sourceDoc, indices);
      copiedPages.forEach((page) => chunkDoc.addPage(page));
      chunkBytes = await chunkDoc.save();
      if (chunkBytes.byteLength <= MAX_EXTRACT_BYTES || pageCount === 1) {
        break;
      }
      pageCount = Math.max(1, Math.floor(pageCount / 2));
    }

    if (!chunkBytes || chunkBytes.byteLength > MAX_EXTRACT_BYTES) {
      throw new Error("One PDF page is still too large for extraction. Please compress the PDF first.");
    }

    const startPage = pageIndex + 1;
    const endPage = pageIndex + pageCount;
    const chunkBuffer = new ArrayBuffer(chunkBytes.byteLength);
    new Uint8Array(chunkBuffer).set(chunkBytes);
    chunks.push(new File([chunkBuffer], `${baseName}-pages-${startPage}-${endPage}.pdf`, { type: "application/pdf" }));
    pageIndex += pageCount;
  }

  return chunks;
}

function friendlyExtractionError(error: unknown, sections?: number) {
  const message = error instanceof Error ? error.message : "Stored PDF extraction failed.";
  if (/unexpected token|not valid json|valid json|non-json|response did not contain text/i.test(message)) {
    return sections && sections > 1
      ? `LLM extraction returned an invalid response for one of ${sections} document sections. Please try Re-extract again, or use Edit extraction to adjust the existing data.`
      : "LLM extraction returned an invalid response. Please try Re-extract again, or use Edit extraction to adjust the existing data.";
  }
  if (/timeout|timed out|504|503|502|too large|payload|body exceeded/i.test(message)) {
    return "Re-extraction could not finish in this serverless run. This document may be too large or the LLM request timed out. Please try again, or edit the existing extraction manually.";
  }
  return message;
}

export async function POST(request: Request) {
  let chunkCount = 0;
  try {
    const body = (await request.json()) as {
      id?: string;
      filename?: string;
      url?: string;
      downloadUrl?: string;
      language?: "id" | "en";
    };
    const id = body.id || "";
    const filename = body.filename || "decision.pdf";
    const sourceUrl = body.downloadUrl || body.url || "";
    const language = body.language === "id" ? "id" : "en";

    if (!id || !sourceUrl) {
      return NextResponse.json({ error: "Missing stored document id or URL." }, { status: 400 });
    }

    const pdfResponse = await fetch(sourceUrl);
    if (!pdfResponse.ok) {
      return NextResponse.json({ error: `Could not download stored PDF (${pdfResponse.status}).` }, { status: 502 });
    }

    const pdfBytes = await pdfResponse.arrayBuffer();
    const chunks = await splitPdfForExtraction(pdfBytes, filename);
    chunkCount = chunks.length;
    const extractedParts: ExtractionResult[] = [];
    for (const chunk of chunks) {
      try {
        extractedParts.push(await extractPdfWithLlm(chunk, language));
      } catch {
        extractedParts.push(await extractPdfWithLlm(chunk, language));
      }
    }
    const extraction = mergeExtractions(extractedParts, filename, language);

    if (hasDatabase()) {
      await upsertDecisionExtraction(id, extraction);
    }

    return NextResponse.json({ extraction, status: "extracted", sections: chunks.length });
  } catch (error) {
    return NextResponse.json(
      { error: friendlyExtractionError(error, chunkCount) },
      { status: 500 }
    );
  }
}
