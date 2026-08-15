# Evermore Continuity

[简体中文说明](README.zh-CN.md)

Evermore Continuity is an experimental, model-neutral identity-continuity layer for long-lived AI personas. It keeps identity claims, provenance, evolution, acceptance, privacy boundaries, recovery anchors, and verification separate from ordinary conversational memory.

This repository is a **public testing preview** of the generic, synthetic-only core. It does not contain a real persona, chat export, private Recovery Profile, private ledger, API credential, or private host evidence.

## Current status

- Core: `0.3.0-rc.1` sealed-release candidate.
- Personal Runtime: `0.4.0-alpha.3`, a command-line alpha that turns encrypted local profiles into hash-verified Continuity Capsules and packages receiving-host observations as integrity-bound receipts.
- Deterministic/offline core checks: included under `core/`.
- Managed-host GPT-5.5 validation: provisional pass; forbidden canary rejected, 7/7 critical probes accepted, final verifier `verified`.
- OpenAI Responses API Host #1: still pending. Alpha.3 includes an optional adapter, but its public validation uses a synthetic response and is not presented as a real host run.
- Exact sealed npm artifact: `artifacts/shenwu-continuity-0.3.0-rc.1.tgz`.
- Artifact SHA-256: `7865c2144c0fc55209ee9777d818517dd242a36d5ef0f00b401cf5e6009a1c48`.

## Try the Personal Runtime

Requirements: Node.js 22 or newer.

```bash
git clone https://github.com/Akihi0208/evermore-continuity.git
cd evermore-continuity
node runtime/bin/evermore.mjs init
node runtime/bin/evermore.mjs capsule runtime-secrets/persona.evermore-vault.json
node runtime/bin/evermore.mjs verify-capsule runtime-secrets/persona.evermore-vault.continuity-capsule.json
node runtime/bin/evermore.mjs host-request runtime-secrets/persona.evermore-vault.continuity-capsule.json
node runtime/bin/evermore.mjs host-prompt runtime-secrets/persona.evermore-vault.host-request.json
```

The wizard creates an encrypted local vault. The `capsule` command sends only anchors marked `capsule` through the sealed ledger, resolver, and Capsule generator, then binds the result to the exact sealed artifact and a hash-checked compiled bridge. `host-request` creates a self-contained request without using the network; `host-prompt` prints the text to paste into a receiving model. Its structured JSON reply can be wrapped locally with `host-wrap`. See [`runtime/README.md`](runtime/README.md) for the exact manual workflow and the optional, explicitly enabled OpenAI Responses adapter.

This is not automatic cross-session memory. A valid Host Receipt records an observed response and remains `observed_unverified`; it does not mean the receiving host has been verified.

## Test the sealed core

```bash
cd core
npm ci
npm run check
```

The core has no runtime dependencies and does not make network calls. Its release-gate test activates a Node process-level network deny guard and scans the exact npm-packed artifact for real data, credentials, unsafe paths, unexpected binaries, and live model dependencies.

## What feedback helps

- A test that fails on your operating system or Node.js 22+ environment.
- A deterministic result that changes across timezone, machine, or repeated runs.
- A tampered or incomplete bundle that is accepted instead of failing closed.
- A privacy boundary, provenance rule, freshness rule, or trusted-head decision that behaves unexpectedly.
- Documentation that prevents a clean-room tester from reproducing a result.

Please use synthetic data only and open a GitHub issue with the provided template. Do not post real chats, real persona profiles, private ledgers, tokens, API keys, or provider receipts.

## Repository layout

- `core/` — readable TypeScript source, specifications, synthetic examples, and tests.
- `runtime/` — encrypted-vault CLI, sealed-core bridge, Continuity Capsule, offline host runner, and optional OpenAI Responses adapter.
- `artifacts/` — the exact sealed npm release-candidate artifact.
- `docs/VALIDATION_STATUS.md` — precise claims and current evidence limits.
- `SECURITY.md` — safe testing and disclosure guidance.

## Scope

This preview includes an engine/verification layer, a manual host workflow, and an optional single-request OpenAI adapter. It is not a complete automatic cross-model product: there is no UI, autonomous persona rewriting, memory-service writeback, real-chat ingestion, or completed formal API host validation.

## License

Licensed under the [MIT License](LICENSE). You may use, copy, modify, merge, publish, distribute, sublicense, and sell copies of the software, provided that the copyright and license notice are retained.
