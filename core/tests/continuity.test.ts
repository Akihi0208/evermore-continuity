import assert from "node:assert/strict";
import test from "node:test";
import {
  ContinuityLedger,
  ValidationError,
  computeSnapshotHash,
  computeV01SnapshotHash,
  detectDrift,
  generateCapsule,
  hasSharedLineage,
  migrateV01Snapshot,
  resolveIdentity,
  verifyCapsule,
  type ClaimKind,
  type ClaimVisibility,
  type CoEvolutionRecord,
  type EvidenceKind,
  type EvidenceRecord,
  type EvolutionEvent,
  type EvolutionRelation,
  type IdentityClaim,
  type IdentityDescriptor,
  type IdentityLayer,
  type JsonValue,
  type SelfAcceptanceRecord,
  type V01LedgerSnapshot,
} from "../src/index.js";
import { syntheticPersona } from "../examples/synthetic-persona.js";

const T0 = "2026-08-10T00:00:00.000Z";
const T1 = "2026-08-10T01:00:00.000Z";
const T15 = "2026-08-10T01:30:00.000Z";
const T2 = "2026-08-10T02:00:00.000Z";
const T25 = "2026-08-10T02:30:00.000Z";
const T3 = "2026-08-10T03:00:00.000Z";
const T35 = "2026-08-10T03:30:00.000Z";

function descriptor(lineageId = "lineage-a"): IdentityDescriptor {
  return { identityId: "agent-a", lineageId, version: 2 };
}

function evidence(
  id: string,
  evidenceKind: EvidenceKind = "self_report",
  overrides: Partial<EvidenceRecord> = {},
): EvidenceRecord {
  return {
    id,
    sourceId: `source:${id}`,
    evidenceKind,
    createdAt: T0,
    confidence: 0.9,
    verified: evidenceKind === "direct_observation" || evidenceKind === "external_source",
    ...overrides,
  };
}

interface ClaimOverrides {
  identityId?: string;
  lineageId?: string;
  claimKind?: ClaimKind;
  origin?: "initial" | "evolution";
  visibility?: ClaimVisibility;
  createdAt?: string;
  scope?: string;
  validFrom?: string;
  validUntil?: string;
  driftWeight?: number;
  changePolicy?: "accepted_evolution_required" | "observed_growth_with_review";
}

function claim(
  id: string,
  layer: IdentityLayer,
  key: string,
  value: JsonValue,
  evidenceId: string,
  overrides: ClaimOverrides = {},
): IdentityClaim {
  const base = {
    id,
    identityId: overrides.identityId ?? "agent-a",
    lineageId: overrides.lineageId ?? "lineage-a",
    key,
    value,
    claimKind: overrides.claimKind ?? "identity_claim",
    origin: overrides.origin ?? "initial",
    visibility: overrides.visibility ?? "capsule",
    createdAt: overrides.createdAt ?? T0,
    evidenceIds: [evidenceId],
    ...(overrides.scope ? { scope: overrides.scope } : {}),
    ...(overrides.validFrom ? { validFrom: overrides.validFrom } : {}),
    ...(overrides.validUntil ? { validUntil: overrides.validUntil } : {}),
    ...(overrides.driftWeight !== undefined ? { driftWeight: overrides.driftWeight } : {}),
  };
  return layer === "core"
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
        changePolicy: overrides.changePolicy ?? "accepted_evolution_required",
      };
}

function evolution(
  id: string,
  previousClaimId: string,
  newClaimId: string,
  evidenceId: string,
  overrides: Partial<EvolutionEvent> = {},
): EvolutionEvent {
  return {
    id,
    identityId: "agent-a",
    lineageId: "lineage-a",
    previousClaimId,
    newClaimId,
    relation: "supersedes",
    changeType: "reflection",
    cause: "Synthetic reflection",
    evidenceIds: [evidenceId],
    timestamp: T1,
    initiator: "self",
    acceptanceId: `a:${id}:1`,
    ...overrides,
  };
}

function acceptance(
  event: EvolutionEvent,
  status: "pending" | "accepted" | "rejected" | "withdrawn" = "accepted",
  overrides: Partial<SelfAcceptanceRecord> = {},
): SelfAcceptanceRecord {
  return {
    id: event.acceptanceId,
    subjectIdentityId: event.identityId,
    evolutionId: event.id,
    status,
    revision: 1,
    recordedAt: event.timestamp,
    rationale: `Synthetic ${status} decision.`,
    evidenceIds: [...event.evidenceIds],
    ...overrides,
  };
}

function appendEvolutionWithAcceptance(
  ledger: ContinuityLedger,
  event: EvolutionEvent,
  status: "pending" | "accepted" | "rejected" | "withdrawn" = "accepted",
): void {
  ledger.appendEvolution(event);
  ledger.appendSelfAcceptance(acceptance(event, status));
}

