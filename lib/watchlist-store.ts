import { readLocalJson, updateLocalJson } from "./local-json-store";
import type { Regulation } from "./mock-data";
import type { ResearchWorkspaceScope } from "./research-workspace";
import { alertsForChange, watchBelongsToScope, watchState, type WatchAlert, type WatchRule, type WatchlistSnapshot } from "./watchlist";

type WatchState = { rules: WatchRule[]; alerts: WatchAlert[] };
const FILE = "watchlist.json";
const EMPTY: WatchState = { rules: [], alerts: [] };

export async function listWatchlist(scope: ResearchWorkspaceScope): Promise<WatchlistSnapshot> {
  const state = await readLocalJson(FILE, EMPTY);
  const rules = state.rules.filter((item) => watchBelongsToScope(item, scope)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const alerts = state.alerts.filter((item) => watchBelongsToScope(item, scope)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 500);
  return { rules, alerts, unread: alerts.filter((alert) => !alert.acknowledgedAt).length };
}

export async function saveWatchRule(rule: WatchRule, records: Regulation[]) {
  const currentState = watchState(rule, records);
  let persisted = { ...rule, lastFingerprint: rule.lastFingerprint || currentState.fingerprint, lastSummary: Object.keys(rule.lastSummary).length ? rule.lastSummary : currentState.summary };
  await updateLocalJson(FILE, EMPTY, (state) => {
    const duplicate = state.rules.find((item) => item.tenantId === persisted.tenantId && item.ownerUserId === persisted.ownerUserId
      && (item.clientId || "") === (persisted.clientId || "") && (item.matterId || "") === (persisted.matterId || "")
      && (item.resourceId || "") === (persisted.resourceId || "") && (item.citation || "") === (persisted.citation || "")
      && (item.topic || "") === (persisted.topic || "") && item.keywords.join("|") === persisted.keywords.join("|"));
    if (duplicate) persisted = duplicate;
    const index = state.rules.findIndex((item) => item.id === persisted.id && item.tenantId === persisted.tenantId && item.ownerUserId === persisted.ownerUserId);
    const rules = [...state.rules]; if (index >= 0) rules[index] = persisted; else rules.push(persisted);
    return { ...state, rules };
  });
  return persisted;
}

export async function syncWatchlist(scope: ResearchWorkspaceScope, records: Regulation[]) {
  const now = new Date().toISOString();
  let created: WatchAlert[] = [];
  await updateLocalJson(FILE, EMPTY, (state) => {
    const rules = state.rules.map((rule) => {
      if (!watchBelongsToScope(rule, scope) || !rule.enabled) return rule;
      const next = watchState(rule, records);
      const alerts = alertsForChange(rule, next, now);
      created = [...created, ...alerts];
      return { ...rule, lastFingerprint: next.fingerprint, lastSummary: next.summary, lastCheckedAt: now, updatedAt: now };
    });
    const alertKeys = new Set(state.alerts.map((alert) => `${alert.watchId}:${alert.type}:${alert.fingerprint}`));
    const uniqueCreated = created.filter((alert) => !alertKeys.has(`${alert.watchId}:${alert.type}:${alert.fingerprint}`));
    created = uniqueCreated;
    return { rules, alerts: [...state.alerts, ...uniqueCreated].slice(-10_000) };
  });
  return { created, snapshot: await listWatchlist(scope) };
}

export async function acknowledgeAlert(scope: ResearchWorkspaceScope, id: string) {
  let found = false;
  const now = new Date().toISOString();
  await updateLocalJson(FILE, EMPTY, (state) => ({ ...state, alerts: state.alerts.map((alert) => {
    if (alert.id !== id || !watchBelongsToScope(alert, scope)) return alert;
    found = true; return { ...alert, acknowledgedAt: now };
  }) }));
  return found;
}

export async function deleteWatchRule(scope: ResearchWorkspaceScope, id: string) {
  let found = false;
  await updateLocalJson(FILE, EMPTY, (state) => ({
    rules: state.rules.filter((rule) => { const match = rule.id === id && watchBelongsToScope(rule, scope); if (match) found = true; return !match; }),
    alerts: state.alerts.filter((alert) => !(alert.watchId === id && watchBelongsToScope(alert, scope)))
  }));
  return found;
}
