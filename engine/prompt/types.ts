import type { CreativeConcept } from "../../types/schemas/concept.schema";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { VisualAdapterId, VisualAdapterVocabulary } from "./visual-adapter/types";

/**
 * The Prompt Compiler.
 *
 * Translates an already-decided DesignRecipe (and, when present, the
 * CreativeConcept it was built from) into natural-language instructions for an
 * external image generator. It makes no design decisions of its own — every
 * value rendered here already exists on the recipe or concept.
 */

export type PromptLanguage = "en" | "id";

/**
 * `text_render_risk` on a Visual Type (types/schemas/reference/visual-type.schema.ts)
 * marks this as a later-phase concern; the Design Recipe does not yet carry a
 * visual-type reference, so the compiler derives a mode from the recipe itself
 * (see text-mode.ts) unless a caller supplies one explicitly.
 */
export const TEXT_MODES = ["TEXT_CRITICAL", "LAYOUT_ONLY"] as const;
export type TextMode = (typeof TEXT_MODES)[number];

export type ConstraintKind = "must" | "must_not" | "prefer" | "avoid";

export type ConstraintInfo = {
  readonly id: string;
  readonly source: string;
  readonly kind: ConstraintKind;
  readonly statement: string;
  readonly doctrineRank: number;
};

export type FormatBlock = {
  readonly channel: string;
  readonly aspectRatioId: string;
  readonly viewingContext: string;
};

export type ObjectiveBlock = {
  readonly objective: string;
  readonly coreMessage: string;
};

export type ConceptBlock = {
  readonly name: string;
  readonly bigIdea: string;
  readonly visualMetaphor: string;
  readonly creativeTension: string;
  readonly why: string;
  readonly visualWorld: string;
  readonly emotionalDirection: string;
  readonly subjectStrategy: string;
  readonly humanPresence: string;
  readonly abstractionLevel: string;
} | null;

export type GridInfo = {
  readonly columns: number;
  readonly rows: number;
  readonly gutterRatio: number;
  readonly marginRatio: number;
  readonly modularity: number;
};

export type CompositionBlock = {
  readonly strategy: string;
  readonly balance: string;
  readonly flow: string;
  readonly spatialBehavior: string;
  readonly density: number;
  readonly whitespace: number;
  readonly grid: GridInfo;
};

export type HierarchyLevelInfo = {
  readonly zone: string;
  readonly priority: number;
  readonly areaShare: number;
  readonly required: boolean;
};

export type HierarchyBlock = {
  readonly levels: readonly HierarchyLevelInfo[];
  readonly strength: number;
  readonly focalDominance: number;
  readonly readingOrder: readonly string[];
};

export type SubjectBlock = {
  readonly treatment: string;
  readonly strategy: string | null;
  readonly humanPresence: string | null;
};

export type EnvironmentBlock = {
  readonly framing: string;
  readonly visualWorld: string | null;
};

export type CameraBlock = {
  readonly realism: number;
};

export type LightingBlock = {
  readonly direction: string;
  readonly contrast: number;
};

export type PaletteEntry = { readonly role: string; readonly hex: string; readonly name: string };

export type ColorBlock = {
  readonly strategy: string;
  readonly paletteSize: number;
  readonly saturation: number;
  readonly contrast: number;
  readonly complexity: number;
  readonly relationships: readonly string[];
  readonly brandLocked: boolean;
  readonly brandPalette: readonly PaletteEntry[];
};

export type MaterialityBlock = {
  readonly surfaces: readonly string[];
  readonly texture: number;
};

export type TypographyBlock = {
  readonly strategy: string;
  readonly scaleRatio: number;
  readonly caseBias: string;
  readonly weightBias: string;
  readonly primary: string;
  readonly secondary: string | null;
  readonly hierarchyBehavior: string;
  readonly brandLocked: boolean;
  readonly textMode: TextMode;
};

export type GraphicElementsBlock = {
  readonly shapeLogic: string;
  readonly rhythm: string;
  readonly ornament: number;
};

export type DimensionOwnerInfo = {
  readonly dimension: string;
  readonly countryId: string;
  readonly countryName: string;
  readonly influence: number;
  readonly contested: boolean;
};

