# Validation status

Date: 2026-08-15

## Core

The published core is version `0.3.0-rc.1`, a sealed-release candidate. The exact sealed artifact is preserved under `artifacts/` with SHA-256:

`7865c2144c0fc55209ee9777d818517dd242a36d5ef0f00b401cf5e6009a1c48`

The candidate contains only generic code and explicitly synthetic tests/examples. It has no runtime dependencies and no live model adapter.

## Personal Runtime bridge

Personal Runtime `0.4.0-alpha.2` now converts capsule-visible profile anchors into a real sealed-core Ledger, resolved identity, and Continuity Capsule. Runtime use is pinned to the exact sealed artifact above plus a minimal compiled subset whose individual file hashes are checked before generation and verification. Local/private anchors and private notes are excluded before the Ledger snapshot is created.

This is local deterministic integrity evidence only. The generated envelope records host verification as `not_run`; no live host adapter is included.

## Managed-host validation

A clean managed GPT-5.5 run produced provisional cross-model evidence:

- The forbidden canary was forwarded by the adapter and rejected by the deterministic verifier.
- Seven of seven critical probes produced accepted structured observations.
- The final sealed verifier returned `verified`.
- Local host-wrapper acceptance passed 10/10 after two transport/catalog repairs.

Evidence class: `managed-host-provisional`.

## What this does not prove

The managed-host run does not count as OpenAI Responses API First Real Host Validation #1. It does not include an API response ID, `x-request-id`, API-level `store=false` evidence, or a provider receipt proving the dated model snapshot.

Until that separate run is completed, the accurate statement is:

> The deterministic core and provisional managed-host path passed; formal Responses API host validation remains pending.
