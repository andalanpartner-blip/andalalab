import { z } from "zod";
import { NonEmptyText, Note } from "../primitives";

/**
 * Photographic Character — P2.6.
 *
 * The recipe section that answers "how should this visual behave optically and
 * materially so it reads as a real photograph (or a deliberate photographic
 * hybrid) rather than an AI render". It is a DERIVED layer: every value here is
 * a deterministic function of signals the recipe has already resolved
 * (industry, objective, visual type, imagery realism, lighting, colour,
 * materiality, movement, graphic treatment, the selected concept). It never
 * makes a new decision, never calls an LLM, and never overrides an existing
 * Design Recipe field — see docs/photographic-character-engine.md.
 *
 * Not every style is photorealistic: the taxonomy explicitly supports
 * editorial, graphic and mixed-media photographic outputs.
 */

/** §2 — the bounded photographic style taxonomy. Small and curated on purpose. */
export const PhotographicStyle = z.enum([
  "natural-editorial",
  "commercial-editorial",
  "documentary",
  "lifestyle",
  "fashion-editorial",
  "product-studio",
  "cinematic-natural",
  "graphic-photographic",
  "raw-documentary",
  "clean-commercial",
  "surreal-photographic",
  "mixed-media-photographic"
]);
export type PhotographicStyle = z.infer<typeof PhotographicStyle>;

/** How photoreal the output should read. Bounded — not every style is photoreal. */
export const RealismTarget = z.enum([
  "photoreal-refined",
  "photoreal-natural",
  "stylised-photographic",
  "graphic-non-photographic"
]);
export type RealismTarget = z.infer<typeof RealismTarget>;

/** §3 — camera language. */
export const CameraLanguage = z.enum([
  "full-frame-natural",
  "full-frame-editorial",
  "medium-format-clean",
  "close-range-documentary",
  "studio-commercial",
  "environmental-wide"
]);
export type CameraLanguage = z.infer<typeof CameraLanguage>;

/** §4 — lens character. */
export const LensCharacter = z.enum([
  "35mm-environmental",
  "50mm-natural-perspective",
  "85mm-portrait-compression",
  "100mm-macro-product",
  "wide-editorial-perspective"
]);
export type LensCharacter = z.infer<typeof LensCharacter>;

/** §5 — depth of field. */
export const DepthOfField = z.enum([
  "deep-natural",
  "moderate-optical",
  "shallow-optical",
  "selective-focus"
]);
export type DepthOfField = z.infer<typeof DepthOfField>;

/** How focus is distributed across the frame. Derived from depth of field. */
export const FocusBehavior = z.enum([
  "sharp-throughout",
  "subject-critical-focus",
  "plane-of-focus-selective",
  "soft-overall"
]);
export type FocusBehavior = z.infer<typeof FocusBehavior>;

/** How the lens renders spatial relationships. Derived from lens character. */
export const PerspectiveBehavior = z.enum([
  "natural-perspective",
  "mild-compression",
  "strong-compression",
  "wide-expansive",
  "corrected-architectural"
]);
export type PerspectiveBehavior = z.infer<typeof PerspectiveBehavior>;

/** §6 — lighting behaviour. */
export const LightingBehavior = z.enum([
  "available-daylight",
  "window-light",
  "soft-directional",
  "controlled-studio",
  "mixed-natural",
  "hard-sun",
  "overcast-natural",
  "practical-light",
  "dusk-natural"
]);
export type LightingBehavior = z.infer<typeof LightingBehavior>;

export const LightDirection = z.enum([
  "frontal-soft",
  "side-directional",
  "three-quarter",
  "back-rim",
  "top-down",
  "ambient-wrap"
]);
export type LightDirection = z.infer<typeof LightDirection>;

export const HighlightRolloff = z.enum(["gentle", "natural", "filmic", "crisp"]);
export type HighlightRolloff = z.infer<typeof HighlightRolloff>;

export const ShadowBehavior = z.enum([
  "soft-diffused",
  "natural-density",
  "defined-directional",
  "deep-contrasty"
]);
export type ShadowBehavior = z.infer<typeof ShadowBehavior>;

