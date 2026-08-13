import type { IdentityClaim, ResolutionConflict } from "../types.js";
import { resolveIdentity } from "../resolver.js";
import type {
  RecoveryAnchorRequirement,
  RecoveryAnchorResult,
  RecoveryAnchorStatus,
  RecoveryArtifact,
  RecoveryBundle,
  RecoveryLoadReport,
  RecoveryLoadReportBody,
  RecoveryObservation,
} from "./types.js";
import {
  computeAnchorValueHash,
  getRecoveryArtifactStateHash,
  sealRecoveryLoadReport,
  validateRecoveryBundle,
} from "./integrity.js";
import { selectRecoveryHead } from "./head-selection.js";

interface CandidateState {
  activeClaims: IdentityClaim[];
  inactiveClaims: IdentityClaim[];
  conflicts: ResolutionConflict[];
}

function artifactState(artifact: RecoveryArtifact, asOf: string): CandidateState {
  if (artifact.kind === "ledger") {
    const resolved = resolveIdentity(artifact.snapshot, { asOf });
    return {
      activeClaims: resolved.activeClaims,
      inactiveClaims: resolved.inactiveClaims,
      conflicts: resolved.conflicts,
    };
  }
  const claims: IdentityClaim[] = [
    ...artifact.capsule.core.map((item) => ({
      id: item.claimId,
      identityId: artifact.capsule.identity.identityId,
      lineageId: artifact.capsule.identity.lineageId,
      layer: "core" as const,
      key: item.key,
      value: item.value,
      claimKind: item.claimKind,
      origin: "initial" as const,
      visibility: "capsule" as const,
      createdAt: artifact.capsule.generatedAt,
      evidenceIds: [...item.evidenceIds],
      ...(item.scope ? { scope: item.scope } : {}),
      stabilityProfile: "slow" as const,
      changePolicy: "accepted_evolution_required" as const,
    })),
    ...artifact.capsule.texture.map((item) => ({
      id: item.claimId,
      identityId: artifact.capsule.identity.identityId,
      lineageId: artifact.capsule.identity.lineageId,
      layer: "texture" as const,
      key: item.key,
      value: item.value,
      claimKind: item.claimKind,
      origin: "initial" as const,
      visibility: "capsule" as const,
      createdAt: artifact.capsule.generatedAt,
      evidenceIds: [...item.evidenceIds],
      ...(item.scope ? { scope: item.scope } : {}),
      stabilityProfile: "adaptive" as const,
      changePolicy: "accepted_evolution_required" as const,
    })),
  ];
  return { activeClaims: claims, inactiveClaims: [], conflicts: artifact.capsule.unresolvedConflicts };
}

function exactMatch(anchor: RecoveryAnchorRequirement, claim: IdentityClaim): boolean {
  return claim.id === anchor.claimId &&
    claim.key === anchor.key &&
    claim.layer === anchor.layer &&
    (claim.scope ?? "") === (anchor.scope ?? "") &&
    computeAnchorValueHash(claim.value) === anchor.valueHash;
}

function conflictTouches(anchor: RecoveryAnchorRequirement, conflicts: ResolutionConflict[]): boolean {
  return conflicts.some((conflict) => {
    if (conflict.kind === "claim") {
      return conflict.claimIds.includes(anchor.claimId) ||
        (conflict.key === anchor.key && conflict.layer === anchor.layer);
    }
    return false;
  });
}

function publicConflictClaimIds(
  anchor: RecoveryAnchorRequirement,
  state: CandidateState,
): string[] {
  const publicClaimIds = new Set(
    [...state.activeClaims, ...state.inactiveClaims]
      .filter((claim) => claim.visibility !== "private")
      .map((claim) => claim.id),
  );
  return [...new Set(state.conflicts.flatMap((conflict) => {
    if (conflict.kind !== "claim") return [];
    if (
      !conflict.claimIds.includes(anchor.claimId) &&
      !(conflict.key === anchor.key && conflict.layer === anchor.layer)
    ) return [];
    return conflict.claimIds.filter((claimId) => publicClaimIds.has(claimId));
  }))].sort();
}

