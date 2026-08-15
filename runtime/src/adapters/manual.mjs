import {
  HOST_OBSERVATION_VERSION,
  createHostReceipt,
} from "../host-contract.mjs";

export const MANUAL_RESULT_VERSION = "0.4-manual-result-alpha.3";

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}

export async function importManualHostResult(request, result) {
  const fields = new Set([
    "manualResultVersion",
    "observedAt",
    "provider",
    "model",
    "responseId",
    "requestId",
    "observation",
  ]);
  if (!exactKeys(result, fields)) throw new TypeError("Manual result structure is invalid");
  if (result.manualResultVersion !== MANUAL_RESULT_VERSION) {
    throw new TypeError("Manual result version is invalid");
  }
  if (typeof result.provider !== "string" || result.provider.trim() === "" ||
      typeof result.model !== "string" || result.model.trim() === "" ||
      result.observation?.observationVersion !== HOST_OBSERVATION_VERSION) {
    throw new TypeError("Manual result metadata is invalid");
  }
  return createManualHostReceipt(request, result.observation, {
    provider: result.provider,
    model: result.model,
    responseId: result.responseId,
    requestId: result.requestId,
  }, result.observedAt);
}

export async function createManualHostReceipt(request, observation, options, observedAt = new Date().toISOString()) {
  if (typeof options?.provider !== "string" || options.provider.trim() === "" ||
      typeof options?.model !== "string" || options.model.trim() === "") {
    throw new TypeError("Manual adapter requires provider and model");
  }
  return createHostReceipt(request, {
    adapter: "manual",
    provider: options.provider,
    model: options.model,
    endpoint: null,
    responseId: options.responseId ?? null,
    requestId: options.requestId ?? null,
    runnerNetworkUsed: false,
    storageRequested: "unknown",
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  }, observation, observedAt);
}
