import type { PhotographicStyle } from "../../../types/schemas/photographic-character.schema";
import type {
  VisualAdapterId,
  VisualAdapterInput,
  VisualAdapterResolution
} from "./types";

/**
 * The Visual Generation Adapter resolver — P2.7.
 *
 * Pure and deterministic. It picks ONE adapter from already-resolved recipe
 * signals — no LLM, no free user text, no new creative direction. Identical
 * input always produces an identical resolution.
 *
 * Precedence:
 *   1. `photographic_character.photographic_style` — a clean 1:1 map. This is
 *      the load-bearing signal and covers almost every recipe.
 *   2. A recipe-signal refinement: a graphic, non-photographic realism target
 *      paired with an abstract / symbolic concept is a deliberate illustration
 *      rather than a graphic poster.
 *   3. Deterministic fallback to `photorealistic` if the style is somehow
 *      unrecognised (e.g. a future dataset value) — the compiler never crashes.
 */

/** §3 precedence 1 — every current PhotographicStyle maps cleanly. */
const STYLE_TO_ADAPTER: Record<PhotographicStyle, VisualAdapterId> = {
  "natural-editorial": "photorealistic",
  "commercial-editorial": "fashion-editorial",
  documentary: "photorealistic",
  lifestyle: "photorealistic",
  "fashion-editorial": "fashion-editorial",
  "product-studio": "product-photography",
  "clean-commercial": "product-photography",
  "cinematic-natural": "cinematic",
  "graphic-photographic": "graphic-poster",
  "mixed-media-photographic": "graphic-poster",
  "surreal-photographic": "cinematic",
  "raw-documentary": "photorealistic"
};

const ABSTRACT_CONCEPT = new Set(["abstract", "symbolic"]);

export function resolveVisualAdapter(input: VisualAdapterInput): VisualAdapterResolution {
  const { photographicStyle, realismTarget, abstractionLevel } = input;
  const mapped = (STYLE_TO_ADAPTER as Record<string, VisualAdapterId | undefined>)[photographicStyle];

  // Precedence 2 — refine the graphic branch: a non-photographic realism
  // target plus an abstract/symbolic concept is illustration, not a poster.
  if (
    mapped === "graphic-poster" &&
    realismTarget === "graphic-non-photographic" &&
    typeof abstractionLevel === "string" &&
    ABSTRACT_CONCEPT.has(abstractionLevel)
  ) {
    return {
      adapterId: "illustration",
      rationale:
        `Photographic style "${photographicStyle}" resolved to a graphic, non-photographic realism target with an ` +
        `${abstractionLevel} concept — the deliberate-illustration adapter, not graphic-poster.`,
      sourceSignals: [
        `photographic_character.photographic_style = ${photographicStyle}`,
        `photographic_character.realism_target = ${realismTarget}`,
        `concept.abstraction_level = ${abstractionLevel}`
      ]
    };
  }

  // Precedence 1 — the clean style map.
  if (mapped) {
    return {
      adapterId: mapped,
      rationale: `Photographic style "${photographicStyle}" maps to the ${mapped} visual-generation adapter.`,
      sourceSignals: [`photographic_character.photographic_style = ${photographicStyle}`]
    };
  }

  // Precedence 3 — deterministic fallback.
  return {
    adapterId: "photorealistic",
    rationale:
      `No recognised photographic style ("${photographicStyle}") — falling back deterministically to the photorealistic adapter.`,
    sourceSignals: [`photographic_character.photographic_style = ${photographicStyle} (unrecognised)`, "fallback = photorealistic"]
  };
}
