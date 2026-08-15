# Evermore Continuity Personal Runtime

This is the first usable, model-neutral command-line runtime above the sealed `core/`. It lets a person create an encrypted local persona vault, export only explicitly portable anchors, verify the exported package, and render a handoff prompt that can be pasted into a receiving model.

It does **not** call a model API, ingest chat history, prove subjective sameness, or claim that a receiving model has been verified. The first release is deliberately manual and offline.

## Requirements

- Node.js 22 or newer
- A computer or server terminal

No package installation or API key is required.

## Fastest path

From the repository root:

```bash
node runtime/bin/evermore.mjs init
node runtime/bin/evermore.mjs export runtime-secrets/persona.evermore-vault.json
node runtime/bin/evermore.mjs verify-package runtime-secrets/persona.evermore-vault.portable.json
node runtime/bin/evermore.mjs prompt runtime-secrets/persona.evermore-vault.portable.json
```

The final command prints a model-neutral handoff. Review it, then paste it into the AI host you want to test.

## For coding agents and scripts

Start from `examples/synthetic-profile.json`, copy it into the ignored `runtime-secrets/` directory, replace the synthetic values locally, and seal it without interactive prompts:

```bash
mkdir -p runtime-secrets
cp runtime/examples/synthetic-profile.json runtime-secrets/my-profile.json
export EVERMORE_PASSPHRASE='use-a-long-unique-passphrase'
node runtime/bin/evermore.mjs seal runtime-secrets/my-profile.json runtime-secrets/my-persona.evermore-vault.json
node runtime/bin/evermore.mjs export runtime-secrets/my-persona.evermore-vault.json
unset EVERMORE_PASSPHRASE
```

Do not commit the profile, vault, passphrase, portable package, or rendered handoff. `runtime-secrets/` is ignored by Git.

## Privacy model

- Vaults use `scrypt` plus AES-256-GCM with a random salt and nonce.
- Vault files are written with owner-only permissions where the operating system supports them.
- Existing vaults and portable packages are not overwritten silently.
- Only anchors marked `capsule` are exported.
- `local` and `private` anchors, plus all `privateNotes`, remain inside the encrypted vault.
- A portable package is integrity-hashed to catch accidental changes, but the hash is not a digital signature and the contents are not encrypted. Review it before sharing.
- Raw chat ingestion is intentionally unsupported.

## Tests

```bash
cd runtime
npm test
```

The tests cover encryption round trips, wrong-passphrase failure, tamper detection, export privacy filtering, package integrity, prompt privacy, file permissions, and accidental-overwrite refusal.
