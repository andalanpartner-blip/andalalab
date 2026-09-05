# ADR 0008 — Concepts are proposed by a model and judged by code

**Status:** accepted (P2.2)

## Context

Creative ideation is the one part of this system a deterministic engine cannot
do. It is also the part where a model's failure modes are most expensive: filler
prose that sounds like a concept, and three "different" concepts that are one
idea in three palettes.

## Decision

The model writes concepts. Every decision *about* those concepts — valid,
distinct, scored, selected — is deterministic code.

Specifically:

- The proposal schema is separate from the stored artifact and is `.strict()`.
- `self_score` is stored as `model_advisory` and never read by the selector.
- Diversity is measured on a vector that mixes declared labels with an
  engine-derived metaphor family and a styling-stripped lexical signature.
- Specificity uses vagueness as a **multiplier**, so fluent emptiness cannot
  average its way to a pass.
- The banned-phrase, vagueness and styling lexicons are versioned dataset files.
- The concept anchor stores `id@hash`, so editing an idea in place is detectable.

## Consequences

**Two model calls, capped.** One generation plus at most one targeted
regeneration. Full pipeline from raw Indonesian brief to locked recipe: two calls
in total, under a cent.

**Rejections are actionable.** Every issue carries a reason and a fix, and the
cultural fixes come from the country files' own `instead` guidance — so the
repair prompt tells the model what to do, not merely that it failed.

**The gate can be wrong in one direction.** Lexical measures reject some good
concepts that happen to be tersely written, and accept some weak ones that are
merely concrete. Erring toward rejection is the right side to be wrong on: the
cost is one regeneration call.

**Styling can no longer masquerade as a concept.** Stripping colour, light, lens
and type before comparison is what makes "beige version" and "cream version"
collapse into the same signature. It also means the engine is blind to genuine
cases where material treatment *is* the idea — accepted, and noted as a limit.
