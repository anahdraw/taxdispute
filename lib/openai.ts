import type { AnalysisResult, AnalyzeInput } from "./analyze";
import { comparableDecisions, regulations } from "./mock-data";

export type LlmStatus = {
  used: boolean;
  model: string;
  message: string;
};

type OpenAITextResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

type PdfInput = {
  filename: string;
  fileData: string;
};

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export function configuredModel() {
  return process.env.TDP_LLM_MODEL || process.env.OPENAI_MODEL || "gpt-5.4-mini";
}

export function hasOpenAIKey() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function missingKeyStatus(language: "id" | "en"): LlmStatus {
  return {
    used: false,
    model: configuredModel(),
    message:
      language === "en"
        ? "OPENAI_API_KEY is not configured in the server environment; using local fallback."
        : "OPENAI_API_KEY belum dikonfigurasi di server; memakai fallback lokal."
  };
}

export async function callOpenAIText(prompt: string, system: string, model = configuredModel()): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: system }]
        },
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }]
        }
      ],
      text: { verbosity: process.env.TDP_TEXT_VERBOSITY || "medium" },
      reasoning: { effort: process.env.TDP_REASONING_EFFORT || "low" }
    })
  });

  const payload = (await response.json().catch(() => ({}))) as OpenAITextResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenAI request failed with status ${response.status}.`);
  }

  const directText = payload.output_text?.trim();
  if (directText) {
    return directText;
  }

  const outputText = payload.output
    ?.flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .join("\n")
    .trim();
  if (!outputText) {
    throw new Error("OpenAI response did not contain text output.");
  }
  return outputText;
}

export async function callOpenAIWithPdf(prompt: string, system: string, pdf: PdfInput, model = configuredModel()): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: system }]
        },
        {
          role: "user",
          content: [
            {
              type: "input_file",
              filename: pdf.filename,
              file_data: pdf.fileData
            },
            {
              type: "input_text",
              text: prompt
            }
          ]
        }
      ],
      text: { verbosity: process.env.TDP_TEXT_VERBOSITY || "medium" },
      reasoning: { effort: process.env.TDP_REASONING_EFFORT || "low" }
    })
  });

  const payload = (await response.json().catch(() => ({}))) as OpenAITextResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenAI PDF request failed with status ${response.status}.`);
  }
  const directText = payload.output_text?.trim();
  if (directText) {
    return directText;
  }
  const outputText = payload.output
    ?.flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .join("\n")
    .trim();
  if (!outputText) {
    throw new Error("OpenAI PDF response did not contain text output.");
  }
  return outputText;
}

export function extractJsonObject(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("LLM response was not valid JSON.");
  }
}

