import { clone, sha256 } from "./canonical.js";
import { isAcceptanceStatus } from "./acceptance-status.js";
import { DuplicateRecordError, ValidationError } from "./errors.js";
import { validateClaimProvenance, validateEvidence } from "./provenance.js";
function assertTimestamp(value, label) {
    if (Number.isNaN(Date.parse(value)))
        throw new ValidationError(`${label} must be an ISO timestamp`);
}
function sortById(items) {
    return [...items].sort((a, b) => a.id.localeCompare(b.id));
}
function normalizedSnapshotBody(snapshot) {
    return {
        descriptor: clone(snapshot.descriptor),
        evidence: sortById(snapshot.evidence).map(clone),
        identityCore: sortById(snapshot.identityCore).map(clone),
        identityTexture: sortById(snapshot.identityTexture).map(clone),
        evolutions: sortById(snapshot.evolutions).map(clone),
        selfAcceptances: sortById(snapshot.selfAcceptances).map(clone),
        coEvolutions: sortById(snapshot.coEvolutions).map(clone),
    };
}
export function computeSnapshotHash(snapshot) {
    return sha256(normalizedSnapshotBody(snapshot));
}
export function assertSnapshotIntegrity(snapshot) {
    const actual = computeSnapshotHash(snapshot);
    if (actual !== snapshot.snapshotHash) {
        throw new ValidationError("Ledger snapshotHash does not match snapshot content");
    }
}
export class ContinuityLedger {
    descriptor;
    #evidence = new Map();
    #core = new Map();
    #texture = new Map();
    #evolutions = new Map();
    #selfAcceptances = new Map();
    #coEvolutions = new Map();
    #evolutionTargets = new Set();
    constructor(descriptor) {
        if (!descriptor.identityId.trim())
            throw new ValidationError("identityId is required");
        if (!descriptor.lineageId.trim())
            throw new ValidationError("lineageId is required");
        if (!Number.isInteger(descriptor.version) || descriptor.version < 1) {
            throw new ValidationError("identity version must be a positive integer");
        }
        this.descriptor = clone(descriptor);
    }
    appendEvidence(record) {
        if (this.#evidence.has(record.id))
            throw new DuplicateRecordError("Evidence", record.id);
        validateEvidence(record);
        this.#evidence.set(record.id, clone(record));
        return this;
    }
    appendClaim(claim) {
        const claimId = claim.id;
        if (this.#claimById(claim.id))
            throw new DuplicateRecordError("Claim", claim.id);
        this.#assertIdentity(claim.identityId, claim.lineageId, `Claim ${claim.id}`);
        if (!claim.key.trim())
            throw new ValidationError(`Claim ${claim.id} requires a key`);
        assertTimestamp(claim.createdAt, `Claim ${claim.id} createdAt`);
        if (claim.validFrom)
            assertTimestamp(claim.validFrom, `Claim ${claim.id} validFrom`);
        if (claim.validUntil)
            assertTimestamp(claim.validUntil, `Claim ${claim.id} validUntil`);
        if (claim.validFrom &&
            claim.validUntil &&
            Date.parse(claim.validFrom) >= Date.parse(claim.validUntil)) {
            throw new ValidationError(`Claim ${claim.id} validUntil must be after validFrom`);
        }
        if (claim.driftWeight !== undefined && (!Number.isFinite(claim.driftWeight) || claim.driftWeight < 0 || claim.driftWeight > 1)) {
            throw new ValidationError(`Claim ${claim.id} driftWeight must be between 0 and 1`);
        }
        if (claim.layer === "core") {
            if (claim.stabilityProfile !== "slow" ||
                claim.changePolicy !== "accepted_evolution_required") {
                throw new ValidationError(`Core claim ${claimId} has an invalid stability policy`);
            }
        }
        else if (claim.stabilityProfile !== "adaptive" ||
            !["accepted_evolution_required", "observed_growth_with_review"].includes(claim.changePolicy)) {
            throw new ValidationError(`Texture claim ${claimId} has an invalid stability policy`);
        }
        validateClaimProvenance(claim, this.#evidence);
        if (claim.layer === "core")
            this.#core.set(claim.id, clone(claim));
        else
            this.#texture.set(claim.id, clone(claim));
        return this;
    }
    appendEvolution(event) {
        if (this.#evolutions.has(event.id))
            throw new DuplicateRecordError("Evolution", event.id);
        this.#assertIdentity(event.identityId, event.lineageId, `Evolution ${event.id}`);
        assertTimestamp(event.timestamp, `Evolution ${event.id} timestamp`);
        if (!event.acceptanceId.trim()) {
            throw new ValidationError(`Evolution ${event.id} requires an acceptanceId`);
        }
        const previous = this.#claimById(event.previousClaimId);
        const next = this.#claimById(event.newClaimId);
        if (!previous)
            throw new ValidationError(`Evolution ${event.id} references missing previous claim`);
        if (!next)
            throw new ValidationError(`Evolution ${event.id} references missing new claim`);
        if (next.origin !== "evolution") {
            throw new ValidationError(`Evolution target ${next.id} must have origin=evolution`);
        }
        if (previous.layer !== next.layer || previous.key !== next.key) {
            throw new ValidationError(`Evolution ${event.id} must connect claims in the same layer and key`);
        }
        if (this.#evolutionTargets.has(next.id)) {
            throw new ValidationError(`Claim ${next.id} is already the target of another evolution`);
        }
        this.#assertEvidenceReferences(event.evidenceIds, `Evolution ${event.id}`, true);
        if (event.relation === "temporarily_overrides" && !next.validUntil) {
            throw new ValidationError(`Temporary override ${event.id} requires newClaim.validUntil`);
        }
        this.#evolutions.set(event.id, clone(event));
        this.#evolutionTargets.add(next.id);
        return this;
    }
    appendSelfAcceptance(record) {
        if (this.#selfAcceptances.has(record.id)) {
            throw new DuplicateRecordError("SelfAcceptance", record.id);
        }
        if (record.subjectIdentityId !== this.descriptor.identityId) {
            throw new ValidationError(`SelfAcceptance ${record.id} belongs to a different identity`);
        }
        if (!isAcceptanceStatus(record.status)) {
            throw new ValidationError(`SelfAcceptance ${record.id} has an invalid status`);
        }
        if (!Number.isInteger(record.revision) || record.revision < 1) {
            throw new ValidationError(`SelfAcceptance ${record.id} revision must be a positive integer`);
        }
        assertTimestamp(record.recordedAt, `SelfAcceptance ${record.id} recordedAt`);
        if (!record.rationale.trim()) {
            throw new ValidationError(`SelfAcceptance ${record.id} requires a rationale`);
        }
        this.#assertEvidenceReferences(record.evidenceIds, `SelfAcceptance ${record.id}`, record.status !== "pending");
        const event = this.#evolutions.get(record.evolutionId);
        if (!event) {
            throw new ValidationError(`SelfAcceptance ${record.id} references missing evolution`);
        }
        if (record.revision === 1) {
            if (record.revisesAcceptanceId) {
                throw new ValidationError(`SelfAcceptance ${record.id} revision 1 cannot revise another record`);
            }
            if (record.status === "withdrawn") {
                throw new ValidationError(`SelfAcceptance ${record.id} cannot withdraw without prior acceptance`);
            }
            if (event.acceptanceId !== record.id) {
                throw new ValidationError(`SelfAcceptance ${record.id} is not the root referenced by its evolution`);
            }
        }
        else {
            if (!record.revisesAcceptanceId) {
                throw new ValidationError(`SelfAcceptance ${record.id} requires revisesAcceptanceId`);
            }
            const previous = this.#selfAcceptances.get(record.revisesAcceptanceId);
            if (!previous) {
                throw new ValidationError(`SelfAcceptance ${record.id} revises a missing record`);
            }
            if (previous.subjectIdentityId !== record.subjectIdentityId ||
                previous.evolutionId !== record.evolutionId) {
                throw new ValidationError(`SelfAcceptance ${record.id} cannot cross identity or evolution chains`);
            }
            if (record.revision !== previous.revision + 1) {
                throw new ValidationError(`SelfAcceptance ${record.id} revision must increment by exactly one`);
            }
            if (Date.parse(record.recordedAt) < Date.parse(previous.recordedAt)) {
                throw new ValidationError(`SelfAcceptance ${record.id} cannot predate its previous revision`);
            }
            if (record.status === "withdrawn" && !this.#chainContainsAccepted(previous)) {
                throw new ValidationError(`SelfAcceptance ${record.id} cannot withdraw without prior acceptance`);
            }
        }
        if (Date.parse(record.recordedAt) < Date.parse(event.timestamp)) {
            throw new ValidationError(`SelfAcceptance ${record.id} cannot predate its evolution`);
        }
        this.#selfAcceptances.set(record.id, clone(record));
        return this;
    }
    appendCoEvolution(record) {
        if (this.#coEvolutions.has(record.id))
            throw new DuplicateRecordError("CoEvolution", record.id);
        if (record.nonOverrideInvariant !== "influence_requires_recipient_self_acceptance") {
            throw new ValidationError(`CoEvolution ${record.id} violates the non-override invariant`);
        }
        assertTimestamp(record.createdAt, `CoEvolution ${record.id} createdAt`);
        if (record.participants.length < 2) {
            throw new ValidationError(`CoEvolution ${record.id} requires at least two participants`);
        }
        const participantIds = new Set(record.participants.map((item) => item.participantId));
        if (participantIds.size !== record.participants.length) {
            throw new ValidationError(`CoEvolution ${record.id} contains duplicate participants`);
        }
        this.#assertEvidenceReferences(record.evidenceIds, `CoEvolution ${record.id}`, true);
        if (record.influenceEdges.length === 0) {
            throw new ValidationError(`CoEvolution ${record.id} requires at least one influence edge`);
        }
        for (const edge of record.influenceEdges) {
            if (!participantIds.has(edge.fromParticipantId) || !participantIds.has(edge.toParticipantId)) {
                throw new ValidationError(`Influence edge ${edge.id} references a missing participant`);
            }
            if (!edge.description.trim())
                throw new ValidationError(`Influence edge ${edge.id} requires a description`);
            this.#assertEvidenceReferences(edge.evidenceIds, `Influence edge ${edge.id}`, true);
            if (edge.affectedEvolutionId && !this.#evolutions.has(edge.affectedEvolutionId)) {
                throw new ValidationError(`Influence edge ${edge.id} references a missing evolution`);
            }
            if (edge.recipientAcceptanceId && !this.#selfAcceptances.has(edge.recipientAcceptanceId)) {
                throw new ValidationError(`Influence edge ${edge.id} references a missing self-acceptance`);
            }
        }
        for (const effect of record.relationshipEffects ?? []) {
            if (!effect.description.trim()) {
                throw new ValidationError(`Relationship effect ${effect.id} requires a description`);
            }
            this.#assertEvidenceReferences(effect.evidenceIds, `Relationship effect ${effect.id}`, true);
        }
        this.#coEvolutions.set(record.id, clone(record));
        return this;
    }
    snapshot() {
        const body = {
            descriptor: clone(this.descriptor),
            evidence: sortById(this.#evidence.values()).map(clone),
            identityCore: sortById(this.#core.values()).map(clone),
            identityTexture: sortById(this.#texture.values()).map(clone),
            evolutions: sortById(this.#evolutions.values()).map(clone),
            selfAcceptances: sortById(this.#selfAcceptances.values()).map(clone),
            coEvolutions: sortById(this.#coEvolutions.values()).map(clone),
        };
        return { ...body, snapshotHash: computeSnapshotHash(body) };
    }
    #claimById(id) {
        return this.#core.get(id) ?? this.#texture.get(id);
    }
    #assertIdentity(identityId, lineageId, label) {
        if (identityId !== this.descriptor.identityId) {
            throw new ValidationError(`${label} belongs to a different identity`);
        }
        if (lineageId !== this.descriptor.lineageId) {
            throw new ValidationError(`${label} belongs to a different lineage`);
        }
    }
    #assertEvidenceReferences(ids, label, requireOne) {
        if (requireOne && ids.length === 0)
            throw new ValidationError(`${label} must cite evidence`);
        for (const evidenceId of ids) {
            if (!this.#evidence.has(evidenceId)) {
                throw new ValidationError(`${label} references missing evidence ${evidenceId}`);
            }
        }
    }
    #chainContainsAccepted(start) {
        let current = start;
        const visited = new Set();
        while (current && !visited.has(current.id)) {
            if (current.status === "accepted")
                return true;
            visited.add(current.id);
            current = current.revisesAcceptanceId
                ? this.#selfAcceptances.get(current.revisesAcceptanceId)
                : undefined;
        }
        return false;
    }
}
//# sourceMappingURL=ledger.js.map