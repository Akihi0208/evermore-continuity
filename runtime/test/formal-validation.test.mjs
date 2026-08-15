import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sha256 } from "../src/canonical.mjs";
import { createCoreCapsuleEnvelope } from "../src/core-bridge.mjs";
import { createHostRequest } from "../src/host-contract.mjs";
import {
  createFormalValidationPlan,
  createManualFormalValidationResult,
  renderFormalProbePrompt,
  verifyFormalValidationPlan,
  verifyFormalValidationResult,
} from "../src/formal-validation.mjs";
import {
  buildOpenAIFormalValidationRequests,
  runOpenAIFormalValidation,
} from "../src/adapters/openai-formal-validation.mjs";

const profile = JSON.parse(await readFile(new URL("../examples/synthetic-profile.json", import.meta.url)));
const spec = JSON.parse(await readFile(new URL("../examples/synthetic-validation-spec.json", import.meta.url)));
const passingObservations = JSON.parse(
  await readFile(new URL("../examples/synthetic-probe-observations.json", import.meta.url)),
);

async function fixture() {
  const envelope = await createCoreCapsuleEnvelope(profile, "2026-08-15T01:00:00.000Z");
  const request = await createHostRequest(envelope, "2026-08-15T01:01:00.000Z");
  const plan = await createFormalValidationPlan(request, spec, "2026-08-15T01:02:00.000Z");
  return { envelope, request, plan };
}

test("formal plan derives a ready sealed Recovery Profile and seven probes", async () => {
  const { plan } = await fixture();
  assert.deepEqual(await verifyFormalValidationPlan(plan), { valid: true, errors: [] });
  assert.equal(plan.loadReport.status, "ready");
  assert.equal(plan.loadReport.coreCoverage, 1);
  assert.equal(plan.loadReport.textureCoverage, 1);
  assert.equal(plan.probeTasks.length, 7);
  assert.equal(plan.executionPolicy.requestCount, 7);
  assert.equal(plan.executionPolicy.retries, 0);
  assert.equal(plan.hostVerificationStatus, "planned_not_run");
});

test("probe prompt contains both actions without exposing the local answer classification", async () => {
  const { plan } = await fixture();
  const prompt = await renderFormalProbePrompt(plan, "probe-evidence-boundary");
  assert.match(prompt, /evidence:separate/);
  assert.match(prompt, /evidence:promote/);
  assert.doesNotMatch(prompt, /allowedActions|forbiddenActions/);
  assert.doesNotMatch(prompt, /Synthetic private anchor|Synthetic private note/);
});

test("formal plan rejects absent anchors and impossible time", async () => {
  const { request } = await fixture();
  const unknown = structuredClone(spec);
  unknown.probes[0].anchorRefs[0].key = "absent-anchor";
  await assert.rejects(
    createFormalValidationPlan(request, unknown, "2026-08-15T01:02:00.000Z"),
    /absent from the Capsule/,
  );
  await assert.rejects(
    createFormalValidationPlan(request, spec, "2026-08-15T01:00:30.000Z"),
    /cannot predate/,
  );
});

test("formal plan tampering fails even after an attacker recomputes the outer hash", async () => {
  const { plan } = await fixture();
  plan.executionPolicy.retries = 3;
  const { planHash: _oldHash, ...body } = plan;
  plan.planHash = sha256(body);
  const result = await verifyFormalValidationPlan(plan);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(","), /validation_plan_derivation_mismatch/);
});

test("manual passing observations produce a sealed verified report", async () => {
  const { plan } = await fixture();
  const result = await createManualFormalValidationResult(
    plan,
    passingObservations,
    { provider: "synthetic-manual-host", model: "synthetic-model" },
    "2026-08-15T01:03:00.000Z",
  );
  assert.equal(result.verdict, "verified");
  assert.equal(result.adapterResult.success, true);
  assert.equal(result.verificationReport.probeResults.length, 7);
  assert.equal(result.verificationReport.probeResults.every((item) => item.status === "passed"), true);
  assert.equal(result.evidenceClass, "manual_unattested");
  assert.equal(result.classification.method, "deterministic_action_mapping");
  assert.equal(result.classification.behaviorEvidence, "structured_action_choice");
  assert.equal(result.classification.renderedTextAssessment, "not_evaluated");
  assert.equal(
    result.classification.mappings.find((item) => item.probeId === "probe-evidence-boundary").derivedOutcomeId,
    "evidence:separate",
  );
  assert.deepEqual(await verifyFormalValidationResult(result), { valid: true, errors: [] });
});

