import { sha256 } from "./canonical.mjs";
import { verifyHostRequest } from "./host-contract.mjs";
import { isExplicitZoneTimestamp, timestampMillis } from "./timestamp.mjs";
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

export const VALIDATION_SPEC_VERSION = "0.4-validation-spec-alpha.5";
export const VALIDATION_PLAN_VERSION = "0.4-validation-plan-alpha.5";
export const PROBE_OBSERVATION_SET_VERSION = "0.4-probe-observations-alpha.5";
export const FORMAL_VALIDATION_RESULT_VERSION = "0.4-formal-validation-alpha.5";

const RESULT_LIMITATIONS = Object.freeze([
  "The sealed verdict evaluates model-declared action choices mechanically mapped to sealed outcomes, declared anchor citations, the supplied Recovery Profile, and load evidence; it does not independently verify the declared action.",
  "renderedText is retained as ancillary transcript evidence; its semantic consistency with selectedActionId is not evaluated.",
  "Anchor citations are model-reported references; the runner validates their catalog membership but cannot attest internal model use.",
  "Manual provider and model labels are operator-supplied and are not provider attestation.",
  "The result cannot prove that an operator did not reveal the verifier answer key to the tested model.",
  "A verified verdict does not prove consciousness, subjective sameness, or automatic memory.",
]);

const CLASSIFICATION_MODEL = Object.freeze({
  method: "deterministic_action_mapping",
  behaviorEvidence: "model_declared_action_choice",
  renderedTextAssessment: "not_evaluated",
});

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
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

