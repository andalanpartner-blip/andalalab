# DKV Engine

The eight measurable parameters are the spine of the product: `whitespace`,
`contrast`, `visual_density`, `alignment`, `hierarchy_strength`,
`color_complexity`, `focal_dominance`, `typographic_scale_ratio`.

All are 0..1 except `typographic_scale_ratio`, which runs 1..4. Limits live in
`PARAM_LIMITS` (`engine/dkv/rules.ts`).

These are not adjectives. Each one is measurable in a generated image later,
which is what turns the Design Critic from an opinion into a comparison.

## Two kinds of claim

- A **band** says what is legal: *Property needs contrast ≥ 0.55.*
- A **target** says what is wanted: *Brutalism wants density 0.72.*

Every claim carries the doctrine rank of the layer that made it.

| Rank | Layer | Speaks as |
|---|---|---|
| 1 | communication_objective | target (focal, hierarchy) |
| 2 | audience | target (focal, density) |
| 3 | industry_requirements | band (floors, ceilings) |
| 4 | brand_identity | target (colour complexity) |
| 5 | dkv_fundamentals | target (layout bias) |
| 6 | platform_constraints | band (visual type requirements) |
| 7 | country_visual_dna | band (blended biases) |
| 8 | design_movement | target (movement bias) |

## Resolution

1. **Intersect bands**, strongest authority first. Two bands that cannot both
   hold produce a conflict; the more authoritative one stands and the other is
   discarded rather than blended.
2. **Average targets by authority weight**, `(11 − rank) / 10` — linear, so
   rank 1 carries 1.0 and rank 10 carries 0.1. Linear rather than exponential
   on purpose: an exponential curve makes ranks 6–10 numerically irrelevant,
   and a movement that never moves a number is not really in the system.
3. **Apply doctrine, not band hardness.** If the target sitting outside the band
   comes from a *stronger* layer than the band did, the band yields. A rank-6
   platform band must not beat a rank-1 objective demand merely because bands
   are structurally harder. Otherwise the target is clamped into the band.
4. **Log every overruled claim**, per claim rather than only on the blended
   value. Authority weighting can land a movement's demand inside the band while
   the movement itself was completely overruled — silently. That is exactly the
   failure this reporting exists to prevent.

Nothing is ever averaged across a doctrine boundary without a record.

## Conflict severity

Measured as the gap between what was requested and what was resolved:

- **P0** ≥ 0.25 — satisfying the winner leaves nothing of the loser. Rejects an
  auto-generated candidate.
- **P1** ≥ 0.10 — a major modification, reported prominently.
- **P2** < 0.10 — routine adjustment.

## Output

`resolveDkv()` returns the resolved `DkvParams`, one `DkvDerivation` per
parameter (base, weighted target, band, final, governing layer, contributors,
explanation), plus every `Conflict` and `Resolution`. The direction stores all
of it, which is why any number in a recipe can be traced to the layer that set it.
