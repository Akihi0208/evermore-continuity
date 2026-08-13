import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const artifactArgument = process.argv[2];
if (!artifactArgument) {
  process.stderr.write("Usage: node scripts/scan-packed-artifact.mjs <npm-pack.tgz>\n");
  process.exit(2);
}

const artifactPath = resolve(artifactArgument);
const artifactName = basename(artifactPath);
const tempRoot = mkdtempSync(join(tmpdir(), "continuity-v03-artifact-scan-"));
const extractRoot = join(tempRoot, "extract");
const findings = [];

const forbiddenSpecificTokens = [
  String.fromCodePoint(0x6c88, 0x96fe),
  String.fromCodePoint(0x60e0, 0x60e0),
  ["shen", "wu"].join(""),
  ["hui", "hui"].join(""),
];
const packageScope = ["@", "shen", "wu", "/continuity"].join("");
const modelPackageTokens = [
  ["open", "ai"].join(""),
  ["@anthropic-ai", "/sdk"].join(""),
  ["@google", "/generative-ai"].join(""),
  ["cohere", "-ai"].join(""),
];
const modelEndpointTokens = [
  ["api.", "open", "ai.com"].join(""),
  ["api.", "anthropic.com"].join(""),
];
const forbiddenExtensions = new Set([
  ".7z", ".db", ".eml", ".har", ".key", ".mbox", ".ndjson", ".pem",
  ".rar", ".sqlite", ".sqlite3", ".zip",
]);
const textExtensions = new Set([
  ".cjs", ".css", ".html", ".js", ".json", ".jsonl", ".jsx", ".md",
  ".mjs", ".mts", ".svg", ".ts", ".tsx", ".txt", ".yaml", ".yml",
]);
const structuredDataExtensions = new Set([".json", ".jsonl", ".ndjson", ".yaml", ".yml"]);

function walk(directory) {
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walk(path));
    else if (entry.isFile()) output.push(path);
    else findings.push(`unsupported archive entry type: ${relative(extractRoot, path)}`);
  }
  return output;
}

function redactAuditedNonDataMentions(path, source) {
  let redacted = source.split(packageScope).join("@continuity/package");
  if (path === "package/tests/continuity.test.ts") {
    for (const token of forbiddenSpecificTokens.slice(2)) {
      redacted = redacted.split(`serialized.includes("${token}")`).join("negative-name-check");
    }
  }
  return redacted;
}

function scanText(path, source) {
  const extension = extname(path).toLowerCase();
  const normalized = redactAuditedNonDataMentions(path, source);
  const lower = normalized.toLowerCase();

  for (const token of forbiddenSpecificTokens) {
    if (lower.includes(token.toLowerCase())) {
      findings.push(`${path}: persona-specific identifier found`);
    }
  }

  const transcriptTurns = normalized.match(/^(?:user|assistant|system)\s*:\s+.+$/gimu) ?? [];
  if (transcriptTurns.length >= 2) findings.push(`${path}: transcript-like turn sequence found`);

  if (structuredDataExtensions.has(extension)) {
    for (const signature of [
      /"conversation_id"\s*:/iu,
      /"mapping"\s*:\s*\{/iu,
      /"messages"\s*:\s*\[/iu,
      /"role"\s*:\s*"(?:user|assistant)"/iu,
    ]) {
      if (signature.test(normalized)) findings.push(`${path}: chat-export structure found`);
    }
  }

  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(normalized)) {
    findings.push(`${path}: private key material found`);
  }
  if (/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{20,}\b/u.test(normalized)) {
    findings.push(`${path}: credential-like token found`);
  }
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(normalized)) {
    findings.push(`${path}: email-like personal identifier found`);
  }

  if ([".cjs", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"].includes(extension)) {
    for (const token of modelPackageTokens) {
      const importPattern = new RegExp(
        `(?:from\\s*["']|import\\s*\\(\\s*["']|require\\s*\\(\\s*["'])${token.replace("/", "\\/")}(?:["'/])`,
        "iu",
      );
      if (importPattern.test(normalized)) findings.push(`${path}: live model SDK reference found`);
    }
  }
  for (const endpoint of modelEndpointTokens) {
    if (lower.includes(endpoint)) findings.push(`${path}: live model endpoint found`);
  }

  if ((path.includes("/examples/") || path.includes("/fixtures/")) && !/synthetic/iu.test(normalized)) {
    findings.push(`${path}: example or fixture lacks an explicit synthetic marker`);
  }
  if (path.includes("/tests/") && !/synthetic/iu.test(normalized)) {
    findings.push(`${path}: acceptance test lacks an explicit synthetic-data marker`);
  }
}

try {
  const listed = spawnSync("tar", ["-tzf", artifactPath], { encoding: "utf8" });
  if (listed.status !== 0) {
    throw new Error(`cannot list npm artifact: ${listed.stderr}`);
  }
  const archiveEntries = listed.stdout.trim().split(/\r?\n/u).filter(Boolean);
  for (const entry of archiveEntries) {
    if (!entry.startsWith("package/") || entry.includes("../") || entry.startsWith("/")) {
      findings.push(`unsafe or unexpected archive path: ${entry}`);
    }
  }

  const extracted = spawnSync("tar", ["-xzf", artifactPath, "-C", tempRoot], { encoding: "utf8" });
  if (extracted.status !== 0) {
    throw new Error(`cannot extract npm artifact: ${extracted.stderr}`);
  }

  const packageRoot = join(tempRoot, "package");
  const files = walk(packageRoot).sort();
  let scannedTextFileCount = 0;

  for (const file of files) {
    const path = `package/${relative(packageRoot, file).split(sep).join("/")}`;
    const extension = extname(path).toLowerCase();
    const pathLower = path.toLowerCase();

    if (forbiddenExtensions.has(extension)) findings.push(`${path}: forbidden artifact type`);
    if (
      !pathLower.includes("synthetic") &&
      /(?:chat[-_ ]?export|conversation[-_ ]?export|transcript|persona[-_ ]?profile|relationship[-_ ]?profile)/u.test(pathLower)
    ) {
      findings.push(`${path}: real-data-like filename`);
    }

    const bytes = readFileSync(file);
    if (bytes.includes(0)) {
      findings.push(`${path}: unexpected binary content`);
      continue;
    }
    if (!textExtensions.has(extension) && extension !== "") continue;

    scannedTextFileCount += 1;
    scanText(path, bytes.toString("utf8"));
  }

  const packageJsonPath = join(packageRoot, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const runtimeDependencies = Object.keys(packageJson.dependencies ?? {});
  if (runtimeDependencies.length > 0) {
    findings.push(`package/package.json: runtime dependencies present: ${runtimeDependencies.join(", ")}`);
  }

  const uniqueFindings = [...new Set(findings)].sort();
  const summary = {
    artifact: artifactName,
    sha256: createHash("sha256").update(readFileSync(artifactPath)).digest("hex"),
    fileCount: files.length,
    scannedTextFileCount,
    findings: uniqueFindings,
    syntheticOnly: uniqueFindings.length === 0,
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (uniqueFindings.length > 0) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
