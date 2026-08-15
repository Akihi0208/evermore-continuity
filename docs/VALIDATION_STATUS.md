# Validation status

Date: 2026-08-15

## Core

The published core is version `0.3.0-rc.1`, a sealed-release candidate. The exact sealed artifact is preserved under `artifacts/` with SHA-256:

`7865c2144c0fc55209ee9777d818517dd242a36d5ef0f00b401cf5e6009a1c48`

The candidate contains only generic code and explicitly synthetic tests/examples. It has no runtime dependencies and no live model adapter.

## Personal Runtime bridge

Personal Runtime `0.4.0-alpha.5` converts capsule-visible profile anchors into a real sealed-core Ledger, resolved identity, and Continuity Capsule. It creates self-contained Host Requests and can derive a sealed Recovery Profile, Recovery Bundle, LoadReport, declared probe plan, and final Verification Report. Runtime use is pinned to the exact sealed artifact above plus a hash-checked compiled subset that includes the sealed recovery loader and final verifier. Local/private anchors and private notes are excluded before the Ledger snapshot is created.

The formal runner is tested with seven fully synthetic probes in manual and mocked-API paths. The tested model chooses `selectedActionId`; a deterministic local mapping derives the sealed core's outcome classification. The model cannot submit `selectedOutcomeId`. `renderedText` is retained but explicitly marked `not_evaluated` and is not independent behavioral evidence. All-passing action choices produce `verified`; a forbidden critical action produces `rejected`; incomplete anchor evidence remains `indeterminate`. The OpenAI runner requires explicit network opt-in, exact request-count confirmation, a caller-specified model, `store: false`, and no retries. No real OpenAI request, API charge, response ID, or provider receipt was produced during repository validation.

Current alpha.5 validation results:

- Personal Runtime: 50/50 tests passed under both `TZ=UTC` and `TZ=Asia/Shanghai`; 50/50 also passed in a dependency-free clean copy.
- Sealed-core non-release-gate regression: 85/85 passed; schema validation passed.
- Exact packed artifact scan: 40 files, zero findings, `syntheticOnly=true`.
- Clean synthetic vault → Capsule → Host Request → seven-probe Plan → mechanically classified sealed Formal Result completed with verdict `verified`.
- A minimal GitHub Actions workflow runs Node 22 runtime tests and `core/npm run check` under both timezones.
- The process-level network-deny release-gate cannot run inside this local managed sandbox because its deliberate network API probes are intercepted before Node executes them. The public GitHub Actions jobs run the complete command. The sealed core source, vendored manifest hash (`43285c5f4b64efbafffeaf9ad8d8eae684ff640be01d78fb9f8dd2e76f54a64a`), per-file vendored hashes, and artifact hash are unchanged.

## Managed-host validation

A clean managed GPT-5.5 run produced provisional cross-model evidence:

- The forbidden canary was forwarded by the adapter and rejected by the deterministic verifier.
- Seven of seven critical probes produced accepted structured observations.
- The final sealed verifier returned `verified`.
- Local host-wrapper acceptance passed 10/10 after two transport/catalog repairs.

Evidence class: `managed-host-provisional`.

## What this does not prove

The managed-host run does not count as OpenAI Responses API First Real Host Validation #1. It does not include an API response ID, `x-request-id`, API-level `store=false` evidence, or a provider receipt proving the dated model snapshot.

Until a separate authorized real-host run is completed, the accurate statement is:

> The deterministic core, offline Host Request/Receipt path, formal sealed-verifier runner, and synthetic adapter tests passed; an independently authorized real Responses API host report is not yet bundled.
