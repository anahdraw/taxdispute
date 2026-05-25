import type { AnalyzeInput } from "./analyze";
import { callOpenAIWithPdf, configuredModel, extractJsonObject } from "./openai";

export type PpnComponents = {
  ppn_dpp: string;
  ppn_pajak_keluaran: string;
  ppn_pajak_masukan: string;
  ppn_kb_lb: string;
  ppn_kompensasi: string;
  ppn_masih_harus_bayar: string;
  ppn_dpp_djp: string;
  ppn_pm_djp: string;
  ppn_sanksi_pasal_13: string;
  ppn_koreksi_dpp: string;
  ppn_koreksi_pm: string;
  ppn_tarif: string;
  ppn_is_lb: boolean | null;
  ppn_jenis_penyerahan: "" | "BKP_DN" | "JKP_Luar_Pabean" | "Impor" | "Ekspor" | "Mixed";
  ppn_objek_sengketa: "" | "DPP" | "PM" | "DPP_dan_PM" | "Formal";
  ppn_notes: string;
};

export type ExtractionResult = {
  filename: string;
  documentType: string;
  putusanNumber: string;
  putusanYear: string;
  courtPanel: string;
  judgeNames: string[];
  clerkName: string;
  procedureType: string;
  examinationLevel: string;
  caseFileNumber: string;
  decisionDate: string;
  hearingDate: string;
  taxpayerName: string;
  taxpayerNpwp: string;
  taxpayerAddress: string;
  representativeName: string;
  legalCounselName: string;
  legalCounselLicense: string;
  appelleeName: string;
  djpUnit: string;
  taxType: string;
  taxPeriod: string;
  skpNumber: string;
  djpDecisionNumber: string;
  issueType: string;
  issueSubtype: string;
  correctionAmount: string;
  correctionObject: string;
  correctionReason: string;
  taxpayerRebuttal: string;
  taxAuthorityPosition: string;
  taxpayerPosition: string;
  evidence: string[];
  legalReferences: string[];
  courtReasoning: string;
  outcome: string;
  summary: string;
  ppnComponents: PpnComponents;
  extractedAt: string;
  llmStatus: {
    used: boolean;
    model: string;
    message: string;
  };
};

export function emptyPpnComponents(): PpnComponents {
  return {
    ppn_dpp: "",
    ppn_pajak_keluaran: "",
    ppn_pajak_masukan: "",
    ppn_kb_lb: "",
    ppn_kompensasi: "",
    ppn_masih_harus_bayar: "",
    ppn_dpp_djp: "",
    ppn_pm_djp: "",
    ppn_sanksi_pasal_13: "",
    ppn_koreksi_dpp: "",
    ppn_koreksi_pm: "",
    ppn_tarif: "",
    ppn_is_lb: null,
    ppn_jenis_penyerahan: "",
    ppn_objek_sengketa: "",
    ppn_notes: ""
  };
}

export function extractionToAnalyzeInput(extraction: ExtractionResult, language: "id" | "en"): AnalyzeInput {
  return {
    taxpayerName: extraction.taxpayerName,
    taxType: extraction.taxType || (language === "en" ? "VAT" : "PPN"),
    issueType: extraction.issueType || extraction.issueSubtype || (language === "en" ? "VAT dispute" : "Sengketa PPN"),
    stage: extraction.documentType?.toLowerCase().includes("banding") ? (language === "en" ? "Appeal" : "Banding") : language === "en" ? "Appeal" : "Banding",
    correctionAmount: extraction.correctionAmount,
    taxAuthorityPosition: extraction.taxAuthorityPosition || extraction.correctionReason,
    taxpayerPosition: extraction.taxpayerPosition || extraction.taxpayerRebuttal,
    evidence: extraction.evidence || [],
    language
  };
}

