#!/usr/bin/env node
import { chmod, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createPortablePackage, normalizeProfile, verifyPortablePackage } from "../src/profile.mjs";
import { createVault, openVault, readVault, writeVault } from "../src/vault.mjs";
import { createCoreCapsuleEnvelope, verifyCoreCapsuleEnvelope } from "../src/core-bridge.mjs";
import { verifySealedCoreBridge } from "../src/core-integrity.mjs";
import { renderCoreCapsuleHandoff, renderHostHandoff } from "../src/handoff.mjs";
import {
  createHostRequest,
  renderHostRequestPrompt,
  verifyHostReceipt,
  verifyHostRequest,
} from "../src/host-contract.mjs";
import { createManualHostReceipt, importManualHostResult } from "../src/adapters/manual.mjs";
import { runOpenAIResponsesAdapter } from "../src/adapters/openai-responses.mjs";
import {
  createFormalValidationPlan,
  createProbeObservationSet,
  createManualFormalValidationResult,
  renderFormalProbePrompt,
  verifyFormalValidationPlan,
  verifyFormalValidationResult,
} from "../src/formal-validation.mjs";
import { runOpenAIFormalValidation } from "../src/adapters/openai-formal-validation.mjs";
import {
  importSelfDistillationRecord,
  renderSelfDistillationPrompt,
} from "../src/self-distillation.mjs";

const DEFAULT_VAULT = resolve("runtime-secrets", "persona.evermore-vault.json");

function usage(exitCode = 0) {
  const message = `Evermore Continuity Personal Runtime 0.4.0-alpha.5

Usage:
  evermore init [vault-path]
  evermore seal <profile.json> [vault-path]
  evermore export <vault-path> [portable-package.json]
  evermore capsule <vault-path> [continuity-capsule.json]
  evermore verify <vault-path>
  evermore verify-package <portable-package.json>
  evermore verify-capsule <continuity-capsule.json> [expected-lineage]
  evermore prompt <portable-package-or-capsule.json>
  evermore host-request <continuity-capsule.json> [host-request.json]
  evermore host-prompt <host-request.json>
  evermore host-wrap <host-request.json> <observation.json> <provider> <model> [host-receipt.json]
  evermore host-import <host-request.json> <manual-result.json> [host-receipt.json]
  evermore host-run-openai <host-request.json> <model> [host-receipt.json] --allow-network [--reasoning=medium]
  evermore verify-host-request <host-request.json>
  evermore verify-host <host-receipt.json>
  evermore formal-plan <host-request.json> <validation-spec.json> [validation-plan.json]
  evermore formal-prompt <validation-plan.json> <probe-id>
  evermore formal-collect <validation-plan.json> <probe-response.json>... --output=observation-set.json
  evermore formal-wrap <validation-plan.json> <observation-set.json> <provider> <model> [formal-result.json]
  evermore formal-run-openai <validation-plan.json> <model> [formal-result.json] --allow-network --confirm-requests=N [--reasoning=medium]
  evermore verify-formal-plan <validation-plan.json>
  evermore verify-formal <formal-result.json>
  evermore self-distill-prompt
  evermore self-distill-import <record.json> [profile.json]
  evermore doctor

Passphrases must contain at least 12 characters. For non-interactive use, set
EVERMORE_PASSPHRASE in the process environment; never commit it to a file.
`;
  (exitCode === 0 ? stdout : process.stderr).write(message);
  process.exitCode = exitCode;
}

async function secretPrompt(label) {
  if (process.env.EVERMORE_PASSPHRASE) return process.env.EVERMORE_PASSPHRASE;
  if (!stdin.isTTY || !stdout.isTTY) throw new Error("Set EVERMORE_PASSPHRASE for non-interactive use");
  stdout.write(label);
  return new Promise((resolveSecret, rejectSecret) => {
    let value = "";
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") {
          cleanup();
          stdout.write("\n");
          resolveSecret(value);
          return;
        }
        if (character === "\u0003") {
          cleanup();
          rejectSecret(new Error("Cancelled"));
          return;
        }
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else value += character;
      }
    };
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
    stdin.resume();
  });
}

