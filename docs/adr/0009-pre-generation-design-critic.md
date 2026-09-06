# ADR 0009 — The Design Critic is deterministic and pre-generation

**Status:** accepted (P4.0) · **visual-review half landed (P4.1)** — see `docs/design-critic.md` and `docs/visual-review.md`

## Context

`docs/dkv-engine.md` and `docs/photographic-character-engine.md` both name a **Design Critic** as
the deferred layer that would turn the system's heuristics — the eight DKV parameters, the
artificiality-risk score — "from an opinion into a comparison" by measuring them in a generated
image.

Two things follow from that framing that this project has held since P2.7:

1. Measuring a generated image needs an image-generation call and a vision model — a **new
   provider** and a **new API**. Every milestone from P2.7 to P3.0 has explicitly excluded both.
2. Nothing currently gates the finished recipe or the compiled prompt. Readiness gates the brief,
   `validateConcept` gates concepts, P0 DKV conflicts reject candidates at direction time — but the
   rich diagnostic data the pipeline produces about the *final* design (`direction.derivations`,
   `direction.conflicts`, `recipe.movement.influence`, `artificiality_risk`, the immutable anchors,
   `PromptSet.guard`) is computed and then dropped.

## Decision

Build the Design Critic in two halves and ship the first now:

- **P4.0 — the pre-generation critic (`engine/critic/audit.ts`).** A pure, deterministic,
  read-only pass over a finished `contract → direction → recipe → PromptSet`. It consolidates
  every existing reviewer-attention signal into one `DesignCriticReport` with a three-state
  verdict (`PASS` / `REVIEW` / `BLOCK`). It calls no model, touches no image, hits no network, and
  mutates nothing. It never blocks the pipeline — a `BLOCK` verdict is advice for the reviewer.
- **The image-measuring half stays deferred.** When an image and a way to measure it exist, its
  measurements plug into the same `DesignCriticReport` as additional findings. The report schema
  and the P0/P1/P2 severity model are designed to accommodate that without a rewrite.

Severity reuses the pipeline's own `ConflictSeverity` scale unchanged: a `P0` finding contributes
`BLOCK`, a `P1` finding contributes `REVIEW`, a `P2` finding is informational and never changes the
verdict.

## Consequences

- The stereotype-guard property, the anchor-integrity property and the "every `must` constraint
  reaches a prompt" property become **CI-assertable** verdicts rather than scattered checks.
- The critic is additive: `RecipeOkResult` gains a `critic` field; existing `{recipe, promptSet}`
  consumers are unaffected, and a clean design produces `PASS` with no findings.
- A brief with a pinned movement that doctrine largely overrules (`brutalist-trust-conflict`) now
  surfaces its P0 tension as a `BLOCK` verdict the reviewer must acknowledge, instead of a silent
  recipe.
- No new ADR is needed when the image half lands — it extends this one.

## P4.1 — the visual-review half (landed)

Built as the extension this ADR anticipated, and **still with no image API, no
vision model and no new provider**. The mechanism is a structured
`VisualEvidence` input — a bounded description of what is observed in one
rendered frame, the shape a human reviewer or (later) a vision model fills in.
No computer vision was implemented.

- `reviewDesign(...)` runs `auditDesign(...)` unchanged, embeds the
  `DesignCriticReport` verbatim as `pre_generation`, and maps its findings into
  a twelve-category / four-severity (`P0`–`P3`) model as **design_compliance**
  issues (`basis: "evidence-backed"`).
- **visual_quality** and **technical_quality** are reported `unassessed` — with a
  `null` score and an explicit "not assessed" issue — unless a `VisualEvidence`
  fixture whose `recipe_hash` matches is supplied; then their issues are
  `basis: "fixture-backed"`. A schema refinement forbids a non-`unassessed`
  issue with empty evidence, so no visual or technical claim can be stated as
  fact without evidence.
- Read-only and deterministic, exactly like P4.0. It never mutates the recipe;
  a critique never feeds back into a `DesignRecipe`.
- Additive: `RecipeOkResult` gains `review` alongside the untouched `critic`.
  The P4.0 verdict, checks and calibration are unchanged.
- When a vision model eventually produces `VisualEvidence`, nothing in the
  critic changes — only the `source` field on the evidence.
