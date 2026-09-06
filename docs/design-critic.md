# Design Critic (P4.0)

`{ contract, direction, recipe, promptSet, concept? } → DesignCriticReport`.
Deterministic, pure, read-only. No LLM, no image, no network.

The pre-generation half of the Design Critic named in `docs/dkv-engine.md` and
`docs/photographic-character-engine.md`. See
[ADR 0009](adr/0009-pre-generation-design-critic.md).

## Why

Every stage before the recipe has a quality gate — readiness gates the brief,
`validateConcept` gates concepts, P0 DKV conflicts reject candidates at
direction time. Nothing gates the **finished** design. The pipeline computes
rich diagnostics about it and then drops them:

| Signal | Where it's produced | Used by anything today? |
| --- | --- | --- |
| `direction.derivations` (8× base/target/band/final/governing/contributors) | `resolveDkv` | no |
| `direction.conflicts` + `direction.resolutions`, P0/P1/P2 severity | `resolveDkv` | no |
| `recipe.movement.influence` (how much of the movement survived doctrine) | `buildDesignRecipe` | no |
| `artificiality_risk` {score, band, factors} | P2.6 resolver | "reviewer attention" only |
| immutable anchors + `anchorViolations()` | P1 | only on explicit revision |
| `PromptSet.guard` findings | P3.0 | one UI line |

The Design Critic consolidates all of it into one verdict a human reads before
spending a generation credit.

## Contract

`runRecipePipeline` calls `auditDesign(...)` after the recipe and prompt are
built and returns it on `RecipeOkResult.critic`:

```ts
type DesignCriticReport = {
  verdict: "PASS" | "REVIEW" | "BLOCK";
  summary: string;                 // one deterministic plain-language line
  checks_run: number;              // 9
  findings: CriticFinding[];       // most-severe first, then by check slug
  audited: {                       // traceability, never re-derived
    contract_id; direction_id; recipe_id; recipe_hash; prompt_language; concept_ref;
  };
};

type CriticFinding = {
  check: string;                   // "dkv-conflict", "anchor-integrity", …
  area: "integrity" | "dkv" | "movement" | "photographic"
      | "prompt-coverage" | "stereotype-guard" | "concept";
  severity: "P0" | "P1" | "P2";    // the pipeline's own scale, reused
  message: string;
  evidence: string[];              // param names, requested→resolved, fragments
};
```

**Verdict rollup:** any `P0` ⇒ `BLOCK`; else any `P1` ⇒ `REVIEW`; else (only
`P2` or none) ⇒ `PASS`. `P2` findings are listed but never change the verdict.

- `PASS` — no significant design-quality issue found.
- `REVIEW` — a meaningful issue or tension exists; the recipe may still proceed with human review.
- `BLOCK` — a critical violation makes the recipe unsuitable to proceed.

The critic **never blocks the pipeline.** A `BLOCK` verdict is advice; the
recipe and prompt are still returned.

## Checks (9)

### Integrity — a violation means the artifact was corrupted or hand-edited (P0)

| check | what it asserts |
| --- | --- |
| `dkv-consistency` / `dkv-derivation-missing` | `recipe.dkv[p]` equals `direction.derivations[p].final` for all 8 params |
| `dkv-limits` | every `recipe.dkv[p]` inside `PARAM_LIMITS[p]` |
| `dkv-band` | every `derivation.final` inside the band it was clamped to |
| `linkage-*` | `direction.contract_id`, `recipe.contract_id`, `recipe.direction_id` all line up |
| `objective-drift` / `core-message-drift` | `recipe.objective` / `recipe.core_message` equal the contract's |
| `anchor-integrity` | `anchorViolations(contract.anchors, recipe.anchors)` is empty |
| `anchor-direction-unlocked` | the recipe locked its `primary_visual_direction` anchor |
| `anchor-concept-*` (when a concept is supplied) | the `concept` anchor is locked and equals `<id>@<hash>` |
| `linkage-concept` / `concept-direction-drift` | the supplied concept matches `recipe.concept_ref` and `direction.id`. On a derived recipe (`recipe.derived_from != null`) whose `concept_ref` still points at the supplied concept, `concept-direction-drift` is suppressed — a P6 DKV correction regenerates the direction id, and concept content stays pinned by `linkage-concept` and `anchor-concept-*`. |

### Design quality

| check | severity | fires when |
| --- | --- | --- |
| `dkv-conflict` | P0 / P1 / P2 | a surviving DKV conflict, mapped from `conflict.severity`. The matching resolution's requested→resolved is in `evidence`. |
| `movement-influence` | P1 | `recipe.movement.influence < 0.5` — the client's stylistic pin barely survived doctrine |
| `artificiality-vs-target` | P0 / P1 | `realism_target` is `photoreal-natural`/`photoreal-refined` **and** artificiality band is `high` (P0) or `elevated` (P1). Stylised targets expect a higher band — no finding. |
| `stereotype-guard` | P1 / P2 | rolls up `PromptSet.guard`: a `stripped` motif or a motif `flagged` in positive prose is P1; a motif `flagged` inside an "avoid" instruction is a P2 note (the guard working) |
| `constraint-coverage` | P0 / P1 | a `must` constraint (non-country, not an unsupported-concept statement) absent from every compiled prompt tier is P0; a missing `must_not` is P1 |
| `core-message-rendering` | P0 | the recipe is `TEXT_CRITICAL` but the exact core message is not quoted in the Master Prompt |

## Determinism

Findings are sorted `(severity, check slug, message)`. The summary string is a
pure function of the P0/P1/P2 counts. Identical inputs ⇒ byte-identical report.
No clock, no `Math.random`, no network, no model.

## Calibration (the 15 P1 fixtures)

| verdict | fixtures |
| --- | --- |
| `PASS` | kopi-lawas, minimal-promo-cta, type-led-fashion, property-editorial, warung-vernacular-promo, tokyo-fashion-editorial (P2 note), luxury-density-conflict (P2 note) |
| `REVIEW` | hardstone, northbeam, helvetica-labs, cascade-house, tech-contemporary (a P1 `color_complexity` country-vs-industry clamp each), jakarta-tokyo-blend (two P1 clamps + the batik P2 note), wellness-studio-promo (a P1 `visual_density` Indonesia-vs-industry clamp) |
| `BLOCK` | brutalist-trust-conflict (P0 `visual_density`: the pinned Brutalism movement vs. the trust-critical **healthcare** industry) |

**P7 recalibration.** `brutalist-trust-conflict` and `luxury-density-conflict` moved from the
`property`/`fashion` stand-ins onto the real `healthcare` and `luxury` industries; both keep their
former verdict because the industry pressures and DKV ceilings were authored to preserve the same
tension. `wellness-studio-promo` is the one new verdict — a genuine `REVIEW` from the Indonesian
spatial-density bias meeting the calm-category `visual_density` ceiling.

## UI

`components/DesignReview.tsx` — a "Design Review" panel above the Recipe Board:
the verdict, the summary line, and each finding (severity · area · message ·
evidence). A `PASS` with no findings shows what was checked.

## Guarantees

- Pure and deterministic; no model, no image, no network.
- Read-only: never mutates the contract, direction, recipe or prompt set; the
  `recipe_hash` and anchors are untouched.
- Additive: `RecipeOkResult` gains `critic`; existing consumers are unaffected;
  a clean design is `PASS` with no findings.
- P0/P1/P2 severity is the pipeline's existing scale, reused unchanged.
- The image-measuring half of the Design Critic (`docs/dkv-engine.md`) remains
  deferred; its future findings plug into this same report.
