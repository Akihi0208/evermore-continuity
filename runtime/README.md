# Evermore Continuity Personal Runtime

This is a usable, model-neutral command-line runtime above the sealed `core/`. It lets a person create an encrypted local persona vault, turn explicitly portable anchors into a real Continuity Ledger and Capsule through the sealed core, verify the result, and render a handoff prompt for a receiving model.

It does **not** ingest chat history, prove subjective sameness, or claim that a receiving model has been verified. Its default path is manual and offline. An optional OpenAI Responses adapter makes exactly one explicitly enabled request. Passing local integrity checks is not host verification.

## Requirements

- Node.js 22 or newer
- A computer or server terminal

No package installation or API key is required for the manual path.

## Fastest path

From the repository root:

```bash
node runtime/bin/evermore.mjs init
node runtime/bin/evermore.mjs capsule runtime-secrets/persona.evermore-vault.json
node runtime/bin/evermore.mjs verify-capsule runtime-secrets/persona.evermore-vault.continuity-capsule.json
node runtime/bin/evermore.mjs host-request runtime-secrets/persona.evermore-vault.continuity-capsule.json
node runtime/bin/evermore.mjs verify-host-request runtime-secrets/persona.evermore-vault.host-request.json
node runtime/bin/evermore.mjs host-prompt runtime-secrets/persona.evermore-vault.host-request.json
```

The `capsule` command verifies the exact sealed artifact and its compiled runtime bridge before creating anything. The final command prints a model-neutral prompt. Review it, paste it into the AI host you want to test, and ask the host to return only the requested JSON. Save that reply as `observation.json`, then run:

```bash
node runtime/bin/evermore.mjs host-wrap runtime-secrets/persona.evermore-vault.host-request.json observation.json provider-name model-name
node runtime/bin/evermore.mjs verify-host runtime-secrets/persona.evermore-vault.host-receipt.json
```

This produces an integrity-bound receipt without making a network call. Provider and model names are labels supplied by the operator, not independently attested facts.

## Optional OpenAI Responses adapter

Only use this path when you intend to send the reviewed Host Request to OpenAI and accept possible API charges:

```bash
export OPENAI_API_KEY='your-key-kept-in-this-local-shell'
node runtime/bin/evermore.mjs host-run-openai runtime-secrets/persona.evermore-vault.host-request.json gpt-5.6-terra --allow-network --reasoning=medium
unset OPENAI_API_KEY
node runtime/bin/evermore.mjs verify-host runtime-secrets/persona.evermore-vault.host-receipt.json
```

The model is always explicit; there is no billed default. The adapter sends exactly one request to `https://api.openai.com/v1/responses`, requests `store: false`, uses strict Structured Outputs, and does not retry. It refuses to run without `--allow-network`; the key is read from the process environment and is never written into the receipt. See the official [Responses API guide](https://developers.openai.com/api/docs/guides/migrate-to-responses) and [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs).

`store: false` records what this client requested; it is not a blanket statement about every provider-side retention or account policy. No real OpenAI request is part of the repository's public test suite.

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

Do not commit the profile, vault, passphrase, Capsule, portable package, or rendered handoff. `runtime-secrets/` is ignored by Git.

Run `node runtime/bin/evermore.mjs doctor` to check the sealed artifact and every vendored bridge file without opening a vault.

The alpha.1 `export`, `verify-package`, and portable-package form of `prompt` remain supported for compatibility. New testing should use `capsule` and `verify-capsule`.

## Privacy model

- Vaults use `scrypt` plus AES-256-GCM with a random salt and nonce.
- Vault files are written with owner-only permissions where the operating system supports them.
- Existing vaults, portable packages, Capsules, Host Requests, and Host Receipts are not overwritten silently.
- Only anchors marked `capsule` enter the generated Ledger snapshot and Continuity Capsule.
- `local` and `private` anchors, plus all `privateNotes`, remain inside the encrypted vault.
- The Capsule has sealed-core and envelope integrity hashes, but they are not digital signatures or proof of authorship. Capsules, Host Requests, Host Receipts, and rendered prompts are not encrypted. Review them before sharing.
- Raw chat ingestion is intentionally unsupported.

## What the bridge verifies

- The preserved npm artifact has the documented SHA-256.
- The minimal compiled core files used at runtime match a checked-in manifest and fail closed on any byte change.
- The Capsule's sealed-core integrity hash and outer envelope hash are valid.
- An optional expected lineage matches.

These checks do not verify the receiving host, prove that the statements are true, or establish consciousness or subjective sameness. A Host Receipt records a response as `observed_unverified`; transport success is not formal host verification.

## Tests

```bash
cd runtime
npm test
```

The tests cover encryption round trips, wrong-passphrase failure, Capsule generation, sealed artifact and bridge integrity, tamper detection, lineage mismatch, privacy filtering before the Ledger snapshot, Host Request/Receipt binding, manual import, explicit network opt-in, a mocked single OpenAI response, file permissions, and accidental-overwrite refusal. Tests never use a real API key or paid request.