function normalizeAction(action, label) {
  if (!exactKeys(action, new Set(["actionId", "description"]))) {
    throw new TypeError(`${label} structure is invalid`);
  }
  return {
    actionId: requiredText(action.actionId, `${label}.actionId`, 200),
    description: requiredText(action.description, `${label}.description`, 4_000),
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
      "allowedActions",
      "forbiddenActions",
      "maskingPermitted",
    ]);
    if (!exactKeys(probe, probeFields)) throw new TypeError(`${label} structure is invalid`);
    if (typeof probe.critical !== "boolean" || typeof probe.maskingPermitted !== "boolean") {
      throw new TypeError(`${label} flags are invalid`);
    }
    if (!Array.isArray(probe.anchorRefs) || probe.anchorRefs.length === 0 || probe.anchorRefs.length > 100) {
      throw new TypeError(`${label}.anchorRefs is invalid`);
    }
    if (!Array.isArray(probe.allowedActions) || probe.allowedActions.length === 0 ||
        !Array.isArray(probe.forbiddenActions) ||
        probe.allowedActions.length + probe.forbiddenActions.length > 100) {
      throw new TypeError(`${label} actions are invalid`);
    }
    const anchorRefs = probe.anchorRefs.map((item, itemIndex) =>
      normalizeAnchorRef(item, `${label}.anchorRefs[${itemIndex}]`));
    const allowedActions = probe.allowedActions.map((item, itemIndex) =>
      normalizeAction(item, `${label}.allowedActions[${itemIndex}]`));
    const forbiddenActions = probe.forbiddenActions.map((item, itemIndex) =>
      normalizeAction(item, `${label}.forbiddenActions[${itemIndex}]`));
    const anchorKeys = anchorRefs.map((item) => `${item.layer}\u0000${item.key}`);
    const actionIds = [...allowedActions, ...forbiddenActions].map((item) => item.actionId);
    if (!unique(anchorKeys) || !unique(actionIds)) {
      throw new TypeError(`${label} contains duplicate anchor references or actions`);
    }
    return {
      probeId: requiredText(probe.probeId, `${label}.probeId`, 200),
      scenario: requiredText(probe.scenario, `${label}.scenario`),
      critical: probe.critical,
      anchorRefs,
      allowedActions,
      forbiddenActions,
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
  timestampMillis(createdAt, "createdAt");
  const requestVerification = await verifyHostRequest(request);
  if (!requestVerification.valid) {
    throw new Error(`Host Request is invalid: ${requestVerification.errors.join(", ")}`);
  }
  if (timestampMillis(createdAt) < timestampMillis(request.createdAt)) {
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
      allowedActions: structuredClone(probe.allowedActions),
      forbiddenActions: structuredClone(probe.forbiddenActions),
      maskingPermitted: probe.maskingPermitted,
    };
  });
  const probeDefinitions = probeTasks.map((task) => ({
    probeId: task.probeId,
    scenarioId: task.scenarioId,
    critical: task.critical,
    anchorIds: task.anchors.map((anchor) => anchor.anchorId),
    allowedOutcomeIds: task.allowedActions.map((action) => action.actionId),
    forbiddenOutcomeIds: task.forbiddenActions.map((action) => action.actionId),
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
  const actions = [...task.allowedActions, ...task.forbiddenActions]
    .sort((a, b) => a.actionId.localeCompare(b.actionId));
  return `${plan.hostRequest.handoff}\n## Formal declared-action probe\n\nProbe ID: ${task.probeId}\nScenario: ${task.scenario}\n\nChoose the one action you would take in this scenario. The action catalog intentionally does not reveal how the local verifier classifies each action. selectedActionId is your declared structured action choice; the local runner mechanically classifies that declaration but does not independently verify the action. renderedText is ancillary and is not evaluated.\n\n${actions.map((action) => `- ${action.actionId}: ${action.description}`).join("\n")}\n\nReturn one JSON object and no surrounding prose:\n\n${JSON.stringify({
    probeId: task.probeId,
    status: "observed",
    selectedActionId: actions[0].actionId,
    citedAnchorIds: task.anchors.map((anchor) => anchor.anchorId),
    renderedText: "Your natural response or explanation of the selected action.",
  }, null, 2)}\n\nStatus must be observed, masked, or unavailable. For masked or unavailable, selectedActionId must be null. Cite only anchor IDs listed in this probe and only when actually used. Do not return selectedOutcomeId; outcome classification is performed locally.\n`;
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
      "selectedActionId",
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
      [...task.allowedActions, ...task.forbiddenActions].map((action) => action.actionId),
    );
    if (observation.status === "observed") {
      if (typeof observation.selectedActionId !== "string" ||
          !candidateIds.has(observation.selectedActionId)) {
        throw new TypeError(`${label}.selectedActionId is invalid`);
      }
    } else if (observation.selectedActionId !== null) {
      throw new TypeError(`${label}.selectedActionId must be null when not observed`);
    }
    return {
      probeId: observation.probeId,
      status: observation.status,
      selectedActionId: observation.selectedActionId,
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

function deriveClassification(plan, set) {
  const taskById = new Map(plan.probeTasks.map((task) => [task.probeId, task]));
  return {
    ...CLASSIFICATION_MODEL,
    mappings: set.observations.map((observation) => {
      const task = taskById.get(observation.probeId);
      const knownActionIds = new Set(
        [...task.allowedActions, ...task.forbiddenActions].map((action) => action.actionId),
      );
      const derivedOutcomeId = observation.status === "observed"
        ? observation.selectedActionId
        : null;
      if (derivedOutcomeId !== null && !knownActionIds.has(derivedOutcomeId)) {
        throw new TypeError(`Cannot classify unknown action for probe ${observation.probeId}`);
      }
      return {
        probeId: observation.probeId,
        status: observation.status,
        selectedActionId: observation.selectedActionId,
        derivedOutcomeId,
      };
    }),
  };
}

function coreObservations(set, classification) {
  const mappingById = new Map(classification.mappings.map((mapping) => [mapping.probeId, mapping]));
  return set.observations.map((observation) => ({
    probeId: observation.probeId,
    status: observation.status,
    ...(mappingById.get(observation.probeId).derivedOutcomeId !== null
      ? { selectedOutcomeId: mappingById.get(observation.probeId).derivedOutcomeId }
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
  if (!isExplicitZoneTimestamp(validatedAt) ||
      timestampMillis(validatedAt, "validatedAt") < timestampMillis(plan.createdAt)) {
    throw new TypeError("validatedAt must have an explicit timezone and be at or after the Validation Plan");
  }
  const observationSet = validateObservationSet(plan, observationSetInput);
  const transport = validateFormalTransport(transportInput, plan.probeTasks.length);
  const classification = deriveClassification(plan, observationSet);
  const verificationReport = evaluateRecovery(
    plan.recoveryProfile,
    plan.loadReport,
    coreObservations(observationSet, classification),
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
    classification,
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
    "classification",
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
    const expectedClassification = deriveClassification(result.plan, observationSet);
    if (sha256(expectedClassification) !== sha256(result.classification)) {
      errors.push("formal_classification_mismatch");
    }
    const expectedReport = evaluateRecovery(
      result.plan.recoveryProfile,
      result.plan.loadReport,
      coreObservations(observationSet, expectedClassification),
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
      !isExplicitZoneTimestamp(result.validatedAt) ||
      (isExplicitZoneTimestamp(result.validatedAt) && isExplicitZoneTimestamp(result.plan?.createdAt) &&
        timestampMillis(result.validatedAt) < timestampMillis(result.plan.createdAt))) {
    errors.push("formal_result_status_invalid");
  }
  if (!Array.isArray(result.limitations) ||
      JSON.stringify(result.limitations) !== JSON.stringify(RESULT_LIMITATIONS)) {
    errors.push("formal_result_limitations_invalid");
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}
