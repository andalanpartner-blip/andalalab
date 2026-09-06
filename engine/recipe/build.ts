import type { DatasetRegistry } from "../../types/datasets";
import type { DesignContract } from "../../types/schemas/contract.schema";
import type { DesignDirection } from "../../types/schemas/direction.schema";
import type { CreativeConcept } from "../../types/schemas/concept.schema";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import { DesignRecipe as DesignRecipeSchema } from "../../types/schemas/recipe.schema";
import { SCHEMA_VERSIONS } from "../../types/versions";
import { canonicalise, fnv1a } from "../../types/primitives";
import type { DirectionIssue } from "../../domain/errors";
import { directionIssue } from "../../domain/errors";
import { deepFreeze } from "../../domain/contract";
import type { ClockPort } from "../../ports/clock.port";
import type { IdPort } from "../../ports/id.port";

import { err, ok, type Result } from "../util/result";
import { round } from "../dkv/params";
import {
  blendDimensions,
  countryForDimension,
  normaliseBlend,
  type ResolvedCountry
} from "../country/blend";
import { selectedCandidate } from "../decision/resolve";
import { resolveGraphicTreatment } from "../graphic-treatment/resolve";
import { resolvePhotographicCharacter } from "../photographic-character/resolve";
import { lockConceptAnchor, lockDirectionAnchor } from "./anchors";

export type BuildRecipeInput = {
  readonly projectId: string;
  readonly contract: DesignContract;
  readonly direction: DesignDirection;
  readonly datasets: DatasetRegistry;
  readonly clock: ClockPort;
  readonly ids: IdPort;
  readonly createdBy?: string;
  readonly derivedFrom?: string | null;
  /** The selected creative concept (P2.2). Absent until a concept exists. */
  readonly concept?: CreativeConcept | null;
  /**
   * P6 Correction Engine only. Bounded overrides for the four dataset-derived
   * biases, applied BEFORE photographic character / graphic treatment resolve
   * so a correction propagates coherently. Absent for every normal build —
   * omitting it is byte-identical to before P6. Each value must already be a
   * legal `Ratio` (0..1); the correction engine clamps before it gets here.
   */
  readonly overrides?: {
    readonly colorSaturation?: number;
    readonly imageryRealism?: number;
    readonly materialityTexture?: number;
    readonly ornament?: number;
  };
};

/**
 * Build the Design Recipe.
 *
 * The recipe makes no decisions. Every value in it is either copied from the
 * contract, taken from the direction, or lifted verbatim from the dataset
 * entry that owns the relevant dimension. Prose is never composed here — it is
 * quoted — so any sentence in a recipe can be traced back to the country,
 * movement or industry file it came from.
 */
