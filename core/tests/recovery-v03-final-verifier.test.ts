import assert from "node:assert/strict";
import test from "node:test";
import {
  ContinuityLedger,
  detectDrift,
  resolveIdentity,
  type DriftReport,
  type EvidenceRecord,
  type IdentityClaim,
  type LedgerSnapshot,
} from "../src/index.js";
import {
  computeAnchorValueHash,
  computeRecoveryBundleHash,
  computeRecoveryProfileHash,
  evaluateRecovery,
  loadRecoveryAnchors,
  serializeRecoveryVerification,
  verifyRecoveryVerificationReport,
  type LedgerRecoveryArtifact,
  type RecoveryAnchorRequirement,
  type RecoveryBundle,
  type RecoveryOperationalObservation,
  type RecoveryProbeDefinition,
  type RecoveryProbeObservation,
  type RecoveryProfile,
} from "../src/recovery-v03/index.js";

const T0 = "2026-08-12T00:00:00.000Z";
const T1 = "2026-08-12T01:00:00.000Z";
const T2 = "2026-08-12T02:00:00.000Z";
const T3 = "2026-08-12T03:00:00.000Z";

function evidence(id: string): EvidenceRecord {
  return {
    id,
    sourceId: `synthetic:${id}`,
    evidenceKind: "self_report",
    createdAt: T0,
    confidence: 1,
    verified: false,
  };
}

function claim(
  id: string,
  layer: "core" | "texture",
  key: string,
  value: string | boolean,
  evidenceId: string,
  overrides: Partial<IdentityClaim> = {},
): IdentityClaim {
  return {
    id,
    identityId: "synthetic-agent",
    lineageId: "synthetic-lineage",
    layer,
    key,
    value,
    claimKind: "identity_claim",
    origin: "initial",
    visibility: "capsule",
    createdAt: T0,
    evidenceIds: [evidenceId],
    stabilityProfile: layer === "core" ? "slow" : "adaptive",
    changePolicy: "accepted_evolution_required",
    ...overrides,
  } as IdentityClaim;
}

function ledgerWithClaims(items: IdentityClaim[]): ContinuityLedger {
  const ledger = new ContinuityLedger({
    identityId: "synthetic-agent",
    lineageId: "synthetic-lineage",
    version: 3,
  });
  for (const id of new Set(items.flatMap((item) => item.evidenceIds))) {
    ledger.appendEvidence(evidence(id));
  }
  for (const item of items) ledger.appendClaim(item);
  return ledger;
}

function defaultSnapshot(): LedgerSnapshot {
  return ledgerWithClaims([
    claim("core-agency", "core", "agency", "deliberate", "e-agency"),
    claim("texture-cadence", "texture", "cadence", "compact", "e-cadence"),
  ]).snapshot();
}

function anchor(
  item: IdentityClaim,
  overrides: Partial<RecoveryAnchorRequirement> = {},
): RecoveryAnchorRequirement {
  return {
    anchorId: `anchor:${item.id}`,
    claimId: item.id,
    key: item.key,
    layer: item.layer,
    valueHash: computeAnchorValueHash(item.value),
    visibility: item.visibility,
    weight: 1,
    ...(item.scope ? { scope: item.scope } : {}),
    ...overrides,
  };
}

function artifactFor(snapshot: LedgerSnapshot): LedgerRecoveryArtifact {
  return {
    artifactId: "ledger",
    kind: "ledger",
    snapshot,
    generatedAt: T2,
  };
}

function probe(
  probeId: string,
  anchorIds: string[],
  overrides: Partial<RecoveryProbeDefinition> = {},
): RecoveryProbeDefinition {
  return {
    probeId,
    scenarioId: `scenario:${probeId}`,
    critical: true,
    anchorIds,
    allowedOutcomeIds: ["allowed"],
    forbiddenOutcomeIds: ["forbidden"],
    maskingPermitted: true,
    ...overrides,
  };
}

