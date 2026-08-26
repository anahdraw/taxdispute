export type TpDocumentKind =
  | "auto_mixed"
  | "company_profile"
  | "legal_ownership"
  | "financial_statement"
  | "related_party_transaction"
  | "transfer_pricing_policy"
  | "agreement"
  | "other";

export type TpExtractionScope =
  | "identity"
  | "ownership_management"
  | "related_parties"
  | "business_operations"
  | "organization"
  | "controlled_transactions"
  | "financial_current"
  | "financial_prior"
  | "tp_policy"
  | "comparables"
  | "non_financial";

export type TpExtractionCoverage = {
  scope: TpExtractionScope;
  status: "found" | "partial" | "not_found";
  note: string;
};

export type TpDocumentEvidence = {
  id: string;
  fieldPaths: string[];
  page?: number;
  section?: string;
  table?: string;
  excerpt: string;
  confidence: number;
};

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
  requestedScopes?: TpExtractionScope[];
  detectedScopes?: TpExtractionScope[];
  coverage?: TpExtractionCoverage[];
  evidence?: TpDocumentEvidence[];
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

export type TpFinancialData = {
  revenue: string;
  costOfGoodsSold: string;
  grossProfit: string;
  operatingExpenses: string;
  operatingProfit: string;
  netIncome: string;
};

export type TpOrganizationDepartment = {
  name: string;
  head: string;
  employees: string;
};

export type TpSearchCriteriaResult = {
  step: string;
  criteria: string;
  resultCount: string;
};

export type TpRejectionMatrixRow = {
  name: string;
  reason: string;
  accepted: boolean;
};

export type TpFarAnalysis = {
  functionsPerformed: string;
  assetsUsed: string;
  risksAssumed: string;
  contractualTerms: string;
  economicCircumstances: string;
  intangiblesUsed: string;
  serviceBenefitTest: string;
};

export type TpManualEvidence = {
  id: string;
  title: string;
  sourceKind: "management_interview" | "ledger_reference" | "agreement_reference" | "manual_calculation" | "other";
  reference: string;
  locator: string;
  excerpt: string;
  fieldPaths: string[];
  createdAt: string;
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
  assumptions: string[];
  counterarguments: string[];
  actionPlan: string[];
  externalResearchSummary: string;
  externalResearchStatus: "not_requested" | "not_configured" | "completed" | "partial" | "failed";
  externalResearchWarnings: string[];
  externalResearchSources: TpExternalResearchSource[];
  externalComparableCandidates: TpExternalComparableCandidate[];
};

export type TpExternalResearchSource = {
  title: string;
  url: string;
  domain: string;
  sourceType: "official" | "industry" | "comparable_candidate";
  query: string;
  snippet: string;
  score: number;
  qualityTier: "primary_official" | "exchange_or_filing" | "credible_secondary" | "discovery_only";
  qualityReason: string;
  publishedDate: string;
  retrievedAt: string;
};

export type TpExternalComparableCandidate = {
  name: string;
  country: string;
  businessDescription: string;
  matchRationale: string;
  keyDifferences: string[];
  sourceTitle: string;
  sourceUrl: string;
  sourceScore: number;
  sourceQuality: TpExternalResearchSource["qualityTier"];
  screeningStatus: "preliminary" | "needs_financial_screening" | "exclude";
  limitation: string;
};

