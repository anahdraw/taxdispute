import { hasDatabase, getAppSetting, upsertAppSetting } from "./db";
import {
  defaultAdminRuntimeSettings,
  normalizeAdminRuntimeSettings,
  type AdminRuntimeSettings,
  type PromptFeatureKey,
  type PromptLanguage
} from "./settings-schema";

const SETTINGS_KEY = "runtime_admin_settings_v1";
let memorySettings = defaultAdminRuntimeSettings();

export async function getRuntimeAdminSettings(): Promise<AdminRuntimeSettings> {
  if (!hasDatabase()) return memorySettings;
  try {
    const stored = await getAppSetting<AdminRuntimeSettings>(SETTINGS_KEY);
    memorySettings = normalizeAdminRuntimeSettings(stored || memorySettings);
  } catch {
    // Keep safe defaults when the database is temporarily unavailable.
  }
  return memorySettings;
}

export async function saveRuntimeAdminSettings(value: unknown): Promise<AdminRuntimeSettings> {
  const normalized = normalizeAdminRuntimeSettings({
    ...(value && typeof value === "object" ? value : {}),
    updatedAt: new Date().toISOString()
  });
  memorySettings = normalized;
  if (hasDatabase()) await upsertAppSetting(SETTINGS_KEY, normalized);
  return normalized;
}

export async function getManagedPrompt(feature: PromptFeatureKey, language: PromptLanguage) {
  const settings = await getRuntimeAdminSettings();
  return settings.prompts[feature][language];
}
