export type TpDocumentKind =
  | "company_profile"
  | "legal_ownership"
  | "financial_statement"
  | "related_party_transaction"
  | "transfer_pricing_policy"
  | "agreement"
  | "other";

export type TpProjectStatus = "draft" | "extracted" | "analyzed" | "ready";

export type TpSourceDocument = {
  id: string;
  filename: string;
  kind: TpDocumentKind;
  url: string;
  downloadUrl: string;
  size: number;
  status: "uploaded" | "extracted" | "failed";
  extractionMessage: string;
  uploadedAt: string;
  extractedAt?: string;
};

export type TpNamedItem = {
  name: string;
  description: string;
};

export type TpShareholder = {
  name: string;
  shares: string;
  capital: string;
  percentage: string;
};

export type TpManagement = {
  position: string;
  name: string;
};

export type TpAffiliatedParty = {
  name: string;
  country: string;
  relationship: string;
  transactionType: string;
};

export type TpTransaction = {
  counterparty: string;
  country: string;
  affiliationType: string;
  transactionType: string;
  value: string;
  currency: string;
  note: string;
};

export type TpComparable = {
  name: string;
  country: string;
  description: string;
  ratio: string;
};

export type TpProjectAnalysis = {
  executiveSummary: string;
  industryAnalysis: string;
  businessCharacterization: string;
  functionalAnalysis: string;
  methodSelectionJustification: string;
  pliSelectionRationale: string;
  comparabilityAnalysis: string;
  conclusion: string;
  riskFlags: string[];
  requiredEvidence: string[];
  regulatoryReferences: string[];
};

export type TpProjectState = {
  companyName: string;
  companyShortName: string;
  npwp: string;
  companyAddress: string;
  establishmentInfo: string;
  fiscalYear: string;
  parentCompany: string;
  parentGroup: string;
  brandName: string;
  employeeCount: string;
  shareholders: TpShareholder[];
  management: TpManagement[];
  affiliatedParties: TpAffiliatedParty[];
  businessActivities: string;
  products: TpNamedItem[];
  businessStrategy: string;
  businessRestructuring: string;
  organizationStructure: string;
  transactionType: string;
  transactionDetails: string;
  pricingPolicy: string;
  affiliatedTransactions: TpTransaction[];
  independentTransactions: TpTransaction[];
  financialData: {
    revenue: string;
    costOfGoodsSold: string;
    grossProfit: string;
    operatingExpenses: string;
    operatingProfit: string;
    netIncome: string;
  };
  comparabilityFactors: string;
  comparableCompanies: TpComparable[];
  selectedMethod: string;
  selectedPli: string;
  testedParty: string;
  analysisPeriod: string;
  quartileRange: { q1: string; median: string; q3: string };
  testedPartyRatio: string;
  nonFinancialEvents: string;
  analysis: TpProjectAnalysis;
  fieldSources: Record<string, string[]>;
};

export type TpLocalFileProject = {
  id: string;
  ownerUsername: string;
  name: string;
  status: TpProjectStatus;
  state: TpProjectState;
  documents: TpSourceDocument[];
  createdAt: string;
  updatedAt: string;
};

export type TpLocalFileProjectSummary = Omit<TpLocalFileProject, "state" | "documents"> & {
  companyName: string;
  fiscalYear: string;
  documentCount: number;
  completeness: number;
};

export const tpDocumentKinds: Array<{ id: TpDocumentKind; en: string; idLabel: string }> = [
  { id: "company_profile", en: "Company profile", idLabel: "Profil perusahaan" },
  { id: "legal_ownership", en: "Legal and ownership", idLabel: "Legal dan kepemilikan" },
  { id: "financial_statement", en: "Financial statement", idLabel: "Laporan keuangan" },
  { id: "related_party_transaction", en: "Related-party transaction", idLabel: "Transaksi afiliasi" },
  { id: "transfer_pricing_policy", en: "Transfer pricing policy", idLabel: "Kebijakan transfer pricing" },
  { id: "agreement", en: "Agreement", idLabel: "Perjanjian" },
  { id: "other", en: "Other supporting document", idLabel: "Dokumen pendukung lain" }
];