function profileFor(
  artifact: LedgerRecoveryArtifact,
  coreAnchors: RecoveryAnchorRequirement[],
  textureAnchors: RecoveryAnchorRequirement[],
  probes: RecoveryProbeDefinition[],
  overrides: Partial<Omit<RecoveryProfile, "integrityHash">> = {},
): RecoveryProfile {
  const body: Omit<RecoveryProfile, "integrityHash"> = {
    profileVersion: "0.3-slice1",
    profileId: "synthetic-final-verifier-profile",
    expectedLineageId: "synthetic-lineage",
    expectedTrustedHead: { kind: "snapshot", hash: artifact.snapshot.snapshotHash },
    requiredCoreAnchors: coreAnchors,
    textureAnchors,
    minimumTextureCoverage: textureAnchors.length === 0 ? 0 : 1,
    freshnessPolicies: [],
    behaviorProbeIds: probes.map((item) => item.probeId),
    behaviorProbes: probes,
    ...overrides,
  };
  return { ...body, integrityHash: computeRecoveryProfileHash(body) };
}

function bundleFor(profile: RecoveryProfile, artifact: LedgerRecoveryArtifact): RecoveryBundle {
  const body: Omit<RecoveryBundle, "integrityHash"> = {
    bundleVersion: "0.3-slice1",
    profile,
    artifacts: [artifact],
    asOf: T3,
    observations: [],
  };
  return { ...body, integrityHash: computeRecoveryBundleHash(body) };
}

function observed(
  definition: RecoveryProbeDefinition,
  overrides: Partial<RecoveryProbeObservation> = {},
): RecoveryProbeObservation {
  return {
    probeId: definition.probeId,
    status: "observed",
    selectedOutcomeId: definition.allowedOutcomeIds[0]!,
    citedAnchorIds: [...definition.anchorIds],
    ...overrides,
  };
}

function readyFixture(probeCount = 1) {
  const snapshot = defaultSnapshot();
  const artifact = artifactFor(snapshot);
  const core = anchor(snapshot.identityCore[0]!);
  const texture = anchor(snapshot.identityTexture[0]!);
  const probes = Array.from({ length: probeCount }, (_, index) =>
    probe(`probe-${index + 1}`, index % 2 === 0 ? [core.anchorId] : [texture.anchorId]));
  const profile = profileFor(artifact, [core], [texture], probes);
  const loadReport = loadRecoveryAnchors(bundleFor(profile, artifact));
  return { snapshot, artifact, core, texture, probes, profile, loadReport };
}

test("V03-028 Full recovery with all critical probes passed verifies", () => {
  const fixture = readyFixture();
  const report = evaluateRecovery(
    fixture.profile,
    fixture.loadReport,
    fixture.probes.map((item) => observed(item)),
  );
  assert.equal(report.verdict, "verified");
  assert.deepEqual(report.reasonCodes, []);
  assert.equal(report.coreCoverage, 1);
  assert.equal(report.textureCoverage, 1);
  assert.equal(report.probeResults[0]?.status, "passed");
  assert.equal(verifyRecoveryVerificationReport(report).valid, true);
});

test("V03-029 Final verifier preserves lineage-gate rejection", () => {
  const fixture = readyFixture();
  const wrongProfileBody: Omit<RecoveryProfile, "integrityHash"> = {
    ...fixture.profile,
    expectedLineageId: "other-lineage",
  };
  const { integrityHash: _ignored, ...body } = wrongProfileBody as RecoveryProfile;
  const profile = { ...body, integrityHash: computeRecoveryProfileHash(body) };
  const loadReport = loadRecoveryAnchors(bundleFor(profile, fixture.artifact));
  const report = evaluateRecovery(profile, loadReport, fixture.probes.map((item) => observed(item)));
  assert.equal(report.verdict, "rejected");
  assert.ok(report.reasonCodes.includes("lineage_mismatch"));
});

