import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { requireFeature } from "@/lib/auth";
import { getTpLocalFileProjectById, hasDatabase, updateTpLocalFileProjectIfUnchanged } from "@/lib/db";
import { modelChoiceFromRequest } from "@/lib/model-options";
import { callOpenAIWithPdf, canUseConfidentialLlm, extractJsonObject } from "@/lib/openai";
import { getManagedPrompt } from "@/lib/server-settings";
import { mergeTpProjectState, tpExtractionScopes, type TpDocumentEvidence, type TpExtractionCoverage, type TpExtractionScope, type TpSourceDocument } from "@/lib/tp-local-file";

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
  let failedDocumentId = "";
  try {
    const body = await request.json();
    failedDocumentId = String(body.documentId || "");
    const language = body.language === "en" ? "en" : "id";
    const project = await getTpLocalFileProjectById(id);
    if (!project) return NextResponse.json({ error: "TP project not found." }, { status: 404 });
    if (auth.session.role !== "admin" && project.ownerUsername !== auth.session.username) {
      return NextResponse.json({ error: "You do not have access to this TP project." }, { status: 403 });
    }
    const modelChoice = modelChoiceFromRequest(request);
    if (!canUseConfidentialLlm(modelChoice)) {
      return NextResponse.json({ error: "Confidential document extraction requires an available on-prem model or TDP_CONFIDENTIAL_LLM_POLICY=allow_openai after documented approval." }, { status: 409 });
    }
    const document = project.documents.find((item) => item.id === body.documentId);
    if (!document?.url) return NextResponse.json({ error: "Source document not found." }, { status: 404 });
    const downloadUrl = document.downloadUrl || document.url;
    if (!trustedProjectBlob(document.url, project.id) || !trustedProjectBlob(downloadUrl, project.id)) {
      return NextResponse.json({ error: "The source document is not a trusted TP Local File Blob." }, { status: 400 });
    }

    const privateBlob = await get(downloadUrl, { access: "private", useCache: false });
    if (!privateBlob || privateBlob.statusCode !== 200) throw new Error("Could not read the private source document.");
    const bytes = Buffer.from(await new Response(privateBlob.stream).arrayBuffer());
    if (bytes.byteLength > 30 * 1024 * 1024) throw new Error("Source document exceeds the 30 MB AI extraction limit.");
    const contentType = privateBlob.blob.contentType || (document.filename.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const fileData = `data:${contentType};base64,${bytes.toString("base64")}`;
    const managed = await getManagedPrompt("tpLocalFile", language);
    const system = managed.system;
    const allowedScopeIds = new Set<TpExtractionScope>(tpExtractionScopes.map((scope) => scope.id));
    const requestedScopes = (document.requestedScopes || []).filter((scope) => allowedScopeIds.has(scope));
    const scopeInstruction = requestedScopes.length
      ? `Inspect these selected content groups: ${requestedScopes.join(", ")}. A single file can contain several groups.`
      : `Auto-detect every applicable content group in this file. A single file can contain company, ownership, transaction, financial, policy, agreement, and benchmarking information at the same time.`;
    const prompt = `${managed.instruction}\n\n${scopeInstruction}

Do not assume the file belongs to only one document category. Extract every supported fact found within the requested groups and report which groups were detected. Return JSON only with this shape:
{
  "documentSummary":"short source summary",
  "detectedScopes":["identity","ownership_management"],
  "coverage":[{"scope":"identity","status":"found","note":"what was found or remains missing"}],
  "evidence":[{"fieldPaths":["companyName","financialData.revenue"],"page":1,"section":"Company information","table":"","excerpt":"short exact supporting excerpt","confidence":0.95}],
  "patch": {
    "companyName":"", "companyShortName":"", "npwp":"", "companyAddress":"", "establishmentInfo":"", "fiscalYear":"", "parentCompany":"", "parentGroup":"", "brandName":"", "employeeCount":"", "shareholdersSource":"", "managementSource":"",
    "shareholders":[{"name":"","shares":"","capital":"","percentage":""}],
    "management":[{"position":"","name":""}],
    "affiliatedParties":[{"name":"","country":"","relationship":"","transactionType":""}],
    "businessActivities":"", "products":[{"name":"","description":""}], "businessStrategy":"", "businessRestructuring":"", "organizationStructure":"", "organizationDepartments":[{"name":"","head":"","employees":""}],
    "transactionType":"", "transactionDetails":"", "pricingPolicy":"", "backgroundTransaction":"", "supplyChainManagement":"",
    "affiliatedTransactions":[{"counterparty":"","country":"","affiliationType":"","transactionType":"","value":"","currency":"IDR","note":""}],
    "independentTransactions":[{"counterparty":"","country":"","affiliationType":"","transactionType":"","value":"","currency":"IDR","note":""}],
    "financialData":{"revenue":"","costOfGoodsSold":"","grossProfit":"","operatingExpenses":"","operatingProfit":"","netIncome":""},
    "financialDataPrior":{"revenue":"","costOfGoodsSold":"","grossProfit":"","operatingExpenses":"","operatingProfit":"","netIncome":""},
    "comparabilityFactors":"", "searchCriteriaResults":[{"step":"","criteria":"","resultCount":""}], "rejectionMatrix":[{"name":"","reason":"","accepted":false}], "comparableCompanies":[{"name":"","country":"","description":"","ratio":""}],
    "selectedMethod":"", "selectedPli":"", "testedParty":"", "analysisPeriod":"", "quartileRange":{"q1":"","median":"","q3":""}, "testedPartyRatio":"", "nonFinancialEvents":""
  }
}
Allowed scope values: ${tpExtractionScopes.map((scope) => scope.id).join(", ")}.
Keep amounts exactly as shown and do not calculate missing figures. Omit unsupported facts by leaving them empty. A method, PLI, tested party, comparable acceptance, quartile, or conclusion may only be extracted when the source explicitly states it; otherwise leave it empty for advisor input. Do not put new analysis or conclusions in the patch.`;
    const raw = await callOpenAIWithPdf(prompt, system, { filename: document.filename, fileData }, modelChoice, { reasoningEffort: "medium", textVerbosity: "high" });
    const parsed = extractJsonObject(raw) as { documentSummary?: string; detectedScopes?: unknown; coverage?: unknown; evidence?: unknown; patch?: unknown };
    const detectedScopes = Array.isArray(parsed.detectedScopes)
      ? parsed.detectedScopes.map(String).filter((scope): scope is TpExtractionScope => allowedScopeIds.has(scope as TpExtractionScope))
      : [];
    const coverage: TpExtractionCoverage[] = Array.isArray(parsed.coverage)
      ? parsed.coverage.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const candidate = entry as Record<string, unknown>;
          const scope = String(candidate.scope || "") as TpExtractionScope;
          const status = String(candidate.status || "not_found");
          if (!allowedScopeIds.has(scope) || !["found", "partial", "not_found"].includes(status)) return [];
          return [{ scope, status: status as TpExtractionCoverage["status"], note: String(candidate.note || "").slice(0, 500) }];
        })
      : [];
    const evidence: TpDocumentEvidence[] = Array.isArray(parsed.evidence)
      ? parsed.evidence.flatMap((entry, index) => {
          if (!entry || typeof entry !== "object") return [];
          const candidate = entry as Record<string, unknown>;
          const fieldPaths = Array.isArray(candidate.fieldPaths)
            ? candidate.fieldPaths.map(String).map((path) => path.trim()).filter((path) => /^[a-zA-Z][a-zA-Z0-9.[\]#_-]{0,240}$/.test(path)).slice(0, 30)
            : [];
          const excerpt = String(candidate.excerpt || "").trim().slice(0, 2_000);
          const pageValue = Number(candidate.page);
          if (!fieldPaths.length || !excerpt) return [];
          return [{
            id: `${document.id}-evidence-${index + 1}`,
            fieldPaths,
            ...(Number.isInteger(pageValue) && pageValue > 0 ? { page: pageValue } : {}),
            ...(String(candidate.section || "").trim() ? { section: String(candidate.section).trim().slice(0, 300) } : {}),
            ...(String(candidate.table || "").trim() ? { table: String(candidate.table).trim().slice(0, 300) } : {}),
            excerpt,
            confidence: Number.isFinite(Number(candidate.confidence)) ? Math.max(0, Math.min(1, Number(candidate.confidence))) : 0.5
          }];
        })
      : [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const currentProject = await getTpLocalFileProjectById(id);
      if (!currentProject) return NextResponse.json({ error: "TP project was deleted during extraction." }, { status: 409 });
      const currentDocument = currentProject.documents.find((item) => item.id === document.id);
      if (!currentDocument) return NextResponse.json({ error: "Source document was removed during extraction." }, { status: 409 });
      const now = new Date().toISOString();
      const documents = currentProject.documents.map((item): TpSourceDocument => item.id === document.id ? {
        ...item,
        status: "extracted",
        extractionMessage: String(parsed.documentSummary || "Document extracted and merged."),
        extractedAt: now,
        detectedScopes,
        coverage,
        evidence
      } : item);
      const updatedProject = {
        ...currentProject,
        state: mergeTpProjectState(currentProject.state, parsed.patch || {}, document.id),
        documents,
        status: "extracted" as const,
        updatedAt: now
      };
      if (await updateTpLocalFileProjectIfUnchanged(updatedProject, currentProject.updatedAt)) {
        return NextResponse.json({ project: updatedProject, documentSummary: parsed.documentSummary || "" });
      }
    }
    return NextResponse.json({ error: "The TP project kept changing during extraction. The extracted patch was not applied; retry after current edits finish." }, { status: 409 });
  } catch (error) {
    if (failedDocumentId) {
      const failedProject = await getTpLocalFileProjectById(id).catch(() => null);
      if (failedProject && (auth.session.role === "admin" || failedProject.ownerUsername === auth.session.username)) {
        const now = new Date().toISOString();
        const failedUpdate = {
          ...failedProject,
          documents: failedProject.documents.map((item): TpSourceDocument => item.id === failedDocumentId ? {
            ...item,
            status: "failed" as const,
            extractionMessage: error instanceof Error ? error.message.slice(0, 1_000) : "TP document extraction failed."
          } : item),
          updatedAt: now
        };
        await updateTpLocalFileProjectIfUnchanged(failedUpdate, failedProject.updatedAt).catch(() => undefined);
      }
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "TP document extraction failed." }, { status: 500 });
  }
}