export function emptyTpProjectAnalysis(): TpProjectAnalysis {
  return {
    executiveSummary: "",
    industryAnalysis: "",
    businessCharacterization: "",
    functionalAnalysis: "",
    methodSelectionJustification: "",
    pliSelectionRationale: "",
    comparabilityAnalysis: "",
    conclusion: "",
    riskFlags: [],
    requiredEvidence: [],
    regulatoryReferences: []
  };
}

export function emptyTpProjectState(): TpProjectState {
  return {
    companyName: "",
    companyShortName: "",
    npwp: "",
    companyAddress: "",
    establishmentInfo: "",
    fiscalYear: "",
    parentCompany: "",
    parentGroup: "",
    brandName: "",
    employeeCount: "",
    shareholders: [],
    management: [],
    affiliatedParties: [],
    businessActivities: "",
    products: [],
    businessStrategy: "",
    businessRestructuring: "",
    organizationStructure: "",
    transactionType: "",
    transactionDetails: "",
    pricingPolicy: "",
    affiliatedTransactions: [],
    independentTransactions: [],
    financialData: {
      revenue: "",
      costOfGoodsSold: "",
      grossProfit: "",
      operatingExpenses: "",
      operatingProfit: "",
      netIncome: ""
    },
    comparabilityFactors: "",
    comparableCompanies: [],
    selectedMethod: "TNMM",
    selectedPli: "ROS",
    testedParty: "",
    analysisPeriod: "",
    quartileRange: { q1: "", median: "", q3: "" },
    testedPartyRatio: "",
    nonFinancialEvents: "",
    analysis: emptyTpProjectAnalysis(),
    fieldSources: {}
  };
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function arrayOf<T>(value: unknown, map: (entry: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => entry && typeof entry === "object").map((entry) => map(entry as Record<string, unknown>));
}

export function normalizeTpProjectState(value: unknown): TpProjectState {
  const base = emptyTpProjectState();
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const financial = source.financialData && typeof source.financialData === "object" ? source.financialData as Record<string, unknown> : {};
  const quartiles = source.quartileRange && typeof source.quartileRange === "object" ? source.quartileRange as Record<string, unknown> : {};
  const analysisSource = source.analysis && typeof source.analysis === "object" ? source.analysis as Record<string, unknown> : {};
  return {
    ...base,
    companyName: text(source.companyName),
    companyShortName: text(source.companyShortName),
    npwp: text(source.npwp),
    companyAddress: text(source.companyAddress),
    establishmentInfo: text(source.establishmentInfo),
    fiscalYear: text(source.fiscalYear),
    parentCompany: text(source.parentCompany),
    parentGroup: text(source.parentGroup),
    brandName: text(source.brandName),
    employeeCount: text(source.employeeCount),
    shareholders: arrayOf(source.shareholders, (entry) => ({
      name: text(entry.name), shares: text(entry.shares), capital: text(entry.capital), percentage: text(entry.percentage)
    })),
    management: arrayOf(source.management, (entry) => ({ position: text(entry.position), name: text(entry.name) })),
    affiliatedParties: arrayOf(source.affiliatedParties, (entry) => ({
      name: text(entry.name), country: text(entry.country), relationship: text(entry.relationship), transactionType: text(entry.transactionType)
    })),
    businessActivities: text(source.businessActivities),
    products: arrayOf(source.products, (entry) => ({ name: text(entry.name), description: text(entry.description) })),
    businessStrategy: text(source.businessStrategy),
    businessRestructuring: text(source.businessRestructuring),
    organizationStructure: text(source.organizationStructure),
    transactionType: text(source.transactionType),
    transactionDetails: text(source.transactionDetails),
    pricingPolicy: text(source.pricingPolicy),
    affiliatedTransactions: arrayOf(source.affiliatedTransactions, normalizeTransaction),
    independentTransactions: arrayOf(source.independentTransactions, normalizeTransaction),
    financialData: {
      revenue: text(financial.revenue),
      costOfGoodsSold: text(financial.costOfGoodsSold),
      grossProfit: text(financial.grossProfit),
      operatingExpenses: text(financial.operatingExpenses),
      operatingProfit: text(financial.operatingProfit),
      netIncome: text(financial.netIncome)
    },
    comparabilityFactors: text(source.comparabilityFactors),
    comparableCompanies: arrayOf(source.comparableCompanies, (entry) => ({
      name: text(entry.name), country: text(entry.country), description: text(entry.description), ratio: text(entry.ratio)
    })),
    selectedMethod: text(source.selectedMethod) || base.selectedMethod,
    selectedPli: text(source.selectedPli) || base.selectedPli,
    testedParty: text(source.testedParty),
    analysisPeriod: text(source.analysisPeriod),
    quartileRange: { q1: text(quartiles.q1), median: text(quartiles.median), q3: text(quartiles.q3) },
    testedPartyRatio: text(source.testedPartyRatio),
    nonFinancialEvents: text(source.nonFinancialEvents),
    analysis: {
      executiveSummary: text(analysisSource.executiveSummary),
      industryAnalysis: text(analysisSource.industryAnalysis),
      businessCharacterization: text(analysisSource.businessCharacterization),
      functionalAnalysis: text(analysisSource.functionalAnalysis),
      methodSelectionJustification: text(analysisSource.methodSelectionJustification),
      pliSelectionRationale: text(analysisSource.pliSelectionRationale),
      comparabilityAnalysis: text(analysisSource.comparabilityAnalysis),
      conclusion: text(analysisSource.conclusion),
      riskFlags: Array.isArray(analysisSource.riskFlags) ? analysisSource.riskFlags.map(text).filter(Boolean) : [],
      requiredEvidence: Array.isArray(analysisSource.requiredEvidence) ? analysisSource.requiredEvidence.map(text).filter(Boolean) : [],
      regulatoryReferences: Array.isArray(analysisSource.regulatoryReferences) ? analysisSource.regulatoryReferences.map(text).filter(Boolean) : []
    },
    fieldSources: normalizeFieldSources(source.fieldSources)
  };
}

function normalizeTransaction(entry: Record<string, unknown>): TpTransaction {
  return {
    counterparty: text(entry.counterparty || entry.name),
    country: text(entry.country),
    affiliationType: text(entry.affiliationType),
    transactionType: text(entry.transactionType),
    value: text(entry.value),
    currency: text(entry.currency) || "IDR",
    note: text(entry.note)
  };
}

function normalizeFieldSources(value: unknown) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entries]) => [
      key,
      Array.isArray(entries) ? entries.map(text).filter(Boolean) : []
    ])
  );
}