export function buildDesignRecipe(
  input: BuildRecipeInput
): Result<DesignRecipe, DirectionIssue[]> {
  const { contract, direction, datasets } = input;

  if (direction.contract_id !== contract.id) {
    return err([
      directionIssue(
        "recipe_invalid",
        "direction.contract_id",
        `direction ${direction.id} was built for contract ${direction.contract_id}, not ${contract.id}`
      )
    ]);
  }

  // A concept must belong to the direction — UNLESS this is a P6 correction
  // rebuild (`derivedFrom` set). A DKV correction re-runs `buildDesignDirection`
  // on the same candidate with a re-tuned band, producing a fresh direction id;
  // the movement, layout and composition are provably unchanged (the Correction
  // Engine's redesign guard enforces that on the result), so the concept — an
  // idea, not a set of numbers — is still valid.
  if (input.concept && input.concept.direction_id !== direction.id && !input.derivedFrom) {
    return err([
      directionIssue(
        "recipe_invalid",
        "concept.direction_id",
        `concept ${input.concept.id} was generated for direction ${input.concept.direction_id}, not ${direction.id}`
      )
    ]);
  }

  const chosen = selectedCandidate(direction).candidate;
  const movement = datasets.movements.get(chosen.movement_id);
  const layout = datasets.layouts.get(chosen.layout_id);
  const industry = datasets.industries.get(contract.industry.id);
  const visualType = datasets.visualTypes.get(contract.visual_type.id);
  if (!movement || !layout || !industry || !visualType) {
    return err([
      directionIssue(
        "missing_reference",
        "candidate",
        `selected candidate references movement "${chosen.movement_id}", layout "${chosen.layout_id}", industry "${contract.industry.id}" or visual type "${contract.visual_type.id}" which is not in dataset ${datasets.version}`
      )
    ]);
  }

  const blend = normaliseBlend(contract.country);
  const countries: ResolvedCountry[] = Object.entries(blend)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([id, weight]) => {
      const country = datasets.countries.get(id);
      return country ? [{ country, weight }] : [];
    });

  const owners = blendDimensions(countries);
  const pick = (dimension: Parameters<typeof countryForDimension>[2]) =>
    countryForDimension(countries, owners, dimension);

  const compositionCountry = pick("composition");
  const typographyCountry = pick("typography");
  const colorCountry = pick("color");
  const imageryCountry = pick("imagery");
  const materialityCountry = pick("materiality");
  const graphicCountry = pick("graphic_language");

  const dkv = direction.dkv_targets;
  const zones = [...layout.zones].sort((a, b) => a.priority - b.priority);
  const ov = input.overrides;
  const ornament = ov?.ornament ?? (graphicCountry?.graphic_language.ornament_bias ?? 0.3);
  const hasDenseBodyCopy = layout.zones.some((zone) => zone.id === "body" && zone.required);

  // Already-blended imagery / colour / materiality values. Extracted once so the
  // recipe body and the Photographic Character layer read the exact same numbers.
  // A P6 correction may override any of the four biases below.
  const imageryRealism = ov?.imageryRealism ?? (imageryCountry?.imagery.realism_bias ?? 0.7);
  const imageryFraming = imageryCountry?.imagery.framing ?? movement.imagery;
  const lightingDirection = imageryCountry?.imagery.lighting_bias ?? movement.imagery;
  const colorSaturation = ov?.colorSaturation ?? (colorCountry?.color.saturation_bias ?? movement.color.saturation_bias);
  const materialityTexture = ov?.materialityTexture ?? (materialityCountry?.materiality.texture_bias ?? 0.4);
  const materialitySurfaces = materialityCountry?.materiality.surfaces ?? [movement.materiality];

  /** " + correction" on a `source` string when a P6 override touched that spec. */
  const corr = (base: string, touched: boolean): string => (touched ? `${base} + correction` : base);

  const graphicTreatment = resolveGraphicTreatment({
    objective: contract.objective,
    audience: contract.audience,
    industry,
    movement,
    layout,
    dkv,
    ornament,
    hasDenseBodyCopy,
    bannedTokens: contract.banned_tokens,
    concept: input.concept ?? null
  });

  const photographicCharacter = resolvePhotographicCharacter({
    objective: contract.objective,
    audience: contract.audience,
    industry,
    visualType,
    movement,
    imageryRealism,
    framing: imageryFraming,
    lightingContrast: dkv.contrast,
    lightingDirectionText: lightingDirection,
    colorStrategy: chosen.color_strategy,
    colorSaturation,
    colorContrast: dkv.contrast,
    colorComplexity: dkv.color_complexity,
    materialityTexture,
    materialitySurfaces,
    compositionStrategy: chosen.composition_strategy,
    graphicTreatmentIntensity: graphicTreatment.intensity,
    dkv,
    bannedTokens: contract.banned_tokens,
    concept: input.concept ?? null
  });

  const body = {
    project_id: input.projectId,
    schema_version: SCHEMA_VERSIONS.recipe,
    dataset_version: datasets.version,
    created_by: input.createdBy ?? "system",
    contract_id: contract.id,
    direction_id: direction.id,
    derived_from: input.derivedFrom ?? null,
    concept_ref: input.concept?.id ?? contract.concept_id,

    objective: contract.objective,
    core_message: contract.core_message,

    composition: {
      strategy: chosen.composition_strategy,
      spatial_behavior:
        compositionCountry?.composition.spatial_behavior ?? movement.composition,
      balance: compositionCountry?.composition.symmetry ?? "mixed",
      flow: layout.flow,
      density: dkv.visual_density,
      whitespace: dkv.whitespace,
      source: `country:${compositionCountry?.id ?? "none"} + layout:${layout.id}`
    },

    grid: {
      columns: layout.grid.columns,
      rows: layout.grid.rows,
      gutter_ratio: layout.grid.gutter_ratio,
      margin_ratio: layout.grid.margin_ratio,
      modularity: movement.grid.modularity,
      source: `layout:${layout.id} + movement:${movement.id}`
    },

    hierarchy: {
      levels: zones.map((zone) => ({
        zone: zone.id,
        priority: zone.priority,
        area_share: zone.area_share,
        required: zone.required
      })),
      strength: dkv.hierarchy_strength,
      focal_dominance: dkv.focal_dominance,
      reading_order: zones.map((zone) => zone.id)
    },

    typography: {
      strategy: chosen.typography_strategy,
      scale_ratio: dkv.typographic_scale_ratio,
      case_bias: movement.typography.case_bias,
      weight_bias: movement.typography.weight_bias,
      primary: contract.brand?.typography.primary ?? movement.typography.logic.slice(0, 60),
      secondary: contract.brand?.typography.secondary ?? null,
      hierarchy_behavior:
        typographyCountry?.typography.hierarchy_behavior ?? movement.typography.logic,
      brand_locked: contract.brand !== null,
      source: `country:${typographyCountry?.id ?? "none"} + movement:${movement.id}`
    },

    color: {
      strategy: chosen.color_strategy,
      palette_size: movement.color.palette_size,
      saturation: colorSaturation,
      contrast: dkv.contrast,
      complexity: dkv.color_complexity,
      relationships: colorCountry?.color.relationships ?? [movement.color.logic],
      brand_locked: contract.brand !== null,
      brand_palette:
        contract.brand?.palette.map((entry) => ({
          role: entry.role,
          hex: entry.hex,
          name: entry.name
        })) ?? [],
      source: corr(`country:${colorCountry?.id ?? "none"} + movement:${movement.id}`, ov?.colorSaturation !== undefined)
    },

    imagery: {
      subject_treatment: imageryCountry?.imagery.subject_treatment ?? movement.imagery,
      framing: imageryFraming,
      realism: imageryRealism,
      source: corr(`country:${imageryCountry?.id ?? "none"}`, ov?.imageryRealism !== undefined)
    },

    lighting: {
      direction: lightingDirection,
      contrast: dkv.contrast,
      source: `country:${imageryCountry?.id ?? "none"} lighting bias`
    },

    materiality: {
      surfaces: materialitySurfaces,
      texture: materialityTexture,
      source: corr(`country:${materialityCountry?.id ?? "none"}`, ov?.materialityTexture !== undefined)
    },

    graphic_language: {
      shape_logic: graphicCountry?.graphic_language.shape_logic ?? movement.shape_language,
      rhythm: graphicCountry?.graphic_language.rhythm ?? movement.composition,
      ornament,
      source: corr(`country:${graphicCountry?.id ?? "none"} + movement:${movement.id}`, ov?.ornament !== undefined)
    },

    dkv,
    graphic_treatment: graphicTreatment,
    photographic_character: photographicCharacter,

    culture: {
      blend,
      dimensions: owners,
      banned_tokens: contract.banned_tokens
    },

    movement: {
      id: movement.id,
      name: movement.name,
      // How much of the movement survived doctrine resolution.
      influence: round(
        1 -
          direction.resolutions.filter((resolution) => resolution.loser === "design_movement")
            .length /
            Math.max(1, direction.derivations.length)
      ),
      core_principles: movement.core_principles,
      anti_stereotype: movement.anti_stereotype
    },

    platform: contract.platform,
    constraints: contract.constraints,
    anchors: input.concept
      ? lockConceptAnchor(
          lockDirectionAnchor(
            contract.anchors,
            `${chosen.movement_id}/${chosen.layout_id}/${chosen.composition_strategy}`
          ),
          input.concept.id,
          input.concept.concept_hash
        )
      : lockDirectionAnchor(
          contract.anchors,
          `${chosen.movement_id}/${chosen.layout_id}/${chosen.composition_strategy}`
        )
  };

  const recipe = {
    ...body,
    id: input.ids.next("recipe"),
    created_at: input.clock.now().toISOString(),
    recipe_hash: fnv1a(canonicalise(body))
  };

  const validated = DesignRecipeSchema.safeParse(recipe);
  if (!validated.success) {
    return err(
      validated.error.issues.map((problem) =>
        directionIssue("recipe_invalid", problem.path.join(".") || "(root)", problem.message)
      )
    );
  }

  return ok(deepFreeze(validated.data));
}
