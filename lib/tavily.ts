import type { TpExternalResearchSource, TpProjectState } from "./tp-local-file";

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string;
};

type TavilyResponse = {
  results?: TavilyResult[];
  request_id?: string;
  detail?: string | { error?: string };
};

export type TpExternalResearchBundle = {
  status: "not_configured" | "completed" | "partial" | "failed";
  sources: TpExternalResearchSource[];
  warnings: string[];
  queries: Array<{ sourceType: TpExternalResearchSource["sourceType"]; query: string }>;
};

const officialDomains = [
  "pajak.go.id",
  "jdih.kemenkeu.go.id",
  "peraturan.bpk.go.id",
  "oecd.org",
  "un.org"
];

const filingDomains = [
  "annualreports.com",
  "idx.co.id",
  "sgx.com",
  "set.or.th",
  "bursamalaysia.com",
  "hkexnews.hk"
];

export function hasTavilyKey() {
  return Boolean(process.env.TAVILY_API_KEY?.trim());
}

function cleanText(value: string, limit = 1200) {
  return value.replace(/\\n/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function privateResearchTerms(state: TpProjectState) {
  const values = [
    state.companyName,
    state.companyShortName,
    state.parentCompany,
    state.parentGroup,
    state.brandName,
    state.npwp,
    state.companyAddress,
    ...state.shareholders.map((item) => item.name),
    ...state.management.map((item) => item.name),
    ...state.affiliatedParties.map((item) => item.name),
    ...state.affiliatedTransactions.map((item) => item.counterparty),
    ...state.independentTransactions.map((item) => item.counterparty),
    ...state.organizationDepartments.map((item) => item.head)
  ].map((value) => cleanText(value || "", 500)).filter((value) => value.length > 2);
  const commonTokens = new Set([
    "pt", "cv", "tbk", "persero", "company", "corporation", "limited", "ltd", "inc", "indonesia",
    "group", "holding", "tested", "party", "pihak", "diuji"
  ]);
  const identifyingTokens = values.flatMap((value) => value.split(/[^a-zA-ZÀ-ÿ0-9]+/))
    .map((value) => value.trim())
    .filter((value) => value.length > 3 && !commonTokens.has(value.toLowerCase()));
  return Array.from(new Set([...values, ...identifyingTokens])).sort((a, b) => b.length - a.length);
}

export function sanitizeTpResearchTerm(value: unknown, state: TpProjectState, fallback = "") {
  let sanitized = cleanText(String(value || ""), 1200);
  for (const privateTerm of privateResearchTerms(state)) {
    sanitized = sanitized.replace(new RegExp(escapeRegExp(privateTerm), "gi"), " ");
  }
  sanitized = sanitized
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, " ")
    .replace(/\b(?:NPWP|TIN|tax\s*id)\s*[:#-]?\s*[\d .-]{8,}\b/gi, " ")
    .replace(/\b\d{1,3}(?:[.\s-]\d{2,4}){2,}\b/g, " ")
    .replace(/\b(?:IDR|USD|EUR|SGD|Rp)\s*[\d.,]+\b/gi, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/\b(?:PT|CV|Tbk|Persero|Ltd|Limited|Inc|Corporation)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized || fallback;
}

function publicDescriptor(state: TpProjectState) {
  const productDescriptions = state.products.map((item) => item.description).filter(Boolean).join(" ");
  const descriptor = [state.transactionType, productDescriptions, state.businessActivities]
    .filter(Boolean)
    .join(" ");

  const stopWords = new Set([
    "yang", "dan", "dengan", "untuk", "dari", "pada", "atau", "dalam", "adalah", "serta",
    "the", "and", "with", "for", "from", "into", "this", "that", "company", "taxpayer"
  ]);
  const words = sanitizeTpResearchTerm(descriptor, state)
    .split(/[^a-zA-ZÀ-ÿ0-9/&-]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !stopWords.has(word.toLowerCase()));
  return Array.from(new Set(words.map((word) => word.toLowerCase()))).slice(0, 14).join(" ") || "business services";
}

export function buildTpResearchQueries(state: TpProjectState): TpExternalResearchBundle["queries"] {
  const descriptor = publicDescriptor(state);
  const descriptorTerms = descriptor.split(/\s+/).filter(Boolean);
  const comparableDescriptorReady = descriptor !== "business services" && descriptorTerms.length >= 4;
  const comparableDescriptor = descriptorTerms.slice(0, 8).join(" ");
  const method = sanitizeTpResearchTerm(state.selectedMethod, state, "transfer pricing method").slice(0, 100);
  const pli = sanitizeTpResearchTerm(state.selectedPli, state, "profit level indicator").slice(0, 100);
  const testedParty = sanitizeTpResearchTerm(state.testedParty, state, "tested party").slice(0, 100);
  const candidates: TpExternalResearchBundle["queries"] = [
    {
      sourceType: "official",
      query: `Indonesia transfer pricing ${method} ${pli} official regulation OECD guidance`
    },
    {
      sourceType: "industry",
      query: `${descriptor} industry value chain market drivers Indonesia Southeast Asia`
    },
    ...(comparableDescriptorReady ? [{
      sourceType: "comparable_candidate" as const,
      query: `publicly listed independent companies ${comparableDescriptor} ${testedParty} Indonesia Southeast Asia company profile competitors`
    }, {
      sourceType: "comparable_candidate" as const,
      query: `${comparableDescriptor} listed company annual report investor relations business segments products Southeast Asia`
    }] : [])
  ];
  return candidates.map((item) => ({ ...item, query: sanitizeTpResearchTerm(item.query, state, "transfer pricing research") }));
}

function hostName(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function matchesDomain(domain: string, candidates: string[]) {
  return candidates.some((candidate) => domain === candidate || domain.endsWith(`.${candidate}`));
}

function sourceQuality(url: string, title: string, sourceType: TpExternalResearchSource["sourceType"]): Pick<TpExternalResearchSource, "qualityTier" | "qualityReason"> {
  const domain = hostName(url);
  const normalized = `${title} ${url}`.toLowerCase();
  if (matchesDomain(domain, officialDomains) || /(?:^|\.)gov\.[a-z.]+$/.test(domain)) {
    return { qualityTier: "primary_official", qualityReason: "Governmental or intergovernmental primary source." };
  }
  if (matchesDomain(domain, filingDomains) || /annual[-_ ]?report|financial[-_ ]?report|investor[-_ ]?relations/.test(normalized)) {
    return { qualityTier: "exchange_or_filing", qualityReason: "Exchange, filing repository, or company-report evidence; entity details still require verification." };
  }
  if (sourceType === "industry" && !/(directory|database|ranking|all companies)/.test(normalized)) {
    return { qualityTier: "credible_secondary", qualityReason: "Secondary industry context; validate important claims against primary evidence." };
  }
  return { qualityTier: "discovery_only", qualityReason: "Discovery lead only; not sufficient for comparable acceptance or financial screening." };
}

async function tavilySearch(
  query: string,
  options: {
    sourceType: TpExternalResearchSource["sourceType"];
    searchDepth: "basic" | "advanced";
    maxResults: number;
    includeDomains?: string[];
    acceptedQualityTiers?: TpExternalResearchSource["qualityTier"][];
  }
) {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) throw new Error("TAVILY_API_KEY is not configured.");
  const projectId = process.env.TAVILY_PROJECT_ID?.trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(projectId ? { "X-Project-ID": projectId } : {})
      },
      body: JSON.stringify({
        query,
        topic: "general",
        search_depth: options.searchDepth,
        chunks_per_source: options.searchDepth === "advanced" ? 2 : undefined,
        max_results: options.maxResults,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
        ...(options.includeDomains?.length ? { include_domains: options.includeDomains } : {})
      }),
      signal: controller.signal,
      cache: "no-store"
    });
    const payload = await response.json().catch(() => ({})) as TavilyResponse;
    if (!response.ok) {
      const detail = typeof payload.detail === "string" ? payload.detail : payload.detail?.error;
      throw new Error(detail || `Tavily search failed (${response.status}).`);
    }
    const retrievedAt = new Date().toISOString();
    return (payload.results || [])
      .filter((result) => result.title && result.url)
      .filter((result) => !options.includeDomains?.length || matchesDomain(hostName(result.url || ""), options.includeDomains))
      .map<TpExternalResearchSource>((result) => {
        const title = cleanText(result.title || "", 240);
        const url = result.url || "";
        return {
          title,
          url,
          domain: hostName(url),
          sourceType: options.sourceType,
          query,
          snippet: cleanText(result.content || "", 1400),
          score: Number.isFinite(Number(result.score)) ? Number(result.score) : 0,
          ...sourceQuality(url, title, options.sourceType),
          publishedDate: result.published_date || "",
          retrievedAt
        };
      })
      .filter((source) => !options.acceptedQualityTiers?.length || options.acceptedQualityTiers.includes(source.qualityTier));
  } finally {
    clearTimeout(timer);
  }
}