function normalizeExtraction(raw: Partial<ExtractionResult>, filename: string): ExtractionResult {
  const evidence = Array.isArray(raw.evidence) ? raw.evidence.map(String).filter(Boolean).slice(0, 12) : [];
  const legalReferences = Array.isArray(raw.legalReferences) ? raw.legalReferences.map(String).filter(Boolean).slice(0, 12) : [];
  const judgeNames = Array.isArray(raw.judgeNames) ? raw.judgeNames.map(String).filter(Boolean).slice(0, 8) : [];
  const ppnRaw: Partial<PpnComponents> = raw.ppnComponents && typeof raw.ppnComponents === "object" ? raw.ppnComponents : {};
  const ppnBase = emptyPpnComponents();
  const ppnSupplyTypes = new Set(["BKP_DN", "JKP_Luar_Pabean", "Impor", "Ekspor", "Mixed"]);
  const ppnObjectTypes = new Set(["DPP", "PM", "DPP_dan_PM", "Formal"]);
  const ppnComponents: PpnComponents = {
    ...ppnBase,
    ppn_dpp: String(ppnRaw.ppn_dpp || ""),
    ppn_pajak_keluaran: String(ppnRaw.ppn_pajak_keluaran || ""),
    ppn_pajak_masukan: String(ppnRaw.ppn_pajak_masukan || ""),
    ppn_kb_lb: String(ppnRaw.ppn_kb_lb || ""),
    ppn_kompensasi: String(ppnRaw.ppn_kompensasi || ""),
    ppn_masih_harus_bayar: String(ppnRaw.ppn_masih_harus_bayar || ""),
    ppn_dpp_djp: String(ppnRaw.ppn_dpp_djp || ""),
    ppn_pm_djp: String(ppnRaw.ppn_pm_djp || ""),
    ppn_sanksi_pasal_13: String(ppnRaw.ppn_sanksi_pasal_13 || ""),
    ppn_koreksi_dpp: String(ppnRaw.ppn_koreksi_dpp || ""),
    ppn_koreksi_pm: String(ppnRaw.ppn_koreksi_pm || ""),
    ppn_tarif: String(ppnRaw.ppn_tarif || ""),
    ppn_is_lb: typeof ppnRaw.ppn_is_lb === "boolean" ? ppnRaw.ppn_is_lb : null,
    ppn_jenis_penyerahan: ppnSupplyTypes.has(String(ppnRaw.ppn_jenis_penyerahan)) ? (String(ppnRaw.ppn_jenis_penyerahan) as PpnComponents["ppn_jenis_penyerahan"]) : "",
    ppn_objek_sengketa: ppnObjectTypes.has(String(ppnRaw.ppn_objek_sengketa)) ? (String(ppnRaw.ppn_objek_sengketa) as PpnComponents["ppn_objek_sengketa"]) : "",
    ppn_notes: String(ppnRaw.ppn_notes || "")
  };
  return {
    filename,
    documentType: String(raw.documentType || ""),
    putusanNumber: String(raw.putusanNumber || ""),
    putusanYear: String(raw.putusanYear || ""),
    courtPanel: String(raw.courtPanel || ""),
    judgeNames,
    clerkName: String(raw.clerkName || ""),
    procedureType: String(raw.procedureType || ""),
    examinationLevel: String(raw.examinationLevel || ""),
    caseFileNumber: String(raw.caseFileNumber || ""),
    decisionDate: String(raw.decisionDate || ""),
    hearingDate: String(raw.hearingDate || ""),
    taxpayerName: String(raw.taxpayerName || ""),
    taxpayerNpwp: String(raw.taxpayerNpwp || ""),
    taxpayerAddress: String(raw.taxpayerAddress || ""),
    representativeName: String(raw.representativeName || ""),
    legalCounselName: String(raw.legalCounselName || ""),
    legalCounselLicense: String(raw.legalCounselLicense || ""),
    appelleeName: String(raw.appelleeName || ""),
    djpUnit: String(raw.djpUnit || ""),
    taxType: String(raw.taxType || ""),
    taxPeriod: String(raw.taxPeriod || ""),
    skpNumber: String(raw.skpNumber || ""),
    djpDecisionNumber: String(raw.djpDecisionNumber || ""),
    issueType: String(raw.issueType || ""),
    issueSubtype: String(raw.issueSubtype || ""),
    correctionAmount: String(raw.correctionAmount || ""),
    correctionObject: String(raw.correctionObject || ""),
    correctionReason: String(raw.correctionReason || ""),
    taxpayerRebuttal: String(raw.taxpayerRebuttal || ""),
    taxAuthorityPosition: String(raw.taxAuthorityPosition || raw.correctionReason || ""),
    taxpayerPosition: String(raw.taxpayerPosition || raw.taxpayerRebuttal || ""),
    evidence,
    legalReferences,
    courtReasoning: String(raw.courtReasoning || ""),
    outcome: String(raw.outcome || ""),
    summary: String(raw.summary || ""),
    ppnComponents,
    extractedAt: new Date().toISOString(),
    llmStatus: {
      used: true,
      model: configuredModel(),
      message: "PDF extracted with LLM"
    }
  };
}

