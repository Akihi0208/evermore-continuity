# Continuity v0.3 alpha 3 — Recovery and Final Verifier Core

Status: implemented and tested; review candidate. Live cross-model adapters are intentionally absent.

This slice adds a recovery layer in `src/recovery-v03/` while leaving the sealed v0.2 Resolver, Ledger, Capsule, Drift Detector, migration code, and original 31 tests unchanged.

## Included

- Hashed `RecoveryProfile` and `RecoveryBundle` contracts.
- Exact Core and Texture anchor references using claim identity and canonical value hashes.
- Deterministic trusted-head selection.
- Canonical ledger precedence when the declared current ledger and an older derived Capsule are both present.
- Exact descendant/ancestor Capsule handling.
- Fail-closed unresolved fork detection without timestamp, filename, modification-time, input-order, or lexical-ID tie-breaking.
- Structural artifact staleness, semantic claim staleness, validity expiry, and observation freshness.
- Fail-closed required-observation handling for missing, unavailable, masked, and future-dated evidence.
- Explicit-timezone ISO validation for every v0.3-owned timestamp.
- Canonical, integrity-protected `RecoveryLoadReport` with `ready`, `indeterminate`, and `blocked` states.
- Twelve Slice 1 freshness-hardening boundaries, including independently preserved status and staleness diagnostics.
- Profile-bound structured probe definitions and deterministic host-supplied observations.
- Integrity-protected final `verified | indeterminate | rejected` reports.
- v0.2 DriftReport binding, private-reference filtering, safe adapter serialization, and operational-state isolation.
- Synthetic core acceptance coverage through V03-040. V03-041 and V03-042 are implemented separately as final release gates.

## Import

The slice is deliberately separate from the v0.2 root API:

```ts
import {
  computeRecoveryProfileHash,
  computeRecoveryBundleHash,
  evaluateRecovery,
  loadRecoveryAnchors,
  serializeRecoveryVerification,
  selectRecoveryHead,
  verifyRecoveryVerificationReport,
} from "./src/recovery-v03/index.js";
```

## Commands

```bash
npm ci
npm run test:v02
npm run test:v03:slice1
npm run test:v03:final
npm run test:v03
npm run check
```

## Boundary

`RecoveryLoadReport.status === "ready"` still means only that trusted state and anchors loaded. Only `evaluateRecovery(...)` can produce the final operational verdict, and even `verified` establishes auditable lineage/anchor/behavior continuity rather than metaphysical or subjective identity proof.
