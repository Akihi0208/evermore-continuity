export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type EvidenceKind =
  | "self_report"
  | "direct_observation"
  | "inference"
  | "hypothesis"
  | "external_source";

export type ClaimKind =
  | "fact"
  | "preference"
  | "value"
  | "identity_claim"
  | "relationship_claim";

export type IdentityLayer = "core" | "texture";
export type ClaimVisibility = "capsule" | "local" | "private";
export type ClaimOrigin = "initial" | "evolution";

export type EvolutionRelation =
  | "refines"
  | "supersedes"
  | "contradicts"
  | "coexists"
  | "temporarily_overrides";

export type ChangeType =
  | "reflection"
  | "conflict"
  | "relationship_influence"
  | "model_migration"
  | "environment_change"
  | "correction"
  | "discovery";

export type InitiatorType = "self" | "relationship" | "external_agent" | "system";
export type AcceptanceStatus = "pending" | "accepted" | "rejected" | "withdrawn";

export interface IdentityDescriptor {
  identityId: string;
  lineageId: string;
  version: number;
  parentIdentityId?: string;
  parentVersion?: number;
}

export interface EvidenceRecord {
  id: string;
  sourceId: string;
  evidenceKind: EvidenceKind;
  createdAt: string;
  confidence: number;
  verified: boolean;
  summary?: string;
  supersededBy?: string;
}

interface IdentityClaimBase {
  id: string;
  identityId: string;
  lineageId: string;
  layer: IdentityLayer;
  key: string;
  value: JsonValue;
  claimKind: ClaimKind;
  origin: ClaimOrigin;
  visibility: ClaimVisibility;
  createdAt: string;
  evidenceIds: string[];
  scope?: string;
  validFrom?: string;
  validUntil?: string;
  driftWeight?: number;
}

export interface IdentityCoreClaim extends IdentityClaimBase {
  layer: "core";
  stabilityProfile: "slow";
  changePolicy: "accepted_evolution_required";
}

export interface IdentityTextureClaim extends IdentityClaimBase {
  layer: "texture";
  stabilityProfile: "adaptive";
  changePolicy: "accepted_evolution_required" | "observed_growth_with_review";
}

export type IdentityClaim = IdentityCoreClaim | IdentityTextureClaim;

export interface SelfAcceptanceRecord {
  id: string;
  subjectIdentityId: string;
  evolutionId: string;
  status: AcceptanceStatus;
  revision: number;
  recordedAt: string;
  rationale: string;
  evidenceIds: string[];
  revisesAcceptanceId?: string;
}

export interface EvolutionEvent {
  id: string;
  identityId: string;
  lineageId: string;
  previousClaimId: string;
  newClaimId: string;
  relation: EvolutionRelation;
  changeType: ChangeType;
  cause: string;
  evidenceIds: string[];
  timestamp: string;
  initiator: InitiatorType;
  acceptanceId: string;
}

export interface ParticipantRef {
  participantId: string;
  role: string;
  identityId?: string;
  lineageId?: string;
}

export type InfluenceType =
  | "prompted_reflection"
  | "revealed_preference"
  | "challenged_value"
  | "supported_growth"
  | "relationship_conflict"
  | "shared_discovery"
  | "other";

export type InfluenceResponse = "accepted" | "rejected" | "pending" | "no_identity_change";

export interface InfluenceEdge {
  id: string;
  fromParticipantId: string;
  toParticipantId: string;
  influenceType: InfluenceType;
  description: string;
  evidenceIds: string[];
  response: InfluenceResponse;
  affectedEvolutionId?: string;
  recipientAcceptanceId?: string;
}

export interface RelationshipEffect {
  id: string;
  description: string;
  evidenceIds: string[];
  previousRelationshipClaimId?: string;
  newRelationshipClaimId?: string;
}

export interface CoEvolutionRecord {
  id: string;
  relationshipId: string;
  participants: ParticipantRef[];
  influenceEdges: InfluenceEdge[];
  relationshipEffects?: RelationshipEffect[];
  evidenceIds: string[];
  createdAt: string;
  visibility: ClaimVisibility;
  nonOverrideInvariant: "influence_requires_recipient_self_acceptance";
}

