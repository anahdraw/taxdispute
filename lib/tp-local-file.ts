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
  const financialPrior = source.financialDataPrior && typeof source.financialDataPrior === "object" ? source.financialDataPrior as Record<string, unknown> : {};
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
  return { requirements, summary, blockers };
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
        if (value.length) {
          target[key] = value;
          if (sourceDocumentId) merged.fieldSources[path] = Array.from(new Set([...(merged.fieldSources[path] || []), sourceDocumentId]));
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