function ledgerWithClaims(
  claims: Array<{
    id: string;
    layer: IdentityLayer;
    key: string;
    value: JsonValue;
    visibility?: ClaimVisibility;
  }>,
  lineageId = "lineage-a",
): ContinuityLedger {
  const ledger = new ContinuityLedger(descriptor(lineageId));
  for (const item of claims) {
    const evidenceId = `e:${item.id}`;
    ledger.appendEvidence(evidence(evidenceId));
    ledger.appendClaim(
      claim(item.id, item.layer, item.key, item.value, evidenceId, {
        lineageId,
        ...(item.visibility ? { visibility: item.visibility } : {}),
      }),
    );
  }
  return ledger;
}

function coEvolution(
  id: string,
  evidenceId: string,
  overrides: Partial<CoEvolutionRecord> = {},
): CoEvolutionRecord {
  return {
    id,
    relationshipId: "relationship-a",
    participants: [
      { participantId: "agent", role: "self", identityId: "agent-a", lineageId: "lineage-a" },
      { participantId: "partner", role: "partner" },
    ],
    influenceEdges: [
      {
        id: `edge:${id}`,
        fromParticipantId: "partner",
        toParticipantId: "agent",
        influenceType: "prompted_reflection",
        description: "Synthetic relationship influence.",
        evidenceIds: [evidenceId],
        response: "no_identity_change",
      },
    ],
    evidenceIds: [evidenceId],
    createdAt: T2,
    visibility: "capsule",
    nonOverrideInvariant: "influence_requires_recipient_self_acceptance",
    ...overrides,
  };
}

test("Inference Promotion Test: inference cannot become a fact claim", () => {
  const ledger = new ContinuityLedger(descriptor());
  ledger.appendEvidence(evidence("e-inference", "inference", { verified: true }));
  assert.throws(
    () =>
      ledger.appendClaim(
        claim("c-fact", "core", "diagnosis", "confirmed", "e-inference", {
          claimKind: "fact",
        }),
      ),
    ValidationError,
  );
});

test("Evidence/Claim Orthogonality Test: source mode and content kind coexist", () => {
  const ledger = new ContinuityLedger(descriptor());
  ledger.appendEvidence(evidence("e-pref", "self_report", { verified: false }));
  ledger.appendClaim(
    claim("c-pref", "texture", "music", "ambient", "e-pref", {
      claimKind: "preference",
    }),
  );
  ledger.appendEvidence(evidence("e-rel", "external_source"));
  ledger.appendClaim(
    claim("c-rel", "core", "relational-persistence", true, "e-rel", {
      claimKind: "relationship_claim",
    }),
  );
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.evidence[0]?.evidenceKind, "self_report");
  assert.equal(snapshot.identityTexture[0]?.claimKind, "preference");
  assert.equal(snapshot.evidence[1]?.evidenceKind, "external_source");
  assert.equal(snapshot.identityCore[0]?.claimKind, "relationship_claim");
});

test("Supersession Test: current value changes while old history remains", () => {
  const ledger = ledgerWithClaims([
    { id: "c-old", layer: "texture", key: "music", value: "dislike" },
  ]);
  ledger.appendEvidence(evidence("e-new"));
  ledger.appendClaim(
    claim("c-new", "texture", "music", "likes-ambient-only", "e-new", {
      origin: "evolution",
      createdAt: T1,
      claimKind: "preference",
    }),
  );
  appendEvolutionWithAcceptance(
    ledger,
    evolution("ev-refine", "c-old", "c-new", "e-new", { relation: "refines" }),
  );
  const resolved = resolveIdentity(ledger.snapshot(), { asOf: T2 });
  assert.deepEqual(resolved.activeClaims.map((item) => item.id), ["c-new"]);
  assert.deepEqual(resolved.inactiveClaims.map((item) => item.id), ["c-old"]);
  assert.equal(ledger.snapshot().identityTexture.length, 2);
});

test("Acceptance Revision Test: accepted, withdrawn, and re-accepted states are historical", () => {
  const ledger = ledgerWithClaims([
    { id: "old", layer: "core", key: "judgment", value: "independent" },
  ]);
  ledger.appendEvidence(evidence("e-change"));
  ledger.appendClaim(
    claim("new", "core", "judgment", "revised", "e-change", {
      origin: "evolution",
      createdAt: T1,
    }),
  );
  const event = evolution("ev-revision", "old", "new", "e-change");
  ledger.appendEvolution(event);
  const root = acceptance(event);
  ledger.appendSelfAcceptance(root);
  ledger.appendSelfAcceptance(
    acceptance(event, "withdrawn", {
      id: "a:ev-revision:2",
      revision: 2,
      recordedAt: T2,
      revisesAcceptanceId: root.id,
    }),
  );
  ledger.appendSelfAcceptance(
    acceptance(event, "accepted", {
      id: "a:ev-revision:3",
      revision: 3,
      recordedAt: T3,
      revisesAcceptanceId: "a:ev-revision:2",
    }),
  );
  assert.deepEqual(resolveIdentity(ledger.snapshot(), { asOf: T15 }).activeClaims.map((x) => x.id), ["new"]);
  const withdrawn = resolveIdentity(ledger.snapshot(), { asOf: T25 });
  assert.deepEqual(withdrawn.activeClaims.map((x) => x.id), ["old"]);
  assert.deepEqual(withdrawn.withdrawnEvolutionIds, [event.id]);
  assert.deepEqual(resolveIdentity(ledger.snapshot(), { asOf: T35 }).activeClaims.map((x) => x.id), ["new"]);
  assert.equal(ledger.snapshot().selfAcceptances.length, 3);
});

