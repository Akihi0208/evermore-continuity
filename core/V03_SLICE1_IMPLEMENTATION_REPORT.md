# Continuity v0.3 Alpha 2 — Slice 1 Implementation Report

> Historical alpha.2 baseline. Alpha.3 adds the final verifier and two additional freshness overlap tests; see `V03_FINAL_VERIFIER_IMPLEMENTATION_REPORT.md` for current status.

Status: **implemented; review candidate**  
Date: 2026-08-12  
Scope: RecoveryProfile/RecoveryBundle, trusted-head selection, anchor loading, staleness, and RecoveryLoadReport only.

## Result

The first v0.3 implementation slice is complete. It is isolated in `src/recovery-v03/` and does not alter v0.2 Resolver, Ledger, Capsule, Drift Detector, migration, schema, examples, documentation, or the original test file.

Package metadata identifies this freshness-hardened review artifact as `0.3.0-alpha.2`. The supplied sealed v0.2 ZIP and the prior alpha.1 deliverable remain untouched.

## Test-first evidence

The v0.3 acceptance test file was added before the implementation. Its first run failed during TypeScript build because `../src/recovery-v03/index.js` did not exist. Implementation began only after that expected red result was recorded.

Alpha.1 first reached 27/27 Slice 1 tests. Alpha.2 then added freshness-hardening acceptance tests before changing implementation; the initial five requested boundary tests failed 5/5 against alpha.1, while all prior 27 remained green. Additional audit tests exposed and fixed stricter-bound composition and reversed-validity handling.

After freshness hardening:

- v0.3 Slice 1 tests: **37 passed, 0 failed**;
- v0.2 regression: **31 passed, 0 failed**;
- combined suite: **68 passed, 0 failed**;
- v0.3 Slice 1 suite under `TZ=UTC`: **37 passed**;
- v0.3 Slice 1 suite under `TZ=Asia/Shanghai`: **37 passed**;
- schema invariant check: passed;
- production dependency audit: 0 vulnerabilities;
- package dry run: passed, 31 files, 0.3.0-alpha.2.

## Changed files

### New runtime files

- `src/recovery-v03/types.ts`
- `src/recovery-v03/integrity.ts`
- `src/recovery-v03/head-selection.ts`
- `src/recovery-v03/load.ts`
- `src/recovery-v03/index.ts`

### New tests and documentation

- `tests/recovery-v03-slice1.test.ts`
- `V03_SLICE1.md`
- `V03_SLICE1_IMPLEMENTATION_REPORT.md`

### Metadata-only changes

- `package.json`: version advanced to `0.3.0-alpha.2`; separate v0.2 and v0.3 test commands remain.
- `package-lock.json`: root package version advanced to `0.3.0-alpha.2`.

All other files from the v0.2 archive are byte-identical. In particular, both copies of `tests/continuity.test.ts` have SHA-256:

`60eee0599c53ab421b40d1af03c088ff4a4f9c7623fa22e385bb2d91491bc3`

## Design decisions

### Recovery contract

`RecoveryProfile` is an integrity-protected contract containing:

- expected lineage;
- expected trusted snapshot or Capsule head;
- exact required Core anchors;
- weighted Texture anchors and explicit minimum coverage;
- observation freshness policies;
- reserved behavioral probe IDs for the later slice.

An empty Core contract is invalid. Anchors match only when claim ID, key, layer, optional scope, and canonical value hash all agree. Similar wording cannot satisfy a missing anchor.

`RecoveryBundle` binds the Profile, candidate artifacts, explicit `asOf`, and runtime observations under a second integrity hash. Evidence and claim text are treated as inert data.

### Trusted-head selection

Selection is deterministic and follows structural authority:

1. verify artifact integrity;
2. require expected lineage;
3. use the explicitly declared trusted head;
4. prefer the corresponding canonical ledger over a Capsule view of that same source snapshot;
5. treat verified Capsule ancestors as stale;
6. reject unresolved sibling heads as a fork;
7. never select by generated time, file modification time, filename, array order, or lexical event ID.

