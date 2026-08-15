import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPortablePackage, normalizeProfile, verifyPortablePackage } from "../src/profile.mjs";
import { sha256 } from "../src/canonical.mjs";
import { renderHostHandoff } from "../src/handoff.mjs";
import { createVault, openVault, readVault, writeVault } from "../src/vault.mjs";

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

test("encrypted vault round-trips and preserves normalized profile", () => {
  const profile = normalizeProfile(input);
  const vault = createVault(profile, "correct horse battery staple");
  assert.deepEqual(openVault(vault, "correct horse battery staple"), profile);
  assert.doesNotMatch(JSON.stringify(vault), /Synthetic private note|Never export this/);
});

test("wrong passphrase and ciphertext tampering fail closed", () => {
  const vault = createVault(input, "correct horse battery staple");
  assert.throws(() => openVault(vault, "another passphrase value"), /Vault verification failed/);
  const tampered = structuredClone(vault);
  const bytes = Buffer.from(tampered.ciphertext, "base64");
  bytes[0] ^= 1;
  tampered.ciphertext = bytes.toString("base64");
  assert.throws(() => openVault(tampered, "correct horse battery staple"), /Vault verification failed/);
  const expensiveKdf = structuredClone(vault);
  expensiveKdf.kdf.N = 2 ** 20;
  assert.throws(() => openVault(expensiveKdf, "correct horse battery staple"), /Vault verification failed/);
});

test("portable package excludes local/private anchors and private notes", () => {
  const pkg = createPortablePackage(input, "2026-08-15T01:00:00.000Z");
  const text = JSON.stringify(pkg);
  assert.match(text, /Separate observations from inference/);
  assert.match(text, /Concise and calm/);
  assert.doesNotMatch(text, /Never export this|Local synthetic style|Synthetic private note/);
  assert.deepEqual(verifyPortablePackage(pkg), { valid: true, errors: [] });
});

test("portable package tampering is detected", () => {
  const pkg = createPortablePackage(input, "2026-08-15T01:00:00.000Z");
  pkg.core[0].statement = "Tampered";
  assert.deepEqual(verifyPortablePackage(pkg), { valid: false, errors: ["package_hash_mismatch"] });
});

test("portable packages reject unexpected fields", () => {
  const pkg = createPortablePackage(input, "2026-08-15T01:00:00.000Z");
  pkg.privateNotes = ["This field is forbidden even when someone recomputes the hash."];
  const { packageHash: _oldHash, ...body } = pkg;
  pkg.packageHash = sha256(body);
  assert.equal(verifyPortablePackage(pkg).valid, false);
  assert.match(verifyPortablePackage(pkg).errors.join(","), /unexpected_package_field/);
});

test("host handoff is model-neutral and privacy-safe", () => {
  const handoff = renderHostHandoff(createPortablePackage(input, "2026-08-15T01:00:00.000Z"));
  assert.match(handoff, /receiving model/);
  assert.match(handoff, /Core anchors/);
  assert.doesNotMatch(handoff, /Never export this|Local synthetic style|Synthetic private note/);
});

test("vault writes are private and refuse accidental overwrite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evermore-runtime-"));
  const path = join(directory, "persona.evermore-vault.json");
  const vault = createVault(input, "correct horse battery staple");
  await writeVault(path, vault);
  assert.deepEqual(await readVault(path), vault);
  if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
  await assert.rejects(writeVault(path, vault), /Refusing to overwrite/);
  assert.match(await readFile(path, "utf8"), /0.4-vault-alpha.1/);
});

test("a profile requires at least one Core anchor", () => {
  assert.throws(
    () => normalizeProfile({ identity: { displayName: "Orbit" }, anchors: { core: [] } }),
    /At least one Core anchor/,
  );
});