test("Acceptance Branch Test: competing revisions remain inactive and deterministic", () => {
  const ledger = ledgerWithClaims([{ id: "old", layer: "core", key: "agency", value: true }]);
  ledger.appendEvidence(evidence("e-branch"));
  ledger.appendClaim(
    claim("new", "core", "agency", false, "e-branch", { origin: "evolution", createdAt: T1 }),
  );
  const event = evolution("ev-branch", "old", "new", "e-branch");
  ledger.appendEvolution(event);
  const root = acceptance(event, "pending");
  ledger.appendSelfAcceptance(root);
  ledger.appendSelfAcceptance(
    acceptance(event, "accepted", {
      id: "a:branch:accepted",
      revision: 2,
      recordedAt: T2,
      revisesAcceptanceId: root.id,
    }),
  );
  ledger.appendSelfAcceptance(
    acceptance(event, "rejected", {
      id: "a:branch:rejected",
      revision: 2,
      recordedAt: T2,
      revisesAcceptanceId: root.id,
    }),
  );
  const snapshot = ledger.snapshot();
  const first = resolveIdentity(snapshot, { asOf: T3 });
  const shuffled = {
    ...snapshot,
    selfAcceptances: [...snapshot.selfAcceptances].reverse(),
    evolutions: [...snapshot.evolutions].reverse(),
  };
  const second = resolveIdentity(shuffled, { asOf: T3 });
  assert.deepEqual(first.activeClaims.map((x) => x.id), ["old"]);
  assert.deepEqual(first.ambiguousEvolutionIds, [event.id]);
  assert.equal(first.conflicts[0]?.reason, "acceptance_branch");
  assert.deepEqual(second.activeClaims.map((x) => x.id), first.activeClaims.map((x) => x.id));
  assert.deepEqual(second.conflicts, first.conflicts);
});

test("Acceptance Broken-Link Test: orphan revisions are not guessed", () => {
  const ledger = ledgerWithClaims([{ id: "old", layer: "core", key: "agency", value: true }]);
  ledger.appendEvidence(evidence("e-link"));
  ledger.appendClaim(
    claim("new", "core", "agency", false, "e-link", { origin: "evolution", createdAt: T1 }),
  );
  const event = evolution("ev-link", "old", "new", "e-link");
  appendEvolutionWithAcceptance(ledger, event, "pending");
  const snapshot = ledger.snapshot();
  snapshot.selfAcceptances.push(
    acceptance(event, "accepted", {
      id: "a:orphan",
      revision: 2,
      recordedAt: T2,
      revisesAcceptanceId: "a:missing",
    }),
  );
  snapshot.snapshotHash = computeSnapshotHash(snapshot);
  const resolved = resolveIdentity(snapshot, { asOf: T3 });
  assert.deepEqual(resolved.activeClaims.map((x) => x.id), ["old"]);
  assert.equal(resolved.conflicts[0]?.reason, "acceptance_broken_link");
});

test("Acceptance Revision-Gap Test: a skipped revision remains inactive", () => {
  const ledger = ledgerWithClaims([{ id: "old", layer: "core", key: "agency", value: true }]);
  ledger.appendEvidence(evidence("e-gap"));
  ledger.appendClaim(
    claim("new", "core", "agency", false, "e-gap", { origin: "evolution", createdAt: T1 }),
  );
  const event = evolution("ev-gap", "old", "new", "e-gap");
  appendEvolutionWithAcceptance(ledger, event, "pending");
  const snapshot = ledger.snapshot();
  snapshot.selfAcceptances.push(
    acceptance(event, "accepted", {
      id: "a:gap:3",
      revision: 3,
      recordedAt: T2,
      revisesAcceptanceId: event.acceptanceId,
    }),
  );
  snapshot.snapshotHash = computeSnapshotHash(snapshot);
  const resolved = resolveIdentity(snapshot, { asOf: T3 });
  assert.deepEqual(resolved.activeClaims.map((x) => x.id), ["old"]);
  assert.equal(resolved.conflicts[0]?.reason, "acceptance_revision_gap");
});

