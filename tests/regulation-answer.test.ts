import assert from "node:assert/strict";
import test from "node:test";
import { graphEdgeEligibleForAnswer } from "../lib/regulation-answer";

test("graph evidence is fail-closed unless verified, answer-eligible and flag-free", () => {
  assert.equal(graphEdgeEligibleForAnswer({ verified: true, eligibleForAnswer: true, flags: [] }), true);
  assert.equal(graphEdgeEligibleForAnswer({ verified: false, eligibleForAnswer: true, flags: [] }), false);
  assert.equal(graphEdgeEligibleForAnswer({ verified: true, eligibleForAnswer: false, flags: [] }), false);
  assert.equal(graphEdgeEligibleForAnswer({ verified: true, eligibleForAnswer: true, flags: ["temporal_inconsistency"] }), false);
});
