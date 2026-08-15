import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const SEALED_CORE_VERSION = "0.3.0-rc.1";
export const SEALED_CORE_ARTIFACT_SHA256 = "7865c2144c0fc55209ee9777d818517dd242a36d5ef0f00b401cf5e6009a1c48";
export const VENDOR_MANIFEST_SHA256 = "13204c40cd53ad818d4ee54d385a54d92864f4aea94857b91265639de2d537d5";

export const VENDORED_CORE_SHA256 = Object.freeze({
  "acceptance-status.js": "033899e481d798d06aac8e363014902c98e9e7d6b9f183c85418cdf6d1142f20",
  "canonical.js": "1ae9791d8835625762805e27313ab232aac3bf4e801b844af2e786966eb918f9",
  "capsule.js": "6fba89bca2ea89c9b964c18f6fd0ffbcc9cba9bd8244d974acc67fe779327fc1",
  "errors.js": "b153d59fa7d4ea03f7390ef800b9d2caf82b6e9833739508bd893126045c1dd6",
  "ledger.js": "8ec0969ef875403e11fc509537e5f74c33bdbb1a65f332523af346a23bdd02b5",
  "provenance.js": "bdc3fc1206d7ab09381e8cc0f6556c653047e7e9ef7f5e1d60d78a06eb559f58",
  "resolver.js": "175b504ab4be950bdcc3411cb8c60b41bc8fed04ef8bf4cdb7d67607cbe9ef70",
});

const DEFAULT_ARTIFACT_PATH = fileURLToPath(
  new URL("../../artifacts/shenwu-continuity-0.3.0-rc.1.tgz", import.meta.url),
);
const DEFAULT_VENDOR_ROOT = fileURLToPath(
  new URL("../vendor/core-0.3.0-rc.1", import.meta.url),
);

async function fileSha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function verifySealedCoreBridge(options = {}) {
  const artifactPath = options.artifactPath ?? DEFAULT_ARTIFACT_PATH;
  const vendorRoot = options.vendorRoot ?? DEFAULT_VENDOR_ROOT;
  const errors = [];
  let artifactSha256;
  try {
    artifactSha256 = await fileSha256(artifactPath);
    if (artifactSha256 !== SEALED_CORE_ARTIFACT_SHA256) errors.push("sealed_core_artifact_hash_mismatch");
  } catch {
    errors.push("sealed_core_artifact_unavailable");
  }

  const runtimeFileHashes = {};
  try {
    const manifestHash = await fileSha256(join(vendorRoot, "manifest.json"));
    if (manifestHash !== VENDOR_MANIFEST_SHA256) errors.push("vendored_core_manifest_hash_mismatch");
  } catch {
    errors.push("vendored_core_manifest_unavailable");
  }
  for (const [filename, expectedHash] of Object.entries(VENDORED_CORE_SHA256)) {
    try {
      const actualHash = await fileSha256(join(vendorRoot, filename));
      runtimeFileHashes[filename] = actualHash;
      if (actualHash !== expectedHash) errors.push(`vendored_core_hash_mismatch:${filename}`);
    } catch {
      errors.push(`vendored_core_unavailable:${filename}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    coreVersion: SEALED_CORE_VERSION,
    artifactSha256: artifactSha256 ?? null,
    runtimeFileHashes,
  };
}
