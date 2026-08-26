import type { AppSession } from "./auth";

export type EnterpriseReadinessStatus = "ready_local" | "ready_production" | "partial" | "gap";

function positiveDays(name: string, fallback: number) {
  const value = Number(process.env[name] || fallback);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function retentionPolicyFromEnv() {
  return {
    enabled: String(process.env.TDP_RETENTION_ENABLED || "false").toLowerCase() === "true",
    auditDays: positiveDays("TDP_RETENTION_AUDIT_DAYS", 365),
    chatDays: positiveDays("TDP_RETENTION_CHAT_DAYS", 180),
    privateFileDays: positiveDays("TDP_RETENTION_PRIVATE_FILE_DAYS", 365),
    backupDays: positiveDays("TDP_RETENTION_BACKUP_DAYS", 30),
    legalHoldMode: String(process.env.TDP_LEGAL_HOLD_MODE || "manual").toLowerCase() === "manual" ? "manual" as const : "external" as const,
    destructiveSweepEnabled: String(process.env.TDP_RETENTION_DESTRUCTIVE_SWEEP || "false").toLowerCase() === "true"
  };
}

export function retentionDisposition(createdAt: string, category: "audit" | "chat" | "private_file" | "backup", legalHold = false, now = Date.now()) {
  const policy = retentionPolicyFromEnv();
  const days = category === "audit" ? policy.auditDays : category === "chat" ? policy.chatDays : category === "private_file" ? policy.privateFileDays : policy.backupDays;
  const expiresAt = Date.parse(createdAt) + days * 86_400_000;
  return {
    category,
    expiresAt: new Date(expiresAt).toISOString(),
    expired: Number.isFinite(expiresAt) && expiresAt <= now,
    legalHold,
    action: legalHold || !policy.enabled || !policy.destructiveSweepEnabled ? "retain" as const : expiresAt <= now ? "eligible_for_reviewed_deletion" as const : "retain" as const
  };
}

export function enterpriseIdentityReadiness() {
  const oidc = Boolean(process.env.TDP_OIDC_ISSUER && process.env.TDP_OIDC_CLIENT_ID && process.env.TDP_OIDC_CLIENT_SECRET);
  const mfaRequired = String(process.env.TDP_MFA_REQUIRED || "false").toLowerCase() === "true";
  return {
    localSignedSession: true,
    oidcConfigured: oidc,
    oidcImplemented: false,
    mfaRequired,
    mfaClaimEnforced: mfaRequired,
    status: oidc ? "partial" as EnterpriseReadinessStatus : "gap" as EnterpriseReadinessStatus,
    note: oidc ? "OIDC configuration is present, but callback/token verification is not implemented." : "Local role login is available; enterprise OIDC SSO is not configured."
  };
}

export function sessionHasMfa(session: AppSession) {
  return Array.isArray(session.amr) && session.amr.some((method) => ["mfa", "otp", "hwk"].includes(method.toLowerCase()));
}

export function assertEnterpriseMfa(session: AppSession) {
  if (String(process.env.TDP_MFA_REQUIRED || "false").toLowerCase() === "true" && !sessionHasMfa(session)) {
    throw new Error("enterprise_mfa_required");
  }
}
