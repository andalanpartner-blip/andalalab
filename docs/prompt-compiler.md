# Prompt Compiler

`DesignRecipe (+ CreativeConcept) → PromptSet`. Deterministic, no LLM.

The last step in the pipeline that currently ends at the Design Recipe:

```
Brief → Strategy → Creative Concepts → Selected Concept → Design Recipe → Prompt Compiler → ready-to-copy prompt
```

## The compiler decides nothing

Same principle as the [Recipe Engine](recipe-engine.md): every phrase in a
compiled prompt is either lifted from a recipe field, lifted from the concept
that produced the recipe, or comes from a small fixed vocabulary (universal
quality requirements, universal negatives, and the bilingual phrase table for
closed enums). The compiler never picks a movement, a layout, a colour, a
country weighting or an audience reading — those are already decided by the
time a `DesignRecipe` exists. It is not allowed to:

- select or change a design movement, layout, composition strategy or DKV value
- reinterpret the audience or change country weighting
- invent a visual concept, or alter the one it was given
- invent campaign copy — the only text it will ever ask a generator to render
  verbatim is `recipe.core_message`, quoted, never paraphrased
- override a brand or platform constraint — every constraint on the recipe
  that names a real, renderable fact is carried through to at least one of
  the five prompts, unfiltered (see "Unsupported concepts" below for the one
  narrow exception, and it is an exclusion, never a rewrite)

If a design decision needs to change, that happens upstream (regenerate the
recipe or the concept). The compiler is re-run on the new recipe; it is never
patched to talk the old recipe into a different result.

### Unsupported concepts

`recipe.constraints` includes generic strategic guidance quoted verbatim from
the industry dataset's `communication_needs` — e.g. "state the occasion and
the price position clearly." That guidance already did its job upstream: it
shaped DKV parameters and doctrine resolution in P1. Quoting it again here, as
a literal instruction to an image generator, asks the generator to render or
imply information — an actual price, an actual brand-tone descriptor, an
actual campaign message — that was never decided anywhere in the recipe or
concept. That is an invented decision by a different name, so
`engine/prompt/unsupported-concepts.ts` drops any constraint statement naming
one of a short, explicit list of such concepts (currently: price position,
luxury level, brand tone, campaign message) before it reaches a block. This is
a narrow exclusion list, not a heuristic — a constraint is never dropped for
being long, generic, or merely strategic in tone, only for naming one of these
specific unsupported concepts. A concrete fact backing one of them (a real
price the brief stated, a real tone word from `BrandSnapshot.tone`) is never
filtered, because the filter only matches the concept name itself — it would
need to be added to `PromptBlocks` as real data before it could render at all.

## Input / output

Input (`engine/prompt/types.ts` — `CompilePromptInput`):

- `recipe: DesignRecipe` — required
- `concept?: CreativeConcept | null` — optional; recipes built before P2.2, or
  built without a concept, compile fine without one (the Concept section of
  every prompt is simply omitted, never invented)
- `language?: "en" | "id"` — defaults to `"en"`
- `textMode?: "TEXT_CRITICAL" | "LAYOUT_ONLY"` — optional override; see below

Output (`PromptSet`): `{ language, masterPrompt, quickPrompt, imageOnlyPrompt,
designLayoutPrompt, negativePrompt }` — five plain strings, ready to paste into
an external image generator.

## Structured blocks first

`buildPromptBlocks()` (`engine/prompt/blocks.ts`) turns a recipe and an
optional concept into `PromptBlocks` — a language-neutral structured object
(format, objective, concept, composition, hierarchy, subject, environment,
camera, lighting, color, materiality, typography, graphicElements, culture,
industry, brand, platform, quality, constraints). Every renderer reads only
from this shape, never from the recipe or concept directly. Adding a language
means adding a renderer over the same blocks — it never touches extraction.

## Prompt types

| Prompt | Purpose |
| --- | --- |
| **Master Prompt** | Every recipe decision, in full. The production handoff. |
| **Quick Prompt** | One short paragraph — format, objective, concept, composition/colour/typography strategy, the top constraints, a one-line avoid. Shorter, same intent. |
| **Image-Only Prompt** | Pass 1 of the two-pass flow (below) — drops typography detail. |
| **Design/Layout Prompt** | The structural half — grid, hierarchy, typography, brand — condensed on imagery/lighting/materiality. |
| **Negative Prompt** | Every `must_not`/`avoid` constraint not sourced from the country blend, one compact cultural anti-stereotype rule in place of a per-country token dump, and a fixed universal baseline (generic stock-photo look, clutter, weak hierarchy, excessive decoration, wrong aspect ratio, unwanted visual movement, inconsistent lighting, excessive density). |

The Master Prompt is deliberately long and exhaustive — section 4 of the brief
this was built against is explicit that recipe decisions must not be dropped
just to keep the prompt short. `Quick Prompt` is the "make it short" pressure
valve instead of trimming the Master Prompt.

## TEXT_CRITICAL vs LAYOUT_ONLY

`VisualType.text_render_risk` (`types/schemas/reference/visual-type.schema.ts`)
already names this as a later-phase concern, and the Design Recipe does not
yet carry a visual-type reference to read it from. `resolveTextMode()`
(`engine/prompt/text-mode.ts`) derives a mode from what the recipe already
has instead: **TEXT_CRITICAL** when a required, text-bearing hierarchy zone
(headline, body, offer, cta, navigation, footer) exists *and* the recipe
carries a real `core_message`; **LAYOUT_ONLY** otherwise. A caller with better
information (e.g. once a visual-type lookup exists) can override this via
`CompilePromptInput.textMode` without any other code changing.

