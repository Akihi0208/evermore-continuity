import type { EvidenceKind, EvidenceRecord, IdentityClaim } from "./types.js";
import { ValidationError } from "./errors.js";

const FACT_CAPABLE_EVIDENCE = new Set<EvidenceKind>([
  "direct_observation",
  "external_source",
]);

function assertConfidence(confidence: number): void {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new ValidationError("Evidence confidence must be between 0 and 1");
  }
}

export function validateEvidence(record: EvidenceRecord): void {
  if (!record.id.trim()) throw new ValidationError("Evidence id is required");
  if (!record.sourceId.trim()) throw new ValidationError("Evidence sourceId is required");
  if (Number.isNaN(Date.parse(record.createdAt))) {
    throw new ValidationError(`Evidence ${record.id} has an invalid createdAt timestamp`);
  }
  assertConfidence(record.confidence);
}

export function validateClaimProvenance(
  claim: IdentityClaim,
  evidenceById: ReadonlyMap<string, EvidenceRecord>,
): void {
  if (claim.evidenceIds.length === 0) {
    throw new ValidationError(`Claim ${claim.id} must cite at least one evidence record`);
  }

  const evidence = claim.evidenceIds.map((id) => {
    const record = evidenceById.get(id);
    if (!record) throw new ValidationError(`Claim ${claim.id} references missing evidence ${id}`);
    return record;
  });

  if (claim.claimKind === "fact") {
    const supported = evidence.some(
      (record) => record.verified && FACT_CAPABLE_EVIDENCE.has(record.evidenceKind),
    );
    if (!supported) {
      throw new ValidationError(
        `Fact claim ${claim.id} requires verified direct-observation or external-source evidence`,
      );
    }
  }
}

export const DEFAULT_PROVENANCE_RULES = [
  "Evidence kind records how information is known; claim kind records what is asserted.",
  "Inference and hypothesis evidence never become fact without verified fact-capable evidence.",
  "Superseded evidence remains traceable through immutable history.",
  "Identity evolution is active only while its self-acceptance revision chain resolves unambiguously to accepted.",
] as const;