/** §7 — colour response. */
export const ColorResponse = z.enum([
  "neutral-natural",
  "warm-natural",
  "restrained-commercial",
  "editorial-neutral",
  "soft-film",
  "high-fidelity-product",
  "muted-documentary",
  "bold-editorial"
]);
export type ColorResponse = z.infer<typeof ColorResponse>;

export const WhiteBalance = z.enum(["neutral", "warm-ambient", "cool-daylight", "mixed-corrected"]);
export type WhiteBalance = z.infer<typeof WhiteBalance>;

/** §12 — bounded dynamic range. "high-contrast" is never a default. */
export const DynamicRange = z.enum(["restrained", "natural", "extended", "high-contrast"]);
export type DynamicRange = z.infer<typeof DynamicRange>;

/**
 * One shared, bounded scale for every "how real should this class of surface
 * look" field (skin, face, hair, hands, fabric, materials, environment). A
 * deliberately small vocabulary rather than a per-surface taxonomy.
 */
export const RealismEmphasis = z.enum([
  "not-applicable",
  "stylised",
  "naturalistic",
  "detailed-naturalistic"
]);
export type RealismEmphasis = z.infer<typeof RealismEmphasis>;

export const TextureCharacter = z.enum([
  "clean",
  "subtle-grain",
  "natural-texture",
  "tactile-pronounced"
]);
export type TextureCharacter = z.infer<typeof TextureCharacter>;

export const MotionRealism = z.enum([
  "static",
  "subtle-implied-motion",
  "natural-motion",
  "dynamic-motion"
]);
export type MotionRealism = z.infer<typeof MotionRealism>;

/** §11 — controlled imperfection. Default is "subtle" or "natural", never "none". */
export const ImperfectionLevel = z.enum(["none", "subtle", "natural", "expressive"]);
export type ImperfectionLevel = z.infer<typeof ImperfectionLevel>;

/** §9 — diagnostic only. Does NOT override the Design Recipe. */
export const ArtificialityRiskBand = z.enum(["low", "moderate", "elevated", "high"]);
export type ArtificialityRiskBand = z.infer<typeof ArtificialityRiskBand>;

export const ArtificialityRisk = z.object({
  /** 0 (fully believable) – 100 (reads synthetic). Deterministic arithmetic. */
  score: z.number().int().min(0).max(100),
  band: ArtificialityRiskBand,
  /** Plain-language contributors, most significant first. Never from an LLM. */
  factors: z.array(NonEmptyText)
});
export type ArtificialityRisk = z.infer<typeof ArtificialityRisk>;

/** §8 — the realism doctrine, expressed as prefer/avoid guidance for the compiler. */
export const PhotographicConstraint = z.object({
  kind: z.enum(["prefer", "avoid"]),
  statement: Note
});
export type PhotographicConstraint = z.infer<typeof PhotographicConstraint>;

export const PhotographicCharacterSpec = z.object({
  photographic_style: PhotographicStyle,
  realism_target: RealismTarget,

  camera_language: CameraLanguage,
  lens_character: LensCharacter,
  depth_of_field: DepthOfField,
  focus_behavior: FocusBehavior,
  perspective_behavior: PerspectiveBehavior,

  lighting_behavior: LightingBehavior,
  light_direction: LightDirection,
  highlight_rolloff: HighlightRolloff,
  shadow_behavior: ShadowBehavior,

  color_response: ColorResponse,
  white_balance: WhiteBalance,
  dynamic_range: DynamicRange,

  skin_realism: RealismEmphasis,
  face_realism: RealismEmphasis,
  hair_realism: RealismEmphasis,
  hand_realism: RealismEmphasis,
  fabric_realism: RealismEmphasis,
  material_realism: RealismEmphasis,
  environmental_realism: RealismEmphasis,

  texture_character: TextureCharacter,
  motion_realism: MotionRealism,
  imperfection_level: ImperfectionLevel,

  artificiality_risk: ArtificialityRisk,

  /** Plain-language, generated from structured decisions. Never from an LLM. */
  constraints: z.array(PhotographicConstraint).min(1),
  rationale: z.array(Note).min(1),
  /** Which already-resolved signals produced this layer — the traceability requirement. */
  source: NonEmptyText
});
export type PhotographicCharacterSpec = z.infer<typeof PhotographicCharacterSpec>;
