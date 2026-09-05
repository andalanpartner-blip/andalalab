import type { CreativeConcept } from "../../types/schemas/concept.schema";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { SelectedGraphicDevice } from "../../types/schemas/graphic-treatment.schema";
import { resolveTextMode } from "./text-mode";
import { excludeUnsupportedConcepts } from "./unsupported-concepts";
import { resolveVisualAdapter } from "./visual-adapter/resolve";
import { VISUAL_ADAPTERS } from "./visual-adapter/data";
import type { VisualAdapterId } from "./visual-adapter/types";
import {
  NEGATIVE_BASELINE_KEYS,
  QUALITY_REQUIREMENT_KEYS,
  type ConstraintInfo,
  type GraphicDeviceBlockEntry,
  type PromptBlocks,
  type TextMode
} from "./types";

export type BuildPromptBlocksInput = {
  readonly recipe: DesignRecipe;
  readonly concept?: CreativeConcept | null;
  readonly textMode?: TextMode | null;
  readonly visualAdapter?: VisualAdapterId | null;
};

function toGraphicDeviceEntry(device: SelectedGraphicDevice): GraphicDeviceBlockEntry {
  return {
    id: device.id,
    name: device.name,
    category: device.category,
    purpose: device.purpose,
    promptEn: device.prompt_en,
    promptId: device.prompt_id
  };
}

function toConstraintInfo(constraint: DesignRecipe["constraints"][number]): ConstraintInfo {
  return {
    id: constraint.id,
    source: constraint.source,
    kind: constraint.kind,
    statement: constraint.statement,
    doctrineRank: constraint.doctrine_rank
  };
}

/**
 * Lift the Design Recipe (and, when present, the Creative Concept) into the
 * language-neutral structure every renderer reads from. Every field here is
 * copied or trivially reshaped from an existing decision — nothing is
 * computed, scored or invented.
 */
