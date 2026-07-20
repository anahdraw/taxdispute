import { NextResponse } from "next/server";
import { extractionToAnalyzeInput, extractPdfWithLlm } from "@/lib/extraction";
import { modelChoiceFromRequest } from "@/lib/model-options";
import { getManagedPrompt } from "@/lib/server-settings";
import { canUsePdfModel, configuredModel } from "@/lib/openai";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = requireAuth(request);
  if ("response" in auth) return auth.response;
  const modelChoice = modelChoiceFromRequest(request);
  try {
    if (!canUsePdfModel(modelChoice)) {
      return NextResponse.json(
        {
          error:
            modelChoice === "local-rules"
              ? "Local rules cannot extract PDF files. Choose Mini/Nano or configure an on-prem PDF-capable endpoint."
              : `PDF extraction model is not configured for ${configuredModel(modelChoice)}.`
        },
        { status: 500 }
      );
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

    const extraction = await extractPdfWithLlm(file, language, modelChoice, await getManagedPrompt("extraction", language));
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
