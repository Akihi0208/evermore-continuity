import { clone, sha256 } from "./canonical.js";
import { ValidationError } from "./errors.js";
import { assertSnapshotIntegrity } from "./ledger.js";
import { DEFAULT_PROVENANCE_RULES } from "./provenance.js";
import type {
  CapsuleClaim,
  CapsuleOptions,
  CapsuleVerificationOptions,
  CapsuleVerificationResult,
  ClaimVisibility,
  ContinuityCapsule,
  DriftCategory,
  DriftObservation,
  IdentityClaim,
  IdentityLayer,
  LedgerSnapshot,
  ResolvedIdentity,
} from "./types.js";

const SAFE_DRIFT_EXPLANATIONS: Record<DriftCategory, string> = {
  core_missing: "An exported Core claim is absent from the current resolved identity.",
  core_reversal: "An exported Core claim changed without a resolved accepted evolution.",
  texture_shift: "An exported Texture change was observed and may warrant review.",
  lineage_mismatch: "The compared resolved identities belong to different lineages.",
  unprovenanced_rule: "An exported active claim has no provenance records.",
  retrieval_gap: "An exported claim may be absent because retrieval is incomplete.",
  policy_mask: "An exported claim may be obscured by an expression constraint.",
  explained_evolution: "The exported change is linked to a resolved accepted evolution.",
};

function visibilityExportable(visibility: ClaimVisibility, options: CapsuleOptions): boolean {
  if (visibility === "capsule") return true;
  if (visibility === "local") return options.includeLocal === true;
  return options.includePrivate === true;
}

function toCapsuleClaim(claim: IdentityClaim): CapsuleClaim {
  const base: CapsuleClaim = {
    key: claim.key,
    value: clone(claim.value),
    claimId: claim.id,
    claimKind: claim.claimKind,
    evidenceIds: [...claim.evidenceIds],
  };
  return claim.scope ? { ...base, scope: claim.scope } : base;
}

function selectLayer(
  claims: IdentityClaim[],
  layer: IdentityLayer,
  options: CapsuleOptions,
): CapsuleClaim[] {
  return claims
    .filter((claim) => claim.layer === layer && visibilityExportable(claim.visibility, options))
    .map(toCapsuleClaim)
    .sort((a, b) => a.key.localeCompare(b.key) || a.claimId.localeCompare(b.claimId));
}

function sanitizeDriftObservation(
  item: DriftObservation,
  claimById: ReadonlyMap<string, IdentityClaim>,
  exportableClaimIds: ReadonlySet<string>,
): DriftObservation | undefined {
  const ids = [...item.historicalClaimIds, ...item.currentClaimIds];
  if (ids.length === 0 || ids.some((id) => !exportableClaimIds.has(id))) return undefined;
  const referenced = ids.map((id) => claimById.get(id)).filter((claim) => claim !== undefined);
  if (referenced.length !== ids.length) return undefined;
  if (item.key && !referenced.some((claim) => claim.key === item.key)) return undefined;
  if (item.layer && !referenced.every((claim) => claim.layer === item.layer)) return undefined;
  const explanation = SAFE_DRIFT_EXPLANATIONS[item.category];
  if (!explanation) return undefined;
  return {
    category: item.category,
    risk: item.risk,
    ...(item.layer ? { layer: item.layer } : {}),
    ...(item.key ? { key: item.key } : {}),
    historicalClaimIds: [...item.historicalClaimIds],
    currentClaimIds: [...item.currentClaimIds],
    explanation,
  };
}

