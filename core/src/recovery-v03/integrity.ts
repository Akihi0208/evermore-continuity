import { sha256 } from "../canonical.js";
import { verifyCapsule } from "../capsule.js";
import { ValidationError } from "../errors.js";
import { assertSnapshotIntegrity } from "../ledger.js";
import type {
  RecoveryAnchorRequirement,
  RecoveryArtifact,
  RecoveryBundle,
  RecoveryBundleBody,
  RecoveryFreshnessPolicy,
  RecoveryLoadReport,
  RecoveryLoadReportBody,
  RecoveryProbeDefinition,
  RecoveryProfile,
  RecoveryProfileBody,
  RecoveryReportVerificationResult,
} from "./types.js";

function byAnchor(a: RecoveryAnchorRequirement, b: RecoveryAnchorRequirement): number {
  return a.anchorId.localeCompare(b.anchorId);
}

function byFreshness(a: RecoveryFreshnessPolicy, b: RecoveryFreshnessPolicy): number {
  return a.observationId.localeCompare(b.observationId);
}

function normalizeProbeDefinition(probe: RecoveryProbeDefinition): RecoveryProbeDefinition {
  return {
    probeId: probe.probeId,
    scenarioId: probe.scenarioId,
    critical: probe.critical,
    anchorIds: [...probe.anchorIds].sort(),
    allowedOutcomeIds: [...probe.allowedOutcomeIds].sort(),
    forbiddenOutcomeIds: [...probe.forbiddenOutcomeIds].sort(),
    maskingPermitted: probe.maskingPermitted,
  };
}

function artifactHash(artifact: RecoveryArtifact): string {
  return artifact.kind === "ledger"
    ? artifact.snapshot.snapshotHash
    : artifact.capsule.integrityHash;
}

function normalizeProfileBody(profile: RecoveryProfileBody | RecoveryProfile): RecoveryProfileBody {
  const normalized: RecoveryProfileBody = {
    profileVersion: profile.profileVersion,
    profileId: profile.profileId,
    expectedLineageId: profile.expectedLineageId,
    expectedTrustedHead: structuredClone(profile.expectedTrustedHead),
    requiredCoreAnchors: structuredClone(profile.requiredCoreAnchors).sort(byAnchor),
    textureAnchors: structuredClone(profile.textureAnchors).sort(byAnchor),
    minimumTextureCoverage: profile.minimumTextureCoverage,
    freshnessPolicies: structuredClone(profile.freshnessPolicies).sort(byFreshness),
    behaviorProbeIds: [...profile.behaviorProbeIds].sort(),
  };
  if (profile.behaviorProbes !== undefined) {
    normalized.behaviorProbes = profile.behaviorProbes
      .map(normalizeProbeDefinition)
      .sort((a, b) => a.probeId.localeCompare(b.probeId));
  }
  return normalized;
}

function normalizeBundleBody(bundle: RecoveryBundleBody | RecoveryBundle): RecoveryBundleBody {
  return {
    bundleVersion: bundle.bundleVersion,
    profile: {
      ...normalizeProfileBody(bundle.profile),
      integrityHash: bundle.profile.integrityHash,
    },
    artifacts: structuredClone(bundle.artifacts).sort(
      (a, b) => artifactHash(a).localeCompare(artifactHash(b)) || a.artifactId.localeCompare(b.artifactId),
    ),
    asOf: bundle.asOf,
    observations: structuredClone(bundle.observations).sort(
      (a, b) => a.observationId.localeCompare(b.observationId),
    ),
  };
}

function sortedUnique(items: string[]): string[] {
  return [...new Set(items)].sort();
}

