export type ActiveWorkspaceContext = {
  tenantId: string;
  clientId?: string;
  matterId?: string;
};

export const ACTIVE_WORKSPACE_CONTEXT_KEY = "aaj.active-workspace-context.v1";

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

function safeId(value: unknown) {
  const normalized = String(value || "").trim();
  return SAFE_ID.test(normalized) && normalized !== "." && normalized !== ".." ? normalized : "";
}

function normalizeContext(value: unknown): ActiveWorkspaceContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const tenantId = safeId(candidate.tenantId);
  if (!tenantId) return null;
  const clientId = safeId(candidate.clientId);
  const matterId = safeId(candidate.matterId);
  return {
    tenantId,
    ...(clientId ? { clientId } : {}),
    ...(clientId && matterId ? { matterId } : {})
  };
}

/**
 * Browser convenience only. The API must continue to derive the user from the
 * signed session and revalidate every tenant/client/matter identifier.
 */
export function readActiveWorkspaceContext(): ActiveWorkspaceContext | null {
  if (typeof window === "undefined") return null;
  try {
    return normalizeContext(JSON.parse(window.localStorage.getItem(ACTIVE_WORKSPACE_CONTEXT_KEY) || "null"));
  } catch {
    return null;
  }
}

export function writeActiveWorkspaceContext(context: ActiveWorkspaceContext) {
  if (typeof window === "undefined") return;
  const normalized = normalizeContext(context);
  try {
    if (!normalized) {
      window.localStorage.removeItem(ACTIVE_WORKSPACE_CONTEXT_KEY);
      return;
    }
    window.localStorage.setItem(ACTIVE_WORKSPACE_CONTEXT_KEY, JSON.stringify(normalized));
  } catch {
    // Storage preferences are best-effort; server-side authorization is authoritative.
  }
}

export function clearActiveWorkspaceContext() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ACTIVE_WORKSPACE_CONTEXT_KEY);
  } catch {
    // Ignore browsers where storage is disabled.
  }
}