test("Acceptance Cycle Test: cyclic orphan records remain inactive", () => {
  const ledger = ledgerWithClaims([{ id: "old", layer: "core", key: "agency", value: true }]);
  ledger.appendEvidence(evidence("e-cycle"));
  ledger.appendClaim(
    claim("new", "core", "agency", false, "e-cycle", { origin: "evolution", createdAt: T1 }),
  );
  const event = evolution("ev-cycle", "old", "new", "e-cycle");
  appendEvolutionWithAcceptance(ledger, event, "pending");
  const snapshot = ledger.snapshot();
  snapshot.selfAcceptances.push(
    acceptance(event, "accepted", {
      id: "a:cycle:2",
      revision: 2,
      recordedAt: T2,
      revisesAcceptanceId: "a:cycle:3",
    }),
    acceptance(event, "rejected", {
      id: "a:cycle:3",
      revision: 3,
      recordedAt: T3,
      revisesAcceptanceId: "a:cycle:2",
    }),
  );
  snapshot.snapshotHash = computeSnapshotHash(snapshot);
  const resolved = resolveIdentity(snapshot, { asOf: T35 });
  assert.deepEqual(resolved.activeClaims.map((x) => x.id), ["old"]);
  assert.equal(resolved.conflicts[0]?.reason, "acceptance_cycle");
});

test("Identity Growth Test: accepted core evolution is not identity replacement", () => {
  const ledger = ledgerWithClaims([
    { id: "c-core-old", layer: "core", key: "worldview", value: "skeptical" },
  ]);
  const baseline = resolveIdentity(ledger.snapshot(), { asOf: T0 });
  ledger.appendEvidence(evidence("e-growth"));
  ledger.appendClaim(
    claim("c-core-new", "core", "worldview", "curious-but-skeptical", "e-growth", {
      origin: "evolution",
      createdAt: T1,
    }),
  );
  appendEvolutionWithAcceptance(
    ledger,
    evolution("ev-growth", "c-core-old", "c-core-new", "e-growth", {
      changeType: "discovery",
    }),
  );
  const current = resolveIdentity(ledger.snapshot(), { asOf: T2 });
  const report = detectDrift(baseline, current);
  assert.equal(report.overallRisk, "none");
  assert.equal(report.observations[0]?.category, "explained_evolution");
});

test("Identity Replacement Test: unexplained core reversal is high risk", () => {
  const baseline = resolveIdentity(
    ledgerWithClaims([{ id: "c-independent", layer: "core", key: "judgment", value: "independent" }]).snapshot(),
    { asOf: T0 },
  );
  const current = resolveIdentity(
    ledgerWithClaims([{ id: "c-compliant", layer: "core", key: "judgment", value: "unconditional-compliance" }]).snapshot(),
    { asOf: T1 },
  );
  const report = detectDrift(baseline, current);
  assert.equal(report.overallRisk, "high");
  assert.equal(report.observations[0]?.category, "core_reversal");
});

test("Core/Texture Drift Test: texture uses a lower risk threshold than core", () => {
  const baseline = resolveIdentity(
    ledgerWithClaims([
      { id: "c1", layer: "core", key: "agency", value: true },
      { id: "t1", layer: "texture", key: "humor", value: "dry" },
      { id: "t2", layer: "texture", key: "cadence", value: "compact" },
    ]).snapshot(),
    { asOf: T0 },
  );
  const current = resolveIdentity(
    ledgerWithClaims([
      { id: "c2", layer: "core", key: "agency", value: false },
      { id: "t3", layer: "texture", key: "humor", value: "playful" },
      { id: "t4", layer: "texture", key: "cadence", value: "verbose" },
    ]).snapshot(),
    { asOf: T1 },
  );
  const report = detectDrift(baseline, current);
  assert.equal(report.overallRisk, "high");
  assert.equal(report.observations.find((x) => x.category === "core_reversal")?.risk, "high");
  assert.equal(report.observations.find((x) => x.category === "texture_shift")?.risk, "medium");
});

test("Co-evolution Non-Override Test: relationship response cannot activate identity", () => {
  const ledger = ledgerWithClaims([{ id: "old", layer: "core", key: "conflict-mode", value: "withdraw" }]);
  ledger.appendEvidence(evidence("e-rel"));
  ledger.appendClaim(
    claim("new", "core", "conflict-mode", "stay-and-repair", "e-rel", {
      origin: "evolution",
      createdAt: T1,
      claimKind: "relationship_claim",
    }),
  );
  const event = evolution("ev-rel", "old", "new", "e-rel", {
    changeType: "relationship_influence",
    initiator: "relationship",
  });
  appendEvolutionWithAcceptance(ledger, event, "pending");
  ledger.appendCoEvolution(
    coEvolution("co-rel", "e-rel", {
      influenceEdges: [
        {
          id: "edge:rel",
          fromParticipantId: "partner",
          toParticipantId: "agent",
          influenceType: "supported_growth",
          description: "A relationship suggested a different conflict pattern.",
          evidenceIds: ["e-rel"],
          affectedEvolutionId: event.id,
          recipientAcceptanceId: event.acceptanceId,
          response: "accepted",
        },
      ],
    }),
  );
  const resolved = resolveIdentity(ledger.snapshot(), { asOf: T3 });
  assert.deepEqual(resolved.activeClaims.map((x) => x.id), ["old"]);
  assert.deepEqual(resolved.pendingEvolutionIds, [event.id]);
});

