export const LLM_MODEL_HEADER = "x-tdp-model-choice";

export const MODEL_CHOICE_STORAGE_KEY = "tax-dispute-model-choice";

export const DEFAULT_LLM_MODEL_CHOICE = "openai-mini";

export const modelChoices = [
  {
    id: "openai-mini",
    label: "Mini",
    shortLabel: "Mini",
    provider: "openai",
    tone: "balanced"
  },
  {
    id: "openai-nano",
    label: "Nano",
    shortLabel: "Nano",
    provider: "openai",
    tone: "fast"
  },
  {
    id: "local-rules",
    label: "Local",
    shortLabel: "Local",
    provider: "local",
    tone: "offline"
  },
  {
    id: "local-onprem",
    label: "On-prem",
    shortLabel: "On-prem",
    provider: "local",
    tone: "private"
  }
] as const;

export type LlmModelChoice = (typeof modelChoices)[number]["id"];

const modelChoiceIds = new Set<string>(modelChoices.map((choice) => choice.id));

export function normalizeModelChoice(value: unknown): LlmModelChoice {
  const candidate = String(value || "").trim();
  return modelChoiceIds.has(candidate) ? (candidate as LlmModelChoice) : DEFAULT_LLM_MODEL_CHOICE;
}

export function modelChoiceFromRequest(request: Request): LlmModelChoice {
  return normalizeModelChoice(request.headers.get(LLM_MODEL_HEADER));
}

export function modelChoiceMeta(choice: LlmModelChoice) {
  return modelChoices.find((item) => item.id === choice) || modelChoices[0];
}
