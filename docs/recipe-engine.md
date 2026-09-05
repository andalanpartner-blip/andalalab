# Recipe Engine

`DesignContract + DesignDirection → DesignRecipe`. Deterministic, no LLM.

## The recipe decides nothing

Every value is copied from the contract, taken from the direction, or lifted
**verbatim** from the dataset entry that owns the relevant dimension. Prose is
quoted, never composed, so any sentence in a recipe traces back to the country,
movement or industry file it came from. Each spec carries a `source` field
naming that origin.

## Dimension-aware culture blending

The important decision in the recipe layer. A country blend does **not** average
every field — 70% of one spatial philosophy plus 30% of another is not a
philosophy, it is a contradiction with a decimal point.

Instead each of the six dimensions (composition, typography, color, imagery,
materiality, graphic_language) is **assigned** to whichever country has the
strongest claim: `blend weight × that country's own declared weight for the
dimension`. Ties break on country id.

The consequence is the useful part: a 70/30 Indonesia/Japan blend can hand
spatial behaviour to one country and materiality to the other, which is a real
design position rather than a smear. When the top two are within
`CONTEST_MARGIN` (0.05) the dimension is flagged `contested: true` and the
recipe says so out loud.

Scalar biases (saturation, whitespace, density) are still averaged — averaging a
number is meaningful in a way that averaging a philosophy is not.

## Movement influence

`movement.influence` reports how much of the movement survived doctrine
resolution: `1 − (resolutions where design_movement lost) / (parameters)`. A
recipe where the movement was overruled on three of eight parameters is honest
about being a compromise.

## Anchors

The contract locks brand, objective and core message. The recipe locks
`primary_visual_direction` to `movement/layout/composition_strategy`. Concept
stays pending until P2.

`assertAnchorsIntact()` **throws**. An anchor violation means a correction has
quietly changed what the work is, which is the drift the mechanism exists to
prevent — not a warning to log and step over.

## Diffing

`diffRecipes(a, b)` returns changed paths, added, removed, anchor violations and
a per-parameter DKV delta. `id`, `created_at`, `recipe_hash` and `direction_id`
are excluded: they change on every build by construction, and including them
would make every diff report a change and destroy the signal.

Diffs are symmetric — reversing the arguments reverses added/removed and inverts
every DKV delta.
