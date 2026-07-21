import type { AnalyzeInput } from "./analyze";
import { DEFAULT_LLM_MODEL_CHOICE, type LlmModelChoice } from "./model-options";
import { callOpenAIWithPdf, configuredModel, extractJsonObject } from "./openai";
import { normalizeExtractedText, structuredTextItems } from "./text-presentation";

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

function normalizeExtraction(raw: Partial<ExtractionResult>, filename: string, modelChoice: LlmModelChoice = DEFAULT_LLM_MODEL_CHOICE): ExtractionResult {
  const text = (value: unknown) => normalizeExtractedText(value);
  const evidence = structuredTextItems(raw.evidence, 24);
  const legalReferences = structuredTextItems(raw.legalReferences, 24);
  const judgeNames = structuredTextItems(raw.judgeNames, 8);
  const ppnRaw: Partial<PpnComponents> = raw.ppnComponents && typeof raw.ppnComponents === "object" ? raw.ppnComponents : {};
  const ppnBase = emptyPpnComponents();
  const ppnSupplyTypes = new Set(["BKP_DN", "JKP_Luar_Pabean", "Impor", "Ekspor", "Mixed"]);
  const ppnObjectTypes = new Set(["DPP", "PM", "DPP_dan_PM", "Formal"]);
  const ppnComponents: PpnComponents = {
    ...ppnBase,
    ppn_dpp: text(ppnRaw.ppn_dpp),
    ppn_pajak_keluaran: text(ppnRaw.ppn_pajak_keluaran),
    ppn_pajak_masukan: text(ppnRaw.ppn_pajak_masukan),
    ppn_kb_lb: text(ppnRaw.ppn_kb_lb),
    ppn_kompensasi: text(ppnRaw.ppn_kompensasi),
    ppn_masih_harus_bayar: text(ppnRaw.ppn_masih_harus_bayar),
    ppn_dpp_djp: text(ppnRaw.ppn_dpp_djp),
    ppn_pm_djp: text(ppnRaw.ppn_pm_djp),
    ppn_sanksi_pasal_13: text(ppnRaw.ppn_sanksi_pasal_13),
    ppn_koreksi_dpp: text(ppnRaw.ppn_koreksi_dpp),
    ppn_koreksi_pm: text(ppnRaw.ppn_koreksi_pm),
    ppn_tarif: text(ppnRaw.ppn_tarif),
    ppn_is_lb: typeof ppnRaw.ppn_is_lb === "boolean" ? ppnRaw.ppn_is_lb : null,
    ppn_jenis_penyerahan: ppnSupplyTypes.has(String(ppnRaw.ppn_jenis_penyerahan)) ? (String(ppnRaw.ppn_jenis_penyerahan) as PpnComponents["ppn_jenis_penyerahan"]) : "",
    ppn_objek_sengketa: ppnObjectTypes.has(String(ppnRaw.ppn_objek_sengketa)) ? (String(ppnRaw.ppn_objek_sengketa) as PpnComponents["ppn_objek_sengketa"]) : "",
    ppn_notes: text(ppnRaw.ppn_notes)
  };
  return {
    filename,
    documentType: text(raw.documentType),
    putusanNumber: text(raw.putusanNumber),
    putusanYear: text(raw.putusanYear),
    courtPanel: text(raw.courtPanel),
    judgeNames,
    clerkName: text(raw.clerkName),
    procedureType: text(raw.procedureType),
    examinationLevel: text(raw.examinationLevel),
    caseFileNumber: text(raw.caseFileNumber),
    decisionDate: text(raw.decisionDate),
    hearingDate: text(raw.hearingDate),
    taxpayerName: text(raw.taxpayerName),
    taxpayerNpwp: text(raw.taxpayerNpwp),
    taxpayerAddress: text(raw.taxpayerAddress),
    representativeName: text(raw.representativeName),
    legalCounselName: text(raw.legalCounselName),
    legalCounselLicense: text(raw.legalCounselLicense),
    appelleeName: text(raw.appelleeName),
    djpUnit: text(raw.djpUnit),
    taxType: text(raw.taxType),
    taxPeriod: text(raw.taxPeriod),
    skpNumber: text(raw.skpNumber),
    djpDecisionNumber: text(raw.djpDecisionNumber),
    issueType: text(raw.issueType),
    issueSubtype: text(raw.issueSubtype),
    correctionAmount: text(raw.correctionAmount),
    correctionObject: text(raw.correctionObject),
    correctionReason: text(raw.correctionReason),
    taxpayerRebuttal: text(raw.taxpayerRebuttal),
    taxAuthorityPosition: text(raw.taxAuthorityPosition || raw.correctionReason),
    taxpayerPosition: text(raw.taxpayerPosition || raw.taxpayerRebuttal),
    evidence,
    legalReferences,
    courtReasoning: text(raw.courtReasoning),
    outcome: text(raw.outcome),
    summary: text(raw.summary),
    ppnComponents,
    extractedAt: new Date().toISOString(),
    llmStatus: {
      used: true,
      model: configuredModel(modelChoice),
      message: "PDF extracted with LLM"
    }
  };
}

