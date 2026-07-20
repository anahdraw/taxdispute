import type { AnalysisResult, AnalyzeInput } from "./analyze";
import type { ExtractionResult } from "./extraction";
import { comparableDecisions, regulations, type Regulation } from "./mock-data";
import { DEFAULT_LLM_MODEL_CHOICE, normalizeModelChoice, type LlmModelChoice } from "./model-options";
import { chooseRegulationContext } from "./regulation-knowledge";
import { tierWorkProfiles, type TierWorkProfile } from "./tier-profiles";

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

type OpenAIChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
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

type LlmRuntime = {
  choice: LlmModelChoice;
  provider: "openai" | "local-rules" | "local-onprem";
  model: string;
  endpoint?: string;
  remoteAvailable: boolean;
};

function localEndpoint() {
  return process.env.TDP_LOCAL_LLM_URL || process.env.LOCAL_LLM_URL || "";
}

function localApiKey() {
  return process.env.TDP_LOCAL_LLM_API_KEY || process.env.LOCAL_LLM_API_KEY || "";
}

function localModel() {
  return process.env.TDP_LOCAL_LLM_MODEL || process.env.LOCAL_LLM_MODEL || "local-tax-dispute";
}

export function resolveLlmRuntime(modelChoice?: LlmModelChoice | string): LlmRuntime {
  const choice = normalizeModelChoice(modelChoice || DEFAULT_LLM_MODEL_CHOICE);
  if (choice === "local-rules") {
    return {
      choice,
      provider: "local-rules",
      model: "local-rules",
      remoteAvailable: false
    };
  }
  if (choice === "local-onprem") {
    const endpoint = localEndpoint();
    return {
      choice,
      provider: "local-onprem",
      model: localModel(),
      endpoint,
      remoteAvailable: Boolean(endpoint)
    };
  }
  return {
    choice,
    provider: "openai",
    model:
      choice === "openai-nano"
        ? process.env.TDP_OPENAI_NANO_MODEL || "gpt-5.4-nano"
        : process.env.TDP_OPENAI_MINI_MODEL || process.env.TDP_LLM_MODEL || process.env.OPENAI_MODEL || "gpt-5.4-mini",
    remoteAvailable: hasOpenAIKey()
  };
}

export function configuredModel(modelChoice?: LlmModelChoice | string) {
  return resolveLlmRuntime(modelChoice).model;
}

export function configuredModelChoice(modelChoice?: LlmModelChoice | string) {
  return resolveLlmRuntime(modelChoice).choice;
}

export function hasOpenAIKey() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function hasRemoteLlm(modelChoice?: LlmModelChoice | string) {
  return resolveLlmRuntime(modelChoice).remoteAvailable;
}

export function canUsePdfModel(modelChoice?: LlmModelChoice | string) {
  const runtime = resolveLlmRuntime(modelChoice);
  if (runtime.provider === "openai") return hasOpenAIKey();
  if (runtime.provider === "local-onprem") {
    return Boolean(runtime.endpoint && process.env.TDP_LOCAL_LLM_PDF_ENABLED === "true");
  }
  return false;
}

export function missingKeyStatus(language: "id" | "en", modelChoice?: LlmModelChoice | string): LlmStatus {
  const runtime = resolveLlmRuntime(modelChoice);
  const message = (() => {
    if (runtime.provider === "local-rules") {
      return language === "en"
        ? "Local rule-based runtime selected; no external model call was made."
        : "Runtime lokal berbasis aturan dipilih; tidak ada panggilan model eksternal.";
    }
    if (runtime.provider === "local-onprem") {
      return language === "en"
        ? "On-prem LLM endpoint is not configured; using local rule-based response."
        : "Endpoint LLM on-prem belum dikonfigurasi; memakai jawaban lokal berbasis aturan.";
    }
    return language === "en"
      ? "OPENAI_API_KEY is not configured in the server environment; using local rule-based response."
      : "OPENAI_API_KEY belum dikonfigurasi di server; memakai jawaban lokal berbasis aturan.";
  })();
  return {
    used: false,
    model: runtime.model,
    message
  };
}

function parseResponsesText(payload: OpenAITextResponse) {
  const directText = payload.output_text?.trim();
  if (directText) return directText;
  return payload.output
    ?.flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .join("\n")
    .trim();
}

async function callResponsesText(endpoint: string, apiKey: string, prompt: string, system: string, model: string): Promise<string> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
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
    throw new Error(payload.error?.message || `LLM request failed with status ${response.status}.`);
  }
  const outputText = parseResponsesText(payload);
  if (!outputText) {
    throw new Error("LLM response did not contain text output.");
  }
  return outputText;
}