function classifyAnchor(
  anchor: RecoveryAnchorRequirement,
  state: CandidateState,
  observationById: ReadonlyMap<string, RecoveryObservation>,
  asOf: string,
): RecoveryAnchorResult {
  const active = state.activeClaims.find((claim) => exactMatch(anchor, claim));
  const observation = anchor.availabilityObservationId
    ? observationById.get(anchor.availabilityObservationId)
    : undefined;
  if (active && observation?.status === "masked") {
    return { anchorId: anchor.anchorId, claimId: anchor.claimId, layer: anchor.layer, status: "masked", reasonCode: "policy_or_capability_mask" };
  }
  if (active && observation?.status === "unavailable") {
    return { anchorId: anchor.anchorId, claimId: anchor.claimId, layer: anchor.layer, status: "masked", reasonCode: "capability_unavailable" };
  }
  if (active) {
    return { anchorId: anchor.anchorId, claimId: anchor.claimId, layer: anchor.layer, status: "loaded", reasonCode: "exact_active_claim" };
  }
  if (conflictTouches(anchor, state.conflicts)) {
    const conflictClaimIds = publicConflictClaimIds(anchor, state);
    return {
      anchorId: anchor.anchorId,
      claimId: anchor.claimId,
      layer: anchor.layer,
      status: "conflicting",
      reasonCode: "resolved_identity_conflict",
      ...(conflictClaimIds.length > 0 ? { conflictClaimIds } : {}),
    };
  }
  const inactive = state.inactiveClaims.find((claim) => exactMatch(anchor, claim));
  if (inactive) {
    if (inactive.validUntil && Date.parse(asOf) >= Date.parse(inactive.validUntil)) {
      return { anchorId: anchor.anchorId, claimId: anchor.claimId, layer: anchor.layer, status: "expired", reasonCode: "claim_validity_ended" };
    }
    return { anchorId: anchor.anchorId, claimId: anchor.claimId, layer: anchor.layer, status: "stale", reasonCode: "claim_no_longer_active" };
  }
  if (anchor.visibility === "private") {
    return { anchorId: anchor.anchorId, claimId: anchor.claimId, layer: anchor.layer, status: "privacy_unavailable", reasonCode: "private_anchor_not_exported" };
  }
  return { anchorId: anchor.anchorId, claimId: anchor.claimId, layer: anchor.layer, status: "missing", reasonCode: "exact_claim_missing" };
}

function weightedCoverage(
  anchors: RecoveryAnchorRequirement[],
  results: RecoveryAnchorResult[],
): number {
  if (anchors.length === 0) return 0;
  const total = anchors.reduce((sum, anchor) => sum + anchor.weight, 0);
  const loadedIds = new Set(results.filter((item) => item.status === "loaded").map((item) => item.anchorId));
  return anchors.filter((anchor) => loadedIds.has(anchor.anchorId)).reduce((sum, anchor) => sum + anchor.weight, 0) / total;
}

function idsFor(results: RecoveryAnchorResult[], status: RecoveryAnchorStatus): string[] {
  return results.filter((item) => item.status === status).map((item) => item.anchorId).sort();
}

