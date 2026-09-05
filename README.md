# Andala AI Visual Employee

*An AI graphic designer that thinks before it prompts.*

**Phase P0 — Foundation.** Schemas, versioned datasets, loader, architectural boundaries and the
Design Contract builder. No UI, no database, no model integration, no prompt compiler, no critic.

## Commands

```bash
pnpm install
pnpm validate:data   # dataset schema + referential integrity + stereotype self-consistency
pnpm lint            # architectural boundary enforcement
pnpm test            # 86 tests
pnpm build           # tsc --noEmit && next build
pnpm check           # all four, in order
```

## What exists

| Layer | Status |
|---|---|
| `types/` — Zod schemas, schema version registry | ✅ |
| `data/` — 21 versioned reference datasets + loader | ✅ |
| `engine/` — pure, framework-free intelligence layer | ✅ contract stage only |
| `domain/` — entities and invariants | ✅ |
| `ports/` — injected clock and id | ✅ |
| `app/` — placeholder route so the build compiles | ⛔ no UI by design |
| `services/`, `adapters/`, `supabase/` | ⛔ not started (P2–P4) |

## The three rules that hold this together

**1. The engine is pure.** `engine/**` may not import React, Next, Supabase, `fs`, `path`, network
clients, adapters, services, or the dataset loader. It may not call `fetch`, `Date.now()`,
`new Date()` or `Math.random()`. This is enforced by `eslint.config.mjs` and *proved* by
`tests/lint/boundary.test.ts`, which lints deliberately illegal code and asserts the rule fires.

**2. Datasets are files, not code.** Adding a fifth country means dropping one JSON file into
`data/countries/`. No import to add, no registry to edit, no type to widen. There is a test for
exactly this (`tests/data/datasets.test.ts` → "picks up a new country from a file alone").

**3. Artifacts are immutable and version-pinned.** Every contract carries `schema_version`,
`dataset_version` and a content hash, and is deep-frozen. Revisions create new artifacts; they never
mutate old ones. A project built today must still be readable when the datasets have moved on.

## Test coverage by intent

| Suite | Proves |
|---|---|
| `tests/data` | Every dataset validates; cross-file references resolve; a bad file fails the build; a new country needs no code |
| `tests/anti-stereotype` | Doctrine §5 is enforced, not requested — guards exist, files don't contradict themselves, guards reach the contract, and the brief can override them explicitly |
| `tests/golden` | Three real briefs → contracts with the right floors, anchors, constraints and a stable hash |
| `tests/unit` | Doctrine precedence, blending, DKV merging, immutability, and every failure path |
| `tests/lint` | The architecture rule itself works |

## Next

P1 — the deterministic core: candidate scoring, conflict detection, doctrine resolution and the
Design Recipe builder. Still no AI, still no UI.