export function generateCapsule(
  resolved: ResolvedIdentity,
  snapshot: LedgerSnapshot,
  options: CapsuleOptions,
): ContinuityCapsule {
  assertSnapshotIntegrity(snapshot);
  if (resolved.sourceSnapshotHash !== snapshot.snapshotHash) {
    throw new ValidationError("Resolved identity and ledger snapshot do not match");
  }
  if (Number.isNaN(Date.parse(options.generatedAt))) {
    throw new ValidationError("Capsule generatedAt must be an ISO timestamp");
  }
  const limit = options.recentEvolutionLimit ?? 10;
  const accepted = new Set(resolved.acceptedEvolutionIds);
  const allClaims: IdentityClaim[] = [...snapshot.identityCore, ...snapshot.identityTexture];
  const claimById = new Map(allClaims.map((claim) => [claim.id, claim]));
  const exportableClaimIds = new Set(
    allClaims
      .filter((claim) => visibilityExportable(claim.visibility, options))
      .map((claim) => claim.id),
  );
  const exportableEvolutionIds = new Set(
    snapshot.evolutions
      .filter(
        (event) =>
          exportableClaimIds.has(event.previousClaimId) &&
          exportableClaimIds.has(event.newClaimId),
      )
      .map((event) => event.id),
  );
  const recentEvolutionIds = snapshot.evolutions
    .filter((event) => accepted.has(event.id) && exportableEvolutionIds.has(event.id))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id))
    .slice(0, limit)
    .map((event) => event.id);
  const exportedEvolutionIds = new Set(recentEvolutionIds);
  const coEvolutionIds = snapshot.coEvolutions
    .filter((record) => visibilityExportable(record.visibility, options))
    .filter((record) =>
      record.influenceEdges.every(
        (edge) => !edge.affectedEvolutionId || exportedEvolutionIds.has(edge.affectedEvolutionId),
      ),
    )
    .filter((record) =>
      (record.relationshipEffects ?? []).every((effect) =>
        [effect.previousRelationshipClaimId, effect.newRelationshipClaimId]
          .filter((id): id is string => id !== undefined)
          .every((id) => exportableClaimIds.has(id)),
      ),
    )
    .filter(
      (record) =>
        record.participants.some(
          (participant) => participant.identityId === resolved.descriptor.identityId,
        ) ||
        record.influenceEdges.some(
          (edge) => edge.affectedEvolutionId && exportedEvolutionIds.has(edge.affectedEvolutionId),
        ),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .slice(0, limit)
    .map((record) => record.id);

  const unresolvedConflicts = resolved.conflicts.filter((item) => {
    const eventVisible = exportableEvolutionIds.has(item.evolutionId);
    if (!eventVisible) return false;
    return item.kind === "acceptance" || item.claimIds.every((id) => exportableClaimIds.has(id));
  });
  const driftRisks = (options.driftReport?.observations ?? [])
    .filter((item) => item.risk !== "none")
    .map((item) => sanitizeDriftObservation(item, claimById, exportableClaimIds))
    .filter((item): item is DriftObservation => item !== undefined);
  const core = selectLayer(resolved.activeClaims, "core", options);
  const texture = selectLayer(resolved.activeClaims, "texture", options);
  const capsuleFingerprint = sha256({
    lineageId: resolved.descriptor.lineageId,
    core: core.map((claim) => ({ key: claim.key, scope: claim.scope ?? null, value: claim.value })),
  });

  const body = {
    capsuleVersion: "0.2" as const,
    schemaVersion: "0.2" as const,
    capsuleId:
      options.capsuleId ??
      `continuity:${resolved.descriptor.lineageId}:${resolved.descriptor.version}:${options.generatedAt}`,
    generatedAt: options.generatedAt,
    identity: clone(resolved.descriptor),
    ...(options.parentCapsuleHash ? { parentCapsuleHash: options.parentCapsuleHash } : {}),
    sourceSnapshotHash: snapshot.snapshotHash,
    identityFingerprint: capsuleFingerprint,
    core,
    texture,
    recentEvolutionIds,
    coEvolutionIds,
    unresolvedConflicts: clone(unresolvedConflicts),
    provenanceRules: [...DEFAULT_PROVENANCE_RULES],
    driftRisks: clone(driftRisks),
  };

  return { ...body, integrityHash: sha256(body) };
}

export function verifyCapsule(
  capsule: ContinuityCapsule,
  options: CapsuleVerificationOptions = {},
): CapsuleVerificationResult {
  const errors: string[] = [];
  const { integrityHash, ...body } = capsule;
  if (sha256(body) !== integrityHash) errors.push("integrity_hash_mismatch");
  if (options.expectedLineageId && capsule.identity.lineageId !== options.expectedLineageId) {
    errors.push("lineage_mismatch");
  }
  if (
    options.expectedParentCapsuleHash &&
    capsule.parentCapsuleHash !== options.expectedParentCapsuleHash
  ) {
    errors.push("stale_or_unexpected_parent");
  }
  return { valid: errors.length === 0, errors };
}
