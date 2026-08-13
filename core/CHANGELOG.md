# Changelog

All notable changes to Continuity are recorded here.

## [0.3.0-rc.1] - 2026-08-12

Status: sealed-release candidate pending final review; not formally sealed.

### Added

- V03-041 formal acceptance: run all 54 v0.3 core tests behind an active process-level network deny guard with model credentials removed.
- V03-042 formal acceptance: create and scan the actual npm-packed artifact for real chat exports, persona-specific identifiers, profile-like files, credentials, unexpected binary data, and runtime dependencies.

### Scope retained

- Alpha3 recovery and final-verifier core behavior is unchanged.
- No live model adapter, real persona Profile, Memory Vault/Aelios writeback, UI, Voice, or other new product feature was added.

## [0.2.0] - 2026-08-10

Status: sealed after code review.

### Added

- Separate Identity Core and Identity Texture layers.
- Orthogonal `evidenceKind` and `claimKind` provenance dimensions.
- Append-only self-acceptance revision chains and formal Co-evolution records.
- Deterministic Resolver, Drift Detector, Continuity Capsule generator, and v0.1 migration path.
- Synthetic persona example and synthetic continuity test suite.

### Fixed during code review

- Reject illegal self-acceptance status values and keep affected Evolution inactive.
- Require every Evolution predecessor to be active at application time.
- Revoke downstream causal effects when an upstream self-acceptance is withdrawn.
- Resolve same-timestamp dependency chains independently of lexical event IDs.
- Derive accepted drift changes from resolved state rather than caller-supplied IDs.
- Prevent private claims from leaking through Evolution IDs, Co-evolution references, conflicts, drift metadata, or free-form diagnostic explanations.
- Recompute and validate v0.1 and v0.2 snapshot hashes before trusted use.
- Remove persona-specific example content and replace it with fully synthetic data.

### Verification

- TypeScript build passed.
- 31 synthetic tests passed; 0 failed, skipped, or cancelled.
- Schema reference and invariant validation passed.
- Dependency audit reported 0 vulnerabilities.
- Package dry run passed.

### Scope retained

- No real conversation ingestion.
- No Memory Vault writeback.
- No UI, Voice, network feature, model call, or autonomous personality rewriting.
