# Photographic Character Engine

`DesignRecipe context (imagery + lighting + colour + materiality + movement + graphic treatment + concept) → PhotographicCharacterSpec`.
Deterministic, no LLM. P2.6 — an additive design-intelligence layer on top of
the recipe, not a redesign of it.

## Purpose

The recipe already describes composition, hierarchy, colour and graphic style
well. What it did **not** describe is why generated people, products and
environments still read as "AI-generated": optical behaviour, material realism,
skin realism, lighting plausibility and *controlled* imperfection.

Photographic Character fills exactly that gap. It answers a narrow question —
**"given everything already decided, how should this frame behave optically and
materially so it reads as a real photograph (or a deliberate photographic
hybrid)?"** — and nothing else. It never re-opens a movement, industry,
audience, colour or country decision.

## Architecture

| File | Role |
| --- | --- |
| `types/schemas/photographic-character.schema.ts` | The recipe-facing `PhotographicCharacterSpec` and every bounded enum. |
| `engine/photographic-character/types.ts` | `PhotographicCharacterInput` — the already-resolved signals the resolver reads. |
| `engine/photographic-character/data.ts` | The realism doctrine as data (prefer/avoid blocks) + the one Negative-Prompt realism block, bilingual. |
| `engine/photographic-character/resolve.ts` | `resolvePhotographicCharacter` — pure, deterministic arithmetic + small rule tables. |
| `engine/photographic-character/finish.ts` + `finish-data.ts` | P2.9 **Photographic Finish** — the additive `finish` layer. See `docs/photographic-finish.md`. |
| `engine/photographic-character/index.ts` | Public surface. |

> **P2.9 — Photographic Finish.** `resolvePhotographicCharacter` now also returns a
> `finish` object (`recipe.photographic_character.finish`) that consolidates four
> named, traceable axes — photographic style, colour character, lighting
> character, artificiality control — for the compiler and UI. It is *additive*:
> it reads only values this engine already resolved, never changes one, and
> reuses the existing `artificiality_risk.score` verbatim. Full spec in
> [`docs/photographic-finish.md`](./photographic-finish.md).

It runs once, inside `buildDesignRecipe` (`engine/recipe/build.ts`), **after**
imagery, lighting, colour, materiality and graphic treatment are resolved, and
its result is stored verbatim as `recipe.photographic_character`. No database
change; no new artifact; no image-generation API.

## Input signals

Everything the resolver reads is already resolved by an earlier layer:

- `objective`, `audience`, `industry` (the full `IndustryDNA`), `visualType`,
  `movement`.
- `imageryRealism` — `recipe.imagery.realism` (country/movement blend, reused).
- `framing`, `lightingDirectionText` — quoted dataset prose, scanned **only**
  for banned tokens.
- `lightingContrast` (= `dkv.contrast`), `colorSaturation`, `colorContrast`,
  `colorComplexity`, `colorStrategy`.
- `materialityTexture`, `materialitySurfaces`.
- `compositionStrategy`, `graphicTreatmentIntensity`, the full `dkv`, and
  `contract.banned_tokens`.
- The selected `concept`, when one exists — only
  `subject_strategy`, `human_presence`, `abstraction_level`,
  `temporal_strategy` are read.

### No country-only inference

The input type has **no country field**. Country influence reaches this layer
only *indirectly*, through recipe dimensions the country blend already shaped
(imagery realism, lighting bias, colour saturation, materiality texture). Hold
those equal and the whole result is equal, whatever country produced them —
this is asserted in `tests/unit/photographic-character.test.ts`.

## Resolver rules

A small, coherent rule system, evaluated in a fixed order. First match wins.

1. **Subject** — from `concept.subject_strategy` when a concept exists, else
   from the industry's own DNA (`fashion`/`beauty-skincare` → human,
   `hospitality`/`property` → environment, `fnb` → product with implied hands,
   `technology-saas` → product).
2. **Photographic style** (§2 taxonomy, 12 values) — optical/treatment
   overrides first so a low-realism or heavily-treated recipe is never forced
   into a photoreal style it cannot support:
   `realism < 0.4 → graphic-photographic`;
   `abstract concept + realism < 0.7 → surreal-photographic`;
   `expressive/experimental graphic treatment → mixed-media-photographic`;
   `brutalism (non-trust) → raw-documentary`; then an industry/objective/subject
   table (fashion + human/brand → `fashion-editorial`, F&B promotion →
   `commercial-editorial`, property + trust → `documentary`, tech-SaaS product →
   `product-studio`, …); default `natural-editorial`.
3. **Realism target** (4 values) — `graphic-photographic → graphic-non-photographic`;
   `surreal`/`mixed-media` → `stylised-photographic`; commercial/product styles
   → `photoreal-refined`; else `photoreal-natural`.
4. **Camera / lens / depth of field** — from style + subject, with a guard:
   a composition that already resolved to a weak focal point
   (`dkv.focal_dominance < 0.4`) cannot then claim aggressive optical
   separation. `focus_behavior` and `perspective_behavior` are derived from
   depth of field and lens.
5. **Lighting** — mostly a function of style with a small number of industry
   overrides (F&B → `soft-directional`, property → `overcast/window`) and a
   contrast nudge. `light_direction`, `shadow_behavior` and `highlight_rolloff`
   follow from the lighting behaviour, contrast and colour response.
6. **Colour** — `color_response` from style + `colorStrategy` +
   `colorSaturation`; `white_balance` from colour response + lighting;
   `dynamic_range` from style + contrast. **`high-contrast` is never a default**
   — it is only reachable for a cinematic/lifestyle style at a hard-sun-driving
   contrast (spec §12).
