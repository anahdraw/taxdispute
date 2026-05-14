import { comparableDecisions, regulations } from "./mock-data";

export type AnalyzeInput = {
  taxpayerName: string;
  taxType: string;
  issueType: string;
  stage: string;
  correctionAmount: string;
  taxAuthorityPosition: string;
  taxpayerPosition: string;
  evidence: string[];
  language: "id" | "en";
};

export function buildAnalysis(input: AnalyzeInput) {
  const evidenceScore = Math.min(100, 36 + input.evidence.length * 10);
  const issueBoost = input.issueType.toLowerCase().includes("vat") || input.issueType.toLowerCase().includes("ppn") ? 12 : 4;
  const score = Math.min(92, Math.round((44 + issueBoost + evidenceScore * 0.32) * 10) / 10);
  const confidence = input.evidence.length >= 4 ? "high" : input.evidence.length >= 2 ? "medium" : "low";
  const indication =
    input.language === "en"
      ? score >= 70
        ? "Potentially partially granted with a strong evidence strategy"
        : "Evidence strengthening required before submission"
      : score >= 70
        ? "Berpeluang dikabulkan sebagian dengan strategi bukti yang kuat"
        : "Perlu penguatan bukti sebelum diajukan";

  const topCases = comparableDecisions.slice(0, 2);
  const evidenceGaps = [
    input.evidence.includes("Payment evidence") || input.evidence.includes("Bukti pembayaran") ? null : input.language === "en" ? "Payment evidence" : "Bukti pembayaran",
    input.evidence.includes("VAT return") || input.evidence.includes("SPT Masa PPN") ? null : input.language === "en" ? "VAT return reconciliation" : "Rekonsiliasi SPT Masa PPN",
    input.evidence.includes("Counterparty confirmation") || input.evidence.includes("Konfirmasi Lawan Transaksi") ? null : input.language === "en" ? "Counterparty confirmation" : "Konfirmasi lawan transaksi"
  ].filter(Boolean) as string[];

  const recommendation =
    input.language === "en"
      ? [
          `Initial recommendation for ${input.taxpayerName || "the taxpayer"}`,
          `The dispute should be framed around ${input.issueType || "the main VAT issue"} at the ${input.stage || "appeal"} stage.`,
          "The taxpayer position should be supported by a clear chronology, amount reconciliation, and evidence mapping against each correction reason.",
          `Use ${topCases[0].number} mainly as a risk comparator and ${topCases[1].number} as a supporting comparator where the facts and evidence chain are genuinely similar.`,
          "Before filing, complete the evidence gaps and verify the VAT legal basis against the relevant tax period."
        ].join("\n\n")
      : [
          `Rekomendasi awal untuk ${input.taxpayerName || "Wajib Pajak"}`,
          `Sengketa sebaiknya disusun di sekitar ${input.issueType || "isu PPN utama"} pada tahap ${input.stage || "banding"}.`,
          "Posisi WP perlu didukung kronologi, rekonsiliasi angka, dan pemetaan bukti terhadap setiap alasan koreksi.",
          `Gunakan ${topCases[0].number} terutama sebagai pembanding risiko dan ${topCases[1].number} sebagai pembanding pendukung apabila fakta dan rantai buktinya benar-benar mirip.`,
          "Sebelum pengajuan, lengkapi gap bukti dan cocokkan dasar hukum PPN dengan masa pajak yang relevan."
        ].join("\n\n");

  return {
    score,
    confidence,
    evidenceScore,
    indication,
    topCases,
    evidenceGaps,
    regulations: regulations.slice(0, 3),
    recommendation
  };
}
