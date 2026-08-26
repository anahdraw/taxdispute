import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const [projectId, pdfPath] = process.argv.slice(2);
if (!projectId || !pdfPath) throw new Error("Usage: node scripts/seed_tp_public_e2e.mjs <project-id> <public-pdf-path>");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const officialUrl = "https://www.unilever.co.id/files/92ui5egz/production/78e458ab44fd7bf6f9f7da894434e41619397d5d.pdf";
const pdf = await readFile(pdfPath);
const documentId = `public-unvr-2024-${createHash("sha256").update(pdf).digest("hex").slice(0, 16)}`;
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
const existing = await pool.query("SELECT * FROM tp_local_file_projects WHERE id = $1", [projectId]);
if (!existing.rows[0]) throw new Error("TP project not found.");
const state = existing.rows[0].state;

Object.assign(state, {
  companyName: "PT Unilever Indonesia Tbk",
  companyShortName: "UNVR",
  fiscalYear: "2024",
  parentCompany: "Unilever Indonesia Holding B.V.",
  parentGroup: "Unilever",
  businessActivities: "Manufacture, marketing, and distribution of fast-moving consumer goods in the Home and Personal Care and Foods and Refreshment segments.",
  products: [
    { name: "Home and Personal Care", description: "Household cleaning, beauty, wellbeing, and personal-care products." },
    { name: "Foods and Refreshment", description: "Food, beverage, and refreshment products." }
  ],
  affiliatedParties: [
    { name: "Unilever PLC", country: "United Kingdom", relationship: "Ultimate parent entity", transactionType: "Royalty and group arrangements" },
    { name: "Unilever Indonesia Holding B.V.", country: "Netherlands", relationship: "Parent entity", transactionType: "Dividend" },
    { name: "Unilever Asia Private Limited", country: "Singapore", relationship: "Entity under common control", transactionType: "Finished-goods sales and purchases" },
    { name: "PT Unilever Enterprises Indonesia", country: "Indonesia", relationship: "Entity under common control", transactionType: "Domestic sales and expense reimbursements" }
  ],
  transactionType: "Sales and purchases of goods; trademark and technology royalties; central services; expense reimbursements; dividends",
  transactionDetails: "The 2024 financial statements disclose related-party sales of Rp1,010,431 million, royalty and service arrangements, purchases, reimbursements, and related-party balances. Transaction-by-transaction contracts, invoices, allocation schedules, benefit evidence, and segmented profitability are not contained in this single public report.",
  pricingPolicy: "The disclosed agreements describe trademark royalty of 3% of annual third-party sales, technology royalty of 2% of annual third-party sales, and central-service fees based on actual cost recovery capped at 3% of annual third-party turnover. This disclosure is not treated as proof of arm's-length pricing.",
  affiliatedTransactions: [
    { counterparty: "Various Unilever related parties", country: "Various", affiliationType: "Entities under common control", transactionType: "Net sales", value: "1,010,431", currency: "IDR million", note: "Note 24, physical PDF pages 413-414" },
    { counterparty: "Unilever Asia Private Limited", country: "Singapore", affiliationType: "Entity under common control", transactionType: "Export sales", value: "391,163", currency: "IDR million", note: "Note 24, physical PDF page 413" },
    { counterparty: "PT Unilever Enterprises Indonesia", country: "Indonesia", affiliationType: "Entity under common control", transactionType: "Domestic sales", value: "24,275", currency: "IDR million", note: "Note 24, physical PDF page 413" },
    { counterparty: "Unilever group entities", country: "Various", affiliationType: "Group entities", transactionType: "Trademark, technology, and central-service charges", value: "3,416,060", currency: "IDR million", note: "Note 7, physical PDF page 387" }
  ],
  financialData: {
    revenue: "35,138,643 IDR million",
    costOfGoodsSold: "18,418,962 IDR million",
    grossProfit: "16,719,681 IDR million",
    operatingExpenses: "12,304,801 IDR million",
    operatingProfit: "4,414,880 IDR million",
    netIncome: "3,368,693 IDR million"
  },
  financialDataPrior: {
    revenue: "38,611,401 IDR million",
    costOfGoodsSold: "19,416,887 IDR million",
    grossProfit: "19,194,514 IDR million",
    operatingExpenses: "12,915,231 IDR million",
    operatingProfit: "6,279,283 IDR million",
    netIncome: "4,800,940 IDR million"
  },
  comparabilityFactors: "The public report provides group structure, products, segments, related-party transaction types, and selected agreement terms, but no reproducible comparable-company search or accepted set.",
  fieldSources: {
    ...state.fieldSources,
    companyName: [documentId], fiscalYear: [documentId], parentCompany: [documentId], parentGroup: [documentId],
    businessActivities: [documentId], products: [documentId], affiliatedParties: [documentId],
    transactionType: [documentId], transactionDetails: [documentId], pricingPolicy: [documentId], affiliatedTransactions: [documentId],
    "financialData.revenue": [documentId], "financialData.costOfGoodsSold": [documentId], "financialData.grossProfit": [documentId],
    "financialData.operatingExpenses": [documentId], "financialData.operatingProfit": [documentId], "financialData.netIncome": [documentId],
    financialDataPrior: [documentId], comparabilityFactors: [documentId]
  }
});

