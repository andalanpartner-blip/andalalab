# Visual Generation Adapter

`DesignRecipe.photographic_character (+ selected concept) → VisualAdapterId → VisualGenerationBlock`.
Deterministic, no LLM. P2.7 — an additive **prompt-rendering** layer. It is not
a new design layer and it does not touch the Design Recipe.

## Doctrine

> The compiler must not make new creative or design decisions. All decisions
> already exist in the Design Recipe. The adapter only translates resolved
> recipe values into generation instructions.

The adapter answers one narrow question: **given the visual medium the recipe
already resolved to, what phrasing should the generation instruction use?** It
adds no layout, colour, palette, movement, country, audience or concept
decision. For photographic media it complements — never replaces — the
Photographic Character engine (P2.6). For `graphic-poster` and `illustration`
it deliberately carries no photographic skin / optics / camera language.

## The six adapters

| Adapter | Intent |
| --- | --- |
| `photorealistic` | believable photographic response, natural optics, restrained processing, realistic materials, natural imperfection |
| `fashion-editorial` | editorial camera response, controlled perspective compression, fashion lighting, believable skin/fabric, restrained retouching |
| `product-photography` | commercial studio product camera, controlled reflections, accurate surfaces, precise focus, clean material separation |
| `cinematic` | cinematic lens response, motivated directional light, controlled shadow density, atmospheric depth, restrained filmic rendering |
| `graphic-poster` | graphic composition response, hard-edged shapes, flat/controlled surfaces, print/editorial graphic structure, controlled texture where the recipe supports it |
| `illustration` | deliberate illustration rendering, controlled mark-making, coherent shape language, intentional surface treatment, non-photographic rendering |

Each adapter defines only phrasing mappings (`engine/prompt/visual-adapter/data.ts`):
`camera_language`, `lighting_language`, `surface_or_material_language`,
`realism_language`, `composition_language`, `motion_language`,
`rendering_language`, `avoid_language` — each carried bilingually.

## Resolver precedence (`engine/prompt/visual-adapter/resolve.ts`)

1. **`photographic_character.photographic_style`** — a clean 1:1 map. This is
   the load-bearing signal and covers virtually every recipe.
   - `natural-editorial` / `documentary` / `lifestyle` / `raw-documentary` → `photorealistic`
   - `commercial-editorial` / `fashion-editorial` → `fashion-editorial`
   - `product-studio` / `clean-commercial` → `product-photography`
   - `cinematic-natural` / `surreal-photographic` → `cinematic`
   - `graphic-photographic` / `mixed-media-photographic` → `graphic-poster`
2. **Recipe-signal refinement** — a `graphic-non-photographic` realism target
   paired with an `abstract` / `symbolic` concept is a deliberate
   `illustration`, not a `graphic-poster`.
3. **Deterministic fallback** to `photorealistic` if the style is somehow
   unrecognised (a future dataset value) — the compiler never crashes.

The resolution carries a traceable `rationale` and the `sourceSignals` that
produced it.

## Integration into the Prompt Compiler

- `engine/prompt/blocks.ts` resolves the adapter and lifts it into
  `PromptBlocks.visualGeneration` (a `VisualGenerationBlock`): adapter id,
  realism target (for the UI metadata line only), rationale, source signals,
  and the bilingual `rendering` vocabulary. `CompilePromptInput.visualAdapter`
  overrides the resolved adapter (for callers and tests comparing media).
- `engine/prompt/render/en.ts` and `render/id.ts` turn the block into natural
  language. The raw adapter id is **never** rendered — only the human label.
- Behaviour per prompt type:
  - **Master** — full visual-generation character (all eight fields).
  - **Quick** — the two most important traits (viewpoint + realism).
  - **Image-Only** — the image-generation traits; no typography decisions.
  - **Design/Layout** — composition character + rendering only.
  - **Negative** — one adapter-specific avoidance, not a dump.
- `PromptSet.visualCharacter` (`{ id, label, description }`) feeds the subtle
  metadata line on the Prompt section and the read-only "Visual Generation"
  panel on `RecipeBoard`.

## Colour

The adapter invents no grading. It reuses the recipe's resolved colour
strategy, palette, saturation, contrast, materiality and lighting, and only
describes **how** those already-resolved values should appear through the
chosen medium (e.g. "editorial-neutral tonal separation with controlled
contrast", "controlled graphic colour rendering that keeps the palette flat").

## Tests

- `tests/unit/visual-adapter.test.ts` — all six adapters resolve, deterministic
  fallback, adapter changes only the rendering vocabulary, no new design
  decision, photorealistic realism vocabulary, graphic-poster / illustration
  carry no photographic vocabulary, identical selection across languages.
- `tests/golden/visual-adapter.golden.test.ts` — one recipe, three adapters,
  structural blocks byte-identical, only the rendering layer changes.
- `tests/unit/prompt-compiler.test.ts` — visual-generation section present in
  every prompt type in both languages; override leaves the rest untouched.