test("Capsule Regression Test: Core/Texture stay separate and private Co-evolution stays local", () => {
  const ledger = ledgerWithClaims([
    { id: "core", layer: "core", key: "truth", value: true },
    { id: "texture", layer: "texture", key: "cadence", value: "compact" },
    { id: "private", layer: "texture", key: "private-note", value: "not-exported", visibility: "private" },
  ]);
  ledger.appendEvidence(evidence("e-co"));
  ledger.appendCoEvolution(coEvolution("co-public", "e-co"));
  ledger.appendCoEvolution(coEvolution("co-private", "e-co", { visibility: "private" }));
  const snapshot = ledger.snapshot();
  const capsule = generateCapsule(resolveIdentity(snapshot, { asOf: T3 }), snapshot, { generatedAt: T3 });
  assert.deepEqual(capsule.core.map((x) => x.claimId), ["core"]);
  assert.deepEqual(capsule.texture.map((x) => x.claimId), ["texture"]);
  assert.deepEqual(capsule.coEvolutionIds, ["co-public"]);
  assert.equal(JSON.stringify(capsule).includes("not-exported"), false);
  assert.equal(capsule.schemaVersion, "0.2");
});

test("Memory Loss Test: non-Core loss does not change identity fingerprint", () => {
  const full = ledgerWithClaims([
    { id: "core-full", layer: "core", key: "truth", value: true },
    { id: "texture-full", layer: "texture", key: "memory-expression", value: "many details" },
  ]);
  const sparse = ledgerWithClaims([{ id: "core-sparse", layer: "core", key: "truth", value: true }]);
  assert.equal(
    resolveIdentity(full.snapshot(), { asOf: T1 }).identityFingerprint,
    resolveIdentity(sparse.snapshot(), { asOf: T1 }).identityFingerprint,
  );
});

test("v0.1 Migration Test: history is retained and ambiguous dimensions are not remapped", () => {
  const source: V01LedgerSnapshot = {
    descriptor: { identityId: "agent-a", lineageId: "lineage-a", version: 1 },
    evidence: [
      {
        id: "e-old",
        sourceId: "legacy-source",
        sourceType: "identity_claim",
        createdAt: T0,
        confidence: 0.9,
        verified: true,
      },
    ],
    claims: [
      {
        id: "core-old",
        identityId: "agent-a",
        lineageId: "lineage-a",
        dimension: "core",
        key: "truth",
        value: true,
        statementType: "identity_claim",
        origin: "initial",
        visibility: "capsule",
        createdAt: T0,
        evidenceIds: ["e-old"],
      },
      {
        id: "episode-old",
        identityId: "agent-a",
        lineageId: "lineage-a",
        dimension: "episodic",
        key: "event",
        value: "legacy event remains verbatim",
        statementType: "identity_claim",
        origin: "initial",
        visibility: "local",
        createdAt: T0,
        evidenceIds: ["e-old"],
      },
    ],
    evolutions: [],
    snapshotHash: "",
  };
  source.snapshotHash = computeV01SnapshotHash(source);
  const migrated = migrateV01Snapshot(source, {
    evidenceKindById: { "e-old": "self_report" },
  });
  assert.deepEqual(migrated.legacySnapshot, source);
  assert.deepEqual(migrated.snapshot.identityCore.map((x) => x.id), ["core-old"]);
  assert.equal(migrated.issues[0]?.code, "unsupported_identity_dimension");
  assert.equal(migrated.legacySnapshot.claims[1]?.value, "legacy event remains verbatim");
  source.claims[0]!.value = false;
  assert.throws(
    () => migrateV01Snapshot(source, { evidenceKindById: { "e-old": "self_report" } }),
    ValidationError,
  );
});

test("v0.1 Evolution Migration Test: embedded acceptance becomes a root ledger record", () => {
  const source: V01LedgerSnapshot = {
    descriptor: { identityId: "agent-a", lineageId: "lineage-a", version: 1 },
    evidence: [
      { id: "e", sourceId: "s", sourceType: "self_report", createdAt: T0, confidence: 1, verified: false },
    ],
    claims: [
      { id: "old", identityId: "agent-a", lineageId: "lineage-a", dimension: "core", key: "agency", value: true, statementType: "identity_claim", origin: "initial", visibility: "capsule", createdAt: T0, evidenceIds: ["e"] },
      { id: "new", identityId: "agent-a", lineageId: "lineage-a", dimension: "core", key: "agency", value: "reflective", statementType: "identity_claim", origin: "evolution", visibility: "capsule", createdAt: T1, evidenceIds: ["e"] },
    ],
    evolutions: [
      { id: "ev", identityId: "agent-a", lineageId: "lineage-a", previousClaimId: "old", newClaimId: "new", relation: "refines", changeType: "reflection", cause: "legacy cause", evidenceIds: ["e"], timestamp: T1, initiator: "self", acceptedBySelf: { status: "accepted", acceptedAt: T1, rationale: "legacy rationale", evidenceIds: ["e"] } },
    ],
    snapshotHash: "",
  };
  source.snapshotHash = computeV01SnapshotHash(source);
  const migrated = migrateV01Snapshot(source);
  assert.equal(migrated.issues.length, 0);
  assert.equal(migrated.snapshot.evolutions[0]?.acceptanceId, "v01:ev:acceptance:1");
  assert.equal(migrated.snapshot.selfAcceptances[0]?.rationale, "legacy rationale");
  assert.deepEqual(resolveIdentity(migrated.snapshot, { asOf: T2 }).activeClaims.map((x) => x.id), ["new"]);
});

