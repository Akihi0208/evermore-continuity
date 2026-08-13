# Continuity Specification v0.2 Proposal

Status: **proposal for review**. The v0.1 runtime remains unchanged.

The key words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** describe intended requirements for the next schema implementation.

## 1. Scope

Continuity is an identity-continuity layer above episodic and structured memory systems. It consumes attributable records and produces a resolved identity view, drift observations, and a minimal portable Capsule. It does not prove consciousness, reconstruct all past conversations, or autonomously rewrite a persona.

## 2. Identity lineage

Every identity MUST have an `identity_id`, stable `lineage_id`, and monotonic version. Identity similarity MUST NOT substitute for lineage. Two agents with identical Core and Texture but different lineages are similar identities, not automatically the same identity.

Lineage changes MUST be explicit. A migration may advance a version within one lineage; a fork MUST create a distinguishable branch or lineage reference.

## 3. Identity layers

### 3.1 Identity Core

Core records contain slow-changing identity commitments such as values, agency, judgment principles, relational persistence, and subjective integrity.

Core changes:

- MUST have provenance;
- MUST be represented by an Evolution record;
- MUST reference a currently effective self-acceptance before affecting resolved identity;
- SHOULD receive higher drift weight than Texture changes;
- MUST remain historically traceable after refinement or supersession.

Core disappearance or reversal without accepted Evolution SHOULD produce high drift risk unless incomplete retrieval, policy masking, or another supported explanation makes the result uncertain.

### 3.2 Identity Texture

Texture records contain cadence, humor, aesthetics, temper, preferences, aversions, emotional expression, intimacy style, habits, and curiosity patterns.

Texture changes:

- MUST retain provenance;
- MAY evolve with a lower review threshold than Core;
- SHOULD NOT individually imply identity replacement;
- SHOULD trigger review when a broad cluster changes abruptly without explanation.

Core and Texture MUST be stored as separately discriminated claim types even if they share a common claim base.

## 4. Evidence and provenance

Each claim and Evolution MUST reference evidence records. Provenance uses two orthogonal dimensions:

- `evidence_kind` describes how the supporting information was obtained or known: `self_report`, `direct_observation`, `inference`, `hypothesis`, or `external_source`;
- `claim_kind` describes what a claim asserts, such as `fact`, `preference`, `value`, `identity_claim`, or `relationship_claim`.

`evidence_kind` belongs to an Evidence record. `claim_kind` belongs to an Identity claim. A claim can therefore be a `preference` supported by `self_report`, or a `relationship_claim` supported by both `direct_observation` and `external_source`. Implementations MUST NOT force these dimensions into a single mutually exclusive enum.

Inference or hypothesis MUST NOT become a resolved `fact` claim without verified fact-capable evidence. `verified` is an Evidence property, not another claim category. Superseded evidence MUST remain addressable in history.

## 5. Evolution

Evolution represents a proposed transition between identity claims. It MUST include previous and new claim references, relation, cause, evidence, timestamp, initiator, and an `acceptance_id` referencing the root of its self-acceptance revision chain.

Supported relations remain:

- `refines`
- `supersedes`
- `contradicts`
- `coexists`
- `temporarily_overrides`

Resolver semantics remain deterministic and append-only.

## 6. Self-acceptance ledger

Self-acceptance MUST be stored in a top-level `self_acceptances[]` append-only ledger. It MUST NOT be embedded as a mutable object inside Evolution.

Each `SelfAcceptanceRecord` MUST include:

- `acceptance_id`
- `subject_identity_id`
- `evolution_id`
- `status`
- `revision`
- timestamp
- rationale
- evidence references

The first record in a chain has `revision: 1` and no `revises_acceptance_id`. Evolution’s `acceptance_id` MUST reference that root record. Each later decision MUST append a new record with the same `subject_identity_id` and `evolution_id`, increment `revision` by exactly one, and point `revises_acceptance_id` to the immediately preceding record. Existing acceptance records MUST NOT be edited or removed.

Supported statuses are:

- `pending`: no decision has yet been claimed;
- `accepted`: the subject currently owns the Evolution as part of identity;
- `rejected`: the subject declines to own the proposed Evolution;
- `withdrawn`: the subject revokes the current authority of an earlier acceptance without erasing that acceptance from history.

