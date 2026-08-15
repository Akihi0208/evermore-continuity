# Instructions for coding agents

## Goal

Help the user run the Personal Runtime without treating the repository as an automatic memory product. The usable alpha creates an encrypted local vault, generates a reviewed sealed-core Continuity Capsule, and renders a model-neutral handoff.

## Safe setup

1. Confirm Node.js 22 or newer.
2. Run `node --test runtime/test/*.test.mjs`.
3. Run `node runtime/bin/evermore.mjs init` in a user-controlled terminal.
4. The user must enter the vault passphrase locally. Never ask them to paste a passphrase, API key, cookie, raw chat export, or private profile into a chat.
5. Generate with `node runtime/bin/evermore.mjs capsule runtime-secrets/persona.evermore-vault.json`.
6. Verify with `verify-capsule`, render the handoff, and ask the user to review the visible contents before sending it to another model.

For non-interactive automation, the user may set `EVERMORE_PASSPHRASE` locally in the process environment. Do not write it to a repository file, command transcript, issue, or pull request.

## Project boundaries

- Do not edit the sealed `core/` or replace `artifacts/shenwu-continuity-0.3.0-rc.1.tgz` while working on the Personal Runtime.
- Do not commit anything under `runtime-secrets/` or any generated vault, Capsule, portable package, or handoff.
- Do not bypass or weaken the sealed-artifact and vendored-bridge hash checks.
- Do not import raw chats. Public examples and tests must remain synthetic.
- Do not claim that `ready` means `verified`, that a handoff creates automatic cross-session memory, or that this project proves consciousness or subjective sameness.
- Missing, masked, stale, conflicting, or unavailable material must never be presented as recovered.
- A locally valid Capsule must still say host verification has not run.