- **TEXT_CRITICAL** — the Master and Design/Layout prompts quote
  `core_message` verbatim inside the dominant text zone and explicitly forbid
  paraphrasing, translating or adding copy.
- **LAYOUT_ONLY** — the same prompts instead instruct the generator to reserve
  clear, uncluttered space in the text-bearing zones, with no text rendered.

Neither mode ever invents wording that is not already `core_message`.

## Two-pass philosophy

The Image-Only Prompt always drops typography *strategy* detail (font names,
case/weight bias, scale ratio) and never asks the generator to render exact
copy — regardless of text mode — because pass 1 of the intended production
flow is "generate the image asset," and pass 2 ("apply final graphic
typography/layout") happens elsewhere, later, against a different tool.
Asking an image model to also render exact type in pass 1 fights that split.
The one text-related line it keeps is a minimal, text-mode-driven instruction
to leave the text-bearing zones clean rather than filling them with garbled
placeholder text — that instruction is required by the text-mode architecture
itself, not "typography strategy." Everything else the spec allows for a
pure visual-generation prompt stays: subject, environment, composition and
hierarchy (as spatial zones, not text), imagery, lighting, materiality,
color, culture influence, industry context, platform/aspect ratio, quality
and the negative constraints. The Design/Layout Prompt is the inverse: it
keeps grid, hierarchy, typography strategy and brand type rules in full, and
is the one meant for a human designer or a layout-aware tool doing pass 2.

## Compact negative prompt, full anti-stereotype intent

`recipe.constraints` carries one `must_not` entry per country in the blend
(source `"country"`), each listing that country's own `avoid_stereotypes`
tokens in full — for a two-country blend that's two long sentences, each with
its own token list, on top of the flattened `culture.banned_tokens` the
compiler used to enumerate a third time. Dumping the entire cultural dataset
into a "negative prompt" like that is not practical instruction for an image
generator, and it isn't necessary to preserve the guardrail.

Instead, `buildAntiStereotypeLine()` (in each renderer) replaces all of it
with one compact rule, e.g.:

> Avoid stereotypical Indonesian visual shorthand; express cultural influence
> through spatial behavior, typography relationships, color relationships,
> and materiality.

built from the actual country names in `PromptBlocks.culture.dimensions` (via
`render/vocabulary.ts`'s `COUNTRY_DEMONYM` table, generalising to any blend —
never hardcoded to a specific country pair), not from the raw token list. The
`country`-sourced `must_not` statements and the raw `banned_tokens`
enumeration are excluded from the Negative Prompt in favour of this one line;
every other source (brief, brand, industry, platform, visual_type) is a
distinct, specific negative and is still quoted in full.

## Language support

`PromptLanguage = "en" | "id"`, default `"en"`. Both renderers
(`engine/prompt/render/en.ts`, `render/id.ts`) read the same `PromptBlocks` —
switching language never touches concept, composition, movement, DKV, colour
strategy, country influence, industry direction, layout, platform constraints,
the selected concept or the recipe. Only wording changes. `render/vocabulary.ts`
holds the bilingual phrase table for every closed enum (composition strategy,
balance, flow, typography/colour strategy, zone names, objective, channel,
etc.) in one place, reviewable independently of the assembly logic in each
renderer.

The Indonesian renderer writes real Bahasa Indonesia connective language
("gunakan komposisi vertikal bertumpuk dengan hierarki visual yang tegas"),
not a word-for-word machine translation of the English template. Established
design terminology (grid, editorial, whitespace, contrast, Bauhaus, sans-serif,
product hero, etc.) is kept in English rather than forced into an awkward
Indonesian equivalent, matching how a professional Indonesian creative
actually writes.

**Known MVP boundary**: a handful of recipe fields are free-text prose quoted
verbatim from the country/movement datasets, authored in English —
`composition.spatial_behavior`, `typography.hierarchy_behavior`,
`imagery.subject_treatment`, `imagery.framing`, `lighting.direction`,
`graphic_language.shape_logic`, `graphic_language.rhythm`,
`movement.core_principles` and `movement.anti_stereotype`. Auto-translating
that prose is out of scope for the compiler — it would mean generating new
phrasing the recipe never decided on, which is exactly what this layer is not
allowed to do. So the Indonesian renderer **omits** these fields rather than
leaving whole English sentences inside an otherwise-Indonesian prompt: it
keeps only the parts of the same decision that already have a structured,
bilingual form (composition strategy/balance/flow, subject strategy, human
presence, contrast/realism/texture ratios, the movement's *name*, dimension
ownership) and drops the descriptive elaboration. The English renderer is
unaffected — it keeps every one of these sentences in full, since English is
the dataset's own language and nothing is lost by quoting it. Proper names,
concept text (the model's own prose, in whatever language it was generated),
hex codes and established technical terms (grid, editorial, Bauhaus,
sans-serif, F-pattern, etc.) are never touched in either language.
Localising the dataset prose itself, if wanted, belongs in the datasets (an
authoring change), not in the compiler.

## Determinism

No `Math.random()`, no `Date.now()`/`new Date()`, no network calls, no LLM
calls. Same `(recipe, concept, language, textMode)` in, byte-identical
`PromptSet` out — enforced by the same ESLint rules and boundary test
(`tests/lint/boundary.test.ts`) that guard the rest of `engine/`, since
`engine/prompt/` lives under that boundary.

## Provider neutrality

Nothing here emits Midjourney/Flux/Imagen/Stable-Diffusion-specific syntax
(weights, `--ar`, style tags, negative-prompt operators, etc.). Output is
plain natural-language instruction, meant to be pasted into whichever
generator the user already has. Provider-specific adapters are future work,
layered on top of `PromptSet` — they are not this module's job.