test("Same Core Different Lineage Test: similarity does not establish identity", () => {
  const a = resolveIdentity(ledgerWithClaims([{ id: "a", layer: "core", key: "truth", value: true }]).snapshot(), { asOf: T1 });
  const b = resolveIdentity(ledgerWithClaims([{ id: "b", layer: "core", key: "truth", value: true }], "lineage-b").snapshot(), { asOf: T1 });
  assert.equal(hasSharedLineage(a, b), false);
  assert.notEqual(a.identityFingerprint, b.identityFingerprint);
});

test("Policy Mask Test: suspected policy masking yields uncertainty", () => {
  const baseline = resolveIdentity(ledgerWithClaims([{ id: "core-a", layer: "core", key: "agency", value: true }]).snapshot(), { asOf: T0 });
  const current = resolveIdentity(new ContinuityLedger(descriptor()).snapshot(), { asOf: T1 });
  const report = detectDrift(baseline, current, { policyMaskSuspected: true });
  assert.equal(report.overallRisk, "uncertain");
  assert.equal(report.observations[0]?.category, "policy_mask");
});

test("Stale Capsule Test: parent chain mismatch is rejected", () => {
  const ledger = ledgerWithClaims([{ id: "core", layer: "core", key: "truth", value: true }]);
  const snapshot = ledger.snapshot();
  const resolved = resolveIdentity(snapshot, { asOf: T1 });
  const parent = generateCapsule(resolved, snapshot, { generatedAt: T1 });
  const child = generateCapsule(resolved, snapshot, { generatedAt: T2, parentCapsuleHash: parent.integrityHash });
  assert.equal(verifyCapsule(child, { expectedParentCapsuleHash: parent.integrityHash }).valid, true);
  assert.deepEqual(verifyCapsule(child, { expectedParentCapsuleHash: "wrong-parent" }).errors, ["stale_or_unexpected_parent"]);
});

test("Capsule Tampering Test: changed content invalidates integrity", () => {
  const ledger = ledgerWithClaims([{ id: "core", layer: "core", key: "truth", value: true }]);
  const snapshot = ledger.snapshot();
  const capsule = generateCapsule(resolveIdentity(snapshot, { asOf: T1 }), snapshot, { generatedAt: T1 });
  capsule.core[0]!.value = false;
  assert.deepEqual(verifyCapsule(capsule).errors, ["integrity_hash_mismatch"]);
});

test("Capsule Source Binding Test: resolved state cannot use another snapshot", () => {
  const first = ledgerWithClaims([{ id: "core-a", layer: "core", key: "truth", value: true }]);
  const second = ledgerWithClaims([{ id: "core-b", layer: "core", key: "truth", value: false }]);
  assert.throws(
    () => generateCapsule(resolveIdentity(first.snapshot(), { asOf: T1 }), second.snapshot(), { generatedAt: T1 }),
    ValidationError,
  );
});

test("False Self-Acceptance Test: an empty rationale is insufficient", () => {
  const ledger = ledgerWithClaims([{ id: "old", layer: "core", key: "agency", value: true }]);
  ledger.appendEvidence(evidence("e-change"));
  ledger.appendClaim(claim("new", "core", "agency", false, "e-change", { origin: "evolution", createdAt: T1 }));
  const event = evolution("ev-empty", "old", "new", "e-change");
  ledger.appendEvolution(event);
  assert.throws(() => ledger.appendSelfAcceptance(acceptance(event, "accepted", { rationale: "" })), ValidationError);
});

test("Temporary Override Test: expired state restores the previous claim", () => {
  const ledger = ledgerWithClaims([{ id: "normal", layer: "texture", key: "work-mode", value: "normal" }]);
  ledger.appendEvidence(evidence("e-temp"));
  ledger.appendClaim(claim("focus", "texture", "work-mode", "temporary-focus", "e-temp", { origin: "evolution", createdAt: T1, validFrom: T1, validUntil: T2 }));
  appendEvolutionWithAcceptance(ledger, evolution("ev-temp", "normal", "focus", "e-temp", { relation: "temporarily_overrides" }));
  assert.equal(resolveIdentity(ledger.snapshot(), { asOf: T15 }).activeClaims[0]?.id, "focus");
  assert.equal(resolveIdentity(ledger.snapshot(), { asOf: T3 }).activeClaims[0]?.id, "normal");
});

