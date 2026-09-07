import type { DatasetRegistry } from "../../types/datasets";
import type { DesignContract } from "../../types/schemas/contract.schema";
import type { DesignDirection } from "../../types/schemas/direction.schema";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { CreativeConcept } from "../../types/schemas/concept.schema";
import type { ClockPort } from "../../ports/clock.port";
import type { IdPort } from "../../ports/id.port";
import type { DirectionIssue } from "../../domain/errors";
import { directionIssue } from "../../domain/errors";
import { err, ok, type Result } from "../util/result";
import { buildDesignRecipe } from "../recipe/build";
import { directionById } from "./directions";

/**
 * Retarget the visual direction of an existing design (P2.10 additive).
 *
 * A designer choosing a different visual direction is a bounded, expression-only
 * change. It re-runs `buildDesignRecipe` with the direction's four bias
 * overrides — the SAME `overrides` channel the P6 Correction Engine uses — over
 * the SAME contract, direction and concept. Nothing about the strategy, the
 * concept, the movement, the layout or the core message moves; only how the
 * work is expressed (imagery realism, graphic ornament, saturation, materiality
 * — and, downstream of those, the photographic character and the generation
 * adapter the prompt compiler renders).
 *
 * The result is a fresh `recipe` (new `recipe_hash`). Feed it to
 * `resolveLayoutBlueprint` for a fresh blueprint and to the prompt compiler for
 * a fresh prompt. The parent recipe / blueprint stay immutable.
 */

export type RetargetDirectionInput = {
  readonly contract: DesignContract;
  readonly direction: DesignDirection;
  readonly concept: CreativeConcept | null;
  readonly parentRecipe: DesignRecipe;
  /** Visual direction id from `VISUAL_DIRECTIONS`. */
  readonly directionId: string;
  readonly datasets: DatasetRegistry;
  readonly ids: IdPort;
  readonly clock: ClockPort;
};

export type RetargetDirectionResult = {
  readonly recipe: DesignRecipe;
};

export function retargetDirection(
  input: RetargetDirectionInput
): Result<RetargetDirectionResult, DirectionIssue[]> {
  const { contract, direction, parentRecipe, datasets } = input;

  if (direction.contract_id !== contract.id) {
    return err([directionIssue("recipe_invalid", "direction.contract_id", "direction does not belong to the given contract")]);
  }
  if (parentRecipe.contract_id !== contract.id || parentRecipe.direction_id !== direction.id) {
    return err([directionIssue("recipe_invalid", "parentRecipe", "the recipe does not belong to the given contract / direction")]);
  }

  const visualDirection = directionById(input.directionId);
  if (!visualDirection) {
    return err([directionIssue("missing_reference", "directionId", `Visual direction "${input.directionId}" does not exist.`)]);
  }

  const o = visualDirection.overrides;
  const rebuilt = buildDesignRecipe({
    projectId: contract.project_id,
    contract,
    direction,
    datasets,
    clock: input.clock,
    ids: input.ids,
    concept: input.concept ?? null,
    derivedFrom: parentRecipe.id,
    overrides: {
      imageryRealism: o.imageryRealism,
      colorSaturation: o.colorSaturation,
      materialityTexture: o.materialityTexture,
      ornament: o.graphicOrnament
    }
  });
  if (!rebuilt.ok) return err(rebuilt.error);

  return ok({ recipe: rebuilt.value });
}