export async function buildLlmAnalysis(input: AnalyzeInput, local: AnalysisResult): Promise<AnalysisResult> {
  if (!hasOpenAIKey()) {
    return { ...local, llmStatus: missingKeyStatus(input.language) };
  }

  const model = configuredModel();
  const system =
    input.language === "en"
      ? "You are a senior Indonesian tax dispute advisor. Produce cautious, practical analysis for VAT disputes. Do not invent case facts. Return JSON only."
      : "Anda adalah senior advisor sengketa pajak Indonesia. Buat analisis praktis dan hati-hati untuk sengketa PPN. Jangan mengarang fakta. Kembalikan JSON saja.";
  const prompt = JSON.stringify(
    {
      instruction:
        input.language === "en"
          ? "Improve the local analysis into a thorough advisor-grade report. Keep numeric scores if they are reasonable. Return JSON with indication, evidenceGaps, recommendation, topCases[].reasoning, topCases[].implication. The recommendation must be deep, structured, and practical: executive summary, factual position, risk review, evidence plan, regulation basis, comparable decision strategy, and next steps."
          : "Perdalam analisis lokal menjadi report advisor yang komprehensif. Pertahankan skor numerik jika masih wajar. Kembalikan JSON dengan indication, evidenceGaps, recommendation, topCases[].reasoning, topCases[].implication. Rekomendasi harus mendalam dan terstruktur: ringkasan eksekutif, posisi fakta, review risiko, rencana bukti, dasar peraturan, strategi putusan pembanding, dan langkah berikutnya.",
      caseInput: input,
      localAnalysis: local,
      comparableDecisionContext: comparableDecisions.slice(0, 2),
      regulationContext: regulations
    },
    null,
    2
  );

  try {
    const text = await callOpenAIText(prompt, system, model);
    const parsed = extractJsonObject(text) as Partial<AnalysisResult>;
    return {
      ...local,
      indication: typeof parsed.indication === "string" ? parsed.indication : local.indication,
      evidenceGaps: Array.isArray(parsed.evidenceGaps) ? parsed.evidenceGaps.map(String).slice(0, 6) : local.evidenceGaps,
      recommendation: typeof parsed.recommendation === "string" ? parsed.recommendation : local.recommendation,
      topCases: local.topCases.map((item, index) => {
        const llmCase = Array.isArray(parsed.topCases) ? parsed.topCases[index] : undefined;
        return {
          ...item,
          reasoning: typeof llmCase?.reasoning === "string" ? llmCase.reasoning : item.reasoning,
          implication: typeof llmCase?.implication === "string" ? llmCase.implication : item.implication
        };
      }),
      llmStatus: {
        used: true,
        model,
        message: input.language === "en" ? "LLM-enhanced analysis" : "Analisis diperdalam dengan LLM"
      }
    };
  } catch (error) {
    return {
      ...local,
      llmStatus: {
        used: false,
        model,
        message: `${input.language === "en" ? "LLM failed; using local fallback" : "LLM gagal; memakai fallback lokal"}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      }
    };
  }
}

export async function answerRegulationQuestion(question: string, language: "id" | "en") {
  const model = configuredModel();
  const localAnswer =
    language === "en"
      ? `Based on the local VAT regulation cards, start with ${regulations[0].title} (${regulations[0].citation}) for taxable delivery and input VAT creditability, then use ${regulations[2].title} (${regulations[2].citation}) for tax invoice evidence.`
      : `Berdasarkan kartu peraturan PPN lokal, mulai dari ${regulations[0].title} (${regulations[0].citation}) untuk penyerahan kena pajak dan pengkreditan pajak masukan, lalu gunakan ${regulations[2].title} (${regulations[2].citation}) untuk bukti faktur pajak.`;

  if (!hasOpenAIKey()) {
    return {
      answer: localAnswer,
      citations: regulations.slice(0, 3),
      llmStatus: missingKeyStatus(language)
    };
  }

  const system =
    language === "en"
      ? "You are a VAT regulation chatbot for Indonesian tax disputes. Answer from the provided regulation context only. Name where the rule is located. If context is insufficient, say so."
      : "Anda adalah chatbot aturan PPN untuk sengketa pajak Indonesia. Jawab hanya dari konteks peraturan yang diberikan. Sebutkan lokasi aturannya. Jika konteks belum cukup, katakan demikian.";
  const prompt = JSON.stringify({ question, regulationContext: regulations, responseLanguage: language }, null, 2);

  try {
    const answer = await callOpenAIText(prompt, system, model);
    return {
      answer,
      citations: regulations.slice(0, 3),
      llmStatus: {
        used: true,
        model,
        message: language === "en" ? "LLM regulation answer" : "Jawaban aturan dari LLM"
      }
    };
  } catch (error) {
    return {
      answer: `${localAnswer}\n\n${language === "en" ? "LLM note" : "Catatan LLM"}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      citations: regulations.slice(0, 3),
      llmStatus: {
        used: false,
        model,
        message: language === "en" ? "LLM failed; using local fallback." : "LLM gagal; memakai fallback lokal."
      }
    };
  }
}