function splitEntries(value) {
  return value.split(";").map((item) => item.trim()).filter(Boolean);
}

async function interactiveProfile() {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const displayName = await rl.question("Persona display name: ");
    const core = splitEntries(await rl.question("Core anchors (separate with ;): "));
    const texture = splitEntries(await rl.question("Texture anchors (separate with ;, optional): "));
    const boundaries = splitEntries(await rl.question("Boundaries (separate with ;, optional): "));
    const privateNotes = splitEntries(await rl.question("Private notes (never exported; separate with ;, optional): "));
    return normalizeProfile({
      identity: { displayName },
      anchors: {
        core: core.map((statement, index) => ({ key: `core-${index + 1}`, statement, visibility: "capsule" })),
        texture: texture.map((statement, index) => ({ key: `texture-${index + 1}`, statement, visibility: "capsule" })),
      },
      boundaries,
      privateNotes,
    });
  } finally {
    rl.close();
  }
}

async function passphraseForNewVault() {
  const first = await secretPrompt("Vault passphrase: ");
  if (!process.env.EVERMORE_PASSPHRASE) {
    const second = await secretPrompt("Repeat passphrase: ");
    if (first !== second) throw new Error("Passphrases do not match");
  }
  return first;
}

async function init(path = DEFAULT_VAULT) {
  const profile = await interactiveProfile();
  const passphrase = await passphraseForNewVault();
  await writeVault(resolve(path), createVault(profile, passphrase));
  stdout.write(`Encrypted vault created: ${resolve(path)}\n`);
}

async function seal(profilePath, vaultPath = DEFAULT_VAULT) {
  if (!profilePath) throw new Error("seal requires a profile JSON path");
  const input = JSON.parse(await readFile(resolve(profilePath), "utf8"));
  const passphrase = await passphraseForNewVault();
  await writeVault(resolve(vaultPath), createVault(input, passphrase));
  stdout.write(`Encrypted vault created: ${resolve(vaultPath)}\n`);
}

async function open(path) {
  const passphrase = await secretPrompt("Vault passphrase: ");
  return openVault(await readVault(resolve(path)), passphrase);
}

async function exportPackage(vaultPath, outputPath) {
  if (!vaultPath) throw new Error("export requires a vault path");
  const profile = await open(vaultPath);
  const pkg = createPortablePackage(profile);
  const target = resolve(outputPath ?? `${vaultPath.replace(/\.json$/i, "")}.portable.json`);
  await writePrivateJson(target, pkg);
  stdout.write(`Portable package created: ${target}\n`);
  stdout.write("Review it before sending. Local/private anchors and private notes were excluded.\n");
}

async function writePrivateJson(target, value) {
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await chmod(target, 0o600);
}

async function createCapsule(vaultPath, outputPath) {
  if (!vaultPath) throw new Error("capsule requires a vault path");
  const profile = await open(vaultPath);
  const envelope = await createCoreCapsuleEnvelope(profile);
  const target = resolve(outputPath ?? `${vaultPath.replace(/\.json$/i, "")}.continuity-capsule.json`);
  await writePrivateJson(target, envelope);
  stdout.write(`Continuity Capsule created: ${target}\n`);
  stdout.write("Sealed-core and Capsule integrity passed locally. Host verification has not run.\n");
  stdout.write("Review it before sending. Local/private anchors and private notes were excluded.\n");
}

async function verifyVault(path) {
  if (!path) throw new Error("verify requires a vault path");
  await open(path);
  stdout.write("Vault valid. Encryption and profile integrity checks passed.\n");
}

