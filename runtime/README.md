# Evermore Continuity Personal Runtime

This is a usable, model-neutral command-line runtime above the sealed `core/`. It lets a person create an encrypted local persona vault, turn explicitly portable anchors into a real Continuity Ledger and Capsule through the sealed core, verify the result, and render a handoff prompt for a receiving model.

It does **not** call a model API, ingest chat history, prove subjective sameness, or claim that a receiving model has been verified. This alpha is deliberately manual and offline. Passing local integrity checks is not host verification.

## Requirements

- Node.js 22 or newer
- A computer or server terminal

No package installation or API key is required.

## Fastest path

From the repository root:

```bash
node runtime/bin/evermore.mjs init
node runtime/bin/evermore.mjs capsule runtime-secrets/persona.evermore-vault.json
node runtime/bin/evermore.mjs verify-capsule runtime-secrets/persona.evermore-vault.continuity-capsule.json
node runtime/bin/evermore.mjs prompt runtime-secrets/persona.evermore-vault.continuity-capsule.json
```

The `capsule` command verifies the exact sealed artifact and its compiled runtime bridge before creating anything. The final command prints a model-neutral handoff. Review it, then paste it into the AI host you want to test.

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
- Existing vaults, portable packages, and Capsules are not overwritten silently.
- Only anchors marked `capsule` enter the generated Ledger snapshot and Continuity Capsule.
- `local` and `private` anchors, plus all `privateNotes`, remain inside the encrypted vault.
- The Capsule has sealed-core and envelope integrity hashes, but they are not digital signatures or proof of authorship. Its contents are not encrypted. Review it before sharing.
- Raw chat ingestion is intentionally unsupported.

## What the bridge verifies

- The preserved npm artifact has the documented SHA-256.
- The minimal compiled core files used at runtime match a checked-in manifest and fail closed on any byte change.
- The Capsule's sealed-core integrity hash and outer envelope hash are valid.
- An optional expected lineage matches.

These checks do not verify the receiving host, prove that the statements are true, or establish consciousness or subjective sameness. Generated handoffs report `Host verification: not run` until a separate adapter exists and returns acceptable evidence.

## Tests

```bash
cd runtime
npm test
```

The tests cover encryption round trips, wrong-passphrase failure, Capsule generation, sealed artifact and bridge integrity, tamper detection, lineage mismatch, privacy filtering before the Ledger snapshot, prompt privacy, file permissions, and accidental-overwrite refusal.
