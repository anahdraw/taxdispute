import { NextResponse } from "next/server";
import { modelChoiceFromRequest } from "@/lib/model-options";
import { callOpenAIText, configuredModel, hasRemoteLlm, missingKeyStatus } from "@/lib/openai";
import { requireAuth } from "@/lib/auth";
import { getManagedPrompt } from "@/lib/server-settings";
import { assessTaxQueryDomain } from "@/lib/query-domain";
import { assessTrust } from "@/lib/citation-trust";
import { chatAbstentionAnswer } from "@/lib/chat-trust";

export const runtime = "nodejs";

function trimContext(value: string) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 14000);
}

function localReferenceAnswer(question: string, context: string, language: "id" | "en") {
  const tokens = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 3)
    .slice(0, 8);
  const sentences = context
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const hits = sentences.filter((sentence) => tokens.some((token) => sentence.toLowerCase().includes(token))).slice(0, 5);

  if (!hits.length) {
    return language === "en"
      ? "I could not find a clear answer in this reference context. Try a more specific keyword or review the PDF directly in the viewer."
      : "Saya belum menemukan jawaban yang jelas dari konteks referensi ini. Coba kata kunci yang lebih spesifik atau cek langsung PDF di viewer.";
  }

  return language === "en"
    ? `Based on this reference context:\n\n${hits.map((item) => `- ${item}`).join("\n")}`
    : `Berdasarkan konteks referensi ini:\n\n${hits.map((item) => `- ${item}`).join("\n")}`;
}

export async function POST(request: Request) {
  const auth = requireAuth(request);
  if ("response" in auth) return auth.response;
  const modelChoice = modelChoiceFromRequest(request);
  try {
    const body = (await request.json()) as {
      question?: string;
      language?: "id" | "en";
      title?: string;
      kind?: string;
      sourceText?: string;
    };
    const question = String(body.question || "").trim();
    const language = body.language === "en" ? "en" : "id";
    const context = trimContext(String(body.sourceText || ""));

    if (!question) {
      return NextResponse.json({ error: language === "en" ? "Question is required." : "Pertanyaan belum diisi." }, { status: 400 });
    }
    if (!context) {
      return NextResponse.json({ error: language === "en" ? "Reference context is empty." : "Konteks referensi kosong." }, { status: 400 });
    }
    const domain = assessTaxQueryDomain(question);
    const trust = assessTrust([], {
      question,
      language,
      policy: { minimumEvidence: 0, requireVerifiedSource: false, requireLocator: false, requireKnownRegulationStatus: false }
    });
    if (!domain.inScope || trust.temporal?.valid === false) {
      return NextResponse.json({
        answer: chatAbstentionAnswer(language, trust),
        trust: { ...trust, validationStage: "source-bound-preflight" },
        llmStatus: { used: false, model: "trust-gate", message: language === "en" ? "Answer withheld by the reference trust gate." : "Jawaban ditahan oleh trust gate referensi." }
      });
    }

    if (!hasRemoteLlm(modelChoice)) {
      return NextResponse.json({
        answer: localReferenceAnswer(question, context, language),
        trust: { ...trust, validationStage: "source-bound-preflight" },
        llmStatus: missingKeyStatus(language, modelChoice)
      });
    }

    const managedPrompt = await getManagedPrompt("referenceAssistant", language);
    const defaultSystem =
      language === "en"
        ? "You answer questions about one opened Indonesian tax dispute reference. Use only the provided reference context. If the answer is not supported, say so. Be concise, practical, and cite the decision number, article, or cited rule when available."
        : "Anda menjawab pertanyaan tentang satu referensi sengketa pajak Indonesia yang sedang dibuka. Gunakan hanya konteks referensi yang diberikan. Jika jawaban tidak didukung konteks, katakan belum cukup. Jawab ringkas, praktis, dan sebutkan nomor putusan, pasal, atau aturan jika tersedia.";
    const system = managedPrompt.system || defaultSystem;
    const prompt = JSON.stringify(
      {
        referenceType: body.kind || "reference",
        referenceTitle: body.title || "",
        question,
        referenceContext: context,
        responseLanguage: language,
        managedInstruction: managedPrompt.instruction
      },
      null,
      2
    );
    const answer = await callOpenAIText(prompt, system, modelChoice);
    return NextResponse.json({
      answer,
      trust: { ...trust, validationStage: "source-bound-preflight" },
      llmStatus: {
        used: true,
        model: configuredModel(modelChoice),
        message: language === "en" ? "Reference smartbot answered with opened reference context." : "Smartbot referensi menjawab dengan konteks referensi yang sedang dibuka."
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not answer reference question." },
      { status: 500 }
    );
  }
}
