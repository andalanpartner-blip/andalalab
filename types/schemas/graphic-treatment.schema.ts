import { z } from "zod";
import { NonEmptyText, Note, Slug } from "../primitives";

/**
 * Graphic Treatment — P2.5.
 *
 * The recipe section that answers "what graphic devices, if any, dress this
 * composition, and how much". It is downstream of every other decision: a
 * device is only ever added because composition, hierarchy, movement,
 * industry, audience or objective already called for it (doctrine §14 — see
 * docs/graphic-treatment-engine.md). Nothing here invents a visual style; it
 * selects from a fixed taxonomy (engine/graphic-treatment/data.ts) using
 * values the recipe has already resolved.
 */

export const GraphicTreatmentIntensity = z.enum([
  "none",
  "minimal",
  "moderate",
  "expressive",
  "experimental"
]);
export type GraphicTreatmentIntensity = z.infer<typeof GraphicTreatmentIntensity>;

/** The three levels of graphic treatment (doctrine §3), plus the supporting layers (§4). */
export const GraphicDeviceCategory = z.enum([
  "structural",
  "expressive",
  "image_treatment",
  "typography_treatment",
  "texture",
  "pattern",
  "layering",
  "accent"
]);
export type GraphicDeviceCategory = z.infer<typeof GraphicDeviceCategory>;

/**
 * The "no random decoration" invariant, made a closed enum (doctrine §20).
 * A device with no purpose from this list cannot be selected — there is no
 * "looks cool" or "adds decoration" option.
 */
export const GraphicDevicePurpose = z.enum([
  "hierarchy",
  "framing",
  "movement",
  "rhythm",
  "emphasis",
  "contrast",
  "narrative",
  "image_integration",
  "typography_integration",
  "information_grouping"
]);
export type GraphicDevicePurpose = z.infer<typeof GraphicDevicePurpose>;

/**
 * One device as it appears on a recipe.
 *
 * This is the trimmed, recipe-facing shape — the same relationship
 * MovementSpec has to DesignMovement. `source` and `rationale` are quoted
 * traceability, not composed prose: every value here is lifted from the
 * engine-internal GraphicDevice record and the decision context that
 * selected it (engine/graphic-treatment/resolve.ts).
 */
export const SelectedGraphicDevice = z.object({
  id: Slug,
  category: GraphicDeviceCategory,
  name: NonEmptyText,
  purpose: z.array(GraphicDevicePurpose).min(1),
  /** Natural-language production instruction, English. Quoted verbatim by the Prompt Compiler. */
  prompt_en: NonEmptyText,
  /** Natural-language production instruction, Bahasa Indonesia. */
  prompt_id: NonEmptyText,
  /** Which doctrine layer(s) justified this pick — the traceability requirement (doctrine §16). */
  source: NonEmptyText,
  rationale: Note
});
export type SelectedGraphicDevice = z.infer<typeof SelectedGraphicDevice>;

export const GraphicTreatmentSpec = z.object({
  intensity: GraphicTreatmentIntensity,
  structural_devices: z.array(SelectedGraphicDevice),
  expressive_devices: z.array(SelectedGraphicDevice),
  image_treatments: z.array(SelectedGraphicDevice),
  typography_treatments: z.array(SelectedGraphicDevice),
  textures: z.array(SelectedGraphicDevice),
  patterns: z.array(SelectedGraphicDevice),
  layering: z.array(SelectedGraphicDevice),
  accents: z.array(SelectedGraphicDevice),
  /** Plain-language, generated from structured decisions. Never from an LLM. */
  rationale: z.array(Note).min(1),
  source: NonEmptyText
});
export type GraphicTreatmentSpec = z.infer<typeof GraphicTreatmentSpec>;
