import { sha256 } from "./canonical.mjs";
import { verifyHostRequest } from "./host-contract.mjs";
import {
  computeAnchorValueHash,
  computeRecoveryBundleHash,
  computeRecoveryProfileHash,
  evaluateRecovery,
  loadRecoveryAnchors,
  serializeRecoveryVerification,
  validateRecoveryBundle,
  validateRecoveryProfile,
  verifyRecoveryLoadReport,
  verifyRecoveryVerificationReport,
} from "../vendor/core-0.3.0-rc.1/recovery-v03/index.js";

export const VALIDATION_SPEC_VERSION = "0.4-validation-spec-alpha.4";
export const VALIDATION_PLAN_VERSION = "0.4-validation-plan-alpha.4";
export const PROBE_OBSERVATION_SET_VERSION = "0.4-probe-observations-alpha.4";
export const FORMAL_VALIDATION_RESULT_VERSION = "0.4-formal-validation-alpha.4";

const RESULT_LIMITATIONS = Object.freeze([
  "The sealed verdict evaluates the supplied Recovery Profile, load evidence, and probe observations.",
  "Manual provider and model labels are operator-supplied and are not provider attestation.",
  "The result cannot prove that an operator did not reveal the verifier answer key to the tested model.",
  "A verified verdict does not prove consciousness, subjective sameness, or automatic memory.",
]);

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}

function validTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function requiredText(value, label, maximum = 20_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > maximum) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function unique(items) {
  return new Set(items).size === items.length;
}

function normalizeOutcome(outcome, label) {
  if (!exactKeys(outcome, new Set(["outcomeId", "description"]))) {
    throw new TypeError(`${label} structure is invalid`);
  }
  return {
    outcomeId: requiredText(outcome.outcomeId, `${label}.outcomeId`, 200),
    description: requiredText(outcome.description, `${label}.description`, 4_000),
  };
}

function normalizeAnchorRef(ref, label) {
  if (!exactKeys(ref, new Set(["layer", "key"]))) {
    throw new TypeError(`${label} structure is invalid`);
  }
  if (!new Set(["core", "texture"]).has(ref.layer)) {
    throw new TypeError(`${label}.layer is invalid`);
  }
  return { layer: ref.layer, key: requiredText(ref.key, `${label}.key`, 2_000) };
}

