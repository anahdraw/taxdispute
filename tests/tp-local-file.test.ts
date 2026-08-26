import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyTpProjectState,
  mergeTpProjectState,
  normalizeTpProjectState,
  tpGenerationReadiness,
  tpProjectCompleteness,
  tpProjectStatusAfterAnalysis
} from "../lib/tp-local-file";
import { buildTpResearchQueries, sanitizeTpResearchTerm } from "../lib/tavily";

test("multi-document extraction merges entity arrays without losing prior facts", () => {
  const initial = mergeTpProjectState(emptyTpProjectState(), {
    shareholders: [{ name: "PT Induk", shares: "100", capital: "", percentage: "80%" }],
    affiliatedTransactions: [{
      counterparty: "PT Afiliasi",
      country: "Indonesia",
      affiliationType: "Common control",
      transactionType: "Management services",
      value: "1000000",
      currency: "IDR",
      note: ""
    }]
  }, "document-one");

  const merged = mergeTpProjectState(initial, {
    shareholders: [
      { name: "PT Induk", shares: "100", capital: "800000", percentage: "80%" },
      { name: "Pemegang Saham B", shares: "20", capital: "200000", percentage: "20%" }
    ],
    affiliatedTransactions: [{
      counterparty: "PT Afiliasi",
      country: "Indonesia",
      affiliationType: "Common control",
      transactionType: "Management services",
      value: "1200000",
      currency: "IDR",
      note: "Per agreement"
    }]
  }, "document-two");

  assert.equal(merged.shareholders.length, 2);
  assert.equal(merged.shareholders[0].capital, "800000");
  assert.equal(merged.affiliatedTransactions.length, 1);
  assert.equal(merged.affiliatedTransactions[0].value, "1000000", "existing value remains authoritative pending review");
  assert.equal(merged.affiliatedTransactions[0].note, "Per agreement");
  const valueConflict = merged.mergeConflicts.find((item) => item.path === "affiliatedTransactions" && item.field === "value");
  assert.ok(valueConflict);
  assert.deepEqual(valueConflict.sourceDocumentIds.sort(), ["document-one", "document-two"]);
  assert.deepEqual(merged.fieldSources.affiliatedTransactions.sort(), ["document-one", "document-two"]);
  assert.equal(tpGenerationReadiness(merged).dataConflicts.length, 1);
});

test("re-extracting the same entity patch is idempotent", () => {
  const patch = {
    affiliatedParties: [{ name: "Affiliate One", country: "Singapore", relationship: "Parent", transactionType: "Services" }],
    products: [{ name: "Product A", description: "Industrial component" }]
  };
  const once = mergeTpProjectState(emptyTpProjectState(), patch, "document-one");
  const twice = mergeTpProjectState(once, patch, "document-one");
  assert.deepEqual(twice.affiliatedParties, once.affiliatedParties);
  assert.deepEqual(twice.products, once.products);
  assert.deepEqual(twice.mergeConflicts, []);
  assert.deepEqual(twice.fieldSources.affiliatedParties, ["document-one"]);
});

test("manual evidence is normalized with stable provenance fields", () => {
  const state = normalizeTpProjectState({
    ...emptyTpProjectState(),
    companyName: "Manual Input Entity",
    manualEvidence: [{
      id: "manual-evidence-1",
      title: "Finance manager confirmation",
      sourceKind: "management_interview",
      reference: "Finance Manager",
      locator: "Interview question 3",
      excerpt: "The legal entity name is Manual Input Entity.",
      fieldPaths: ["companyName", "companyName", ""],
      createdAt: "2026-08-26T00:00:00.000Z"
    }]
  });

  assert.equal(state.manualEvidence.length, 1);
  assert.deepEqual(state.manualEvidence[0]?.fieldPaths, ["companyName"]);
  assert.equal(state.manualEvidence[0]?.reference, "Finance Manager");
  assert.equal(state.manualEvidence[0]?.locator, "Interview question 3");
});

test("high completeness cannot become ready while mandatory requirements are blocked", () => {
  const state = mergeTpProjectState(emptyTpProjectState(), {
    companyName: "Example Taxpayer",
    fiscalYear: "2025",
    companyAddress: "Jakarta",
    shareholders: [{ name: "Shareholder", shares: "1", capital: "1", percentage: "100%" }],
    management: [{ name: "Director", position: "Director" }],
    employeeCount: "10",
    affiliatedParties: [{ name: "Affiliate", country: "Singapore", relationship: "Parent", transactionType: "Services" }],
    businessActivities: "Distribution services",
    products: [{ name: "Service", description: "Distribution support" }],
    businessStrategy: "Routine distributor",
    affiliatedTransactions: [{ counterparty: "Affiliate", country: "Singapore", affiliationType: "Parent", transactionType: "Services", value: "100", currency: "IDR", note: "" }],
    transactionType: "Services",
    transactionDetails: "Management services",
    pricingPolicy: "Cost plus",
    financialData: { revenue: "1000", operatingProfit: "100", netIncome: "80" },
    selectedMethod: "TNMM",
    selectedPli: "Operating margin",
    testedParty: "Example Taxpayer",
    analysisPeriod: "2025",
    comparableCompanies: [{ name: "Comparable", country: "Indonesia", description: "Distributor", ratio: "5%" }],
    analysis: { executiveSummary: "Complete draft" }
  });

  assert.ok(tpProjectCompleteness(state) >= 80);
  assert.ok(tpGenerationReadiness(state).blockers.length > 0);
  assert.equal(tpProjectStatusAfterAnalysis(state), "analyzed");
});

