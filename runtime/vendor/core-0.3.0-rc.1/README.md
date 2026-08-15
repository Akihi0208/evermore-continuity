# Vendored sealed-core runtime

These seven JavaScript files are the minimal runtime subset compiled from the unchanged `core/src/` TypeScript in Evermore Continuity `0.3.0-rc.1` with TypeScript `5.9.3`.

They exist so the Personal Runtime can generate and verify a real Continuity Ledger/Capsule offline without installing packages or rewriting the sealed core. `runtime/src/core-integrity.mjs` checks every file hash and the original sealed tgz hash before the bridge is allowed to run.

The authoritative source remains `core/`, and the authoritative packaged artifact remains `artifacts/shenwu-continuity-0.3.0-rc.1.tgz` with SHA-256 `7865c2144c0fc55209ee9777d818517dd242a36d5ef0f00b401cf5e6009a1c48`.