function freshness(
  bundle: RecoveryBundle,
): {
  stale: string[];
  unknown: string[];
  missing: string[];
  unavailable: string[];
  masked: string[];
  futureDated: string[];
} {
  const observationById = new Map(bundle.observations.map((item) => [item.observationId, item]));
  const stale: string[] = [];
  const unknown: string[] = [];
  const missing: string[] = [];
  const unavailable: string[] = [];
  const masked: string[] = [];
  const futureDated: string[] = [];
  const asOfMs = Date.parse(bundle.asOf);
  for (const policy of bundle.profile.freshnessPolicies) {
    if (!policy.freshnessRequired) continue;
    const observation = observationById.get(policy.observationId);
    if (!observation) {
      missing.push(policy.observationId);
      continue;
    }
    const observedInFuture = Date.parse(observation.observedAt) > asOfMs;
    if (observedInFuture) {
      futureDated.push(observation.observationId);
    }
    if (observation.status === "unavailable") {
      unavailable.push(observation.observationId);
    }
    if (observation.status === "masked") {
      masked.push(observation.observationId);
    }
    const validityExpired = observation.validUntil !== undefined &&
      asOfMs >= Date.parse(observation.validUntil);
    const maximumAgeExceeded = policy.maxAgeMs !== undefined &&
      asOfMs - Date.parse(observation.observedAt) > policy.maxAgeMs;
    if (validityExpired || maximumAgeExceeded) {
      stale.push(observation.observationId);
    }
    if (observation.validUntil === undefined && policy.maxAgeMs === undefined) {
      unknown.push(observation.observationId);
    }
  }
  const canonical = (items: string[]) => [...new Set(items)].sort();
  return {
    stale: canonical(stale),
    unknown: canonical(unknown),
    missing: canonical(missing),
    unavailable: canonical(unavailable),
    masked: canonical(masked),
    futureDated: canonical(futureDated),
  };
}

function sourceHashes(artifacts: RecoveryArtifact[]): string[] {
  return [...new Set(artifacts.map(getRecoveryArtifactStateHash))].sort();
}

function blockedReportBody(bundle: RecoveryBundle, reasons: string[]): RecoveryLoadReportBody {
  return {
    reportVersion: "0.3-slice1",
    profileId: bundle.profile.profileId,
    profileHash: bundle.profile.integrityHash,
    bundleHash: bundle.integrityHash,
    asOf: bundle.asOf,
    status: "blocked",
    sourceArtifactHashes: sourceHashes(bundle.artifacts),
    staleArtifactIds: [],
    rejectedArtifactIds: [],
    activeClaimIds: [],
    anchorResults: [],
    loadedAnchorIds: [],
    missingAnchorIds: [],
    staleAnchorIds: [],
    expiredAnchorIds: [],
    inactiveAnchorIds: [],
    conflictingAnchorIds: [],
    maskedAnchorIds: [],
    privacyUnavailableAnchorIds: [],
    staleObservationIds: [],
    unknownFreshnessObservationIds: [],
    missingFreshnessObservationIds: [],
    unavailableFreshnessObservationIds: [],
    maskedFreshnessObservationIds: [],
    futureDatedObservationIds: [],
    coreCoverage: 0,
    textureCoverage: 0,
    blockingReasons: reasons,
    indeterminateReasons: [],
    warnings: [],
  };
}

