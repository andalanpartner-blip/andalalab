# Correction Engine (P6)

`{ parentRecipe, contract, direction, concept?, CorrectionPatch } → new derived DesignRecipe (+ PromptSet + Design Critic verdict)`.
Deterministic, pure, **no LLM, no image, no network, no database, no new framework**.

The "correction loops" named in [ADR 0004](adr/0004-immutable-hashed-artifacts.md)
and built for by `diffRecipes`, the immutable-anchor mechanism and
`recipe.derived_from`. V1 takes **structured input only** — there is no
natural-language / model front door.

## Why

Every stage before the recipe has a way to revise it — a clarification answer
re-runs the brief, a different concept re-builds the recipe. The finished recipe
had none: no way to say "a little more whitespace" without starting over.

## What a correction is (and is not)

A correction nudges the **measurable design parameters** and a few
**dataset-derived biases**. It never touches what the work *is*.

| Correctable | Path |
| --- | --- |
| `whitespace`, `contrast`, `visual_density`, `alignment`, `hierarchy_strength`, `color_complexity`, `focal_dominance`, `typographic_scale_ratio` | DKV params — flow through `resolveDkv` |
| `color_saturation` | `recipe.color.saturation` |
| `imagery_realism` | `recipe.imagery.realism` (this is how "framing / crop" corrections are expressed — more photographic vs. more graphic; the framing *prose* is the country's philosophy and a correction never rewrites it) |
| `materiality_texture` | `recipe.materiality.texture` |
| `graphic_ornament` | `recipe.graphic_language.ornament` |

| Never touched by a correction — a change here is a **REDESIGN** |
| --- |
| movement · layout · composition strategy · typography strategy · concept · objective · core message · grid · reading order · culture blend · channel · aspect ratio |

These are the immutable anchors and the structural recipe fields. `classifyRecipeDiff`
(`engine/correction/classify.ts`) is the guard: any anchor violation or change to a
`STRUCTURAL_PREFIXES` path ⇒ `redesign`, and **no recipe is produced** — the reviewer
is told to go back to the Design Direction stage.

## `CorrectionPatch`

```ts
CorrectionPatch = { adjustments: CorrectionAdjustment[] (min 1); note?: string }
CorrectionAdjustment = {
  field: CorrectionField;               // one of the 12 above
  mode: "set" | "increase" | "decrease";
  amount: number;                       // set: the desired value; increase/decrease: a positive delta
  note?: string;
}
```

Multiple adjustments to the same field fold in order (`set` overwrites, `increase` /
`decrease` accumulate). The result is clamped to the field's absolute range and,
for a DKV field, **to the band the parent direction already established** — a
correction moves *within* the design's bands, it never widens them. A request
outside the band is clamped and the report names the layer that held it.

## Outcomes

| `outcome` | meaning | recipe produced? |
| --- | --- | --- |
| `adjustment` | the requested nudges resolved to a real, non-structural change | **yes** — a new derived recipe |
| `noop` | every requested value was already in place (or fully held by a band) | no |
| `redesign` | the change would alter a structural field / locked anchor | no — rejected with a plain-language reason |

`CorrectionReport` carries `outcome`, a plain-language `reason`, the per-field
`changes` (`{ field, requested, resolved, held_by? }`), a compact `diff`
projection, and the `derived_from` `lineage`.

## Immutability & lineage (ADR 0004)

The parent recipe is **never mutated**. An accepted correction produces a brand
new recipe with:

- `derived_from = parent.id`
- a fresh `id`, `created_at` and `recipe_hash`
- deep-frozen, schema-validated

A **DKV** correction additionally derives a new **contract** (the correction
rules appended to `dkv_rules` at doctrine rank 2, `source: "client correction:<id>"`)
and a new **direction** (rebuilt on the same candidate — the movement, layout and
composition are provably unchanged). `runCorrectionPipeline` returns all three;
a caller chaining corrections must carry the new triple forward, not the
originals. A **bias-only** correction reuses the contract and direction as-is.

`buildDesignRecipe` relaxes its concept-direction check when `derivedFrom` is set:
a DKV correction gives the direction a fresh id, but the concept — an idea, not a
set of numbers — is still valid, and the redesign guard is the backstop. The
P4.0 critic (`auditDesign`) makes the same allowance: its `concept-direction-drift`
check is suppressed on a derived recipe whose `concept_ref` still points at the
supplied concept, so a re-audited correction is judged on its real findings
rather than on the regenerated direction id.

## Every derived recipe re-runs the downstream pipeline

`runCorrectionPipeline`:

```
applyCorrection → (adjustment) → compilePromptSet → guardPromptSet (P3.0) → auditDesign (P4.0)
              → { recipe, contract, direction, promptSet, critic, correction }
```

So a corrected recipe carries a fresh Design Critic verdict — including the
`dkv-consistency` check, which holds because DKV corrections flow through
`resolveDkv` rather than poking `recipe.dkv`.

## Architecture

| File | Role |
| --- | --- |
| `types/schemas/correction.schema.ts` | `CorrectionPatch`, `CorrectionReport` |
| `engine/correction/classify.ts` | `classifyRecipeDiff` — the adjustment / redesign / noop predicate |
| `engine/correction/apply.ts` | `applyCorrection` — request folding + banding, contract/direction re-derivation, `buildDesignRecipe` with overrides, report assembly |
| `engine/recipe/build.ts` | gained an optional `overrides` param (four biases) — additive, byte-identical when absent |
| `services/pipeline.service.ts` | `runCorrectionPipeline` |
| `app/api/correction/route.ts` | the route |
| `components/CorrectionPanel.tsx` | the minimal UI — field / mode / amount, and the outcome |

## Guarantees

- Pure and deterministic — identical `{ parentRecipe, contract, direction, patch }` (with an identical id stream) ⇒ byte-identical derived recipe and `recipe_hash`.
- The parent recipe is never mutated; it stays frozen.
- A correction can never change the movement, layout, composition, concept, objective or core message — that is a `redesign`, rejected.
- A correction can never widen a DKV band it was given; a below-band request is clamped and the holding layer is named.
- Additive: `buildDesignRecipe` without `overrides` is byte-identical to before P6; all P0–P4 behavior is unchanged.
- No LLM, no image / vision API, no network, no database, no new framework.
