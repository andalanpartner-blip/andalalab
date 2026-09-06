# Layout Blueprint

`DesignRecipe + VisualType + LayoutSystem → LayoutBlueprint`. Deterministic, no LLM, no image.

## What it is

A **structural plan**, not a finished design and not a render. It says *where* things go
and *how they relate* before the prompt is generated: canvas, grid, margins, gutters,
zones, zone geometry, hierarchy, reading flow, focal area, and the alignment / spacing /
overlap relationships between zones.

It sits between the Recipe and the Prompt in the mental model. It **derives from** the
recipe and never overrides it. The recipe decides the visual strategy; the blueprint
visualises the spatial consequences of that strategy. The Prompt Compiler is unchanged
and still owns translation into generator language.

## The blueprint decides nothing new

Every value is one of three kinds, tagged with a `basis`:

| basis | meaning | examples |
|---|---|---|
| `structural` | copied verbatim from the recipe / layout / visual type | `area_share`, `grid`, `safe_area`, `reading_order`, `hierarchy.strength`, `density` |
| `derived` | computed by documented deterministic arithmetic from structural values | `zone.rect`, `zone.role`, `zone.layer`, `zone.dominance`, `reading_flow.waypoints`, `focal.x/y` |
| `unassessed` | could not be resolved; the path is listed in `blueprint.unassessed` | (normally none) |

There is no numeric design decision in the blueprint that is not already in the recipe.

## Geometry model

Coordinates are **normalised 0..1** in canvas space (origin top-left, y grows down), so
the blueprint is resolution- and ratio-independent. They are computed by placing zones
into integer **grid cells** (`recipe.grid.columns × rows`) and dividing — so every edge
lands on a grid line by construction.

Two arrangements, chosen deterministically from the resolved layout:

- **`stacked`** (default) — zones are full-width horizontal bands, top to bottom in
  reading order, band height proportional to `area_share` (renormalised to fill the
  margin box), snapped to grid rows with a one-row minimum.
- **`split-column`** — used when `layout.id` ends with `-split`. The priority-1 zone
  takes a full-height column (left when the layout flow starts left — `z-pattern` /
  `f-pattern` — otherwise right), width proportional to its `area_share` clamped to
  `[0.34, 0.6]`; the remaining zones stack in the other column.

The blueprint is labelled *"intended structure, not pixel-final"*: `area_share` +
priority + flow underdetermine an exact packing, so the resolver commits to one
documented interpretation and golden-locks it.

## Zone model

Zones come straight from `recipe.hierarchy.levels` (which itself came from the layout
grammar). Zone ids reuse the 11-value `ZoneId` enum — no new vocabulary. `role` is
bucketed deterministically:

- `primary` — `rank === 1`
- `secondary` — `rank ≤ 3` and `area_share ≥ 0.1`
- `utility` — a required mark that is not text-bearing content (`brand`, `footer`) or a
  small (`area_share < 0.1`) `cta` / `navigation`
- `supporting` — everything else

`text_bearing` follows `engine/prompt/text-mode.ts` `TEXT_BEARING_ZONES`.

## Reading flow

`pattern` is `recipe.composition.flow` verbatim. `path` is `recipe.hierarchy.reading_order`
filtered to present zones. `waypoints` are the centre points of each path zone, in order —
the polyline a UI would draw. `entry` / `exit` are the first / last path zone.

## Focal region

`focal.zone` is the priority-1 zone. `focal.dominance` is `recipe.hierarchy.focal_dominance`
verbatim. `focal.x/y` is the centre of that zone's rect.

## Relationship model

Relationships are **derived** from geometry and already-resolved recipe signals — never a
new opinion. Each carries a `signal` naming the concrete cause.

| kind | when it is emitted |
|---|---|
| `contained_by` (→ `safe_area`) | a required zone whose rect is inside the safe area |
| `overlaps` | two zone rects intersect (only possible in the layered / framing case) |
| `contains` / `contained_by` (zone→zone) | one rect encloses another |
| `adjacent_to` | two rects share an edge after snapping |
| `aligns_with` (→ `grid`) | a rect edge lands on a grid line (always true here — recorded once per zone) |
| `dominates` | the focal zone vs every other zone, from `focal_dominance` + area ratio |
| `contrasts_with` | image/hero zone vs an adjacent text zone (figure/ground), from the layout |
| `depends_on` | a `cta` / `offer` zone on the zone directly ahead of it in reading order |
| `precedes` | consecutive zones in the reading order |
| `frames` / `crops_through` | via a `graphic_treatment` device whose `purpose` includes `framing` or `image_integration` |

## Rationale / provenance

`rationale[]` entries are deterministic: `claim` (what is happening), `reason` (why),
`signal` (the concrete upstream value), `basis` (which artifact — contract / direction /
recipe / layout / visual_type / dkv / objective / graphic_treatment / geometry), and the
doctrine `principle` it upholds (or null). Nothing is model-generated.

`provenance` binds the blueprint to its parent: `recipe_id`, `recipe_hash`, `contract_id`,
`direction_id`, `concept_ref`, `layout_id`, `visual_type_id`, `objective`.

## Determinism and hash

`blueprint_hash = fnv1a(canonicalise(body))` — an 8-char hex, with `blueprint_hash`
excluded from the body (same rule as `recipe_hash`). `schema_version`, `resolver_version`
and `dataset_version` are part of the hashed body.

> Same `DesignRecipe` + same `dataset_version` + same `resolver_version` ⇒ identical
> blueprint, identical ordering, identical hash.

## Failure, not repair

`resolveLayoutBlueprint` returns `Result<LayoutBlueprint, BlueprintIssue[]>`. It does not
silently repair invalid input:

- id mismatch (recipe↔contract, recipe↔direction), missing visual type / layout / aspect
  ratio, an empty zone set, `area_share` summing above 1, a reading order that does not
  match the zone set → **`err([...])`**, no blueprint.
- a required zone that lands partly outside the safe area, a rect that overflows the
  canvas after snapping, an unknown zone id → an advisory `BlueprintIssue` on
  `blueprint.issues`; the blueprint is still returned so the problem is visible.

## Boundaries

No image generation. No computer vision. No vision-model evidence. No new dataset, country,
industry, movement or visual type. No database. No dependency. UI is a later milestone
(UI/UX-02B) and is not part of P2.10.