The selector can also operate without an expected head for diagnostic fork detection, but a valid RecoveryProfile always declares a trusted head.

### Anchor loading and staleness

Ledger artifacts are resolved through the unchanged v0.2 Resolver at the bundle's explicit `asOf`. Capsule artifacts expose only their portable active claims.

The loader distinguishes:

- loaded exact active anchors;
- missing anchors;
- semantically stale inactive anchors;
- expired anchors whose validity ended;
- anchors involved in an unresolved claim conflict;
- policy/capability-masked anchors;
- private anchors unavailable in the portable artifact.

Old age alone never makes an active Core claim stale. Accepted Evolution and validity windows retain v0.2 semantics. Co-evolution cannot activate a pending identity change.

Observation freshness is explicit. When freshness is required, a missing, unavailable, or masked observation is recorded separately and forces `indeterminate`; none can be skipped. An `observedAt` later than the Bundle's explicit `asOf` is recorded as future-dated and cannot satisfy freshness. An expired observation or one older than its Profile `maxAgeMs` is stale; when both bounds exist, the stricter bound wins. When freshness is required but neither bound exists, freshness is unknown rather than guessed. A `validUntil` earlier than `observedAt` is invalid.

Every v0.3-owned timestamp (`asOf`, artifact `generatedAt`/`modifiedAt`, observation `observedAt`/`validUntil`) must use ISO date-time syntax with `Z` or an explicit numeric offset. Calendar and clock components are validated before instant comparison. The sealed v0.2 timestamp contract is unchanged.

### RecoveryLoadReport

The report uses three Slice 1 states:

- `ready`: trusted state selected and declared anchors load without a first-slice blocker;
- `indeterminate`: masking, privacy, insufficient Texture coverage, or freshness prevents a clean load judgment;
- `blocked`: lineage, head, fork, or required Core resolution fails.

`ready` is deliberately not named `verified`. It does not claim that a live model has passed identity behavior checks. Reports use stable sorting, canonical serialization, and an integrity hash.

## Acceptance coverage in this slice

Implemented and passing:

- V03-001 through the unchanged 31-test v0.2 regression gate;
- V03-002 through V03-027;
- V03-029's lineage gate only (not the later full behavioral verifier);
- V03-037 canonical LoadReport determinism.

V03-015 and V03-016 share one fork test because both exercise the same fail-closed selection with different timestamps.

Alpha.2 also adds V03-FH-001 through V03-FH-010 for required-observation absence/status, future dating, explicit timezones, invalid calendar dates, reversed validity, composed freshness bounds, equality boundaries, offset equivalence, and independently auditable overlapping failures.

## Not implemented yet

The following remain outside Slice 1:

- V03-028: final `verified | indeterminate | rejected` recovery verdict;
- V03-030: catchphrase/style clone failing a critical agency probe;
- V03-031: different wording passing structured behavior checks;
- V03-032: final-verifier handling of missing critical Core;
- V03-033: final-verifier handling of unresolved Core conflict;
- V03-034: model capability variance in behavioral probes;
- V03-035: unobserved critical probe blocking verification;
- V03-036: binding v0.2 DriftReport to the final recovery verdict;
- V03-038: final exported-report privacy regression for indirect private references;
- V03-039: adapters proving `indeterminate` never serializes as success;
- V03-040: explicit project/tool-state boundary test in the final verifier;
- V03-041: a dedicated network-disabled execution test;
- V03-042: packed-artifact scan for real persona data.

No behavioral probe evaluator, model adapter, live model call, real chat ingestion, real-persona RecoveryProfile, Memory Vault/Aelios writeback, UI, Voice, or autonomous identity rewrite was added.

## Recommended next slice

Do not start cross-model integration yet. The next core slice should define structured probe observations and implement the deterministic final verifier plus V03-028 and V03-030 through V03-040. Only after that layer is green should a host adapter ask different models for structured responses.
