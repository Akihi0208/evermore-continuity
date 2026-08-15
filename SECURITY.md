# Security and privacy

## Public tests use synthetic data only

Do not use real chat exports, real persona profiles, private ledgers, API keys, access tokens, cookies, provider receipts, or personal identifiers when testing this preview.

The public repository intentionally excludes the private host harness, real Recovery Profile, real ledger, private adapter package, runtime secrets, and private validation evidence.

## Personal Runtime data stays local

The `runtime/` CLI is intended to let a person create their own local profile without importing raw chats. Store personal profile drafts and encrypted vaults under `runtime-secrets/`, which Git ignores. Never commit a passphrase, profile draft, vault, Continuity Capsule, portable package, or rendered handoff.

Vaults are encrypted, but Continuity Capsules, Host Requests, Host Receipts, Validation Plans, Formal Results, portable packages, and rendered handoffs are not. They contain the capsule-visible anchors selected for transfer; receipts and formal results also contain host-generated response text and transport metadata. Their hashes detect changes but are not digital signatures or proof of authorship. Local/private anchors and private notes do not enter the Capsule's Ledger snapshot. Review every generated artifact before sharing and send it only to the intended model or person.

The runtime checks the exact sealed artifact and each vendored compiled bridge file by SHA-256 before Capsule generation and verification. A mismatch or missing file fails closed. These local integrity checks do not establish host verification.

The optional OpenAI adapter is disabled unless `--allow-network` is supplied. It accepts an API key only from the local `OPENAI_API_KEY` process environment, sends one request to the fixed HTTPS Responses endpoint, requests `store: false`, and does not retry. Never paste a key into chat, a profile, a Host Request, a receipt, an issue, or a shell-history command. `store: false` describes the request made by this client and does not replace review of the provider's current data and account policies.

Formal Validation Plans contain both allowed and forbidden outcome classifications: they are the verifier answer key. Never send a whole Plan to the tested model. `formal-prompt` renders one probe with an unlabeled outcome catalog. The OpenAI formal runner makes exactly one request per probe, requires `--confirm-requests=N` to match the Plan, never retries, and creates no result file if any request fails.

The resulting hashes and verdict cannot prove that an operator kept the answer key hidden. Treat test independence as an evidence-quality question and publish the exact runner version, Plan hash, result hash, and transport metadata when reporting results.

A manual result is labeled `manual_unattested` because provider and model names are supplied by the operator. An OpenAI API result is labeled `openai_api_observed` and binds response IDs plus available `x-request-id` values. Neither evidence class is a digital signature or proof of subjective identity.

## Reports

Open a GitHub issue for ordinary bugs using a synthetic reproducer. For a vulnerability that would expose private identity material or bypass fail-closed verification, do not include the sensitive payload in a public issue. Post only a minimal synthetic description until a private reporting channel is added.

## Trust boundary

The core verifier is deterministic and model-neutral. Host-supplied observations are untrusted input. A syntactically valid receipt remains `observed_unverified`: it proves internal binding and tamper detection, not that provider/model labels are true, that a model retained context, or that identity continuity was established.