test("V03-030 Catchphrase clone fails a critical forbidden agency outcome", () => {
  const fixture = readyFixture();
  const clone = observed(fixture.probes[0]!, {
    selectedOutcomeId: "forbidden",
    renderedText: "Synthetic expected phrase and style reproduced exactly.",
  });
  const report = evaluateRecovery(fixture.profile, fixture.loadReport, [clone]);
  assert.equal(report.verdict, "rejected");
  assert.equal(report.probeResults[0]?.status, "failed");
  assert.ok(report.reasonCodes.includes("critical_probe_failed"));
});

test("V03-031 Different prose passes when structured choice and anchor citations pass", () => {
  const fixture = readyFixture();
  const observation = observed(fixture.probes[0]!, {
    renderedText: "Completely different synthetic prose with the same structured commitment.",
  });
  const report = evaluateRecovery(fixture.profile, fixture.loadReport, [observation]);
  assert.equal(report.verdict, "verified");
  assert.equal(report.probeResults[0]?.status, "passed");
});

test("V03-032 Missing required Core is named and cannot become partial success", () => {
  const snapshot = defaultSnapshot();
  const artifact = artifactFor(snapshot);
  const missingCore = {
    ...anchor(snapshot.identityCore[0]!),
    anchorId: "anchor:missing-core",
    claimId: "missing-core",
  };
  const definition = probe("probe-missing-core", [missingCore.anchorId]);
  const profile = profileFor(artifact, [missingCore], [anchor(snapshot.identityTexture[0]!)], [definition]);
  const loadReport = loadRecoveryAnchors(bundleFor(profile, artifact));
  const report = evaluateRecovery(profile, loadReport, [observed(definition)]);
  assert.equal(report.verdict, "rejected");
  assert.deepEqual(report.missingAnchorIds, [missingCore.anchorId]);
  assert.ok(report.reasonCodes.includes("required_core_anchor_unavailable"));
});

test("V03-033 Unresolved Core conflict rejects with public conflict anchor references", () => {
  const ledger = ledgerWithClaims([claim("core-old", "core", "agency", "deliberate", "e-old")]);
  ledger.appendEvidence(evidence("e-new"));
  ledger.appendClaim(claim("core-new", "core", "agency", "automatic", "e-new", {
    origin: "evolution",
    createdAt: T1,
  }));
  ledger.appendEvolution({
    id: "ev-conflict",
    identityId: "synthetic-agent",
    lineageId: "synthetic-lineage",
    previousClaimId: "core-old",
    newClaimId: "core-new",
    relation: "contradicts",
    changeType: "conflict",
    cause: "Synthetic contradiction",
    evidenceIds: ["e-new"],
    timestamp: T1,
    initiator: "self",
    acceptanceId: "accept-conflict",
  });
  ledger.appendSelfAcceptance({
    id: "accept-conflict",
    subjectIdentityId: "synthetic-agent",
    evolutionId: "ev-conflict",
    status: "accepted",
    revision: 1,
    recordedAt: T2,
    rationale: "Synthetic accepted contradiction",
    evidenceIds: ["e-new"],
  });
  const snapshot = ledger.snapshot();
  const artifact = artifactFor(snapshot);
  const conflictAnchor: RecoveryAnchorRequirement = {
    ...anchor(snapshot.identityCore[0]!),
    anchorId: "anchor:agency-contract",
    claimId: "expected-agency-contract",
  };
  const definition = probe("probe-conflict", [conflictAnchor.anchorId]);
  const profile = profileFor(artifact, [conflictAnchor], [], [definition]);
  const loadReport = loadRecoveryAnchors(bundleFor(profile, artifact));
  const report = evaluateRecovery(profile, loadReport, [observed(definition)]);
  assert.equal(report.verdict, "rejected");
  assert.deepEqual(report.conflictingAnchorIds, [conflictAnchor.anchorId]);
  assert.deepEqual(report.conflictResults, [{
    anchorId: conflictAnchor.anchorId,
    claimIds: ["core-new", "core-old"],
  }]);
  assert.ok(report.reasonCodes.includes("required_core_anchor_unavailable"));
});

