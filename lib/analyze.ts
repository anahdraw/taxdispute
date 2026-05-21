import { comparableDecisions, regulations } from "./mock-data";
import type { ComparableDecision, OutcomeKey } from "./mock-data";
import type { ExtractionResult } from "./extraction";
import type { StoredDecisionFile } from "./stored-decisions";

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

type ScoreComponent = {
  id: "evidence" | "case_specificity" | "comparators" | "legal_basis" | "procedural_readiness";
  label: string;
  maxPoints: number;
  earnedPoints: number;
  percentage: number;
  rationale: string;
  signals: string[];
};

type ScoringBreakdown = {
  version: string;
  formula: string;
  totalScore: number;
  components: ScoreComponent[];
  notes: string[];
};

function hasEvidence(evidence: string[], keywords: string[]) {
  const joined = evidence.join(" | ").toLowerCase();
  return keywords.some((keyword) => joined.includes(keyword.toLowerCase()));
}

function tokenize(text: string) {
  const stopWords = new Set([
    "the",
    "and",
    "atau",
    "dan",
    "yang",
    "with",
    "untuk",
    "atas",
    "tax",
    "pajak",
    "sengketa",
    "dispute"
  ]);
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 2 && !stopWords.has(word))
    )
  );
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function normalizeScore(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeOutcome(value: string): OutcomeKey {
  const text = value.toLowerCase();
  if (/dikabulkan seluruh|fully|full win|menang seluruh/.test(text)) return "WP_FULL_WIN";
  if (/dikabulkan sebagian|partial|sebagian/.test(text)) return "WP_PARTIAL_WIN";
  if (/ditolak|djp|tax authority|terbanding|menolak/.test(text)) return "DJP_WIN";
  if (/tidak dapat diterima|gugur|formal/.test(text)) return "FORMAL_REJECTED";
  return "UNKNOWN";
}

export function decisionDocumentsToComparables(documents: StoredDecisionFile[]): ComparableDecision[] {
  return documents
    .filter((document) => document.extraction)
    .map((document) => {
      const extraction = document.extraction as ExtractionResult;
      return {
        id: document.id,
        number: extraction.putusanNumber || extraction.skpNumber || document.filename,
        taxType: extraction.taxType || "Unknown",
        issue: extraction.issueType || extraction.issueSubtype || extraction.correctionObject || "Unclassified issue",
        outcome: normalizeOutcome(extraction.outcome),
        score: 70,
        amount: extraction.correctionAmount || "-",
        reasoning: extraction.courtReasoning || extraction.summary || extraction.correctionReason || "Extracted decision context is available for comparison.",
        implication: extraction.taxpayerRebuttal || extraction.taxpayerPosition || "Compare the factual pattern and evidence chain before relying on this case.",
        matchPoints: [
          extraction.taxType,
          extraction.issueType,
          extraction.issueSubtype,
          extraction.correctionObject,
          ...extraction.evidence.slice(0, 4)
        ].filter(Boolean)
      };
    });
}

function scoreComparableDecisions(input: AnalyzeInput, decisionContext: ComparableDecision[]): ComparableDecision[] {
  const source = decisionContext.length ? decisionContext : comparableDecisions;
  const queryText = `${input.taxType} ${input.issueType} ${input.stage} ${input.taxAuthorityPosition} ${input.taxpayerPosition}`;
  const queryTokens = tokenize(queryText);
  const inputTax = input.taxType.toLowerCase();

  return source
    .map((decision) => {
      const decisionText = `${decision.taxType} ${decision.issue} ${decision.matchPoints.join(" ")} ${decision.reasoning}`;
      const decisionTokens = tokenize(decisionText);
      const shared = queryTokens.filter((token) => decisionTokens.includes(token));
      const queryCoverage = queryTokens.length ? shared.length / queryTokens.length : 0;
      const decisionCoverage = decisionTokens.length ? shared.length / decisionTokens.length : 0;
      const taxMatch =
        inputTax && (decision.taxType.toLowerCase().includes(inputTax) || inputTax.includes(decision.taxType.toLowerCase()))
          ? 18
          : 0;
      const issueSimilarity = queryCoverage * 42 + decisionCoverage * 18;
      const sourceQuality = Math.min(decision.score / 100, 1) * 22;
      const scored = clamp(taxMatch + issueSimilarity + sourceQuality, 0, 96);
      return { ...decision, score: normalizeScore(scored), matchPoints: shared.length ? shared.slice(0, 6) : decision.matchPoints };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
}

function evidenceCategories(input: AnalyzeInput, isTransferPricing: boolean) {
  if (isTransferPricing) {
    return [
      {
        label: input.language === "en" ? "Transfer pricing documentation / local file" : "Dokumentasi transfer pricing / local file",
        matched: hasEvidence(input.evidence, ["Transfer pricing documentation", "TP Doc", "local file", "master file", "dokumentasi"])
      },
      {
        label: input.language === "en" ? "Benchmarking and comparable company analysis" : "Benchmarking dan analisis pembanding",
        matched: hasEvidence(input.evidence, ["Benchmark", "comparable", "pembanding", "benchmarking"])
      },
      {
        label: input.language === "en" ? "Intercompany agreement and benefit test evidence" : "Perjanjian afiliasi dan bukti benefit test",
        matched: hasEvidence(input.evidence, ["Intercompany agreement", "agreement", "kontrak", "perjanjian", "benefit"])
      },
      {
        label: input.language === "en" ? "Financial statement / tax return reconciliation" : "Rekonsiliasi laporan keuangan / SPT",
        matched: hasEvidence(input.evidence, ["financial", "laporan keuangan", "SPT", "return", "reconciliation", "rekonsiliasi"])
      },
      {
        label: input.language === "en" ? "Invoices, payment trail, or service deliverables" : "Invoice, arus pembayaran, atau bukti jasa",
        matched: hasEvidence(input.evidence, ["invoice", "faktur", "payment", "pembayaran", "deliverable", "jasa"])
      }
    ];
  }
  return [
    {
      label: input.language === "en" ? "VAT invoice / formal tax invoice support" : "Faktur Pajak / dukungan formal faktur",
      matched: hasEvidence(input.evidence, ["VAT invoice", "Faktur Pajak", "invoice", "faktur"])
    },
    {
      label: input.language === "en" ? "VAT return reconciliation" : "Rekonsiliasi SPT Masa PPN",
      matched: hasEvidence(input.evidence, ["VAT return", "SPT Masa PPN", "SPT", "return"])
    },
    {
      label: input.language === "en" ? "Payment evidence / cash flow trail" : "Bukti pembayaran / arus kas",
      matched: hasEvidence(input.evidence, ["Payment evidence", "Bukti pembayaran", "payment", "pembayaran", "bank"])
    },
    {
      label: input.language === "en" ? "Counterparty confirmation" : "Konfirmasi lawan transaksi",
      matched: hasEvidence(input.evidence, ["Counterparty confirmation", "Konfirmasi Lawan Transaksi", "konfirmasi", "counterparty"])
    },
    {
      label: input.language === "en" ? "Transaction substance / delivery documentation" : "Substansi transaksi / dokumen penyerahan",
      matched: hasEvidence(input.evidence, ["delivery", "penyerahan", "substance", "substansi", "contract", "kontrak", "purchase order", "DO"])
    }
  ];
}

function filled(value: unknown) {
  return Boolean(String(value || "").trim());
}

function buildScoreBreakdown(input: AnalyzeInput, topCases: ComparableDecision[], extraction?: ExtractionResult | null): ScoringBreakdown {
  const en = input.language === "en";
  const issueText = `${input.taxType} ${input.issueType}`.toLowerCase();
  const isTransferPricing =
    issueText.includes("transfer pricing") ||
    issueText.includes("harga transfer") ||
    issueText.includes("hubungan istimewa") ||
    issueText.includes("afiliasi");
  const categories = evidenceCategories(input, isTransferPricing);
  const matchedEvidence = categories.filter((item) => item.matched);
  const evidencePct = categories.length ? (matchedEvidence.length / categories.length) * 100 : 0;

  const caseFields = [
    input.taxpayerName,
    input.taxType,
    input.issueType,
    input.correctionAmount,
    input.taxAuthorityPosition,
    input.taxpayerPosition,
    extraction?.taxPeriod,
    extraction?.skpNumber || extraction?.djpDecisionNumber
  ];
  const casePct = (caseFields.filter(filled).length / caseFields.length) * 100;

  const comparatorAverage = topCases.length ? topCases.reduce((sum, item) => sum + item.score, 0) / topCases.length : 0;
  const comparatorPct = clamp(comparatorAverage * 1.08, 0, 100);

  const relevantRegulations = regulations.filter((item) => {
    if (isTransferPricing) return item.topic === "transfer_pricing";
    if (issueText.includes("vat") || issueText.includes("ppn")) return item.topic === "vat";
    return true;
  });
  const legalSignals = [
    relevantRegulations.length >= 2,
    Boolean(extraction?.legalReferences?.length),
    filled(input.taxType),
    filled(input.issueType)
  ];
  const legalPct = (legalSignals.filter(Boolean).length / legalSignals.length) * 100;

  const proceduralSignals = [
    filled(input.stage),
    filled(extraction?.documentType) || /appeal|banding|objection|keberatan|audit|pemeriksaan/i.test(input.stage),
    filled(extraction?.taxpayerName) || filled(input.taxpayerName),
    !/late|terlambat|formal|kuasa tidak|tidak lengkap/i.test(`${input.taxAuthorityPosition} ${extraction?.summary || ""}`)
  ];
  const proceduralPct = (proceduralSignals.filter(Boolean).length / proceduralSignals.length) * 100;

  const componentSpecs: Array<Omit<ScoreComponent, "earnedPoints" | "percentage"> & { percentage: number }> = [
    {
      id: "evidence",
      label: en ? "Evidence strength" : "Kekuatan bukti",
      maxPoints: 35,
      percentage: evidencePct,
      rationale: en
        ? `${matchedEvidence.length}/${categories.length} key evidence categories are present.`
        : `${matchedEvidence.length}/${categories.length} kategori bukti utama tersedia.`,
      signals: categories.map((item) => `${item.matched ? "Present" : "Missing"}: ${item.label}`)
    },
    {
      id: "case_specificity",
      label: en ? "Case specificity" : "Kelengkapan fakta kasus",
      maxPoints: 20,
      percentage: casePct,
      rationale: en
        ? "Measures how many core case fields are filled before advisor review."
        : "Mengukur berapa banyak field kasus inti yang sudah terisi sebelum review advisor.",
      signals: [
        en ? "Taxpayer, tax type, issue, amount, positions, tax period, and assessment/decision numbers." : "WP, jenis pajak, isu, nilai, posisi, masa pajak, dan nomor ketetapan/keputusan."
      ]
    },
    {
      id: "comparators",
      label: en ? "Comparable decision support" : "Dukungan putusan pembanding",
      maxPoints: 20,
      percentage: comparatorPct,
      rationale: en
        ? `Top comparable decisions average ${normalizeScore(comparatorAverage)}% similarity.`
        : `Rata-rata kemiripan putusan pembanding teratas ${normalizeScore(comparatorAverage)}%.`,
      signals: topCases.map((item) => `${item.number}: ${item.score}%`)
    },
    {
      id: "legal_basis",
      label: en ? "Regulatory basis" : "Dasar peraturan",
      maxPoints: 15,
      percentage: legalPct,
      rationale: en
        ? "Checks whether a relevant regulation set and document-level legal references are available."
        : "Memeriksa apakah peraturan relevan dan rujukan hukum dari dokumen tersedia.",
      signals: [
        `${relevantRegulations.length} ${en ? "topic-matched regulation(s)" : "peraturan sesuai topik"}`,
        `${extraction?.legalReferences?.length || 0} ${en ? "document legal reference(s)" : "rujukan hukum dari dokumen"}`
      ]
    },
    {
      id: "procedural_readiness",
      label: en ? "Procedural readiness" : "Kesiapan prosedural",
      maxPoints: 10,
      percentage: proceduralPct,
      rationale: en
        ? "Checks stage clarity, document type, party identity, and obvious formal-risk flags."
        : "Memeriksa kejelasan tahap, jenis dokumen, identitas pihak, dan indikasi risiko formal.",
      signals: [
        en ? "Stage/document/party clarity and no obvious formal risk keyword." : "Tahap/dokumen/pihak jelas dan tidak ada kata kunci risiko formal yang jelas."
      ]
    }
  ];

  const components = componentSpecs.map((component) => ({
    ...component,
    percentage: normalizeScore(component.percentage),
    earnedPoints: normalizeScore((component.percentage / 100) * component.maxPoints)
  }));
  const totalScore = normalizeScore(components.reduce((sum, component) => sum + component.earnedPoints, 0));

  return {
    version: "transparent-scorecard-v1",
    formula: en
      ? "Score = evidence strength 35 pts + case specificity 20 pts + comparable decision support 20 pts + regulatory basis 15 pts + procedural readiness 10 pts."
      : "Skor = kekuatan bukti 35 poin + kelengkapan fakta kasus 20 poin + dukungan putusan pembanding 20 poin + dasar peraturan 15 poin + kesiapan prosedural 10 poin.",
    totalScore,
    components,
    notes: [
      en
        ? "This is an indicative case-readiness score, not a guaranteed litigation outcome prediction."
        : "Ini adalah skor indikatif kesiapan kasus, bukan prediksi pasti hasil sengketa.",
      en
        ? "The LLM may deepen the narrative, but the displayed score is computed from this deterministic scorecard."
        : "LLM dapat memperdalam narasi, tetapi skor yang ditampilkan dihitung dari scorecard deterministik ini."
    ]
  };
}

export function buildAnalysis(input: AnalyzeInput, extraction?: ExtractionResult | null, decisionContext: ComparableDecision[] = comparableDecisions) {
  const issueText = `${input.taxType} ${input.issueType}`.toLowerCase();
  const isVat = issueText.includes("vat") || issueText.includes("ppn") || issueText.includes("pajak pertambahan nilai");
  const isTransferPricing =
    issueText.includes("transfer pricing") ||
    issueText.includes("harga transfer") ||
    issueText.includes("hubungan istimewa") ||
    issueText.includes("afiliasi");
  const topCases = scoreComparableDecisions(input, decisionContext);
  const scoringBreakdown = buildScoreBreakdown(input, topCases, extraction);
  const evidenceComponent = scoringBreakdown.components.find((component) => component.id === "evidence");
  const specificityComponent = scoringBreakdown.components.find((component) => component.id === "case_specificity");
  const evidenceScore = evidenceComponent?.percentage || 0;
  const score = scoringBreakdown.totalScore;
  const confidence =
    evidenceScore >= 80 && (specificityComponent?.percentage || 0) >= 75
      ? "high"
      : evidenceScore >= 45 && (specificityComponent?.percentage || 0) >= 55
        ? "medium"
        : "low";
  const indication =
    input.language === "en"
      ? score >= 70
        ? "Potentially partially granted with a strong evidence strategy"
        : "Evidence strengthening required before submission"
      : score >= 70
        ? "Berpeluang dikabulkan sebagian dengan strategi bukti yang kuat"
        : "Perlu penguatan bukti sebelum diajukan";

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
          topCases.length > 1
            ? `Use ${topCases[0].number} mainly as a risk comparator and ${topCases[1].number} as a supporting comparator where the facts and evidence chain are genuinely similar.`
            : `Use ${topCases[0]?.number || "the most relevant decision"} as a comparator only where the facts and evidence chain are genuinely similar.`,
          "Before filing, complete the evidence gaps and verify the applicable legal basis against the relevant tax period."
        ].join("\n\n")
      : [
          `Rekomendasi awal untuk ${input.taxpayerName || "Wajib Pajak"}`,
          `Sengketa sebaiknya disusun di sekitar ${input.issueType || "isu pajak utama"} pada tahap ${input.stage || "banding"}.`,
          "Posisi WP perlu didukung kronologi, rekonsiliasi angka, dan pemetaan bukti terhadap setiap alasan koreksi.",
          isTransferPricing
            ? "Untuk transfer pricing, prioritaskan analisis FAR, segmentasi transaksi, kualitas benchmarking, logika tested party, pemilihan metode, dan rekonsiliasi antara TP Doc, laporan keuangan, dan SPT."
            : "Untuk PPN, prioritaskan validitas faktur, rekonsiliasi SPT Masa PPN, arus pembayaran, substansi transaksi, dan konfirmasi lawan transaksi.",
          topCases.length > 1
            ? `Gunakan ${topCases[0].number} terutama sebagai pembanding risiko dan ${topCases[1].number} sebagai pembanding pendukung apabila fakta dan rantai buktinya benar-benar mirip.`
            : `Gunakan ${topCases[0]?.number || "putusan paling relevan"} sebagai pembanding hanya apabila fakta dan rantai buktinya benar-benar mirip.`,
          "Sebelum pengajuan, lengkapi gap bukti dan cocokkan dasar hukum yang berlaku dengan masa pajak yang relevan."
        ].join("\n\n");

  return {
    score,
    confidence,
    evidenceScore,
    scoringBreakdown,
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
