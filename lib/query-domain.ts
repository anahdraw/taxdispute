export type QueryDomainDecision = {
  inScope: boolean;
  score: number;
  signals: string[];
  exclusions: string[];
  reason: string;
};

const STRONG_TAX_SIGNALS: Array<[string, RegExp]> = [
  ["tax", /\b(?:pajak|tax|perpajakan)\b/i],
  ["income-tax", /\b(?:pph|pajak\s+penghasilan|income\s+tax)\b/i],
  ["vat", /\b(?:ppn|ppnbm|vat|pajak\s+pertambahan\s+nilai|pajak\s+masukan|faktur\s+pajak|bkp|jkp|dpp)\b/i],
  ["tax-administration", /\b(?:djp|npwp|spt|skp(?:kb|kbt)?|stp|kup|coretax|pemotong(?:an)?|pemungut(?:an)?|kredit\s+pajak)\b/i],
  ["tax-dispute", /\b(?:pengadilan\s+pajak|sengketa\s+pajak|keberatan\s+pajak|banding\s+pajak|putusan\s+pajak|pemohon\s+banding|terbanding)\b/i],
  ["international-tax", /\b(?:transfer[-\s]+pricing|harga\s+transfer|p3b|tax\s+treaty|map|advance\s+pricing\s+agreement|corresponding\s+adjustment|hubungan\s+istimewa|kewajaran\s+dan\s+kelaziman|arm'?s[-\s]+length)\b/i],
  ["tax-subject", /\b(?:natura\s+dan\s+kenikmatan|bea\s+meterai|meterai\s+elektronik|pajak\s+daerah|retribusi\s+daerah)\b/i],
  ["tax-instrument-name", /\b(?:pmk|peraturan\s+menteri\s+keuangan|undang-undang\s+pajak)\b/i],
  ["tax-instrument", /\b(?:uu|pp|pmk|kmk|per|kep|se)\s*(?:no\.?|nomor)?\s*\d+/i],
  ["tax-procedure", /\b(?:masa\s+pajak|tahun\s+pajak|pemeriksaan\s+pajak|penagihan\s+pajak|surat\s+paksa|bukti\s+permulaan)\b/i]
];

const WEAK_TAX_SIGNALS: Array<[string, RegExp]> = [
  ["rate", /\b(?:tarif|rate|persen|%)\b/i],
  ["calculation", /\b(?:hitung|menghitung|perhitungan|calculate|calculation|rumus)\b/i],
  ["legal-status", /\b(?:berlaku|dicabut|diubah|efektif|current|in\s+force|revoked|amended)\b/i],
  ["legal-provision", /\b(?:pasal|ayat|article|paragraph)\b/i]
];

const OUT_OF_SCOPE: Array<[string, RegExp]> = [
  ["employment-law", /\b(?:upah\s+minimum|ump|umk|pemutusan\s+hubungan\s+kerja|phk|ketenagakerjaan|pesangon)\b/i],
  ["family-law", /\b(?:perceraian|cerai|divorce|hak\s+asuh|perkawinan)\b/i],
  ["general-criminal-law", /\b(?:pidana\s+umum|pencurian|penganiayaan|criminal\s+procedure)\b/i],
  ["weather", /\b(?:cuaca|weather|prakiraan\s+hujan)\b/i],
  ["cooking", /\b(?:resep|recipe|masak|bahan\s+makanan)\b/i],
  ["medical", /\b(?:diagnosis|obat|penyakit|medical\s+advice)\b/i],
  // Classification itself requires a dedicated customs nomenclature corpus.
  // A tax dispute mentioning an HS code is still admitted by the strong
  // tax-dispute signals above.
  ["customs-classification", /\b(?:hs\s*code|kode\s*hs|klasifikasi\s+hs|harmonized\s+system)\b/i]
];

export function assessTaxQueryDomain(question: string): QueryDomainDecision {
  const value = String(question || "").normalize("NFKC").trim();
  const signals: string[] = [];
  const exclusions: string[] = [];
  let score = 0;

  for (const [name, pattern] of STRONG_TAX_SIGNALS) {
    if (pattern.test(value)) {
      signals.push(name);
      score += 35;
    }
  }
  for (const [name, pattern] of WEAK_TAX_SIGNALS) {
    if (pattern.test(value)) {
      signals.push(name);
      score += 8;
    }
  }
  for (const [name, pattern] of OUT_OF_SCOPE) {
    if (pattern.test(value)) {
      exclusions.push(name);
      score -= 35;
    }
  }

  const hasStrongTaxSignal = signals.some((signal) => STRONG_TAX_SIGNALS.some(([name]) => name === signal));
  // A specialised out-of-scope topic is allowed only when the user clearly
  // frames it as a tax dispute or tax-law question.
  const disputeOverride = signals.includes("tax-dispute") || signals.includes("tax");
  const blockingExclusion = exclusions.length > 0 && !disputeOverride;
  const inScope = value.length >= 3 && hasStrongTaxSignal && !blockingExclusion && score >= 25;

  return {
    inScope,
    score: Math.max(0, Math.min(100, score)),
    signals: [...new Set(signals)],
    exclusions: [...new Set(exclusions)],
    reason: inScope
      ? "Pertanyaan memiliki sinyal perpajakan yang cukup spesifik."
      : blockingExclusion
        ? "Pertanyaan memerlukan corpus khusus di luar cakupan chatbot perpajakan ini."
        : "Pertanyaan belum memiliki konteks perpajakan yang cukup spesifik."
  };
}