function hasValue(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).some(hasValue);
  return Boolean(text(value));
}

export function tpProjectCompleteness(state: TpProjectState) {
  const weighted: Array<[unknown, number]> = [
    [state.companyName, 8], [state.fiscalYear, 5], [state.companyAddress, 3], [state.shareholders, 6],
    [state.management, 4], [state.affiliatedParties, 8], [state.businessActivities, 8], [state.products, 4],
    [state.affiliatedTransactions, 12], [state.transactionDetails, 8], [state.pricingPolicy, 5],
    [state.financialData.revenue, 5], [state.financialData.operatingProfit, 5], [state.selectedMethod, 4],
    [state.testedParty, 4], [state.analysisPeriod, 3], [state.comparableCompanies, 5], [state.analysis.executiveSummary, 3]
  ];
  const achieved = weighted.reduce((sum, [value, weight]) => sum + (hasValue(value) ? weight : 0), 0);
  const total = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  return Math.round((achieved / total) * 100);
}

export function mergeTpProjectState(currentValue: unknown, patchValue: unknown, sourceDocumentId?: string) {
  const current = normalizeTpProjectState(currentValue);
  const patch = normalizeTpProjectState(patchValue);
  const merged = structuredClone(current);
  const mergeRecord = (target: Record<string, unknown>, incoming: Record<string, unknown>, prefix = "") => {
    for (const [key, value] of Object.entries(incoming)) {
      if (key === "fieldSources" || key === "analysis") continue;
      const path = prefix ? `${prefix}.${key}` : key;
      if (Array.isArray(value)) {
        if (value.length) target[key] = value;
      } else if (value && typeof value === "object") {
        const nextTarget = target[key] && typeof target[key] === "object" ? target[key] as Record<string, unknown> : {};
        mergeRecord(nextTarget, value as Record<string, unknown>, path);
        target[key] = nextTarget;
      } else if (hasValue(value)) {
        target[key] = value;
        if (sourceDocumentId) {
          merged.fieldSources[path] = Array.from(new Set([...(merged.fieldSources[path] || []), sourceDocumentId]));
        }
      }
    }
  };
  mergeRecord(merged as unknown as Record<string, unknown>, patch as unknown as Record<string, unknown>);
  return normalizeTpProjectState(merged);
}