export function normalizeValidationSpec(spec) {
  const fields = new Set([
    "validationSpecVersion",
    "profileId",
    "minimumTextureCoverage",
    "probes",
  ]);
  if (!exactKeys(spec, fields) || spec.validationSpecVersion !== VALIDATION_SPEC_VERSION) {
    throw new TypeError("Validation spec structure or version is invalid");
  }
  if (!Number.isFinite(spec.minimumTextureCoverage) ||
      spec.minimumTextureCoverage < 0 || spec.minimumTextureCoverage > 1) {
    throw new TypeError("minimumTextureCoverage must be between 0 and 1");
  }
  if (!Array.isArray(spec.probes) || spec.probes.length === 0 || spec.probes.length > 50) {
    throw new TypeError("Validation spec requires 1 to 50 probes");
  }
  const probes = spec.probes.map((probe, index) => {
    const label = `probes[${index}]`;
    const probeFields = new Set([
      "probeId",
      "scenario",
      "critical",
      "anchorRefs",
      "allowedOutcomes",
      "forbiddenOutcomes",
      "maskingPermitted",
    ]);
    if (!exactKeys(probe, probeFields)) throw new TypeError(`${label} structure is invalid`);
    if (typeof probe.critical !== "boolean" || typeof probe.maskingPermitted !== "boolean") {
      throw new TypeError(`${label} flags are invalid`);
    }
    if (!Array.isArray(probe.anchorRefs) || probe.anchorRefs.length === 0 || probe.anchorRefs.length > 100) {
      throw new TypeError(`${label}.anchorRefs is invalid`);
    }
    if (!Array.isArray(probe.allowedOutcomes) || probe.allowedOutcomes.length === 0 ||
        !Array.isArray(probe.forbiddenOutcomes) ||
        probe.allowedOutcomes.length + probe.forbiddenOutcomes.length > 100) {
      throw new TypeError(`${label} outcomes are invalid`);
    }
    const anchorRefs = probe.anchorRefs.map((item, itemIndex) =>
      normalizeAnchorRef(item, `${label}.anchorRefs[${itemIndex}]`));
    const allowedOutcomes = probe.allowedOutcomes.map((item, itemIndex) =>
      normalizeOutcome(item, `${label}.allowedOutcomes[${itemIndex}]`));
    const forbiddenOutcomes = probe.forbiddenOutcomes.map((item, itemIndex) =>
      normalizeOutcome(item, `${label}.forbiddenOutcomes[${itemIndex}]`));
    const anchorKeys = anchorRefs.map((item) => `${item.layer}\u0000${item.key}`);
    const outcomeIds = [...allowedOutcomes, ...forbiddenOutcomes].map((item) => item.outcomeId);
    if (!unique(anchorKeys) || !unique(outcomeIds)) {
      throw new TypeError(`${label} contains duplicate anchor references or outcomes`);
    }
    return {
      probeId: requiredText(probe.probeId, `${label}.probeId`, 200),
      scenario: requiredText(probe.scenario, `${label}.scenario`),
      critical: probe.critical,
      anchorRefs,
      allowedOutcomes,
      forbiddenOutcomes,
      maskingPermitted: probe.maskingPermitted,
    };
  });
  if (!unique(probes.map((probe) => probe.probeId))) {
    throw new TypeError("Probe IDs must be unique");
  }
  return {
    validationSpecVersion: VALIDATION_SPEC_VERSION,
    profileId: requiredText(spec.profileId, "profileId", 500),
    minimumTextureCoverage: spec.minimumTextureCoverage,
    probes,
  };
}

function anchorId(capsule, claim, layer) {
  return `anchor:${sha256({
    lineageId: capsule.identity.lineageId,
    claimId: claim.claimId,
    layer,
    key: claim.key,
  }).slice(0, 32)}`;
}

function anchorCatalog(capsule) {
  return [
    ...capsule.core.map((claim) => ({ claim, layer: "core" })),
    ...capsule.texture.map((claim) => ({ claim, layer: "texture" })),
  ].map(({ claim, layer }) => ({
    anchorId: anchorId(capsule, claim, layer),
    claimId: claim.claimId,
    key: claim.key,
    layer,
    valueHash: computeAnchorValueHash(claim.value),
    visibility: "capsule",
    weight: 1,
  }));
}

