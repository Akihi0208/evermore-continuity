# Evermore Continuity

[简体中文说明](README.zh-CN.md)

Evermore Continuity is an experimental, model-neutral identity-continuity layer for long-lived AI personas. It keeps identity claims, provenance, evolution, acceptance, privacy boundaries, recovery anchors, and verification separate from ordinary conversational memory.

This repository is a **public testing preview** of the generic, synthetic-only core. It does not contain a real persona, chat export, private Recovery Profile, private ledger, API credential, or private host evidence.

## Current status

- Core: `0.3.0-rc.1` sealed-release candidate.
- Personal Runtime: `0.4.0-alpha.1`, an offline command-line MVP for encrypted local profiles and manual model-neutral handoff.
- Deterministic/offline core checks: included under `core/`.
- Managed-host GPT-5.5 validation: provisional pass; forbidden canary rejected, 7/7 critical probes accepted, final verifier `verified`.
- OpenAI Responses API Host #1: still pending. The managed-host result is not presented as API-level proof.
- Exact sealed npm artifact: `artifacts/shenwu-continuity-0.3.0-rc.1.tgz`.
- Artifact SHA-256: `7865c2144c0fc55209ee9777d818517dd242a36d5ef0f00b401cf5e6009a1c48`.

## Try the Personal Runtime

Requirements: Node.js 22 or newer.

```bash
git clone https://github.com/Akihi0208/evermore-continuity.git
cd evermore-continuity
node runtime/bin/evermore.mjs init
node runtime/bin/evermore.mjs export runtime-secrets/persona.evermore-vault.json
node runtime/bin/evermore.mjs prompt runtime-secrets/persona.evermore-vault.portable.json
```

The wizard creates an encrypted local vault, exports only anchors marked for portable use, and renders a handoff that can be reviewed and pasted into a receiving model. It does not need an API key, ingest chat history, or make network calls. See [`runtime/README.md`](runtime/README.md) for verification commands, scripting support, and the privacy model.

This is a manual alpha, not automatic cross-session memory. The receiving model must be given the handoff in a context it can read.

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
- `runtime/` — offline encrypted-vault CLI and portable handoff generator.
- `artifacts/` — the exact sealed npm release-candidate artifact.
- `docs/VALIDATION_STATUS.md` — precise claims and current evidence limits.
- `SECURITY.md` — safe testing and disclosure guidance.

## Scope

This preview now includes an engine/verification layer and a manual Personal Runtime alpha. It is not yet a complete automatic cross-model product: there is no UI, live host adapter, autonomous persona rewriting, memory-service writeback, or real-chat ingestion.

## License

Licensed under the [MIT License](LICENSE). You may use, copy, modify, merge, publish, distribute, sublicense, and sell copies of the software, provided that the copyright and license notice are retained.
