import type {
  PhotographicStyle,
  RealismTarget
} from "../../../types/schemas/photographic-character.schema";

/**
 * Visual Generation Adapter — P2.7.
 *
 * A small, deterministic translation layer that sits between the resolved
 * Design Recipe and the Prompt Compiler's renderers. It answers one narrow
 * question: "given the visual medium the recipe already resolved to, what
 * phrasing should the generation instruction use?".
 *
 * DOCTRINE: the adapter makes NO creative or design decision. Every decision
 * (style, realism target, palette, lighting, composition, typography, graphic
 * treatment) already exists on the recipe. The adapter only maps an
 * already-resolved medium onto a compact, reviewable vocabulary. It never
 * calls an LLM, never reads free user text, never invents a layout, colour,
 * movement or audience.
 */

/** §1 — the closed set of supported visual-generation adapters. */
export const VISUAL_ADAPTER_IDS = [
  "photorealistic",
  "fashion-editorial",
  "product-photography",
  "cinematic",
  "graphic-poster",
  "illustration"
] as const;

export type VisualAdapterId = (typeof VISUAL_ADAPTER_IDS)[number];

/** One phrasing, carried bilingually so either renderer picks its own language. */
export type AdapterPhrase = { readonly en: string; readonly id: string };

/**
 * The minimum adapter output the compiler needs. Every field is a phrasing
 * mapping only — never a new decision. Adapters that have nothing medium-
 * specific to say for a field still provide a restrained, recipe-faithful
 * phrase (the compiler always renders a complete block).
 */
export type VisualAdapterVocabulary = {
  readonly camera_language: AdapterPhrase;
  readonly lighting_language: AdapterPhrase;
  readonly surface_or_material_language: AdapterPhrase;
  readonly realism_language: AdapterPhrase;
  readonly composition_language: AdapterPhrase;
  readonly motion_language: AdapterPhrase;
  readonly rendering_language: AdapterPhrase;
  readonly avoid_language: AdapterPhrase;
};

/**
 * The already-resolved recipe signals the resolver is allowed to read. Nothing
 * here is recomputed — these are lifted verbatim from
 * `recipe.photographic_character` and, when a concept exists, its resolved
 * abstraction level.
 */
export type VisualAdapterInput = {
  /** recipe.photographic_character.photographic_style */
  readonly photographicStyle: PhotographicStyle;
  /** recipe.photographic_character.realism_target */
  readonly realismTarget: RealismTarget;
  /** concept.proposal.abstraction_level, when a concept was selected. */
  readonly abstractionLevel?: string | null;
};

export type VisualAdapterResolution = {
  readonly adapterId: VisualAdapterId;
  /** Traceable: names the resolved signals that produced the selection. */
  readonly rationale: string;
  readonly sourceSignals: readonly string[];
};
