import { verifyPortablePackage } from "./profile.mjs";

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
