# Instructions for coding agents

## Goal

Help the user run the Personal Runtime without treating the repository as an automatic memory product. The usable alpha creates an encrypted local vault, generates a reviewed sealed-core Continuity Capsule, packages ordinary host observations, and can run declared behavioral probes through the sealed final verifier.

## Safe setup

1. Confirm Node.js 22 or newer.
2. Run `node --test runtime/test/*.test.mjs`.
3. Run `node runtime/bin/evermore.mjs init` in a user-controlled terminal.
4. The user must enter the vault passphrase locally. Never ask them to paste a passphrase, API key, cookie, raw chat export, or private profile into a chat.
5. Generate with `node runtime/bin/evermore.mjs capsule runtime-secrets/persona.evermore-vault.json`.
6. Verify with `verify-capsule`, render the handoff, and ask the user to review the visible contents before sending it to another model.
7. Prefer the offline `host-request` → `host-prompt` → `host-wrap` path. A Host Request and Host Receipt are unencrypted and must be reviewed before sharing.
8. Use `host-run-openai` only when the user explicitly chooses network execution, supplies the model name, and accepts that one API request may incur a charge. Never add `--allow-network` on the user's behalf.
9. For formal validation, create and verify a `formal-plan`, render only one `formal-prompt` at a time, and collect exactly one observation for every declared probe before running `formal-wrap`.
10. A Validation Plan contains the verifier's allowed/forbidden outcome classification. Never send the whole plan to the tested model; send only rendered probe prompts, which intentionally omit that classification.

For non-interactive automation, the user may set `EVERMORE_PASSPHRASE` locally in the process environment. Do not write it to a repository file, command transcript, issue, or pull request.

## Project boundaries

- Do not edit the sealed `core/` or replace `artifacts/shenwu-continuity-0.3.0-rc.1.tgz` while working on the Personal Runtime.
- Do not commit anything under `runtime-secrets/` or any generated vault, Capsule, portable package, or handoff.
- Do not bypass or weaken the sealed-artifact and vendored-bridge hash checks.
- Do not import raw chats. Public examples and tests must remain synthetic.
- Do not claim that `ready` means `verified`, that a handoff creates automatic cross-session memory, or that this project proves consciousness or subjective sameness.
- A valid Host Receipt means only that the request, transport metadata, and structured observation are internally consistent. Its status must remain `observed_unverified`.
- Never ask for or store an OpenAI API key. The optional adapter reads `OPENAI_API_KEY` from the user's local process, sends exactly one request to the fixed Responses endpoint, requests `store: false`, and performs no retry.
- `formal-run-openai` makes one request per probe. It requires the operator to confirm the exact request count, never retries, and must not save a partial result after failure.
- Interpret evidence classes precisely: `manual_unattested` does not attest provider/model labels; `openai_api_observed` records API response and request IDs but still does not prove consciousness or subjective sameness.
- Missing, masked, stale, conflicting, or unavailable material must never be presented as recovered.
- A locally valid Capsule must still say host verification has not run.
