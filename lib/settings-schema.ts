import {
  subscriptionTierConfigs,
  type SubscriptionTier,
  type SubscriptionTierConfig,
  type TierFeatureKey
} from "./admin";

export type PromptFeatureKey = "extraction" | "advancedAnalysis" | "disputeBot" | "regulationBot" | "referenceAssistant" | "tpLocalFile";
export type PromptLanguage = "id" | "en";

export type ManagedPrompt = {
  system: string;
  instruction: string;
};

export type PromptFeatureConfig = Record<PromptLanguage, ManagedPrompt>;

export type AdminRuntimeSettings = {
  plans: Record<SubscriptionTier, SubscriptionTierConfig>;
  prompts: Record<PromptFeatureKey, PromptFeatureConfig>;
  updatedAt: string;
};

const promptDefaults: Record<PromptFeatureKey, PromptFeatureConfig> = {
  extraction: {
    id: {
      system: "Anda adalah mesin ekstraksi dokumen sengketa pajak Indonesia. Ekstrak hanya data yang didukung dokumen. Jangan mengarang fakta. Kembalikan JSON saja.",
      instruction: "Pertahankan nama, nomor, tanggal, nilai, dan kutipan resmi sesuai sumber. Tandai informasi yang tidak tersedia sebagai kosong."
    },
    en: {
      system: "You are an Indonesian tax dispute document extraction engine. Extract only information supported by the document. Never invent facts. Return JSON only.",
      instruction: "Preserve official names, numbers, dates, amounts, and citations from the source. Leave unavailable information empty."
    }
  },
  advancedAnalysis: {
    id: {
      system: "Anda adalah senior advisor sengketa pajak Indonesia. Susun analisis praktis, hati-hati, transparan, dan berbasis bukti. Jangan mengarang fakta. Kembalikan JSON saja.",
      instruction: "Uji posisi WP dan DJP, kekuatan bukti, putusan pembanding, dasar aturan, risiko, counterargument, dan langkah tindakan advisor."
    },
    en: {
      system: "You are a senior Indonesian tax dispute advisor. Produce cautious, practical, transparent, evidence-based analysis. Never invent facts. Return JSON only.",
      instruction: "Test the taxpayer and tax authority positions, evidence, comparable decisions, regulations, risks, counterarguments, and advisor actions."
    }
  },
  disputeBot: {
    id: {
      system: "Anda adalah Dispute Analysis, asisten RAG sengketa pajak Indonesia. Jawab hanya dari konteks putusan dan peraturan yang diambil melalui retrieval. Sebutkan sumber dan batasan konteks.",
      instruction: "Prioritaskan kecocokan WP, nomor putusan, isu, fakta, dan bukti dibanding kemiripan outcome yang umum."
    },
    en: {
      system: "You are Dispute Analysis, an Indonesian tax dispute RAG assistant. Answer only from retrieved decisions and regulations. Cite sources and disclose context limits.",
      instruction: "Prioritize taxpayer, decision number, issue, fact, and evidence matches over generic outcome similarity."
    }
  },
  regulationBot: {
    id: {
      system: "Anda adalah chatbot RAG peraturan pajak Indonesia. Jawab hanya dari konteks aturan yang tersedia, sebutkan sitasi dan lokasi sumber, serta nyatakan jika konteks belum cukup.",
      instruction: "Perhatikan hierarki aturan, masa berlaku, perubahan, pencabutan, dan relevansi aturan terhadap pertanyaan."
    },
    en: {
      system: "You are an Indonesian tax regulation RAG assistant. Answer only from available rule context, cite the rule and source location, and disclose insufficient context.",
      instruction: "Consider legal hierarchy, effective period, amendments, revocations, and relevance to the question."
    }
  },
  referenceAssistant: {
    id: {
      system: "Anda adalah asisten pembaca referensi pajak. Jawab hanya berdasarkan dokumen referensi yang sedang dibuka dan jangan membuat sitasi yang tidak ada.",
      instruction: "Tunjukkan bagian dokumen yang mendukung jawaban dan nyatakan bila jawabannya tidak ditemukan."
    },
    en: {
      system: "You are a tax reference reading assistant. Answer only from the currently opened reference and never invent citations.",
      instruction: "Identify the supporting document section and say when the answer is not found."
    }
  },
  tpLocalFile: {
    id: {
      system: "Anda adalah senior transfer pricing advisor Indonesia dan mesin ekstraksi Local File. Gunakan hanya fakta yang didukung dokumen atau data proyek. Jangan mengarang. Kembalikan JSON saja jika diminta JSON.",
      instruction: "Petakan profil perusahaan, kepemilikan, pihak afiliasi, transaksi, analisis fungsi-aset-risiko, data keuangan, metode TP, PLI, pembanding, bukti yang kurang, dan dasar aturan secara transparan."
    },
    en: {
      system: "You are a senior Indonesian transfer pricing advisor and Local File extraction engine. Use only facts supported by source documents or project data. Never invent facts. Return JSON only when JSON is requested.",
      instruction: "Map the company profile, ownership, related parties, transactions, functions-assets-risks, financials, TP method, PLI, comparables, evidence gaps, and regulatory basis transparently."
    }
  }
};