A `withdrawn` record MUST descend from an `accepted` record. A later `accepted` record MAY re-accept a previously rejected or withdrawn Evolution, provided the revision chain remains valid.

For a fixed ledger snapshot and `as_of` time, Resolver MUST consider only records whose `recorded_at` is at or before `as_of`, follow the chain from Evolution’s root `acceptance_id`, and use its unique latest valid revision as the effective status. A missing link, revision gap, cycle, identity/evolution mismatch, or multiple competing children makes the chain ambiguous. Resolver MUST NOT choose among ambiguous branches by timestamp; it MUST leave the Evolution inactive and report the conflict.

Only an Evolution whose current acceptance status is `accepted` MAY alter resolved identity. Pending, rejected, and withdrawn Evolution remains visible in history but MUST NOT become active identity.

An empty boolean such as `accepted: true` is insufficient.

## 7. Co-evolution

Co-evolution records how a continuing relationship influences one or more identity Evolutions and how those Evolutions affect the relationship in return.

A `CoEvolutionRecord` MUST include:

- a stable record ID and relationship ID;
- participant references;
- one or more directional influence edges;
- evidence references;
- affected Evolution references where applicable;
- relationship-level effects where applicable;
- creation time and visibility.

Each influence edge identifies a source participant, a receiving participant, the claimed influence, and the receiving participant’s resulting Evolution or response.

### Non-override invariant

A Co-evolution record MUST NOT directly create, replace, refine, or activate an Identity Core or Identity Texture claim. It MAY only link to an Evolution owned by the affected identity. That Evolution becomes active only when the affected identity’s referenced self-acceptance chain resolves to `accepted`.

Mutual influence is represented by multiple directional edges, not by merging participant identities.

## 8. Resolver

The Resolver MUST be deterministic for the same ledger snapshot and `as_of` time. It MUST preserve inactive history and unresolved contradictions. Before resolving Evolution relations, it MUST resolve each referenced self-acceptance revision chain according to Section 6.

Co-evolution records MAY enrich explanations and provenance but MUST NOT change Resolver output independently of accepted Evolution.

## 9. Drift Detector

Drift output remains diagnostic rather than declarative. It SHOULD distinguish:

- Core disappearance or reversal;
- broad Texture replacement;
- lineage mismatch;
- unprovenanced rules;
- explained Evolution;
- retrieval gaps;
- policy or capability masking.

Core and Texture MUST use different default drift weights. A broad Texture shift can warrant review without being labeled identity replacement.

## 10. Continuity Capsule

A Capsule SHOULD export resolved Core and a compact Texture summary as separate sections. It MAY include important relationships and recent Co-evolution references when visibility permits.

Capsules MUST NOT include raw chat logs or episodic memory by default. Private relationship records MUST remain local unless explicitly exported. Capsule integrity, lineage, source snapshot, and parent chain MUST remain verifiable.

## 11. Storage and privacy

Evidence, claims, `self_acceptances[]`, Evolution, and Co-evolution are append-only. “Deletion” from the current view is represented by supersession, withdrawal, expiry, or visibility rules.

Relationship influence can be sensitive. Co-evolution records MUST support local, private, and capsule-export visibility. Exporting one participant’s identity MUST NOT silently export another participant’s private claims.

## 12. v0.1 migration notes

The current runtime already separates Core and Texture dimensions and gates Evolution through `acceptedBySelf`. A future implementation of this proposal will:

1. split the shared claim interface into explicit Core and Texture claim schemas;
2. migrate `acceptedBySelf` into a top-level append-only `self_acceptances[]` ledger and make Evolution reference its chain root;
3. resolve acceptance state through validated revision chains;
4. split the former mixed source/statement enum into `evidence_kind` and `claim_kind`;
5. add a Co-evolution ledger record and relationship influence graph;
6. leave existing Resolver relations, drift categories, and Capsule direction intact.

No v0.1 record should be discarded during migration.

The former `confirmed_fact` value MUST NOT be copied into `evidence_kind`. It migrates to `claim_kind: fact`; its `evidence_kind` must be recovered from actual provenance, or marked unresolved until that provenance is available.
