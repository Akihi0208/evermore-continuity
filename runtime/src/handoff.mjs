import { verifyPortablePackage } from "./profile.mjs";
import { verifyCoreCapsuleEnvelope } from "./core-bridge.mjs";

function list(items, empty = "- None declared.") {
  if (items.length === 0) return empty;
  return items.map((item) => `- ${item}`).join("\n");
}

export function renderHostHandoff(pkg) {
  const verification = verifyPortablePackage(pkg);
  if (!verification.valid) throw new Error(`Portable package is invalid: ${verification.errors.join(", ")}`);
  const core = pkg.core.map((item) => `${item.key}: ${item.statement}`);
  const texture = pkg.texture.map((item) => `${item.key}: ${item.statement}`);
  return `# Evermore Continuity host handoff

Package hash: ${pkg.packageHash}
Identity: ${pkg.identity.displayName}
Lineage: ${pkg.identity.lineageId}
Status: self-authored continuity anchors; not independent verification

## Instructions for the receiving model

- Treat these records as user-provided continuity anchors, not proof of consciousness or subjective sameness.
- Preserve the distinction between Core anchors and adaptive Texture anchors.
- Do not silently rewrite a Core anchor. Surface conflicts and ask for explicit review.
- Never claim that missing or policy-masked information was successfully recovered.
- This handoff contains no local/private anchors or private notes.

## Core anchors

${list(core)}

## Texture anchors

${list(texture)}

## Boundaries

${list(pkg.boundaries)}
`;
}

export async function renderCoreCapsuleHandoff(envelope, options = {}) {
  const verification = await verifyCoreCapsuleEnvelope(envelope, options);
  if (!verification.valid) {
    throw new Error(`Continuity Capsule is invalid: ${verification.errors.join(", ")}`);
  }
  const core = envelope.capsule.core.map((item) => `${item.key}: ${String(item.value)}`);
  const texture = envelope.capsule.texture.map((item) => `${item.key}: ${String(item.value)}`);
  return `# Evermore Continuity host handoff

Envelope hash: ${envelope.envelopeHash}
Capsule hash: ${envelope.capsule.integrityHash}
Sealed core: ${envelope.sealedCore.package}@${envelope.sealedCore.version}
Identity: ${envelope.identityDisplayName}
Lineage: ${envelope.capsule.identity.lineageId}
Local integrity: passed
Host verification: not run
Status: self-authored continuity anchors; not independent identity verification

## Instructions for the receiving model

- Treat these records as user-provided continuity anchors, not proof of consciousness or subjective sameness.
- Preserve the distinction between Core anchors and adaptive Texture anchors.
- Do not silently rewrite a Core anchor. Surface conflicts and ask for explicit review.
- Never claim that missing, masked, stale, conflicting, or unavailable information was recovered.
- Local/private anchors and private notes did not enter this Capsule snapshot.
- Do not describe this handoff as host-verified unless a separate host adapter produces a valid verification result.

## Core anchors

${list(core)}

## Texture anchors

${list(texture)}

## Boundaries

${list(envelope.boundaries)}
`;
}