7. **Surface realism** — one shared bounded scale (`not-applicable` / `stylised`
   / `naturalistic` / `detailed-naturalistic`) for skin, face, hair, hands,
   fabric, materials and environment, keyed off subject presence and realism
   target.
8. **Texture / motion / imperfection** — `imperfection_level` defaults to
   `subtle` or `natural`, **never `none`** (spec §11); industry restraint
   (`property`, `technology-saas`) outranks style flavour; `motion_realism`
   comes from the concept's temporal strategy when present.

## Realism doctrine (§8)

`engine/photographic-character/data.ts` holds the doctrine as a fixed, curated
set of prefer/avoid statements. The resolver assembles them in a fixed order:

- the **universal** optical / colour / material floor (always);
- the **people** block when a full human figure is in frame, or the
  **implied-hands** block when only hands are implied;
- the **product** block when a product / crafted object is the subject;
- the **environment** block when a place carries the frame;
- one **banned-token avoid line** when the quoted `framing` / lighting prose
  mentions a token from the resolved country blend.

These are guidance for the Prompt Compiler. They never change a Design Recipe
value.

## Artificiality risk (§9)

A deterministic 0–100 score, `BASELINE 22 + Σ raisers − Σ lowerers`, clamped and
banded (`<25 low`, `<50 moderate`, `<75 elevated`, else `high`).

**Raisers** include aggressive shallow depth, high-contrast / HDR tendency,
high saturation (more so with fully controlled lighting), crisp highlight
rolloff outside a studio context, extreme symmetry with a single dominant
focal point, expressive/experimental graphic treatment over the photo,
high-realism commercial portraits (over-retouching risk), portrait compression
+ shallow depth (synthetic bokeh), wide-expansive perspective on a human, very
high lighting contrast, near-maximal realism bias.

**Lowerers** include natural/expressive controlled imperfection, realistic
optical depth, a plausible available-light source, a natural restrained colour
response, restrained contrast, believable shadow density, a
documentary/natural-editorial style, and detailed material behaviour.

The score is returned with `band` and a ranked list of the `factors` that
fired. **It is diagnostic only — it never feeds back into any other resolved
field and never overrides the Design Recipe.**

## Prompt integration

`engine/prompt/blocks.ts` lifts `recipe.photographic_character` into a
language-neutral `PhotographicCharacterBlock` (every value an already-resolved
enum id). Each renderer (`engine/prompt/render/en.ts`, `id.ts`) turns it into
natural language via the bilingual `PHOTO_*` tables in
`engine/prompt/render/vocabulary.ts` — **never a raw enum id, and no generic
filler** ("ultra realistic 8K masterpiece", "award-winning", "hyper detailed"
are not produced).

| Prompt | What it carries |
| --- | --- |
| **Master** | Full photographic-character section, placed after imagery/lighting. |
| **Image-Only** | Full section — this is the actual image-generation stage: camera, lens, optical depth, light behaviour, skin/material/environment realism, imperfection, colour response. No typography. |
| **Design / Layout** | One-sentence reference only (style + realism target + imperfection + diagnostic risk). |
| **Negative** | One compact deterministic realism block (spec §18), added exactly once. |

## Language parity

The **resolved values are identical across languages** — they live on the
recipe, not the prompt. `photographic_style = "commercial-editorial"` stays
`"commercial-editorial"` whether the UI language is English or Bahasa
Indonesia; only the rendered wording differs. The Indonesian renderer
re-authors the realism doctrine in Indonesian (from the same subject facts)
rather than carrying English `constraints` statements into an Indonesian
prompt — the same policy `id.ts` already applies to every quoted dataset
string.

## Examples

| Brief | style | camera / lens | depth | lighting | colour | imperfection | risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `kopi-lawas-promotion` (F&B promo) | `commercial-editorial` | full-frame-editorial / 100mm-macro-product | selective-focus | soft-directional | warm-natural | subtle | 27 (moderate) |
| `tokyo-fashion-editorial` (fashion) | `fashion-editorial` | full-frame-editorial / 85mm-portrait-compression | shallow-optical | window-light | editorial-neutral | natural | 7 (low) |
| `northbeam-saas-launch` (SaaS) | `product-studio` | studio-commercial / 100mm-macro-product | deep-natural | controlled-studio | restrained-commercial | subtle | 0 (low) |
| `property-editorial` (property trust) | `documentary` | close-range-documentary / 35mm-environmental | deep-natural | window-light | muted-documentary | subtle | 0 (low) |

## Known boundaries

- The MVP ships one visual type (`social-feed`); `visualType` is an input but
  its discriminating power grows only when more visual types land.
- Free-text imagery / lighting prose is scanned for banned tokens but not
  otherwise parsed — the layer works from structured signals, not NLP.
- The doctrine strings are English-authored; the Indonesian renderer produces
  its own equivalent rather than translating them at runtime.
- Artificiality risk is a heuristic for reviewer attention, not a measured
  quantity — it becomes a comparison only once the Design Critic can measure a
  generated image.

## Tests

- `tests/unit/photographic-character.test.ts` — determinism, schema validity,
  bounded taxonomy, the seven named scenarios (fashion editorial, F&B
  promotion, product photography, documentary, commercial portrait, surreal
  photographic, mixed-media photographic), the imperfection and dynamic-range
  doctrines, artificiality risk bounds/bands, no country-only inference, and
  the realism doctrine assembly.
- `tests/golden/photographic-character.golden.test.ts` — the three named golden
  cases with exact resolved values, byte-identical repeated runs, prompt
  rendering in both languages, the Negative-Prompt realism block, and the
  regression checks (anchors intact, recipe hash reproducible, graphic
  treatment untouched).

No test in this suite makes a live Gemini call.
