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
  "What to check",
  "Context limit",
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
      `(?:^|\\n|[ \\t]{2,})(?:#{1,6}[ \\t]*)?(?:\\*\\*)?(?:0?\\d{1,2}[.)\\-:]*[ \\t]*)?${escaped}(?:\\*\\*)?[ \\t]*(?:[:–—]|-(?=[ \\t]+\\S)|(?=\\d{1,2}[.)][ \\t]))?[ \\t]*`,
      "gi"
    );
    text = text.replace(pattern, (match) => {
      const leadingBreak = match.startsWith("\n") || match.startsWith("  ") ? "\n\n" : "";
      return `${leadingBreak}## ${label}\n`;
    });
  }

  text = text
    .replace(/^(#{1,6}\s+)0?\d{1,2}[.)\-:]?\s*(?=[A-Za-zÀ-ÖØ-öø-ÿ])/gm, "$1")
    .replace(/([^\n])\s+(?=(?:[1-9]|1\d)[.)]\s+(?:\*\*)?[A-ZÀ-ÖØ-Ý])/g, "$1\n")
    .replace(/\n(?=#{1,6}\s)/g, "\n\n")
    .replace(/(#{1,6}\s+[^\n]+)\n(?!\n)/g, "$1\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const sections = text.split(/(?=^##\s+)/gm);
  text = sections
    .map((section) => {
      const match = section.match(/^(##\s+([^\n]+))\n+([\s\S]+)$/);
      if (!match) return section;
      const title = match[2].trim();
      const body = match[3].trim();
      if (/short answer|executive|summary|jawaban singkat|jawaban eksekutif|ringkasan/i.test(title)) return `${match[1]}\n\n${body}`;
      if (/^(?:[-•]|\d+[.)])\s+/m.test(body)) return `${match[1]}\n\n${body}`;
      const items = body
        .split(/\n+|(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Ý])/g)
        .map((item) => item.trim())
        .filter(Boolean);
      return items.length > 1 ? `${match[1]}\n\n${items.map((item) => `- ${item}`).join("\n")}` : `${match[1]}\n\n${body}`;
    })
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

const REGULATION_ANSWER_LABELS = [
  "jawaban", "jawaban singkat", "answer", "short answer", "rumus", "formula", "contoh", "example",
  "cara menghitung", "how to calculate", "alur praktis", "practical flow", "perlu diperhatikan", "important",
  "catatan", "notes", "dasar aturan", "sources", "sumber", "primary sources", "regulation references"
];

/** Keep regulation answers conversational instead of rendering numbered section cards. */
export function normalizeRegulationAnswerMarkdown(value: string) {
  let text = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  const labelPattern = REGULATION_ANSWER_LABELS.map(escapeRegExp).join("|");
  // Remove a heading-only line such as "02 Rumus" or "## Contoh".
  text = text.replace(new RegExp(`^\\s*(?:#{1,6}\\s*)?(?:0?\\d{1,2}\\s*)?(?:${labelPattern})\\s*[:–—-]?\\s*$`, "gim"), "");
  // If a model puts content on the same line as the label, retain the content.
  text = text.replace(new RegExp(`^\\s*(?:#{1,6}\\s*)?(?:0?\\d{1,2}\\s*)?(?:${labelPattern})\\s*[:–—-]\\s*`, "gim"), "");
  return text.replace(/\n{3,}/g, "\n\n").trim();
}