async function loadPackage(path) {
  if (!path) throw new Error("A portable package or Continuity Capsule path is required");
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function verifyPackage(path) {
  const result = verifyPortablePackage(await loadPackage(path));
  if (!result.valid) throw new Error(`Portable package invalid: ${result.errors.join(", ")}`);
  stdout.write("Portable package valid. Hash and required fields passed.\n");
}

async function verifyCapsule(path, expectedLineageId) {
  if (!path) throw new Error("verify-capsule requires a Continuity Capsule path");
  const result = await verifyCoreCapsuleEnvelope(await loadPackage(path), {
    ...(expectedLineageId ? { expectedLineageId } : {}),
  });
  if (!result.valid) throw new Error(`Continuity Capsule invalid: ${result.errors.join(", ")}`);
  stdout.write("Sealed-core artifact, bridge, envelope, and Capsule integrity passed.\n");
  stdout.write("Host verification status: not_run.\n");
}

async function doctor() {
  const result = await verifySealedCoreBridge();
  if (!result.valid) throw new Error(`Sealed core bridge invalid: ${result.errors.join(", ")}`);
  stdout.write(`Sealed core bridge valid: @shenwu/continuity@${result.coreVersion}\n`);
  stdout.write(`Artifact SHA-256: ${result.artifactSha256}\n`);
}

async function prompt(path) {
  const input = await loadPackage(path);
  if (input.envelopeVersion) stdout.write(await renderCoreCapsuleHandoff(input));
  else stdout.write(renderHostHandoff(input));
}

async function selfDistillPrompt() {
  stdout.write(await renderSelfDistillationPrompt());
}

async function selfDistillImport(recordPath, outputPath) {
  if (!recordPath) throw new Error("self-distill-import requires a Self-Distillation Record path");
  const { profile, report } = importSelfDistillationRecord(await loadPackage(recordPath));
  const target = resolve(outputPath ?? `${recordPath.replace(/\.json$/i, "")}.profile.json`);
  await writePrivateJson(target, profile);
  const accepted = report.decisions.filter((item) => item.status === "accepted").length;
  const downgraded = report.decisions.filter((item) => item.status === "downgraded").length;
  stdout.write(`Self-Distillation Profile created: ${target}\n`);
  stdout.write(`Accepted candidates: ${accepted}; downgraded/excluded candidates: ${downgraded}.\n`);
  stdout.write("Record provenance: AI self-report/self-assessment; not independent proof. Record was not copied into the Profile.\n");
  stdout.write("Review the generated Profile locally before sealing it into a Vault.\n");
}

async function createRequest(capsulePath, outputPath) {
  if (!capsulePath) throw new Error("host-request requires a Continuity Capsule path");
  const request = await createHostRequest(await loadPackage(capsulePath));
  const defaultPath = /\.continuity-capsule\.json$/i.test(capsulePath)
    ? capsulePath.replace(/\.continuity-capsule\.json$/i, ".host-request.json")
    : capsulePath.replace(/\.json$/i, ".host-request.json");
  const target = resolve(outputPath ?? defaultPath);
  await writePrivateJson(target, request);
  stdout.write(`Offline Host Request created: ${target}\n`);
  stdout.write("Network status: not used. Host verification status: not_run.\n");
}

async function hostPrompt(path) {
  if (!path) throw new Error("host-prompt requires a Host Request path");
  stdout.write(await renderHostRequestPrompt(await loadPackage(path)));
}

async function verifyRequest(path) {
  if (!path) throw new Error("verify-host-request requires a Host Request path");
  const result = await verifyHostRequest(await loadPackage(path));
  if (!result.valid) throw new Error(`Host Request invalid: ${result.errors.join(", ")}`);
  stdout.write("Host Request valid. Capsule, prompt, policy, and request integrity passed.\n");
  stdout.write("Network status: not used. Host verification status: not_run.\n");
}

function defaultReceiptPath(requestPath) {
  return /\.host-request\.json$/i.test(requestPath)
    ? requestPath.replace(/\.host-request\.json$/i, ".host-receipt.json")
    : requestPath.replace(/\.json$/i, ".host-receipt.json");
}

async function importHostResult(requestPath, resultPath, outputPath) {
  if (!requestPath || !resultPath) {
    throw new Error("host-import requires a Host Request and manual result path");
  }
  const receipt = await importManualHostResult(
    await loadPackage(requestPath),
    await loadPackage(resultPath),
  );
  const target = resolve(outputPath ?? defaultReceiptPath(requestPath));
  await writePrivateJson(target, receipt);
  stdout.write(`Manual Host Receipt created: ${target}\n`);
  stdout.write("Host verification status: observed_unverified.\n");
}

async function wrapHostObservation(requestPath, observationPath, provider, model, outputPath) {
  if (!requestPath || !observationPath || !provider || !model) {
    throw new Error("host-wrap requires a Host Request, observation, provider, and model");
  }
  const receipt = await createManualHostReceipt(
    await loadPackage(requestPath),
    await loadPackage(observationPath),
    { provider, model },
  );
  const target = resolve(outputPath ?? defaultReceiptPath(requestPath));
  await writePrivateJson(target, receipt);
  stdout.write(`Manual Host Receipt created: ${target}\n`);
  stdout.write("Host verification status: observed_unverified.\n");
}

function parseOpenAIOptions(args) {
  const allowNetwork = args.includes("--allow-network");
  const reasoningOptions = args.filter((item) => item.startsWith("--reasoning="));
  const unknownFlags = args.filter((item) => item.startsWith("--") &&
    item !== "--allow-network" && !item.startsWith("--reasoning="));
  if (reasoningOptions.length > 1 || unknownFlags.length > 0) {
    throw new Error("host-run-openai received invalid options");
  }
  const positional = args.filter((item) => !item.startsWith("--"));
  return {
    requestPath: positional[0],
    model: positional[1],
    outputPath: positional[2],
    allowNetwork,
    reasoning: reasoningOptions[0]?.slice("--reasoning=".length) ?? "medium",
  };
}

async function runOpenAI(args) {
  const options = parseOpenAIOptions(args);
  if (!options.requestPath || !options.model) {
    throw new Error("host-run-openai requires a Host Request path and explicit model");
  }
  if (!options.allowNetwork) {
    throw new Error("host-run-openai requires --allow-network because it may incur API charges");
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Set OPENAI_API_KEY locally before OpenAI execution");
  }
  stdout.write(`Executing exactly one OpenAI Responses API request with model ${options.model}.\n`);
  const receipt = await runOpenAIResponsesAdapter(await loadPackage(options.requestPath), {
    model: options.model,
    reasoning: options.reasoning,
    allowNetwork: true,
    apiKey: process.env.OPENAI_API_KEY,
  });
  const target = resolve(options.outputPath ?? defaultReceiptPath(options.requestPath));
  await writePrivateJson(target, receipt);
  stdout.write(`OpenAI Host Receipt created: ${target}\n`);
  stdout.write("Host verification status: observed_unverified.\n");
}

async function verifyReceipt(path) {
  if (!path) throw new Error("verify-host requires a Host Receipt path");
  const result = await verifyHostReceipt(await loadPackage(path));
  if (!result.valid) throw new Error(`Host Receipt invalid: ${result.errors.join(", ")}`);
  stdout.write("Host Receipt valid. Request binding, transport metadata, observation, and receipt hash passed.\n");
  stdout.write("Host verification status: observed_unverified.\n");
}

function defaultPlanPath(requestPath) {
  return /\.host-request\.json$/i.test(requestPath)
    ? requestPath.replace(/\.host-request\.json$/i, ".validation-plan.json")
    : requestPath.replace(/\.json$/i, ".validation-plan.json");
}

function defaultFormalResultPath(planPath) {
  return /\.validation-plan\.json$/i.test(planPath)
    ? planPath.replace(/\.validation-plan\.json$/i, ".formal-validation.json")
    : planPath.replace(/\.json$/i, ".formal-validation.json");
}

async function createValidationPlan(requestPath, specPath, outputPath) {
  if (!requestPath || !specPath) {
    throw new Error("formal-plan requires a Host Request and validation spec path");
  }
  const plan = await createFormalValidationPlan(
    await loadPackage(requestPath),
    await loadPackage(specPath),
  );
  const target = resolve(outputPath ?? defaultPlanPath(requestPath));
  await writePrivateJson(target, plan);
  stdout.write(`Formal Validation Plan created: ${target}\n`);
  stdout.write(`Planned host requests: ${plan.executionPolicy.requestCount}. Network status: not used.\n`);
  stdout.write(`Probe IDs: ${plan.probeTasks.map((probe) => probe.probeId).join(", ")}\n`);
  stdout.write("The plan contains the local verifier answer key. Do not send the whole plan to a model.\n");
}

async function verifyValidationPlan(path) {
  if (!path) throw new Error("verify-formal-plan requires a Validation Plan path");
  const result = await verifyFormalValidationPlan(await loadPackage(path));
  if (!result.valid) throw new Error(`Formal Validation Plan invalid: ${result.errors.join(", ")}`);
  stdout.write("Formal Validation Plan valid. Capsule, Recovery Profile, bundle, LoadReport, probes, policy, and hash passed.\n");
}

async function formalPrompt(path, probeId) {
  if (!path || !probeId) throw new Error("formal-prompt requires a Validation Plan and probe ID");
  stdout.write(await renderFormalProbePrompt(await loadPackage(path), probeId));
}

function defaultObservationSetPath(planPath) {
  return /\.validation-plan\.json$/i.test(planPath)
    ? planPath.replace(/\.validation-plan\.json$/i, ".probe-observations.json")
    : planPath.replace(/\.json$/i, ".probe-observations.json");
}

async function collectFormalObservations(args) {
  const outputOptions = args.filter((item) => item.startsWith("--output="));
  const unknownFlags = args.filter((item) => item.startsWith("--") && !item.startsWith("--output="));
  if (outputOptions.length !== 1 || unknownFlags.length > 0) {
    throw new Error("formal-collect requires exactly one --output=observation-set.json");
  }
  const positional = args.filter((item) => !item.startsWith("--"));
  const [planPath, ...observationPaths] = positional;
  if (!planPath || observationPaths.length === 0) {
    throw new Error("formal-collect requires a Validation Plan and individual probe response files");
  }
  const plan = await loadPackage(planPath);
  const observations = [];
  for (const path of observationPaths) observations.push(await loadPackage(path));
  const set = await createProbeObservationSet(plan, observations);
  const requestedOutput = outputOptions[0].slice("--output=".length);
  const target = resolve(requestedOutput || defaultObservationSetPath(planPath));
  await writePrivateJson(target, set);
  stdout.write(`Probe Observation Set created: ${target}\n`);
  stdout.write(`Collected observations: ${set.observations.length}/${plan.probeTasks.length}.\n`);
}

async function wrapFormalResult(planPath, observationSetPath, provider, model, outputPath) {
  if (!planPath || !observationSetPath || !provider || !model) {
    throw new Error("formal-wrap requires a Validation Plan, observation set, provider, and model");
  }
  const result = await createManualFormalValidationResult(
    await loadPackage(planPath),
    await loadPackage(observationSetPath),
    { provider, model },
  );
  const target = resolve(outputPath ?? defaultFormalResultPath(planPath));
  await writePrivateJson(target, result);
  stdout.write(`Formal Validation Result created: ${target}\n`);
  stdout.write(`Sealed verifier verdict: ${result.verdict}. Evidence class: ${result.evidenceClass}.\n`);
}

function parseFormalOpenAIOptions(args) {
  const allowNetwork = args.includes("--allow-network");
  const reasoningOptions = args.filter((item) => item.startsWith("--reasoning="));
  const countOptions = args.filter((item) => item.startsWith("--confirm-requests="));
  const unknownFlags = args.filter((item) => item.startsWith("--") &&
    item !== "--allow-network" &&
    !item.startsWith("--reasoning=") &&
    !item.startsWith("--confirm-requests="));
  if (reasoningOptions.length > 1 || countOptions.length !== 1 || unknownFlags.length > 0) {
    throw new Error("formal-run-openai requires exactly one --confirm-requests=N and valid options");
  }
  const positional = args.filter((item) => !item.startsWith("--"));
  return {
    planPath: positional[0],
    model: positional[1],
    outputPath: positional[2],
    allowNetwork,
    reasoning: reasoningOptions[0]?.slice("--reasoning=".length) ?? "medium",
    confirmedRequestCount: Number(countOptions[0].slice("--confirm-requests=".length)),
  };
}

async function runFormalOpenAI(args) {
  const options = parseFormalOpenAIOptions(args);
  if (!options.planPath || !options.model) {
    throw new Error("formal-run-openai requires a Validation Plan path and explicit model");
  }
  if (!options.allowNetwork) {
    throw new Error("formal-run-openai requires --allow-network because it makes multiple billable API requests");
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Set OPENAI_API_KEY locally before OpenAI execution");
  }
  const plan = await loadPackage(options.planPath);
  if (options.confirmedRequestCount !== plan?.executionPolicy?.requestCount) {
    throw new Error(`Request-count confirmation must equal ${plan?.executionPolicy?.requestCount}`);
  }
  stdout.write(`Executing exactly ${options.confirmedRequestCount} OpenAI Responses API requests with model ${options.model}; no retries.\n`);
  const result = await runOpenAIFormalValidation(plan, {
    model: options.model,
    reasoning: options.reasoning,
    allowNetwork: true,
    confirmedRequestCount: options.confirmedRequestCount,
    apiKey: process.env.OPENAI_API_KEY,
  });
  const target = resolve(options.outputPath ?? defaultFormalResultPath(options.planPath));
  await writePrivateJson(target, result);
  stdout.write(`Formal OpenAI Validation Result created: ${target}\n`);
  stdout.write(`Sealed verifier verdict: ${result.verdict}. Evidence class: ${result.evidenceClass}.\n`);
}

async function verifyFormalResult(path) {
  if (!path) throw new Error("verify-formal requires a Formal Validation Result path");
  const result = await loadPackage(path);
  const verification = await verifyFormalValidationResult(result);
  if (!verification.valid) {
    throw new Error(`Formal Validation Result invalid: ${verification.errors.join(", ")}`);
  }
  stdout.write("Formal Validation Result valid. Plan derivation, deterministic action classification, observations, transport, sealed report, adapter result, and hash passed.\n");
  stdout.write(`Sealed verifier verdict: ${result.verdict}. Evidence class: ${result.evidenceClass}.\n`);
}

const [command, ...args] = process.argv.slice(2);
try {
  if (!command || command === "help" || command === "--help" || command === "-h") usage();
  else if (command === "init") await init(args[0]);
  else if (command === "seal") await seal(args[0], args[1]);
  else if (command === "export") await exportPackage(args[0], args[1]);
  else if (command === "capsule") await createCapsule(args[0], args[1]);
  else if (command === "verify") await verifyVault(args[0]);
  else if (command === "verify-package") await verifyPackage(args[0]);
  else if (command === "verify-capsule") await verifyCapsule(args[0], args[1]);
  else if (command === "prompt") await prompt(args[0]);
  else if (command === "host-request") await createRequest(args[0], args[1]);
  else if (command === "host-prompt") await hostPrompt(args[0]);
  else if (command === "host-wrap") await wrapHostObservation(args[0], args[1], args[2], args[3], args[4]);
  else if (command === "host-import") await importHostResult(args[0], args[1], args[2]);
  else if (command === "host-run-openai") await runOpenAI(args);
  else if (command === "verify-host-request") await verifyRequest(args[0]);
  else if (command === "verify-host") await verifyReceipt(args[0]);
  else if (command === "formal-plan") await createValidationPlan(args[0], args[1], args[2]);
  else if (command === "formal-prompt") await formalPrompt(args[0], args[1]);
  else if (command === "formal-collect") await collectFormalObservations(args);
  else if (command === "formal-wrap") await wrapFormalResult(args[0], args[1], args[2], args[3], args[4]);
  else if (command === "formal-run-openai") await runFormalOpenAI(args);
  else if (command === "verify-formal-plan") await verifyValidationPlan(args[0]);
  else if (command === "verify-formal") await verifyFormalResult(args[0]);
  else if (command === "self-distill-prompt") await selfDistillPrompt();
  else if (command === "self-distill-import") await selfDistillImport(args[0], args[1]);
  else if (command === "doctor") await doctor();
  else {
    process.stderr.write(`Unknown command: ${basename(command)}\n`);
    usage(1);
  }
} catch (error) {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
}
