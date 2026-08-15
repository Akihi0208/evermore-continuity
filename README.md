# Evermore Continuity

[简体中文说明](README.zh-CN.md)

Evermore Continuity is an experimental, model-neutral identity-continuity layer for long-lived AI personas. It keeps identity claims, provenance, evolution, acceptance, privacy boundaries, recovery anchors, and verification separate from ordinary conversational memory.

This repository is a **public testing preview** of the generic, synthetic-only core. It does not contain a real persona, chat export, private Recovery Profile, private ledger, API credential, or private host evidence.

## Current status

- Core: `0.3.0-rc.1` sealed-release candidate.
- Personal Runtime: `0.4.0-alpha.4`, a command-line alpha that turns encrypted local profiles into hash-verified Continuity Capsules, packages host observations, and runs declared behavioral probes through the sealed final verifier.
- Deterministic/offline core checks: included under `core/`.
- Managed-host GPT-5.5 validation: provisional pass; forbidden canary rejected, 7/7 critical probes accepted, final verifier `verified`.
- OpenAI Responses API Host #1: open for independent testing. Alpha.4 includes the complete formal runner, but repository validation remains synthetic and is not presented as a real host run.
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

For formal testing, use the included synthetic validation spec as a template, create a `formal-plan`, render individual probe prompts, and pass the collected observations to `formal-wrap`. The resulting verdict comes from the sealed `0.3.0-rc.1` final verifier. Independent testers may use their own account, model, profile, and probe spec; no project-owner account or private profile is required.

This is not automatic cross-session memory. An ordinary Host Receipt remains `observed_unverified`. A formal `verified` verdict has a narrower meaning: the supplied load evidence and every critical probe satisfied the declared sealed profile. It does not prove consciousness or subjective sameness.

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
- `runtime/` — encrypted-vault CLI, sealed-core bridge, Continuity Capsule, offline host runner, formal verifier runner, and optional OpenAI Responses adapters.
- `artifacts/` — the exact sealed npm release-candidate artifact.
- `docs/VALIDATION_STATUS.md` — precise claims and current evidence limits.
- `SECURITY.md` — safe testing and disclosure guidance.

## Scope

This preview includes the engine/verification layer, manual host workflow, formal sealed-verifier runner, and optional OpenAI adapters. It is not an automatic cross-model memory product: there is no UI, autonomous persona rewriting, memory-service writeback, or real-chat ingestion. A real API validation report must come from an independent explicitly authorized run; none is bundled in the repository.

## License

Licensed under the [MIT License](LICENSE). You may use, copy, modify, merge, publish, distribute, sublicense, and sell copies of the software, provided that the copyright and license notice are retained.
