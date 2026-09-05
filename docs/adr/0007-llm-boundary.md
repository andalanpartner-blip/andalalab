# ADR 0007 — Where the language model is allowed to be

**Status:** accepted (P2.1)

## Context

P1 established that the design core is deterministic. P2 introduces a model. The
risk is obvious: once a model is in the codebase, decisions drift toward it,
because asking it is always easier than encoding a rule.

## Decision

The model is confined to **one job in one file**: turning natural language into
a validated structure, in `engine/brief/normalize.ts`, through `LlmPort`.

Concretely:

- The port exposes no free-text method. Output is always schema-validated.
- The model's output shape (`BriefExtraction`) is not the engine's input shape
  (`NormalizedBrief`). A deterministic mapping sits between them.
- Enum vocabularies are generated from the loaded datasets, so the model cannot
  name an industry, country or movement that does not exist.
- The extraction schema is `.strict()`, so a model that volunteers
  `dkv_targets` is rejected rather than obeyed.
- Defaults and derivations are code, not prompt instructions.
- Completeness is code, not a question put to the model.
- A lint test fails the build if any engine file imports a provider adapter, and
  a source scan fails if provider names appear in engine code.

## Consequences

**One call.** A full brief-to-recipe run costs a single model call, under a cent
on Flash. Everything downstream is arithmetic.

**Reproducible where it matters.** The extraction step is not deterministic —
that is the nature of a model. Everything after it is: identical extraction
gives an identical recipe hash, asserted by test.

**Failure is typed.** Provider errors, timeouts, invalid JSON and schema
failures are distinct `LlmIssue` codes rather than a thrown string.

**The cost.** Two representations of a brief now exist and both must be
maintained when a field is added. That duplication is the price of the boundary,
and it is worth paying.

## What P2.2 must not do

The Creative Concept Engine will generate concepts with a model. It must
generate them **inside** the constraints the deterministic engine produces, and
its output must be scored and filtered by deterministic code — the diversity
gate, the generic-phrase validator. The model proposes; the engine disposes.
