export type UserRole = "admin" | "user";

export type ManagedUser = {
  id: string;
  username: string;
  password: string;
  name: string;
  role: UserRole;
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

export const seedUsers: ManagedUser[] = [
  {
    id: "user-admin-rsm",
    username: "admin",
    password: "Admin@RSM2026",
    name: "Admin RSM",
    role: "admin",
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
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  }
];

export function normalizeUsername(value: string) {
  return String(value || "").trim().toLowerCase();
}

export function userIdFromUsername(username: string) {
  return `user-${normalizeUsername(username).replace(/[^a-z0-9]+/g, "-") || "new"}`;
}
