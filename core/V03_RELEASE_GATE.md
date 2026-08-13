# Continuity v0.3 Final Release Gate

Status: `0.3.0-rc.1` sealed-release candidate pending final review. This document does not declare the release formally sealed.

## Scope

This gate adds acceptance infrastructure only. The Alpha3 recovery loader, trusted-head selection, freshness rules, LoadReport, final verifier, and structured-probe semantics remain unchanged.

No live model adapter, real persona Profile, real chat ingestion, Memory Vault/Aelios writeback, UI, Voice, or other product feature is introduced.

## V03-041: network-disabled core execution

`tests/recovery-v03-release-gate.test.ts` launches the complete 54-test v0.3 core suite in a child Node process preloaded with `scripts/network-disabled-guard.mjs`.

The guard denies and audits Node network entry points for TCP, TLS, HTTP, HTTPS, DNS, UDP, `fetch`, WebSocket, and EventSource. It performs a self-check before the suite starts, removes common model credentials from the child environment, and fails the release gate if:

- the guard is not active;
- any network attempt occurs, even if caller code catches the denial;
- the child suite does not report exactly 54 passes and zero failures; or
- the fixed core test sources are not explicitly synthetic and observation-based.

## V03-042: packed-artifact data scan

The formal acceptance test creates the real npm tarball with `npm pack` and passes that exact artifact to `scripts/scan-packed-artifact.mjs`.

The scanner inspects every packed file and rejects:

- known persona-specific identifiers or anchor names, except the package scope and the sealed v0.2 negative-absence assertions;
- chat-export structures, transcript-like turn sequences, profile-like filenames, or non-synthetic examples/fixtures/tests;
- credential-like tokens, private keys, email-like personal identifiers, unexpected binary content, or risky archive paths;
- live model SDK imports/endpoints or any runtime dependency; and
- archive/database/mail formats that do not belong in the package.

The scanner is included in the packed artifact and runs on every `test:v03` and full `test` execution through the formal V03-042 acceptance case.

## Commands

```sh
npm run test:v03:release-gate
npm run test:v03
npm run test:v02
npm test
TZ=UTC npm run test:v03
TZ=Asia/Shanghai npm run test:v03
npm run check:schema
npm pack --dry-run --json
```

The final review report records the exact results, artifact hashes, and package file inventory outside this candidate package.
