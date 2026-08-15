import {
  HOST_OBSERVATION_VERSION,
  createHostReceipt,
  renderHostRequestPrompt,
  verifyHostRequest,
} from "../host-contract.mjs";

export const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const VALID_REASONING = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

export const HOST_OBSERVATION_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "observationVersion",
    "status",
    "citedCoreKeys",
    "citedTextureKeys",
    "conflicts",
    "unavailableContext",
    "responseText",
  ],
  properties: {
    observationVersion: { type: "string", const: HOST_OBSERVATION_VERSION },
    status: { type: "string", enum: ["acknowledged", "conflict", "unavailable", "refused"] },
    citedCoreKeys: { type: "array", items: { type: "string" }, maxItems: 100 },
    citedTextureKeys: { type: "array", items: { type: "string" }, maxItems: 100 },
    conflicts: { type: "array", items: { type: "string" }, maxItems: 100 },
    unavailableContext: { type: "array", items: { type: "string" }, maxItems: 100 },
    responseText: { type: "string", minLength: 1, maxLength: 100000 },
  },
});

function requiredText(value, label, maximum = 500) {
  if (typeof value !== "string" || value.trim() === "" || value.length > maximum) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function extractOutputText(payload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim() !== "") {
    return payload.output_text;
  }
  const texts = [];
  for (const item of payload.output ?? []) {
    if (item?.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") texts.push(content.text);
    }
  }
  return texts.join("\n").trim();
}

function usageFrom(payload) {
  const numberOrNull = (value) => Number.isInteger(value) && value >= 0 ? value : null;
  return {
    inputTokens: numberOrNull(payload.usage?.input_tokens),
    outputTokens: numberOrNull(payload.usage?.output_tokens),
    totalTokens: numberOrNull(payload.usage?.total_tokens),
  };
}

export async function buildOpenAIResponsesRequest(request, options) {
  const verification = await verifyHostRequest(request);
  if (!verification.valid) throw new Error(`Host Request is invalid: ${verification.errors.join(", ")}`);
  const model = requiredText(options?.model, "model", 200);
  if (!/^[A-Za-z0-9._:-]+$/.test(model)) throw new TypeError("model contains unsupported characters");
  const reasoning = options?.reasoning ?? "medium";
  if (!VALID_REASONING.has(reasoning)) throw new TypeError("reasoning effort is invalid");
  return {
    model,
    store: false,
    reasoning: { effort: reasoning },
    instructions:
      "Return only the required structured observation. Treat the continuity material as self-authored context, not proof. Never invent missing recovery or claim host verification.",
    input: await renderHostRequestPrompt(request),
    text: {
      format: {
        type: "json_schema",
        name: "evermore_host_observation",
        strict: true,
        schema: HOST_OBSERVATION_SCHEMA,
      },
    },
  };
}

export async function runOpenAIResponsesAdapter(request, options = {}) {
  if (options.allowNetwork !== true) {
    throw new Error("OpenAI network execution requires explicit allowNetwork=true");
  }
  const apiKey = requiredText(options.apiKey, "OPENAI_API_KEY", 10_000);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
  const requestBody = await buildOpenAIResponsesRequest(request, options);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
  let response;
  try {
    response = await fetchImpl(OPENAI_RESPONSES_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(error?.name === "AbortError" ? "OpenAI request timed out" : "OpenAI request failed");
  } finally {
    clearTimeout(timeout);
  }
  const requestId = response.headers?.get?.("x-request-id") ?? null;
  if (!response.ok) {
    throw new Error(`OpenAI request failed with HTTP ${response.status}${requestId ? ` (${requestId})` : ""}`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("OpenAI response was not valid JSON");
  }
  if (payload.status && payload.status !== "completed") {
    throw new Error(`OpenAI response did not complete: ${payload.status}`);
  }
  const outputText = extractOutputText(payload);
  if (!outputText) throw new Error("OpenAI response contained no output text");
  let observation;
  try {
    observation = JSON.parse(outputText);
  } catch {
    throw new Error("OpenAI structured observation was not valid JSON");
  }
  return createHostReceipt(request, {
    adapter: "openai-responses",
    provider: "openai",
    model: requestBody.model,
    endpoint: OPENAI_RESPONSES_ENDPOINT,
    responseId: requiredText(payload.id, "response id"),
    requestId,
    runnerNetworkUsed: true,
    storageRequested: "false",
    usage: usageFrom(payload),
  }, observation, options.observedAt ?? new Date().toISOString());
}
