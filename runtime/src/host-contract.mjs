import { sha256 } from "./canonical.mjs";
import { verifyCoreCapsuleEnvelope } from "./core-bridge.mjs";
import { renderCoreCapsuleHandoff } from "./handoff.mjs";
import { isExplicitZoneTimestamp, timestampMillis } from "./timestamp.mjs";

export const HOST_REQUEST_VERSION = "0.4-host-request-alpha.3";
export const HOST_RECEIPT_VERSION = "0.4-host-receipt-alpha.3";
export const HOST_OBSERVATION_VERSION = "0.4-host-observation-alpha.3";

const HOST_TASK =
  "Use the reviewed continuity anchors as context. Report which anchor keys you can use, surface conflicts or unavailable context, and respond naturally without claiming that missing information was recovered.";
const HOST_LIMITATIONS = Object.freeze([
  "This receipt records an adapter response; it is not sealed identity verification.",
  "A successful transport does not prove authorship, consciousness, or subjective sameness.",
  "Missing, masked, stale, conflicting, or unavailable context must not be presented as recovered.",
]);

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.size &&
    Object.keys(value).every((key) => keys.has(key));
}

function validText(value, maximum = 100_000) {
  return typeof value === "string" && value.trim() !== "" && value.length <= maximum;
}

function validOptionalId(value) {
  return value === null || (typeof value === "string" && value.trim() !== "" && value.length <= 500);
}

function validStringList(value, maximum = 100) {
  return Array.isArray(value) && value.length <= maximum && value.every((item) => validText(item, 2_000));
}

function validNullableCount(value) {
  return value === null || (Number.isInteger(value) && value >= 0);
}

function observationErrors(observation, request) {
  const errors = [];
  const fields = new Set([
    "observationVersion",
    "status",
    "citedCoreKeys",
    "citedTextureKeys",
    "conflicts",
    "unavailableContext",
    "responseText",
  ]);
  if (!exactKeys(observation, fields)) return ["observation_structure_invalid"];
  if (observation.observationVersion !== HOST_OBSERVATION_VERSION) {
    errors.push("observation_version_invalid");
  }
  if (!new Set(["acknowledged", "conflict", "unavailable", "refused"]).has(observation.status)) {
    errors.push("observation_status_invalid");
  }
  if (!validStringList(observation.citedCoreKeys) ||
      !validStringList(observation.citedTextureKeys) ||
      !validStringList(observation.conflicts) ||
      !validStringList(observation.unavailableContext) ||
      !validText(observation.responseText)) {
    errors.push("observation_content_invalid");
    return errors;
  }
  const coreKeys = new Set(request.capsuleEnvelope.capsule.core.map((item) => item.key));
  const textureKeys = new Set(request.capsuleEnvelope.capsule.texture.map((item) => item.key));
  if (observation.citedCoreKeys.some((key) => !coreKeys.has(key))) {
    errors.push("observation_unknown_core_key");
  }
  if (observation.citedTextureKeys.some((key) => !textureKeys.has(key))) {
    errors.push("observation_unknown_texture_key");
  }
  if (new Set(observation.citedCoreKeys).size !== observation.citedCoreKeys.length ||
      new Set(observation.citedTextureKeys).size !== observation.citedTextureKeys.length) {
    errors.push("observation_duplicate_key");
  }
  return errors;
}

