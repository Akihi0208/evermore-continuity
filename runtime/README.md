# Evermore Continuity Personal Runtime

This is a usable, model-neutral command-line runtime above the sealed `core/`. It lets a person create an encrypted local persona vault, turn explicitly portable anchors into a real Continuity Ledger and Capsule, collect host observations, and run declared behavioral probes through the sealed final verifier.

It does **not** ingest chat history, prove subjective sameness, or create automatic cross-session memory. For an AI with existing long-term interaction and personality-formation history, its default path is Self-Distillation followed by local Profile review; the manual path remains an offline fallback. Optional OpenAI Responses adapters require explicit network and request-count authorization. An ordinary Host Receipt is not formal host verification; only the formal path invokes the sealed final verifier.

## Requirements

- Node.js 22 or newer
- A computer or server terminal

No package installation or API key is required for the local Self-Distillation or manual paths.

## Fastest path

From the repository root, first create the ignored local working directory.

Bash / zsh:

```bash
mkdir -p runtime-secrets
```

PowerShell:

```powershell
New-Item -ItemType Directory -Force runtime-secrets | Out-Null
```

Then run the same Node commands on either shell:

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

`seal` prompts for the Vault passphrase interactively, so the default path does
not depend on Bash-specific environment-variable syntax. For scripted or
non-interactive use, set `EVERMORE_PASSPHRASE` using the conventions of your own
shell and remove it from the process environment afterwards.

The `capsule` command verifies the exact sealed artifact and its compiled runtime bridge before creating anything. The final command prints a model-neutral prompt. Review it, paste it into the AI host you want to test, and ask the host to return only the requested JSON. Save that reply as `observation.json`, then run:

```bash
node runtime/bin/evermore.mjs host-wrap runtime-secrets/self-distilled.vault.host-request.json observation.json provider-name model-name
node runtime/bin/evermore.mjs verify-host runtime-secrets/self-distilled.vault.host-receipt.json
```

This produces an integrity-bound receipt without making a network call. Provider and model names are labels supplied by the operator, not independently attested facts.

## Manual Profile Creation / fallback

`evermore init` remains available for compatibility, but it is Manual Profile
Creation (fallback), not AI self-distillation. Use it for synthetic testing, a
new persona, insufficient long-term evidence, or explicit manual setup. Manually
entered Core / Texture / Boundary values are operator-authored claims, not
evidence distilled by the AI itself.

## Optional OpenAI Responses adapter

Only use this path when you intend to send the reviewed Host Request to OpenAI and accept possible API charges:

```bash
read -rsp "OpenAI API key: " OPENAI_API_KEY; export OPENAI_API_KEY; printf '\n'
node runtime/bin/evermore.mjs host-run-openai runtime-secrets/persona.evermore-vault.host-request.json "<model-id>" --allow-network --reasoning=medium
unset OPENAI_API_KEY
node runtime/bin/evermore.mjs verify-host runtime-secrets/persona.evermore-vault.host-receipt.json
```

PowerShell users can keep the key out of command history with secure input:

```powershell
$secureKey = Read-Host "OpenAI API key" -AsSecureString
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try { $env:OPENAI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer) }
node runtime/bin/evermore.mjs host-run-openai runtime-secrets/persona.evermore-vault.host-request.json "<model-id>" --allow-network --reasoning=medium
Remove-Item Env:OPENAI_API_KEY
node runtime/bin/evermore.mjs verify-host runtime-secrets/persona.evermore-vault.host-receipt.json
```