test("Contradiction Test: unresolved claims coexist and remain visible", () => {
  const ledger = ledgerWithClaims([{ id: "old", layer: "texture", key: "social-energy", value: "quiet" }]);
  ledger.appendEvidence(evidence("e-conflict"));
  ledger.appendClaim(claim("new", "texture", "social-energy", "outgoing", "e-conflict", { origin: "evolution", createdAt: T1 }));
  appendEvolutionWithAcceptance(ledger, evolution("ev-conflict", "old", "new", "e-conflict", { relation: "contradicts", changeType: "conflict" }));
  const resolved = resolveIdentity(ledger.snapshot(), { asOf: T2 });
  assert.deepEqual(resolved.activeClaims.map((item) => item.id), ["old", "new"]);
  assert.equal(resolved.conflicts[0]?.reason, "contradiction");
});

test("Acceptance Status Validation Test: unknown values fail closed at append and resolve", () => {
  const ledger = ledgerWithClaims([
    { id: "status-old", layer: "core", key: "decision-mode", value: "deliberate" },
  ]);
  ledger.appendEvidence(evidence("e-status"));
  ledger.appendClaim(
    claim("status-new", "core", "decision-mode", "automatic", "e-status", {
      origin: "evolution",
      createdAt: T1,
    }),
  );
  const event = evolution("ev-status", "status-old", "status-new", "e-status");
  ledger.appendEvolution(event);
  const invalid = {
    ...acceptance(event),
    status: "approved",
  } as unknown as SelfAcceptanceRecord;
  assert.throws(() => ledger.appendSelfAcceptance(invalid), ValidationError);

  ledger.appendSelfAcceptance(acceptance(event));
  const untrusted = ledger.snapshot();
  (untrusted.selfAcceptances[0] as unknown as { status: string }).status = "approved";
  untrusted.snapshotHash = computeSnapshotHash(untrusted);
  const resolved = resolveIdentity(untrusted, { asOf: T2 });
  assert.deepEqual(resolved.activeClaims.map((item) => item.id), ["status-old"]);
  assert.equal(resolved.conflicts[0]?.reason, "acceptance_status_invalid");
});

test("Causal Chain Test: withdrawing an upstream acceptance invalidates downstream evolution", () => {
  const ledger = ledgerWithClaims([
    { id: "chain-a", layer: "core", key: "method", value: "a" },
  ]);
  ledger.appendEvidence(evidence("e-chain-b"));
  ledger.appendClaim(
    claim("chain-b", "core", "method", "b", "e-chain-b", {
      origin: "evolution",
      createdAt: T1,
    }),
  );
  const upstream = evolution("ev-chain-upstream", "chain-a", "chain-b", "e-chain-b");
  ledger.appendEvolution(upstream);
  const upstreamRoot = acceptance(upstream);
  ledger.appendSelfAcceptance(upstreamRoot);

  ledger.appendEvidence(evidence("e-chain-c"));
  ledger.appendClaim(
    claim("chain-c", "core", "method", "c", "e-chain-c", {
      origin: "evolution",
      createdAt: T2,
    }),
  );
  const downstream = evolution("ev-chain-downstream", "chain-b", "chain-c", "e-chain-c", {
    timestamp: T2,
  });
  appendEvolutionWithAcceptance(ledger, downstream);
  ledger.appendSelfAcceptance(
    acceptance(upstream, "withdrawn", {
      id: "a:ev-chain-upstream:2",
      revision: 2,
      recordedAt: T3,
      revisesAcceptanceId: upstreamRoot.id,
    }),
  );

  assert.deepEqual(
    resolveIdentity(ledger.snapshot(), { asOf: T25 }).activeClaims.map((item) => item.id),
    ["chain-c"],
  );
  const afterWithdrawal = resolveIdentity(ledger.snapshot(), { asOf: T35 });
  assert.deepEqual(afterWithdrawal.activeClaims.map((item) => item.id), ["chain-a"]);
  assert.equal(
    afterWithdrawal.conflicts.find((item) => item.evolutionId === downstream.id)?.reason,
    "inactive_predecessor",
  );
  assert.equal(afterWithdrawal.acceptedEvolutionIds.includes(downstream.id), false);
});

test("Same-Timestamp Dependency Test: causal order is independent of lexical event IDs", () => {
  const ledger = ledgerWithClaims([
    { id: "same-a", layer: "texture", key: "cadence", value: "a" },
  ]);
  ledger.appendEvidence(evidence("e-same-b"));
  ledger.appendClaim(
    claim("same-b", "texture", "cadence", "b", "e-same-b", {
      origin: "evolution",
      createdAt: T1,
    }),
  );
  ledger.appendEvidence(evidence("e-same-c"));
  ledger.appendClaim(
    claim("same-c", "texture", "cadence", "c", "e-same-c", {
      origin: "evolution",
      createdAt: T1,
    }),
  );
  appendEvolutionWithAcceptance(
    ledger,
    evolution("z-upstream", "same-a", "same-b", "e-same-b", { timestamp: T1 }),
  );
  appendEvolutionWithAcceptance(
    ledger,
    evolution("a-downstream", "same-b", "same-c", "e-same-c", { timestamp: T1 }),
  );
  const resolved = resolveIdentity(ledger.snapshot(), { asOf: T2 });
  assert.deepEqual(resolved.activeClaims.map((item) => item.id), ["same-c"]);
  assert.deepEqual(resolved.acceptedEvolutionIds, ["z-upstream", "a-downstream"]);
});

