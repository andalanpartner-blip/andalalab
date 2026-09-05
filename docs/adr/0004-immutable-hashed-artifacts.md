# ADR 0004 — Artifacts are immutable, version-pinned and content-hashed

**Status:** accepted (P0)

## Context
A project must remain readable years later, after schemas and datasets have moved on. Correction
loops in P6 will produce many derived versions of the same design.

## Decision
Every artifact carries `schema_version`, `dataset_version`, `created_by` and a content hash, and is
deep-frozen on creation. Revisions create new artifacts referencing their parent; nothing is ever
mutated. Brand data is **snapshotted into** the contract rather than referenced by id.

The hash covers the contract body only — id and timestamp are excluded — so "same brief in, same
contract out" is a testable property rather than an aspiration.

## Consequences
- The read path will need upcasters (registered in `types/versions.ts`, empty at P0) rather than
  destructive migrations.
- Storage grows. Irrelevant at this scale.
- Determinism is testable, and it is tested for all three golden briefs.
- Brand changes never retroactively alter old projects.
