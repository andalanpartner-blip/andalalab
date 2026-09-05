# Graphic Treatment Engine

`DesignContract + DesignDirection (via DesignRecipe context) → GraphicTreatmentSpec`.
Deterministic, no LLM. P2.5 — an additive design-intelligence layer on top of
the recipe, not a redesign of it.

## Doctrine

> Graphic elements must support composition, hierarchy, meaning, or movement.
> They are not decoration by default.

The engine's only job is to decide **whether** a poster needs a graphic
device, **which** device, and **how intense** the treatment should be —
never to add richness for its own sake. A device with no declared purpose is
not a representable value in this system (see "No random decoration" below).

## The engine is downstream, not another decision layer

Graphic Treatment does not re-litigate movement, industry, audience or
objective. It runs inside `buildDesignRecipe` (`engine/recipe/build.ts`),
**after** composition, typography, color and `graphic_language` have already
been resolved by the ten-layer DKV doctrine (`engine/dkv`, `engine/decision`),
and it only ever reads those results:

- `recipe.graphic_language.ornament` — the recipe's own resolved decorative
  bias (country/movement blend), reused rather than recomputed.
- `dkv.visual_density`, `dkv.focal_dominance` — how much room the composition
  actually has for supporting devices.
- The industry's own five pressure values (`aesthetic_pressure`,
  `emotion_pressure`, `trust_pressure`, `information_pressure`,
  `conversion_pressure`) — never a hand-tuned per-industry lookup table.
- The objective, audience and country-blend banned-token list, already
  resolved on the contract.

This is what doctrine §14 means by "graphic treatment is downstream": a
treatment can never override objective, audience, industry, brand, DKV or
platform — it can only add a small, coordinated set of devices once every
higher-ranked layer has already had its say.

## Device taxonomy

`engine/graphic-treatment/data.ts` is a fixed, curated set of ~38 devices
across eight categories — reviewable in one file, the same posture as
`engine/prompt/render/vocabulary.ts` and `engine/dkv/doctrine.ts`.

**Structural** (supports composition and hierarchy): modular grid blocks,
framing border, rule/divider, modular panel, cropped image window, column
system.

**Expressive** (personality, movement, energy): controlled geometric block,
organic blob accent, ribbon/banner band, contour line mark, abstract graphic
mark, bold graphic symbol.

**Image / typography treatments** (how imagery and type behave): selective
masking, cut-out silhouette, duotone, monochrome; oversized/cropped headline,
cropped/bleeding type, outlined type, stacked type block, type crossing the
image boundary.

**Texture**: paper grain, film grain, halftone, photocopy/print-noise.
**Pattern**: dots, stripes, checker, modular repetition.
**Layering**: foreground overlap, background depth, floating element, image
crossing the grid boundary.
**Graphic accents**: label/tag, icon marker, annotation/caption, badge mark,
stamp mark.

Every device (`engine/graphic-treatment/types.ts: GraphicDevice`) declares:

- `purpose` — at least one value from the closed
  `GraphicDevicePurpose` enum (hierarchy, framing, movement, rhythm,
  emphasis, contrast, narrative, image_integration, typography_integration,
  information_grouping).
- `compatibleMovements` / `compatibleIndustries` / `suitableObjectives` — real
  ids from `data/movements`, `data/industries` and
  `types/schemas/brief.schema.ts:CommunicationObjective`. An empty array means
  "no restriction" (a structural or textural device with no stylistic
  opinion), never "untested".
- `pairsWith` / `avoidWith` — coordination and conflict rules.
- `promptEn` / `promptId` — the natural-language production instruction the
  Prompt Compiler quotes verbatim. Never a device id.

Adding a movement or industry later needs no change here: an id that matches
no device's compatibility list simply excludes that device until the
taxonomy is deliberately extended for it.

## Treatment intensity

Five levels, `none → minimal → moderate → expressive → experimental`
(`GraphicTreatmentIntensity`). The score is a weighted sum of already-resolved
signals:

```
score = 0.35·ornament + 0.25·visual_density + 0.20·(1 − focal_dominance) + 0.20·industryAllowance
industryAllowance = 0.5 + 0.4·aesthetic_pressure + 0.3·emotion_pressure − 0.4·trust_pressure − 0.3·information_pressure
```

Audience then applies a small, bounded nudge — an **influence**, never a
stereotype (doctrine §9): a youthful midpoint age or a `scroll` attention
context adds up to +0.17; a refined/luxury-leaning audience (high
sophistication, low price sensitivity) subtracts 0.15.

