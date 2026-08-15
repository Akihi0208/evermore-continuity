import { isAcceptanceStatus } from "./acceptance-status.js";
import { deepEqual, sha256 } from "./canonical.js";
import { assertSnapshotIntegrity } from "./ledger.js";
function claimSort(a, b) {
    return (a.layer.localeCompare(b.layer) ||
        a.key.localeCompare(b.key) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id));
}
function eventSort(a, b) {
    return a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id);
}
function inWindow(claim, asOf) {
    const time = Date.parse(asOf);
    if (time < Date.parse(claim.createdAt))
        return false;
    if (claim.validFrom && time < Date.parse(claim.validFrom))
        return false;
    if (claim.validUntil && time >= Date.parse(claim.validUntil))
        return false;
    return true;
}
function identityFingerprint(lineageId, activeClaims) {
    const core = activeClaims
        .filter((claim) => claim.layer === "core")
        .map((claim) => ({ key: claim.key, scope: claim.scope ?? null, value: claim.value }))
        .sort((a, b) => a.key.localeCompare(b.key) || String(a.scope).localeCompare(String(b.scope)));
    return sha256({ lineageId, core });
}
function acceptanceConflict(event, reason, ids) {
    return {
        conflict: {
            kind: "acceptance",
            evolutionId: event.id,
            acceptanceIds: [...new Set(ids)].sort(),
            reason,
        },
    };
}
function hasCycle(records) {
    const byId = new Map(records.map((record) => [record.id, record]));
    for (const record of records) {
        const path = [];
        const positions = new Map();
        let current = record;
        while (current) {
            const position = positions.get(current.id);
            if (position !== undefined)
                return path.slice(position).concat(current.id);
            positions.set(current.id, path.length);
            path.push(current.id);
            current = current.revisesAcceptanceId ? byId.get(current.revisesAcceptanceId) : undefined;
        }
    }
    return [];
}
function resolveAcceptance(event, snapshot, asOf) {
    const cutoff = Date.parse(asOf);
    const allById = new Map(snapshot.selfAcceptances.map((record) => [record.id, record]));
    const allRoot = allById.get(event.acceptanceId);
    if (!allRoot)
        return acceptanceConflict(event, "acceptance_root_missing", [event.acceptanceId]);
    if (Date.parse(allRoot.recordedAt) > cutoff)
        return { status: "pending" };
    const eligible = snapshot.selfAcceptances.filter((record) => Date.parse(record.recordedAt) <= cutoff);
    const byId = new Map(eligible.map((record) => [record.id, record]));
    const root = byId.get(event.acceptanceId);
    if (!root)
        return { status: "pending" };
    if (!isAcceptanceStatus(root.status)) {
        return acceptanceConflict(event, "acceptance_status_invalid", [root.id]);
    }
    if (root.revision !== 1 || root.revisesAcceptanceId) {
        return acceptanceConflict(event, "acceptance_root_invalid", [root.id]);
    }
    if (root.subjectIdentityId !== event.identityId) {
        return acceptanceConflict(event, "acceptance_identity_mismatch", [root.id]);
    }
    if (root.evolutionId !== event.id) {
        return acceptanceConflict(event, "acceptance_evolution_mismatch", [root.id]);
    }
    if (Date.parse(root.recordedAt) < Date.parse(event.timestamp)) {
        return acceptanceConflict(event, "acceptance_time_invalid", [root.id]);
    }
    if (root.status === "withdrawn") {
        return acceptanceConflict(event, "acceptance_withdrawal_without_acceptance", [root.id]);
    }
    const eventRecords = eligible.filter((record) => record.evolutionId === event.id);
    const invalidStatus = eventRecords.find((record) => !isAcceptanceStatus(record.status));
    if (invalidStatus) {
        return acceptanceConflict(event, "acceptance_status_invalid", [invalidStatus.id]);
    }
    const cycleIds = hasCycle(eventRecords);
    if (cycleIds.length > 0)
        return acceptanceConflict(event, "acceptance_cycle", cycleIds);
    const children = new Map();
    for (const record of eligible) {
        if (!record.revisesAcceptanceId)
            continue;
        const list = children.get(record.revisesAcceptanceId) ?? [];
        list.push(record);
        children.set(record.revisesAcceptanceId, list);
    }
    const visited = new Set();
    let current = root;
    let hasAccepted = current.status === "accepted";
    while (true) {
        visited.add(current.id);
        const nextRecords = (children.get(current.id) ?? []).sort((a, b) => a.id.localeCompare(b.id));
        if (nextRecords.length > 1) {
            return acceptanceConflict(event, "acceptance_branch", [current.id, ...nextRecords.map((item) => item.id)]);
        }
        const next = nextRecords[0];
        if (!next)
            break;
        if (visited.has(next.id)) {
            return acceptanceConflict(event, "acceptance_cycle", [...visited, next.id]);
        }
        if (!isAcceptanceStatus(next.status)) {
            return acceptanceConflict(event, "acceptance_status_invalid", [next.id]);
        }
        if (next.subjectIdentityId !== event.identityId) {
            return acceptanceConflict(event, "acceptance_identity_mismatch", [current.id, next.id]);
        }
        if (next.evolutionId !== event.id) {
            return acceptanceConflict(event, "acceptance_evolution_mismatch", [current.id, next.id]);
        }
        if (next.revision !== current.revision + 1) {
            return acceptanceConflict(event, "acceptance_revision_gap", [current.id, next.id]);
        }
        if (Date.parse(next.recordedAt) < Date.parse(current.recordedAt)) {
            return acceptanceConflict(event, "acceptance_time_invalid", [current.id, next.id]);
        }
        if (next.status === "withdrawn" && !hasAccepted) {
            return acceptanceConflict(event, "acceptance_withdrawal_without_acceptance", [current.id, next.id]);
        }
        if (next.status === "accepted")
            hasAccepted = true;
        current = next;
    }
    const unreachable = eventRecords.filter((record) => !visited.has(record.id));
    if (unreachable.length > 0) {
        return acceptanceConflict(event, "acceptance_broken_link", unreachable.map((record) => record.id));
    }
    return { status: current.status };
}
function consumesPrevious(event) {
    return ["refines", "supersedes", "temporarily_overrides"].includes(event.relation);
}
function applyAcceptedEvent(event, previous, next, active, conflicts) {
    if (event.relation === "temporarily_overrides") {
        active.delete(previous.id);
        active.add(next.id);
        return;
    }
    if (event.relation === "supersedes" || event.relation === "refines") {
        active.delete(previous.id);
        active.add(next.id);
        return;
    }
    if (event.relation === "coexists") {
        active.add(next.id);
        return;
    }
    active.add(previous.id);
    active.add(next.id);
    if (!deepEqual(previous.value, next.value)) {
        conflicts.push({
            kind: "claim",
            key: previous.key,
            layer: previous.layer,
            claimIds: [previous.id, next.id].sort(),
            evolutionId: event.id,
            reason: "contradiction",
        });
    }
}
export function resolveIdentity(snapshot, options = {}) {
    assertSnapshotIntegrity(snapshot);
    const asOf = options.asOf ?? new Date().toISOString();
    if (Number.isNaN(Date.parse(asOf)))
        throw new TypeError("asOf must be an ISO timestamp");
    const claims = [...snapshot.identityCore, ...snapshot.identityTexture];
    const claimById = new Map(claims.map((claim) => [claim.id, claim]));
    const active = new Set(claims
        .filter((claim) => claim.origin === "initial" && inWindow(claim, asOf))
        .map((claim) => claim.id));
    const conflicts = [];
    const pendingEvolutionIds = [];
    const rejectedEvolutionIds = [];
    const withdrawnEvolutionIds = [];
    const acceptedEvolutionIds = [];
    const acceptedEvolutionClaimIds = [];
    const ambiguousEvolutionIds = [];
    const eligibleEvents = snapshot.evolutions
        .filter((event) => Date.parse(event.timestamp) <= Date.parse(asOf))
        .sort(eventSort);
    const timestamps = [...new Set(eligibleEvents.map((event) => event.timestamp))].sort();
    for (const timestamp of timestamps) {
        const candidates = [];
        for (const event of eligibleEvents.filter((item) => item.timestamp === timestamp)) {
            const acceptance = resolveAcceptance(event, snapshot, asOf);
            if (acceptance.conflict) {
                conflicts.push(acceptance.conflict);
                ambiguousEvolutionIds.push(event.id);
                continue;
            }
            if (acceptance.status === "pending") {
                pendingEvolutionIds.push(event.id);
                continue;
            }
            if (acceptance.status === "rejected") {
                rejectedEvolutionIds.push(event.id);
                continue;
            }
            if (acceptance.status === "withdrawn") {
                withdrawnEvolutionIds.push(event.id);
                continue;
            }
            if (acceptance.status !== "accepted") {
                conflicts.push({
                    kind: "acceptance",
                    evolutionId: event.id,
                    acceptanceIds: [event.acceptanceId],
                    reason: "acceptance_status_invalid",
                });
                ambiguousEvolutionIds.push(event.id);
                continue;
            }
            const previous = claimById.get(event.previousClaimId);
            const next = claimById.get(event.newClaimId);
            if (!previous || !next || !inWindow(next, asOf))
                continue;
            candidates.push({ event, previous, next });
        }
        const competingIds = new Set();
        const consumersByPrevious = new Map();
        for (const candidate of candidates.filter(({ event }) => consumesPrevious(event))) {
            const list = consumersByPrevious.get(candidate.previous.id) ?? [];
            list.push(candidate);
            consumersByPrevious.set(candidate.previous.id, list);
        }
        for (const group of consumersByPrevious.values()) {
            if (group.length < 2)
                continue;
            for (const candidate of group) {
                competingIds.add(candidate.event.id);
                ambiguousEvolutionIds.push(candidate.event.id);
                conflicts.push({
                    kind: "claim",
                    key: candidate.previous.key,
                    layer: candidate.previous.layer,
                    claimIds: [candidate.previous.id, candidate.next.id].sort(),
                    evolutionId: candidate.event.id,
                    reason: "same_time_competing_transition",
                });
            }
        }
        let remaining = candidates.filter(({ event }) => !competingIds.has(event.id));
        let progressed = true;
        while (remaining.length > 0 && progressed) {
            progressed = false;
            const deferred = [];
            for (const candidate of remaining) {
                if (!active.has(candidate.previous.id)) {
                    deferred.push(candidate);
                    continue;
                }
                applyAcceptedEvent(candidate.event, candidate.previous, candidate.next, active, conflicts);
                acceptedEvolutionIds.push(candidate.event.id);
                acceptedEvolutionClaimIds.push(candidate.next.id);
                progressed = true;
            }
            remaining = deferred;
        }
        for (const candidate of remaining) {
            ambiguousEvolutionIds.push(candidate.event.id);
            conflicts.push({
                kind: "claim",
                key: candidate.previous.key,
                layer: candidate.previous.layer,
                claimIds: [candidate.previous.id, candidate.next.id].sort(),
                evolutionId: candidate.event.id,
                reason: "inactive_predecessor",
            });
        }
    }
    const activeClaims = claims.filter((claim) => active.has(claim.id)).sort(claimSort);
    const inactiveClaims = claims.filter((claim) => !active.has(claim.id)).sort(claimSort);
    return {
        descriptor: structuredClone(snapshot.descriptor),
        asOf,
        activeClaims: structuredClone(activeClaims),
        inactiveClaims: structuredClone(inactiveClaims),
        pendingEvolutionIds,
        rejectedEvolutionIds,
        withdrawnEvolutionIds,
        acceptedEvolutionIds,
        acceptedEvolutionClaimIds,
        ambiguousEvolutionIds,
        conflicts,
        sourceSnapshotHash: snapshot.snapshotHash,
        identityFingerprint: identityFingerprint(snapshot.descriptor.lineageId, activeClaims),
    };
}
export function hasSharedLineage(a, b) {
    return a.descriptor.lineageId === b.descriptor.lineageId;
}
//# sourceMappingURL=resolver.js.map