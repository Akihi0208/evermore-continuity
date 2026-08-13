# Continuity v0.3 Alpha 2 — Slice 1 Freshness Hardening

> Alpha.3 audit addendum: V03-FH-011 and V03-FH-012 now prove that `unavailable + stale` and `masked + stale` are preserved simultaneously. Freshness evaluation is multi-axis and no longer stops after status classification.

Status: implemented; review candidate  
Date: 2026-08-12  
Boundary: Slice 1 only; no final verifier, structured probes, adapters, or cross-model behavior.

## Hardened contract

- A required freshness observation that is missing, unavailable, or masked produces explicit, integrity-protected LoadReport evidence and forces `indeterminate`.
- A required observation with `observedAt > asOf` is recorded as future-dated and cannot satisfy freshness.
- Every timestamp owned by the v0.3 Recovery Bundle requires ISO date-time syntax with `Z` or an explicit numeric timezone offset.
- `validUntil < observedAt` is rejected as internally inconsistent.
- When both `validUntil` and `maxAgeMs` exist, either bound can make the observation stale.
- At `age === maxAgeMs`, the observation remains fresh; at `asOf === validUntil`, it is expired.
- Overlapping failures remain independently auditable instead of one hiding another.

## Acceptance-test evidence

The five directly requested tests were added first. Against alpha.1 they failed 5/5 while the existing 27 Slice 1 tests remained green. Audit tests were then added for reversed validity, bound composition, equality edges, offset equivalence, and overlapping failure reporting.

Alpha.2 results:

- v0.3 Slice 1: 37/37;
- sealed v0.2 regression: 31/31;
- combined: 68/68 plus schema invariant;
- `TZ=UTC`: 37/37;
- `TZ=Asia/Shanghai`: 37/37.

## LoadReport additions

- `missingFreshnessObservationIds`
- `unavailableFreshnessObservationIds`
- `maskedFreshnessObservationIds`
- `futureDatedObservationIds`

All four fields participate in canonical normalization and `reportHash` integrity.

## Remaining freshness boundary

After the alpha.3 overlap addendum, no known Slice 1 freshness decision boundary remains uncovered in the current contract. The current Slice 1 suite is 39/39 and covers leap-day validity, invalid calendar dates, explicit-offset equivalence, exact-expiry, exact-max-age, missing metadata, composed bounds, unavailable/masked/missing evidence, future dating, reversed validity, status+future, unavailable+stale, and masked+stale.

Two deliberate scope limits remain:

- timestamp rules inside sealed v0.2 Ledger/Capsule records are not retroactively changed;
- clock-skew tolerance is not inferred. Slice 1 applies the exact contract `observedAt <= asOf`; any future tolerance would require a new explicit Profile policy and acceptance tests.
