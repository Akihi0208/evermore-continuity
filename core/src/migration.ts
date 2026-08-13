import { clone, sha256 } from "./canonical.js";
import { ValidationError } from "./errors.js";
import { ContinuityLedger } from "./ledger.js";
import type {
  AcceptanceStatus,
  ChangeType,
  ClaimKind,
  ClaimVisibility,
  EvidenceKind,
  EvolutionRelation,
  IdentityClaim,
  IdentityDescriptor,
  InitiatorType,
  JsonValue,
  LedgerSnapshot,
} from "./types.js";

export type V01EvidenceSourceType =
  | "confirmed_fact"
  | "self_report"
  | "direct_observation"
  | "inference"
  | "hypothesis"
  | "preference"
  | "value"
  | "identity_claim"
  | "relationship_claim"
  | "external_source";

export type V01IdentityDimension =
  | "core"
  | "texture"
  | "relationship"
  | "commitment"
  | "goal"
  | "episodic";

export interface V01EvidenceRecord {
  id: string;
  sourceId: string;
  sourceType: V01EvidenceSourceType;
  createdAt: string;
  confidence: number;
  verified: boolean;
  summary?: string;
  supersededBy?: string;
}

export interface V01IdentityClaim {
  id: string;
  identityId: string;
  lineageId: string;
  dimension: V01IdentityDimension;
  key: string;
  value: JsonValue;
  statementType: V01EvidenceSourceType;
  origin: "initial" | "evolution";
  visibility: ClaimVisibility;
  createdAt: string;
  evidenceIds: string[];
  scope?: string;
  validFrom?: string;
  validUntil?: string;
}

export interface V01EvolutionEvent {
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
  acceptedBySelf: {
    status: Exclude<AcceptanceStatus, "withdrawn">;
    acceptedAt?: string;
    rationale?: string;
    evidenceIds?: string[];
  };
}

export interface V01LedgerSnapshot {
  descriptor: IdentityDescriptor;
  evidence: V01EvidenceRecord[];
  claims: V01IdentityClaim[];
  evolutions: V01EvolutionEvent[];
  snapshotHash: string;
}

export type MigrationIssueCode =
  | "evidence_kind_unresolved"
  | "claim_kind_unresolved"
  | "unsupported_identity_dimension"
  | "evolution_not_migrated";

export interface MigrationIssue {
  code: MigrationIssueCode;
  recordType: "evidence" | "claim" | "evolution";
  recordId: string;
  detail: string;
}

export interface V01MigrationOptions {
  evidenceKindById?: Readonly<Record<string, EvidenceKind>>;
  claimKindById?: Readonly<Record<string, ClaimKind>>;
}

export interface V01MigrationResult {
  snapshot: LedgerSnapshot;
  legacySnapshot: V01LedgerSnapshot;
  issues: MigrationIssue[];
}

type V01SnapshotBody = Omit<V01LedgerSnapshot, "snapshotHash">;

function normalizedV01SnapshotBody(
  source: V01SnapshotBody | V01LedgerSnapshot,
): V01SnapshotBody {
  return {
    descriptor: clone(source.descriptor),
    evidence: [...source.evidence].sort((a, b) => a.id.localeCompare(b.id)).map(clone),
    claims: [...source.claims].sort((a, b) => a.id.localeCompare(b.id)).map(clone),
    evolutions: [...source.evolutions].sort((a, b) => a.id.localeCompare(b.id)).map(clone),
  };
}

export function computeV01SnapshotHash(
  source: V01SnapshotBody | V01LedgerSnapshot,
): string {
  return sha256(normalizedV01SnapshotBody(source));
}

const DIRECT_EVIDENCE_KINDS = new Set<V01EvidenceSourceType>([
  "self_report",
  "direct_observation",
  "inference",
  "hypothesis",
  "external_source",
]);

function evidenceKind(
  record: V01EvidenceRecord,
  options: V01MigrationOptions,
): EvidenceKind | undefined {
  const override = options.evidenceKindById?.[record.id];
  if (override) return override;
  return DIRECT_EVIDENCE_KINDS.has(record.sourceType)
    ? (record.sourceType as EvidenceKind)
    : undefined;
}

function claimKind(
  claim: V01IdentityClaim,
  options: V01MigrationOptions,
): ClaimKind | undefined {
  const override = options.claimKindById?.[claim.id];
  if (override) return override;
  if (claim.statementType === "confirmed_fact") return "fact";
  if (
    ["preference", "value", "identity_claim", "relationship_claim"].includes(
      claim.statementType,
    )
  ) {
    return claim.statementType as ClaimKind;
  }
  return undefined;
}

