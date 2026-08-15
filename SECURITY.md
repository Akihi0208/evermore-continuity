# Security and privacy

## Public tests use synthetic data only

Do not use real chat exports, real persona profiles, private ledgers, API keys, access tokens, cookies, provider receipts, or personal identifiers when testing this preview.

The public repository intentionally excludes the private host harness, real Recovery Profile, real ledger, private adapter package, runtime secrets, and private validation evidence.

## Personal Runtime data stays local

The `runtime/` CLI is intended to let a person create their own local profile without importing raw chats. Store personal profile drafts and encrypted vaults under `runtime-secrets/`, which Git ignores. Never commit a passphrase, profile draft, vault, Continuity Capsule, portable package, or rendered handoff.

Vaults are encrypted, but Continuity Capsules, portable packages, and rendered handoffs are not. They contain the capsule-visible anchors selected for transfer. The Capsule and envelope hashes detect changes; they are not digital signatures or proof of authorship. Local/private anchors and private notes do not enter the Capsule's Ledger snapshot. Review Capsules before sharing and send them only to the intended model or person.

The runtime checks the exact sealed artifact and each vendored compiled bridge file by SHA-256 before Capsule generation and verification. A mismatch or missing file fails closed. These local integrity checks do not establish host verification.

## Reports

Open a GitHub issue for ordinary bugs using a synthetic reproducer. For a vulnerability that would expose private identity material or bypass fail-closed verification, do not include the sensitive payload in a public issue. Post only a minimal synthetic description until a private reporting channel is added.

## Trust boundary

The core verifier is deterministic and model-neutral. Host-supplied observations are untrusted input. A model response, memory-system result, or host receipt is not authoritative unless it passes the declared integrity, provenance, freshness, privacy, and verification checks.