export type CultureBlock = {
  readonly dimensions: readonly DimensionOwnerInfo[];
  readonly movementId: string;
  readonly movementName: string;
  readonly movementInfluence: number;
  readonly corePrinciples: readonly string[];
  readonly antiStereotype: readonly string[];
  readonly bannedTokens: readonly string[];
};

export type IndustryBlock = {
  readonly constraints: readonly ConstraintInfo[];
};

/**
 * One selected graphic device, carried bilingually so either renderer can
 * pick its own language without recomputing the device taxonomy
 * (engine/graphic-treatment/data.ts never runs again downstream of the recipe).
 */
export type GraphicDeviceBlockEntry = {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly purpose: readonly string[];
  readonly promptEn: string;
  readonly promptId: string;
};

export type GraphicTreatmentBlock = {
  readonly intensity: string;
  readonly structuralDevices: readonly GraphicDeviceBlockEntry[];
  readonly expressiveDevices: readonly GraphicDeviceBlockEntry[];
  readonly imageTreatments: readonly GraphicDeviceBlockEntry[];
  readonly typographyTreatments: readonly GraphicDeviceBlockEntry[];
  readonly textures: readonly GraphicDeviceBlockEntry[];
  readonly patterns: readonly GraphicDeviceBlockEntry[];
  readonly layering: readonly GraphicDeviceBlockEntry[];
  readonly accents: readonly GraphicDeviceBlockEntry[];
};

/**
 * The Photographic Character layer (P2.6), lifted verbatim from
 * recipe.photographic_character. Every value is an already-resolved enum id;
 * the renderers translate it per language. Nothing here is recomputed.
 */
export type PhotographicCharacterBlock = {
  readonly style: string;
  readonly realismTarget: string;
  readonly cameraLanguage: string;
  readonly lensCharacter: string;
  readonly depthOfField: string;
  readonly focusBehavior: string;
  readonly perspectiveBehavior: string;
  readonly lightingBehavior: string;
  readonly lightDirection: string;
  readonly highlightRolloff: string;
  readonly shadowBehavior: string;
  readonly colorResponse: string;
  readonly whiteBalance: string;
  readonly dynamicRange: string;
  readonly skinRealism: string;
  readonly faceRealism: string;
  readonly hairRealism: string;
  readonly handRealism: string;
  readonly fabricRealism: string;
  readonly materialRealism: string;
  readonly environmentalRealism: string;
  readonly textureCharacter: string;
  readonly motionRealism: string;
  readonly imperfectionLevel: string;
  readonly artificialityRisk: {
    readonly score: number;
    readonly band: string;
    readonly factors: readonly string[];
  };
  readonly constraints: readonly { readonly kind: string; readonly statement: string }[];
  /** The additive P2.9 Photographic Finish layer, lifted from recipe.photographic_character.finish. */
  readonly finish: PhotographicFinishBlock;
};

/**
 * The Photographic Finish layer (P2.9), lifted verbatim from
 * recipe.photographic_character.finish. Named style / colour / lighting /
 * artificiality tokens; the renderers translate them per language. For a
 * non-photographic medium `isPhotographic` is false, `lightingCharacter` is
 * null and `realismNotes` is empty.
 */
export type PhotographicFinishBlock = {
  readonly isPhotographic: boolean;
  readonly style: string;
  readonly colorCharacter: string;
  readonly lightingCharacter: string | null;
  readonly artificiality: {
    readonly level: string;
    readonly score: number;
    readonly band: string;
  };
  readonly colorVocabulary: {
    readonly whiteBalance: string;
    readonly saturationRestraint: string;
    readonly contrastCharacter: string;
    readonly highlightRolloff: string;
    readonly shadowDensity: string;
    readonly colorSeparation: string;
  };
  readonly realismNotes: readonly string[];
};

/**
 * The Visual Generation Adapter layer (P2.7).
 *
 * Language-neutral: `rendering` carries every phrasing bilingually, so each
 * renderer picks its own language without re-resolving the adapter. The raw
 * `adapterId` is metadata only — it is NEVER rendered into a human-facing
 * prompt. `realismTarget` is copied from `recipe.photographic_character` for
 * the UI metadata line only.
 */
export type VisualGenerationBlock = {
  readonly adapterId: VisualAdapterId;
  readonly realismTarget: string;
  readonly rationale: string;
  readonly sourceSignals: readonly string[];
  readonly rendering: VisualAdapterVocabulary;
};