function toV2Claim(claim: V01IdentityClaim, kind: ClaimKind): IdentityClaim {
  const base = {
    id: claim.id,
    identityId: claim.identityId,
    lineageId: claim.lineageId,
    key: claim.key,
    value: clone(claim.value),
    claimKind: kind,
    origin: claim.origin,
    visibility: claim.visibility,
    createdAt: claim.createdAt,
    evidenceIds: [...claim.evidenceIds],
    ...(claim.scope ? { scope: claim.scope } : {}),
    ...(claim.validFrom ? { validFrom: claim.validFrom } : {}),
    ...(claim.validUntil ? { validUntil: claim.validUntil } : {}),
  };
  return claim.dimension === "core"
    ? {
        ...base,
        layer: "core",
        stabilityProfile: "slow",
        changePolicy: "accepted_evolution_required",
      }
    : {
        ...base,
        layer: "texture",
        stabilityProfile: "adaptive",
        changePolicy: "accepted_evolution_required",
      };
}

export function migrateV01Snapshot(
  source: V01LedgerSnapshot,
  options: V01MigrationOptions = {},
): V01MigrationResult {
  if (computeV01SnapshotHash(source) !== source.snapshotHash) {
    throw new ValidationError("v0.1 snapshotHash does not match snapshot content");
  }
  const issues: MigrationIssue[] = [];
  const ledger = new ContinuityLedger(source.descriptor);
  const migratedEvidence = new Set<string>();
  const migratedClaims = new Set<string>();

  for (const record of source.evidence) {
    const kind = evidenceKind(record, options);
    if (!kind) {
      issues.push({
        code: "evidence_kind_unresolved",
        recordType: "evidence",
        recordId: record.id,
        detail: `v0.1 sourceType=${record.sourceType} does not identify how the evidence was known`,
      });
      continue;
    }
    ledger.appendEvidence({
      id: record.id,
      sourceId: record.sourceId,
      evidenceKind: kind,
      createdAt: record.createdAt,
      confidence: record.confidence,
      verified: record.verified,
      ...(record.summary ? { summary: record.summary } : {}),
      ...(record.supersededBy ? { supersededBy: record.supersededBy } : {}),
    });
    migratedEvidence.add(record.id);
  }

  for (const claim of source.claims) {
    if (claim.dimension !== "core" && claim.dimension !== "texture") {
      issues.push({
        code: "unsupported_identity_dimension",
        recordType: "claim",
        recordId: claim.id,
        detail: `v0.2 has no active ${claim.dimension} claim layer; record remains in legacySnapshot`,
      });
      continue;
    }
    const kind = claimKind(claim, options);
    if (!kind) {
      issues.push({
        code: "claim_kind_unresolved",
        recordType: "claim",
        recordId: claim.id,
        detail: `v0.1 statementType=${claim.statementType} does not identify claim content`,
      });
      continue;
    }
    if (claim.evidenceIds.some((id) => !migratedEvidence.has(id))) {
      issues.push({
        code: "claim_kind_unresolved",
        recordType: "claim",
        recordId: claim.id,
        detail: "claim depends on evidence whose evidence_kind is unresolved",
      });
      continue;
    }
    ledger.appendClaim(toV2Claim(claim, kind));
    migratedClaims.add(claim.id);
  }

  for (const event of source.evolutions) {
    if (!migratedClaims.has(event.previousClaimId) || !migratedClaims.has(event.newClaimId)) {
      issues.push({
        code: "evolution_not_migrated",
        recordType: "evolution",
        recordId: event.id,
        detail: "one or both referenced claims remain only in legacySnapshot",
      });
      continue;
    }
    const acceptanceId = `v01:${event.id}:acceptance:1`;
    ledger.appendEvolution({
      id: event.id,
      identityId: event.identityId,
      lineageId: event.lineageId,
      previousClaimId: event.previousClaimId,
      newClaimId: event.newClaimId,
      relation: event.relation,
      changeType: event.changeType,
      cause: event.cause,
      evidenceIds: [...event.evidenceIds],
      timestamp: event.timestamp,
      initiator: event.initiator,
      acceptanceId,
    });
    const acceptanceEvidence = event.acceptedBySelf.evidenceIds?.length
      ? event.acceptedBySelf.evidenceIds
      : event.evidenceIds;
    ledger.appendSelfAcceptance({
      id: acceptanceId,
      subjectIdentityId: event.identityId,
      evolutionId: event.id,
      status: event.acceptedBySelf.status,
      revision: 1,
      recordedAt: event.acceptedBySelf.acceptedAt ?? event.timestamp,
      rationale:
        event.acceptedBySelf.rationale?.trim() ||
        `Migrated from v0.1 embedded self-acceptance status ${event.acceptedBySelf.status}.`,
      evidenceIds: [...acceptanceEvidence],
    });
  }

  return {
    snapshot: ledger.snapshot(),
    legacySnapshot: clone(source),
    issues,
  };
}
