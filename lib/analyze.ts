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

export type AnalysisResult = ReturnType<typeof buildAnalysis>;

function hasEvidence(evidence: string[], keywords: string[]) {
  const joined = evidence.join(" | ").toLowerCase();
  return keywords.some((keyword) => joined.includes(keyword.toLowerCase()));
}

export function buildAnalysis(input: AnalyzeInput) {
  const evidenceScore = Math.min(100, 36 + input.evidence.length * 10);
  const issueText = `${input.taxType} ${input.issueType}`.toLowerCase();
  const isVat = issueText.includes("vat") || issueText.includes("ppn") || issueText.includes("pajak pertambahan nilai");
  const isTransferPricing =
    issueText.includes("transfer pricing") ||
    issueText.includes("harga transfer") ||
    issueText.includes("hubungan istimewa") ||
    issueText.includes("afiliasi");
  const issueBoost = isVat || isTransferPricing ? 12 : 4;
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
  const evidenceGaps = isTransferPricing
    ? ([
        hasEvidence(input.evidence, ["Transfer pricing documentation", "TP Doc", "local file", "master file", "dokumentasi"])
          ? null
          : input.language === "en"
            ? "Transfer pricing documentation / local file"
            : "Dokumentasi transfer pricing / local file",
        hasEvidence(input.evidence, ["Benchmark", "comparable", "pembanding", "benchmarking"])
          ? null
          : input.language === "en"
            ? "Benchmarking and comparable company analysis"
            : "Benchmarking dan analisis pembanding",
        hasEvidence(input.evidence, ["Intercompany agreement", "agreement", "kontrak", "perjanjian"])
          ? null
          : input.language === "en"
            ? "Intercompany agreement and benefit test evidence"
            : "Perjanjian afiliasi dan bukti benefit test"
      ].filter(Boolean) as string[])
    : ([
        hasEvidence(input.evidence, ["Payment evidence", "Bukti pembayaran", "payment", "pembayaran"]) ? null : input.language === "en" ? "Payment evidence" : "Bukti pembayaran",
        hasEvidence(input.evidence, ["VAT return", "SPT Masa PPN", "SPT"]) ? null : input.language === "en" ? "VAT return reconciliation" : "Rekonsiliasi SPT Masa PPN",
        hasEvidence(input.evidence, ["Counterparty confirmation", "Konfirmasi Lawan Transaksi", "konfirmasi"]) ? null : input.language === "en" ? "Counterparty confirmation" : "Konfirmasi lawan transaksi"
      ].filter(Boolean) as string[]);

  const recommendation =
    input.language === "en"
      ? [
          `Initial recommendation for ${input.taxpayerName || "the taxpayer"}`,
          `The dispute should be framed around ${input.issueType || "the main tax issue"} at the ${input.stage || "appeal"} stage.`,
          "The taxpayer position should be supported by a clear chronology, amount reconciliation, and evidence mapping against each correction reason.",
          isTransferPricing
            ? "For transfer pricing, prioritize FAR analysis, transaction segmentation, benchmarking quality, tested-party logic, method selection, and reconciliation between TP documentation, financial statements, and tax returns."
            : "For VAT, prioritize invoice validity, VAT return reconciliation, payment flow, transaction substance, and counterparty confirmation.",
          `Use ${topCases[0].number} mainly as a risk comparator and ${topCases[1].number} as a supporting comparator where the facts and evidence chain are genuinely similar.`,
          "Before filing, complete the evidence gaps and verify the applicable legal basis against the relevant tax period."
        ].join("\n\n")
      : [
          `Rekomendasi awal untuk ${input.taxpayerName || "Wajib Pajak"}`,
          `Sengketa sebaiknya disusun di sekitar ${input.issueType || "isu pajak utama"} pada tahap ${input.stage || "banding"}.`,
          "Posisi WP perlu didukung kronologi, rekonsiliasi angka, dan pemetaan bukti terhadap setiap alasan koreksi.",
          isTransferPricing
            ? "Untuk transfer pricing, prioritaskan analisis FAR, segmentasi transaksi, kualitas benchmarking, logika tested party, pemilihan metode, dan rekonsiliasi antara TP Doc, laporan keuangan, dan SPT."
            : "Untuk PPN, prioritaskan validitas faktur, rekonsiliasi SPT Masa PPN, arus pembayaran, substansi transaksi, dan konfirmasi lawan transaksi.",
          `Gunakan ${topCases[0].number} terutama sebagai pembanding risiko dan ${topCases[1].number} sebagai pembanding pendukung apabila fakta dan rantai buktinya benar-benar mirip.`,
          "Sebelum pengajuan, lengkapi gap bukti dan cocokkan dasar hukum yang berlaku dengan masa pajak yang relevan."
        ].join("\n\n");

  return {
    score,
    confidence,
    evidenceScore,
    indication,
    topCases,
    evidenceGaps,
    regulations: regulations.filter((item) => (isTransferPricing ? item.topic === "transfer_pricing" : isVat ? item.topic === "vat" : true)).slice(0, 4),
    recommendation,
    llmStatus: {
      used: false,
      model: "",
      message: input.language === "en" ? "Local rule-based analysis" : "Analisis lokal berbasis aturan"
    }
  };
}
