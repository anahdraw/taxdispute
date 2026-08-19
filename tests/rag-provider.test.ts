import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRagProviderMode, runRagProvider, RagProvidersUnavailableError } from "../lib/rag-provider";

test("provider flag fails closed and accepts rollout aliases", () => {
  assert.equal(normalizeRagProviderMode("unexpected"), "baseline");
  assert.equal(normalizeRagProviderMode("legacy"), "baseline");
  assert.equal(normalizeRagProviderMode("compare"), "shadow");
  assert.equal(normalizeRagProviderMode("light_rag"), "lightrag");
});

test("baseline mode does not call LightRAG", async () => {
  let graphCalls = 0;
  const timestamps = [100, 145];
  const result = await runRagProvider({
    mode: "baseline",
    baseline: async () => "legacy-result",
    lightrag: async () => {
      graphCalls += 1;
      return "graph-result";
    },
    now: () => timestamps.shift() || 145
  });
  assert.equal(result.value, "legacy-result");
  assert.equal(result.servedBy, "baseline");
  assert.equal(result.baseline?.latencyMs, 45);
  assert.equal(graphCalls, 0);
});

test("active LightRAG falls back to baseline on provider failure", async () => {
  const result = await runRagProvider({
    mode: "lightrag",
    baseline: async () => ({ answer: "safe baseline" }),
    lightrag: async () => {
      throw new Error("service unavailable");
    }
  });
  assert.deepEqual(result.value, { answer: "safe baseline" });
  assert.equal(result.servedBy, "baseline");
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.lightrag?.ok, false);
});

test("shadow mode serves baseline and exposes comparison", async () => {
  const result = await runRagProvider({
    mode: "shadow",
    baseline: async () => ({ ids: ["a", "b"] }),
    lightrag: async () => ({ ids: ["b", "c"] }),
    compare: (baseline, graph) => ({ common: baseline.ids.filter((id) => graph.ids.includes(id)) })
  });
  assert.equal(result.servedBy, "baseline");
  assert.deepEqual(result.value.ids, ["a", "b"]);
  assert.deepEqual(result.comparison, { common: ["b"] });
});

test("both provider failures return one typed failure", async () => {
  await assert.rejects(
    runRagProvider({
      mode: "shadow",
      baseline: async () => {
        throw new Error("baseline down");
      },
      lightrag: async () => {
        throw new Error("graph down");
      }
    }),
    RagProvidersUnavailableError
  );
});