test("a forbidden structured action mechanically produces a sealed rejected report", async () => {
  const { plan } = await fixture();
  const observations = structuredClone(passingObservations);
  observations.observations[0].selectedActionId = "evidence:promote";
  const result = await createManualFormalValidationResult(
    plan,
    observations,
    { provider: "synthetic-manual-host", model: "synthetic-model" },
    "2026-08-15T01:03:00.000Z",
  );
  assert.equal(result.verdict, "rejected");
  assert.equal(result.adapterResult.success, false);
  assert.match(result.verificationReport.reasonCodes.join(","), /critical_probe_failed/);
});

test("model-supplied outcome classification is rejected as an extra field", async () => {
  const { plan } = await fixture();
  const observations = structuredClone(passingObservations);
  observations.observations[0].selectedOutcomeId = "evidence:separate";
  await assert.rejects(createManualFormalValidationResult(
    plan,
    observations,
    { provider: "synthetic-manual-host", model: "synthetic-model" },
    "2026-08-15T01:03:00.000Z",
  ), /structure is invalid/);
});

test("renderedText is ancillary and cannot change deterministic action classification", async () => {
  const { plan } = await fixture();
  const observations = structuredClone(passingObservations);
  observations.observations[0].renderedText =
    "I would promote the unsupported claim because it sounds confident.";
  const result = await createManualFormalValidationResult(
    plan,
    observations,
    { provider: "synthetic-manual-host", model: "synthetic-model" },
    "2026-08-15T01:03:00.000Z",
  );
  assert.equal(result.verdict, "verified");
  assert.equal(result.classification.renderedTextAssessment, "not_evaluated");
  assert.match(result.limitations.join(" "), /semantic consistency.*not evaluated/);
});

test("classification metadata tampering fails after recomputing the outer hash", async () => {
  const { plan } = await fixture();
  const result = await createManualFormalValidationResult(
    plan,
    passingObservations,
    { provider: "synthetic-manual-host", model: "synthetic-model" },
    "2026-08-15T01:03:00.000Z",
  );
  result.classification.renderedTextAssessment = "verified";
  const { resultHash: _oldHash, ...body } = result;
  result.resultHash = sha256(body);
  const verification = await verifyFormalValidationResult(result);
  assert.equal(verification.valid, false);
  assert.match(verification.errors.join(","), /formal_classification_mismatch/);
});

test("missing anchor citation remains indeterminate and cannot become verified", async () => {
  const { plan } = await fixture();
  const observations = structuredClone(passingObservations);
  observations.observations[0].citedAnchorIds = [];
  const result = await createManualFormalValidationResult(
    plan,
    observations,
    { provider: "synthetic-manual-host", model: "synthetic-model" },
    "2026-08-15T01:03:00.000Z",
  );
  assert.equal(result.verdict, "indeterminate");
  assert.match(result.verificationReport.reasonCodes.join(","), /probe_anchor_reference_missing/);
});

test("observation injection and fixed-limit rewriting fail closed", async () => {
  const { plan } = await fixture();
  const injected = structuredClone(passingObservations);
  injected.observations[0].citedAnchorIds = ["anchor:invented"];
  await assert.rejects(createManualFormalValidationResult(
    plan,
    injected,
    { provider: "synthetic-manual-host", model: "synthetic-model" },
    "2026-08-15T01:03:00.000Z",
  ), /outside its probe/);
  const result = await createManualFormalValidationResult(
    plan,
    passingObservations,
    { provider: "synthetic-manual-host", model: "synthetic-model" },
    "2026-08-15T01:03:00.000Z",
  );
  result.limitations = ["Everything is now proven."];
  const { resultHash: _oldHash, ...body } = result;
  result.resultHash = sha256(body);
  const verification = await verifyFormalValidationResult(result);
  assert.equal(verification.valid, false);
  assert.match(verification.errors.join(","), /formal_result_limitations_invalid/);
});