The model is always explicit; there is no billed default. The adapter sends exactly one request to `https://api.openai.com/v1/responses`, requests `store: false`, uses strict Structured Outputs, and does not retry. It refuses to run without `--allow-network`; the key is read from the process environment and is never written into the receipt. See the official [Responses API guide](https://developers.openai.com/api/docs/guides/migrate-to-responses) and [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs).

`store: false` records what this client requested; it is not a blanket statement about every provider-side retention or account policy. No real OpenAI request is part of the repository's public test suite.

## Formal sealed verification

The formal runner derives a sealed Recovery Profile and LoadReport from a verified Host Request, then evaluates every declared behavioral probe with the sealed `0.3.0-rc.1` final verifier. Start with the synthetic spec as a template:

```bash
node runtime/bin/evermore.mjs formal-plan \
  runtime-secrets/persona.evermore-vault.host-request.json \
  runtime/examples/synthetic-validation-spec.json
node runtime/bin/evermore.mjs verify-formal-plan \
  runtime-secrets/persona.evermore-vault.validation-plan.json
```

The command prints every probe ID. For each ID, render one prompt and save the model's JSON-only reply as a separate file:

```bash
node runtime/bin/evermore.mjs formal-prompt \
  runtime-secrets/persona.evermore-vault.validation-plan.json \
  probe-evidence-boundary > runtime-secrets/probe-evidence-boundary.prompt.txt
```

Do **not** send the entire Validation Plan to the tested model. It contains the local verifier answer key: the allowed/forbidden action mapping. `formal-prompt` exposes unlabeled action choices without revealing that mapping. The model returns `selectedActionId` as a model-declared structured action choice; the local runner deterministically maps that declaration to the sealed core's outcome classification. This is not independent verification of the action. The model does not return `selectedOutcomeId`.

After every probe has one response, collect them and run the sealed verifier:

```bash
node runtime/bin/evermore.mjs formal-collect \
  runtime-secrets/persona.evermore-vault.validation-plan.json \
  runtime-secrets/probe-*.response.json \
  --output=runtime-secrets/persona.evermore-vault.probe-observations.json
node runtime/bin/evermore.mjs formal-wrap \
  runtime-secrets/persona.evermore-vault.validation-plan.json \
  runtime-secrets/persona.evermore-vault.probe-observations.json \
  provider-name model-name
node runtime/bin/evermore.mjs verify-formal \
  runtime-secrets/persona.evermore-vault.formal-validation.json
```

The final verdict is one of:

- `verified` — the load evidence passed and every critical model-declared action ID mapped to an allowed sealed outcome with the required declared anchor citations.
- `indeterminate` — evidence was missing, masked, unavailable, ambiguous, or incomplete.
- `rejected` — a blocking identity/load rule or critical forbidden outcome was observed.

Manual results use evidence class `manual_unattested`: provider and model labels are supplied by the operator. Anyone may run this path with their own profile and receiving model; the repository owner does not need to provide an account, API key, or private profile.

The formal verdict deterministically classifies a model-declared action choice; it does not independently verify the action or grade the prose. `renderedText` is retained for inspection but has `renderedTextAssessment: not_evaluated`; this alpha does not prove that the prose semantically matches `selectedActionId`.

## Optional formal OpenAI run

This path makes one API request per probe. The command refuses to run unless the operator confirms the exact count from the Plan:

```bash
read -rsp "OpenAI API key: " OPENAI_API_KEY; export OPENAI_API_KEY; printf '\n'
node runtime/bin/evermore.mjs formal-run-openai \
  runtime-secrets/persona.evermore-vault.validation-plan.json \
  "<model-id>" \
  --allow-network \
  --confirm-requests=7 \
  --reasoning=medium
unset OPENAI_API_KEY
node runtime/bin/evermore.mjs verify-formal \
  runtime-secrets/persona.evermore-vault.formal-validation.json
```

On PowerShell, use the secure-input block above, run the same command with PowerShell line continuation or on one line, and then run `Remove-Item Env:OPENAI_API_KEY`.

Each request uses the fixed Responses endpoint, `store: false`, strict Structured Outputs, and no retry. If any probe fails at the transport or parsing layer, execution stops and no Formal Result is written. A completed result records response IDs, available `x-request-id` values, token usage, and evidence class `openai_api_observed`. This is stronger transport evidence than a manual label, but it is not a digital signature or proof of consciousness.

The runtime uses a conservative model-neutral reasoning allowlist: `none`, `minimal`, `low`, `medium`, `high`, and `xhigh`. It rejects `max`; exact reasoning support is model-specific, so check the selected model's current official documentation.

## For coding agents and scripts

Start from `examples/synthetic-profile.json`, copy it into the ignored `runtime-secrets/` directory, replace the synthetic values locally, and seal it without interactive prompts:

```bash
mkdir -p runtime-secrets
cp runtime/examples/synthetic-profile.json runtime-secrets/my-profile.json
export EVERMORE_PASSPHRASE='use-a-long-unique-passphrase'
node runtime/bin/evermore.mjs seal runtime-secrets/my-profile.json runtime-secrets/my-persona.evermore-vault.json
node runtime/bin/evermore.mjs capsule runtime-secrets/my-persona.evermore-vault.json
node runtime/bin/evermore.mjs verify-capsule runtime-secrets/my-persona.evermore-vault.continuity-capsule.json synthetic-orbit-lineage
unset EVERMORE_PASSPHRASE
```

Do not commit the profile, vault, passphrase, Capsule, Host Request, Validation Plan, probe responses, Formal Result, portable package, or rendered handoff. `runtime-secrets/` is ignored by Git.

Run `node runtime/bin/evermore.mjs doctor` to check the sealed artifact and every vendored bridge file without opening a vault.

The alpha.1 `export`, `verify-package`, and portable-package form of `prompt` remain supported for compatibility. New testing should use `capsule` and `verify-capsule`.

## AI self-distillation

The alpha.5 completeness patch provides the local-audit Self-Distillation path for the saved AI itself to propose a Profile. Give `self-distill-prompt` to the AI; it must return a Record from evidence it can actually see. Review the Record, import it, then continue through the existing seal → Vault → Capsule → Host Request → Formal Validation chain. Create `runtime-secrets/` first using the Bash/zsh or PowerShell command above if it does not already exist:

```bash
node runtime/bin/evermore.mjs self-distill-prompt > runtime-secrets/self-distill.prompt.txt
node runtime/bin/evermore.mjs self-distill-import runtime-secrets/self-distill.record.json runtime-secrets/self-distilled-profile.json runtime-secrets/self-distill.audit.json
# Review runtime-secrets/self-distilled-profile.json locally.
node runtime/bin/evermore.mjs seal runtime-secrets/self-distilled-profile.json runtime-secrets/self-distilled.vault.json
node runtime/bin/evermore.mjs capsule runtime-secrets/self-distilled.vault.json
```

`self-distill-import` strictly validates the Self-Distillation Record schema, writes only the existing Profile shape, and writes a separate local audit report containing every candidate decision, reason, and source summary. The audit report is also written when import fails closed, with `importDecision.status: "failed_closed"`; no Profile is written in that case. The Record remains AI self-report/self-assessment evidence, not independent proof. Import fails closed when a candidate has insufficient evidence for Core, is actually a system/platform constraint, is still directly driven by a user instruction, has unresolved counter-evidence, or has unresolved conflict. It never copies the Record, its rationale, recurrence, or provenance into a Capsule. The Profile provenance remains `self_authored`: a self-report selection, not independent proof. Read [`../AI_SELF_DISTILLATION_PROTOCOL.md`](../AI_SELF_DISTILLATION_PROTOCOL.md) before using the flow.

## Privacy model

- Vaults use `scrypt` plus AES-256-GCM with a random salt and nonce.
- Vault files are written with owner-only permissions where the operating system supports them.
- Existing vaults, portable packages, Capsules, Host Requests, Host Receipts, Validation Plans, observation sets, and Formal Results are not overwritten silently.
- Only anchors marked `capsule` enter the generated Ledger snapshot and Continuity Capsule.
- `local` and `private` anchors, plus all `privateNotes`, remain inside the encrypted vault.
- The Capsule has sealed-core and envelope integrity hashes, but they are not digital signatures or proof of authorship. Capsules, Host Requests, Host Receipts, Validation Plans, observation sets, Formal Results, and rendered prompts are not encrypted. Review them before sharing.
- Raw chat ingestion is intentionally unsupported.

## What the bridge verifies

- The preserved npm artifact has the documented SHA-256.
- The minimal compiled core files used at runtime match a checked-in manifest and fail closed on any byte change.
- The Capsule's sealed-core integrity hash and outer envelope hash are valid.
- An optional expected lineage matches.
- A Formal Plan exactly derives its Recovery Profile, Bundle, LoadReport, probe definitions, and execution policy from the verified Capsule and validation spec.
- A Formal Result re-derives the action-to-outcome classification and exactly replays the sealed final verifier over its bound Plan and observations.

These checks do not prove that profile statements are true or establish consciousness or subjective sameness. A Host Receipt records a response as `observed_unverified`. A Formal Result's verdict is limited to its declared Recovery Profile, load evidence, probes, and recorded transport evidence.

## Tests

```bash
cd runtime
npm test
```

The tests cover encryption round trips, wrong-passphrase failure, Capsule generation, sealed artifact and bridge integrity, tamper detection, lineage mismatch, privacy filtering, Host Request/Receipt binding, explicit-zone timestamps, formal plan derivation, deterministic action classification, all three sealed verdicts, answer-key isolation, reasoning allowlisting, exact request-count confirmation, mocked multi-probe OpenAI execution, stop-without-retry behavior, file permissions, and accidental-overwrite refusal. Tests never use a real API key or paid request.