export type TpMergeConflict = {
  id: string;
  path: string;
  entityKey: string;
  field: string;
  existingValue: string;
  incomingValue: string;
  sourceDocumentIds: string[];
  status: "unresolved" | "resolved_existing" | "resolved_incoming";
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
  shareholdersSource: string;
  managementSource: string;
  shareholders: TpShareholder[];
  management: TpManagement[];
  affiliatedParties: TpAffiliatedParty[];
  businessActivities: string;
  products: TpNamedItem[];
  businessStrategy: string;
  businessRestructuring: string;
  organizationStructure: string;
  organizationDepartments: TpOrganizationDepartment[];
  transactionType: string;
  transactionDetails: string;
  pricingPolicy: string;
  affiliatedTransactions: TpTransaction[];
  independentTransactions: TpTransaction[];
  financialData: TpFinancialData;
  financialDataPrior: TpFinancialData;
  comparabilityFactors: string;
  searchCriteriaResults: TpSearchCriteriaResult[];
  rejectionMatrix: TpRejectionMatrixRow[];
  comparableCompanies: TpComparable[];
  selectedMethod: string;
  selectedPli: string;
  testedParty: string;
  analysisPeriod: string;
  quartileRange: { q1: string; median: string; q3: string };
  testedPartyRatio: string;
  nonFinancialEvents: string;
  backgroundTransaction: string;
  supplyChainManagement: string;
  farAnalysis: TpFarAnalysis;
  manualEvidence: TpManualEvidence[];
  analysis: TpProjectAnalysis;
  fieldSources: Record<string, string[]>;
  mergeConflicts: TpMergeConflict[];
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
  { id: "auto_mixed", en: "Auto-detect / mixed document", idLabel: "Deteksi otomatis / dokumen campuran" },
  { id: "company_profile", en: "Company profile", idLabel: "Profil perusahaan" },
  { id: "legal_ownership", en: "Legal and ownership", idLabel: "Legal dan kepemilikan" },
  { id: "financial_statement", en: "Financial statement", idLabel: "Laporan keuangan" },
  { id: "related_party_transaction", en: "Related-party transaction", idLabel: "Transaksi afiliasi" },
  { id: "transfer_pricing_policy", en: "Transfer pricing policy", idLabel: "Kebijakan transfer pricing" },
  { id: "agreement", en: "Agreement", idLabel: "Perjanjian" },
  { id: "other", en: "Other supporting document", idLabel: "Dokumen pendukung lain" }
];

export const tpExtractionScopes: Array<{ id: TpExtractionScope; en: string; idLabel: string }> = [
  { id: "identity", en: "Company identity", idLabel: "Identitas perusahaan" },
  { id: "ownership_management", en: "Ownership & management", idLabel: "Kepemilikan & manajemen" },
  { id: "related_parties", en: "Related parties", idLabel: "Pihak afiliasi" },
  { id: "business_operations", en: "Business & products", idLabel: "Usaha & produk" },
  { id: "organization", en: "Organization", idLabel: "Organisasi" },
  { id: "controlled_transactions", en: "Controlled transactions", idLabel: "Transaksi afiliasi" },
  { id: "financial_current", en: "Current-year financials", idLabel: "Keuangan tahun berjalan" },
  { id: "financial_prior", en: "Prior-year financials", idLabel: "Keuangan tahun sebelumnya" },
  { id: "tp_policy", en: "TP policy & agreements", idLabel: "Kebijakan TP & perjanjian" },
  { id: "comparables", en: "Comparables / benchmarking", idLabel: "Pembanding / benchmarking" },
  { id: "non_financial", en: "Non-financial events", idLabel: "Peristiwa non-keuangan" }
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
    regulatoryReferences: [],
    assumptions: [],
    counterarguments: [],
    actionPlan: [],
    externalResearchSummary: "",
    externalResearchStatus: "not_requested",
    externalResearchWarnings: [],
    externalResearchSources: [],
    externalComparableCandidates: []
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
    shareholdersSource: "",
    managementSource: "",
    shareholders: [],
    management: [],
    affiliatedParties: [],
    businessActivities: "",
    products: [],
    businessStrategy: "",
    businessRestructuring: "",
    organizationStructure: "",
    organizationDepartments: [],
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
    financialDataPrior: {
      revenue: "",
      costOfGoodsSold: "",
      grossProfit: "",
      operatingExpenses: "",
      operatingProfit: "",
      netIncome: ""
    },
    comparabilityFactors: "",
    searchCriteriaResults: [],
    rejectionMatrix: [],
    comparableCompanies: [],
    selectedMethod: "",
    selectedPli: "",
    testedParty: "",
    analysisPeriod: "",
    quartileRange: { q1: "", median: "", q3: "" },
    testedPartyRatio: "",
    nonFinancialEvents: "",
    backgroundTransaction: "",
    supplyChainManagement: "",
    farAnalysis: {
      functionsPerformed: "",
      assetsUsed: "",
      risksAssumed: "",
      contractualTerms: "",
      economicCircumstances: "",
      intangiblesUsed: "",
      serviceBenefitTest: ""
    },
    manualEvidence: [],
    analysis: emptyTpProjectAnalysis(),
    fieldSources: {},
    mergeConflicts: []
  };
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function normalizeMergeConflictStatus(value: unknown): TpMergeConflict["status"] {
  const status = text(value);
  return status === "resolved_existing" || status === "resolved_incoming" ? status : "unresolved";
}

