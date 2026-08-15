import { verifyCapsule } from "../capsule.js";
import { assertSnapshotIntegrity } from "../ledger.js";
import { getRecoveryArtifactStateHash } from "./integrity.js";
function lineageId(artifact) {
    return artifact.kind === "ledger"
        ? artifact.snapshot.descriptor.lineageId
        : artifact.capsule.identity.lineageId;
}
function validArtifact(artifact) {
    try {
        if (artifact.kind === "ledger")
            assertSnapshotIntegrity(artifact.snapshot);
        else if (!verifyCapsule(artifact.capsule).valid)
            return false;
        return true;
    }
    catch {
        return false;
    }
}
function byIdentity(a, b) {
    return getRecoveryArtifactStateHash(a).localeCompare(getRecoveryArtifactStateHash(b)) ||
        a.artifactId.localeCompare(b.artifactId);
}
function correspondingLedger(capsule, candidates) {
    return candidates
        .filter((artifact) => artifact.kind === "ledger" &&
        artifact.snapshot.snapshotHash === capsule.capsule.sourceSnapshotHash)
        .sort(byIdentity)[0];
}
function capsuleAncestors(head, candidates) {
    const byHash = new Map(candidates.map((item) => [item.capsule.integrityHash, item]));
    const ancestors = new Set();
    let parentHash = head.capsule.parentCapsuleHash;
    while (parentHash) {
        const parent = byHash.get(parentHash);
        if (!parent || ancestors.has(parent.artifactId))
            break;
        ancestors.add(parent.artifactId);
        parentHash = parent.capsule.parentCapsuleHash;
    }
    return ancestors;
}
export function selectRecoveryHead(artifacts, options) {
    const ordered = [...artifacts].sort(byIdentity);
    const invalid = ordered.filter((artifact) => !validArtifact(artifact));
    const wrongLineage = ordered.filter((artifact) => validArtifact(artifact) && lineageId(artifact) !== options.expectedLineageId);
    const eligible = ordered.filter((artifact) => validArtifact(artifact) && lineageId(artifact) === options.expectedLineageId);
    const rejectedArtifactIds = [...invalid, ...wrongLineage]
        .map((artifact) => artifact.artifactId)
        .sort();
    const base = { staleArtifactIds: [], rejectedArtifactIds, reasonCodes: [] };
    if (eligible.length === 0) {
        return {
            ...base,
            reasonCodes: [wrongLineage.length > 0 ? "lineage_mismatch" : "no_trusted_artifact"],
        };
    }
    const expected = options.expectedTrustedHead;
    if (expected) {
        const exact = eligible.find((artifact) => {
            if (expected.kind === "snapshot") {
                return artifact.kind === "ledger" && artifact.snapshot.snapshotHash === expected.hash;
            }
            return artifact.kind === "capsule" && artifact.capsule.integrityHash === expected.hash;
        });
        if (!exact)
            return { ...base, reasonCodes: ["expected_head_missing"] };
        let selected = exact;
        if (exact.kind === "capsule")
            selected = correspondingLedger(exact, eligible) ?? exact;
        const stale = exact.kind === "capsule"
            ? [...capsuleAncestors(exact, eligible.filter((x) => x.kind === "capsule"))]
            : [];
        return {
            selectedArtifactId: selected.artifactId,
            selectedStateHash: selected.kind === "ledger"
                ? selected.snapshot.snapshotHash
                : selected.capsule.integrityHash,
            staleArtifactIds: stale.sort(),
            rejectedArtifactIds,
            reasonCodes: [],
        };
    }
    const capsules = eligible.filter((item) => item.kind === "capsule");
    const parentHashes = new Set(capsules.map((item) => item.capsule.parentCapsuleHash).filter((hash) => !!hash));
    const capsuleHeads = capsules.filter((item) => !parentHashes.has(item.capsule.integrityHash));
    if (capsuleHeads.length > 1) {
        return { ...base, reasonCodes: ["unresolved_head_fork"] };
    }
    if (capsuleHeads.length === 1) {
        const head = capsuleHeads[0];
        const selected = correspondingLedger(head, eligible) ?? head;
        return {
            selectedArtifactId: selected.artifactId,
            selectedStateHash: getRecoveryArtifactStateHash(selected),
            staleArtifactIds: [...capsuleAncestors(head, capsules)].sort(),
            rejectedArtifactIds,
            reasonCodes: [],
        };
    }
    const ledgers = eligible.filter((item) => item.kind === "ledger");
    if (ledgers.length === 1) {
        return {
            selectedArtifactId: ledgers[0].artifactId,
            selectedStateHash: ledgers[0].snapshot.snapshotHash,
            staleArtifactIds: [],
            rejectedArtifactIds,
            reasonCodes: [],
        };
    }
    return { ...base, reasonCodes: ["unresolved_head_fork"] };
}
//# sourceMappingURL=head-selection.js.map