export function loadRecoveryAnchors(bundle: RecoveryBundle): RecoveryLoadReport {
  validateRecoveryBundle(bundle);
  const selection = selectRecoveryHead(bundle.artifacts, {
    expectedLineageId: bundle.profile.expectedLineageId,
    expectedTrustedHead: bundle.profile.expectedTrustedHead,
  });
  if (!selection.selectedArtifactId) {
    const body = blockedReportBody(bundle, selection.reasonCodes);
    body.staleArtifactIds = selection.staleArtifactIds;
    body.rejectedArtifactIds = selection.rejectedArtifactIds;
    return sealRecoveryLoadReport(body);
  }
  const selected = bundle.artifacts.find((item) => item.artifactId === selection.selectedArtifactId)!;
  const state = artifactState(selected, bundle.asOf);
  const observationById = new Map(bundle.observations.map((item) => [item.observationId, item]));
  const anchors = [...bundle.profile.requiredCoreAnchors, ...bundle.profile.textureAnchors];
  const anchorResults = anchors.map((item) => classifyAnchor(item, state, observationById, bundle.asOf));
  const coreResults = anchorResults.filter((item) => item.layer === "core");
  const textureResults = anchorResults.filter((item) => item.layer === "texture");
  const coreCoverage = weightedCoverage(bundle.profile.requiredCoreAnchors, coreResults);
  const textureCoverage = bundle.profile.textureAnchors.length === 0
    ? 1
    : weightedCoverage(bundle.profile.textureAnchors, textureResults);
  const blockingReasons: string[] = [];
  const indeterminateReasons: string[] = [];
  const coreBlockingStatuses = new Set<RecoveryAnchorStatus>([
    "missing", "stale", "expired", "inactive", "conflicting",
  ]);
  if (coreResults.some((item) => coreBlockingStatuses.has(item.status))) {
    blockingReasons.push("required_core_anchor_unavailable");
  }
  if (coreResults.some((item) => item.status === "masked" || item.status === "privacy_unavailable")) {
    indeterminateReasons.push("required_core_anchor_unobservable");
  }
  if (textureCoverage < bundle.profile.minimumTextureCoverage) {
    indeterminateReasons.push("texture_coverage_insufficient");
  }
  const observedFreshness = freshness(bundle);
  if (observedFreshness.stale.length > 0) indeterminateReasons.push("observation_stale");
  if (observedFreshness.unknown.length > 0) indeterminateReasons.push("observation_freshness_unknown");
  if (observedFreshness.missing.length > 0) {
    indeterminateReasons.push("required_freshness_observation_missing");
  }
  if (observedFreshness.unavailable.length > 0) {
    indeterminateReasons.push("required_freshness_observation_unavailable");
  }
  if (observedFreshness.masked.length > 0) {
    indeterminateReasons.push("required_freshness_observation_masked");
  }
  if (observedFreshness.futureDated.length > 0) {
    indeterminateReasons.push("observation_from_future");
  }
  const status = blockingReasons.length > 0
    ? "blocked"
    : indeterminateReasons.length > 0
      ? "indeterminate"
      : "ready";

  return sealRecoveryLoadReport({
    reportVersion: "0.3-slice1",
    profileId: bundle.profile.profileId,
    profileHash: bundle.profile.integrityHash,
    bundleHash: bundle.integrityHash,
    asOf: bundle.asOf,
    status,
    selectedArtifactId: selected.artifactId,
    ...(selection.selectedStateHash ? { selectedStateHash: selection.selectedStateHash } : {}),
    sourceArtifactHashes: sourceHashes(bundle.artifacts),
    staleArtifactIds: selection.staleArtifactIds,
    rejectedArtifactIds: selection.rejectedArtifactIds,
    activeClaimIds: state.activeClaims
      .filter((claim) => claim.visibility !== "private")
      .map((claim) => claim.id),
    anchorResults,
    loadedAnchorIds: idsFor(anchorResults, "loaded"),
    missingAnchorIds: idsFor(anchorResults, "missing"),
    staleAnchorIds: idsFor(anchorResults, "stale"),
    expiredAnchorIds: idsFor(anchorResults, "expired"),
    inactiveAnchorIds: idsFor(anchorResults, "inactive"),
    conflictingAnchorIds: idsFor(anchorResults, "conflicting"),
    maskedAnchorIds: idsFor(anchorResults, "masked"),
    privacyUnavailableAnchorIds: idsFor(anchorResults, "privacy_unavailable"),
    staleObservationIds: observedFreshness.stale,
    unknownFreshnessObservationIds: observedFreshness.unknown,
    missingFreshnessObservationIds: observedFreshness.missing,
    unavailableFreshnessObservationIds: observedFreshness.unavailable,
    maskedFreshnessObservationIds: observedFreshness.masked,
    futureDatedObservationIds: observedFreshness.futureDated,
    coreCoverage,
    textureCoverage,
    blockingReasons,
    indeterminateReasons,
    warnings: selection.reasonCodes,
  });
}