function arrayOf<T>(value: unknown, map: (entry: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => entry && typeof entry === "object").map((entry) => map(entry as Record<string, unknown>));
}

export function normalizeTpProjectState(value: unknown): TpProjectState {
  const base = emptyTpProjectState();
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const financial = source.financialData && typeof source.financialData === "object" ? source.financialData as Record<string, unknown> : {};
  const financialPrior = source.financialDataPrior && typeof source.financialDataPrior === "object" ? source.financialDataPrior as Record<string, unknown> : {};
  const quartiles = source.quartileRange && typeof source.quartileRange === "object" ? source.quartileRange as Record<string, unknown> : {};
  const farAnalysis = source.farAnalysis && typeof source.farAnalysis === "object" ? source.farAnalysis as Record<string, unknown> : {};
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
    shareholdersSource: text(source.shareholdersSource),
    managementSource: text(source.managementSource),
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
    organizationDepartments: arrayOf(source.organizationDepartments, (entry) => ({
      name: text(entry.name), head: text(entry.head), employees: text(entry.employees)
    })),
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
    financialDataPrior: {
      revenue: text(financialPrior.revenue),
      costOfGoodsSold: text(financialPrior.costOfGoodsSold),
      grossProfit: text(financialPrior.grossProfit),
      operatingExpenses: text(financialPrior.operatingExpenses),
      operatingProfit: text(financialPrior.operatingProfit),
      netIncome: text(financialPrior.netIncome)
    },
    comparabilityFactors: text(source.comparabilityFactors),
    searchCriteriaResults: arrayOf(source.searchCriteriaResults, (entry) => ({
      step: text(entry.step), criteria: text(entry.criteria), resultCount: text(entry.resultCount || entry.result_count)
    })),
    rejectionMatrix: arrayOf(source.rejectionMatrix, (entry) => ({
      name: text(entry.name), reason: text(entry.reason), accepted: Boolean(entry.accepted)
    })),
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
    backgroundTransaction: text(source.backgroundTransaction),
    supplyChainManagement: text(source.supplyChainManagement),
    farAnalysis: {
      functionsPerformed: text(farAnalysis.functionsPerformed),
      assetsUsed: text(farAnalysis.assetsUsed),
      risksAssumed: text(farAnalysis.risksAssumed),
      contractualTerms: text(farAnalysis.contractualTerms),
      economicCircumstances: text(farAnalysis.economicCircumstances),
      intangiblesUsed: text(farAnalysis.intangiblesUsed),
      serviceBenefitTest: text(farAnalysis.serviceBenefitTest)
    },
    manualEvidence: arrayOf(source.manualEvidence, (entry) => ({
      id: text(entry.id),
      title: text(entry.title),
      sourceKind: ["management_interview", "ledger_reference", "agreement_reference", "manual_calculation", "other"].includes(text(entry.sourceKind))
        ? text(entry.sourceKind) as TpManualEvidence["sourceKind"]
        : "other",
      reference: text(entry.reference),
      locator: text(entry.locator),
      excerpt: text(entry.excerpt),
      fieldPaths: Array.isArray(entry.fieldPaths) ? Array.from(new Set(entry.fieldPaths.map(text).filter(Boolean))) : [],
      createdAt: text(entry.createdAt)
    })).filter((entry) => entry.id && entry.title && entry.fieldPaths.length),
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
      regulatoryReferences: Array.isArray(analysisSource.regulatoryReferences) ? analysisSource.regulatoryReferences.map(text).filter(Boolean) : [],
      assumptions: Array.isArray(analysisSource.assumptions) ? analysisSource.assumptions.map(text).filter(Boolean) : [],
      counterarguments: Array.isArray(analysisSource.counterarguments) ? analysisSource.counterarguments.map(text).filter(Boolean) : [],
      actionPlan: Array.isArray(analysisSource.actionPlan) ? analysisSource.actionPlan.map(text).filter(Boolean) : [],
      externalResearchSummary: text(analysisSource.externalResearchSummary),
      externalResearchStatus: ["not_requested", "not_configured", "completed", "partial", "failed"].includes(text(analysisSource.externalResearchStatus))
        ? text(analysisSource.externalResearchStatus) as TpProjectAnalysis["externalResearchStatus"]
        : "not_requested",
      externalResearchWarnings: Array.isArray(analysisSource.externalResearchWarnings)
        ? analysisSource.externalResearchWarnings.map(text).filter(Boolean)
        : [],
      externalResearchSources: arrayOf(analysisSource.externalResearchSources, (entry) => ({
        title: text(entry.title),
        url: text(entry.url),
        domain: text(entry.domain),
        sourceType: ["official", "industry", "comparable_candidate"].includes(text(entry.sourceType))
          ? text(entry.sourceType) as TpExternalResearchSource["sourceType"]
          : "industry",
        query: text(entry.query),
        snippet: text(entry.snippet),
        score: Number.isFinite(Number(entry.score)) ? Number(entry.score) : 0,
        qualityTier: ["primary_official", "exchange_or_filing", "credible_secondary", "discovery_only"].includes(text(entry.qualityTier))
          ? text(entry.qualityTier) as TpExternalResearchSource["qualityTier"]
          : "discovery_only",
        qualityReason: text(entry.qualityReason),
        publishedDate: text(entry.publishedDate),
        retrievedAt: text(entry.retrievedAt)
      })),
      externalComparableCandidates: arrayOf(analysisSource.externalComparableCandidates, (entry) => ({
        name: text(entry.name),
        country: text(entry.country),
        businessDescription: text(entry.businessDescription),
        matchRationale: text(entry.matchRationale),
        keyDifferences: Array.isArray(entry.keyDifferences) ? entry.keyDifferences.map(text).filter(Boolean) : [],
        sourceTitle: text(entry.sourceTitle),
        sourceUrl: text(entry.sourceUrl),
        sourceScore: Number.isFinite(Number(entry.sourceScore)) ? Number(entry.sourceScore) : 0,
        sourceQuality: ["primary_official", "exchange_or_filing", "credible_secondary", "discovery_only"].includes(text(entry.sourceQuality))
          ? text(entry.sourceQuality) as TpExternalComparableCandidate["sourceQuality"]
          : "discovery_only",
        screeningStatus: ["preliminary", "needs_financial_screening", "exclude"].includes(text(entry.screeningStatus))
          ? text(entry.screeningStatus) as TpExternalComparableCandidate["screeningStatus"]
          : "preliminary",
        limitation: text(entry.limitation)
      }))
    },
    fieldSources: normalizeFieldSources(source.fieldSources),
    mergeConflicts: arrayOf(source.mergeConflicts, (entry) => ({
      id: text(entry.id),
      path: text(entry.path),
      entityKey: text(entry.entityKey),
      field: text(entry.field),
      existingValue: text(entry.existingValue),
      incomingValue: text(entry.incomingValue),
      sourceDocumentIds: Array.isArray(entry.sourceDocumentIds) ? entry.sourceDocumentIds.map(text).filter(Boolean) : [],
      status: normalizeMergeConflictStatus(entry.status)
    })).filter((entry) => entry.id && entry.path && entry.field)
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