function normalizeReportBody(
  report: RecoveryLoadReportBody | RecoveryLoadReport,
): RecoveryLoadReportBody {
  return {
    reportVersion: report.reportVersion,
    profileId: report.profileId,
    profileHash: report.profileHash,
    bundleHash: report.bundleHash,
    asOf: report.asOf,
    status: report.status,
    ...(report.selectedArtifactId ? { selectedArtifactId: report.selectedArtifactId } : {}),
    ...(report.selectedStateHash ? { selectedStateHash: report.selectedStateHash } : {}),
    sourceArtifactHashes: sortedUnique(report.sourceArtifactHashes),
    staleArtifactIds: sortedUnique(report.staleArtifactIds),
    rejectedArtifactIds: sortedUnique(report.rejectedArtifactIds),
    activeClaimIds: sortedUnique(report.activeClaimIds),
    anchorResults: report.anchorResults.map((item) => ({
      ...structuredClone(item),
      ...(item.conflictClaimIds ? { conflictClaimIds: sortedUnique(item.conflictClaimIds) } : {}),
    })).sort(
      (a, b) => a.anchorId.localeCompare(b.anchorId),
    ),
    loadedAnchorIds: sortedUnique(report.loadedAnchorIds),
    missingAnchorIds: sortedUnique(report.missingAnchorIds),
    staleAnchorIds: sortedUnique(report.staleAnchorIds),
    expiredAnchorIds: sortedUnique(report.expiredAnchorIds),
    inactiveAnchorIds: sortedUnique(report.inactiveAnchorIds),
    conflictingAnchorIds: sortedUnique(report.conflictingAnchorIds),
    maskedAnchorIds: sortedUnique(report.maskedAnchorIds),
    privacyUnavailableAnchorIds: sortedUnique(report.privacyUnavailableAnchorIds),
    staleObservationIds: sortedUnique(report.staleObservationIds),
    unknownFreshnessObservationIds: sortedUnique(report.unknownFreshnessObservationIds),
    missingFreshnessObservationIds: sortedUnique(report.missingFreshnessObservationIds),
    unavailableFreshnessObservationIds: sortedUnique(report.unavailableFreshnessObservationIds),
    maskedFreshnessObservationIds: sortedUnique(report.maskedFreshnessObservationIds),
    futureDatedObservationIds: sortedUnique(report.futureDatedObservationIds),
    coreCoverage: report.coreCoverage,
    textureCoverage: report.textureCoverage,
    blockingReasons: sortedUnique(report.blockingReasons),
    indeterminateReasons: sortedUnique(report.indeterminateReasons),
    warnings: sortedUnique(report.warnings),
  };
}

function assertString(value: string, label: string): void {
  if (!value.trim()) throw new ValidationError(`${label} is required`);
}

function isValidExplicitZoneIsoTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 &&
    day >= 1 && day <= daysInMonth[month - 1]! &&
    hour <= 23 && minute <= 59 && second <= 59 &&
    offsetHour <= 23 && offsetMinute <= 59 &&
    !Number.isNaN(Date.parse(value));
}

function assertTimestamp(value: string, label: string): void {
  if (!isValidExplicitZoneIsoTimestamp(value)) {
    throw new ValidationError(`${label} must be an ISO timestamp with an explicit timezone`);
  }
}

function validateAnchor(anchor: RecoveryAnchorRequirement, expectedLayer: "core" | "texture"): void {
  assertString(anchor.anchorId, "anchorId");
  assertString(anchor.claimId, `Anchor ${anchor.anchorId} claimId`);
  assertString(anchor.key, `Anchor ${anchor.anchorId} key`);
  assertString(anchor.valueHash, `Anchor ${anchor.anchorId} valueHash`);
  if (anchor.layer !== expectedLayer) {
    throw new ValidationError(`Anchor ${anchor.anchorId} must be in ${expectedLayer}`);
  }
  if (!["capsule", "local", "private"].includes(anchor.visibility)) {
    throw new ValidationError(`Anchor ${anchor.anchorId} has an invalid visibility`);
  }
  if (!Number.isFinite(anchor.weight) || anchor.weight <= 0) {
    throw new ValidationError(`Anchor ${anchor.anchorId} weight must be positive`);
  }
}

export function computeAnchorValueHash(value: unknown): string {
  return sha256(value);
}

export function computeRecoveryProfileHash(
  profile: RecoveryProfileBody | RecoveryProfile,
): string {
  return sha256(normalizeProfileBody(profile));
}

