import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { SelectedGraphicDevice } from "../../types/schemas/graphic-treatment.schema";

/**
 * Upstream-signal extraction for the Layout Blueprint (P2.10.4).
 *
 * Small pure readers over already-resolved artifacts. They discover, never
 * decide — the answer is always "does the recipe already say this?".
 */

/** A graphic-treatment device whose purpose frames or integrates imagery. */
export type ImageIntegration = {
  readonly integrates: boolean;
  readonly deviceName: string | null;
  readonly signal: string | null;
};

const INTEGRATION_PURPOSES = new Set(["framing", "image_integration"]);

export function detectImageIntegration(recipe: DesignRecipe): ImageIntegration {
  const treatment = recipe.graphic_treatment;
  const pools: { category: string; devices: readonly SelectedGraphicDevice[] }[] = [
    { category: "image_treatments", devices: treatment.image_treatments },
    { category: "layering", devices: treatment.layering },
    { category: "structural_devices", devices: treatment.structural_devices }
  ];

  for (const { category, devices } of pools) {
    for (const device of devices) {
      if (device.purpose.some((purpose) => INTEGRATION_PURPOSES.has(purpose))) {
        return {
          integrates: true,
          deviceName: device.name,
          signal: `recipe.graphic_treatment.${category}[${device.id}] purpose=${device.purpose.join("|")}`
        };
      }
    }
  }

  return { integrates: false, deviceName: null, signal: null };
}