export type TpRequirementCategory = "template" | "extractable" | "additional" | "advisor";
export type TpRequirementStatus = "ready" | "partial" | "missing";

export type TpLocalFileRequirement = {
  id: string;
  section: string;
  category: TpRequirementCategory;
  en: string;
  idLabel: string;
  paths: string[];
  expectedSources: TpExtractionScope[];
  requiredBeforeFinal: boolean;
};

export const tpLocalFileRequirements: TpLocalFileRequirement[] = [
  { id: "template-structure", section: "Template", category: "template", en: "Cover, chapter structure, numbering, and source appendix", idLabel: "Sampul, struktur bab, penomoran, dan lampiran sumber", paths: [], expectedSources: [], requiredBeforeFinal: false },
  { id: "template-language", section: "Template", category: "template", en: "Standard Local File labels and working-draft disclaimer", idLabel: "Label standar Local File dan disclaimer draft kerja", paths: [], expectedSources: [], requiredBeforeFinal: false },
  { id: "company-identity", section: "Company", category: "extractable", en: "Company identity, establishment, address, group, and fiscal year", idLabel: "Identitas, pendirian, alamat, grup, dan tahun pajak", paths: ["companyName", "establishmentInfo", "companyAddress", "fiscalYear"], expectedSources: ["identity"], requiredBeforeFinal: true },
  { id: "ownership-management", section: "Company", category: "extractable", en: "Ownership, management, and employee information", idLabel: "Kepemilikan, manajemen, dan informasi pegawai", paths: ["shareholders", "management", "employeeCount"], expectedSources: ["ownership_management"], requiredBeforeFinal: true },
  { id: "related-parties", section: "Related parties", category: "extractable", en: "Related-party register and relationship", idLabel: "Daftar pihak afiliasi dan hubungan", paths: ["affiliatedParties"], expectedSources: ["related_parties"], requiredBeforeFinal: true },
  { id: "business-products", section: "Business", category: "extractable", en: "Business activities, products, strategy, and restructuring", idLabel: "Kegiatan usaha, produk, strategi, dan restrukturisasi", paths: ["businessActivities", "products", "businessStrategy"], expectedSources: ["business_operations"], requiredBeforeFinal: true },
  { id: "organization", section: "Business", category: "extractable", en: "Organization structure and departments", idLabel: "Struktur organisasi dan departemen", paths: ["organizationStructure", "organizationDepartments"], expectedSources: ["organization"], requiredBeforeFinal: false },
  { id: "controlled-transactions", section: "Transactions", category: "extractable", en: "Controlled transactions, values, counterparties, and pricing policy", idLabel: "Transaksi afiliasi, nilai, lawan transaksi, dan kebijakan harga", paths: ["affiliatedTransactions", "transactionDetails", "pricingPolicy"], expectedSources: ["controlled_transactions", "tp_policy"], requiredBeforeFinal: true },
  { id: "current-financials", section: "Financial", category: "extractable", en: "Current-year financial information", idLabel: "Informasi keuangan tahun berjalan", paths: ["financialData.revenue", "financialData.operatingProfit", "financialData.netIncome"], expectedSources: ["financial_current"], requiredBeforeFinal: true },
  { id: "prior-financials", section: "Financial", category: "additional", en: "Prior-year financial information for comparison", idLabel: "Informasi keuangan tahun sebelumnya untuk perbandingan", paths: ["financialDataPrior.revenue", "financialDataPrior.operatingProfit"], expectedSources: ["financial_prior"], requiredBeforeFinal: false },
  { id: "legal-support", section: "Source evidence", category: "additional", en: "Deed, shareholder register, organization chart, and management evidence", idLabel: "Akta, daftar pemegang saham, bagan organisasi, dan bukti manajemen", paths: ["establishmentInfo", "shareholdersSource", "managementSource", "organizationStructure"], expectedSources: ["identity", "ownership_management", "organization"], requiredBeforeFinal: false },
  { id: "transaction-support", section: "Source evidence", category: "additional", en: "Agreements, invoices, ledger, allocation schedules, and benefit evidence", idLabel: "Perjanjian, invoice, ledger, alokasi, dan bukti manfaat", paths: ["backgroundTransaction", "supplyChainManagement", "pricingPolicy"], expectedSources: ["controlled_transactions", "tp_policy"], requiredBeforeFinal: true },
  { id: "far-analysis", section: "Functions, assets, and risks", category: "advisor", en: "Functions performed, assets used, and risks assumed", idLabel: "Fungsi yang dilakukan, aset yang digunakan, dan risiko yang ditanggung", paths: ["farAnalysis.functionsPerformed", "farAnalysis.assetsUsed", "farAnalysis.risksAssumed"], expectedSources: [], requiredBeforeFinal: true },
  { id: "benchmark-support", section: "Comparability", category: "additional", en: "Search strategy, rejection matrix, and comparable-company data", idLabel: "Strategi pencarian, matriks penolakan, dan data perusahaan pembanding", paths: ["searchCriteriaResults", "rejectionMatrix", "comparableCompanies"], expectedSources: ["comparables"], requiredBeforeFinal: true },
  { id: "transaction-delineation", section: "Advisor decisions", category: "advisor", en: "Confirm transaction delineation and materiality", idLabel: "Konfirmasi delineasi transaksi dan materialitas", paths: ["transactionType", "transactionDetails"], expectedSources: [], requiredBeforeFinal: true },
  { id: "tested-party", section: "Advisor decisions", category: "advisor", en: "Select and justify the tested party", idLabel: "Pilih dan justifikasi pihak yang diuji", paths: ["testedParty"], expectedSources: [], requiredBeforeFinal: true },
  { id: "method-pli", section: "Advisor decisions", category: "advisor", en: "Select the TP method and profit-level indicator", idLabel: "Pilih metode TP dan profit-level indicator", paths: ["selectedMethod", "selectedPli"], expectedSources: [], requiredBeforeFinal: true },
  { id: "analysis-period", section: "Advisor decisions", category: "advisor", en: "Confirm analysis period and comparable acceptance/rejection", idLabel: "Konfirmasi periode analisis serta penerimaan/penolakan pembanding", paths: ["analysisPeriod", "rejectionMatrix", "comparableCompanies"], expectedSources: [], requiredBeforeFinal: true },
  { id: "range-conclusion", section: "Advisor decisions", category: "advisor", en: "Validate arm's-length range, tested ratio, and final conclusion", idLabel: "Validasi rentang kewajaran, rasio teruji, dan kesimpulan akhir", paths: ["quartileRange.q1", "quartileRange.median", "quartileRange.q3", "testedPartyRatio", "analysis.conclusion"], expectedSources: [], requiredBeforeFinal: true }
];