The score is banded (`none ≤ 0.18 < minimal ≤ 0.38 < moderate ≤ 0.6 <
expressive ≤ 0.8 < experimental`), and then **hard-capped**, never raised, by
three doctrine rules that always outrank decorative treatment:

1. Conversion and promotion objectives cap at `moderate`; a trust objective
   caps at `minimal` (§10 — hierarchy and product clarity outrank
   expressive elements).
2. An industry with `trust_pressure ≥ 0.8` (the generic formal/institutional
   signal every `IndustryDNA` file already carries) caps at `moderate`.
3. A refined/luxury-leaning audience caps at `moderate`.

## Selection

Each intensity level fixes a maximum device count per category
(`SELECTION_TARGETS` in `engine/graphic-treatment/resolve.ts`), matching the
"1–2 restrained devices" / "small coordinated set" language of the spec.
Image and typography treatments share one budget (§13's "1 image/type
treatment" is one pick total, not one of each); at `expressive` intensity
texture and pattern also share one slot, both are independent again at
`experimental`.

For each category, eligible devices are filtered by movement, industry,
objective, the formal/institutional gate, dense-copy and dense-imagery gates,
grid-column requirements, and cultural safety (below) — then ranked by a
small, fully deterministic score (movement/industry/objective match +
audience alignment + a co-selection bonus for devices that declare
`pairsWith` an already-picked device) and the top N are kept. A final pass
drops the lower-scored member of any selected pair that declares `avoidWith`
the other.

Nothing here is randomised, and nothing is added just to "increase
richness" — if no eligible device exists for a category, that category stays
empty rather than being filled arbitrarily.

## Cultural safety

Reuses the existing anti-stereotype infrastructure
(`engine/country/anti-stereotype.ts`) rather than inventing a parallel
mechanism: a device is excluded outright if its own name or production text
mentions any token in the recipe's already-resolved
`contract.banned_tokens` list. A few devices (stamp, badge, ribbon, the two
abstract/symbol marks) additionally carry a `culturalNote` explaining why
their production instruction insists on staying abstract rather than a
literal seal, medal or national emblem — the same "influence through
relationships, not motif" doctrine every country file already follows.

## "No random decoration" invariant

A graphic device **must** have a declared purpose from the closed
`GraphicDevicePurpose` enum. "Looks cool" or "adds decoration" are not
representable values — there is no free-text purpose field to write them
into. `tests/unit/graphic-treatment.test.ts` asserts every device in the
taxonomy, and every device on every resolved plan, satisfies this.

## DesignRecipe integration

`buildDesignRecipe` calls `resolveGraphicTreatment` once, after
`graphic_language` is resolved, and stores the result verbatim as
`recipe.graphic_treatment` (`types/schemas/graphic-treatment.schema.ts`).
Every selected device carries `source` (which movement/industry/objective
justified it) and `rationale` (a generated, not hand-written, traceability
sentence) — the same "no untraceable choices" posture as every other recipe
section.

## Prompt Compiler integration

`engine/prompt/blocks.ts` lifts `recipe.graphic_treatment` into a
language-neutral `GraphicTreatmentBlock`. Each renderer
(`engine/prompt/render/en.ts`, `id.ts`) turns it into one paragraph, grouped
by category, using each device's own `prompt_en`/`prompt_id` — never a raw
device id or category slug. The section appears in the Master Prompt and the
Design/Layout Prompt; the Image-Only Prompt includes it too but drops
typography-treatment devices (they describe how type renders, which the
image-only pass never does). When intensity is `none`, or every array is
empty, the whole section is omitted rather than printed empty.

The Negative Prompt stays quiet by default (doctrine §19): it adds
"random or unmotivated graphic decoration" only when nothing was selected at
all, and "uncontrolled collage or competing graphic accents beyond the
specified devices" only at `expressive`/`experimental` intensity — it never
blanket-prohibits every treatment.

## Tests

- `tests/unit/graphic-treatment.test.ts` — determinism, every intensity band,
  objective/audience/industry caps, movement compatibility, conflict
  rejection, cultural-safety exclusion, the gating rules (grid columns,
  dense copy, dense imagery), and the "no random decoration" invariant over
  the full taxonomy.
- `tests/golden/graphic-treatment.golden.test.ts` — the stable, named golden
  case (Instagram F&B promotional poster, Bauhaus, youth office audience —
  `tests/fixtures/briefs/kopi-lawas-promotion.json`): exact device ids,
  byte-identical repeated runs, and both prompt languages carrying the same
  decision.

No test in this suite makes a live Gemini call; every scenario runs against
fixture datasets and hand-built inputs.