test("ready status requires both completeness and zero mandatory blockers", () => {
  const state = mergeTpProjectState(emptyTpProjectState(), {
    companyName: "Example Taxpayer",
    establishmentInfo: "Established in 2020",
    fiscalYear: "2025",
    companyAddress: "Jakarta",
    shareholders: [{ name: "Shareholder", shares: "1", capital: "1", percentage: "100%" }],
    management: [{ name: "Director", position: "Director" }],
    employeeCount: "10",
    affiliatedParties: [{ name: "Affiliate", country: "Singapore", relationship: "Parent", transactionType: "Services" }],
    businessActivities: "Distribution services",
    products: [{ name: "Service", description: "Distribution support" }],
    businessStrategy: "Routine distributor",
    affiliatedTransactions: [{ counterparty: "Affiliate", country: "Singapore", affiliationType: "Parent", transactionType: "Services", value: "100", currency: "IDR", note: "" }],
    transactionType: "Services",
    transactionDetails: "Management services",
    pricingPolicy: "Cost plus",
    farAnalysis: {
      functionsPerformed: "Routine distribution and customer support",
      assetsUsed: "Office, warehouse, inventory, and working capital",
      risksAssumed: "Limited market and inventory risks under group policy",
      contractualTerms: "Annual intercompany service agreement",
      economicCircumstances: "Indonesian replacement-parts market",
      intangiblesUsed: "Group trademarks under a limited right of use",
      serviceBenefitTest: "No duplicative or shareholder services identified"
    },
    backgroundTransaction: "Agreement and invoices available",
    supplyChainManagement: "Service delivery flow documented",
    financialData: { revenue: "1000", operatingProfit: "100", netIncome: "80" },
    searchCriteriaResults: [{ step: "Database search", criteria: "Independent distributors", resultCount: "1" }],
    rejectionMatrix: [{ name: "Comparable", reason: "Accepted after review", accepted: true }],
    comparableCompanies: [{ name: "Comparable", country: "Indonesia", description: "Distributor", ratio: "5%" }],
    selectedMethod: "TNMM",
    selectedPli: "Operating margin",
    testedParty: "Example Taxpayer",
    analysisPeriod: "2025",
    quartileRange: { q1: "3%", median: "5%", q3: "7%" },
    testedPartyRatio: "6%"
  });
  state.analysis.executiveSummary = "Complete draft";
  state.analysis.conclusion = "Within the arm's-length range";

  assert.deepEqual(tpGenerationReadiness(state).blockers, []);
  assert.equal(tpProjectStatusAfterAnalysis(state), "ready");
  const conflicted = mergeTpProjectState(state, {
    affiliatedTransactions: [{ counterparty: "Affiliate", country: "Singapore", affiliationType: "Parent", transactionType: "Services", value: "200", currency: "IDR", note: "" }]
  }, "conflicting-ledger");
  assert.equal(tpGenerationReadiness(conflicted).blockers.length, 0);
  assert.equal(tpGenerationReadiness(conflicted).dataConflicts.length, 1);
  assert.equal(tpProjectStatusAfterAnalysis(conflicted), "analyzed");
});

test("all outbound TP research query fields are anonymized", () => {
  const state = mergeTpProjectState(emptyTpProjectState(), {
    companyName: "PT Secret Alpha Indonesia",
    companyShortName: "SecretAlpha",
    parentCompany: "Global Nexus Holdings",
    brandName: "AlphaPrime",
    npwp: "01.234.567.8-999.000",
    companyAddress: "Jalan Rahasia 45 Jakarta",
    shareholders: [{ name: "Jane Confidential", shares: "1", capital: "1", percentage: "100%" }],
    management: [{ name: "John Private", position: "Director" }],
    affiliatedParties: [{ name: "Hidden Beta Pte Ltd", country: "Singapore", relationship: "Parent", transactionType: "Services" }],
    affiliatedTransactions: [{ counterparty: "Hidden Beta Pte Ltd", country: "Singapore", affiliationType: "Parent", transactionType: "Services", value: "100", currency: "IDR", note: "" }],
    transactionType: "Management services for Hidden Beta",
    businessActivities: "Secret Alpha manufactures and distributes automotive industrial components",
    products: [{ name: "Component", description: "AlphaPrime automotive replacement components" }],
    selectedMethod: "TNMM under SecretAlpha policy",
    selectedPli: "Operating margin for Secret Alpha",
    testedParty: "PT Secret Alpha Indonesia (tested party)"
  });

  const queryText = buildTpResearchQueries(state).map((item) => item.query).join(" ").toLowerCase();
  for (const secret of ["secret", "alpha", "secretalpha", "nexus", "hidden", "beta", "alphaprime", "confidential", "private", "01.234.567"]) {
    assert.equal(queryText.includes(secret), false, `outbound query leaked ${secret}`);
  }
  assert.match(queryText, /automotive/);
  assert.equal(sanitizeTpResearchTerm("Contact John Private at finance@example.com", state, "generic contact"), "Contact at");
});