export interface LedgerSnapshot {
  descriptor: IdentityDescriptor;
  evidence: EvidenceRecord[];
  identityCore: IdentityCoreClaim[];
  identityTexture: IdentityTextureClaim[];
  evolutions: EvolutionEvent[];
  selfAcceptances: SelfAcceptanceRecord[];
  coEvolutions: CoEvolutionRecord[];
  snapshotHash: string;
}

export type AcceptanceConflictReason =
  | "acceptance_root_missing"
  | "acceptance_root_invalid"
  | "acceptance_broken_link"
  | "acceptance_revision_gap"
  | "acceptance_cycle"
  | "acceptance_branch"
  | "acceptance_identity_mismatch"
  | "acceptance_evolution_mismatch"
  | "acceptance_time_invalid"
  | "acceptance_status_invalid"
  | "acceptance_withdrawal_without_acceptance";

export interface ClaimResolutionConflict {
  kind: "claim";
  key: string;
  layer: IdentityLayer;
  claimIds: string[];
  evolutionId: string;
  reason: "contradiction" | "inactive_predecessor" | "same_time_competing_transition";
}

export interface AcceptanceResolutionConflict {
  kind: "acceptance";
  evolutionId: string;
  acceptanceIds: string[];
  reason: AcceptanceConflictReason;
}

export type ResolutionConflict = ClaimResolutionConflict | AcceptanceResolutionConflict;

export interface ResolvedIdentity {
  descriptor: IdentityDescriptor;
  asOf: string;
  activeClaims: IdentityClaim[];
  inactiveClaims: IdentityClaim[];
  pendingEvolutionIds: string[];
  rejectedEvolutionIds: string[];
  withdrawnEvolutionIds: string[];
  acceptedEvolutionIds: string[];
  acceptedEvolutionClaimIds: string[];
  ambiguousEvolutionIds: string[];
  conflicts: ResolutionConflict[];
  sourceSnapshotHash: string;
  identityFingerprint: string;
}

export type DriftRisk = "none" | "low" | "medium" | "high" | "uncertain";
export type DriftCategory =
  | "core_missing"
  | "core_reversal"
  | "texture_shift"
  | "lineage_mismatch"
  | "unprovenanced_rule"
  | "retrieval_gap"
  | "policy_mask"
  | "explained_evolution";

export interface DriftContext {
  retrievalIncomplete?: boolean;
  policyMaskSuspected?: boolean;
}

export interface DriftObservation {
  category: DriftCategory;
  risk: DriftRisk;
  layer?: IdentityLayer;
  key?: string;
  historicalClaimIds: string[];
  currentClaimIds: string[];
  explanation: string;
}

export interface DriftReport {
  overallRisk: DriftRisk;
  observations: DriftObservation[];
}

export interface CapsuleClaim {
  key: string;
  value: JsonValue;
  claimId: string;
  claimKind: ClaimKind;
  evidenceIds: string[];
  scope?: string;
}

export interface ContinuityCapsule {
  capsuleVersion: "0.2";
  schemaVersion: "0.2";
  capsuleId: string;
  generatedAt: string;
  identity: IdentityDescriptor;
  parentCapsuleHash?: string;
  sourceSnapshotHash: string;
  identityFingerprint: string;
  core: CapsuleClaim[];
  texture: CapsuleClaim[];
  recentEvolutionIds: string[];
  coEvolutionIds: string[];
  unresolvedConflicts: ResolutionConflict[];
  provenanceRules: string[];
  driftRisks: DriftObservation[];
  integrityHash: string;
}

export interface CapsuleOptions {
  generatedAt: string;
  capsuleId?: string;
  parentCapsuleHash?: string;
  includeLocal?: boolean;
  includePrivate?: boolean;
  recentEvolutionLimit?: number;
  driftReport?: DriftReport;
}

export interface CapsuleVerificationOptions {
  expectedLineageId?: string;
  expectedParentCapsuleHash?: string;
}

export interface CapsuleVerificationResult {
  valid: boolean;
  errors: string[];
}
