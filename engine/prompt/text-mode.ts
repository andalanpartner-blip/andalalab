import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { TextMode } from "./types";

/**
 * Zones that carry legible copy rather than pure image content (types/schemas/reference/layout.schema.ts ZoneId).
 * "data" and "product" are excluded: they are visual/numeric display zones,
 * not zones the compiler should treat as requiring exact wording.
 */
export const TEXT_BEARING_ZONES: ReadonlySet<string> = new Set([
  "headline",
  "body",
  "offer",
  "cta",
  "navigation",
  "footer"
]);

/**
 * The recipe does not yet carry a visual-type reference (and with it,
 * `text_render_risk`), so the mode is derived from what the recipe already
 * decided: a required text-bearing zone plus an actual message to put in it.
 * A caller with better information (e.g. a future visual-type lookup) may
 * override this via `CompilePromptInput.textMode`.
 */
export function resolveTextMode(recipe: DesignRecipe, override?: TextMode | null): TextMode {
  if (override) return override;

  const hasRequiredTextZone = recipe.hierarchy.levels.some(
    (level) => level.required && TEXT_BEARING_ZONES.has(level.zone)
  );
  const hasMessage = recipe.core_message.trim().length > 0;

  return hasRequiredTextZone && hasMessage ? "TEXT_CRITICAL" : "LAYOUT_ONLY";
}
