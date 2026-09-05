import type { DatasetRegistry } from "../../types/datasets";
import type { LayoutSystem } from "../../types/schemas/reference/layout.schema";
import type { VisualType } from "../../types/schemas/reference/visual-type.schema";

export function resolveLayout(datasets: DatasetRegistry, id: string): LayoutSystem | null {
  return datasets.layouts.get(id) ?? null;
}

export function layoutSupportsVisualType(layout: LayoutSystem, visualType: VisualType): boolean {
  return layout.suitable_visual_types.includes(visualType.id);
}

/**
 * Layouts available for a visual type, ordered deterministically.
 * P1 scores and selects from this set; P0 only enumerates it.
 */
export function candidateLayouts(
  datasets: DatasetRegistry,
  visualType: VisualType
): readonly LayoutSystem[] {
  return [...datasets.layouts.values()]
    .filter((layout) => layoutSupportsVisualType(layout, visualType))
    .sort((a, b) => a.id.localeCompare(b.id));
}
