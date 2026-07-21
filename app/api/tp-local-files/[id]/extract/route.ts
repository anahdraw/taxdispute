import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth";
import { getTpLocalFileProjectById, hasDatabase, upsertTpLocalFileProject } from "@/lib/db";
import { modelChoiceFromRequest } from "@/lib/model-options";
import { callOpenAIWithPdf, extractJsonObject } from "@/lib/openai";
import { getManagedPrompt } from "@/lib/server-settings";
import { mergeTpProjectState, type TpSourceDocument } from "@/lib/tp-local-file";

export const runtime = "nodejs";
export const maxDuration = 120;

type RouteContext = { params: Promise<{ id: string }> };

function trustedProjectBlob(value: unknown, projectId: string) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:"
      && url.hostname.endsWith(".blob.vercel-storage.com")
      && url.pathname.startsWith(`/tp-local-files/${projectId}/`);
  } catch {
    return false;
  }
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireFeature(request, "tpLocalFile");
  if ("response" in auth) return auth.response;
  if (!hasDatabase()) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  const { id } = await context.params;
  try {
    const body = await request.json();
    const language = body.language === "en" ? "en" : "id";
    const project = await getTpLocalFileProjectById(id);
    if (!project) return NextResponse.json({ error: "TP project not found." }, { status: 404 });
    if (auth.session.role !== "admin" && project.ownerUsername !== auth.session.username) {
      return NextResponse.json({ error: "You do not have access to this TP project." }, { status: 403 });
    }
    const document = project.documents.find((item) => item.id === body.documentId);
    if (!document?.url) return NextResponse.json({ error: "Source document not found." }, { status: 404 });
    const downloadUrl = document.downloadUrl || document.url;
    if (!trustedProjectBlob(document.url, project.id) || !trustedProjectBlob(downloadUrl, project.id)) {
      return NextResponse.json({ error: "The source document is not a trusted TP Local File Blob." }, { status: 400 });
    }

    const fileResponse = await fetch(downloadUrl);
    if (!fileResponse.ok) throw new Error(`Could not read source document (${fileResponse.status}).`);
    const bytes = Buffer.from(await fileResponse.arrayBuffer());
    if (bytes.byteLength > 30 * 1024 * 1024) throw new Error("Source document exceeds the 30 MB AI extraction limit.");
    const contentType = fileResponse.headers.get("content-type") || (document.filename.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const fileData = `data:${contentType};base64,${bytes.toString("base64")}`;
    const managed = await getManagedPrompt("tpLocalFile", language);
    const system = managed.system;
    const prompt = `${managed.instruction}\n\nExtract only information supported by this ${document.kind} source document. Return JSON only with this shape:
{
  "documentSummary":"short source summary",
  "patch": {
    "companyName":"", "companyShortName":"", "npwp":"", "companyAddress":"", "establishmentInfo":"", "fiscalYear":"", "parentCompany":"", "parentGroup":"", "brandName":"", "employeeCount":"",
    "shareholders":[{"name":"","shares":"","capital":"","percentage":""}],
    "management":[{"position":"","name":""}],
    "affiliatedParties":[{"name":"","country":"","relationship":"","transactionType":""}],
    "businessActivities":"", "products":[{"name":"","description":""}], "businessStrategy":"", "businessRestructuring":"", "organizationStructure":"",
    "transactionType":"", "transactionDetails":"", "pricingPolicy":"",
    "affiliatedTransactions":[{"counterparty":"","country":"","affiliationType":"","transactionType":"","value":"","currency":"IDR","note":""}],
    "independentTransactions":[{"counterparty":"","country":"","affiliationType":"","transactionType":"","value":"","currency":"IDR","note":""}],
    "financialData":{"revenue":"","costOfGoodsSold":"","grossProfit":"","operatingExpenses":"","operatingProfit":"","netIncome":""},
    "comparabilityFactors":"", "comparableCompanies":[{"name":"","country":"","description":"","ratio":""}],
    "selectedMethod":"", "selectedPli":"", "testedParty":"", "analysisPeriod":"", "quartileRange":{"q1":"","median":"","q3":""}, "testedPartyRatio":"", "nonFinancialEvents":""
  }
}
Keep amounts exactly as shown and do not calculate missing figures. Omit unsupported facts by leaving them empty. Do not put analysis or conclusions in the patch.`;
    const raw = await callOpenAIWithPdf(prompt, system, { filename: document.filename, fileData }, modelChoiceFromRequest(request));
    const parsed = extractJsonObject(raw) as { documentSummary?: string; patch?: unknown };
    const mergedState = mergeTpProjectState(project.state, parsed.patch || {}, document.id);
    const now = new Date().toISOString();
    const documents = project.documents.map((item): TpSourceDocument => item.id === document.id ? {
      ...item,
      status: "extracted",
      extractionMessage: String(parsed.documentSummary || "Document extracted and merged."),
      extractedAt: now
    } : item);
    const updatedProject = { ...project, state: mergedState, documents, status: "extracted" as const, updatedAt: now };
    await upsertTpLocalFileProject(updatedProject);
    return NextResponse.json({ project: updatedProject, documentSummary: parsed.documentSummary || "" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "TP document extraction failed." }, { status: 500 });
  }
}
