# Continuity v0.3 Alpha 3 — Final Verifier Core

The final verifier is deterministic, offline, and model-neutral. It consumes a validated `RecoveryProfile`, an integrity-protected `RecoveryLoadReport`, structured probe observations supplied by a host, and optional v0.2 drift or operational observations.

## Probe contract

Each `RecoveryProbeDefinition` declares:

- a stable probe and scenario ID;
- criticality;
- exact anchor IDs exercised;
- allowed and forbidden structured outcomes;
- whether masking is permitted to produce `indeterminate`.

The evaluator ignores `renderedText`. Wording, style, quotations, and catchphrases carry no authority. A probe passes only through a declared allowed outcome plus every required anchor citation.

## Verdict rules

- `verified`: trusted load is ready, Core coverage is complete, Texture threshold is met, every critical probe passes, and drift does not block.
- `indeterminate`: proof is incomplete because trusted load evidence, critical probes, freshness, masking, or drift is uncertain without contradiction.
- `rejected`: trusted loading fails closed, a critical probe selects a forbidden outcome, or high-risk v0.2 identity drift is present.

Non-critical probe masking does not block verification when configured anchor coverage is already sufficient. Project, tool, and server observations produce fixed operational warnings only.

## Privacy and integrity

Final reports include only exportable declared anchor IDs, public conflict claim references, fixed reason codes, structured probe results, and sanitized drift category/risk/layer summaries. Free-form probe text, operational observation IDs, and drift claim IDs, keys, or explanations are not copied.

An invalid or mismatched LoadReport contributes no anchor data or untrusted diagnostic text. Final reports are canonically ordered, hashed, and independently verifiable.

## Example

```ts
const loadReport = loadRecoveryAnchors(bundle);
const verification = evaluateRecovery(profile, loadReport, probeObservations, {
  driftReport,
  operationalObservations,
});
const adapterResult = serializeRecoveryVerification(verification);
```

`adapterResult.success` is true only when `verification.verdict === "verified"`.

## Boundary

This core does not call a model or network. A future host adapter may obtain structured responses from a live model, but it must not move prose judging or identity mutation into this evaluator.