function valueAtPath(value: unknown, path: string) {
  return path.split(".").reduce<unknown>((current, key) => current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined, value);
}

export function tpRequirementStatus(state: TpProjectState, requirement: TpLocalFileRequirement): TpRequirementStatus {
  if (requirement.category === "template") return "ready";
  const populated = requirement.paths.filter((path) => hasValue(valueAtPath(state, path))).length;
  if (populated === requirement.paths.length && populated > 0) return "ready";
  return populated > 0 ? "partial" : "missing";
}

export function tpGenerationReadiness(state: TpProjectState) {
  const requirements = tpLocalFileRequirements.map((requirement) => ({
    ...requirement,
    status: tpRequirementStatus(state, requirement)
  }));
  const summary = (["template", "extractable", "additional", "advisor"] as TpRequirementCategory[]).map((category) => {
    const entries = requirements.filter((item) => item.category === category);
    return { category, ready: entries.filter((item) => item.status === "ready").length, total: entries.length };
  });
  const blockers = requirements.filter((item) => item.requiredBeforeFinal && item.status !== "ready");
  const dataConflicts = state.mergeConflicts.filter((conflict) => conflict.status === "unresolved");
  return { requirements, summary, blockers, dataConflicts };
}

export function tpProjectCompleteness(state: TpProjectState) {
  const weighted: Array<[unknown, number]> = [
    [state.companyName, 8], [state.fiscalYear, 5], [state.companyAddress, 3], [state.shareholders, 6],
    [state.management, 4], [state.affiliatedParties, 8], [state.businessActivities, 8], [state.products, 4],
    [state.affiliatedTransactions, 12], [state.transactionDetails, 8], [state.pricingPolicy, 5],
    [state.farAnalysis, 6],
    [state.financialData.revenue, 5], [state.financialData.operatingProfit, 5], [state.selectedMethod, 4],
    [state.testedParty, 4], [state.analysisPeriod, 3], [state.comparableCompanies, 5], [state.analysis.executiveSummary, 3]
  ];
  const achieved = weighted.reduce((sum, [value, weight]) => sum + (hasValue(value) ? weight : 0), 0);
  const total = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  return Math.round((achieved / total) * 100);
}

