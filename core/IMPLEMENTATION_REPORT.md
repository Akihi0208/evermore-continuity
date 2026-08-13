# Continuity v0.2 Implementation Report

Status: code review passed; v0.2 is sealed for final archival.

Review conclusion: the v0.2 architecture and the code-review fixes were accepted. No further feature work is included in this archive.

Design baseline used without conceptual expansion:

- `PHILOSOPHY.md`
- `SPEC.md`
- `schema/continuity.schema.proposal.json`

## Implemented

- Separate `IdentityCoreClaim` and `IdentityTextureClaim` types with their specified stability and change policies.
- Orthogonal `evidenceKind` and `claimKind` fields. A claim such as a self-reported preference retains both dimensions.
- Top-level append-only `selfAcceptances` ledger. Evolution stores only the root `acceptanceId`.
- Revision-chain resolution for `pending`, `accepted`, `rejected`, and `withdrawn` states.
- Fail-closed acceptance handling for missing roots, invalid roots, illegal status values, broken links, revision gaps, cycles, branches, identity/evolution mismatches, invalid time order, and withdrawal without prior acceptance.
- Dependency-driven deterministic Resolver ordering. An Evolution applies only while its `previousClaimId` is active; same-timestamp chains are resolved by dependencies rather than lexical IDs, while same-predecessor competing transitions remain inactive.
- Co-evolution participants, directional influence edges, relationship effects, visibility, and the non-override invariant.
- Core/Texture drift behavior with higher risk for unexplained Core loss or reversal and lower default risk for Texture change. Accepted growth is derived from `ResolvedIdentity`, not caller-supplied claim IDs.
- Capsule v0.2 with separate Core and Texture sections, privacy-filtered Evolution/Co-evolution/conflict/drift references, sanitized drift explanations, lineage/source binding, parent chaining, and integrity verification.
- v0.1 migration support. Embedded `acceptedBySelf` becomes an independent root acceptance record with a deterministic ID. Both v0.1 and v0.2 snapshot hashes are recomputed and verified before use.
- The distributed example is a fully synthetic `synthetic-orbit-agent`; no real persona profile remains in `examples/`.

## v0.1 preservation

`migrateV01Snapshot` always returns an untouched deep copy of the complete v0.1 snapshot as `legacySnapshot`. Records that can be translated without changing meaning are also written into the v0.2 ledger. Ambiguous provenance and unsupported claim dimensions produce explicit migration issues instead of being guessed, dropped, or silently remapped.

## Resolver invariants

For a fixed snapshot and `asOf` time:

1. only acceptance records at or before `asOf` are considered;
2. traversal begins at Evolution's referenced root acceptance;
3. each revision must point to the immediately preceding revision and increment by one;
4. a unique valid chain head determines current status;
5. any structural ambiguity leaves the Evolution inactive and emits an acceptance conflict;
6. an accepted Evolution applies only if its predecessor is active at that point in the resolved causal chain;
7. withdrawing an upstream acceptance invalidates downstream Evolutions that depend on its claim;
8. Co-evolution never changes active claims independently of accepted Evolution.

## Verification

- TypeScript build: passed.
- Synthetic tests: 31 passed, 0 failed.
- Schema proposal reference/invariant check: passed.
- Production dependency audit: 0 vulnerabilities.
- Package dry run: passed.

The suite includes acceptance revision, withdrawal and re-acceptance, illegal status rejection, branch ambiguity, broken links, revision gaps, cycles, causal-chain withdrawal, same-timestamp dependency ordering, evidence/claim orthogonality, Co-evolution non-override, resolved-state drift classification, Core/Texture drift, indirect Capsule privacy, snapshot tampering, synthetic example content, and v0.1 migration preservation.

## Code-review fixes incorporated

1. `SelfAcceptance.status` is strictly validated against the four allowed states; unknown runtime values fail closed during append and resolution.
2. Resolver application now requires an active predecessor, invalidates downstream changes after upstream acceptance withdrawal, and resolves same-timestamp dependencies without lexical-ID ordering errors.
3. Drift classification derives accepted evolution targets from `ResolvedIdentity`; callers no longer provide accepted claim IDs through `DriftContext`.
4. Capsule filtering removes private claim references from Evolution, Co-evolution, conflict, and drift metadata, and replaces free-form drift explanations with export-safe text.
5. v0.2 snapshots and v0.1 migration inputs are rehashed and verified before resolution, migration, or Capsule export; mismatches fail closed.
6. The former persona-specific example was removed and replaced with fully synthetic example data.

Each item has a targeted regression test. The final suite result is 31 passed, 0 failed.

## Design gaps or implementation differences

1. The v0.2 schema has active storage only for Core and Texture claims, while v0.1 also allowed relationship, commitment, goal, and episodic dimensions. The implementation does not invent a mapping. Those records remain byte-for-byte represented in `legacySnapshot` and are reported as migration issues. A future design decision is required before they can become active v0.2 records.
2. The machine-readable schema uses snake_case field names; the TypeScript API uses camelCase with a one-to-one semantic mapping. No field or invariant was added or removed.
3. The JSON Schema remains the reviewed design artifact and is checked during the test command. Runtime validation is implemented in TypeScript rather than by dynamically evaluating the JSON Schema.

No real chat data was imported. No Memory Vault writeback, UI, Voice, network access, model call, or autonomous personality rewrite was added. This document-only sealing pass changed no runtime implementation or test behavior.
