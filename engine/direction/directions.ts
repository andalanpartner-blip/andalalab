import type { DatasetRegistry } from "../../types/datasets";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { CreativeConcept } from "../../types/schemas/concept.schema";
import type { VisualAdapterId } from "../prompt/visual-adapter/types";
import { resolveVisualAdapter } from "../prompt/visual-adapter/resolve";
import type { SchematicBlock, SchematicNode } from "../layout/templates";

/**
 * The Visual Direction Studio (P2.10 additive).
 *
 * Nine USER-FACING creative directions — a taste / client-preference layer, not
 * new taxonomy and not a second engine. Each direction maps onto the EXISTING
 * recipe-build biases that the P6 Correction Engine already uses
 * (`imageryRealism`, `graphic_ornament`, `colorSaturation`, `materialityTexture`).
 * Applying one re-derives the recipe through the normal chain
 * (`engine/direction/retarget.ts`): recipe → blueprint → prompt, fresh hashes,
 * parent immutable. No image is generated, no model is called.
 *
 * The "representation" a direction resolves to (photographic / graphic /
 * illustration / typographic) is READ OUT of the resulting recipe via the
 * existing Visual Generation Adapter resolver — nothing new decides it.
 */

/** A compact label for the representation a direction is built to land on. */
export type RepresentationMode = "photographic" | "graphic" | "illustration" | "typographic";

/** The four bounded recipe-build biases (already legal `Ratio` values, 0..1). */
export type DirectionOverrides = {
  readonly imageryRealism: number;
  readonly graphicOrnament: number;
  readonly colorSaturation: number;
  readonly materialityTexture: number;
};

export type VisualDirection = {
  readonly id: string;
  readonly index: string;
  readonly name: string;
  readonly description: string;
  /** The representation this direction is designed to express. */
  readonly representation: RepresentationMode;
  /** Visual Generation Adapter ids this direction is designed to land on. */
  readonly expectedAdapters: readonly VisualAdapterId[];
  readonly overrides: DirectionOverrides;
  /** One-line internal mapping shown only in the optional Details disclosure. */
  readonly internalMapping: string;
  readonly schematic: SchematicNode;
};

const leaf = (block: SchematicBlock, grow = 1, label?: string): SchematicNode =>
  label === undefined ? { block, grow } : { block, grow, label };
const col = (grow: number, ...children: SchematicNode[]): SchematicNode => ({ dir: "col", grow, children });
const row = (grow: number, ...children: SchematicNode[]): SchematicNode => ({ dir: "row", grow, children });

/**
 * The nine directions, in order. Each `expectedAdapters` set is verified against
 * a real retargeted recipe in `tests/unit/visual-directions.test.ts`.
 *
 * Override profiles — how they steer the EXISTING resolvers:
 *   imageryRealism  < 0.4  → `graphic-photographic` style → graphic-poster adapter (no camera vocab)
 *   imageryRealism  >= 0.4 → the industry/objective photographic style rules run
 *   graphicOrnament high   → richer graphic treatment (still capped by objective + audience)
 *   colorSaturation / materialityTexture → palette + surface emphasis
 */