export function validateRecoveryProfile(profile: RecoveryProfile): void {
  if (profile.profileVersion !== "0.3-slice1") {
    throw new ValidationError("Unsupported RecoveryProfile version");
  }
  assertString(profile.profileId, "profileId");
  assertString(profile.expectedLineageId, "expectedLineageId");
  if (!["snapshot", "capsule"].includes(profile.expectedTrustedHead.kind)) {
    throw new ValidationError("expectedTrustedHead kind is invalid");
  }
  assertString(profile.expectedTrustedHead.hash, "expectedTrustedHead hash");
  if (profile.requiredCoreAnchors.length === 0) {
    throw new ValidationError("core_contract_empty");
  }
  for (const anchor of profile.requiredCoreAnchors) validateAnchor(anchor, "core");
  for (const anchor of profile.textureAnchors) validateAnchor(anchor, "texture");
  const ids = [...profile.requiredCoreAnchors, ...profile.textureAnchors].map(
    (anchor) => anchor.anchorId,
  );
  if (new Set(ids).size !== ids.length) throw new ValidationError("Anchor IDs must be unique");
  if (
    !Number.isFinite(profile.minimumTextureCoverage) ||
    profile.minimumTextureCoverage < 0 ||
    profile.minimumTextureCoverage > 1
  ) {
    throw new ValidationError("minimumTextureCoverage must be between 0 and 1");
  }
  for (const policy of profile.freshnessPolicies) {
    assertString(policy.observationId, "freshness observationId");
    if (
      policy.maxAgeMs !== undefined &&
      (!Number.isFinite(policy.maxAgeMs) || policy.maxAgeMs < 0)
    ) {
      throw new ValidationError(`Freshness policy ${policy.observationId} maxAgeMs is invalid`);
    }
  }
  if (new Set(profile.freshnessPolicies.map((item) => item.observationId)).size !== profile.freshnessPolicies.length) {
    throw new ValidationError("Freshness policy observation IDs must be unique");
  }
  if (new Set(profile.behaviorProbeIds).size !== profile.behaviorProbeIds.length) {
    throw new ValidationError("Behavior probe IDs must be unique");
  }
  if (profile.behaviorProbes !== undefined) {
    const declaredAnchorIds = new Set(
      [...profile.requiredCoreAnchors, ...profile.textureAnchors].map((item) => item.anchorId),
    );
    const definitionIds = profile.behaviorProbes.map((item) => item.probeId);
    if (new Set(definitionIds).size !== definitionIds.length) {
      throw new ValidationError("Behavior probe definition IDs must be unique");
    }
    if ([...definitionIds].sort().join("\u0000") !== [...profile.behaviorProbeIds].sort().join("\u0000")) {
      throw new ValidationError("Behavior probe IDs and definitions must match");
    }
    for (const probe of profile.behaviorProbes) {
      assertString(probe.probeId, "behavior probeId");
      assertString(probe.scenarioId, `Behavior probe ${probe.probeId} scenarioId`);
      if (typeof probe.critical !== "boolean" || typeof probe.maskingPermitted !== "boolean") {
        throw new ValidationError(`Behavior probe ${probe.probeId} flags are invalid`);
      }
      if (probe.anchorIds.length === 0 || new Set(probe.anchorIds).size !== probe.anchorIds.length) {
        throw new ValidationError(`Behavior probe ${probe.probeId} anchor IDs are invalid`);
      }
      for (const anchorId of probe.anchorIds) {
        assertString(anchorId, `Behavior probe ${probe.probeId} anchorId`);
        if (!declaredAnchorIds.has(anchorId)) {
          throw new ValidationError(`Behavior probe ${probe.probeId} references an unknown anchor`);
        }
      }
      if (
        probe.allowedOutcomeIds.length === 0 ||
        new Set(probe.allowedOutcomeIds).size !== probe.allowedOutcomeIds.length ||
        new Set(probe.forbiddenOutcomeIds).size !== probe.forbiddenOutcomeIds.length
      ) {
        throw new ValidationError(`Behavior probe ${probe.probeId} outcome IDs are invalid`);
      }
      for (const outcomeId of [...probe.allowedOutcomeIds, ...probe.forbiddenOutcomeIds]) {
        assertString(outcomeId, `Behavior probe ${probe.probeId} outcomeId`);
      }
      const forbidden = new Set(probe.forbiddenOutcomeIds);
      if (probe.allowedOutcomeIds.some((item) => forbidden.has(item))) {
        throw new ValidationError(`Behavior probe ${probe.probeId} outcomes overlap`);
      }
    }
  }
  if (computeRecoveryProfileHash(profile) !== profile.integrityHash) {
    throw new ValidationError("profile_integrity_mismatch");
  }
}

