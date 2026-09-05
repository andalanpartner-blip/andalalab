import { z } from "zod";
import { DatasetVersion, Id, IsoDate, NonEmptyText, Note, Ratio, SemVer, Slug } from "../primitives";
import { DkvParams } from "./dkv.schema";
import { Constraint, ImmutableAnchor } from "./contract.schema";
import { PlatformSpec } from "./brief.schema";
import { CountryDimension } from "./reference/country.schema";
import { ColorStrategy, CompositionStrategy, TypographyStrategy } from "./direction.schema";
import { GraphicTreatmentSpec } from "./graphic-treatment.schema";
import { PhotographicCharacterSpec } from "./photographic-character.schema";
import { PhotographicFinishSpec } from "./photographic-finish.schema";

/**
 * The Design Recipe — the single source of truth before prompt generation.
 *
 * It is assembled deterministically from the Design Contract and the Design
 * Direction. Every prose field is lifted verbatim from a dataset entry rather
 * than composed, so the recipe stays traceable: any sentence in it can be
 * pointed back at the country, movement or industry file that produced it.
 */

export const CompositionSpec = z.object({
  strategy: CompositionStrategy,
  spatial_behavior: Note,
  balance: z.enum(["symmetric", "asymmetric", "mixed"]),
  flow: z.enum(["z-pattern", "f-pattern", "centre-out", "top-down", "diagonal"]),
  density: Ratio,
  whitespace: Ratio,
  source: NonEmptyText
});

export const GridSpec = z.object({
  columns: z.number().int().min(1).max(24),
  rows: z.number().int().min(1).max(24),
  gutter_ratio: Ratio,
  margin_ratio: Ratio,
  modularity: Ratio,
  source: NonEmptyText
});

export const HierarchyLevel = z.object({
  zone: NonEmptyText,
  priority: z.number().int().min(1).max(11),
  area_share: Ratio,
  required: z.boolean()
});

export const HierarchySpec = z.object({
  levels: z.array(HierarchyLevel).min(2),
  strength: Ratio,
  focal_dominance: Ratio,
  reading_order: z.array(NonEmptyText).min(2)
});

export const TypographySpec = z.object({
  strategy: TypographyStrategy,
  scale_ratio: z.number().min(1).max(4),
  case_bias: z.enum(["lower", "sentence", "title", "upper", "mixed"]),
  weight_bias: z.enum(["light", "regular", "medium", "bold", "mixed"]),
  primary: NonEmptyText,
  secondary: NonEmptyText.nullable(),
  hierarchy_behavior: Note,
  brand_locked: z.boolean(),
  source: NonEmptyText
});

export const ColorSpec = z.object({
  strategy: ColorStrategy,
  palette_size: z.number().int().min(1).max(12),
  saturation: Ratio,
  contrast: Ratio,
  complexity: Ratio,
  relationships: z.array(NonEmptyText).min(1),
  brand_locked: z.boolean(),
  brand_palette: z.array(z.object({ role: NonEmptyText, hex: NonEmptyText, name: NonEmptyText })),
  source: NonEmptyText
});

export const ImagerySpec = z.object({
  subject_treatment: Note,
  framing: Note,
  realism: Ratio,
  source: NonEmptyText
});

export const LightingSpec = z.object({
  direction: Note,
  contrast: Ratio,
  source: NonEmptyText
});

export const MaterialitySpec = z.object({
  surfaces: z.array(NonEmptyText).min(1),
  texture: Ratio,
  source: NonEmptyText
});

export const GraphicLanguageSpec = z.object({
  shape_logic: Note,
  rhythm: Note,
  ornament: Ratio,
  source: NonEmptyText
});

/**
 * Dimension-aware culture blending (P1 spec §7).
 *
 * Each of the six dimensions is ASSIGNED to a dominant country rather than
 * averaged across all of them. 70/30 of two spatial philosophies is not a
 * philosophy; it is mush. Averaging survives only for the scalar biases.
 */
export const CultureSpec = z.object({
  blend: z.record(Slug, Ratio),
  dimensions: z.record(
    CountryDimension,
    z.object({
      country_id: Slug,
      country_name: NonEmptyText,
      /** blend weight × that country's own weight for this dimension */
      influence: z.number().min(0).max(1),
      contested: z.boolean()
    })
  ),
  banned_tokens: z.array(z.string())
});

export const MovementSpec = z.object({
  id: Slug,
  name: NonEmptyText,
  influence: Ratio,
  core_principles: z.array(NonEmptyText).min(3),
  anti_stereotype: z.array(Note).min(2)
});

export const DesignRecipe = z.object({
  id: Id,
  project_id: Id,
  schema_version: SemVer,
  dataset_version: DatasetVersion,
  created_at: IsoDate,
  created_by: z.string().min(1),

  contract_id: Id,
  direction_id: Id,
  /** Parent recipe for campaign assets and correction patches. */
  derived_from: Id.nullable(),
  concept_ref: Id.nullable(),

  objective: NonEmptyText,
  core_message: Note,

  composition: CompositionSpec,
  grid: GridSpec,
  hierarchy: HierarchySpec,
  typography: TypographySpec,
  color: ColorSpec,
  imagery: ImagerySpec,
  lighting: LightingSpec,
  materiality: MaterialitySpec,
  graphic_language: GraphicLanguageSpec,

  dkv: DkvParams,
  culture: CultureSpec,
  movement: MovementSpec,
  platform: PlatformSpec,
  graphic_treatment: GraphicTreatmentSpec,
  /**
   * P2.6 optical/material character + the additive P2.9 `finish` layer (named
   * style / colour / lighting / artificiality tokens with per-field
   * traceability). The base spec is composed here rather than in
   * photographic-character.schema.ts so the two schema files stay acyclic.
   */
  photographic_character: PhotographicCharacterSpec.extend({
    finish: PhotographicFinishSpec
  }),

  constraints: z.array(Constraint),
  anchors: z.array(ImmutableAnchor).min(3),
  recipe_hash: z.string().length(8)
});
export type DesignRecipe = z.infer<typeof DesignRecipe>;
export type CompositionSpec = z.infer<typeof CompositionSpec>;
export type ColorSpec = z.infer<typeof ColorSpec>;
export type CultureSpec = z.infer<typeof CultureSpec>;