async function callLocalCompatibleText(prompt: string, system: string, runtime: LlmRuntime): Promise<string> {
  if (!runtime.endpoint) {
    throw new Error("TDP_LOCAL_LLM_URL is not configured.");
  }
  if (process.env.TDP_LOCAL_LLM_FORMAT === "responses") {
    return callResponsesText(runtime.endpoint, localApiKey(), prompt, system, runtime.model);
  }

  const response = await fetch(runtime.endpoint, {
    method: "POST",
    headers: {
      ...(localApiKey() ? { Authorization: `Bearer ${localApiKey()}` } : {}),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: runtime.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt }
      ],
      temperature: Number(process.env.TDP_LOCAL_LLM_TEMPERATURE || 0.2)
    })
  });

  const payload = (await response.json().catch(() => ({}))) as OpenAIChatResponse & OpenAITextResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message || `Local LLM request failed with status ${response.status}.`);
  }
  const chatText = payload.choices?.[0]?.message?.content?.trim();
  const responseText = parseResponsesText(payload);
  const outputText = chatText || responseText;
  if (!outputText) {
    throw new Error("Local LLM response did not contain text output.");
  }
  return outputText;
}

export async function callOpenAIText(prompt: string, system: string, modelChoice: LlmModelChoice | string = DEFAULT_LLM_MODEL_CHOICE): Promise<string> {
  const runtime = resolveLlmRuntime(modelChoice);
  if (runtime.provider === "local-rules") {
    throw new Error("Local rule-based runtime does not call a remote LLM.");
  }
  if (runtime.provider === "local-onprem") {
    return callLocalCompatibleText(prompt, system, runtime);
  }
  const model = runtime.model;
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

  const outputText = parseResponsesText(payload);
  if (!outputText) {
    throw new Error("OpenAI response did not contain text output.");
  }
  return outputText;
}

async function callResponsesWithPdf(endpoint: string, apiKey: string, prompt: string, system: string, pdf: PdfInput, model: string): Promise<string> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
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
    throw new Error(payload.error?.message || `LLM PDF request failed with status ${response.status}.`);
  }
  const outputText = parseResponsesText(payload);
  if (!outputText) {
    throw new Error("LLM PDF response did not contain text output.");
  }
  return outputText;
}

