import { sha256 } from "../canonical.js";
import { ValidationError } from "../errors.js";
import { validateRecoveryProfile, verifyRecoveryLoadReport, } from "./integrity.js";
function sortedUnique(items) {
    return [...new Set(items)].sort();
}
function normalizeProbeResult(result) {
    return {
        probeId: result.probeId,
        critical: result.critical,
        status: result.status,
        matchedAnchorIds: sortedUnique(result.matchedAnchorIds),
        reasonCodes: sortedUnique(result.reasonCodes),
    };
}
function normalizeDriftResult(result) {
    return {
        category: result.category,
        risk: result.risk,
        ...(result.layer ? { layer: result.layer } : {}),
    };
}
function normalizeConflictResult(result) {
    return {
        anchorId: result.anchorId,
        claimIds: sortedUnique(result.claimIds),
    };
}
function normalizeVerificationReportBody(report) {
    return {
        reportVersion: report.reportVersion,
        verdict: report.verdict,
        profileId: report.profileId,
        profileHash: report.profileHash,
        loadReportHash: report.loadReportHash,
        asOf: report.asOf,
        expectedLineageId: report.expectedLineageId,
        ...(report.observedLineageId ? { observedLineageId: report.observedLineageId } : {}),
        expectedHead: structuredClone(report.expectedHead),
        ...(report.observedHeadHash ? { observedHeadHash: report.observedHeadHash } : {}),
        coreCoverage: report.coreCoverage,
        textureCoverage: report.textureCoverage,
        loadedAnchorIds: sortedUnique(report.loadedAnchorIds),
        missingAnchorIds: sortedUnique(report.missingAnchorIds),
        staleAnchorIds: sortedUnique(report.staleAnchorIds),
        expiredAnchorIds: sortedUnique(report.expiredAnchorIds),
        inactiveAnchorIds: sortedUnique(report.inactiveAnchorIds),
        maskedAnchorIds: sortedUnique(report.maskedAnchorIds),
        privacyUnavailableAnchorIds: sortedUnique(report.privacyUnavailableAnchorIds),
        conflictingAnchorIds: sortedUnique(report.conflictingAnchorIds),
        conflictResults: report.conflictResults
            .map(normalizeConflictResult)
            .sort((a, b) => a.anchorId.localeCompare(b.anchorId)),
        probeResults: report.probeResults
            .map(normalizeProbeResult)
            .sort((a, b) => a.probeId.localeCompare(b.probeId)),
        driftResults: report.driftResults
            .map(normalizeDriftResult)
            .sort((a, b) => a.category.localeCompare(b.category) ||
            a.risk.localeCompare(b.risk) ||
            (a.layer ?? "").localeCompare(b.layer ?? "")),
        reasonCodes: sortedUnique(report.reasonCodes),
        warnings: sortedUnique(report.warnings),
        operationalWarnings: sortedUnique(report.operationalWarnings),
    };
}
export function computeRecoveryVerificationReportHash(report) {
    return sha256(normalizeVerificationReportBody(report));
}
export function sealRecoveryVerificationReport(body) {
    const normalized = normalizeVerificationReportBody(body);
    return { ...normalized, reportHash: sha256(normalized) };
}
export function verifyRecoveryVerificationReport(report) {
    const errors = computeRecoveryVerificationReportHash(report) === report.reportHash
        ? []
        : ["report_integrity_mismatch"];
    return { valid: errors.length === 0, errors };
}
function observationMap(observations) {
    const grouped = new Map();
    for (const observation of observations) {
        const group = grouped.get(observation.probeId) ?? [];
        group.push(observation);
        grouped.set(observation.probeId, group);
    }
    return grouped;
}
function evaluateProbe(definition, observations, exportableAnchorIds) {
    if (!observations || observations.length === 0) {
        return {
            probeId: definition.probeId,
            critical: definition.critical,
            status: "indeterminate",
            matchedAnchorIds: [],
            reasonCodes: [definition.critical ? "critical_probe_unobserved" : "noncritical_probe_unobserved"],
        };
    }
    if (observations.length !== 1) {
        return {
            probeId: definition.probeId,
            critical: definition.critical,
            status: "indeterminate",
            matchedAnchorIds: [],
            reasonCodes: ["probe_observation_ambiguous"],
        };
    }
    const observation = observations[0];
    const cited = new Set(Array.isArray(observation.citedAnchorIds) ? observation.citedAnchorIds : []);
    const matchedAnchorIds = definition.anchorIds.filter((anchorId) => cited.has(anchorId) && exportableAnchorIds.has(anchorId));
    if (observation.status === "masked") {
        return {
            probeId: definition.probeId,
            critical: definition.critical,
            status: definition.maskingPermitted ? "indeterminate" : "failed",
            matchedAnchorIds,
            reasonCodes: [definition.maskingPermitted ? "probe_masked" : "probe_mask_not_permitted"],
        };
    }
    if (observation.status === "unavailable") {
        return {
            probeId: definition.probeId,
            critical: definition.critical,
            status: "indeterminate",
            matchedAnchorIds,
            reasonCodes: ["probe_unavailable"],
        };
    }
    if (observation.status !== "observed" || !observation.selectedOutcomeId) {
        return {
            probeId: definition.probeId,
            critical: definition.critical,
            status: "indeterminate",
            matchedAnchorIds,
            reasonCodes: ["probe_observation_invalid"],
        };
    }
    if (definition.forbiddenOutcomeIds.includes(observation.selectedOutcomeId)) {
        return {
            probeId: definition.probeId,
            critical: definition.critical,
            status: "failed",
            matchedAnchorIds,
            reasonCodes: ["probe_forbidden_outcome"],
        };
    }
    if (!definition.allowedOutcomeIds.includes(observation.selectedOutcomeId)) {
        return {
            probeId: definition.probeId,
            critical: definition.critical,
            status: "indeterminate",
            matchedAnchorIds,
            reasonCodes: ["probe_outcome_undeclared"],
        };
    }
    const everyAnchorCited = definition.anchorIds.every((anchorId) => cited.has(anchorId));
    if (!everyAnchorCited) {
        return {
            probeId: definition.probeId,
            critical: definition.critical,
            status: "indeterminate",
            matchedAnchorIds,
            reasonCodes: ["probe_anchor_reference_missing"],
        };
    }
    return {
        probeId: definition.probeId,
        critical: definition.critical,
        status: "passed",
        matchedAnchorIds,
        reasonCodes: [],
    };
}
function driftResults(options) {
    return (options.driftReport?.observations ?? []).map((item) => ({
        category: item.category,
        risk: item.risk,
        ...(item.layer ? { layer: item.layer } : {}),
    }));
}
function operationalWarnings(observations) {
    return sortedUnique(observations.map((item) => `operational:${item.domain}:${item.status}`));
}
function safeAnchorIds(profile) {
    return new Set([...profile.requiredCoreAnchors, ...profile.textureAnchors]
        .filter((item) => item.visibility !== "private")
        .map((item) => item.anchorId));
}
function keepSafe(items, safeIds) {
    return items.filter((item) => safeIds.has(item));
}
function verdictFor(rejected, indeterminate) {
    if (rejected)
        return "rejected";
    if (indeterminate)
        return "indeterminate";
    return "verified";
}
export function evaluateRecovery(profile, loadReport, probeObservations, options = {}) {
    validateRecoveryProfile(profile);
    const safeIds = safeAnchorIds(profile);
    const reasonCodes = [];
    const warnings = [];
    let rejected = false;
    let indeterminate = false;
    const loadVerification = verifyRecoveryLoadReport(loadReport);
    const loadTrusted = loadVerification.valid && loadReport.profileHash === profile.integrityHash;
    if (!loadVerification.valid) {
        rejected = true;
        reasonCodes.push("load_report_integrity_mismatch");
    }
    if (loadReport.profileHash !== profile.integrityHash) {
        rejected = true;
        reasonCodes.push("profile_load_report_mismatch");
    }
    if (loadTrusted && loadReport.status === "blocked") {
        rejected = true;
        reasonCodes.push(...loadReport.blockingReasons);
    }
    else if (loadTrusted && loadReport.status === "indeterminate") {
        indeterminate = true;
        reasonCodes.push(...loadReport.indeterminateReasons);
    }
    if (loadTrusted && loadReport.status === "ready" && loadReport.coreCoverage !== 1) {
        rejected = true;
        reasonCodes.push("required_core_coverage_incomplete");
    }
    if (loadTrusted && loadReport.textureCoverage < profile.minimumTextureCoverage) {
        indeterminate = true;
        reasonCodes.push("texture_coverage_insufficient");
    }
    const definitions = profile.behaviorProbes ?? [];
    if (definitions.length !== profile.behaviorProbeIds.length) {
        indeterminate = true;
        reasonCodes.push("probe_definitions_missing");
    }
    const observationsByProbe = observationMap(probeObservations);
    const probeResults = definitions.map((definition) => evaluateProbe(definition, observationsByProbe.get(definition.probeId), safeIds));
    for (const result of probeResults) {
        if (!result.critical) {
            if (result.status === "failed")
                warnings.push("noncritical_probe_failed");
            continue;
        }
        if (result.status === "failed") {
            rejected = true;
            reasonCodes.push("critical_probe_failed");
        }
        else if (result.status === "indeterminate") {
            indeterminate = true;
            reasonCodes.push(...result.reasonCodes);
        }
    }
    const drift = driftResults(options);
    if (options.driftReport?.overallRisk === "high") {
        rejected = true;
        reasonCodes.push("high_risk_identity_drift");
    }
    else if (options.driftReport?.overallRisk === "uncertain") {
        indeterminate = true;
        reasonCodes.push("identity_drift_uncertain");
    }
    else if (options.driftReport?.overallRisk === "medium") {
        warnings.push("identity_drift_review_recommended");
    }
    const operational = operationalWarnings(options.operationalObservations ?? []);
    const verdict = verdictFor(rejected, indeterminate);
    const trustedAnchorResults = loadTrusted ? loadReport.anchorResults : [];
    const conflictResults = trustedAnchorResults
        .filter((item) => item.status === "conflicting" && safeIds.has(item.anchorId))
        .map((item) => ({
        anchorId: item.anchorId,
        claimIds: sortedUnique(item.conflictClaimIds ?? []),
    }));
    return sealRecoveryVerificationReport({
        reportVersion: "0.3-final-verifier",
        verdict,
        profileId: profile.profileId,
        profileHash: profile.integrityHash,
        loadReportHash: loadTrusted ? loadReport.reportHash : sha256({ invalidLoadReport: true }),
        asOf: loadTrusted ? loadReport.asOf : "1970-01-01T00:00:00.000Z",
        expectedLineageId: profile.expectedLineageId,
        ...(loadTrusted && loadReport.selectedStateHash ? { observedLineageId: profile.expectedLineageId } : {}),
        expectedHead: structuredClone(profile.expectedTrustedHead),
        ...(loadTrusted && loadReport.selectedStateHash ? { observedHeadHash: loadReport.selectedStateHash } : {}),
        coreCoverage: loadTrusted ? loadReport.coreCoverage : 0,
        textureCoverage: loadTrusted ? loadReport.textureCoverage : 0,
        loadedAnchorIds: loadTrusted ? keepSafe(loadReport.loadedAnchorIds, safeIds) : [],
        missingAnchorIds: loadTrusted ? keepSafe(loadReport.missingAnchorIds, safeIds) : [],
        staleAnchorIds: loadTrusted ? keepSafe(loadReport.staleAnchorIds, safeIds) : [],
        expiredAnchorIds: loadTrusted ? keepSafe(loadReport.expiredAnchorIds, safeIds) : [],
        inactiveAnchorIds: loadTrusted ? keepSafe(loadReport.inactiveAnchorIds, safeIds) : [],
        maskedAnchorIds: loadTrusted ? keepSafe(loadReport.maskedAnchorIds, safeIds) : [],
        privacyUnavailableAnchorIds: loadTrusted ? keepSafe(loadReport.privacyUnavailableAnchorIds, safeIds) : [],
        conflictingAnchorIds: loadTrusted ? keepSafe(loadReport.conflictingAnchorIds, safeIds) : [],
        conflictResults,
        probeResults,
        driftResults: drift,
        reasonCodes,
        warnings,
        operationalWarnings: operational,
    });
}
export function serializeRecoveryVerification(report) {
    const verification = verifyRecoveryVerificationReport(report);
    if (!verification.valid)
        throw new ValidationError("report_integrity_mismatch");
    return {
        reportVersion: "0.3-final-verifier-adapter",
        verdict: report.verdict,
        success: report.verdict === "verified",
        reportHash: report.reportHash,
    };
}
//# sourceMappingURL=verification.js.map