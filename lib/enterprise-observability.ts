import { randomUUID } from "node:crypto";
import { readLocalJson, updateLocalJson } from "./local-json-store";

export type EnterpriseMetricEvent = {
  id: string;
  tenantId: string;
  operation: string;
  provider: string;
  model: string;
  ok: boolean;
  latencyMs: number;
  inputTokensEstimate: number;
  outputTokensEstimate: number;
  estimatedCostUsd: number;
  createdAt: string;
  errorCode?: string;
};

type MetricState = { version: 1; events: EnterpriseMetricEvent[] };
const FILE = "enterprise-metrics.json";
const emptyState = (): MetricState => ({ version: 1, events: [] });

function finiteEnv(name: string) {
  const value = Number(process.env[name] || 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function enterpriseCostPolicy() {
  return {
    inputUsdPerMillion: finiteEnv("TDP_AI_INPUT_USD_PER_MILLION"),
    outputUsdPerMillion: finiteEnv("TDP_AI_OUTPUT_USD_PER_MILLION"),
    monthlyBudgetUsd: finiteEnv("TDP_MONTHLY_AI_BUDGET_USD"),
    warnAtPercent: Math.min(100, Math.max(1, finiteEnv("TDP_AI_BUDGET_WARN_PERCENT") || 80)),
    hardLimit: String(process.env.TDP_AI_BUDGET_HARD_LIMIT || "false").toLowerCase() === "true"
  };
}

export function estimateTokens(text: string) {
  return Math.max(0, Math.ceil(String(text || "").length / 4));
}

export function estimateAiCost(inputTokens: number, outputTokens: number) {
  const policy = enterpriseCostPolicy();
  return (Math.max(0, inputTokens) * policy.inputUsdPerMillion + Math.max(0, outputTokens) * policy.outputUsdPerMillion) / 1_000_000;
}

export async function recordEnterpriseMetric(input: Omit<EnterpriseMetricEvent, "id" | "createdAt" | "estimatedCostUsd"> & { estimatedCostUsd?: number }) {
  const event: EnterpriseMetricEvent = {
    ...input,
    operation: String(input.operation || "unknown").slice(0, 100),
    provider: String(input.provider || "local").slice(0, 60),
    model: String(input.model || "none").slice(0, 100),
    latencyMs: Math.max(0, Math.round(input.latencyMs || 0)),
    inputTokensEstimate: Math.max(0, Math.round(input.inputTokensEstimate || 0)),
    outputTokensEstimate: Math.max(0, Math.round(input.outputTokensEstimate || 0)),
    estimatedCostUsd: input.estimatedCostUsd ?? estimateAiCost(input.inputTokensEstimate, input.outputTokensEstimate),
    errorCode: input.errorCode ? String(input.errorCode).slice(0, 100) : undefined,
    id: randomUUID(),
    createdAt: new Date().toISOString()
  };
  await updateLocalJson(FILE, emptyState(), (state) => ({ ...state, events: [...state.events.slice(-49_999), event] }));
  return event;
}

export async function enterpriseUsageSummary(tenantId: string, now = new Date()) {
  const state = await readLocalJson(FILE, emptyState());
  const month = now.toISOString().slice(0, 7);
  const events = state.events.filter((event) => event.tenantId === tenantId && event.createdAt.startsWith(month));
  const estimatedCostUsd = events.reduce((sum, event) => sum + event.estimatedCostUsd, 0);
  const policy = enterpriseCostPolicy();
  const budgetUsedPercent = policy.monthlyBudgetUsd ? (estimatedCostUsd / policy.monthlyBudgetUsd) * 100 : 0;
  return {
    month,
    requests: events.length,
    failures: events.filter((event) => !event.ok).length,
    inputTokensEstimate: events.reduce((sum, event) => sum + event.inputTokensEstimate, 0),
    outputTokensEstimate: events.reduce((sum, event) => sum + event.outputTokensEstimate, 0),
    estimatedCostUsd: Math.round(estimatedCostUsd * 1_000_000) / 1_000_000,
    budgetUsd: policy.monthlyBudgetUsd,
    budgetUsedPercent: Math.round(budgetUsedPercent * 100) / 100,
    warning: Boolean(policy.monthlyBudgetUsd && budgetUsedPercent >= policy.warnAtPercent),
    blocked: Boolean(policy.hardLimit && policy.monthlyBudgetUsd && estimatedCostUsd >= policy.monthlyBudgetUsd)
  };
}

export async function assertEnterpriseAiBudget(tenantId: string) {
  const usage = await enterpriseUsageSummary(tenantId);
  if (usage.blocked) throw new Error("enterprise_ai_budget_exhausted");
  return usage;
}
