# Photographic Finish (P2.9)

`PhotographicCharacterSpec (already resolved) + a few recipe signals → PhotographicFinishSpec`.
Deterministic, no LLM. **Additive** — it does not rewrite the Photographic
Character Engine, change DKV doctrine, design-decision priority, country,
industry or graphic-treatment logic, and adds no provider, database or
framework.

## Why

Generated visuals still risk reading as "AI-generated": plastic skin, excessive
HDR / sharpness, synthetic bokeh, unnatural highlight rolloff, over-orange or
over-teal grading, sterile studio rendering, an identical visual character
across every image type. P2.6 already resolves the raw optical/material fields
(`camera_language`, `color_response`, `lighting_behavior`,
`artificiality_risk`, …). P2.9 makes them **expressive and controllable** by
consolidating four axes into named tokens the compiler and UI can address
directly:

| Axis | Field | Values |
| --- | --- | --- |
| Photographic style | `finish.style` | `photorealistic` · `fashion-editorial` · `product-photography` · `cinematic` · `documentary` · `graphic-poster` · `illustration` |
| Colour character | `finish.color_character` | `natural-neutral` · `natural-warm` · `natural-cool` · `editorial-neutral` · `muted-film` · `soft-pastel` · `high-chroma-commercial` · `monochrome` · `restrained-commercial` |
| Lighting character | `finish.lighting_character` | `soft-window` · `directional-daylight` · `diffuse-daylight` · `controlled-studio` · `hard-sun` · `ambient-interior` · `cinematic-shaped` · `documentary-ambient` — **null** for a non-photographic medium |
| Artificiality control | `finish.artificiality` | `low` (< 30) · `medium` (30–59) · `high` (≥ 60), banded from the existing 0–100 `artificiality_risk.score` |

## Architecture

| File | Role |
| --- | --- |
| `types/schemas/photographic-finish.schema.ts` | `PhotographicFinishSpec` + every bounded enum. Composed onto `photographic_character` in `recipe.schema.ts` (`.extend({ finish })`) so the two schema files stay acyclic. |
| `engine/photographic-character/finish-data.ts` | `COLOR_CHARACTER_VOCABULARY` — the fixed six-facet colour vocabulary per colour character. |
| `engine/photographic-character/finish.ts` | `resolvePhotographicFinish` — pure rule tables over already-resolved values. Called at the tail of `resolvePhotographicCharacter`. |
| `engine/prompt/render/vocabulary.ts` | New bilingual `FINISH_STYLE` / `COLOR_CHARACTER` / `LIGHTING_CHARACTER` / `ARTIFICIALITY_*` / `COLOR_*` / `REALISM_NOTE` tables. |
| `engine/prompt/render/en.ts` + `id.ts` | `formatPhotographicFinish` — a separate paragraph after the P2.6 block, in all three prompt tiers. |
| `components/RecipeBoard.tsx` | A "Finish" sub-section inside the existing "Photographic Character" card. |

## Resolver logic

Every decision is a rule table over values the recipe already resolved. It
never reads the brief, a country id, or invents a value.

### style

Mirrors the P2.7 Visual Generation Adapter map (`STYLE_TO_ADAPTER`), plus two
P2.9 refinements:

