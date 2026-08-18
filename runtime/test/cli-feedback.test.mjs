import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CLI_PATH = fileURLToPath(new URL("../bin/evermore.mjs", import.meta.url));
const SYNTHETIC_PROFILE = fileURLToPath(new URL("../examples/synthetic-profile.json", import.meta.url));

function runCli(args, cwd, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test("seal announces the 12-character passphrase requirement before creating a vault", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evermore-seal-feedback-"));
  const vaultPath = join(directory, "persona.evermore-vault.json");
  const result = await runCli(
    ["seal", SYNTHETIC_PROFILE, vaultPath],
    directory,
    { EVERMORE_PASSPHRASE: "synthetic-seal-passphrase" },
  );
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Vault passphrase requirement: at least 12 characters\./);
  assert.match(result.stdout, /Encrypted vault created:/);
});

test("self-distill-import reports an actionable non-overwrite error instead of raw EEXIST", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evermore-import-feedback-"));
  const recordPath = join(directory, "record.json");
  const profilePath = join(directory, "record.profile.json");
  const auditPath = join(directory, "record.audit.json");
  await writeFile(recordPath, "{}\n", { mode: 0o600 });
  await writeFile(profilePath, "keep-existing-profile\n", { mode: 0o600 });
  await writeFile(auditPath, "keep-existing-audit\n", { mode: 0o600 });

  const result = await runCli(
    ["self-distill-import", recordPath, profilePath, auditPath],
    directory,
  );

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Refusing to overwrite existing Self-Distillation output files:/);
  assert.match(result.stderr, /Choose different output path\(s\) or move\/remove the existing file\(s\)\./);
  assert.doesNotMatch(result.stderr, /EEXIST/);
  assert.equal(await readFile(profilePath, "utf8"), "keep-existing-profile\n");
  assert.equal(await readFile(auditPath, "utf8"), "keep-existing-audit\n");
});