export const VISUAL_DIRECTIONS: readonly VisualDirection[] = Object.freeze([
  {
    id: "editorial-photography",
    index: "01",
    name: "Editorial Photography",
    description: "Natural, sophisticated photography — a person, place, object or environment, shot like an editorial.",
    representation: "photographic",
    expectedAdapters: ["photorealistic", "fashion-editorial", "product-photography", "cinematic"],
    overrides: { imageryRealism: 0.86, graphicOrnament: 0.16, colorSaturation: 0.48, materialityTexture: 0.52 },
    internalMapping: "representation=photographic · high imagery realism · restrained graphic treatment",
    schematic: col(1, leaf("image", 5), leaf("caption", 1, "Caption"))
  },
  {
    id: "graphic-poster",
    index: "02",
    name: "Graphic Poster",
    description: "Bold, geometric, composition-led — hard-edged shapes and poster structure. Photography optional.",
    representation: "graphic",
    expectedAdapters: ["graphic-poster", "illustration"],
    overrides: { imageryRealism: 0.3, graphicOrnament: 0.62, colorSaturation: 0.72, materialityTexture: 0.24 },
    internalMapping: "representation=graphic · low imagery realism → graphic-poster adapter · expressive graphic treatment",
    schematic: col(1, row(2, leaf("shape", 1), leaf("shape", 1.6)), row(1.6, leaf("shape", 1.4), leaf("headline", 1)))
  },
  {
    id: "minimal-modern",
    index: "03",
    name: "Minimal Modern",
    description: "Clean, restrained, spacious — one focal element and a lot of quiet around it.",
    representation: "photographic",
    expectedAdapters: ["photorealistic", "product-photography", "fashion-editorial", "graphic-poster"],
    overrides: { imageryRealism: 0.66, graphicOrnament: 0.08, colorSaturation: 0.3, materialityTexture: 0.34 },
    internalMapping: "neutral graphic treatment · restrained saturation · single focal block — adapter follows the recipe",
    schematic: col(1, leaf("void", 2), leaf("image", 2.2), leaf("void", 1.6))
  },
  {
    id: "bold-experimental",
    index: "04",
    name: "Bold & Experimental",
    description: "Expressive, asymmetric, high-contrast — unexpected structure, controlled, never chaotic.",
    representation: "graphic",
    expectedAdapters: ["graphic-poster", "illustration"],
    overrides: { imageryRealism: 0.32, graphicOrnament: 0.86, colorSaturation: 0.82, materialityTexture: 0.3 },
    internalMapping: "representation=graphic · strong ornament + contrast (capped by objective & audience) · controlled asymmetry",
    schematic: col(1, row(3, leaf("shape", 2.4), leaf("void", 0.5)), row(1.6, leaf("void", 0.6), leaf("headline", 1.8)))
  },
  {
    id: "typography-first",
    index: "05",
    name: "Typography First",
    description: "Typography leads the composition — type as visual form, strong negative space. Photography rarely needed.",
    representation: "typographic",
    expectedAdapters: ["graphic-poster", "illustration"],
    overrides: { imageryRealism: 0.2, graphicOrnament: 0.34, colorSaturation: 0.26, materialityTexture: 0.2 },
    internalMapping: "representation=typographic · very low imagery realism → graphic-poster adapter · minimal graphic treatment so type carries",
    schematic: col(1, leaf("headline", 3.6), leaf("headline", 1.4), leaf("void", 1.4))
  },
  {
    id: "vector-illustration",
    index: "06",
    name: "Vector & Illustration",
    description: "Illustrated, shape-driven and symbolic — a clean vector / illustration aesthetic. The output is still a raster image.",
    representation: "illustration",
    expectedAdapters: ["illustration", "graphic-poster"],
    overrides: { imageryRealism: 0.26, graphicOrnament: 0.52, colorSaturation: 0.64, materialityTexture: 0.22 },
    internalMapping: "representation=illustration · low realism + shape language → illustration / graphic-poster adapter · aesthetic only — the render is a raster image",
    schematic: col(1, leaf("silhouette", 3.4), row(1.4, leaf("shape", 1), leaf("shape", 1)))
  },
  {
    id: "artistic-conceptual",
    index: "07",
    name: "Artistic / Conceptual",
    description: "Visual metaphor and symbol — art-directed, unexpected, concept-led. Human presence optional.",
    representation: "illustration",
    expectedAdapters: ["illustration", "graphic-poster", "cinematic"],
    overrides: { imageryRealism: 0.36, graphicOrnament: 0.7, colorSaturation: 0.58, materialityTexture: 0.4 },
    internalMapping: "representation=illustration/abstract · moderate-low realism · symbolic object / abstract relation",
    schematic: col(1, row(3, leaf("void", 1), leaf("silhouette", 1.6), leaf("void", 0.8)), leaf("caption", 1, "Symbol"))
  },
  {
    id: "quiet-luxury",
    index: "08",
    name: "Quiet Luxury",
    description: "Understated and premium — a large restrained object or material field, refined contrast, no noise.",
    representation: "photographic",
    expectedAdapters: ["fashion-editorial", "product-photography", "photorealistic"],
    overrides: { imageryRealism: 0.82, graphicOrnament: 0.05, colorSaturation: 0.24, materialityTexture: 0.72 },
    internalMapping: "representation=photographic · high realism + high materiality · minimal graphic language · low saturation",
    schematic: col(1, leaf("void", 0.7), leaf("material", 3.2), leaf("void", 0.7))
  },
  {
    id: "collage-mixed-media",
    index: "09",
    name: "Collage / Mixed Media",
    description: "Layered and tactile — photographic and graphic fragments, editorial cut-and-paste rhythm.",
    representation: "graphic",
    expectedAdapters: ["graphic-poster", "illustration"],
    overrides: { imageryRealism: 0.48, graphicOrnament: 0.8, colorSaturation: 0.6, materialityTexture: 0.56 },
    internalMapping: "representation=graphic/mixed · mid realism + heavy layering → graphic-poster adapter (mixed-media)",
    schematic: col(
      1,
      row(2, leaf("fragment", 1.4), leaf("fragment", 1)),
      row(1.6, leaf("fragment", 1), leaf("fragment", 1.5))
    )
  }
] as const);