export async function extractPdfWithLlm(file: File, language: "id" | "en"): Promise<ExtractionResult> {
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength > 4 * 1024 * 1024) {
    throw new Error(language === "en" ? "PDF is too large for this prototype upload. Please use a file below 4 MB." : "PDF terlalu besar untuk upload prototype ini. Gunakan file di bawah 4 MB.");
  }
  const fileData = `data:application/pdf;base64,${bytes.toString("base64")}`;
  const system =
    language === "en"
      ? "You are an expert Indonesian tax dispute document extraction engine. Extract only what is supported by the PDF. Return JSON only."
      : "Anda adalah mesin ekstraksi dokumen sengketa pajak Indonesia. Ekstrak hanya data yang didukung PDF. Kembalikan JSON saja.";
  const prompt =
    language === "en"
      ? `Extract structured information from this tax dispute PDF. Return JSON with exactly these keys:
documentType, putusanNumber, putusanYear, courtPanel, judgeNames, clerkName, procedureType, examinationLevel, caseFileNumber, decisionDate, hearingDate, taxpayerName, taxpayerNpwp, taxpayerAddress, representativeName, legalCounselName, legalCounselLicense, appelleeName, djpUnit, taxType, taxPeriod, skpNumber, djpDecisionNumber, issueType, issueSubtype, correctionAmount, correctionObject, correctionReason, taxpayerRebuttal, taxAuthorityPosition, taxpayerPosition, evidence, legalReferences, courtReasoning, outcome, summary, ppnComponents.
ppnComponents must be an object with exactly these keys: ppn_dpp, ppn_pajak_keluaran, ppn_pajak_masukan, ppn_kb_lb, ppn_kompensasi, ppn_masih_harus_bayar, ppn_dpp_djp, ppn_pm_djp, ppn_sanksi_pasal_13, ppn_koreksi_dpp, ppn_koreksi_pm, ppn_tarif, ppn_is_lb, ppn_jenis_penyerahan, ppn_objek_sengketa, ppn_notes.
For VAT/PPN cases only, extract these VAT components from tables and reasoning. ppn_dpp is DPP according to the Tax Court; ppn_pajak_keluaran is output VAT or DPP x tariff; ppn_pajak_masukan is input VAT/tax credit according to the Tax Court; ppn_kb_lb is signed VAT payable/refund where positive means underpayment and negative means overpayment/refund; ppn_kompensasi is compensation to the next period; ppn_masih_harus_bayar is final amount payable after the decision; ppn_dpp_djp and ppn_pm_djp are the DGT/tax authority positions before decision; ppn_sanksi_pasal_13 is Article 13 administrative sanction; ppn_koreksi_dpp and ppn_koreksi_pm are disputed DPP/input tax corrections. ppn_jenis_penyerahan must be one of BKP_DN, JKP_Luar_Pabean, Impor, Ekspor, Mixed, or empty. ppn_objek_sengketa must be one of DPP, PM, DPP_dan_PM, Formal, or empty. ppn_is_lb is true for refund/overpayment cases, false for underpayment cases, or null if unclear.
Use English for summaries, but keep official names/numbers in source language. judgeNames, evidence, and legalReferences must be arrays. If a field is unavailable, use an empty string, empty array, or null for ppn_is_lb.`
      : `Ekstrak informasi terstruktur dari PDF sengketa pajak ini. Kembalikan JSON dengan key persis berikut:
documentType, putusanNumber, putusanYear, courtPanel, judgeNames, clerkName, procedureType, examinationLevel, caseFileNumber, decisionDate, hearingDate, taxpayerName, taxpayerNpwp, taxpayerAddress, representativeName, legalCounselName, legalCounselLicense, appelleeName, djpUnit, taxType, taxPeriod, skpNumber, djpDecisionNumber, issueType, issueSubtype, correctionAmount, correctionObject, correctionReason, taxpayerRebuttal, taxAuthorityPosition, taxpayerPosition, evidence, legalReferences, courtReasoning, outcome, summary, ppnComponents.
ppnComponents harus object dengan key persis: ppn_dpp, ppn_pajak_keluaran, ppn_pajak_masukan, ppn_kb_lb, ppn_kompensasi, ppn_masih_harus_bayar, ppn_dpp_djp, ppn_pm_djp, ppn_sanksi_pasal_13, ppn_koreksi_dpp, ppn_koreksi_pm, ppn_tarif, ppn_is_lb, ppn_jenis_penyerahan, ppn_objek_sengketa, ppn_notes.
Khusus kasus PPN, ekstrak komponen ini dari tabel dan pertimbangan. ppn_dpp adalah DPP menurut Pengadilan Pajak; ppn_pajak_keluaran adalah Pajak Keluaran atau DPP x tarif; ppn_pajak_masukan adalah Pajak Masukan/Kredit Pajak menurut Pengadilan Pajak; ppn_kb_lb adalah signed value PPN Kurang/Lebih Bayar dengan nilai positif = Kurang Bayar dan negatif = Lebih Bayar; ppn_kompensasi adalah kompensasi ke masa berikutnya; ppn_masih_harus_bayar adalah total final yang masih harus dibayar setelah putusan; ppn_dpp_djp dan ppn_pm_djp adalah posisi DJP/Terbanding sebelum putusan; ppn_sanksi_pasal_13 adalah sanksi administrasi Pasal 13; ppn_koreksi_dpp dan ppn_koreksi_pm adalah nilai koreksi sengketa DPP/Pajak Masukan. ppn_jenis_penyerahan wajib salah satu BKP_DN, JKP_Luar_Pabean, Impor, Ekspor, Mixed, atau kosong. ppn_objek_sengketa wajib salah satu DPP, PM, DPP_dan_PM, Formal, atau kosong. ppn_is_lb true untuk lebih bayar/restitusi, false untuk kurang bayar, null jika tidak jelas.
Gunakan Bahasa Indonesia untuk ringkasan, tetapi pertahankan nama/nomor resmi sesuai sumber. judgeNames, evidence, dan legalReferences harus array. Jika field tidak tersedia, isi string kosong, array kosong, atau null untuk ppn_is_lb.`;
  const text = await callOpenAIWithPdf(prompt, system, { filename: file.name, fileData });
  const parsed = extractJsonObject(text) as Partial<ExtractionResult>;
  return normalizeExtraction(parsed, file.name);
}