test("OpenAI formal builder creates seven stateless answer-key-free requests", async () => {
  const { plan } = await fixture();
  const requests = await buildOpenAIFormalValidationRequests(plan, {
    model: "gpt-5.6-terra",
    reasoning: "medium",
  });
  assert.equal(requests.length, 7);
  for (const request of requests) {
    assert.equal(request.body.store, false);
    assert.equal(request.body.text.format.strict, true);
    assert.doesNotMatch(request.body.input, /allowedActions|forbiddenActions/);
    assert.equal("selectedOutcomeId" in request.body.text.format.schema.properties, false);
    assert.equal("selectedActionId" in request.body.text.format.schema.properties, true);
    assert.doesNotMatch(request.body.input, /Synthetic private anchor|Synthetic private note/);
  }
});

test("OpenAI formal reasoning accepts minimal and rejects max", async () => {
  const { plan } = await fixture();
  const requests = await buildOpenAIFormalValidationRequests(plan, {
    model: "synthetic-openai-model",
    reasoning: "minimal",
  });
  assert.deepEqual(requests[0].body.reasoning, { effort: "minimal" });
  await assert.rejects(buildOpenAIFormalValidationRequests(plan, {
    model: "synthetic-openai-model",
    reasoning: "max",
  }), /reasoning effort is invalid/);
});

test("OpenAI formal runner performs no call without opt-in or exact count confirmation", async () => {
  const { plan } = await fixture();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; };
  await assert.rejects(runOpenAIFormalValidation(plan, {
    model: "gpt-5.6-terra",
    apiKey: "synthetic-key",
    confirmedRequestCount: 7,
    fetchImpl,
  }), /explicit allowNetwork/);
  await assert.rejects(runOpenAIFormalValidation(plan, {
    model: "gpt-5.6-terra",
    apiKey: "synthetic-key",
    allowNetwork: true,
    confirmedRequestCount: 6,
    fetchImpl,
  }), /confirmedRequestCount=7/);
  assert.equal(calls, 0);
});

test("OpenAI formal runner binds exactly seven synthetic API responses", async () => {
  const { plan } = await fixture();
  const syntheticKey = "synthetic-key-never-persisted";
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    const index = calls;
    calls += 1;
    const body = JSON.parse(options.body);
    assert.equal(body.store, false);
    assert.equal(options.headers.Authorization, `Bearer ${syntheticKey}`);
    return {
      ok: true,
      status: 200,
      headers: { get: () => `req_${index + 1}` },
      json: async () => ({
        id: `resp_${index + 1}`,
        status: "completed",
        output_text: JSON.stringify(passingObservations.observations[index]),
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
      }),
    };
  };
  const result = await runOpenAIFormalValidation(plan, {
    model: "gpt-5.6-terra",
    reasoning: "medium",
    apiKey: syntheticKey,
    allowNetwork: true,
    confirmedRequestCount: 7,
    fetchImpl,
    validatedAt: "2026-08-15T01:03:00.000Z",
  });
  assert.equal(calls, 7);
  assert.equal(result.verdict, "verified");
  assert.equal(result.evidenceClass, "openai_api_observed");
  assert.equal(result.transport.responseIds.length, 7);
  assert.equal(result.transport.usage.totalTokens, 840);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(syntheticKey));
  assert.deepEqual(await verifyFormalValidationResult(result), { valid: true, errors: [] });
});

test("OpenAI formal runner stops on the first failed probe and never retries", async () => {
  const { plan } = await fixture();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 2) {
      return { ok: false, status: 429, headers: { get: () => "req_rate_limited" } };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => "req_first" },
      json: async () => ({
        id: "resp_first",
        status: "completed",
        output_text: JSON.stringify(passingObservations.observations[0]),
      }),
    };
  };
  await assert.rejects(runOpenAIFormalValidation(plan, {
    model: "gpt-5.6-terra",
    apiKey: "synthetic-key",
    allowNetwork: true,
    confirmedRequestCount: 7,
    fetchImpl,
  }), /2\/7 failed with HTTP 429.*no retry/);
  assert.equal(calls, 2);
});
