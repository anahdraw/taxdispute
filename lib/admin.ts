export type UserRole = "admin" | "user";
export type SubscriptionTier = "silver" | "gold" | "platinum";

export type TierFeatureKey =
  | "dashboard"
  | "guided"
  | "databaseRead"
  | "databaseWrite"
  | "disputeBot"
  | "regulationRead"
  | "regulationWrite"
  | "reports"
  | "admin";

export type SubscriptionTierConfig = {
  tier: SubscriptionTier;
  monthlyDocumentLimit: number | null;
  monthlyChatLimit: number | null;
  features: TierFeatureKey[];
};

export const subscriptionTierConfigs: Record<SubscriptionTier, SubscriptionTierConfig> = {
  silver: {
    tier: "silver",
    monthlyDocumentLimit: 25,
    monthlyChatLimit: 75,
    features: ["dashboard", "guided", "disputeBot", "reports"]
  },
  gold: {
    tier: "gold",
    monthlyDocumentLimit: 250,
    monthlyChatLimit: 750,
    features: ["dashboard", "guided", "databaseRead", "disputeBot", "regulationRead", "reports"]
  },
  platinum: {
    tier: "platinum",
    monthlyDocumentLimit: null,
    monthlyChatLimit: null,
    features: [
      "dashboard",
      "guided",
      "databaseRead",
      "databaseWrite",
      "disputeBot",
      "regulationRead",
      "regulationWrite",
      "reports",
      "admin"
    ]
  }
};

export type ManagedUser = {
  id: string;
  username: string;
  password: string;
  name: string;
  role: UserRole;
  tier: SubscriptionTier;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
};

export type ActivityLog = {
  id: string;
  createdAt: string;
  actor: string;
  role: UserRole | "guest";
  action: string;
  target: string;
  status: "success" | "warning" | "error";
  detail: string;
};

export type SystemCheck = {
  name: string;
  status: "ok" | "warning" | "error";
  detail: string;
  metric?: string;
};

function demoUsersEnabled() {
  const flag = process.env.TDP_DEMO_USERS_ENABLED;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return process.env.NODE_ENV !== "production";
}

const baseSeedUsers: ManagedUser[] = [
  {
    id: "user-admin-rsm",
    username: "admin",
    password: "Admin@RSM2026",
    name: "Admin RSM",
    role: "admin",
    tier: "platinum",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  },
  {
    id: "user-tax-advisor",
    username: "user",
    password: "User@RSM2026",
    name: "Tax Advisor User",
    role: "user",
    tier: "silver",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  }
];

const demoTierUsers: ManagedUser[] = [
  {
    id: "user-demo-silver",
    username: "demo-silver",
    password: "Silver@RSM2026",
    name: "Demo Silver Advisor",
    role: "user",
    tier: "silver",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  },
  {
    id: "user-demo-gold",
    username: "demo-gold",
    password: "Gold@RSM2026",
    name: "Demo Gold Advisor",
    role: "user",
    tier: "gold",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  },
  {
    id: "user-demo-platinum",
    username: "demo-platinum",
    password: "Platinum@RSM2026",
    name: "Demo Platinum Advisor",
    role: "user",
    tier: "platinum",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  }
];

export const seedUsers: ManagedUser[] = demoUsersEnabled() ? [...baseSeedUsers, ...demoTierUsers] : baseSeedUsers;

export function normalizeUsername(value: string) {
  return String(value || "").trim().toLowerCase();
}

export function defaultTierForRole(role: UserRole): SubscriptionTier {
  return role === "admin" ? "platinum" : "silver";
}

export function normalizeSubscriptionTier(value: unknown, role: UserRole = "user"): SubscriptionTier {
  if (role === "admin") return "platinum";
  const tier = String(value || "").trim().toLowerCase();
  return tier === "gold" || tier === "platinum" || tier === "silver" ? tier : defaultTierForRole(role);
}

export function getSubscriptionTierConfig(tier: SubscriptionTier) {
  return subscriptionTierConfigs[tier] || subscriptionTierConfigs.silver;
}

export function tierHasFeature(tier: SubscriptionTier, feature: TierFeatureKey) {
  return getSubscriptionTierConfig(tier).features.includes(feature);
}

export function userIdFromUsername(username: string) {
  return `user-${normalizeUsername(username).replace(/[^a-z0-9]+/g, "-") || "new"}`;
}
