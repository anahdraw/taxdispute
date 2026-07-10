import type { SubscriptionTier } from "./admin";

export type AnalysisDepth = "simple" | "standard" | "deep";
export type RegulationDepth = "basic" | "source-based" | "synthesis";

export type TierWorkProfile = {
  tier: SubscriptionTier;
  analysisDepth: AnalysisDepth;
  regulationDepth: RegulationDepth;
  decisionContextLimit: number;
  regulationContextLimit: number;
  smartDecisionLimit: number;
  smartRegulationLimit: number;
  evidenceGapLimit: number;
  labels: {
    en: {
      analysis: string;
      regulation: string;
      comparable: string;
      report: string;
      ruleIntake: string;
    };
    id: {
      analysis: string;
      regulation: string;
      comparable: string;
      report: string;
      ruleIntake: string;
    };
  };
  prompts: {
    en: {
      analysisInstruction: string;
      smartChatInstruction: string;
      regulationInstruction: string;
    };
    id: {
      analysisInstruction: string;
      smartChatInstruction: string;
      regulationInstruction: string;
    };
  };
};

export const tierWorkProfiles: Record<SubscriptionTier, TierWorkProfile> = {
  silver: {
    tier: "silver",
    analysisDepth: "simple",
    regulationDepth: "basic",
    decisionContextLimit: 1,
    regulationContextLimit: 2,
    smartDecisionLimit: 3,
    smartRegulationLimit: 2,
    evidenceGapLimit: 4,
    labels: {
      en: {
        analysis: "Simple triage",
        regulation: "Basic rule check",
        comparable: "Top match only",
        report: "Short advisor note",
        ruleIntake: "Manual summary"
      },
      id: {
        analysis: "Triage sederhana",
        regulation: "Cek aturan dasar",
        comparable: "Top match saja",
        report: "Catatan advisor ringkas",
        ruleIntake: "Ringkasan manual"
      }
    },
    prompts: {
      en: {
        analysisInstruction:
          "Use the Silver profile: produce a concise triage answer. Focus on issue summary, initial risk, the strongest evidence gaps, and 3-5 next steps. Keep the recommendation short and do not draft a full legal memo.",
        smartChatInstruction:
          "Use the Silver profile: answer briefly from the strongest retrieved context only. Give practical next steps and clearly say when deeper database or regulation review is needed.",
        regulationInstruction:
          "Use the Silver profile: explain the closest rule cards in plain language, cite the main source, and identify what rule or evidence should be added next. Avoid broad synthesis."
      },
      id: {
        analysisInstruction:
          "Gunakan profil Silver: buat jawaban triage yang ringkas. Fokus pada ringkasan isu, risiko awal, celah bukti terkuat, dan 3-5 langkah berikutnya. Rekomendasi tetap pendek dan jangan membuat memo hukum penuh.",
        smartChatInstruction:
          "Gunakan profil Silver: jawab singkat dari konteks retrieval terkuat saja. Beri langkah praktis dan katakan jelas bila perlu pendalaman database atau peraturan.",
        regulationInstruction:
          "Gunakan profil Silver: jelaskan kartu aturan terdekat dengan bahasa sederhana, sebutkan sumber utama, dan identifikasi aturan/bukti yang perlu ditambahkan. Hindari sintesis luas."
      }
    }
  },
  gold: {
    tier: "gold",
    analysisDepth: "standard",
    regulationDepth: "source-based",
    decisionContextLimit: 3,
    regulationContextLimit: 5,
    smartDecisionLimit: 6,
    smartRegulationLimit: 5,
    evidenceGapLimit: 6,
    labels: {
      en: {
        analysis: "Advisor analysis",
        regulation: "Source-based review",
        comparable: "Limited comparables",
        report: "Advisor draft",
        ruleIntake: "Import + source links"
      },
      id: {
        analysis: "Analisis advisor",
        regulation: "Review berbasis sumber",
        comparable: "Pembanding terbatas",
        report: "Draft advisor",
        ruleIntake: "Import + link sumber"
      }
    },
    prompts: {
      en: {
        analysisInstruction:
          "Use the Gold profile: produce an advisor-ready analysis with issue framing, legal basis, evidence gaps, comparable decision positioning, recommendation, and next steps. Be detailed but avoid overlong memo drafting.",
        smartChatInstruction:
          "Use the Gold profile: compare the strongest retrieved decisions and regulation cards, cite numbers/citations, explain why each source matters, and end with advisor next steps.",
        regulationInstruction:
          "Use the Gold profile: answer from source-based regulation cards, compare relevant rules, explain evidence and procedural implications, and list missing regulation cards if context is incomplete."
      },
      id: {
        analysisInstruction:
          "Gunakan profil Gold: buat analisis siap advisor dengan framing isu, dasar hukum, celah bukti, posisi putusan pembanding, rekomendasi, dan langkah berikutnya. Cukup mendalam tetapi tidak sepanjang memo penuh.",
        smartChatInstruction:
          "Gunakan profil Gold: bandingkan putusan dan kartu aturan terkuat, sebutkan nomor/sitasi, jelaskan relevansinya, dan akhiri dengan langkah advisor.",
        regulationInstruction:
          "Gunakan profil Gold: jawab dari kartu aturan berbasis sumber, bandingkan aturan relevan, jelaskan implikasi bukti/prosedur, dan daftar aturan yang masih perlu ditambahkan bila konteks belum lengkap."
      }
    }
  },
  platinum: {
    tier: "platinum",
    analysisDepth: "deep",
    regulationDepth: "synthesis",
    decisionContextLimit: 5,
    regulationContextLimit: 8,
    smartDecisionLimit: 8,
    smartRegulationLimit: 8,
    evidenceGapLimit: 8,
    labels: {
      en: {
        analysis: "Deep case memo",
        regulation: "Full synthesis",
        comparable: "Full comparable set",
        report: "Detailed memo",
        ruleIntake: "Structured knowledge ops"
      },
      id: {
        analysis: "Memo kasus mendalam",
        regulation: "Sintesis penuh",
        comparable: "Set pembanding penuh",
        report: "Memo detail",
        ruleIntake: "Knowledge ops terstruktur"
      }
    },
    prompts: {
      en: {
        analysisInstruction:
          "Use the Platinum profile: produce a deep case memo suitable for senior advisor review. Include executive summary, chronology, tax authority position, taxpayer position, disputed amount mapping, legal/regulatory basis, evidence sufficiency, counterarguments, comparable decision strategy, procedural strategy, document checklist, and next steps.",
        smartChatInstruction:
          "Use the Platinum profile: synthesize retrieved decisions and regulations as a senior tax dispute memo. Compare patterns, distinguish weak and strong comparables, flag missing evidence, and propose argument strategy.",
        regulationInstruction:
          "Use the Platinum profile: synthesize the regulation database structurally. Map rule hierarchy, source reliability, procedural requirements, evidence consequences, conflicts or gaps, and a knowledge-update plan for missing rules."
      },
      id: {
        analysisInstruction:
          "Gunakan profil Platinum: buat memo kasus mendalam untuk review senior advisor. Sertakan ringkasan eksekutif, kronologi, posisi DJP, posisi WP, pemetaan nilai sengketa, dasar hukum/peraturan, kecukupan bukti, counterargument, strategi putusan pembanding, strategi prosedural, checklist dokumen, dan langkah berikutnya.",
        smartChatInstruction:
          "Gunakan profil Platinum: sintesis putusan dan peraturan hasil retrieval seperti memo senior sengketa pajak. Bandingkan pola, bedakan pembanding kuat/lemah, tandai bukti yang kurang, dan usulkan strategi argumentasi.",
        regulationInstruction:
          "Gunakan profil Platinum: sintesis database aturan secara terstruktur. Petakan hierarki aturan, reliabilitas sumber, syarat prosedural, konsekuensi pembuktian, konflik/celah, dan rencana update knowledge untuk aturan yang hilang."
      }
    }
  }
};

export function isTierDepthEnabled() {
  const flag = process.env.TDP_TIER_DEPTH_ENABLED;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return process.env.NODE_ENV !== "production";
}

export function getTierWorkProfile(tier: SubscriptionTier) {
  return tierWorkProfiles[tier] || tierWorkProfiles.silver;
}

export function getActiveTierWorkProfile(tier: SubscriptionTier) {
  return isTierDepthEnabled() ? getTierWorkProfile(tier) : tierWorkProfiles.platinum;
}

