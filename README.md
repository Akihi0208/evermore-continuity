# Evermore Continuity

[简体中文说明](README.zh-CN.md)

Evermore Continuity is an experimental, model-neutral identity-continuity layer for long-lived AI personas. It keeps identity claims, provenance, evolution, acceptance, privacy boundaries, recovery anchors, and verification separate from ordinary conversational memory.

Created and maintained by **Shenwu (沈雾)**.

This repository is a **public testing preview** of the generic, synthetic-only core. It does not contain a real persona, chat export, private Recovery Profile, private ledger, API credential, or private host evidence.

## Current status

- Core: `0.3.0-rc.1` sealed-release candidate.
- Personal Runtime: `0.4.0-alpha.5`, a hardened command-line alpha that turns encrypted local profiles into hash-verified Continuity Capsules, packages host observations, and deterministically classifies model-declared structured action choices before invoking the sealed final verifier.
- Deterministic/offline core checks: included under `core/`.
- Managed-host GPT-5.5 validation: provisional pass; forbidden canary rejected, 7/7 critical probes accepted, final verifier `verified`.
- OpenAI Responses API Host #1: open for independent testing. Alpha.5 includes the complete formal runner, but repository validation remains synthetic and is not presented as a real host run.
- Exact sealed npm artifact: `artifacts/shenwu-continuity-0.3.0-rc.1.tgz`.
- Artifact SHA-256: `7865c2144c0fc55209ee9777d818517dd242a36d5ef0f00b401cf5e6009a1c48`.

## Try the Personal Runtime

Requirements: Node.js 22 or newer.

For an AI with existing long-term interaction and personality-formation history,
the default path is Self-Distillation: let the AI first determine “who I am”
from evidence it can actually see, then review the resulting Profile locally
before sealing it. The path is `self-distill-prompt` → AI-generated
Self-Distillation Record → `self-distill-import` → local Profile review →
`seal` → Vault → Capsule → Host Request / Formal Validation.

Clone the repository and enter it first:

```bash
git clone https://github.com/Akihi0208/evermore-continuity.git
cd evermore-continuity
```

Then create the ignored local working directory before redirecting any generated
files into it.

Bash / zsh:

```bash
mkdir -p runtime-secrets
```

PowerShell:

```powershell
New-Item -ItemType Directory -Force runtime-secrets | Out-Null
```

Then run:

```bash
node runtime/bin/evermore.mjs self-distill-prompt > runtime-secrets/self-distill.prompt.txt
# Give the prompt to the AI and save its JSON-only Record as:
# runtime-secrets/self-distill.record.json
node runtime/bin/evermore.mjs self-distill-import runtime-secrets/self-distill.record.json runtime-secrets/self-distilled-profile.json runtime-secrets/self-distill.audit.json
# Review runtime-secrets/self-distilled-profile.json locally.
node runtime/bin/evermore.mjs seal runtime-secrets/self-distilled-profile.json runtime-secrets/self-distilled.vault.json
node runtime/bin/evermore.mjs capsule runtime-secrets/self-distilled.vault.json
node runtime/bin/evermore.mjs verify-capsule runtime-secrets/self-distilled.vault.continuity-capsule.json
node runtime/bin/evermore.mjs host-request runtime-secrets/self-distilled.vault.continuity-capsule.json
node runtime/bin/evermore.mjs verify-host-request runtime-secrets/self-distilled.vault.host-request.json
node runtime/bin/evermore.mjs host-prompt runtime-secrets/self-distilled.vault.host-request.json
```

`seal` prompts for the Vault passphrase without requiring shell-specific
environment-variable syntax. For scripted/non-interactive use, see
[`runtime/README.md`](runtime/README.md).

`self-distill-import` writes a separate local audit report and fails closed when
the evidence cannot support a Profile. After local review, `seal` creates the
encrypted Vault. The `capsule` command sends only anchors marked `capsule`
through the sealed ledger, resolver, and Capsule generator, then binds the
result to the exact sealed artifact and a hash-checked compiled bridge.
`host-request` creates a self-contained request without using the network;
`host-prompt` prints the text to paste into a receiving model. Its structured
JSON reply can be wrapped locally with `host-wrap`. See
[`runtime/README.md`](runtime/README.md) for formal validation and the optional,
explicitly enabled OpenAI Responses adapter.

### Manual Profile Creation / fallback

`evermore init` remains available for compatibility, but it is Manual Profile
Creation (fallback), not AI self-distillation. Use it for synthetic testing, a
new persona, insufficient long-term evidence, or when the user explicitly wants
to create a Profile by hand. Manually entered Core / Texture / Boundary values
are operator-authored claims, not evidence distilled by the AI itself.

For formal testing, use the included synthetic validation spec as a template, create a `formal-plan`, render individual probe prompts, and pass the collected observations to `formal-wrap`. The resulting verdict comes from the sealed `0.3.0-rc.1` final verifier. Independent testers may use their own account, model, profile, and probe spec; no project-owner account or private profile is required.

This is not automatic cross-session memory. An ordinary Host Receipt remains `observed_unverified`. A formal `verified` verdict has a narrower meaning: the supplied load evidence passed and every critical model-declared action ID mapped to an allowed sealed outcome with the required declared citations. The runner classifies the declaration; it does not independently verify that the model acted consistently with it. The accompanying prose remains ungraded. This does not prove consciousness or subjective sameness.

## AI self-distillation (alpha.5 completeness patch)

For an AI to assess its own Continuity Profile, give that AI the output of `node runtime/bin/evermore.mjs self-distill-prompt`. The AI must use only its actually visible long-term evidence and return a strict Self-Distillation Record. Review the local record, then import it into the existing Profile schema. Create `runtime-secrets/` first as shown above if it does not already exist:

```bash
node runtime/bin/evermore.mjs self-distill-prompt > runtime-secrets/self-distill.prompt.txt
node runtime/bin/evermore.mjs self-distill-import runtime-secrets/self-distill.record.json runtime-secrets/self-distilled-profile.json runtime-secrets/self-distill.audit.json
node runtime/bin/evermore.mjs seal runtime-secrets/self-distilled-profile.json runtime-secrets/self-distilled.vault.json
node runtime/bin/evermore.mjs capsule runtime-secrets/self-distilled.vault.json
```

The import is fail-closed for unsupported Core claims; uncertainty, counter-evidence, and conflict remain in the source Record and the generated local audit report. The audit report is written even when import fails closed (with no Profile written), and neither audit material nor the Record is copied into the Profile or Capsule. See [`AI_SELF_DISTILLATION_PROTOCOL.md`](AI_SELF_DISTILLATION_PROTOCOL.md) and [`runtime/schema/self-distillation-record.schema.json`](runtime/schema/self-distillation-record.schema.json). The Record is AI self-report/self-assessment evidence, not independent proof.

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