export function buildPromptBlocks(input: BuildPromptBlocksInput): PromptBlocks {
  const { recipe } = input;
  const concept = input.concept ?? null;
  const textMode = resolveTextMode(recipe, input.textMode ?? null);

  const resolvedAdapter = resolveVisualAdapter({
    photographicStyle: recipe.photographic_character.photographic_style,
    realismTarget: recipe.photographic_character.realism_target,
    abstractionLevel: concept?.proposal.abstraction_level ?? null
  });
  const visualAdapterId: VisualAdapterId = input.visualAdapter ?? resolvedAdapter.adapterId;
  const visualAdapterRationale =
    input.visualAdapter && input.visualAdapter !== resolvedAdapter.adapterId
      ? `Adapter overridden by caller to ${input.visualAdapter} (recipe would resolve to ${resolvedAdapter.adapterId}).`
      : resolvedAdapter.rationale;

  const constraints = excludeUnsupportedConcepts(recipe.constraints.map(toConstraintInfo));
  const bySource = (source: string) => constraints.filter((c) => c.source === source);

  const dimensions = Object.entries(recipe.culture.dimensions)
    .map(([dimension, owner]) => ({
      dimension,
      countryId: owner.country_id,
      countryName: owner.country_name,
      influence: owner.influence,
      contested: owner.contested
    }))
    .sort((a, b) => a.dimension.localeCompare(b.dimension));

  return {
    textMode,

    format: {
      channel: recipe.platform.channel,
      aspectRatioId: recipe.platform.aspect_ratio_id,
      viewingContext: recipe.platform.viewing_context
    },

    objective: {
      objective: recipe.objective,
      coreMessage: recipe.core_message
    },

    concept: concept
      ? {
          name: concept.proposal.name,
          bigIdea: concept.proposal.big_idea,
          visualMetaphor: concept.proposal.visual_metaphor,
          creativeTension: concept.proposal.creative_tension,
          why: concept.proposal.why,
          visualWorld: concept.proposal.visual_world,
          emotionalDirection: concept.proposal.emotional_direction,
          subjectStrategy: concept.proposal.subject_strategy,
          humanPresence: concept.proposal.human_presence,
          abstractionLevel: concept.proposal.abstraction_level
        }
      : null,

    composition: {
      strategy: recipe.composition.strategy,
      balance: recipe.composition.balance,
      flow: recipe.composition.flow,
      spatialBehavior: recipe.composition.spatial_behavior,
      density: recipe.composition.density,
      whitespace: recipe.composition.whitespace,
      grid: {
        columns: recipe.grid.columns,
        rows: recipe.grid.rows,
        gutterRatio: recipe.grid.gutter_ratio,
        marginRatio: recipe.grid.margin_ratio,
        modularity: recipe.grid.modularity
      }
    },

    hierarchy: {
      levels: recipe.hierarchy.levels.map((level) => ({
        zone: level.zone,
        priority: level.priority,
        areaShare: level.area_share,
        required: level.required
      })),
      strength: recipe.hierarchy.strength,
      focalDominance: recipe.hierarchy.focal_dominance,
      readingOrder: recipe.hierarchy.reading_order
    },

    subject: {
      treatment: recipe.imagery.subject_treatment,
      strategy: concept?.proposal.subject_strategy ?? null,
      humanPresence: concept?.proposal.human_presence ?? null
    },

    environment: {
      framing: recipe.imagery.framing,
      visualWorld: concept?.proposal.visual_world ?? null
    },

    camera: {
      realism: recipe.imagery.realism
    },

    lighting: {
      direction: recipe.lighting.direction,
      contrast: recipe.lighting.contrast
    },

    color: {
      strategy: recipe.color.strategy,
      paletteSize: recipe.color.palette_size,
      saturation: recipe.color.saturation,
      contrast: recipe.color.contrast,
      complexity: recipe.color.complexity,
      relationships: recipe.color.relationships,
      brandLocked: recipe.color.brand_locked,
      brandPalette: recipe.color.brand_palette
    },

    materiality: {
      surfaces: recipe.materiality.surfaces,
      texture: recipe.materiality.texture
    },

    typography: {
      strategy: recipe.typography.strategy,
      scaleRatio: recipe.typography.scale_ratio,
      caseBias: recipe.typography.case_bias,
      weightBias: recipe.typography.weight_bias,
      primary: recipe.typography.primary,
      secondary: recipe.typography.secondary,
      hierarchyBehavior: recipe.typography.hierarchy_behavior,
      brandLocked: recipe.typography.brand_locked,
      textMode
    },

    graphicElements: {
      shapeLogic: recipe.graphic_language.shape_logic,
      rhythm: recipe.graphic_language.rhythm,
      ornament: recipe.graphic_language.ornament
    },

    graphicTreatment: {
      intensity: recipe.graphic_treatment.intensity,
      structuralDevices: recipe.graphic_treatment.structural_devices.map(toGraphicDeviceEntry),
      expressiveDevices: recipe.graphic_treatment.expressive_devices.map(toGraphicDeviceEntry),
      imageTreatments: recipe.graphic_treatment.image_treatments.map(toGraphicDeviceEntry),
      typographyTreatments: recipe.graphic_treatment.typography_treatments.map(toGraphicDeviceEntry),
      textures: recipe.graphic_treatment.textures.map(toGraphicDeviceEntry),
      patterns: recipe.graphic_treatment.patterns.map(toGraphicDeviceEntry),
      layering: recipe.graphic_treatment.layering.map(toGraphicDeviceEntry),
      accents: recipe.graphic_treatment.accents.map(toGraphicDeviceEntry)
    },

    photographicCharacter: {
      style: recipe.photographic_character.photographic_style,
      realismTarget: recipe.photographic_character.realism_target,
      cameraLanguage: recipe.photographic_character.camera_language,
      lensCharacter: recipe.photographic_character.lens_character,
      depthOfField: recipe.photographic_character.depth_of_field,
      focusBehavior: recipe.photographic_character.focus_behavior,
      perspectiveBehavior: recipe.photographic_character.perspective_behavior,
      lightingBehavior: recipe.photographic_character.lighting_behavior,
      lightDirection: recipe.photographic_character.light_direction,
      highlightRolloff: recipe.photographic_character.highlight_rolloff,
      shadowBehavior: recipe.photographic_character.shadow_behavior,
      colorResponse: recipe.photographic_character.color_response,
      whiteBalance: recipe.photographic_character.white_balance,
      dynamicRange: recipe.photographic_character.dynamic_range,
      skinRealism: recipe.photographic_character.skin_realism,
      faceRealism: recipe.photographic_character.face_realism,
      hairRealism: recipe.photographic_character.hair_realism,
      handRealism: recipe.photographic_character.hand_realism,
      fabricRealism: recipe.photographic_character.fabric_realism,
      materialRealism: recipe.photographic_character.material_realism,
      environmentalRealism: recipe.photographic_character.environmental_realism,
      textureCharacter: recipe.photographic_character.texture_character,
      motionRealism: recipe.photographic_character.motion_realism,
      imperfectionLevel: recipe.photographic_character.imperfection_level,
      artificialityRisk: {
        score: recipe.photographic_character.artificiality_risk.score,
        band: recipe.photographic_character.artificiality_risk.band,
        factors: recipe.photographic_character.artificiality_risk.factors
      },
      constraints: recipe.photographic_character.constraints.map((c) => ({
        kind: c.kind,
        statement: c.statement
      })),
      finish: {
        isPhotographic: recipe.photographic_character.finish.is_photographic,
        style: recipe.photographic_character.finish.style.value,
        colorCharacter: recipe.photographic_character.finish.color_character.value,
        lightingCharacter: recipe.photographic_character.finish.lighting_character?.value ?? null,
        artificiality: {
          level: recipe.photographic_character.finish.artificiality.value,
          score: recipe.photographic_character.finish.artificiality.score,
          band: recipe.photographic_character.finish.artificiality.band
        },
        colorVocabulary: {
          whiteBalance: recipe.photographic_character.finish.color_vocabulary.white_balance,
          saturationRestraint: recipe.photographic_character.finish.color_vocabulary.saturation_restraint,
          contrastCharacter: recipe.photographic_character.finish.color_vocabulary.contrast_character,
          highlightRolloff: recipe.photographic_character.finish.color_vocabulary.highlight_rolloff,
          shadowDensity: recipe.photographic_character.finish.color_vocabulary.shadow_density,
          colorSeparation: recipe.photographic_character.finish.color_vocabulary.color_separation
        },
        realismNotes: recipe.photographic_character.finish.realism_notes
      }
    },

    visualGeneration: {
      adapterId: visualAdapterId,
      realismTarget: recipe.photographic_character.realism_target,
      rationale: visualAdapterRationale,
      sourceSignals: resolvedAdapter.sourceSignals,
      rendering: VISUAL_ADAPTERS[visualAdapterId]
    },

    culture: {
      dimensions,
      movementId: recipe.movement.id,
      movementName: recipe.movement.name,
      movementInfluence: recipe.movement.influence,
      corePrinciples: recipe.movement.core_principles,
      antiStereotype: recipe.movement.anti_stereotype,
      bannedTokens: recipe.culture.banned_tokens
    },

    industry: {
      constraints: bySource("industry")
    },

    brand: {
      present: recipe.color.brand_locked,
      primaryFont: recipe.typography.primary,
      secondaryFont: recipe.typography.secondary,
      palette: recipe.color.brand_palette,
      constraints: bySource("brand")
    },

    platform: {
      channel: recipe.platform.channel,
      aspectRatioId: recipe.platform.aspect_ratio_id,
      viewingContext: recipe.platform.viewing_context,
      localisedText: recipe.platform.localised_text,
      constraints: bySource("platform")
    },

    quality: {
      requirements: QUALITY_REQUIREMENT_KEYS
    },

    constraints: {
      must: constraints.filter((c) => c.kind === "must"),
      mustNot: constraints.filter((c) => c.kind === "must_not"),
      prefer: constraints.filter((c) => c.kind === "prefer"),
      avoid: constraints.filter((c) => c.kind === "avoid"),
      negativeBaseline: NEGATIVE_BASELINE_KEYS
    }
  };
}
