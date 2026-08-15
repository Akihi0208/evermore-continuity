import { ContinuityLedger } from "../vendor/core-0.3.0-rc.1/ledger.js";
import { resolveIdentity } from "../vendor/core-0.3.0-rc.1/resolver.js";
import { generateCapsule, verifyCapsule } from "../vendor/core-0.3.0-rc.1/capsule.js";
import { sha256 } from "./canonical.mjs";
import { normalizeProfile } from "./profile.mjs";
import {
  SEALED_CORE_ARTIFACT_SHA256,
  SEALED_CORE_VERSION,
  verifySealedCoreBridge,
} from "./core-integrity.mjs";

export const CORE_ENVELOPE_VERSION = "0.4-core-bridge-alpha.2";
const SELF_AUTHORED_STATEMENT =
  "These anchors were selected by the profile owner; they are not independent proof.";
const PRIVACY_STATEMENT = "Local/private anchors and private notes are excluded from the Capsule.";

function opaqueId(kind, value) {
  return `${kind}:${sha256(value).slice(0, 32)}`;
}

function appendAnchor(ledger, profile, anchor, layer) {
  const evidenceId = opaqueId("evidence", {
    identityId: profile.identity.identityId,
    anchorId: anchor.id,
    key: anchor.key,
    layer,
    statement: anchor.statement,
  });
  const claimId = opaqueId("claim", {
    identityId: profile.identity.identityId,
    anchorId: anchor.id,
    key: anchor.key,
    layer,
    statement: anchor.statement,
  });
  ledger.appendEvidence({
    id: evidenceId,
    sourceId: opaqueId("profile", profile.identity.identityId),
    evidenceKind: "self_report",
    createdAt: profile.createdAt,
    confidence: 1,
    verified: false,
  });
  ledger.appendClaim({
    id: claimId,
    identityId: profile.identity.identityId,
    lineageId: profile.identity.lineageId,
    layer,
    key: anchor.key,
    value: anchor.statement,
    claimKind: "identity_claim",
    origin: "initial",
    visibility: anchor.visibility,
    createdAt: profile.createdAt,
    evidenceIds: [evidenceId],
    ...(layer === "core"
      ? {
          stabilityProfile: "slow",
          changePolicy: "accepted_evolution_required",
        }
      : {
          stabilityProfile: "adaptive",
          changePolicy: "observed_growth_with_review",
        }),
  });
}

function validateGeneratedAt(profile, generatedAt) {
  if (Number.isNaN(Date.parse(generatedAt))) throw new TypeError("generatedAt must be an ISO timestamp");
  if (Date.parse(generatedAt) < Date.parse(profile.createdAt)) {
    throw new TypeError("generatedAt cannot predate the profile");
  }
}

export async function createCoreCapsuleEnvelope(profileInput, generatedAt = new Date().toISOString()) {
  const profile = normalizeProfile(profileInput, profileInput?.createdAt);
  validateGeneratedAt(profile, generatedAt);
  const coreIntegrity = await verifySealedCoreBridge();
  if (!coreIntegrity.valid) {
    throw new Error(`Sealed core bridge verification failed: ${coreIntegrity.errors.join(", ")}`);
  }

  const ledger = new ContinuityLedger({
    identityId: profile.identity.identityId,
    lineageId: profile.identity.lineageId,
    version: 1,
  });
  const capsuleCore = profile.anchors.core.filter((anchor) => anchor.visibility === "capsule");
  const capsuleTexture = profile.anchors.texture.filter((anchor) => anchor.visibility === "capsule");
  if (capsuleCore.length === 0) {
    throw new TypeError("At least one capsule-visible Core anchor is required");
  }
  for (const anchor of capsuleCore) appendAnchor(ledger, profile, anchor, "core");
  for (const anchor of capsuleTexture) appendAnchor(ledger, profile, anchor, "texture");
  const snapshot = ledger.snapshot();
  const resolved = resolveIdentity(snapshot, { asOf: generatedAt });
  const capsule = generateCapsule(resolved, snapshot, {
    generatedAt,
    capsuleId: opaqueId("capsule", {
      lineageId: profile.identity.lineageId,
      sourceSnapshotHash: snapshot.snapshotHash,
      generatedAt,
    }),
  });
  const capsuleVerification = verifyCapsule(capsule, {
    expectedLineageId: profile.identity.lineageId,
  });
  if (!capsuleVerification.valid) {
    throw new Error(`Generated Capsule failed sealed-core verification: ${capsuleVerification.errors.join(", ")}`);
  }

  const body = {
    envelopeVersion: CORE_ENVELOPE_VERSION,
    generatedAt,
    sealedCore: {
      package: "@shenwu/continuity",
      version: SEALED_CORE_VERSION,
      artifactSha256: SEALED_CORE_ARTIFACT_SHA256,
    },
    identityDisplayName: profile.identity.displayName,
    boundaries: [...profile.boundaries],
    provenance: {
      kind: "self_authored",
      statement: SELF_AUTHORED_STATEMENT,
    },
    privacyStatement: PRIVACY_STATEMENT,
    hostVerificationStatus: "not_run",
    capsule,
  };
  return { ...body, envelopeHash: sha256(body) };
}

