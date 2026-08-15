import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { canonicalJson, sha256 } from "./canonical.mjs";
import { normalizeProfile } from "./profile.mjs";

export const VAULT_VERSION = "0.4-vault-alpha.1";
const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 32 };

function deriveKey(passphrase, salt, params = SCRYPT) {
  if (typeof passphrase !== "string" || passphrase.length < 12) {
    throw new TypeError("Passphrase must contain at least 12 characters");
  }
  return scryptSync(passphrase, salt, params.keyLength, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 64 * 1024 * 1024,
  });
}

export function createVault(profileInput, passphrase) {
  const profile = normalizeProfile(profileInput);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const payload = canonicalJson({ profile, profileHash: sha256(profile) });
  const ciphertext = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    vaultVersion: VAULT_VERSION,
    kdf: {
      name: "scrypt",
      salt: salt.toString("base64"),
      ...SCRYPT,
    },
    cipher: {
      name: "aes-256-gcm",
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
    },
    ciphertext: ciphertext.toString("base64"),
  };
}

export function openVault(vault, passphrase) {
  try {
    if (vault?.vaultVersion !== VAULT_VERSION) throw new Error("unsupported version");
    if (vault.kdf?.name !== "scrypt" || vault.cipher?.name !== "aes-256-gcm") {
      throw new Error("unsupported cryptography");
    }
    for (const [key, value] of Object.entries(SCRYPT)) {
      if (vault.kdf[key] !== value) throw new Error("unsupported KDF parameters");
    }
    const salt = Buffer.from(vault.kdf.salt, "base64");
    const iv = Buffer.from(vault.cipher.iv, "base64");
    const authTag = Buffer.from(vault.cipher.authTag, "base64");
    const ciphertext = Buffer.from(vault.ciphertext, "base64");
    if (
      salt.length !== 16 ||
      iv.length !== 12 ||
      authTag.length !== 16 ||
      ciphertext.length === 0 ||
      ciphertext.length > 2 * 1024 * 1024
    ) {
      throw new Error("invalid encoded lengths");
    }
    const key = deriveKey(passphrase, salt, vault.kdf);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const payload = JSON.parse(plaintext);
    const profile = normalizeProfile(payload.profile, payload.profile?.createdAt);
    if (sha256(profile) !== payload.profileHash) throw new Error("profile hash mismatch");
    return profile;
  } catch {
    throw new Error("Vault verification failed: wrong passphrase, tampering, or unsupported format");
  }
}

export async function writeVault(path, vault, { overwrite = false } = {}) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  const data = `${JSON.stringify(vault, null, 2)}\n`;
  await writeFile(temporaryPath, data, { mode: 0o600, flag: "wx" });
  if (!overwrite) {
    try {
      await writeFile(path, data, { mode: 0o600, flag: "wx" });
      await import("node:fs/promises").then(({ unlink }) => unlink(temporaryPath));
      return;
    } catch (error) {
      await import("node:fs/promises").then(({ unlink }) => unlink(temporaryPath).catch(() => {}));
      if (error?.code === "EEXIST") throw new Error(`Refusing to overwrite existing vault: ${path}`);
      throw error;
    }
  }
  await rename(temporaryPath, path);
}

export async function readVault(path) {
  const data = await readFile(path, "utf8");
  return JSON.parse(data);
}