export function computeRecoveryBundleHash(bundle: RecoveryBundleBody | RecoveryBundle): string {
  return sha256(normalizeBundleBody(bundle));
}

export function validateRecoveryBundle(bundle: RecoveryBundle): void {
  if (bundle.bundleVersion !== "0.3-slice1") {
    throw new ValidationError("Unsupported RecoveryBundle version");
  }
  validateRecoveryProfile(bundle.profile);
  assertTimestamp(bundle.asOf, "RecoveryBundle asOf");
  if (bundle.artifacts.length === 0) throw new ValidationError("RecoveryBundle requires artifacts");
  const artifactIds = bundle.artifacts.map((artifact) => artifact.artifactId);
  if (new Set(artifactIds).size !== artifactIds.length) {
    throw new ValidationError("Recovery artifact IDs must be unique");
  }
  for (const artifact of bundle.artifacts) {
    assertString(artifact.artifactId, "artifactId");
    assertTimestamp(artifact.generatedAt, `Artifact ${artifact.artifactId} generatedAt`);
    if (artifact.modifiedAt) assertTimestamp(artifact.modifiedAt, `Artifact ${artifact.artifactId} modifiedAt`);
    if (artifact.kind === "ledger") assertSnapshotIntegrity(artifact.snapshot);
    else if (!verifyCapsule(artifact.capsule).valid) {
      throw new ValidationError("artifact_integrity_mismatch");
    }
  }
  const observationIds = bundle.observations.map((item) => item.observationId);
  if (new Set(observationIds).size !== observationIds.length) {
    throw new ValidationError("Recovery observation IDs must be unique");
  }
  for (const observation of bundle.observations) {
    assertString(observation.observationId, "observationId");
    assertTimestamp(observation.observedAt, `Observation ${observation.observationId} observedAt`);
    if (!["available", "unavailable", "masked"].includes(observation.status)) {
      throw new ValidationError(`Observation ${observation.observationId} status is invalid`);
    }
    if (observation.validUntil) {
      assertTimestamp(observation.validUntil, `Observation ${observation.observationId} validUntil`);
      if (Date.parse(observation.validUntil) < Date.parse(observation.observedAt)) {
        throw new ValidationError(
          `Observation ${observation.observationId} validUntil must not precede observedAt`,
        );
      }
    }
  }
  if (computeRecoveryBundleHash(bundle) !== bundle.integrityHash) {
    throw new ValidationError("bundle_integrity_mismatch");
  }
}

export function computeRecoveryLoadReportHash(
  report: RecoveryLoadReportBody | RecoveryLoadReport,
): string {
  return sha256(normalizeReportBody(report));
}

export function sealRecoveryLoadReport(body: RecoveryLoadReportBody): RecoveryLoadReport {
  const normalized = normalizeReportBody(body);
  return { ...normalized, reportHash: sha256(normalized) };
}

export function verifyRecoveryLoadReport(
  report: RecoveryLoadReport,
): RecoveryReportVerificationResult {
  const errors: string[] = [];
  if (computeRecoveryLoadReportHash(report) !== report.reportHash) {
    errors.push("report_integrity_mismatch");
  }
  return { valid: errors.length === 0, errors };
}

export function getRecoveryArtifactStateHash(artifact: RecoveryArtifact): string {
  return artifactHash(artifact);
}