export type BrandBlock = {
  readonly present: boolean;
  readonly primaryFont: string;
  readonly secondaryFont: string | null;
  readonly palette: readonly PaletteEntry[];
  readonly constraints: readonly ConstraintInfo[];
};

export type PlatformBlock = {
  readonly channel: string;
  readonly aspectRatioId: string;
  readonly viewingContext: string;
  readonly localisedText: boolean;
  readonly constraints: readonly ConstraintInfo[];
};

/** Fixed, universal keys — rendered per language, never invented per recipe. */
export const QUALITY_REQUIREMENT_KEYS = [
  "production_value",
  "hierarchy_clarity",
  "single_composition",
  "resolution_ready"
] as const;
export type QualityRequirementKey = (typeof QUALITY_REQUIREMENT_KEYS)[number];

export type QualityBlock = {
  readonly requirements: readonly QualityRequirementKey[];
};

/** Fixed, universal negatives — rendered per language, never invented per recipe. */
export const NEGATIVE_BASELINE_KEYS = [
  "generic_stock_photo",
  "clutter",
  "weak_hierarchy",
  "excessive_decoration",
  "wrong_aspect_ratio",
  "unwanted_visual_movement",
  "inconsistent_lighting",
  "excessive_visual_density"
] as const;
export type NegativeBaselineKey = (typeof NEGATIVE_BASELINE_KEYS)[number];

export type ConstraintsBlock = {
  readonly must: readonly ConstraintInfo[];
  readonly mustNot: readonly ConstraintInfo[];
  readonly prefer: readonly ConstraintInfo[];
  readonly avoid: readonly ConstraintInfo[];
  readonly negativeBaseline: readonly NegativeBaselineKey[];
};

/**
 * Language-neutral structured source of truth. Every renderer (one per
 * PromptLanguage) reads only from this shape — never from the recipe or
 * concept directly — so adding a language never touches extraction logic.
 */
export type PromptBlocks = {
  readonly textMode: TextMode;
  readonly format: FormatBlock;
  readonly objective: ObjectiveBlock;
  readonly concept: ConceptBlock;
  readonly composition: CompositionBlock;
  readonly hierarchy: HierarchyBlock;
  readonly subject: SubjectBlock;
  readonly environment: EnvironmentBlock;
  readonly camera: CameraBlock;
  readonly lighting: LightingBlock;
  readonly color: ColorBlock;
  readonly materiality: MaterialityBlock;
  readonly typography: TypographyBlock;
  readonly graphicElements: GraphicElementsBlock;
  readonly graphicTreatment: GraphicTreatmentBlock;
  readonly photographicCharacter: PhotographicCharacterBlock;
  readonly visualGeneration: VisualGenerationBlock;
  readonly culture: CultureBlock;
  readonly industry: IndustryBlock;
  readonly brand: BrandBlock;
  readonly platform: PlatformBlock;
  readonly quality: QualityBlock;
  readonly constraints: ConstraintsBlock;
};

export type PromptSet = {
  readonly language: PromptLanguage;
  readonly masterPrompt: string;
  readonly quickPrompt: string;
  readonly imageOnlyPrompt: string;
  readonly designLayoutPrompt: string;
  readonly negativePrompt: string;
  /**
   * The resolved visual-generation adapter, for a subtle metadata line in the
   * UI (e.g. "Fashion Editorial · Refined photorealism"). `id` is never shown
   * raw; `label` is the localised, human-facing string.
   */
  readonly visualCharacter: {
    readonly id: VisualAdapterId;
    readonly label: string;
    readonly description: string;
  };
};

export type CompilePromptInput = {
  readonly recipe: DesignRecipe;
  /** The selected concept, when the architecture has one (absent before P2.2, or for a recipe built without one). */
  readonly concept?: CreativeConcept | null;
  readonly language?: PromptLanguage;
  /** Overrides the derived text mode. Exposed for callers with better information (e.g. a future visual-type lookup); never required. */
  readonly textMode?: TextMode | null;
  /**
   * Overrides the resolved visual-generation adapter. Exposed for callers and
   * tests that want to compare the same recipe across media; never required —
   * the adapter is normally resolved from the recipe alone.
   */
  readonly visualAdapter?: VisualAdapterId | null;
};

/** A renderer turns language-neutral blocks into one language's five prompt strings. */
export type PromptRenderer = (blocks: PromptBlocks) => Omit<PromptSet, "language">;
