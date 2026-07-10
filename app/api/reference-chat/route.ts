import { NextResponse } from "next/server";
import { modelChoiceFromRequest } from "@/lib/model-options";
import { callOpenAIText, configuredModel, hasRemoteLlm, missingKeyStatus } from "@/lib/openai";
import { requireAuth } from "@/lib/auth";

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

    if (!hasRemoteLlm(modelChoice)) {
      return NextResponse.json({
        answer: localReferenceAnswer(question, context, language),
        llmStatus: missingKeyStatus(language, modelChoice)
      });
    }

    const system =
      language === "en"
        ? "You answer questions about one opened Indonesian tax dispute reference. Use only the provided reference context. If the answer is not supported, say so. Be concise, practical, and cite the decision number, article, or cited rule when available."
        : "Anda menjawab pertanyaan tentang satu referensi sengketa pajak Indonesia yang sedang dibuka. Gunakan hanya konteks referensi yang diberikan. Jika jawaban tidak didukung konteks, katakan belum cukup. Jawab ringkas, praktis, dan sebutkan nomor putusan, pasal, atau aturan jika tersedia.";
    const prompt = JSON.stringify(
      {
        referenceType: body.kind || "reference",
        referenceTitle: body.title || "",
        question,
        referenceContext: context,
        responseLanguage: language
      },
      null,
      2
    );
    const answer = await callOpenAIText(prompt, system, modelChoice);
    return NextResponse.json({
      answer,
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
