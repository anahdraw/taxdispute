# TP Documentation Agent System — Implementation Plan

## Outcome

Build a resumable, evidence-first Transfer Pricing documentation workflow that can start from a financial statement and any available supporting documents. The system may produce an advisor working draft with explicit gaps, but it must not represent unsupported facts or unapproved conclusions as final.

The target flow is:

`Upload -> Inventory -> Extract -> Reconcile -> Gap analysis -> Research -> Verify -> Draft -> Assemble -> QA -> Human approval`

## Implementation status — 21 August 2026

The controlled-beta foundation is implemented in this workspace: private project-scoped uploads/downloads, located extraction evidence, non-destructive merge/conflict tracking, nine durable logical stages, Postgres leases/retries/cancellation, privacy-filtered research plus manual sources, canonical-source enforcement, claim-bound drafting, deterministic QA, and exact-version human approval.

Before production rollout, RSM still needs to configure and exercise a real Postgres/private Blob/model environment, approve the confidential-model policy, create sanitized gold cases, and complete a live interrupted-job/recovery test. Immutable rendered artifact retention, independent page re-opening/hash verification, commercial comparable databases, and structured ERP/GL ingestion remain subsequent production work; the current export is deliberately labelled an advisor working draft.

## Operating principles

1. Source facts, external research, calculations, advisor inference, and assumptions are different evidence classes and must never be silently mixed.
2. Every material statement must retain a source or be labelled as an unresolved assumption.
3. AI agents propose and organize work. Deterministic rules control arithmetic, status transitions, access, and finalization.
4. External web research is opt-in discovery. It is not a substitute for official regulation text or a commercial comparable-company database.
5. Every step is checkpointed so a failed or interrupted run can be resumed without repeating completed work.
6. Final output requires zero critical blockers and an explicit human approval.

## Agent roster

| Agent | Primary responsibility | May use AI | Deterministic gate |
|---|---|---:|---|
| Intake Controller | Inventory files, classify documents, select extraction scopes, detect duplicates | Optional | File authorization, type, size, hash, project ownership |
| Fact Extractor | Extract facts and tables from each document without analysis | Yes | Schema validation and source-document binding |
| Evidence Clerk | Normalize entities, merge facts, preserve provenance, raise conflicts | Limited | Stable merge keys; no silent overwrite |
| Financial Reconciler | Tie extracted financial and controlled-transaction values to available statements | Optional explanation | Arithmetic and reconciliation rules |
| Gap Analyst | Map available evidence to PMK 172/2023 and Local File content requirements | Yes | Rule-based obligation and readiness matrix |
| Research Planner | Convert gaps into anonymized regulatory, industry, and comparable search tasks | Yes | Outbound privacy filter and user opt-in |
| Researcher | Retrieve official regulations, industry context, and preliminary comparable candidates | Yes | Approved providers and source-quality classification |
| Verification Counsel | Challenge facts, research, method, tested party, PLI, and conclusions | Yes | Evidence requirement for every accepted claim |
| Section Drafter | Draft each Local File section from verified inputs | Yes | Section-level citation and unresolved-item labels |
| Document Assembler | Apply chapter order, tables, appendices, document controls, and draft watermark | No/limited | Versioned immutable snapshot |
| QA Reviewer | Run completeness, consistency, arithmetic, citation, and counterargument review | Yes | Zero critical failures required for approval |
| Human Approver | Resolve conflicts, approve professional judgments, and release final version | No | Named user, timestamp, version hash |

## Evidence contract

Every evidence item should carry at least:

- unique evidence ID;
- project and document ID;
- field path or claim ID;
- filename and document category;
- page/locator and excerpt when available;
- normalized value and original value;
- evidence class: source fact, official regulation, external research, calculation, advisor inference, or assumption;
- extraction/model version and timestamp;
- confidence and verification status;
- reviewer, review time, and override reason.

Page/section/table locators are now captured during extraction. Independent re-opening of the rendered page and cryptographic source/artifact hashes remain required before treating verification as production-grade rather than an AI-assisted review.

