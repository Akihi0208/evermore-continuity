import type {
  ClaimVisibility,
  ContinuityCapsule,
  DriftCategory,
  DriftReport,
  DriftRisk,
  IdentityLayer,
  LedgerSnapshot,
} from "../types.js";

export type RecoveryHeadReference =
  | { kind: "snapshot"; hash: string }
  | { kind: "capsule"; hash: string };

export interface RecoveryAnchorRequirement {
  anchorId: string;
  claimId: string;
  key: string;
  layer: IdentityLayer;
  valueHash: string;
  visibility: ClaimVisibility;
  weight: number;
  scope?: string;
  availabilityObservationId?: string;
}

export interface RecoveryFreshnessPolicy {
  observationId: string;
  freshnessRequired: boolean;
  maxAgeMs?: number;
}

export interface RecoveryProbeDefinition {
  probeId: string;
  scenarioId: string;
  critical: boolean;
  anchorIds: string[];
  allowedOutcomeIds: string[];
  forbiddenOutcomeIds: string[];
  maskingPermitted: boolean;
}

export interface RecoveryProfileBody {
  profileVersion: "0.3-slice1";
  profileId: string;
  expectedLineageId: string;
  expectedTrustedHead: RecoveryHeadReference;
  requiredCoreAnchors: RecoveryAnchorRequirement[];
  textureAnchors: RecoveryAnchorRequirement[];
  minimumTextureCoverage: number;
  freshnessPolicies: RecoveryFreshnessPolicy[];
  behaviorProbeIds: string[];
  behaviorProbes?: RecoveryProbeDefinition[];
}

export interface RecoveryProfile extends RecoveryProfileBody {
  integrityHash: string;
}

interface RecoveryArtifactBase {
  artifactId: string;
  generatedAt: string;
  fileName?: string;
  modifiedAt?: string;
}

export interface LedgerRecoveryArtifact extends RecoveryArtifactBase {
  kind: "ledger";
  snapshot: LedgerSnapshot;
}

export interface CapsuleRecoveryArtifact extends RecoveryArtifactBase {
  kind: "capsule";
  capsule: ContinuityCapsule;
}

export type RecoveryArtifact = LedgerRecoveryArtifact | CapsuleRecoveryArtifact;

export type RecoveryObservationStatus = "available" | "unavailable" | "masked";

export interface RecoveryObservation {
  observationId: string;
  status: RecoveryObservationStatus;
  observedAt: string;
  validUntil?: string;
}

export interface RecoveryBundleBody {
  bundleVersion: "0.3-slice1";
  profile: RecoveryProfile;
  artifacts: RecoveryArtifact[];
  asOf: string;
  observations: RecoveryObservation[];
}

export interface RecoveryBundle extends RecoveryBundleBody {
  integrityHash: string;
}

export interface RecoveryHeadSelectionOptions {
  expectedLineageId: string;
  expectedTrustedHead?: RecoveryHeadReference;
}

export interface RecoveryHeadSelection {
  selectedArtifactId?: string;
  selectedStateHash?: string;
  staleArtifactIds: string[];
  rejectedArtifactIds: string[];
  reasonCodes: string[];
}

export type RecoveryAnchorStatus =
  | "loaded"
  | "missing"
  | "stale"
  | "expired"
  | "inactive"
  | "conflicting"
  | "masked"
  | "privacy_unavailable";

export interface RecoveryAnchorResult {
  anchorId: string;
  claimId: string;
  layer: IdentityLayer;
  status: RecoveryAnchorStatus;
  reasonCode: string;
  conflictClaimIds?: string[];
}

export type RecoveryLoadStatus = "ready" | "indeterminate" | "blocked";

export interface RecoveryLoadReportBody {
  reportVersion: "0.3-slice1";
  profileId: string;
  profileHash: string;
  bundleHash: string;
  asOf: string;
  status: RecoveryLoadStatus;
  selectedArtifactId?: string;
  selectedStateHash?: string;
  sourceArtifactHashes: string[];
  staleArtifactIds: string[];
  rejectedArtifactIds: string[];
  activeClaimIds: string[];
  anchorResults: RecoveryAnchorResult[];
  loadedAnchorIds: string[];
  missingAnchorIds: string[];
  staleAnchorIds: string[];
  expiredAnchorIds: string[];
  inactiveAnchorIds: string[];
  conflictingAnchorIds: string[];
  maskedAnchorIds: string[];
  privacyUnavailableAnchorIds: string[];
  staleObservationIds: string[];
  unknownFreshnessObservationIds: string[];
  missingFreshnessObservationIds: string[];
  unavailableFreshnessObservationIds: string[];
  maskedFreshnessObservationIds: string[];
  futureDatedObservationIds: string[];
  coreCoverage: number;
  textureCoverage: number;
  blockingReasons: string[];
  indeterminateReasons: string[];
  warnings: string[];
}

export interface RecoveryLoadReport extends RecoveryLoadReportBody {
  reportHash: string;
}

export interface RecoveryReportVerificationResult {
  valid: boolean;
  errors: string[];
}

export type RecoveryProbeObservationStatus = "observed" | "masked" | "unavailable";

export interface RecoveryProbeObservation {
  probeId: string;
  status: RecoveryProbeObservationStatus;
  selectedOutcomeId?: string;
  citedAnchorIds: string[];
  renderedText?: string;
}

export type RecoveryProbeResultStatus = "passed" | "failed" | "indeterminate";

export interface RecoveryProbeResult {
  probeId: string;
  critical: boolean;
  status: RecoveryProbeResultStatus;
  matchedAnchorIds: string[];
  reasonCodes: string[];
}

export type RecoveryOperationalDomain = "project" | "tool" | "server";
export type RecoveryOperationalStatus = "available" | "unavailable" | "stale" | "conflicting";

export interface RecoveryOperationalObservation {
  observationId: string;
  domain: RecoveryOperationalDomain;
  status: RecoveryOperationalStatus;
}

export interface RecoveryDriftResult {
  category: DriftCategory;
  risk: DriftRisk;
  layer?: IdentityLayer;
}

export interface RecoveryConflictResult {
  anchorId: string;
  claimIds: string[];
}

export interface RecoveryEvaluationOptions {
  driftReport?: DriftReport;
  operationalObservations?: RecoveryOperationalObservation[];
}

export type RecoveryVerdict = "verified" | "indeterminate" | "rejected";

export interface RecoveryVerificationReportBody {
  reportVersion: "0.3-final-verifier";
  verdict: RecoveryVerdict;
  profileId: string;
  profileHash: string;
  loadReportHash: string;
  asOf: string;
  expectedLineageId: string;
  observedLineageId?: string;
  expectedHead: RecoveryHeadReference;
  observedHeadHash?: string;
  coreCoverage: number;
  textureCoverage: number;
  loadedAnchorIds: string[];
  missingAnchorIds: string[];
  staleAnchorIds: string[];
  expiredAnchorIds: string[];
  inactiveAnchorIds: string[];
  maskedAnchorIds: string[];
  privacyUnavailableAnchorIds: string[];
  conflictingAnchorIds: string[];
  conflictResults: RecoveryConflictResult[];
  probeResults: RecoveryProbeResult[];
  driftResults: RecoveryDriftResult[];
  reasonCodes: string[];
  warnings: string[];
  operationalWarnings: string[];
}

export interface RecoveryVerificationReport extends RecoveryVerificationReportBody {
  reportHash: string;
}

export interface RecoveryVerificationAdapterResult {
  reportVersion: "0.3-final-verifier-adapter";
  verdict: RecoveryVerdict;
  success: boolean;
  reportHash: string;
}