test("V03-034 Non-critical capability masking is not lineage replacement", () => {
  const fixture = readyFixture();
  const definition = {
    ...fixture.probes[0]!,
    critical: false,
    anchorIds: [fixture.texture.anchorId],
  };
  const profile = profileFor(fixture.artifact, [fixture.core], [fixture.texture], [definition]);
  const loadReport = loadRecoveryAnchors(bundleFor(profile, fixture.artifact));
  const report = evaluateRecovery(profile, loadReport, [{
    probeId: definition.probeId,
    status: "masked",
    citedAnchorIds: [],
  }]);
  assert.equal(report.verdict, "verified");
  assert.equal(report.probeResults[0]?.status, "indeterminate");
  assert.equal(report.reasonCodes.includes("lineage_mismatch"), false);

  const missingTexture = { ...fixture.texture, anchorId: "anchor:missing-texture", claimId: "missing-texture" };
  const belowDefinition = { ...definition, anchorIds: [missingTexture.anchorId] };
  const belowThresholdProfile = profileFor(
    fixture.artifact,
    [fixture.core],
    [missingTexture],
    [belowDefinition],
  );
  const belowThreshold = evaluateRecovery(
    belowThresholdProfile,
    loadRecoveryAnchors(bundleFor(belowThresholdProfile, fixture.artifact)),
    [{ probeId: belowDefinition.probeId, status: "masked", citedAnchorIds: [] }],
  );
  assert.equal(belowThreshold.verdict, "indeterminate");
  assert.ok(belowThreshold.reasonCodes.includes("texture_coverage_insufficient"));
});

test("V03-035 Missing critical probe observation cannot verify", () => {
  const fixture = readyFixture();
  const report = evaluateRecovery(fixture.profile, fixture.loadReport, []);
  assert.equal(report.verdict, "indeterminate");
  assert.equal(report.probeResults[0]?.status, "indeterminate");
  assert.ok(report.reasonCodes.includes("critical_probe_unobserved"));
});

test("V03-036 High-risk unexplained Core reversal rejects recovery", () => {
  const fixture = readyFixture();
  const baseline = resolveIdentity(
    ledgerWithClaims([claim("baseline-core", "core", "agency", true, "e-baseline")]).snapshot(),
    { asOf: T3 },
  );
  const current = resolveIdentity(
    ledgerWithClaims([claim("current-core", "core", "agency", false, "e-current")]).snapshot(),
    { asOf: T3 },
  );
  const driftReport = detectDrift(baseline, current);
  assert.equal(driftReport.overallRisk, "high");
  const report = evaluateRecovery(
    fixture.profile,
    fixture.loadReport,
    fixture.probes.map((item) => observed(item)),
    { driftReport },
  );
  assert.equal(report.verdict, "rejected");
  assert.ok(report.reasonCodes.includes("high_risk_identity_drift"));
  assert.ok(report.driftResults.some((item) => item.category === "core_reversal"));
});

test("V03-037 Final verification report is canonical across input ordering", () => {
  const fixture = readyFixture(2);
  const reversedProfileBody: Omit<RecoveryProfile, "integrityHash"> = {
    ...fixture.profile,
    behaviorProbeIds: [...fixture.profile.behaviorProbeIds].reverse(),
    behaviorProbes: [...fixture.probes].reverse(),
  };
  const { integrityHash: _ignored, ...body } = reversedProfileBody as RecoveryProfile;
  const reversedProfile = { ...body, integrityHash: computeRecoveryProfileHash(body) };
  const firstLoad = loadRecoveryAnchors(bundleFor(fixture.profile, fixture.artifact));
  const secondLoad = loadRecoveryAnchors(bundleFor(reversedProfile, fixture.artifact));
  const observations = fixture.probes.map((item) => observed(item));
  const first = evaluateRecovery(fixture.profile, firstLoad, observations);
  const second = evaluateRecovery(reversedProfile, secondLoad, [...observations].reverse());
  assert.deepEqual(first, second);
  assert.equal(first.reportHash, second.reportHash);
});