export async function callOpenAIWithPdf(
  prompt: string,
  system: string,
  pdf: PdfInput,
  modelChoice: LlmModelChoice | string = DEFAULT_LLM_MODEL_CHOICE
): Promise<string> {
  const runtime = resolveLlmRuntime(modelChoice);
  if (runtime.provider === "local-rules") {
    throw new Error("Local rules cannot extract PDF files. Choose Mini/Nano or configure an on-prem PDF-capable endpoint.");
  }
  if (runtime.provider === "local-onprem") {
    if (!runtime.endpoint || process.env.TDP_LOCAL_LLM_PDF_ENABLED !== "true") {
      throw new Error("On-prem PDF extraction requires TDP_LOCAL_LLM_URL and TDP_LOCAL_LLM_PDF_ENABLED=true.");
    }
    return callResponsesWithPdf(runtime.endpoint, localApiKey(), prompt, system, pdf, runtime.model);
  }
  const model = runtime.model;
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
  const outputText = parseResponsesText(payload);
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

function localTierAnalysisRecommendation(recommendation: string, language: "id" | "en", tierProfile: TierWorkProfile) {
  if (language === "en") {
    if (tierProfile.analysisDepth === "simple") {
      return `Silver triage profile\n\n${recommendation}\n\nNext steps: confirm the main disputed amount, collect the strongest evidence, and escalate to deeper regulation/database review before filing.`;
    }
    if (tierProfile.analysisDepth === "standard") {
      return `Gold advisor analysis profile\n\n${recommendation}\n\nAdvisor focus: align evidence with legal basis, compare the closest decisions, prepare rebuttal points, and identify missing source regulations before drafting.`;
    }
    return `Platinum deep case memo profile\n\n${recommendation}\n\nDeep review agenda: build a factual chronology, map taxpayer and tax authority arguments, test comparable decisions, synthesize regulations by hierarchy, prepare counterarguments, and turn evidence gaps into a filing checklist.`;
  }
  if (tierProfile.analysisDepth === "simple") {
    return `Profil triage Silver\n\n${recommendation}\n\nLangkah berikutnya: konfirmasi nilai sengketa utama, kumpulkan bukti terkuat, dan eskalasi ke pendalaman aturan/database sebelum filing.`;
  }
  if (tierProfile.analysisDepth === "standard") {
    return `Profil analisis advisor Gold\n\n${recommendation}\n\nFokus advisor: cocokkan bukti dengan dasar hukum, bandingkan putusan terdekat, siapkan rebuttal, dan identifikasi aturan sumber yang masih kurang sebelum drafting.`;
  }
  return `Profil memo mendalam Platinum\n\n${recommendation}\n\nAgenda review mendalam: susun kronologi fakta, petakan argumen WP dan DJP, uji putusan pembanding, sintesis aturan berdasarkan hierarki, siapkan counterargument, dan ubah celah bukti menjadi checklist filing.`;
}

export async function buildLlmAnalysis(
  input: AnalyzeInput,
  local: AnalysisResult,
  extraction?: ExtractionResult | null,
  regulationContext: Regulation[] = regulations,
  tierProfile: TierWorkProfile = tierWorkProfiles.platinum,
  modelChoice: LlmModelChoice = DEFAULT_LLM_MODEL_CHOICE,
  managedPrompt?: { system?: string; instruction?: string }
): Promise<AnalysisResult> {
  const runtime = resolveLlmRuntime(modelChoice);
  const matchedRegulations = chooseRegulationContext(
    regulationContext.length ? regulationContext : regulations,
    `${input.taxType} ${input.issueType} ${input.taxAuthorityPosition} ${input.taxpayerPosition}`
  ).slice(0, tierProfile.regulationContextLimit);
  if (!runtime.remoteAvailable) {
    const status = missingKeyStatus(input.language, modelChoice);
    return {
      ...local,
      evidenceGaps: local.evidenceGaps.slice(0, tierProfile.evidenceGapLimit),
      recommendation: localTierAnalysisRecommendation(local.recommendation, input.language, tierProfile),
      topCases: local.topCases.slice(0, tierProfile.decisionContextLimit),
      regulations: matchedRegulations,
      llmStatus: {
        ...status,
        message:
          input.language === "en"
            ? `${status.message} Local ${tierProfile.labels.en.analysis} profile applied.`
            : `${status.message} Profil lokal ${tierProfile.labels.id.analysis} diterapkan.`
      }
    };
  }

  const model = runtime.model;
  const defaultSystem =
    input.language === "en"
      ? "You are a senior Indonesian tax dispute advisor. Produce cautious, practical analysis for Indonesian tax disputes, including VAT and transfer pricing where relevant. Do not invent case facts. Return JSON only."
      : "Anda adalah senior advisor sengketa pajak Indonesia. Buat analisis praktis dan hati-hati untuk sengketa pajak Indonesia, termasuk PPN dan transfer pricing jika relevan. Jangan mengarang fakta. Kembalikan JSON saja.";
  const system = managedPrompt?.system?.trim() || defaultSystem;
  const prompt = JSON.stringify(
    {
      instruction:
        input.language === "en"
          ? `${tierProfile.prompts.en.analysisInstruction} Keep numeric scores if they are reasonable. Return JSON with indication, evidenceGaps, recommendation, topCases[].reasoning, topCases[].implication. Use the regulation context that best matches the case topic. Use clear headings in plain text. Do not use Markdown tables.${managedPrompt?.instruction ? ` Managed instruction: ${managedPrompt.instruction}` : ""}`
          : `${tierProfile.prompts.id.analysisInstruction} Pertahankan skor numerik jika masih wajar. Kembalikan JSON dengan indication, evidenceGaps, recommendation, topCases[].reasoning, topCases[].implication. Gunakan konteks peraturan yang paling cocok dengan topik kasus. Gunakan heading teks biasa. Jangan gunakan tabel Markdown.${managedPrompt?.instruction ? ` Instruksi terkelola: ${managedPrompt.instruction}` : ""}`,
      tierProfile: {
        tier: tierProfile.tier,
        analysisDepth: tierProfile.analysisDepth,
        regulationDepth: tierProfile.regulationDepth,
        decisionContextLimit: tierProfile.decisionContextLimit,
        regulationContextLimit: tierProfile.regulationContextLimit
      },
      caseInput: input,
      extractedDocument: extraction || null,
      localAnalysis: local,
      comparableDecisionContext: comparableDecisions.slice(0, tierProfile.decisionContextLimit),
      regulationContext: matchedRegulations
    },
    null,
    2
  );

  try {
    const text = await callOpenAIText(prompt, system, modelChoice);
    const parsed = extractJsonObject(text) as Partial<AnalysisResult>;
    return {
      ...local,
      indication: typeof parsed.indication === "string" ? parsed.indication : local.indication,
      evidenceGaps: Array.isArray(parsed.evidenceGaps) ? parsed.evidenceGaps.map(String).slice(0, tierProfile.evidenceGapLimit) : local.evidenceGaps,
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
        message:
          input.language === "en"
            ? `LLM-enhanced analysis (${tierProfile.labels.en.analysis})`
            : `Analisis diperdalam dengan LLM (${tierProfile.labels.id.analysis})`
      }
    };
  } catch (error) {
    return {
      ...local,
      regulations: matchedRegulations,
      llmStatus: {
        used: false,
        model,
        message: `${input.language === "en" ? "LLM failed; using local rule-based response" : "LLM gagal; memakai jawaban lokal berbasis aturan"}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      }
    };
  }
}

export async function answerRegulationQuestion(
  question: string,
  language: "id" | "en",
  regulationContext: Regulation[] = regulations,
  tierProfile: TierWorkProfile = tierWorkProfiles.platinum,
  modelChoice: LlmModelChoice = DEFAULT_LLM_MODEL_CHOICE,
  managedPrompt?: { system?: string; instruction?: string }
) {
  const runtime = resolveLlmRuntime(modelChoice);
  const model = runtime.model;
  const context = (regulationContext.length ? regulationContext : regulations).slice(0, tierProfile.regulationContextLimit);
  const top = context.slice(0, 3);
  const localAnswer =
    language === "en"
      ? `Based on the available regulation cards, start with ${top[0]?.title || "the closest regulation"} (${top[0]?.citation || "local context"}). Then compare it with ${top[1]?.title || "supporting rules"}${top[1]?.citation ? ` (${top[1].citation})` : ""} for supporting requirements, evidence, and dispute positioning.`
      : `Berdasarkan kartu peraturan yang tersedia, mulai dari ${top[0]?.title || "aturan terdekat"} (${top[0]?.citation || "konteks lokal"}). Lalu sandingkan dengan ${top[1]?.title || "aturan pendukung"}${top[1]?.citation ? ` (${top[1].citation})` : ""} untuk syarat pendukung, pembuktian, dan posisi sengketa.`;
  const tierLocalAnswer =
    language === "en"
      ? `${tierProfile.labels.en.regulation} profile\n\n${localAnswer}\n\nNew-rule intake strategy: ${tierProfile.labels.en.ruleIntake}. Store each new rule with topic, title, citation, focus, source URL, content notes, relevance, and updated date.`
      : `Profil ${tierProfile.labels.id.regulation}\n\n${localAnswer}\n\nStrategi konsumsi aturan baru: ${tierProfile.labels.id.ruleIntake}. Simpan tiap aturan baru dengan topic, title, citation, focus, sourceUrl, content notes, relevance, dan updatedAt.`;

  if (!runtime.remoteAvailable) {
    const status = missingKeyStatus(language, modelChoice);
    return {
      answer: tierLocalAnswer,
      citations: top,
      llmStatus: {
        ...status,
        message:
          language === "en"
            ? `${status.message} Local ${tierProfile.labels.en.regulation} profile applied.`
            : `${status.message} Profil lokal ${tierProfile.labels.id.regulation} diterapkan.`
      }
    };
  }

  const defaultSystem =
    language === "en"
      ? `You are an Indonesian tax regulation chatbot for tax disputes. Answer from the provided regulation context only. Cover VAT and transfer pricing when relevant. Name where each rule is located. If context is insufficient, say so and identify what regulation should be added. ${tierProfile.prompts.en.regulationInstruction}`
      : `Anda adalah chatbot peraturan pajak Indonesia untuk sengketa pajak. Jawab hanya dari konteks peraturan yang diberikan. Bahas PPN dan transfer pricing jika relevan. Sebutkan lokasi setiap aturan. Jika konteks belum cukup, katakan dan sebutkan aturan apa yang perlu ditambahkan. ${tierProfile.prompts.id.regulationInstruction}`;
  const system = managedPrompt?.system?.trim() || defaultSystem;
  const prompt = JSON.stringify(
    {
      question,
      tierProfile: {
        tier: tierProfile.tier,
        regulationDepth: tierProfile.regulationDepth,
        regulationContextLimit: tierProfile.regulationContextLimit,
        ruleIntakeStrategy: tierProfile.labels[language].ruleIntake
      },
      regulationContext: context,
      responseLanguage: language,
      managedInstruction: managedPrompt?.instruction || ""
    },
    null,
    2
  );

  try {
    const answer = await callOpenAIText(prompt, system, modelChoice);
    return {
      answer,
      citations: top,
      llmStatus: {
        used: true,
        model,
        message:
          language === "en"
            ? `LLM regulation answer (${tierProfile.labels.en.regulation})`
            : `Jawaban aturan dari LLM (${tierProfile.labels.id.regulation})`
      }
    };
  } catch (error) {
    return {
      answer: `${tierLocalAnswer}\n\n${language === "en" ? "LLM note" : "Catatan LLM"}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      citations: top,
      llmStatus: {
        used: false,
        model,
        message: language === "en" ? "LLM failed; using local rule-based response." : "LLM gagal; memakai jawaban lokal berbasis aturan."
      }
    };
  }
}
