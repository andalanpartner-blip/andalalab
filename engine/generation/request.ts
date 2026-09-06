import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { LayoutBlueprint } from "../../types/schemas/layout-blueprint.schema";
import type { AspectRatio } from "../../types/schemas/reference/visual-type.schema";
import type {
  GenerationConfig,
  GenerationRequest
} from "../../types/schemas/visual-generation.schema";
import { GenerationRequest as GenerationRequestSchema } from "../../types/schemas/visual-generation.schema";
import { SCHEMA_VERSIONS } from "../../types/versions";
import { canonicalise, fnv1a } from "../../types/primitives";
import type { PromptSet } from "../prompt/types";
import { err, ok, type Result } from "../util/result";
import type { DirectionIssue } from "../../domain/errors";
import { directionIssue } from "../../domain/errors";

/**
 * The Visual Generation request builder (P2.11).
 *
 * Pure and deterministic. Given an already-resolved recipe, its (optional)
 * layout blueprint, the compiled prompt set and the resolved aspect ratio, it
 * assembles the normalised instruction that a provider adapter will execute.
 *
 * It makes NO design decision — the adapter id, the prompt strings, the
 * hierarchy, the composition, the photographic character and the cultural
 * direction were all resolved upstream and are copied here verbatim. It calls
 * no model, reads no free user text, touches no clock and no RNG.
 *
 * Determinism: same recipe + same blueprint + same prompt set + same config +
 * same dataset version ⇒ byte-identical request and `request_hash`.
 */

/** The version of the prompt → generation-request mapping this builder implements. */
export const PROMPT_COMPILER_VERSION = "1.0.0";
export const GENERATION_REQUEST_VERSION = "1.0.0";

const TIER_TO_PROMPT: Record<GenerationConfig["prompt_tier"], (set: PromptSet) => string> = {
  master: (set) => set.masterPrompt,
  "image-only": (set) => set.imageOnlyPrompt,
  "design-layout": (set) => set.designLayoutPrompt
};

const DEFAULT_CONFIG: Omit<GenerationConfig, "prompt_language"> = {
  prompt_tier: "image-only",
  seed: null,
  candidate_count: 1
};

export type BuildGenerationRequestInput = {
  readonly recipe: DesignRecipe;
  /** The P2.10 layout blueprint for this recipe, when one has been resolved. */
  readonly blueprint?: LayoutBlueprint | null;
  readonly promptSet: PromptSet;
  /** The aspect ratio resolved from the visual type dataset (width / height). */
  readonly aspectRatio: AspectRatio;
  /** `contract.visual_type.id` — the recipe carries only `platform.channel`. */
  readonly visualTypeId: string;
  readonly datasetVersion: string;
  /** Overrides for the deterministic generation config. */
  readonly config?: Partial<Omit<GenerationConfig, "prompt_language">>;
};

function orientationOf(ratio: AspectRatio): "portrait" | "landscape" | "square" {
  return ratio.width > ratio.height ? "landscape" : ratio.width < ratio.height ? "portrait" : "square";
}

export function buildGenerationRequest(
  input: BuildGenerationRequestInput
): Result<GenerationRequest, DirectionIssue[]> {
  const { recipe, blueprint, promptSet, aspectRatio } = input;

  if (blueprint && blueprint.derived_from.recipe_hash !== recipe.recipe_hash) {
    return err([
      directionIssue(
        "recipe_invalid",
        "blueprint.derived_from.recipe_hash",
        `the supplied blueprint was derived from recipe ${blueprint.derived_from.recipe_hash}, not this one (${recipe.recipe_hash})`
      )
    ]);
  }

  if (recipe.platform.aspect_ratio_id !== aspectRatio.id) {
    return err([
      directionIssue(
        "recipe_invalid",
        "aspectRatio.id",
        `aspect ratio ${aspectRatio.id} does not match the recipe platform (${recipe.platform.aspect_ratio_id})`
      )
    ]);
  }

  const config: GenerationConfig = {
    prompt_tier: input.config?.prompt_tier ?? DEFAULT_CONFIG.prompt_tier,
    prompt_language: promptSet.language,
    seed: input.config?.seed ?? DEFAULT_CONFIG.seed,
    candidate_count: input.config?.candidate_count ?? DEFAULT_CONFIG.candidate_count
  };

  const prompt = TIER_TO_PROMPT[config.prompt_tier](promptSet).trim();
  const negativePrompt = promptSet.negativePrompt.trim();
  if (prompt.length === 0) {
    return err([
      directionIssue("recipe_invalid", "promptSet", `the ${config.prompt_tier} prompt tier is empty`)
    ]);
  }

  const promptHash = fnv1a(
    canonicalise({ prompt, negative_prompt: negativePrompt, language: promptSet.language })
  );

  const provenance = {
    recipe_id: recipe.id,
    recipe_hash: recipe.recipe_hash,
    contract_id: recipe.contract_id,
    direction_id: recipe.direction_id,
    concept_ref: recipe.concept_ref,
    blueprint_id: null as string | null,
    blueprint_hash: blueprint ? blueprint.blueprint_hash : null,
    prompt_compiler_version: PROMPT_COMPILER_VERSION,
    prompt_language: promptSet.language,
    prompt_hash: promptHash,
    adapter_id: promptSet.visualCharacter.id,
    generation_request_version: GENERATION_REQUEST_VERSION,
    dataset_version: input.datasetVersion
  };

  const body = {
    schema_version: SCHEMA_VERSIONS.generationRequest,
    generation_request_version: GENERATION_REQUEST_VERSION,
    provenance,
    target: {
      visual_type_id: input.visualTypeId,
      channel: recipe.platform.channel,
      aspect_ratio_id: aspectRatio.id,
      width: aspectRatio.width,
      height: aspectRatio.height,
      orientation: orientationOf(aspectRatio)
    },
    config,
    prompt,
    negative_prompt: negativePrompt
  };

  const request = { ...body, request_hash: fnv1a(canonicalise(body)) };

  const validated = GenerationRequestSchema.safeParse(request);
  if (!validated.success) {
    return err(
      validated.error.issues.map((problem) =>
        directionIssue("recipe_invalid", problem.path.join(".") || "(root)", problem.message)
      )
    );
  }
  return ok(validated.data);
}
