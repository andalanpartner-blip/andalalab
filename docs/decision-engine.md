# Decision Engine

Turns a Design Contract into a Design Direction. No LLM is involved at any point.

## Pipeline

```
DesignContract
  → generateCandidates()   filter    engine/decision/candidates.ts
  → scoreCandidates()      rank      engine/decision/score.ts
  → collectClaims()        gather    engine/decision/conflicts.ts
  → resolveDkv()           arbitrate engine/dkv/rules.ts
  → buildRationale()       explain   engine/decision/explain.ts
  = DesignDirection
```

## Candidates

A candidate is a **(movement × layout)** pair. Colour, composition and typography
strategies are *derived* from that pair rather than enumerated as extra axes —
enumerating them would multiply the search space without adding information and
would let the scorer pick a palette that contradicts the movement that produced
it. See `engine/decision/strategies.ts`; every threshold there is named.

Filtering happens only in `candidates.ts`. Scoring never eliminates, it ranks.
Keeping those jobs apart means an empty candidate set is a data problem with a
readable explanation rather than a mysterious zero.

Filters, in order:

1. **Pinned movement** — if the brief names one, it is the only candidate. A
   pinned movement is a rank-1 client instruction; if it fights the industry it
   is kept and constrained loudly, never silently swapped.
2. **Explicit prohibitions** — a `must_not`/`avoid` constraint whose text
   contains a movement id or name removes that movement.
3. **Industry compatibility** — bidirectional: the movement declares the
   industry, or the industry declares the movement.
4. **Objective compatibility** — hard filter *if at least one movement survives
   it*; otherwise relaxed, scored instead, and the relaxation is reported in the
   rationale. An empty candidate set is a worse answer than a caveated one.
5. **Layouts** — those the visual type supports, or the pinned layout.

## Scoring

Weights are fixed by the P1 specification and sum to 1:

| Dimension | Weight | What it measures |
|---|---|---|
| communication_fit | 0.25 | objective support, required zones, focal/hierarchy demand, message capacity |
| industry_fit | 0.15 | preferred movement, contrast floor, density ceiling, information pressure |
| audience_fit | 0.15 | attention context, sophistication vs complexity, price sensitivity |
| brand_fit | 0.15 | preferred movement, formality vs grid discipline, palette breadth |
| culture_fit | 0.10 | whitespace, density, symmetry, typographic weight |
| movement_fit | 0.10 | grid agreement, parameter agreement between movement and layout |
| platform_fit | 0.05 | focal requirement, text render risk, viewing distance |
| distinctiveness | 0.05 | departure from the industry's and visual type's first-listed defaults |

Inside a dimension, each named rule declares the share it can contribute, and
those shares also sum to 1 — so a raw dimension score always reads as "how much
of what this dimension wanted did the candidate deliver".

**Inapplicable dimensions.** A dimension with no evidence — brand fit with no
brand — is marked `applicable: false` and its weight is redistributed
proportionally across the rest. Scoring it 0.5 would pull every candidate toward
the middle and pretend the system knows something it does not.

**Ties** break on `candidate_id`, never on input order.

## Selection and rejection

Candidates are evaluated in score order. The first whose conflicts resolve
without a P0 is selected. A candidate carrying an unresolvable P0 is rejected
and the next is tried (spec §8).

The exception: **a pinned movement is never rejected**. Substituting a movement
the client explicitly asked for would be the wrong product behaviour; the
resolution log carries the damage report instead.

## Explainability

Every sentence in `rationale` is assembled from a structure that already exists
— a score breakdown, a resolution, a derivation. Nothing is written by hand per
case and nothing comes from a model, so an explanation cannot drift away from
the arithmetic it describes.
