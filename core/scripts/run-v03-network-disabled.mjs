import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(process.env.CONTINUITY_PROJECT_ROOT ?? process.cwd());
const guard = join(projectRoot, "scripts/network-disabled-guard.mjs");
const suiteFiles = [
  join(projectRoot, "dist/tests/recovery-v03-slice1.test.js"),
  join(projectRoot, "dist/tests/recovery-v03-final-verifier.test.js"),
];

const sourceFiles = [
  join(projectRoot, "tests/recovery-v03-slice1.test.ts"),
  join(projectRoot, "tests/recovery-v03-final-verifier.test.ts"),
];
const syntheticStructuredObservationsOnly = sourceFiles.every((path) => {
  const source = readFileSync(path, "utf8");
  return source.includes("synthetic-agent") && source.includes("Observation");
});

const childEnvironment = { ...process.env };
delete childEnvironment.NODE_TEST_CONTEXT;
for (const key of [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "MISTRAL_API_KEY",
  "COHERE_API_KEY",
]) {
  delete childEnvironment[key];
}
childEnvironment.CONTINUITY_NETWORK_DISABLED = "1";
childEnvironment.CONTINUITY_LIVE_MODEL_DISABLED = "1";

const result = spawnSync(
  process.execPath,
  ["--import", guard, "--test", "--test-concurrency=1", ...suiteFiles],
  {
    cwd: projectRoot,
    encoding: "utf8",
    env: childEnvironment,
    timeout: 120_000,
  },
);

const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
const numberAfter = (label) => {
  const match = output.match(new RegExp(`(?:#|ℹ)\\s*${label}\\s+(\\d+)`, "u"));
  return match ? Number.parseInt(match[1], 10) : -1;
};
const guardActive = output.includes("CONTINUITY_NETWORK_GUARD_ACTIVE");
const guardResults = [...output.matchAll(/CONTINUITY_NETWORK_GUARD_RESULT\s+(\{[^\n]+\})/gu)]
  .map((match) => JSON.parse(match[1]));
const networkAttempts = guardResults.reduce((total, item) => total + item.attempts, 0);

const summary = {
  networkGuardActive: guardActive && guardResults.length > 0 && guardResults.every((item) => item.active),
  networkAttempts,
  // There is no model adapter in the core. Any remote model call would have to
  // cross a guarded network surface and therefore increments this audit count.
  modelCalls: networkAttempts,
  syntheticStructuredObservationsOnly,
  tests: numberAfter("tests"),
  passed: numberAfter("pass"),
  failed: numberAfter("fail"),
};

const accepted =
  result.status === 0 &&
  summary.networkGuardActive &&
  summary.networkAttempts === 0 &&
  summary.modelCalls === 0 &&
  summary.syntheticStructuredObservationsOnly &&
  summary.tests === 54 &&
  summary.passed === 54 &&
  summary.failed === 0;

if (!accepted) {
  process.stderr.write(`Network-disabled core-suite output:\n${output}\n`);
  process.exitCode = 1;
}
process.stdout.write(`${JSON.stringify(summary)}\n`);