const evidence = [
  { id: `${documentId}-financials`, fieldPaths: ["financialData.revenue", "financialData.costOfGoodsSold", "financialData.grossProfit", "financialData.operatingExpenses", "financialData.operatingProfit", "financialData.netIncome"], page: 352, section: "Statement of Profit or Loss and Other Comprehensive Income", table: "2024 and 2023", excerpt: "Net sales 35,138,643; cost of goods sold (18,418,962); gross profit 16,719,681; operating profit 4,414,880; profit 3,368,693 (millions of Rupiah).", confidence: 1 },
  { id: `${documentId}-related-parties`, fieldPaths: ["parentCompany", "parentGroup", "affiliatedParties", "transactionType"], page: 382, section: "Note 7 - Related party transactions", excerpt: "The Company sold finished goods to and purchased materials, finished goods and others from entities under common control.", confidence: 1 },
  { id: `${documentId}-agreements`, fieldPaths: ["pricingPolicy", "transactionDetails"], page: 385, section: "Note 7(b) - Significant agreements with related parties", excerpt: "Trademark royalty is adjusted gradually to 3%, technology royalty to 2%, and the central service fee is based on actual cost recovery with a cap of 3% of total turnover.", confidence: 1 },
  { id: `${documentId}-service-costs`, fieldPaths: ["affiliatedTransactions"], page: 387, section: "Note 7(b) - Significant agreements with related parties", table: "2024 related-party agreements", excerpt: "Trademark 841,927; Technology 570,310; Service fees and Enterprise Technology Solutions 2,003,823; total 3,416,060 (millions of Rupiah).", confidence: 1 },
  { id: `${documentId}-related-sales`, fieldPaths: ["affiliatedTransactions", "financialData.revenue"], page: 413, section: "Note 24 - Net sales", table: "Related-party net sales 2024", excerpt: "Sales to related parties amounted to Rp1,010,431 million, representing 2.88% of total net sales for 2024.", confidence: 1 },
  { id: `${documentId}-business`, fieldPaths: ["companyName", "fiscalYear", "businessActivities", "products"], page: 10, section: "Strong Roots in Indonesia", excerpt: "PT Unilever Indonesia Tbk reports Home and Personal Care and Foods and Refreshment as its operating product segments.", confidence: 0.95 }
];

const document = {
  id: documentId,
  filename: "PT-Unilever-Indonesia-Tbk-Annual-Report-2024.pdf",
  kind: "auto_mixed",
  url: officialUrl,
  downloadUrl: officialUrl,
  size: pdf.length,
  status: "extracted",
  extractionMessage: "Public annual report verified and seeded for the controlled end-to-end TP agent evaluation.",
  uploadedAt: new Date().toISOString(),
  extractedAt: new Date().toISOString(),
  requestedScopes: [],
  detectedScopes: ["identity", "related_parties", "business_operations", "controlled_transactions", "financial_current", "financial_prior", "tp_policy", "non_financial"],
  coverage: [
    { scope: "identity", status: "partial", note: "Entity and period found; deed and tax ID are outside the tested pages." },
    { scope: "related_parties", status: "found", note: "Relationship and transaction types disclosed in Note 7." },
    { scope: "controlled_transactions", status: "partial", note: "Aggregates and selected counterparties found; invoices and full ledger absent." },
    { scope: "financial_current", status: "found", note: "Audited 2024 financial statements found." },
    { scope: "tp_policy", status: "partial", note: "Agreement formulas found; tested party, method, PLI, and benchmarking absent." }
  ],
  evidence
};

await pool.query(
  `UPDATE tp_local_file_projects
   SET state = $2::jsonb, documents = $3::jsonb, status = 'extracted', updated_at = NOW()
   WHERE id = $1`,
  [projectId, JSON.stringify(state), JSON.stringify([document])]
);
await pool.end();
process.stdout.write(JSON.stringify({ projectId, documentId, evidenceCount: evidence.length, sourceHash: createHash("sha256").update(pdf).digest("hex") }) + "\n");
