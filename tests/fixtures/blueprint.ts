import type { LayoutBlueprint } from "../../types/schemas/layout-blueprint.schema";

/**
 * A hand-built, schema-valid LayoutBlueprint for schema-level tests.
 *
 * The resolver's own output is exercised by the golden and determinism tests
 * from P2.10.5 onward; this fixture only needs to be *structurally* valid so
 * the schema's shape, strictness and refinements can be probed in isolation.
 */
export function validBlueprint(overrides: Partial<LayoutBlueprint> = {}): LayoutBlueprint {
  const base: LayoutBlueprint = {
    schema_version: "1.0.0",
    resolver_version: "1.0.0",
    dataset_version: "2026.09.3",
    mode: "schematic",
    provenance: {
      recipe_id: "recipe_000001",
      recipe_hash: "abcd1234",
      contract_id: "contract_000001",
      direction_id: "direction_000001",
      concept_ref: null,
      layout_id: "image-text-split",
      visual_type_id: "social-feed",
      objective: "promotion"
    },
    canvas: {
      visual_type_id: "social-feed",
      channel: "instagram-feed",
      aspect_ratio_id: "portrait",
      aspect_ratio_label: "4:5 Portrait",
      width: 1080,
      height: 1350,
      orientation: "portrait",
      ratio: 0.8,
      basis: "structural"
    },
    grid: {
      columns: 6,
      rows: 8,
      gutter_ratio: 0.02,
      margin_ratio: 0.06,
      modularity: 0.75,
      column_width: 0.1567,
      row_height: 0.125,
      basis: "structural",
      source: "layout:image-text-split + movement:bauhaus"
    },
    safe_area: {
      top: 0.06,
      right: 0.06,
      bottom: 0.1,
      left: 0.06,
      basis: "structural",
      source: "visual_type:social-feed safe_area"
    },
    layout_strategy: {
      composition_strategy: "stacked-vertical",
      balance: "mixed",
      arrangement: "stacked",
      spatial_behavior: "Layered rather than flat, with a clear centre.",
      basis: "structural",
      source: "recipe.composition"
    },
    zones: [
      {
        id: "image",
        label: "Image",
        role: "primary",
        rank: 1,
        reading_index: 0,
        required: true,
        text_bearing: false,
        area_share: 0.5,
        rect: { x: 0.06, y: 0.06, w: 0.88, h: 0.44 },
        grid_span: { col: 0, row: 0, cols: 6, rows: 4 },
        layer: 0,
        dominance: 0.81,
        within_safe_area: true,
        basis: "derived",
        source: "recipe.hierarchy.levels[image]"
      },
      {
        id: "headline",
        label: "Headline",
        role: "secondary",
        rank: 2,
        reading_index: 1,
        required: true,
        text_bearing: true,
        area_share: 0.18,
        rect: { x: 0.06, y: 0.5, w: 0.88, h: 0.16 },
        grid_span: { col: 0, row: 4, cols: 6, rows: 1 },
        layer: 0,
        dominance: 0.32,
        within_safe_area: true,
        basis: "derived",
        source: "recipe.hierarchy.levels[headline]"
      },
      {
        id: "brand",
        label: "Brand",
        role: "utility",
        rank: 3,
        reading_index: 2,
        required: true,
        text_bearing: false,
        area_share: 0.05,
        rect: { x: 0.06, y: 0.84, w: 0.88, h: 0.06 },
        grid_span: { col: 0, row: 7, cols: 6, rows: 1 },
        layer: 0,
        dominance: 0.1,
        within_safe_area: true,
        basis: "derived",
        source: "recipe.hierarchy.levels[brand]"
      }
    ],
    reading_flow: {
      pattern: "f-pattern",
      path: ["image", "headline", "brand"],
      entry: "image",
      exit: "brand",
      waypoints: [
        { zone: "image", x: 0.5, y: 0.28 },
        { zone: "headline", x: 0.5, y: 0.58 },
        { zone: "brand", x: 0.5, y: 0.87 }
      ],
      basis: "derived",
      source: "recipe.composition.flow + recipe.hierarchy.reading_order"
    },
    focal: {
      zone: "image",
      x: 0.5,
      y: 0.28,
      dominance: 0.81,
      basis: "structural",
      source: "recipe.hierarchy.focal_dominance"
    },
    relationships: [
      {
        kind: "contained_by",
        from: "headline",
        to: "safe_area",
        detail: "The headline sits entirely inside the platform safe area.",
        signal: "geometry: headline.rect within safe_area"
      },
      {
        kind: "precedes",
        from: "image",
        to: "headline",
        detail: "The image is read before the headline.",
        signal: "recipe.hierarchy.reading_order"
      }
    ],
    hierarchy: {
      strength: 0.82,
      focal_dominance: 0.81,
      reading_order: ["image", "headline", "brand"],
      basis: "structural",
      source: "recipe.hierarchy"
    },
    density: {
      visual_density: 0.45,
      whitespace: 0.48,
      basis: "structural",
      source: "recipe.composition"
    },
    constraints: [
      {
        kind: "safe_area",
        statement: "Load-bearing zones stay inside the visual type safe area.",
        source: "visual_type:social-feed"
      }
    ],
    anchors: [
      {
        kind: "primary_visual_direction",
        value: "bauhaus/image-text-split/stacked-vertical",
        source: "recipe.anchors[primary_visual_direction]"
      }
    ],
    rationale: [
      {
        claim: "The image zone carries the dominant focal claim.",
        reason: "It is the priority-1 zone and holds the largest area share.",
        signal: "recipe.hierarchy.focal_dominance=0.81, area_share=0.5",
        basis: ["recipe", "dkv"],
        principle: "Hierarchy before detail."
      }
    ],
    issues: [],
    unassessed: [],
    blueprint_hash: "0f0f0f0f"
  };

  return { ...base, ...overrides };
}
