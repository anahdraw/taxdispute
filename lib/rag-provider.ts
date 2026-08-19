export type RagProviderMode = "baseline" | "shadow" | "lightrag";

export type RagProviderName = "baseline" | "lightrag";

export type RagProviderAttempt<T> =
  | {
      provider: RagProviderName;
      ok: true;
      latencyMs: number;
      value: T;
    }
  | {
      provider: RagProviderName;
      ok: false;
      latencyMs: number;
      error: string;
    };

export type RagProviderRun<T, Comparison = never> = {
  requestedMode: RagProviderMode;
  servedBy: RagProviderName;
  fallbackUsed: boolean;
  value: T;
  baseline?: RagProviderAttempt<T>;
  lightrag?: RagProviderAttempt<T>;
  comparison?: Comparison;
};

export type RagProviderOptions<T, Comparison = never> = {
  mode: RagProviderMode;
  baseline: () => Promise<T>;
  lightrag?: () => Promise<T>;
  compare?: (baseline: T, lightrag: T) => Comparison;
  now?: () => number;
};

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Unknown provider error");
  return message.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 500);
}

async function attempt<T>(provider: RagProviderName, operation: () => Promise<T>, now: () => number): Promise<RagProviderAttempt<T>> {
  const startedAt = now();
  try {
    const value = await operation();
    return {
      provider,
      ok: true,
      latencyMs: Math.max(0, now() - startedAt),
      value
    };
  } catch (error) {
    return {
      provider,
      ok: false,
      latencyMs: Math.max(0, now() - startedAt),
      error: safeErrorMessage(error)
    };
  }
}

function providerFailure(attemptResult: RagProviderAttempt<unknown> | undefined, provider: RagProviderName) {
  return attemptResult && !attemptResult.ok ? `${provider}: ${attemptResult.error}` : `${provider}: provider is not configured`;
}

export class RagProvidersUnavailableError extends Error {
  readonly baselineError: string;
  readonly lightRagError: string;

  constructor(baselineError: string, lightRagError: string) {
    super(`RAG providers unavailable (${baselineError}; ${lightRagError})`);
    this.name = "RagProvidersUnavailableError";
    this.baselineError = baselineError;
    this.lightRagError = lightRagError;
  }
}

/**
 * Normalize the rollout flag while failing closed to the existing retrieval.
 * Supported aliases make local scripts less brittle, but only the three
 * canonical values are returned to callers.
 */
export function normalizeRagProviderMode(value: unknown): RagProviderMode {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  if (["lightrag", "light-rag", "graph"].includes(normalized)) return "lightrag";
  if (["shadow", "compare", "comparison", "dual-run"].includes(normalized)) return "shadow";
  return "baseline";
}

export function ragProviderModeFromEnv(env: Record<string, string | undefined> = process.env) {
  return normalizeRagProviderMode(env.AAJ_RAG_PROVIDER || env.RAG_ENGINE);
}

/**
 * Execute the selected provider behind a reversible feature flag.
 *
 * - baseline: use the existing AA-Jurist retrieval only.
 * - lightrag: prefer LightRAG and synchronously fall back to baseline.
 * - shadow: run both concurrently, serve baseline, and retain both results for
 *   an evaluation harness. If baseline itself fails, the successful shadow
 *   result is used as a continuity fallback.
 *
 * Both callbacks deliberately return the same application-level type. The
 * route owns the mapping from LightRAG context into its existing response
 * contract, so this adapter does not couple the provider to one chatbot.
 */
export async function runRagProvider<T, Comparison = never>({
  mode,
  baseline,
  lightrag,
  compare,
  now = Date.now
}: RagProviderOptions<T, Comparison>): Promise<RagProviderRun<T, Comparison>> {
  if (mode === "baseline") {
    const baselineAttempt = await attempt("baseline", baseline, now);
    if (!baselineAttempt.ok) throw new Error(baselineAttempt.error);
    return {
      requestedMode: mode,
      servedBy: "baseline",
      fallbackUsed: false,
      value: baselineAttempt.value,
      baseline: baselineAttempt
    };
  }

  if (mode === "lightrag") {
    const lightAttempt = lightrag
      ? await attempt("lightrag", lightrag, now)
      : ({ provider: "lightrag", ok: false, latencyMs: 0, error: "provider is not configured" } as const);
    if (lightAttempt.ok) {
      return {
        requestedMode: mode,
        servedBy: "lightrag",
        fallbackUsed: false,
        value: lightAttempt.value,
        lightrag: lightAttempt
      };
    }

    const baselineAttempt = await attempt("baseline", baseline, now);
    if (!baselineAttempt.ok) {
      throw new RagProvidersUnavailableError(providerFailure(baselineAttempt, "baseline"), providerFailure(lightAttempt, "lightrag"));
    }
    return {
      requestedMode: mode,
      servedBy: "baseline",
      fallbackUsed: true,
      value: baselineAttempt.value,
      baseline: baselineAttempt,
      lightrag: lightAttempt
    };
  }

  const [baselineAttempt, lightAttempt] = await Promise.all([
    attempt("baseline", baseline, now),
    lightrag
      ? attempt("lightrag", lightrag, now)
      : Promise.resolve({ provider: "lightrag", ok: false, latencyMs: 0, error: "provider is not configured" } as const)
  ]);

  if (baselineAttempt.ok) {
    const comparison = lightAttempt.ok && compare ? compare(baselineAttempt.value, lightAttempt.value) : undefined;
    return {
      requestedMode: mode,
      servedBy: "baseline",
      fallbackUsed: false,
      value: baselineAttempt.value,
      baseline: baselineAttempt,
      lightrag: lightAttempt,
      ...(comparison === undefined ? {} : { comparison })
    };
  }
  if (lightAttempt.ok) {
    return {
      requestedMode: mode,
      servedBy: "lightrag",
      fallbackUsed: true,
      value: lightAttempt.value,
      baseline: baselineAttempt,
      lightrag: lightAttempt
    };
  }
  throw new RagProvidersUnavailableError(providerFailure(baselineAttempt, "baseline"), providerFailure(lightAttempt, "lightrag"));
}