export async function runTpExternalResearch(state: TpProjectState): Promise<TpExternalResearchBundle> {
  if (!hasTavilyKey()) return { status: "not_configured", sources: [], warnings: [], queries: [] };

  const queries = buildTpResearchQueries(state);
  const comparableDescriptorReady = queries.some((item) => item.sourceType === "comparable_candidate");

  const tasks: Array<Promise<TpExternalResearchSource[]>> = [
    tavilySearch(queries[0]!.query, {
      sourceType: "official",
      searchDepth: "advanced",
      maxResults: 5,
      includeDomains: officialDomains
    }),
    tavilySearch(queries[1]!.query, {
      sourceType: "industry",
      searchDepth: "basic",
      maxResults: 5
    })
  ];
  if (comparableDescriptorReady) {
    tasks.push(tavilySearch(queries[2]!.query, {
      sourceType: "comparable_candidate",
      searchDepth: "advanced",
      maxResults: 6
    }));
    tasks.push(tavilySearch(queries[3]!.query, {
      sourceType: "comparable_candidate",
      searchDepth: "advanced",
      maxResults: 8,
      acceptedQualityTiers: ["primary_official", "exchange_or_filing"]
    }));
  }
  const settled = await Promise.allSettled(tasks);
  const warnings: string[] = comparableDescriptorReady
    ? []
    : ["Comparable discovery was skipped because the anonymized business descriptor was not specific enough. Add product, transaction, and business-activity details before screening external candidates."];
  const sourceMap = new Map<string, TpExternalResearchSource>();
  settled.forEach((result, index) => {
    if (result.status === "rejected") {
      warnings.push(`${queries[index].sourceType}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      return;
    }
    result.value.forEach((source) => {
      const existing = sourceMap.get(source.url);
      if (!existing || source.score > existing.score) sourceMap.set(source.url, source);
    });
  });

  const qualityRank: Record<TpExternalResearchSource["qualityTier"], number> = {
    primary_official: 4,
    exchange_or_filing: 3,
    credible_secondary: 2,
    discovery_only: 1
  };
  const sources = Array.from(sourceMap.values()).sort((a, b) =>
    qualityRank[b.qualityTier] - qualityRank[a.qualityTier] || b.score - a.score
  );
  if (!sources.length) return { status: "failed", sources, warnings: warnings.length ? warnings : ["No external sources were returned."], queries };
  return {
    status: warnings.length ? "partial" : "completed",
    sources,
    warnings,
    queries
  };
}
