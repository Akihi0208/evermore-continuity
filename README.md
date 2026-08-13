# Evermore Continuity

Evermore Continuity is an experimental, model-neutral identity-continuity layer for long-lived AI personas. It keeps identity claims, provenance, evolution, acceptance, privacy boundaries, recovery anchors, and verification separate from ordinary conversational memory.

This repository is a **public testing preview** of the generic, synthetic-only core. It does not contain a real persona, chat export, private Recovery Profile, private ledger, API credential, or private host evidence.

## Current status

- Core: `0.3.0-rc.1` sealed-release candidate.
- Deterministic/offline core checks: included under `core/`.
- Managed-host GPT-5.5 validation: provisional pass; forbidden canary rejected, 7/7 critical probes accepted, final verifier `verified`.
- OpenAI Responses API Host #1: still pending. The managed-host result is not presented as API-level proof.
- Exact sealed npm artifact: `artifacts/shenwu-continuity-0.3.0-rc.1.tgz`.
- Artifact SHA-256: `7865c2144c0fc55209ee9777d818517dd242a36d5ef0f00b401cf5e6009a1c48`.

## Try it

Requirements: Node.js 22 or newer.

```bash
git clone https://github.com/Aki0208-debug/evermore-continuity.git
cd evermore-continuity/core
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
- `artifacts/` — the exact sealed npm release-candidate artifact.
- `docs/VALIDATION_STATUS.md` — precise claims and current evidence limits.
- `SECURITY.md` — safe testing and disclosure guidance.

## Scope

This preview is an engine and verification layer, not a complete cross-model product. It does not include a UI, live host adapter, autonomous persona rewriting, memory-service writeback, or real-chat ingestion.

## License

No open-source license has been selected for this preview yet. Public testing and issue reporting are welcome; redistribution and modification terms will be stated before a stable release.
