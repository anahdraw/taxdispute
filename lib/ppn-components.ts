import type { ExtractionResult, PpnComponents } from "./extraction";

export type PpnDisplayRow = {
  label: string;
  key: keyof PpnComponents;
  value: string;
  hint: string;
};

export type PpnFormulaRow = {
  formula: string;
  result: string;
  basis: string;
};

const COMPONENTS: Array<{ key: keyof PpnComponents; id: string; en: string; hintId: string; hintEn: string }> = [
  { key: "ppn_dpp", id: "DPP menurut Pengadilan Pajak", en: "Tax Court VAT base", hintId: "Nilai final DPP setelah putusan", hintEn: "Final VAT base after decision" },
  { key: "ppn_pajak_keluaran", id: "Pajak Keluaran", en: "Output VAT", hintId: "PK = DPP x tarif", hintEn: "Output VAT = VAT base x rate" },
  { key: "ppn_pajak_masukan", id: "Pajak Masukan / Kredit Pajak", en: "Input VAT / tax credit", hintId: "PM/Kredit Pajak menurut putusan", hintEn: "Input VAT/tax credit after decision" },
  { key: "ppn_kb_lb", id: "PPN Kurang / Lebih Bayar", en: "VAT payable / overpayment", hintId: "Positif = kurang bayar, negatif = lebih bayar", hintEn: "Positive = payable, negative = overpayment" },
  { key: "ppn_kompensasi", id: "Kompensasi masa berikutnya", en: "Carry-forward compensation", hintId: "Kompensasi ke masa pajak berikutnya", hintEn: "Carry-forward to the following tax period" },
  { key: "ppn_masih_harus_bayar", id: "Masih harus dibayar", en: "Final amount payable", hintId: "Total final setelah putusan", hintEn: "Final payable amount after decision" },
  { key: "ppn_dpp_djp", id: "DPP menurut DJP", en: "DGT VAT base", hintId: "Posisi DJP sebelum putusan", hintEn: "DGT position before decision" },
  { key: "ppn_pm_djp", id: "PM menurut DJP", en: "DGT input VAT", hintId: "Pajak Masukan menurut DJP", hintEn: "DGT input VAT position" },
  { key: "ppn_sanksi_pasal_13", id: "Sanksi administrasi Pasal 13", en: "Article 13 administrative sanction", hintId: "Sanksi Pasal 13 KUP jika muncul", hintEn: "Article 13 sanction if stated" },
  { key: "ppn_koreksi_dpp", id: "Koreksi DPP", en: "VAT base correction", hintId: "Nilai koreksi atas DPP", hintEn: "VAT base correction amount" },
  { key: "ppn_koreksi_pm", id: "Koreksi Pajak Masukan", en: "Input VAT correction", hintId: "Nilai koreksi atas PM/Kredit Pajak", hintEn: "Input VAT correction amount" }
];

export function hasPpnComponentData(extraction?: ExtractionResult | null) {
  const ppn = extraction?.ppnComponents;
  if (!ppn) return false;
  return Object.entries(ppn).some(([key, value]) => {
    if (key === "ppn_is_lb") return typeof value === "boolean";
    return String(value || "").trim().length > 0;
  });
}

export function ppnComponentRows(ppn: PpnComponents, language: "id" | "en"): PpnDisplayRow[] {
  return COMPONENTS.map((item) => ({
    label: language === "en" ? item.en : item.id,
    key: item.key,
    value: formatPpnMoneyValue(ppn[item.key]),
    hint: language === "en" ? item.hintEn : item.hintId
  })).filter((row) => row.value);
}