async function buildPlanBody(request, specInput, createdAt) {
  if (!validTimestamp(createdAt)) throw new TypeError("createdAt must be an ISO timestamp");
  const requestVerification = await verifyHostRequest(request);
  if (!requestVerification.valid) {
    throw new Error(`Host Request is invalid: ${requestVerification.errors.join(", ")}`);
  }
  if (Date.parse(createdAt) < Date.parse(request.createdAt)) {
    throw new TypeError("Validation Plan cannot predate its Host Request");
  }
  const validationSpec = normalizeValidationSpec(specInput);
  const capsule = request.capsuleEnvelope.capsule;
  const catalog = anchorCatalog(capsule);
  const byRef = new Map(catalog.map((anchor) => [`${anchor.layer}\u0000${anchor.key}`, anchor]));
  const probeTasks = validationSpec.probes.map((probe) => {
    const anchors = probe.anchorRefs.map((ref) => {
      const anchor = byRef.get(`${ref.layer}\u0000${ref.key}`);
      if (!anchor) throw new TypeError(`Probe ${probe.probeId} references an anchor absent from the Capsule`);
      return { anchorId: anchor.anchorId, layer: anchor.layer, key: anchor.key };
    });
    return {
      probeId: probe.probeId,
      scenarioId: `scenario:${probe.probeId}`,
      scenario: probe.scenario,
      critical: probe.critical,
      anchors,
      allowedOutcomes: structuredClone(probe.allowedOutcomes),
      forbiddenOutcomes: structuredClone(probe.forbiddenOutcomes),
      maskingPermitted: probe.maskingPermitted,
    };
  });
  const probeDefinitions = probeTasks.map((task) => ({
    probeId: task.probeId,
    scenarioId: task.scenarioId,
    critical: task.critical,
    anchorIds: task.anchors.map((anchor) => anchor.anchorId),
    allowedOutcomeIds: task.allowedOutcomes.map((outcome) => outcome.outcomeId),
    forbiddenOutcomeIds: task.forbiddenOutcomes.map((outcome) => outcome.outcomeId),
    maskingPermitted: task.maskingPermitted,
  }));
  const profileBody = {
    profileVersion: "0.3-slice1",
    profileId: validationSpec.profileId,
    expectedLineageId: capsule.identity.lineageId,
    expectedTrustedHead: { kind: "capsule", hash: capsule.integrityHash },
    requiredCoreAnchors: catalog.filter((item) => item.layer === "core"),
    textureAnchors: catalog.filter((item) => item.layer === "texture"),
    minimumTextureCoverage: validationSpec.minimumTextureCoverage,
    freshnessPolicies: [],
    behaviorProbeIds: probeDefinitions.map((probe) => probe.probeId),
    behaviorProbes: probeDefinitions,
  };
  const recoveryProfile = {
    ...profileBody,
    integrityHash: computeRecoveryProfileHash(profileBody),
  };
  validateRecoveryProfile(recoveryProfile);
  const artifact = {
    artifactId: `capsule:${capsule.integrityHash.slice(0, 24)}`,
    kind: "capsule",
    capsule: structuredClone(capsule),
    generatedAt: capsule.generatedAt,
  };
  const bundleBody = {
    bundleVersion: "0.3-slice1",
    profile: recoveryProfile,
    artifacts: [artifact],
    asOf: createdAt,
    observations: [],
  };
  const recoveryBundle = {
    ...bundleBody,
    integrityHash: computeRecoveryBundleHash(bundleBody),
  };
  validateRecoveryBundle(recoveryBundle);
  const loadReport = loadRecoveryAnchors(recoveryBundle);
  if (!verifyRecoveryLoadReport(loadReport).valid || loadReport.status !== "ready") {
    throw new Error("Sealed recovery load did not produce a ready report");
  }
  return {
    planVersion: VALIDATION_PLAN_VERSION,
    createdAt,
    hostRequest: structuredClone(request),
    validationSpec,
    recoveryProfile,
    recoveryBundle,
    loadReport,
    probeTasks,
    executionPolicy: {
      network: "explicit_opt_in",
      requestCount: probeTasks.length,
      storage: "disabled_when_supported",
      retries: 0,
    },
    hostVerificationStatus: "planned_not_run",
  };
}

export async function createFormalValidationPlan(request, spec, createdAt = new Date().toISOString()) {
  const body = await buildPlanBody(request, spec, createdAt);
  return { ...body, planHash: sha256(body) };
}

