import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

interface NetworkDisabledSummary {
  networkGuardActive: boolean;
  networkAttempts: number;
  modelCalls: number;
  syntheticStructuredObservationsOnly: boolean;
  tests: number;
  passed: number;
  failed: number;
}

interface PackedArtifactScanSummary {
  artifact: string;
  fileCount: number;
  scannedTextFileCount: number;
  findings: string[];
  syntheticOnly: boolean;
}

function parseLastJsonLine<T>(output: string): T {
  const lines = output.trim().split(/\r?\n/u);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) continue;
    try {
      return JSON.parse(line) as T;
    } catch {
      // Keep walking: subprocesses may write TAP or npm notices before the summary.
    }
  }
  throw new Error(`No JSON summary found in output:\n${output}`);
}

test("V03-041 complete v0.3 core suite passes with network disabled and synthetic probes only", () => {
  const projectRoot = process.cwd();
  const result = spawnSync(
    process.execPath,
    [join(projectRoot, "scripts/run-v03-network-disabled.mjs")],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CONTINUITY_PROJECT_ROOT: projectRoot,
      },
      timeout: 120_000,
    },
  );

  assert.equal(
    result.status,
    0,
    `network-disabled suite failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  const summary = parseLastJsonLine<NetworkDisabledSummary>(result.stdout);
  assert.equal(summary.networkGuardActive, true);
  assert.equal(summary.networkAttempts, 0);
  assert.equal(summary.modelCalls, 0);
  assert.equal(summary.syntheticStructuredObservationsOnly, true);
  assert.equal(summary.tests, 54);
  assert.equal(summary.passed, 54);
  assert.equal(summary.failed, 0);
});

test("V03-042 final npm-packed artifact passes automated real-persona data scan", () => {
  const projectRoot = process.cwd();
  const tempRoot = mkdtempSync(join(tmpdir(), "continuity-v03-packed-scan-"));
  const packDir = join(tempRoot, "pack");
  const cacheDir = join(tempRoot, "npm-cache");

  try {
    mkdirSync(packDir);
    const packed = spawnSync(
      "npm",
      ["pack", "--json", "--pack-destination", packDir],
      {
        cwd: projectRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          NPM_CONFIG_CACHE: cacheDir,
        },
        timeout: 120_000,
      },
    );
    assert.equal(
      packed.status,
      0,
      `npm pack failed\nstdout:\n${packed.stdout}\nstderr:\n${packed.stderr}`,
    );

    const packResult = JSON.parse(packed.stdout) as Array<{ filename: string }>;
    const filename = packResult[0]?.filename;
    assert.ok(filename, "npm pack did not report an artifact filename");
    const artifactPath = join(packDir, filename);

    const scanned = spawnSync(
      process.execPath,
      [join(projectRoot, "scripts/scan-packed-artifact.mjs"), artifactPath],
      {
        cwd: projectRoot,
        encoding: "utf8",
        timeout: 120_000,
      },
    );
    assert.equal(
      scanned.status,
      0,
      `packed-artifact scan failed\nstdout:\n${scanned.stdout}\nstderr:\n${scanned.stderr}`,
    );

    const summary = parseLastJsonLine<PackedArtifactScanSummary>(scanned.stdout);
    assert.equal(summary.artifact, filename);
    assert.ok(summary.fileCount > 0);
    assert.ok(summary.scannedTextFileCount > 0);
    assert.deepEqual(summary.findings, []);
    assert.equal(summary.syntheticOnly, true);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