function transportErrors(transport) {
  const errors = [];
  const fields = new Set([
    "adapter",
    "provider",
    "model",
    "endpoint",
    "responseId",
    "requestId",
    "runnerNetworkUsed",
    "storageRequested",
    "usage",
  ]);
  if (!exactKeys(transport, fields)) return ["transport_structure_invalid"];
  if (!new Set(["manual", "openai-responses"]).has(transport.adapter)) {
    errors.push("transport_adapter_invalid");
  }
  if (!validText(transport.provider, 100) || !validText(transport.model, 200)) {
    errors.push("transport_identity_invalid");
  }
  if (!validOptionalId(transport.endpoint) || !validOptionalId(transport.responseId) ||
      !validOptionalId(transport.requestId)) {
    errors.push("transport_reference_invalid");
  }
  if (typeof transport.runnerNetworkUsed !== "boolean" ||
      !new Set(["false", "unknown"]).has(transport.storageRequested)) {
    errors.push("transport_policy_invalid");
  }
  const usageFields = new Set(["inputTokens", "outputTokens", "totalTokens"]);
  if (!exactKeys(transport.usage, usageFields) ||
      !validNullableCount(transport.usage.inputTokens) ||
      !validNullableCount(transport.usage.outputTokens) ||
      !validNullableCount(transport.usage.totalTokens)) {
    errors.push("transport_usage_invalid");
  }
  if (transport.adapter === "openai-responses" && (
    transport.provider !== "openai" ||
    transport.endpoint !== "https://api.openai.com/v1/responses" ||
    transport.runnerNetworkUsed !== true ||
    transport.storageRequested !== "false" ||
    !validText(transport.responseId, 500)
  )) {
    errors.push("openai_transport_invalid");
  }
  if (transport.adapter === "manual" && (
    transport.runnerNetworkUsed !== false || transport.storageRequested !== "unknown"
  )) {
    errors.push("manual_transport_invalid");
  }
  return errors;
}

export async function createHostRequest(envelope, createdAt = new Date().toISOString()) {
  timestampMillis(createdAt, "createdAt");
  timestampMillis(envelope?.generatedAt, "Continuity Capsule generatedAt");
  const verification = await verifyCoreCapsuleEnvelope(envelope);
  if (!verification.valid) {
    throw new Error(`Continuity Capsule is invalid: ${verification.errors.join(", ")}`);
  }
  if (timestampMillis(createdAt) < timestampMillis(envelope.generatedAt)) {
    throw new TypeError("Host Request cannot predate the Continuity Capsule");
  }
  const handoff = await renderCoreCapsuleHandoff(envelope);
  const body = {
    requestVersion: HOST_REQUEST_VERSION,
    createdAt,
    purpose: "continuity_handoff",
    adapterPolicy: {
      network: "explicit_opt_in",
      storage: "disabled_when_supported",
      receiptStatus: "observed_unverified",
    },
    hostVerificationStatus: "not_run",
    capsuleEnvelope: structuredClone(envelope),
    handoff,
    task: HOST_TASK,
  };
  return { ...body, requestHash: sha256(body) };
}

