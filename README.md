# Andala AI Visual Employee

*An AI graphic designer that thinks before it prompts.*

**Through P3.0.** Raw Indonesian/English brief → readiness gate → strategy → creative concepts →
Design Recipe → bilingual prompt set, with a stereotype output guard on the compiled prompt. The
only model call is the Brief Interpreter and the Creative Concept Engine (two calls, capped); every
design decision is deterministic. No database.

## Commands

```bash
pnpm install
pnpm validate:data   # dataset schema + referential integrity + stereotype self-consistency
pnpm lint            # architectural boundary enforcement
pnpm test            # 839 tests
pnpm build           # tsc --noEmit && next build
pnpm check           # all four, in order
```

## Pipeline

```
Brief → Readiness / Progressive Briefing → Strategy (DKV + doctrine resolution)
      → Creative Concepts → Selected Concept → Design Recipe
      → Prompt Compiler (+ Graphic Treatment, Photographic Character, Photographic Finish,
                          Visual Generation Adapter, Stereotype Output Guard)
      → ready-to-copy PromptSet (English + Bahasa Indonesia)
```

## What exists

| Layer | Status |
|---|---|
| `types/` — Zod schemas, schema version registry | ✅ |
| `data/` — versioned reference datasets + loader | ✅ |
| `engine/` — pure, framework-free intelligence layer (P0 contract → P3.0 output guard) | ✅ |
| `domain/` — entities and invariants | ✅ |
| `ports/` — injected clock and id | ✅ |
| `adapters/` — Gemini LLM adapter behind `ports/llm.port` | ✅ |
| `services/` — orchestration (`pipeline.service.ts`), cost ledger | ✅ |
| `app/`, `components/` — Next.js UI for the whole flow | ✅ |
| `supabase/` — persistence | ⛔ not started (deliberately no database yet) |

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
| `tests/anti-stereotype` | Doctrine §5 is enforced, not requested — guards exist, files don't contradict themselves, guards reach the contract, the brief can override them explicitly, and (P3.0) any that survive into a compiled prompt are stripped or flagged |
| `tests/golden` | Real briefs → contract / direction / recipe / prompt set with the right floors, anchors, constraints and stable hashes |
| `tests/unit` | Doctrine precedence, blending, DKV merging, immutability, brief interpretation, readiness, every additive P2.x layer, and every failure path |
| `tests/lint` | The architecture rule itself works |

## Docs

Per-engine design notes live in `docs/` (`decision-engine`, `recipe-engine`, `brief-interpreter`,
`readiness-policy`, `creative-concept-engine`, `graphic-treatment-engine`,
`photographic-character-engine`, `photographic-finish`, `visual-generation-adapter`,
`smart-brief-classification`, `prompt-compiler`, `prompt-output-guard`) and the accepted
architecture decisions in `docs/adr/`.