- `documentary` / `raw-documentary` → its own `documentary` family (the adapter folds these into `photorealistic`).
- `commercial-editorial` splits by `skin_realism`: a person in frame → `fashion-editorial`, a product hero → `product-photography`.
- A `graphic-poster` base + `graphic-non-photographic` realism target + an `abstract`/`symbolic` concept → `illustration` (mirrors the adapter's illustration refinement).

`is_photographic = style ∉ { graphic-poster, illustration }`.

### colour character

The photographic **colour response** is the primary signal; colour **strategy**
only fixes `monochrome` or breaks the neutral tie; saturation and audience
refinement break the `soft-pastel` tie only.

```
monochrome-structural strategy            → monochrome
color_response = bold-editorial            → high-chroma-commercial
refined + fashion/beauty + sat ≤ 0.3 + restrained response → soft-pastel
color_response = warm-natural              → natural-warm
color_response = soft-film | muted-documentary → muted-film
color_response = high-fidelity-product     → high-chroma-commercial (sat ≥ 0.6) | restrained-commercial
color_response = restrained-commercial     → restrained-commercial
color_response = editorial-neutral         → editorial-neutral
color_response = neutral-natural:
    high-chroma-vernacular strategy        → high-chroma-commercial
    white_balance = cool-daylight          → natural-cool
    white_balance = warm-ambient           → natural-warm
    otherwise                              → natural-neutral
```

### colour vocabulary

Each colour character maps to a **fixed** six-facet vocabulary
(`COLOR_CHARACTER_VOCABULARY`) — never a free phrase like "cinematic color
grading":

| facet | values |
| --- | --- |
| `white_balance` | `neutral` · `warm-ambient` · `cool-daylight` · `mixed-corrected` |
| `saturation_restraint` | `restrained` · `natural` · `elevated` — only `high-chroma-commercial` is `elevated` |
| `contrast_character` | `low` · `gentle` · `moderate` · `firm` |
| `highlight_rolloff` | `gentle` · `natural` · `filmic` · `crisp` |
| `shadow_density` | `open` · `natural` · `deep` |
| `color_separation` | `low` · `moderate` · `distinct` |

### lighting character

A 1-to-1 map from the already-resolved `lighting_behavior`, refined by style
(`soft-directional` → `cinematic-shaped` for cinematic styles, `available-daylight`
→ `documentary-ambient` for documentary styles). **Null** when `is_photographic`
is false — the compiler then emits no lighting vocabulary at all.

### artificiality control

`finish.artificiality.score` and `.band` are copied **verbatim** from
`photographic_character.artificiality_risk`. Only the `low` / `medium` / `high`
band is new. The P2.6 score computation is untouched.

### realism notes

Keyed (`RealismNoteKey`), rendered bilingually. For a photographic finish at
`low` / `medium` artificiality: `highlight-rolloff`, `controlled-sharpening`,
`restrained-retouching`, `material-response`, plus `skin-and-face` +
`hair-and-hands` when a human is in frame. At `high`: a single
`stylised-but-coherent` note. **Empty** for a non-photographic medium.

## Traceability

Every finish axis carries `{ value, rationale, source_signals }`:

```jsonc
{
  "value": "natural-warm",
  "rationale": "A warm, natural colour response resolves to a natural-warm colour character.",
  "source_signals": [
    "photographic_character.color_response:warm-natural",
    "photographic_character.white_balance:warm-ambient",
    "color.strategy:high-chroma-vernacular",
    "color.saturation:0.70"
  ]
}
```

`artificiality` carries the same shape plus `score` and `band`.

## The non-photographic guard

For `graphic-poster` and `illustration`:

- `is_photographic = false`, `lighting_character = null`, `realism_notes = []`.
- The compiler's finish paragraph is a single **colour-only** line: *"Colour
  finish — <character>: hold the recipe palette flat, clean and controlled,
  following the graphic recipe."* — no camera, lens, skin, bokeh, optical or
  photographic-lighting vocabulary. Enforced by
  `tests/golden/photographic-finish.golden.test.ts`.

The existing P2.7 graphic-poster / illustration adapters are unchanged.

## Prompt examples

**English (`kopi-lawas-promotion`, Master Prompt):**

```
Photographic finish — style product photography.
Colour character: natural warm — a warm ambient white balance, natural saturation, gentle contrast, a gentle highlight rolloff, natural shadow density, moderate colour separation.
Lighting character: directional daylight.
Artificiality: low · 27/100 — keep the finish strongly natural and un-retouched.
Realism notes: believable highlight rolloff and realistic shadow transitions; controlled sharpening and natural depth of field; restrained retouching with no plastic or wax-like skin; realistic material response and natural surface variation.
```

**Bahasa Indonesia (same recipe):**

```
Finish fotografis — style fotografi produk.
Karakter warna: natural hangat — white balance ambient yang hangat, saturasi yang natural, kontras yang lembut, highlight rolloff yang lembut, kepekatan bayangan yang natural, separasi warna yang moderat.
Karakter cahaya: cahaya siang yang terarah.
Artifisialitas: rendah · 27/100 — jaga finish tetap sangat natural dan tanpa retouch berlebihan.
Catatan realisme: highlight rolloff yang believable dan transisi bayangan yang realistis; penajaman yang terkendali dan depth of field yang natural; retouching yang terkendali, tanpa kulit seperti plastik atau lilin; respons material yang realistis dan variasi permukaan yang natural.
```

**Graphic poster (`type-led-fashion`), English:**

```
Colour finish — natural neutral: hold the recipe palette flat, clean and controlled, following the graphic recipe.
```

The resolved `finish` is identical in both languages — it lives on the recipe,
not the prompt.

## Guarantees

- No live model call — 100% deterministic, runs after extraction / direction.
- No change to DKV doctrine, design-decision priority, country, industry,
  graphic-treatment or the P2.6 resolver's existing fields (including the
  artificiality score).
- Every value is a bounded token; the colour vocabulary is a fixed table.
- Same recipe ⇒ byte-identical `finish` ⇒ unchanged `recipe_hash` determinism.
- Existing anchors are untouched.