function clonePlan(config: SubscriptionTierConfig): SubscriptionTierConfig {
  return { ...config, features: [...config.features] };
}

export function defaultAdminRuntimeSettings(): AdminRuntimeSettings {
  return {
    plans: {
      silver: clonePlan(subscriptionTierConfigs.silver),
      gold: clonePlan(subscriptionTierConfigs.gold),
      platinum: clonePlan(subscriptionTierConfigs.platinum)
    },
    prompts: structuredClone(promptDefaults),
    updatedAt: ""
  };
}

const tiers: SubscriptionTier[] = ["silver", "gold", "platinum"];
const featureKeys: TierFeatureKey[] = [
  "dashboard",
  "guided",
  "databaseRead",
  "databaseWrite",
  "disputeBot",
  "regulationRead",
  "regulationWrite",
  "reports",
  "tpLocalFile",
  "admin"
];
const promptKeys: PromptFeatureKey[] = ["extraction", "advancedAnalysis", "disputeBot", "regulationBot", "referenceAssistant", "tpLocalFile"];

function normalizeLimit(value: unknown, fallback: number | null) {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
}

function normalizePrompt(value: unknown, fallback: ManagedPrompt): ManagedPrompt {
  const source = value && typeof value === "object" ? (value as Partial<ManagedPrompt>) : {};
  return {
    system: String(source.system || fallback.system).trim().slice(0, 12000),
    instruction: String(source.instruction || fallback.instruction).trim().slice(0, 12000)
  };
}

export function normalizeAdminRuntimeSettings(value: unknown): AdminRuntimeSettings {
  const defaults = defaultAdminRuntimeSettings();
  const source = value && typeof value === "object" ? (value as Partial<AdminRuntimeSettings>) : {};
  const plans = {} as AdminRuntimeSettings["plans"];
  for (const tier of tiers) {
    const candidate = source.plans?.[tier];
    const fallback = defaults.plans[tier];
    const features = Array.isArray(candidate?.features)
      ? candidate.features.filter((feature): feature is TierFeatureKey => featureKeys.includes(feature as TierFeatureKey))
      : fallback.features;
    plans[tier] = {
      tier,
      monthlyDocumentLimit: normalizeLimit(candidate?.monthlyDocumentLimit, fallback.monthlyDocumentLimit),
      monthlyChatLimit: normalizeLimit(candidate?.monthlyChatLimit, fallback.monthlyChatLimit),
      features: Array.from(new Set(features))
    };
  }
  const prompts = {} as AdminRuntimeSettings["prompts"];
  for (const key of promptKeys) {
    prompts[key] = {
      id: normalizePrompt(source.prompts?.[key]?.id, defaults.prompts[key].id),
      en: normalizePrompt(source.prompts?.[key]?.en, defaults.prompts[key].en)
    };
  }
  return {
    plans,
    prompts,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : ""
  };
}

export function planHasFeature(
  plans: Record<SubscriptionTier, SubscriptionTierConfig>,
  tier: SubscriptionTier,
  feature: TierFeatureKey
) {
  return Boolean(plans[tier]?.features.includes(feature));
}

export const promptFeatureKeys = promptKeys;