export async function extractPdfWithLlm(
  file: File,
  language: "id" | "en",
  modelChoice: LlmModelChoice = DEFAULT_LLM_MODEL_CHOICE,
  managedPrompt?: { system?: string; instruction?: string }
): Promise<ExtractionResult> {
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength > 4 * 1024 * 1024) {
    throw new Error(language === "en" ? "PDF is too large for this upload. Please use a file below 4 MB." : "PDF terlalu besar untuk upload ini. Gunakan file di bawah 4 MB.");
  }
  const fileData = `data:application/pdf;base64,${bytes.toString("base64")}`;
  const defaultSystem =
    language === "en"
      ? "You are an expert Indonesian tax dispute document extraction engine. Extract only what is supported by the PDF. Return JSON only."
      : "Anda adalah mesin ekstraksi dokumen sengketa pajak Indonesia. Ekstrak hanya data yang didukung PDF. Kembalikan JSON saja.";
  const system = managedPrompt?.system?.trim() || defaultSystem;
  const basePrompt =
    language === "en"
      ? `Extract structured information from this tax dispute PDF. Return JSON with exactly these keys:
documentType, putusanNumber, putusanYear, courtPanel, judgeNames, clerkName, procedureType, examinationLevel, caseFileNumber, decisionDate, hearingDate, taxpayerName, taxpayerNpwp, taxpayerAddress, representativeName, legalCounselName, legalCounselLicense, appelleeName, djpUnit, taxType, taxPeriod, skpNumber, djpDecisionNumber, issueType, issueSubtype, correctionAmount, correctionObject, correctionReason, taxpayerRebuttal, taxAuthorityPosition, taxpayerPosition, evidence, legalReferences, courtReasoning, outcome, summary, ppnComponents.
ppnComponents must be an object with exactly these keys: ppn_dpp, ppn_pajak_keluaran, ppn_pajak_masukan, ppn_kb_lb, ppn_kompensasi, ppn_masih_harus_bayar, ppn_dpp_djp, ppn_pm_djp, ppn_sanksi_pasal_13, ppn_koreksi_dpp, ppn_koreksi_pm, ppn_tarif, ppn_is_lb, ppn_jenis_penyerahan, ppn_objek_sengketa, ppn_notes.
For VAT/PPN cases only, extract these VAT components from tables and reasoning. ppn_dpp is DPP according to the Tax Court; ppn_pajak_keluaran is output VAT or DPP x tariff; ppn_pajak_masukan is input VAT/tax credit according to the Tax Court; ppn_kb_lb is signed VAT payable/refund where positive means underpayment and negative means overpayment/refund; ppn_kompensasi is compensation to the next period; ppn_masih_harus_bayar is final amount payable after the decision; ppn_dpp_djp and ppn_pm_djp are the DGT/tax authority positions before decision; ppn_sanksi_pasal_13 is Article 13 administrative sanction; ppn_koreksi_dpp and ppn_koreksi_pm are disputed DPP/input tax corrections. ppn_jenis_penyerahan must be one of BKP_DN, JKP_Luar_Pabean, Impor, Ekspor, Mixed, or empty. ppn_objek_sengketa must be one of DPP, PM, DPP_dan_PM, Formal, or empty. ppn_is_lb is true for refund/overpayment cases, false for underpayment cases, or null if unclear.
Use English for summaries, but keep official names/numbers in source language. Never mix Indonesian and English in the same narrative sentence. judgeNames, evidence, and legalReferences must be arrays with one complete, non-duplicated item per array entry; do not join lists with semicolons. For correctionReason, taxpayerRebuttal, taxAuthorityPosition, taxpayerPosition, courtReasoning, and summary, separate distinct propositions with newline characters so the UI can render them as bullets. Use clean punctuation and never copy OCR garbage or foreign-script characters that are not present in an official name.
For every VAT/PPN document, inspect calculation tables, appendices, and the court's final calculation before leaving ppnComponents empty. If a DPP, VAT amount, input/output VAT, correction, payable/refund, compensation, sanction, or VAT rate is printed anywhere, place it in the matching field and preserve the source-side label in ppn_notes. Do not invent a VAT value for a non-VAT case. If a field is unavailable, use an empty string, empty array, or null for ppn_is_lb.`
      : `Ekstrak informasi terstruktur dari PDF sengketa pajak ini. Kembalikan JSON dengan key persis berikut:
documentType, putusanNumber, putusanYear, courtPanel, judgeNames, clerkName, procedureType, examinationLevel, caseFileNumber, decisionDate, hearingDate, taxpayerName, taxpayerNpwp, taxpayerAddress, representativeName, legalCounselName, legalCounselLicense, appelleeName, djpUnit, taxType, taxPeriod, skpNumber, djpDecisionNumber, issueType, issueSubtype, correctionAmount, correctionObject, correctionReason, taxpayerRebuttal, taxAuthorityPosition, taxpayerPosition, evidence, legalReferences, courtReasoning, outcome, summary, ppnComponents.
ppnComponents harus object dengan key persis: ppn_dpp, ppn_pajak_keluaran, ppn_pajak_masukan, ppn_kb_lb, ppn_kompensasi, ppn_masih_harus_bayar, ppn_dpp_djp, ppn_pm_djp, ppn_sanksi_pasal_13, ppn_koreksi_dpp, ppn_koreksi_pm, ppn_tarif, ppn_is_lb, ppn_jenis_penyerahan, ppn_objek_sengketa, ppn_notes.
Khusus kasus PPN, ekstrak komponen ini dari tabel dan pertimbangan. ppn_dpp adalah DPP menurut Pengadilan Pajak; ppn_pajak_keluaran adalah Pajak Keluaran atau DPP x tarif; ppn_pajak_masukan adalah Pajak Masukan/Kredit Pajak menurut Pengadilan Pajak; ppn_kb_lb adalah signed value PPN Kurang/Lebih Bayar dengan nilai positif = Kurang Bayar dan negatif = Lebih Bayar; ppn_kompensasi adalah kompensasi ke masa berikutnya; ppn_masih_harus_bayar adalah total final yang masih harus dibayar setelah putusan; ppn_dpp_djp dan ppn_pm_djp adalah posisi DJP/Terbanding sebelum putusan; ppn_sanksi_pasal_13 adalah sanksi administrasi Pasal 13; ppn_koreksi_dpp dan ppn_koreksi_pm adalah nilai koreksi sengketa DPP/Pajak Masukan. ppn_jenis_penyerahan wajib salah satu BKP_DN, JKP_Luar_Pabean, Impor, Ekspor, Mixed, atau kosong. ppn_objek_sengketa wajib salah satu DPP, PM, DPP_dan_PM, Formal, atau kosong. ppn_is_lb true untuk lebih bayar/restitusi, false untuk kurang bayar, null jika tidak jelas.
Gunakan Bahasa Indonesia untuk ringkasan, tetapi pertahankan nama/nomor resmi sesuai sumber. Jangan mencampur Bahasa Indonesia dan Inggris dalam satu kalimat naratif. judgeNames, evidence, dan legalReferences harus array dengan satu item lengkap dan tidak duplikat per elemen; jangan gabungkan daftar memakai titik koma. Untuk correctionReason, taxpayerRebuttal, taxAuthorityPosition, taxpayerPosition, courtReasoning, dan summary, pisahkan setiap proposisi berbeda dengan karakter newline agar UI dapat menyajikannya sebagai bullet. Gunakan tanda baca rapi dan jangan salin karakter OCR asing yang tidak terdapat pada nama resmi.
Untuk setiap dokumen PPN, periksa tabel perhitungan, lampiran, dan perhitungan final Majelis sebelum membiarkan ppnComponents kosong. Jika DPP, nilai PPN, Pajak Masukan/Keluaran, koreksi, kurang/lebih bayar, kompensasi, sanksi, atau tarif PPN tercetak di bagian mana pun, masukkan ke field yang sesuai dan pertahankan label sumber pada ppn_notes. Jangan mengarang nilai PPN untuk perkara non-PPN. Jika field tidak tersedia, isi string kosong, array kosong, atau null untuk ppn_is_lb.`;
  const prompt = managedPrompt?.instruction?.trim() ? `${basePrompt}\n\nAdditional managed instruction:\n${managedPrompt.instruction.trim()}` : basePrompt;
  const text = await callOpenAIWithPdf(prompt, system, { filename: file.name, fileData }, modelChoice);
  const parsed = extractJsonObject(text) as Partial<ExtractionResult>;
  return normalizeExtraction(parsed, file.name, modelChoice);
}
