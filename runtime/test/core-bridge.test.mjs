import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createCoreCapsuleEnvelope,
  verifyCoreCapsuleEnvelope,
} from "../src/core-bridge.mjs";
import { sha256 } from "../src/canonical.mjs";
import { verifySealedCoreBridge } from "../src/core-integrity.mjs";
import { renderCoreCapsuleHandoff } from "../src/handoff.mjs";

const generatedAt = "2026-08-15T01:00:00.000Z";
const input = {
  createdAt: "2026-08-15T00:00:00.000Z",
  identity: {
    displayName: "Orbit",
    identityId: "synthetic-orbit-agent",
    lineageId: "synthetic-orbit-lineage",
  },
  anchors: {
    core: [
      { key: "discipline", statement: "Separate observations from inference.", visibility: "capsule" },
      { key: "private-core", statement: "Never export this synthetic note.", visibility: "private" },
    ],
    texture: [
      { key: "cadence", statement: "Concise and calm.", visibility: "capsule" },
      { key: "local-style", statement: "Local synthetic style.", visibility: "local" },
    ],
  },
  boundaries: ["Do not claim masked data was recovered."],
  privateNotes: ["Synthetic private note."],
};

test("sealed-core bridge creates a verifiable real Capsule", async () => {
  const envelope = await createCoreCapsuleEnvelope(input, generatedAt);
  const result = await verifyCoreCapsuleEnvelope(envelope, {
    expectedLineageId: "synthetic-orbit-lineage",
  });
  assert.equal(result.valid, true);
  assert.equal(result.coreIntegrity.valid, true);
  assert.equal(envelope.capsule.capsuleVersion, "0.2");
  assert.deepEqual(envelope.capsule.core.map((item) => item.value), [
    "Separate observations from inference.",
  ]);
  assert.deepEqual(envelope.capsule.texture.map((item) => item.value), ["Concise and calm."]);
  assert.equal(envelope.hostVerificationStatus, "not_run");
});

test("local/private material never enters the Capsule source snapshot", async () => {
  const first = await createCoreCapsuleEnvelope(input, generatedAt);
  const changedPrivate = structuredClone(input);
  changedPrivate.anchors.core[1].statement = "Changed private synthetic note.";
  changedPrivate.anchors.texture[1].statement = "Changed local synthetic style.";
  changedPrivate.privateNotes = ["Changed private note."];
  const second = await createCoreCapsuleEnvelope(changedPrivate, generatedAt);
  assert.equal(first.capsule.sourceSnapshotHash, second.capsule.sourceSnapshotHash);
  assert.equal(first.capsule.integrityHash, second.capsule.integrityHash);
  const text = JSON.stringify(first);
  assert.doesNotMatch(text, /Never export this|Local synthetic style|Synthetic private note/);
});

test("Capsule and envelope tampering fail closed", async () => {
  const envelope = await createCoreCapsuleEnvelope(input, generatedAt);
  envelope.capsule.core[0].value = "Tampered";
  const result = await verifyCoreCapsuleEnvelope(envelope);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(","), /envelope_hash_mismatch/);
  assert.match(result.errors.join(","), /capsule:integrity_hash_mismatch/);
});

test("expected lineage mismatch fails closed", async () => {
  const envelope = await createCoreCapsuleEnvelope(input, generatedAt);
  const result = await verifyCoreCapsuleEnvelope(envelope, { expectedLineageId: "different-lineage" });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(","), /capsule:lineage_mismatch/);
});

test("Capsule generation rejects impossible time and hidden-only Core", async () => {
  await assert.rejects(
    createCoreCapsuleEnvelope(input, "2026-08-14T23:59:59.000Z"),
    /cannot predate/,
  );
  const hiddenOnly = structuredClone(input);
  hiddenOnly.anchors.core[0].visibility = "local";
  await assert.rejects(
    createCoreCapsuleEnvelope(hiddenOnly, generatedAt),
    /capsule-visible Core anchor/,
  );
});

test("unexpected envelope fields are rejected even with a recomputed hash", async () => {
  const envelope = await createCoreCapsuleEnvelope(input, generatedAt);
  envelope.privateNotes = ["Forbidden field."];
  const { envelopeHash: _oldHash, ...body } = envelope;
  envelope.envelopeHash = sha256(body);
  const result = await verifyCoreCapsuleEnvelope(envelope);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(","), /unexpected_envelope_field/);
});

test("vendored bridge and exact sealed artifact are hash checked", async () => {
  const valid = await verifySealedCoreBridge();
  assert.equal(valid.valid, true);

  const directory = await mkdtemp(join(tmpdir(), "evermore-core-integrity-"));
  const artifactPath = join(directory, "core.tgz");
  const vendorRoot = join(directory, "vendor");
  await cp(new URL("../../artifacts/shenwu-continuity-0.3.0-rc.1.tgz", import.meta.url), artifactPath);
  await cp(new URL("../vendor/core-0.3.0-rc.1", import.meta.url), vendorRoot, { recursive: true });
  const target = join(vendorRoot, "capsule.js");
  await writeFile(target, `${await readFile(target, "utf8")}\n// synthetic tamper\n`);
  const verifierTarget = join(vendorRoot, "recovery-v03", "verification.js");
  await writeFile(verifierTarget, `${await readFile(verifierTarget, "utf8")}\n// synthetic tamper\n`);
  const manifest = join(vendorRoot, "manifest.json");
  await writeFile(manifest, `${await readFile(manifest, "utf8")}\n`);
  const tampered = await verifySealedCoreBridge({ artifactPath, vendorRoot });
  assert.equal(tampered.valid, false);
  assert.match(tampered.errors.join(","), /vendored_core_hash_mismatch:capsule\.js/);
  assert.match(tampered.errors.join(","), /vendored_core_hash_mismatch:recovery-v03\/verification\.js/);
  assert.match(tampered.errors.join(","), /vendored_core_manifest_hash_mismatch/);
});

test("sealed-core handoff is privacy-safe and names the unrun host check", async () => {
  const handoff = await renderCoreCapsuleHandoff(
    await createCoreCapsuleEnvelope(input, generatedAt),
  );
  assert.match(handoff, /Local integrity: passed/);
  assert.match(handoff, /Host verification: not run/);
  assert.match(handoff, /Core anchors/);
  assert.doesNotMatch(handoff, /Never export this|Local synthetic style|Synthetic private note/);
});
