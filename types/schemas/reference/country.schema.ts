import { z } from "zod";
import { NonEmptyText, Note, Ratio, SemVer, Slug, weightsSumToOne } from "../../primitives";

/**
 * Country Visual DNA.
 *
 * A country is an INFLUENCE LAYER, not a visual template (doctrine §5).
 * Influence is expressed through spatial behaviour, typographic relationships,
 * colour relationships, materiality, rhythm and contemporary visual culture —
 * never through a fixed motif.
 *
 * `avoid_stereotypes` is mandatory and load-bearing: it is both a warning to
 * the author and the banned-token list the prompt compiler will filter against
 * in P3. Tests assert that no declared token appears in any positive field of
 * the same file.
 */

export const CountryDimension = z.enum([
  "composition",
  "typography",
  "color",
  "imagery",
  "materiality",
  "graphic_language"
]);
export type CountryDimension = z.infer<typeof CountryDimension>;

export const CountryWeights = weightsSumToOne(
  z.object({
    composition: Ratio,
    typography: Ratio,
    color: Ratio,
    imagery: Ratio,
    materiality: Ratio,
    graphic_language: Ratio
  })
);
export type CountryWeights = z.infer<typeof CountryWeights>;

export const HistoricalInfluence = z.object({
  period: NonEmptyText,
  influence: NonEmptyText,
  visual_consequence: Note
});

export const AvoidedStereotype = z.object({
  /** Lowercase token the prompt filter will look for. */
  token: z.string().trim().toLowerCase().min(2),
  why: Note,
  instead: Note
});
export type AvoidedStereotype = z.infer<typeof AvoidedStereotype>;

export const CountryStyleVariant = z.object({
  id: Slug,
  name: NonEmptyText,
  description: Note,
  weights_override: CountryWeights.optional(),
  suitable_for: z.array(Slug).min(1)
});

export const CountryDNA = z.object({
  id: Slug,
  name: NonEmptyText,
  schema_version: SemVer,

  visual_traits: z.array(NonEmptyText).min(4).max(12),

  cultural_context: z.object({
    social_values: z.array(NonEmptyText).min(2),
    communication_style: Note,
    spatial_philosophy: Note,
    formality_bias: Ratio,
    collectivism_bias: Ratio
  }),

  historical_influences: z.array(HistoricalInfluence).min(2),

  composition: z.object({
    spatial_behavior: Note,
    density_bias: Ratio,
    whitespace_bias: Ratio,
    symmetry: z.enum(["symmetric", "asymmetric", "mixed"]),
    structure: Note
  }),

  typography: z.object({
    script_systems: z.array(NonEmptyText).min(1),
    relationships: z.array(NonEmptyText).min(2),
    hierarchy_behavior: Note,
    weight_bias: z.enum(["light", "regular", "medium", "bold", "mixed"]),
    notes: Note
  }),

  color: z.object({
    relationships: z.array(NonEmptyText).min(2),
    saturation_bias: Ratio,
    contrast_bias: Ratio,
    palette_logic: Note,
    notes: Note.optional()
  }),

  imagery: z.object({
    subject_treatment: Note,
    framing: Note,
    lighting_bias: Note,
    realism_bias: Ratio
  }),

  materiality: z.object({
    surfaces: z.array(NonEmptyText).min(2),
    texture_bias: Ratio,
    print_traditions: z.array(NonEmptyText).min(1),
    notes: Note
  }),

  graphic_language: z.object({
    shape_logic: Note,
    rhythm: Note,
    ornament_bias: Ratio,
    signage_traditions: z.array(NonEmptyText).min(1)
  }),

  contemporary_traits: z.array(NonEmptyText).min(3),
  style_variants: z.array(CountryStyleVariant).min(2),
  avoid_stereotypes: z.array(AvoidedStereotype).min(5),

  weights: CountryWeights
}).strict();
export type CountryDNA = z.infer<typeof CountryDNA>;
