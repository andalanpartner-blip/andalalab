# ADR 0004 — Artifacts are immutable, version-pinned and content-hashed

**Status:** accepted (P0) · **correction loops implemented (P6)** — see `docs/correction-engine.md`

## Context
A project must remain readable years later, after schemas and datasets have moved on. Correction
loops (P6) produce many derived versions of the same design.

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

## P6 — Correction Engine
Implemented as designed: a correction (`engine/correction/apply.ts`) never mutates the parent
recipe. It produces a new derived recipe with `derived_from = parent.id`, a fresh id / timestamp /
hash, deep-frozen. A DKV correction additionally derives a new contract and direction (same
candidate, re-tuned band). Anything that would move a locked anchor or a structural field is
rejected as `redesign` — no recipe is produced. The bounded patch surface is the DKV parameters
plus colour saturation, imagery realism, materiality texture and ornament; movement, layout,
composition, concept, objective and core message are out of reach by construction.
