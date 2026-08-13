# Security and privacy

## Test with synthetic data only

Do not use real chat exports, real persona profiles, private ledgers, API keys, access tokens, cookies, provider receipts, or personal identifiers when testing this preview.

The public repository intentionally excludes the private host harness, real Recovery Profile, real ledger, private adapter package, runtime secrets, and private validation evidence.

## Reports

Open a GitHub issue for ordinary bugs using a synthetic reproducer. For a vulnerability that would expose private identity material or bypass fail-closed verification, do not include the sensitive payload in a public issue. Post only a minimal synthetic description until a private reporting channel is added.

## Trust boundary

The core verifier is deterministic and model-neutral. Host-supplied observations are untrusted input. A model response, memory-system result, or host receipt is not authoritative unless it passes the declared integrity, provenance, freshness, privacy, and verification checks.
