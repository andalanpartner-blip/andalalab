import { datasets, pipeline } from "./load";
import { selectedCandidate } from "../../engine/decision/resolve";
import { resolveAspectRatio, resolveLayout, resolveVisualType } from "../../engine";
import type { AspectRatio, VisualType } from "../../types/schemas/reference/visual-type.schema";
import type { LayoutSystem } from "../../types/schemas/reference/layout.schema";
import type { DesignContract } from "../../types/schemas/contract.schema";
import type { DesignDirection } from "../../types/schemas/direction.schema";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";

export type BlueprintInputs = {
  contract: DesignContract;
  direction: DesignDirection;
  recipe: DesignRecipe;
  visualType: VisualType;
  layout: LayoutSystem;
  aspectRatio: AspectRatio;
};

/** contract → direction → recipe for a fixture, plus the resolved refs the blueprint needs. */
export function blueprintInputs(name: string): BlueprintInputs {
  const { contract, direction, recipe } = pipeline(name);
  const layoutId = selectedCandidate(direction).candidate.layout_id;

  const visualType = resolveVisualType(datasets, contract.visual_type.id);
  const layout = resolveLayout(datasets, layoutId);
  if (!visualType) throw new Error(`${name}: visual type ${contract.visual_type.id} not in datasets`);
  if (!layout) throw new Error(`${name}: layout ${layoutId} not in datasets`);

  const aspectRatio = resolveAspectRatio(visualType, contract.visual_type.aspect_ratio_id);
  if (!aspectRatio) {
    throw new Error(`${name}: aspect ratio ${contract.visual_type.aspect_ratio_id} not on ${visualType.id}`);
  }

  return { contract, direction, recipe, visualType, layout, aspectRatio };
}

/** One fixture per distinct visual type / arrangement, kept small for golden tests. */
export const BLUEPRINT_FIXTURES = [
  "kopi-lawas-promotion", // social-feed, image-text-split (split-column)
  "northbeam-saas-launch", // social-feed, headline-dominant (stacked)
  "ooh-hospitality-billboard", // out-of-home, ooh-single-statement (stacked, 3 rows)
  "print-property-brochure", // print-a4, print-editorial-page (stacked, 7 zones)
  "web-hero-saas-launch", // web-hero, web-hero-*
  "story-skincare-launch" // story, story-* (tall frame)
] as const;