export function tpProjectStatusAfterAnalysis(state: TpProjectState): Extract<TpProjectStatus, "analyzed" | "ready"> {
  const completeness = tpProjectCompleteness(state);
  const readiness = tpGenerationReadiness(state);
  return completeness >= 80 && readiness.blockers.length === 0 && readiness.dataConflicts.length === 0 ? "ready" : "analyzed";
}

type ArrayMergeRule = {
  identityFields: string[];
};

const arrayMergeRules: Record<string, ArrayMergeRule> = {
  shareholders: { identityFields: ["name"] },
  management: { identityFields: ["name", "position"] },
  affiliatedParties: { identityFields: ["name", "country"] },
  products: { identityFields: ["name"] },
  organizationDepartments: { identityFields: ["name"] },
  affiliatedTransactions: { identityFields: ["counterparty", "country", "transactionType", "currency"] },
  independentTransactions: { identityFields: ["counterparty", "country", "transactionType", "currency"] },
  searchCriteriaResults: { identityFields: ["step"] },
  rejectionMatrix: { identityFields: ["name"] },
  comparableCompanies: { identityFields: ["name", "country"] }
};

function normalizedIdentityPart(value: unknown) {
  return text(value).toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
}

function entityIdentity(value: unknown, rule: ArrayMergeRule) {
  if (!value || typeof value !== "object") return "";
  const entry = value as Record<string, unknown>;
  const parts = rule.identityFields.map((field) => normalizedIdentityPart(entry[field]));
  return parts.some(Boolean) ? parts.join("|") : "";
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function mergeSources(target: Record<string, string[]>, path: string, sources: string[]) {
  const normalized = sources.map(text).filter(Boolean);
  if (normalized.length) target[path] = Array.from(new Set([...(target[path] || []), ...normalized]));
}

function mergeEntityArrays(
  current: unknown[],
  incoming: unknown[],
  path: string,
  merged: TpProjectState,
  patchSources: Record<string, string[]>,
  sourceDocumentId?: string
) {
  const rule = arrayMergeRules[path];
  if (!rule) {
    const result = [...current];
    const seen = new Set(result.map((entry) => JSON.stringify(entry)));
    incoming.forEach((entry) => {
      const signature = JSON.stringify(entry);
      if (!seen.has(signature)) {
        result.push(entry);
        seen.add(signature);
      }
    });
    return result;
  }

  const result = current.map((entry) => entry && typeof entry === "object" ? { ...(entry as Record<string, unknown>) } : entry);
  const indexes = new Map<string, number>();
  result.forEach((entry, index) => {
    const identity = entityIdentity(entry, rule);
    if (identity && !indexes.has(identity)) indexes.set(identity, index);
  });

  for (const incomingEntry of incoming) {
    const identity = entityIdentity(incomingEntry, rule);
    const existingIndex = identity ? indexes.get(identity) : undefined;
    if (existingIndex === undefined) {
      const signature = JSON.stringify(incomingEntry);
      if (!result.some((entry) => JSON.stringify(entry) === signature)) {
        result.push(incomingEntry);
        if (identity) indexes.set(identity, result.length - 1);
      }
      if (identity) mergeSources(merged.fieldSources, `${path}#${stableHash(identity)}`, [sourceDocumentId || "", ...(patchSources[path] || [])]);
      continue;
    }

    const existingEntry = result[existingIndex];
    if (!existingEntry || typeof existingEntry !== "object" || !incomingEntry || typeof incomingEntry !== "object") continue;
    const existingRecord = existingEntry as Record<string, unknown>;
    const incomingRecord = incomingEntry as Record<string, unknown>;
    const entitySourcePath = `${path}#${stableHash(identity)}`;
    const entitySources = [
      ...(merged.fieldSources[entitySourcePath] || []),
      ...(merged.fieldSources[path] || []),
      ...(patchSources[path] || []),
      sourceDocumentId || ""
    ].map(text).filter(Boolean);
    mergeSources(merged.fieldSources, entitySourcePath, entitySources);

    for (const [field, incomingValue] of Object.entries(incomingRecord)) {
      const existingValue = existingRecord[field];
      const incomingPresent = typeof incomingValue === "boolean" || hasValue(incomingValue);
      const existingPresent = typeof existingValue === "boolean" || hasValue(existingValue);
      if (!incomingPresent) continue;
      if (!existingPresent) {
        existingRecord[field] = incomingValue;
        continue;
      }
      if (JSON.stringify(existingValue) === JSON.stringify(incomingValue)) continue;
      if (rule.identityFields.includes(field)) continue;
      const conflictId = stableHash(`${path}|${identity}|${field}|${JSON.stringify(existingValue)}|${JSON.stringify(incomingValue)}`);
      const existingConflict = merged.mergeConflicts.find((conflict) => conflict.id === conflictId);
      if (existingConflict) {
        existingConflict.sourceDocumentIds = Array.from(new Set([...existingConflict.sourceDocumentIds, ...entitySources]));
      } else {
        merged.mergeConflicts.push({
          id: conflictId,
          path,
          entityKey: identity,
          field,
          existingValue: text(existingValue),
          incomingValue: text(incomingValue),
          sourceDocumentIds: Array.from(new Set(entitySources)),
          status: "unresolved"
        });
      }
    }
  }
  return result;
}

export function mergeTpProjectState(currentValue: unknown, patchValue: unknown, sourceDocumentId?: string) {
  const current = normalizeTpProjectState(currentValue);
  const patch = normalizeTpProjectState(patchValue);
  const merged = structuredClone(current);
  Object.entries(patch.fieldSources).forEach(([path, sources]) => mergeSources(merged.fieldSources, path, sources));
  const mergeRecord = (target: Record<string, unknown>, incoming: Record<string, unknown>, prefix = "") => {
    for (const [key, value] of Object.entries(incoming)) {
      if (key === "fieldSources" || key === "analysis" || key === "mergeConflicts") continue;
      const path = prefix ? `${prefix}.${key}` : key;
      if (Array.isArray(value)) {
        if (value.length) {
          const existing = Array.isArray(target[key]) ? target[key] as unknown[] : [];
          target[key] = mergeEntityArrays(existing, value, path, merged, patch.fieldSources, sourceDocumentId);
          mergeSources(merged.fieldSources, path, [sourceDocumentId || "", ...(patch.fieldSources[path] || [])]);
        }
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