function strictStringList(value) {
  return Array.isArray(value) && value.length <= 100 && value.every((item) =>
    typeof item === "string" && item.trim() !== "" && item.length <= 2_000
  );
}

function exactKeys(value, allowed) {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.has(key)) &&
    [...allowed].every((key) => Object.hasOwn(value, key));
}

function validCapsuleClaim(item) {
  const fields = new Set(["key", "value", "claimId", "claimKind", "evidenceIds"]);
  return exactKeys(item, fields) &&
    typeof item.key === "string" && item.key.trim() !== "" && item.key.length <= 2_000 &&
    typeof item.value === "string" && item.value.trim() !== "" && item.value.length <= 2_000 &&
    typeof item.claimId === "string" && item.claimId.trim() !== "" &&
    item.claimKind === "identity_claim" &&
    strictStringList(item.evidenceIds) && item.evidenceIds.length > 0;
}

function validCapsuleLayer(items, requireCore = false) {
  if (!Array.isArray(items) || items.length > 100 || (requireCore && items.length === 0)) return false;
  if (!items.every(validCapsuleClaim)) return false;
  const keys = items.map((item) => item.key);
  const claimIds = items.map((item) => item.claimId);
  return new Set(keys).size === keys.length && new Set(claimIds).size === claimIds.length;
}

function validateBridgeCapsuleShape(capsule, envelopeGeneratedAt) {
  const errors = [];
  const fields = new Set([
    "capsuleVersion",
    "schemaVersion",
    "capsuleId",
    "generatedAt",
    "identity",
    "sourceSnapshotHash",
    "identityFingerprint",
    "core",
    "texture",
    "recentEvolutionIds",
    "coEvolutionIds",
    "unresolvedConflicts",
    "provenanceRules",
    "driftRisks",
    "integrityHash",
  ]);
  if (!exactKeys(capsule, fields)) return ["capsule_structure_invalid"];
  if (capsule.capsuleVersion !== "0.2" || capsule.schemaVersion !== "0.2") {
    errors.push("capsule_version_invalid");
  }
  if (
    typeof capsule.capsuleId !== "string" || capsule.capsuleId.trim() === "" ||
    capsule.generatedAt !== envelopeGeneratedAt || Number.isNaN(Date.parse(capsule.generatedAt))
  ) {
    errors.push("capsule_metadata_invalid");
  }
  const identityFields = new Set(["identityId", "lineageId", "version"]);
  if (
    !exactKeys(capsule.identity, identityFields) ||
    typeof capsule.identity.identityId !== "string" || capsule.identity.identityId.trim() === "" ||
    typeof capsule.identity.lineageId !== "string" || capsule.identity.lineageId.trim() === "" ||
    capsule.identity.version !== 1
  ) {
    errors.push("capsule_identity_invalid");
  }
  if (!/^[a-f0-9]{64}$/.test(capsule.sourceSnapshotHash) ||
      !/^[a-f0-9]{64}$/.test(capsule.identityFingerprint) ||
      !/^[a-f0-9]{64}$/.test(capsule.integrityHash)) {
    errors.push("capsule_hash_field_invalid");
  }
  if (!validCapsuleLayer(capsule.core, true)) {
    errors.push("capsule_core_invalid");
  }
  if (!validCapsuleLayer(capsule.texture)) {
    errors.push("capsule_texture_invalid");
  }
  if (!strictStringList(capsule.provenanceRules) ||
      !strictStringList(capsule.recentEvolutionIds) ||
      !strictStringList(capsule.coEvolutionIds) ||
      !Array.isArray(capsule.unresolvedConflicts) || capsule.unresolvedConflicts.length !== 0 ||
      !Array.isArray(capsule.driftRisks) || capsule.driftRisks.length !== 0) {
    errors.push("capsule_bridge_scope_invalid");
  }
  return errors;
}