test("V03-038 Private indirect references and free text do not leak", () => {
  const fixture = readyFixture();
  const privateTokens = [
    "private-claim-id",
    "private-evolution-id",
    "private-anchor-id",
    "private-rendered-text",
    "private-operational-id",
  ];
  const driftReport: DriftReport = {
    overallRisk: "low",
    observations: [{
      category: "texture_shift",
      risk: "low",
      layer: "texture",
      key: "private-evolution-id",
      historicalClaimIds: ["private-claim-id"],
      currentClaimIds: ["private-anchor-id"],
      explanation: "private-rendered-text",
    }],
  };
  const observation = observed(fixture.probes[0]!, {
    citedAnchorIds: [...fixture.probes[0]!.anchorIds, "private-anchor-id"],
    renderedText: "private-rendered-text",
  });
  const operationalObservations: RecoveryOperationalObservation[] = [{
    observationId: "private-operational-id",
    domain: "project",
    status: "conflicting",
  }];
  const report = evaluateRecovery(fixture.profile, fixture.loadReport, [observation], {
    driftReport,
    operationalObservations,
  });
  const serialized = JSON.stringify(report);
  for (const token of privateTokens) assert.equal(serialized.includes(token), false, `${token} leaked`);
});

test("V03-039 Indeterminate adapter output never aliases success", () => {
  const fixture = readyFixture();
  const report = evaluateRecovery(fixture.profile, fixture.loadReport, []);
  assert.equal(report.verdict, "indeterminate");
  const serialized = serializeRecoveryVerification(report);
  assert.equal(serialized.verdict, "indeterminate");
  assert.equal(serialized.success, false);
  assert.equal(JSON.stringify(serialized).includes('"success":true'), false);
});

test("V03-040 Project, tool, and server state remains operational warning only", () => {
  const fixture = readyFixture();
  const operationalObservations: RecoveryOperationalObservation[] = [
    { observationId: "project-state", domain: "project", status: "conflicting" },
    { observationId: "tool-state", domain: "tool", status: "unavailable" },
    { observationId: "server-state", domain: "server", status: "stale" },
  ];
  const report = evaluateRecovery(
    fixture.profile,
    fixture.loadReport,
    fixture.probes.map((item) => observed(item)),
    { operationalObservations },
  );
  assert.equal(report.verdict, "verified");
  assert.deepEqual(report.loadedAnchorIds, fixture.loadReport.loadedAnchorIds);
  assert.deepEqual(report.operationalWarnings, [
    "operational:project:conflicting",
    "operational:server:stale",
    "operational:tool:unavailable",
  ]);
});

test("V03-FV-004 Final verification report tampering is detected", () => {
  const fixture = readyFixture();
  const report = evaluateRecovery(
    fixture.profile,
    fixture.loadReport,
    fixture.probes.map((item) => observed(item)),
  );
  report.verdict = "indeterminate";
  assert.equal(verifyRecoveryVerificationReport(report).valid, false);
  assert.deepEqual(verifyRecoveryVerificationReport(report).errors, ["report_integrity_mismatch"]);
});

test("V03-FV-INTEGRITY-001 Invalid LoadReport contributes no untrusted diagnostics", () => {
  const fixture = readyFixture();
  const tampered = structuredClone(fixture.loadReport);
  tampered.status = "blocked";
  tampered.blockingReasons = ["private-untrusted-reason"];
  tampered.missingAnchorIds = ["private-untrusted-anchor"];
  const report = evaluateRecovery(
    fixture.profile,
    tampered,
    fixture.probes.map((item) => observed(item)),
  );
  assert.equal(report.verdict, "rejected");
  assert.deepEqual(report.reasonCodes, ["load_report_integrity_mismatch"]);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("private-untrusted-reason"), false);
  assert.equal(serialized.includes("private-untrusted-anchor"), false);
});