export function ppnClassificationRows(ppn: PpnComponents, language: "id" | "en"): PpnDisplayRow[] {
  const isLb =
    ppn.ppn_is_lb === null
      ? ""
      : ppn.ppn_is_lb
        ? language === "en"
          ? "Overpayment / refund"
          : "Lebih Bayar / restitusi"
        : language === "en"
          ? "Underpayment"
          : "Kurang Bayar";
  const rows: PpnDisplayRow[] = [
    {
      label: language === "en" ? "Overpayment case?" : "Apakah kasus LB?",
      key: "ppn_is_lb",
      value: isLb,
      hint: language === "en" ? "Boolean classification from extracted decision" : "Klasifikasi boolean dari putusan"
    },
    {
      label: language === "en" ? "Disputed VAT supply type" : "Jenis penyerahan PPN disengketakan",
      key: "ppn_jenis_penyerahan",
      value: ppn.ppn_jenis_penyerahan,
      hint: "BKP_DN | JKP_Luar_Pabean | Impor | Ekspor | Mixed"
    },
    {
      label: language === "en" ? "VAT dispute object" : "Objek sengketa PPN",
      key: "ppn_objek_sengketa",
      value: ppn.ppn_objek_sengketa,
      hint: "DPP | PM | DPP_dan_PM | Formal"
    }
  ];
  return rows.filter((row) => row.value);
}

export function parseRupiah(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return null;
  const negative = /^-|\(\s*/.test(text);
  const normalized = text
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return negative && amount > 0 ? -amount : amount;
}

function parseRate(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return null;
  const number = Number(text.replace(/[^\d,.]/g, "").replace(",", "."));
  if (!Number.isFinite(number) || number <= 0) return null;
  return text.includes("%") || number > 1 ? number / 100 : number;
}

function formatRupiah(amount: number) {
  const rounded = Math.round(amount);
  const prefix = rounded < 0 ? "-Rp " : "Rp ";
  return `${prefix}${Math.abs(rounded).toLocaleString("id-ID")}`;
}

function formatPpnMoneyValue(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const amount = parseRupiah(raw);
  if (amount === null) return raw;
  return formatRupiah(amount);
}

export function ppnFormulaRows(ppn: PpnComponents, language: "id" | "en"): PpnFormulaRow[] {
  const dpp = parseRupiah(ppn.ppn_dpp);
  const extractedPk = parseRupiah(ppn.ppn_pajak_keluaran);
  const pm = parseRupiah(ppn.ppn_pajak_masukan);
  const rate = parseRate(ppn.ppn_tarif) ?? (dpp && extractedPk ? extractedPk / dpp : null);
  const calculatedPk = dpp && rate ? dpp * rate : null;
  const pkForKbLb = extractedPk ?? calculatedPk;
  const calculatedKbLb = pkForKbLb !== null && pm !== null ? pkForKbLb - pm : null;
  const kompensasi = parseRupiah(ppn.ppn_kompensasi);
  const calculatedPayable = calculatedKbLb !== null && calculatedKbLb > 0 ? Math.max(0, calculatedKbLb - Math.max(0, kompensasi || 0)) : null;

  return [
    {
      formula: "PK = DPP x tarif",
      result: calculatedPk === null ? "" : formatRupiah(calculatedPk),
      basis: rate === null ? "" : `${language === "en" ? "Rate" : "Tarif"} ${(rate * 100).toFixed(2).replace(/\.00$/, "")}%`
    },
    {
      formula: language === "en" ? "VAT payable/refund = PK - PM" : "PPN KB/LB = PK - PM",
      result: calculatedKbLb === null ? "" : formatRupiah(calculatedKbLb),
      basis: language === "en" ? "Positive = payable; negative = refund/overpayment" : "Positif = kurang bayar; negatif = lebih bayar"
    },
    {
      formula: language === "en" ? "Final payable = KB - compensation" : "Masih harus dibayar = KB - kompensasi",
      result: calculatedPayable === null ? "" : formatRupiah(calculatedPayable),
      basis: language === "en" ? "Indicative only; follows stated decision fields" : "Indikatif; mengikuti nilai yang tertera di putusan"
    }
  ].filter((row) => row.result);
}
