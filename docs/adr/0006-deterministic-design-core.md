# ADR 0006 — The design core is deterministic

**Status:** accepted (P1)

## Context

The product is described as "an AI graphic designer that thinks before it
prompts". The obvious reading is that the thinking is done by a language model.

## Decision

The entire path from Design Contract to Design Recipe — candidate generation,
scoring, conflict detection, doctrine resolution, DKV resolution, country
blending and recipe assembly — is **deterministic arithmetic over curated
datasets**. No model call occurs anywhere in P1.

## Consequences

**Reproducible.** The same brief produces the same recipe hash, today and in two
years against the same pinned dataset version. Property tests assert it.

**Arguable.** When a client asks why Swiss International was chosen, the answer
is a score breakdown and a named rule, not a paraphrase of a model's opinion.
When a movement is weakened, the resolution log names the layer that outranked
it and by how much.

**Cheap.** A full direction plus recipe costs zero tokens. Given the API billing
friction already hit on other Andala tools, this is not a footnote — it is what
makes the tool usable daily rather than rationed.

**Testable.** Pure functions with injected datasets, clock and ids need no
mocking framework and no recorded fixtures.

**The cost.** Everything the engine can reason about must exist in the datasets
first. The system cannot have an insight the data does not contain, and dataset
authoring becomes the real bottleneck — which is already the top risk on the
architecture register.

## Where the model goes instead

P2 adds an LLM at exactly two points: interpreting a raw brief into a
`NormalizedBrief`, and generating creative concepts *within* the constraints
this engine produces. Constrained ideation is better ideation, and neither task
is arithmetic.
