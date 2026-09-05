import type { ColorCharacter, ColorVocabulary } from "../../types/schemas/photographic-finish.schema";

/**
 * The Photographic Finish doctrine, as data (P2.9).
 *
 * One curated table — the same posture as `data.ts`,
 * `engine/graphic-treatment/data.ts` and `engine/prompt/visual-adapter/data.ts`:
 * reviewable in one file, never generated per recipe.
 *
 * Each colour character maps to a FIXED six-facet colour vocabulary. This is
 * what "each colour character needs a deterministic vocabulary" means — the
 * compiler never appends a free phrase like "cinematic color grading"; it reads
 * these bounded tokens and renders them through the bilingual phrase tables.
 */
export const COLOR_CHARACTER_VOCABULARY: Record<ColorCharacter, ColorVocabulary> = {
  "natural-neutral": {
    white_balance: "neutral",
    saturation_restraint: "natural",
    contrast_character: "gentle",
    highlight_rolloff: "natural",
    shadow_density: "natural",
    color_separation: "moderate"
  },
  "natural-warm": {
    white_balance: "warm-ambient",
    saturation_restraint: "natural",
    contrast_character: "gentle",
    highlight_rolloff: "gentle",
    shadow_density: "natural",
    color_separation: "moderate"
  },
  "natural-cool": {
    white_balance: "cool-daylight",
    saturation_restraint: "restrained",
    contrast_character: "gentle",
    highlight_rolloff: "natural",
    shadow_density: "natural",
    color_separation: "moderate"
  },
  "editorial-neutral": {
    white_balance: "neutral",
    saturation_restraint: "restrained",
    contrast_character: "moderate",
    highlight_rolloff: "natural",
    shadow_density: "natural",
    color_separation: "distinct"
  },
  "muted-film": {
    white_balance: "warm-ambient",
    saturation_restraint: "restrained",
    contrast_character: "gentle",
    highlight_rolloff: "filmic",
    shadow_density: "open",
    color_separation: "low"
  },
  "soft-pastel": {
    white_balance: "neutral",
    saturation_restraint: "restrained",
    contrast_character: "low",
    highlight_rolloff: "gentle",
    shadow_density: "open",
    color_separation: "low"
  },
  "high-chroma-commercial": {
    white_balance: "neutral",
    saturation_restraint: "elevated",
    contrast_character: "firm",
    highlight_rolloff: "crisp",
    shadow_density: "deep",
    color_separation: "distinct"
  },
  monochrome: {
    white_balance: "neutral",
    saturation_restraint: "restrained",
    contrast_character: "firm",
    highlight_rolloff: "natural",
    shadow_density: "deep",
    color_separation: "distinct"
  },
  "restrained-commercial": {
    white_balance: "neutral",
    saturation_restraint: "restrained",
    contrast_character: "moderate",
    highlight_rolloff: "crisp",
    shadow_density: "natural",
    color_separation: "moderate"
  }
};