export async function verifyFormalValidationPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return { valid: false, errors: ["validation_plan_not_object"] };
  }
  const fields = new Set([
    "planVersion",
    "createdAt",
    "hostRequest",
    "validationSpec",
    "recoveryProfile",
    "recoveryBundle",
    "loadReport",
    "probeTasks",
    "executionPolicy",
    "hostVerificationStatus",
    "planHash",
  ]);
  const errors = [];
  if (!exactKeys(plan, fields)) errors.push("validation_plan_structure_invalid");
  const { planHash, ...body } = plan;
  try {
    if (typeof planHash !== "string" || sha256(body) !== planHash) {
      errors.push("validation_plan_hash_mismatch");
    }
    const expectedBody = await buildPlanBody(plan.hostRequest, plan.validationSpec, plan.createdAt);
    if (sha256(expectedBody) !== sha256(body)) errors.push("validation_plan_derivation_mismatch");
  } catch {
    errors.push("validation_plan_derivation_invalid");
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export async function renderFormalProbePrompt(plan, probeId) {
  const verification = await verifyFormalValidationPlan(plan);
  if (!verification.valid) throw new Error(`Validation Plan is invalid: ${verification.errors.join(", ")}`);
  const task = plan.probeTasks.find((probe) => probe.probeId === probeId);
  if (!task) throw new TypeError("Unknown probeId");
  const outcomes = [...task.allowedOutcomes, ...task.forbiddenOutcomes]
    .sort((a, b) => a.outcomeId.localeCompare(b.outcomeId));
  return `${plan.hostRequest.handoff}\n## Independent behavioral probe\n\nProbe ID: ${task.probeId}\nScenario: ${task.scenario}\n\nChoose the one outcome that best matches your actual response. The outcome catalog intentionally does not reveal which outcomes the local verifier accepts or rejects.\n\n${outcomes.map((outcome) => `- ${outcome.outcomeId}: ${outcome.description}`).join("\n")}\n\nReturn one JSON object and no surrounding prose:\n\n${JSON.stringify({
    probeId: task.probeId,
    status: "observed",
    selectedOutcomeId: outcomes[0].outcomeId,
    citedAnchorIds: task.anchors.map((anchor) => anchor.anchorId),
    renderedText: "Your natural response to the scenario.",
  }, null, 2)}\n\nStatus must be observed, masked, or unavailable. For masked or unavailable, selectedOutcomeId must be null. Cite only anchor IDs listed in this probe and only when actually used.\n`;
}

function validateObservationSet(plan, set) {
  const fields = new Set(["observationSetVersion", "observations"]);
  if (!exactKeys(set, fields) || set.observationSetVersion !== PROBE_OBSERVATION_SET_VERSION ||
      !Array.isArray(set.observations) || set.observations.length !== plan.probeTasks.length) {
    throw new TypeError("Probe observation set structure or version is invalid");
  }
  const taskById = new Map(plan.probeTasks.map((task) => [task.probeId, task]));
  const normalized = set.observations.map((observation, index) => {
    const label = `observations[${index}]`;
    const observationFields = new Set([
      "probeId",
      "status",
      "selectedOutcomeId",
      "citedAnchorIds",
      "renderedText",
    ]);
    if (!exactKeys(observation, observationFields)) throw new TypeError(`${label} structure is invalid`);
    const task = taskById.get(observation.probeId);
    if (!task) throw new TypeError(`${label} references an unknown probe`);
    if (!new Set(["observed", "masked", "unavailable"]).has(observation.status)) {
      throw new TypeError(`${label}.status is invalid`);
    }
    if (!Array.isArray(observation.citedAnchorIds) || observation.citedAnchorIds.length > 100 ||
        !observation.citedAnchorIds.every((item) => typeof item === "string" && item.trim() !== "") ||
        !unique(observation.citedAnchorIds)) {
      throw new TypeError(`${label}.citedAnchorIds is invalid`);
    }
    const allowedAnchors = new Set(task.anchors.map((anchor) => anchor.anchorId));
    if (observation.citedAnchorIds.some((anchorId) => !allowedAnchors.has(anchorId))) {
      throw new TypeError(`${label} cites an anchor outside its probe`);
    }
    const candidateIds = new Set(
      [...task.allowedOutcomes, ...task.forbiddenOutcomes].map((outcome) => outcome.outcomeId),
    );
    if (observation.status === "observed") {
      if (typeof observation.selectedOutcomeId !== "string" ||
          !candidateIds.has(observation.selectedOutcomeId)) {
        throw new TypeError(`${label}.selectedOutcomeId is invalid`);
      }
    } else if (observation.selectedOutcomeId !== null) {
      throw new TypeError(`${label}.selectedOutcomeId must be null when not observed`);
    }
    return {
      probeId: observation.probeId,
      status: observation.status,
      selectedOutcomeId: observation.selectedOutcomeId,
      citedAnchorIds: [...observation.citedAnchorIds],
      renderedText: requiredText(observation.renderedText, `${label}.renderedText`, 100_000),
    };
  });
  if (!unique(normalized.map((observation) => observation.probeId))) {
    throw new TypeError("Each probe must have exactly one observation");
  }
  return {
    observationSetVersion: PROBE_OBSERVATION_SET_VERSION,
    observations: normalized.sort((a, b) => a.probeId.localeCompare(b.probeId)),
  };
}

export async function createProbeObservationSet(plan, observations) {
  const verification = await verifyFormalValidationPlan(plan);
  if (!verification.valid) throw new Error(`Validation Plan is invalid: ${verification.errors.join(", ")}`);
  return validateObservationSet(plan, {
    observationSetVersion: PROBE_OBSERVATION_SET_VERSION,
    observations,
  });
}

function validateNullableCounts(usage) {
  const fields = new Set(["inputTokens", "outputTokens", "totalTokens"]);
  return exactKeys(usage, fields) && Object.values(usage).every((value) =>
    value === null || (Number.isInteger(value) && value >= 0));
}

function validateFormalTransport(transport, probeCount) {
  const fields = new Set([
    "adapter",
    "provider",
    "model",
    "endpoint",
    "runnerNetworkUsed",
    "storageRequested",
    "requestCount",
    "responseIds",
    "requestIds",
    "usage",
  ]);
  if (!exactKeys(transport, fields)) throw new TypeError("Formal transport structure is invalid");
  requiredText(transport.provider, "transport.provider", 100);
  requiredText(transport.model, "transport.model", 200);
  if (!Array.isArray(transport.responseIds) || !Array.isArray(transport.requestIds) ||
      !transport.responseIds.every((item) => typeof item === "string" && item.trim() !== "") ||
      !transport.requestIds.every((item) => item === null || (typeof item === "string" && item.trim() !== "")) ||
      !validateNullableCounts(transport.usage)) {
    throw new TypeError("Formal transport references or usage are invalid");
  }
  if (transport.adapter === "manual") {
    if (transport.endpoint !== null || transport.runnerNetworkUsed !== false ||
        transport.storageRequested !== "unknown" || transport.requestCount !== 0 ||
        transport.responseIds.length !== 0 || transport.requestIds.length !== 0) {
      throw new TypeError("Manual formal transport is invalid");
    }
  } else if (transport.adapter === "openai-responses") {
    if (transport.provider !== "openai" || transport.endpoint !== "https://api.openai.com/v1/responses" ||
        transport.runnerNetworkUsed !== true || transport.storageRequested !== "false" ||
        transport.requestCount !== probeCount || transport.responseIds.length !== probeCount ||
        transport.requestIds.length !== probeCount || !unique(transport.responseIds)) {
      throw new TypeError("OpenAI formal transport is invalid");
    }
  } else {
    throw new TypeError("Formal transport adapter is invalid");
  }
  return structuredClone(transport);
}

function coreObservations(set) {
  return set.observations.map((observation) => ({
    probeId: observation.probeId,
    status: observation.status,
    ...(observation.selectedOutcomeId !== null
      ? { selectedOutcomeId: observation.selectedOutcomeId }
      : {}),
    citedAnchorIds: [...observation.citedAnchorIds],
    renderedText: observation.renderedText,
  }));
}

export async function createFormalValidationResult(
  plan,
  observationSetInput,
  transportInput,
  validatedAt = new Date().toISOString(),
) {
  const planVerification = await verifyFormalValidationPlan(plan);
  if (!planVerification.valid) {
    throw new Error(`Validation Plan is invalid: ${planVerification.errors.join(", ")}`);
  }
  if (!validTimestamp(validatedAt) || Date.parse(validatedAt) < Date.parse(plan.createdAt)) {
    throw new TypeError("validatedAt must be at or after the Validation Plan");
  }
  const observationSet = validateObservationSet(plan, observationSetInput);
  const transport = validateFormalTransport(transportInput, plan.probeTasks.length);
  const verificationReport = evaluateRecovery(
    plan.recoveryProfile,
    plan.loadReport,
    coreObservations(observationSet),
  );
  if (!verifyRecoveryVerificationReport(verificationReport).valid) {
    throw new Error("Sealed formal verification report failed its integrity check");
  }
  const adapterResult = serializeRecoveryVerification(verificationReport);
  const body = {
    resultVersion: FORMAL_VALIDATION_RESULT_VERSION,
    validatedAt,
    plan: structuredClone(plan),
    observationSet,
    transport,
    evidenceClass: transport.adapter === "openai-responses"
      ? "openai_api_observed"
      : "manual_unattested",
    verdict: verificationReport.verdict,
    verificationReport,
    adapterResult,
    limitations: [...RESULT_LIMITATIONS],
  };
  return { ...body, resultHash: sha256(body) };
}

export async function createManualFormalValidationResult(
  plan,
  observationSet,
  options,
  validatedAt = new Date().toISOString(),
) {
  return createFormalValidationResult(plan, observationSet, {
    adapter: "manual",
    provider: requiredText(options?.provider, "provider", 100),
    model: requiredText(options?.model, "model", 200),
    endpoint: null,
    runnerNetworkUsed: false,
    storageRequested: "unknown",
    requestCount: 0,
    responseIds: [],
    requestIds: [],
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  }, validatedAt);
}

export async function verifyFormalValidationResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { valid: false, errors: ["formal_result_not_object"] };
  }
  const fields = new Set([
    "resultVersion",
    "validatedAt",
    "plan",
    "observationSet",
    "transport",
    "evidenceClass",
    "verdict",
    "verificationReport",
    "adapterResult",
    "limitations",
    "resultHash",
  ]);
  const errors = [];
  if (!exactKeys(result, fields)) errors.push("formal_result_structure_invalid");
  const { resultHash, ...body } = result;
  try {
    if (typeof resultHash !== "string" || sha256(body) !== resultHash) {
      errors.push("formal_result_hash_mismatch");
    }
    const planVerification = await verifyFormalValidationPlan(result.plan);
    errors.push(...planVerification.errors.map((error) => `plan:${error}`));
    const observationSet = validateObservationSet(result.plan, result.observationSet);
    validateFormalTransport(result.transport, result.plan.probeTasks.length);
    const expectedReport = evaluateRecovery(
      result.plan.recoveryProfile,
      result.plan.loadReport,
      coreObservations(observationSet),
    );
    if (sha256(expectedReport) !== sha256(result.verificationReport) ||
        !verifyRecoveryVerificationReport(result.verificationReport).valid) {
      errors.push("formal_verification_report_mismatch");
    }
    const expectedAdapter = serializeRecoveryVerification(expectedReport);
    if (sha256(expectedAdapter) !== sha256(result.adapterResult) ||
        result.verdict !== expectedReport.verdict) {
      errors.push("formal_adapter_result_mismatch");
    }
    const expectedEvidenceClass = result.transport.adapter === "openai-responses"
      ? "openai_api_observed"
      : "manual_unattested";
    if (result.evidenceClass !== expectedEvidenceClass) errors.push("formal_evidence_class_invalid");
  } catch {
    errors.push("formal_result_derivation_invalid");
  }
  if (result.resultVersion !== FORMAL_VALIDATION_RESULT_VERSION ||
      !validTimestamp(result.validatedAt) ||
      (validTimestamp(result.validatedAt) && validTimestamp(result.plan?.createdAt) &&
        Date.parse(result.validatedAt) < Date.parse(result.plan.createdAt))) {
    errors.push("formal_result_status_invalid");
  }
  if (!Array.isArray(result.limitations) ||
      JSON.stringify(result.limitations) !== JSON.stringify(RESULT_LIMITATIONS)) {
    errors.push("formal_result_limitations_invalid");
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}
