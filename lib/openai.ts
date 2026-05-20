import type { AnalysisResult, AnalyzeInput } from "./analyze";
import type { ExtractionResult } from "./extraction";
import { comparableDecisions, regulations, type Regulation } from "./mock-data";
import { chooseRegulationContext } from "./regulation-knowledge";

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

export async function buildLlmAnalysis(
  input: AnalyzeInput,
  local: AnalysisResult,
  extraction?: ExtractionResult | null,
  regulationContext: Regulation[] = regulations
): Promise<AnalysisResult> {
  const matchedRegulations = chooseRegulationContext(
    regulationContext.length ? regulationContext : regulations,
    `${input.taxType} ${input.issueType} ${input.taxAuthorityPosition} ${input.taxpayerPosition}`
  );
  if (!hasOpenAIKey()) {
    return { ...local, regulations: matchedRegulations, llmStatus: missingKeyStatus(input.language) };
  }

  const model = configuredModel();
  const system =
    input.language === "en"
      ? "You are a senior Indonesian tax dispute advisor. Produce cautious, practical analysis for Indonesian tax disputes, including VAT and transfer pricing where relevant. Do not invent case facts. Return JSON only."
      : "Anda adalah senior advisor sengketa pajak Indonesia. Buat analisis praktis dan hati-hati untuk sengketa pajak Indonesia, termasuk PPN dan transfer pricing jika relevan. Jangan mengarang fakta. Kembalikan JSON saja.";
  const prompt = JSON.stringify(
    {
      instruction:
        input.language === "en"
          ? "Improve the local analysis into a thorough advisor-grade report. Keep numeric scores if they are reasonable. Return JSON with indication, evidenceGaps, recommendation, topCases[].reasoning, topCases[].implication. The recommendation must be long-form and suitable for an approximately 8-page Word memo: executive summary, document/extraction summary, factual chronology, tax authority position, taxpayer position, disputed amount mapping, legal/regulatory basis, evidence sufficiency review, evidence gaps, risk assessment, comparable decision strategy, argument strategy, recommended document checklist, and next steps. Use the regulation context that best matches the case topic. Use clear headings in plain text. Do not use Markdown tables."
          : "Perdalam analisis lokal menjadi report advisor yang komprehensif. Pertahankan skor numerik jika masih wajar. Kembalikan JSON dengan indication, evidenceGaps, recommendation, topCases[].reasoning, topCases[].implication. Rekomendasi harus long-form dan layak menjadi memo Word sekitar 8 halaman: ringkasan eksekutif, ringkasan dokumen/ekstraksi, kronologi fakta, posisi DJP, posisi WP, pemetaan nilai sengketa, dasar hukum/peraturan, review kecukupan bukti, celah bukti, asesmen risiko, strategi putusan pembanding, strategi argumentasi, checklist dokumen, dan langkah berikutnya. Gunakan konteks peraturan yang paling cocok dengan topik kasus. Gunakan heading teks biasa. Jangan gunakan tabel Markdown.",
      caseInput: input,
      extractedDocument: extraction || null,
      localAnalysis: local,
      comparableDecisionContext: comparableDecisions.slice(0, 2),
      regulationContext: matchedRegulations
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
      regulations: matchedRegulations,
      llmStatus: {
        used: true,
        model,
        message: input.language === "en" ? "LLM-enhanced analysis" : "Analisis diperdalam dengan LLM"
      }
    };
  } catch (error) {
    return {
      ...local,
      regulations: matchedRegulations,
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

export async function answerRegulationQuestion(question: string, language: "id" | "en", regulationContext: Regulation[] = regulations) {
  const model = configuredModel();
  const context = regulationContext.length ? regulationContext : regulations;
  const top = context.slice(0, 3);
  const localAnswer =
    language === "en"
      ? `Based on the available regulation cards, start with ${top[0]?.title || "the closest regulation"} (${top[0]?.citation || "local context"}). Then compare it with ${top[1]?.title || "supporting rules"}${top[1]?.citation ? ` (${top[1].citation})` : ""} for supporting requirements, evidence, and dispute positioning.`
      : `Berdasarkan kartu peraturan yang tersedia, mulai dari ${top[0]?.title || "aturan terdekat"} (${top[0]?.citation || "konteks lokal"}). Lalu sandingkan dengan ${top[1]?.title || "aturan pendukung"}${top[1]?.citation ? ` (${top[1].citation})` : ""} untuk syarat pendukung, pembuktian, dan posisi sengketa.`;

  if (!hasOpenAIKey()) {
    return {
      answer: localAnswer,
      citations: top,
      llmStatus: missingKeyStatus(language)
    };
  }

  const system =
    language === "en"
      ? "You are an Indonesian tax regulation chatbot for tax disputes. Answer from the provided regulation context only. Cover VAT and transfer pricing when relevant. Name where each rule is located. If context is insufficient, say so and identify what regulation should be added."
      : "Anda adalah chatbot peraturan pajak Indonesia untuk sengketa pajak. Jawab hanya dari konteks peraturan yang diberikan. Bahas PPN dan transfer pricing jika relevan. Sebutkan lokasi setiap aturan. Jika konteks belum cukup, katakan dan sebutkan aturan apa yang perlu ditambahkan.";
  const prompt = JSON.stringify({ question, regulationContext: context, responseLanguage: language }, null, 2);

  try {
    const answer = await callOpenAIText(prompt, system, model);
    return {
      answer,
      citations: top,
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
      citations: top,
      llmStatus: {
        used: false,
        model,
        message: language === "en" ? "LLM failed; using local fallback." : "LLM gagal; memakai fallback lokal."
      }
    };
  }
}