export function directionById(id: string): VisualDirection | null {
  return VISUAL_DIRECTIONS.find((direction) => direction.id === id) ?? null;
}

// --- Recommendation (reads the recipe the AI already produced) ---------------

/** Which adapter the current recipe resolves to (the existing resolver, unchanged). */
export function adapterForRecipe(recipe: DesignRecipe, concept: CreativeConcept | null): VisualAdapterId {
  return resolveVisualAdapter({
    photographicStyle: recipe.photographic_character.photographic_style,
    realismTarget: recipe.photographic_character.realism_target,
    abstractionLevel: concept?.proposal.abstraction_level ?? null
  }).adapterId;
}

/**
 * The AI's recommended direction — the one whose expected adapters + intent best
 * match the recipe the Design Decision / Photographic Character / Adapter stack
 * already resolved. First match wins; every branch reads an already-resolved
 * value, none re-decides anything.
 */
export function recommendDirection(
  recipe: DesignRecipe,
  concept: CreativeConcept | null
): { direction: VisualDirection; adapterId: VisualAdapterId; why: string } {
  const adapterId = adapterForRecipe(recipe, concept);
  const style = recipe.photographic_character.photographic_style;
  const intensity = recipe.graphic_treatment.intensity;
  const refined = recipe.imagery.realism >= 0.75 && recipe.color.saturation <= 0.35;
  const typeLed = concept?.proposal.subject_strategy === "typography-as-subject";
  const abstract =
    concept?.proposal.abstraction_level === "abstract" || concept?.proposal.abstraction_level === "symbolic";

  const pick = (id: string): VisualDirection => directionById(id)!;

  let direction: VisualDirection;
  if (adapterId === "illustration") direction = pick("vector-illustration");
  else if (adapterId === "graphic-poster") {
    if (typeLed) direction = pick("typography-first");
    else if (intensity === "experimental") direction = pick("bold-experimental");
    else if (abstract) direction = pick("artistic-conceptual");
    else if (style === "mixed-media-photographic") direction = pick("collage-mixed-media");
    else direction = pick("graphic-poster");
  } else if (adapterId === "cinematic") direction = pick("artistic-conceptual");
  else {
    // a photographic adapter
    if (refined) direction = pick("quiet-luxury");
    else if (recipe.graphic_language.ornament <= 0.15 && recipe.color.saturation <= 0.4)
      direction = pick("minimal-modern");
    else direction = pick("editorial-photography");
  }

  const why =
    `The recipe resolved to the ${adapterId.replace("-", " ")} representation ` +
    `(${style.replace(/-/g, " ")}) for this ${recipe.objective} ${recipe.movement.name} brief — ` +
    `${direction.name} is the closest visual direction.`;

  return { direction, adapterId, why };
}

// --- The overview the client renders ---------------------------------------

export type VisualDirectionOverview = {
  readonly recommendedDirectionId: string;
  readonly recommendedDirectionName: string;
  readonly why: string;
  /** The adapter the current recipe resolves to — surfaced only in Details. */
  readonly currentAdapterId: VisualAdapterId;
  /** The direction whose representation the current recipe already expresses (the "Current" badge). */
  readonly currentDirectionId: string;
  readonly directions: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly representation: RepresentationMode;
    readonly internalMapping: string;
  }>;
};

export function visualDirectionOverview(
  _datasets: DatasetRegistry,
  recipe: DesignRecipe,
  concept: CreativeConcept | null
): VisualDirectionOverview {
  const rec = recommendDirection(recipe, concept);
  return {
    recommendedDirectionId: rec.direction.id,
    recommendedDirectionName: rec.direction.name,
    why: rec.why,
    currentAdapterId: rec.adapterId,
    currentDirectionId: rec.direction.id,
    directions: VISUAL_DIRECTIONS.map((direction) => ({
      id: direction.id,
      name: direction.name,
      representation: direction.representation,
      internalMapping: direction.internalMapping
    }))
  };
}
