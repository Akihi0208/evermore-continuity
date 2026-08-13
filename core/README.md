# Continuity v0.2

Continuity is a small, deterministic identity-continuity engine for long-lived AI personas. It sits above memory systems: memories describe events, while Continuity tracks which identity claims remain current, how they changed, and whether a portable identity capsule can be trusted.

## What v0.2 contains

- Separate Identity Core and Identity Texture claim layers.
- Orthogonal `evidenceKind` and `claimKind` provenance axes.
- Append-only ledgers for evidence, claims, Evolution, self-acceptance, and Co-evolution.
- Independent self-acceptance revision chains with accepted, rejected, pending, and withdrawn states.
- A deterministic `Resolver` supporting `refines`, `supersedes`, `contradicts`, `coexists`, and `temporarily_overrides`.
- Fail-closed acceptance resolution: missing roots, broken links, cycles, revision gaps, and branches never activate an Evolution.
- Co-evolution influence graphs that cannot override a participant's identity.
- A lossless v0.1 migration archive plus explicit issues for records the v0.2 schema cannot safely reinterpret.
- Provenance rules that reject inference-only promotion into a fact claim.
- A drift detector that separates explained growth from unexplained replacement and can mark policy or retrieval masking as uncertain.
- A minimal Continuity Capsule generator with lineage metadata, source snapshot hashes, privacy filtering, and tamper detection.
- Synthetic continuity tests. No real conversations are imported.

## Explicit non-goals

v0 does not include a UI, voice, autonomous personality rewriting, live model orchestration, Memory Vault writeback, or real-chat ingestion. It has no runtime dependencies and makes no network calls.

## Run

Requirements: Node.js 22 or newer.

```bash
npm ci
npm test
```

## Small example

```ts
import {
  ContinuityLedger,
  resolveIdentity,
  generateCapsule,
} from "@shenwu/continuity";

const ledger = new ContinuityLedger({
  identityId: "agent-a",
  lineageId: "lineage-a",
  version: 2,
});

// Append evidence and identity claims, then resolve a current view.
const resolved = resolveIdentity(ledger.snapshot());
const capsule = generateCapsule(resolved, ledger.snapshot(), {
  generatedAt: "2026-08-10T00:00:00.000Z",
});

console.log(capsule.integrityHash);
```

See `examples/synthetic-persona.ts` for a fully synthetic persona instance kept outside the generic engine.

The v0.3 release candidate gates are documented in `V03_RELEASE_GATE.md`. Run `npm run test:v03:release-gate` for the dedicated network-disabled and packed-artifact checks; both are also included in `npm run test:v03` and `npm test`.

## Specification status

`PHILOSOPHY.md`, `SPEC.md`, and `schema/continuity.schema.proposal.json` are the design baseline for this implementation. The TypeScript API uses camelCase names while preserving the schema's one-to-one field semantics.

## Storage model

The ledger stores immutable events. Current identity is a materialized view produced by the resolver. Old claims are never deleted when a newer claim supersedes or refines them.

The reference implementation is in-memory so the semantic model remains easy to test. A future persistence adapter can serialize snapshots to SQLite or another append-only store without changing resolver behavior.

## Safety and privacy defaults

- The active v0.2 ledger contains only Core and Texture claims; non-Core/Texture v0.1 records remain verbatim in the migration archive.
- Claims marked `local` or `private` are excluded unless explicitly requested.
- Co-evolution records marked `local` or `private` are excluded unless explicitly requested.
- The capsule includes a deterministic integrity hash and can be chained to a parent capsule.
- The engine never upgrades inference or hypothesis evidence into a fact claim.
- No LLM is used as an authority inside the resolver.
