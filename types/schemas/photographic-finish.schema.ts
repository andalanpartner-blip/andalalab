import { z } from "zod";
import { NonEmptyText, Note } from "../primitives";
import {
  ArtificialityRiskBand,
  HighlightRolloff,
  WhiteBalance
} from "./photographic-character.schema";

/**
 * Photographic Finish — P2.9.
 *
 * An ADDITIVE, deterministic layer over `PhotographicCharacterSpec`. It does
 * not replace the P2.6 engine: it consolidates four already-resolved axes into
 * named, traceable tokens so the compiler and UI can talk about them directly:
 *
 *   1. photographic style        — one of seven finish families
 *   2. colour character          — one of nine, each with a fixed colour vocabulary
 *   3. lighting character        — one of eight (null for non-photographic media)
 *   4. artificiality control     — the existing 0-100 risk score, banded low / medium / high
 *
 * Every value is derived from `recipe.photographic_character` (style, colour
 * response, white balance, lighting behaviour, artificiality risk) plus a
 * handful of recipe signals (colour strategy, colour saturation, audience
 * refinement). It NEVER makes a new decision, calls an LLM, reads a country id,
 * or overrides a Design Recipe value — see docs/photographic-finish.md.
 *
 * For a non-photographic medium (graphic-poster / illustration) the layer
 * carries a colour character only: `is_photographic` is false,
 * `lighting_character` is null and `realism_notes` is empty, so the compiler
 * never injects camera / lens / skin / bokeh / photographic-lighting vocabulary
 * into those adapters.
 */

/** §1 — the seven finish families. Mirrors the Visual Generation Adapter set + documentary. */
export const PhotographicFinishStyle = z.enum([
  "photorealistic",
  "fashion-editorial",
  "product-photography",
  "cinematic",
  "documentary",
  "graphic-poster",
  "illustration"
]);
export type PhotographicFinishStyle = z.infer<typeof PhotographicFinishStyle>;

/** §2 — colour character. Each value has a fixed colour vocabulary (below). */
export const ColorCharacter = z.enum([
  "natural-neutral",
  "natural-warm",
  "natural-cool",
  "editorial-neutral",
  "muted-film",
  "soft-pastel",
  "high-chroma-commercial",
  "monochrome",
  "restrained-commercial"
]);
export type ColorCharacter = z.infer<typeof ColorCharacter>;

/** §3 — lighting character. Null for a non-photographic medium. */
export const LightingCharacter = z.enum([
  "soft-window",
  "directional-daylight",
  "diffuse-daylight",
  "controlled-studio",
  "hard-sun",
  "ambient-interior",
  "cinematic-shaped",
  "documentary-ambient"
]);
export type LightingCharacter = z.infer<typeof LightingCharacter>;

/** §4 — artificiality control. low = strongly natural, medium = controlled polish, high = stylised. */
export const ArtificialityLevel = z.enum(["low", "medium", "high"]);
export type ArtificialityLevel = z.infer<typeof ArtificialityLevel>;

/** The six sub-facets a colour character must distinguish. */
export const ColorSaturationRestraint = z.enum(["restrained", "natural", "elevated"]);
export type ColorSaturationRestraint = z.infer<typeof ColorSaturationRestraint>;

export const ColorContrastCharacter = z.enum(["low", "gentle", "moderate", "firm"]);
export type ColorContrastCharacter = z.infer<typeof ColorContrastCharacter>;

export const ShadowDensity = z.enum(["open", "natural", "deep"]);
export type ShadowDensity = z.infer<typeof ShadowDensity>;

export const ColorSeparation = z.enum(["low", "moderate", "distinct"]);
export type ColorSeparation = z.infer<typeof ColorSeparation>;

/** §11 — compact, keyed realism instructions. Empty for a non-photographic medium. */
export const RealismNoteKey = z.enum([
  "highlight-rolloff",
  "controlled-sharpening",
  "restrained-retouching",
  "material-response",
  "skin-and-face",
  "hair-and-hands",
  "stylised-but-coherent"
]);
export type RealismNoteKey = z.infer<typeof RealismNoteKey>;

/**
 * The deterministic colour vocabulary for a colour character. Six facets, all
 * bounded — never a free phrase like "cinematic color grading".
 */
export const ColorVocabulary = z.object({
  white_balance: WhiteBalance,
  saturation_restraint: ColorSaturationRestraint,
  contrast_character: ColorContrastCharacter,
  highlight_rolloff: HighlightRolloff,
  shadow_density: ShadowDensity,
  color_separation: ColorSeparation
});
export type ColorVocabulary = z.infer<typeof ColorVocabulary>;

/** A resolved finish axis, with the traceability every P2.9 field carries. */
const traced = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    value,
    rationale: Note,
    source_signals: z.array(NonEmptyText).min(1)
  });

export const PhotographicFinishSpec = z.object({
  /** false for graphic-poster / illustration — the non-photographic guard. */
  is_photographic: z.boolean(),

  style: traced(PhotographicFinishStyle),
  color_character: traced(ColorCharacter),
  /** Null when `is_photographic` is false. */
  lighting_character: traced(LightingCharacter).nullable(),

  artificiality: z.object({
    value: ArtificialityLevel,
    /** Reused verbatim from `photographic_character.artificiality_risk.score`. */
    score: z.number().int().min(0).max(100),
    band: ArtificialityRiskBand,
    rationale: Note,
    source_signals: z.array(NonEmptyText).min(1)
  }),

  /** The fixed colour vocabulary for `color_character.value`. */
  color_vocabulary: ColorVocabulary,

  /** Keyed realism instructions for the compiler. Empty for a non-photographic medium. */
  realism_notes: z.array(RealismNoteKey)
});
export type PhotographicFinishSpec = z.infer<typeof PhotographicFinishSpec>;