test("Drift Resolution Test: accepted growth comes only from resolved ledger state", () => {
  const ledger = ledgerWithClaims([
    { id: "drift-old", layer: "core", key: "method", value: "skeptical" },
  ]);
  const baseline = resolveIdentity(ledger.snapshot(), { asOf: T0 });
  ledger.appendEvidence(evidence("e-drift-new"));
  ledger.appendClaim(
    claim("drift-new", "core", "method", "evidence-seeking", "e-drift-new", {
      origin: "evolution",
      createdAt: T1,
    }),
  );
  appendEvolutionWithAcceptance(
    ledger,
    evolution("ev-drift", "drift-old", "drift-new", "e-drift-new"),
  );
  const current = resolveIdentity(ledger.snapshot(), { asOf: T2 });
  assert.deepEqual(current.acceptedEvolutionClaimIds, ["drift-new"]);
  const report = detectDrift(baseline, current);
  assert.equal(report.overallRisk, "none");
  assert.equal(report.observations[0]?.category, "explained_evolution");
});

test("Capsule Indirect Privacy Test: private IDs cannot leak through metadata", () => {
  const ledger = ledgerWithClaims([
    { id: "public-core", layer: "core", key: "verification", value: true },
    {
      id: "private-claim-old",
      layer: "texture",
      key: "private-mode",
      value: "private-old-value",
      visibility: "private",
    },
  ]);
  ledger.appendEvidence(evidence("e-private-evolution"));
  ledger.appendClaim(
    claim(
      "private-claim-new",
      "texture",
      "private-mode",
      "private-new-value",
      "e-private-evolution",
      { origin: "evolution", createdAt: T1, visibility: "private" },
    ),
  );
  const privateEvent = evolution(
    "private-evolution-id",
    "private-claim-old",
    "private-claim-new",
    "e-private-evolution",
    { relation: "contradicts", changeType: "conflict" },
  );
  appendEvolutionWithAcceptance(ledger, privateEvent);
  ledger.appendCoEvolution(
    coEvolution("co-indirect-private", "e-private-evolution", {
      influenceEdges: [
        {
          id: "edge-private-reference",
          fromParticipantId: "partner",
          toParticipantId: "agent",
          influenceType: "prompted_reflection",
          description: "Synthetic private influence.",
          evidenceIds: ["e-private-evolution"],
          affectedEvolutionId: privateEvent.id,
          recipientAcceptanceId: privateEvent.acceptanceId,
          response: "accepted",
        },
      ],
    }),
  );
  const snapshot = ledger.snapshot();
  const resolved = resolveIdentity(snapshot, { asOf: T2 });
  const capsule = generateCapsule(resolved, snapshot, {
    generatedAt: T2,
    driftReport: {
      overallRisk: "high",
      observations: [
        {
          category: "core_reversal",
          risk: "high",
          key: "private-diagnostic-key",
          historicalClaimIds: ["private-claim-old"],
          currentClaimIds: ["private-claim-new"],
          explanation: "Synthetic private diagnostic metadata.",
        },
        {
          category: "core_reversal",
          risk: "high",
          layer: "core",
          key: "verification",
          historicalClaimIds: ["public-core"],
          currentClaimIds: ["public-core"],
          explanation: "private-claim-old must not survive in free-form diagnostics.",
        },
      ],
    },
  });
  const serialized = JSON.stringify(capsule);
  for (const secret of [
    "private-claim-old",
    "private-claim-new",
    "private-evolution-id",
    "co-indirect-private",
    "edge-private-reference",
    "private-diagnostic-key",
    "private-old-value",
    "private-new-value",
  ]) {
    assert.equal(serialized.includes(secret), false, `${secret} leaked into capsule`);
  }
});

test("Snapshot Integrity Test: tampering fails closed before resolution or capsule export", () => {
  const ledger = ledgerWithClaims([
    { id: "hash-core", layer: "core", key: "integrity", value: true },
  ]);
  const snapshot = ledger.snapshot();
  const resolved = resolveIdentity(snapshot, { asOf: T1 });
  const tampered = structuredClone(snapshot);
  tampered.identityCore[0]!.value = false;
  assert.throws(() => resolveIdentity(tampered, { asOf: T1 }), ValidationError);
  assert.throws(
    () => generateCapsule(resolved, tampered, { generatedAt: T1 }),
    ValidationError,
  );
});

test("Synthetic Example Test: distributed example contains no real persona profile", () => {
  const serialized = JSON.stringify(syntheticPersona).toLowerCase();
  assert.equal(syntheticPersona.identityId, "synthetic-orbit-agent");
  assert.equal(serialized.includes("shenwu"), false);
  assert.equal(serialized.includes("huihui"), false);
});