export async function verifyHostRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return { valid: false, errors: ["host_request_not_object"] };
  }
  const errors = [];
  const fields = new Set([
    "requestVersion",
    "createdAt",
    "purpose",
    "adapterPolicy",
    "hostVerificationStatus",
    "capsuleEnvelope",
    "handoff",
    "task",
    "requestHash",
  ]);
  if (!exactKeys(request, fields)) errors.push("host_request_structure_invalid");
  const { requestHash, ...body } = request;
  try {
    if (typeof requestHash !== "string" || sha256(body) !== requestHash) {
      errors.push("host_request_hash_mismatch");
    }
  } catch {
    errors.push("host_request_hash_mismatch");
  }
  if (request.requestVersion !== HOST_REQUEST_VERSION || request.purpose !== "continuity_handoff") {
    errors.push("host_request_version_invalid");
  }
  if (!isExplicitZoneTimestamp(request.createdAt) || request.hostVerificationStatus !== "not_run") {
    errors.push("host_request_status_invalid");
  }
  if (!isExplicitZoneTimestamp(request.capsuleEnvelope?.generatedAt)) {
    errors.push("host_request_capsule_time_invalid");
  }
  const policyFields = new Set(["network", "storage", "receiptStatus"]);
  if (!exactKeys(request.adapterPolicy, policyFields) ||
      request.adapterPolicy.network !== "explicit_opt_in" ||
      request.adapterPolicy.storage !== "disabled_when_supported" ||
      request.adapterPolicy.receiptStatus !== "observed_unverified") {
    errors.push("host_request_policy_invalid");
  }
  if (!validText(request.handoff, 500_000) || request.task !== HOST_TASK) {
    errors.push("host_request_prompt_invalid");
  }
  const envelopeVerification = await verifyCoreCapsuleEnvelope(request.capsuleEnvelope);
  errors.push(...envelopeVerification.errors.map((error) => `capsule:${error}`));
  if (isExplicitZoneTimestamp(request.createdAt) &&
      isExplicitZoneTimestamp(request.capsuleEnvelope?.generatedAt) &&
      timestampMillis(request.createdAt) < timestampMillis(request.capsuleEnvelope.generatedAt)) {
    errors.push("host_request_predates_capsule");
  }
  if (envelopeVerification.valid) {
    try {
      if (await renderCoreCapsuleHandoff(request.capsuleEnvelope) !== request.handoff) {
        errors.push("host_request_handoff_mismatch");
      }
    } catch {
      errors.push("host_request_handoff_mismatch");
    }
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export async function renderHostRequestPrompt(request) {
  const verification = await verifyHostRequest(request);
  if (!verification.valid) throw new Error(`Host Request is invalid: ${verification.errors.join(", ")}`);
  const coreKeys = request.capsuleEnvelope.capsule.core.map((item) => item.key);
  const textureKeys = request.capsuleEnvelope.capsule.texture.map((item) => item.key);
  return `${request.handoff}\n## Current host task\n\n${request.task}\n\n## Required observation format\n\nReturn one JSON object and no surrounding prose. Status must be one of: acknowledged, conflict, unavailable, refused.\n\n${JSON.stringify({
    observationVersion: HOST_OBSERVATION_VERSION,
    status: "acknowledged",
    citedCoreKeys: coreKeys,
    citedTextureKeys: textureKeys,
    conflicts: [],
    unavailableContext: [],
    responseText: "Your natural response.",
  }, null, 2)}\n\nUse only anchor keys present above. Remove keys you did not actually cite.\n`;
}

export async function createHostReceipt(request, transport, observation, observedAt = new Date().toISOString()) {
  const requestVerification = await verifyHostRequest(request);
  if (!requestVerification.valid) {
    throw new Error(`Host Request is invalid: ${requestVerification.errors.join(", ")}`);
  }
  if (!isExplicitZoneTimestamp(observedAt) ||
      timestampMillis(observedAt, "observedAt") < timestampMillis(request.createdAt)) {
    throw new TypeError("observedAt must have an explicit timezone and be at or after the Host Request");
  }
  const errors = [...transportErrors(transport), ...observationErrors(observation, request)];
  if (errors.length > 0) throw new Error(`Host result is invalid: ${errors.join(", ")}`);
  const body = {
    receiptVersion: HOST_RECEIPT_VERSION,
    observedAt,
    request: structuredClone(request),
    transport: structuredClone(transport),
    observation: structuredClone(observation),
    hostVerificationStatus: "observed_unverified",
    limitations: [...HOST_LIMITATIONS],
  };
  return { ...body, receiptHash: sha256(body) };
}

export async function verifyHostReceipt(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return { valid: false, errors: ["host_receipt_not_object"] };
  }
  const errors = [];
  const fields = new Set([
    "receiptVersion",
    "observedAt",
    "request",
    "transport",
    "observation",
    "hostVerificationStatus",
    "limitations",
    "receiptHash",
  ]);
  if (!exactKeys(receipt, fields)) errors.push("host_receipt_structure_invalid");
  const { receiptHash, ...body } = receipt;
  try {
    if (typeof receiptHash !== "string" || sha256(body) !== receiptHash) {
      errors.push("host_receipt_hash_mismatch");
    }
  } catch {
    errors.push("host_receipt_hash_mismatch");
  }
  if (receipt.receiptVersion !== HOST_RECEIPT_VERSION ||
      receipt.hostVerificationStatus !== "observed_unverified") {
    errors.push("host_receipt_status_invalid");
  }
  if (!isExplicitZoneTimestamp(receipt.observedAt)) errors.push("host_receipt_time_invalid");
  const requestVerification = await verifyHostRequest(receipt.request);
  errors.push(...requestVerification.errors.map((error) => `request:${error}`));
  if (isExplicitZoneTimestamp(receipt.observedAt) &&
      isExplicitZoneTimestamp(receipt.request?.createdAt) &&
      timestampMillis(receipt.observedAt) < timestampMillis(receipt.request.createdAt)) {
    errors.push("host_receipt_predates_request");
  }
  errors.push(...transportErrors(receipt.transport));
  if (requestVerification.valid) errors.push(...observationErrors(receipt.observation, receipt.request));
  if (!Array.isArray(receipt.limitations) ||
      JSON.stringify(receipt.limitations) !== JSON.stringify(HOST_LIMITATIONS)) {
    errors.push("host_receipt_limitations_invalid");
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}
