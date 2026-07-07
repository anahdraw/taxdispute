import { NextResponse } from "next/server";
import { extractionToAnalyzeInput, extractPdfWithLlm } from "@/lib/extraction";
import { hasOpenAIKey } from "@/lib/openai";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = requireAuth(request);
  if ("response" in auth) return auth.response;
  try {
    if (!hasOpenAIKey()) {
      return NextResponse.json({ error: "OPENAI_API_KEY is not configured in the server environment." }, { status: 500 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const language = formData.get("language") === "id" ? "id" : "en";
    if (!(file instanceof File)) {
      return NextResponse.json({ error: language === "id" ? "File PDF belum dipilih." : "PDF file is required." }, { status: 400 });
    }
    if (file.type && file.type !== "application/pdf") {
      return NextResponse.json({ error: language === "id" ? "File harus PDF." : "File must be a PDF." }, { status: 400 });
    }

    const extraction = await extractPdfWithLlm(file, language);
    return NextResponse.json({
      extraction,
      analyzeInput: extractionToAnalyzeInput(extraction, language)
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "PDF extraction failed." },
      { status: 500 }
    );
  }
}