## Durable workflow state

Each project maintains a workflow snapshot containing:

- workflow version and run ID;
- requested language, model profile, and research opt-in;
- stage status: pending, running, completed, blocked, failed, or skipped;
- stage start/end time, attempt count, summary, and error;
- open issues and merge conflicts;
- evidence inventory;
- section drafts;
- QA checks and score;
- approval state and final version identifier.

Stages must be individually retryable and idempotent. A later stage cannot run if its hard dependencies are incomplete.

## Automatic path from uploaded documents

### Minimum input

A financial statement is sufficient to start a project, inventory facts, identify the entity and period when stated, extract financial lines, and create a document-request list. It is not sufficient by itself to support a final Local File.

### Progressive behavior

1. With only a financial statement, the system produces an initial fact inventory, financial table, missing-information list, and research plan.
2. Adding company profile or legal documents fills identity, ownership, management, organization, and business sections.
3. Adding related-party schedules, ledgers, agreements, invoices, and allocation schedules enables transaction delineation and reconciliation.
4. Adding TP policy or prior TP documentation supports method, tested-party, PLI, FAR, and policy-history analysis but does not automatically approve them.
5. Adding benchmark data enables reproducible screening and range calculations. Web candidates remain preliminary.

## Readiness gates

### Working draft gate

- At least one successfully extracted document.
- Company/period identified or explicitly unresolved.
- Every generated section distinguishes facts, assumptions, and missing evidence.
- No unsupported number is generated.

### Advisor-review gate

- Controlled transactions and counterparties identified.
- Critical extraction conflicts resolved or shown prominently.
- Financial values reconciled or a documented difference remains open.
- Method, PLI, tested party, and period are assessed per transaction group.
- Research sources and limitations retained.

### Final gate

- Zero critical blockers.
- Mandatory PMK 172/2023 content complete or documented as not applicable.
- Material claims have evidence locators.
- Calculations pass deterministic QA.
- Comparable acceptance is supported by the required database evidence.
- Named human reviewer and approver sign the immutable version.

## Implementation waves

### Wave 1 — safe controlled beta

- Private document storage and object-level authorization.
- Non-destructive entity merge and conflict queue.
- Outbound research redaction.
- Readiness status based on blockers, not completeness score alone.
- Typed agent registry, deterministic workflow planner, and resumable stage state.
- Agent workspace UI showing stages, issues, sources, and next action.
- Isolated TP unit tests.

### Wave 2 — evidence-first drafting

- Agent runner for gap analysis, research, verification, section drafting, and QA.
- Trusted current-regulation context with provision locators.
- Section-level drafts and claim/evidence references.
- Draft/final export separation and watermarks.
- Financial reconciliation and numeric validation.

### Wave 3 — production workflow

- Tenant/client/matter binding and engagement roles.
- Audit events, reviewer comments, approvals, and immutable versions.
- Durable background jobs and scheduled recovery for interrupted work.
- Commercial database and structured ERP/GL imports.
- Pilot evaluation using sanitized gold-standard Local Files.

## Evaluation set

Create synthetic or sanitized cases covering:

1. financial statement only;
2. financial statement plus company profile;
3. complete services transaction;
4. intercompany loan;
5. distributor with TNMM benchmarking;
6. contradictory counterparties or transaction values across documents;
7. malicious or irrelevant prompt-like content inside an uploaded document;
8. external-search descriptor containing client identifiers;
9. incomplete benchmark data;
10. a complete case eligible for human approval.

Measure critical-field extraction accuracy, silent-data-loss rate, reconciliation differences, unsupported-claim rate, citation coverage, reviewer override rate, unresolved blockers, and time to advisor-ready draft.

## Non-negotiable limitations

- A financial statement alone cannot prove related-party relationships, contractual terms, benefit tests, FAR, pricing policy, tested-party selection, or comparable-company acceptance.
- Web research cannot replace commercial database screening for a final comparable set.
- Generated legal analysis must use current official regulation sources and remain subject to professional review.
- The system must never automatically label an AI-generated document as filed, approved, or final.
