const SMART_ANSWER_SECTION_LABELS = [
  "Risks and counterarguments",
  "Practical reading of the decisions",
  "Rules shown in the retrieved context",
  "Ringkasan eksekutif",
  "Risiko dan counterargument",
  "Risiko dan kontra-argumen",
  "Rekomendasi tindakan",
  "Executive summary",
  "Practical implications",
  "Regulatory analysis",
  "Evidence assessment",
  "Relevant decisions",
  "Applicable rules",
  "Recommended actions",
  "What to check first",
  "Jawaban eksekutif",
  "Aturan yang berlaku",
  "Putusan relevan",
  "Implikasi praktis",
  "Langkah berikutnya",
  "Strategi argumentasi",
  "Analisis peraturan",
  "Penilaian bukti",
  "Decision pattern",
  "Argument strategy",
  "Executive answer",
  "Issue map",
  "Next steps",
  "Short answer",
  "Main rule",
  "Next step",
  "Peta isu",
  "Pola putusan",
  "Jawaban singkat",
  "Aturan utama"
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Normalize predictable formatting deviations before rendering LLM Markdown. */
export function normalizeSmartAnswerMarkdown(value: string) {
  let text = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/(?:\\r\\n|\\n|\\r)+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

  for (const label of SMART_ANSWER_SECTION_LABELS) {
    const escaped = escapeRegExp(label);
    const pattern = new RegExp(
      `(?:^|\\n|[ \\t]{2,})(?:#{1,6}[ \\t]*)?(?:\\*\\*)?${escaped}(?:\\*\\*)?[ \\t]*(?:[:–—]|-(?=[ \\t]+\\S)|(?=\\d{1,2}[.)][ \\t]))?[ \\t]*`,
      "gi"
    );
    text = text.replace(pattern, (match) => {
      const leadingBreak = match.startsWith("\n") || match.startsWith("  ") ? "\n\n" : "";
      return `${leadingBreak}## ${label}\n`;
    });
  }

  return text
    .replace(/([^\n])\s+(?=(?:[1-9]|1\d)[.)]\s+(?:\*\*)?[A-ZÀ-ÖØ-Ý])/g, "$1\n")
    .replace(/\n(?=#{1,6}\s)/g, "\n\n")
    .replace(/(#{1,6}\s+[^\n]+)\n(?!\n)/g, "$1\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