export async function verifyCoreCapsuleEnvelope(envelope, options = {}) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return { valid: false, errors: ["envelope_not_object"] };
  }
  const errors = [];
  const allowedFields = new Set([
    "envelopeVersion",
    "generatedAt",
    "sealedCore",
    "identityDisplayName",
    "boundaries",
    "provenance",
    "privacyStatement",
    "hostVerificationStatus",
    "capsule",
    "envelopeHash",
  ]);
  if (Object.keys(envelope).some((key) => !allowedFields.has(key))) {
    errors.push("unexpected_envelope_field");
  }
  const { envelopeHash, ...body } = envelope;
  try {
    if (typeof envelopeHash !== "string" || sha256(body) !== envelopeHash) {
      errors.push("envelope_hash_mismatch");
    }
  } catch {
    errors.push("envelope_hash_mismatch");
  }
  if (envelope.envelopeVersion !== CORE_ENVELOPE_VERSION) errors.push("unsupported_envelope_version");
  if (Number.isNaN(Date.parse(envelope.generatedAt))) errors.push("generated_at_invalid");
  if (typeof envelope.identityDisplayName !== "string" ||
      envelope.identityDisplayName.trim() === "" || envelope.identityDisplayName.length > 2_000) {
    errors.push("identity_display_name_invalid");
  }
  if (!strictStringList(envelope.boundaries)) errors.push("boundaries_invalid");
  if (
    !exactKeys(envelope.sealedCore, new Set(["package", "version", "artifactSha256"])) ||
    envelope.sealedCore?.package !== "@shenwu/continuity" ||
    envelope.sealedCore?.version !== SEALED_CORE_VERSION ||
    envelope.sealedCore?.artifactSha256 !== SEALED_CORE_ARTIFACT_SHA256
  ) {
    errors.push("sealed_core_binding_invalid");
  }
  if (
    !exactKeys(envelope.provenance, new Set(["kind", "statement"])) ||
    envelope.provenance?.kind !== "self_authored" ||
    envelope.provenance?.statement !== SELF_AUTHORED_STATEMENT
  ) {
    errors.push("provenance_invalid");
  }
  if (envelope.privacyStatement !== PRIVACY_STATEMENT) errors.push("privacy_statement_invalid");
  if (envelope.hostVerificationStatus !== "not_run") errors.push("host_verification_status_invalid");

  errors.push(...validateBridgeCapsuleShape(envelope.capsule, envelope.generatedAt));

  try {
    const result = verifyCapsule(envelope.capsule, {
      ...(options.expectedLineageId ? { expectedLineageId: options.expectedLineageId } : {}),
    });
    errors.push(...result.errors.map((error) => `capsule:${error}`));
  } catch {
    errors.push("capsule:invalid_structure");
  }
  const coreIntegrity = await verifySealedCoreBridge(options.coreIntegrity ?? {});
  errors.push(...coreIntegrity.errors.map((error) => `core:${error}`));
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    coreIntegrity,
  };
}
