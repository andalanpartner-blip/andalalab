import type { DatasetRegistry } from "../../types/datasets";
import type { DesignContract } from "../../types/schemas/contract.schema";
import { DesignContract as DesignContractSchema } from "../../types/schemas/contract.schema";
import type { DesignDirection } from "../../types/schemas/direction.schema";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { CreativeConcept } from "../../types/schemas/concept.schema";
import { SCHEMA_VERSIONS } from "../../types/versions";
import { canonicalise, fnv1a } from "../../types/primitives";
import { deepFreeze } from "../../domain/contract";
import type { ClockPort } from "../../ports/clock.port";
import type { IdPort } from "../../ports/id.port";
import type { DirectionIssue } from "../../domain/errors";
import { directionIssue } from "../../domain/errors";
import { err, ok, type Result } from "../util/result";
import { buildDesignDirection } from "../decision/resolve";
import { buildDesignRecipe } from "../recipe/build";

/**
 * Retarget the layout of an existing design (P2.10 additive).
 *
 * A designer choosing a different visual layout template is a bounded,
 * structure-only change. It pins the CURRENT movement and the CHOSEN layout on
 * a derived contract, rebuilds the direction (exactly one candidate: current
 * movement × chosen layout) and rebuilds the recipe. Same primitives the
 * Correction Engine already uses — nothing here is a new grammar.
 *
 * What moves: grid, zones, reading flow, composition arrangement and every
 * value the layout drives. What does NOT move: movement, DKV doctrine targets,
 * concept, objective, core message. No image is generated, no model is called.
 *
 * The result is a fresh `recipe` (new `recipe_hash`). Feed it to
 * `resolveLayoutBlueprint` for a fresh blueprint and to the prompt compiler
 * for a fresh prompt — the parent recipe / blueprint stay immutable.
 */

export type RetargetLayoutInput = {
  readonly contract: DesignContract;
  readonly direction: DesignDirection;
  readonly concept: CreativeConcept | null;
  readonly parentRecipe: DesignRecipe;
  /** Canonical layout id from `data/layouts/`. */
  readonly layoutId: string;
  readonly datasets: DatasetRegistry;
  readonly ids: IdPort;
  readonly clock: ClockPort;
};

export type RetargetLayoutResult = {
  readonly contract: DesignContract;
  readonly direction: DesignDirection;
  readonly recipe: DesignRecipe;
};

export function retargetLayout(
  input: RetargetLayoutInput
): Result<RetargetLayoutResult, DirectionIssue[]> {
  const { contract, direction, parentRecipe, layoutId, datasets } = input;

  if (direction.contract_id !== contract.id) {
    return err([directionIssue("recipe_invalid", "direction.contract_id", "direction does not belong to the given contract")]);
  }
  if (parentRecipe.contract_id !== contract.id || parentRecipe.direction_id !== direction.id) {
    return err([directionIssue("recipe_invalid", "parentRecipe", "the recipe does not belong to the given contract / direction")]);
  }

  const layout = datasets.layouts.get(layoutId);
  if (!layout) {
    return err([directionIssue("missing_reference", "layoutId", `Layout "${layoutId}" is not in dataset ${datasets.version}.`)]);
  }

  // Pin the current movement + the chosen layout so the rebuilt direction is
  // exactly (current movement × chosen layout).
  const pinned = pinContract(
    contract,
    { id: layout.id, name: layout.name },
    { id: parentRecipe.movement.id, name: parentRecipe.movement.name },
    input.ids,
    input.clock
  );

  const rebuiltDirection = buildDesignDirection({
    projectId: pinned.project_id,
    contract: pinned,
    datasets,
    clock: input.clock,
    ids: input.ids
  });
  if (!rebuiltDirection.ok) return err(rebuiltDirection.error);

  const rebuiltRecipe = buildDesignRecipe({
    projectId: pinned.project_id,
    contract: pinned,
    direction: rebuiltDirection.value,
    datasets,
    clock: input.clock,
    ids: input.ids,
    concept: input.concept ?? null,
    // relaxes the concept↔direction id check — the movement is provably unchanged
    derivedFrom: parentRecipe.id
  });
  if (!rebuiltRecipe.ok) return err(rebuiltRecipe.error);

  return ok({
    contract: pinned,
    direction: rebuiltDirection.value,
    recipe: rebuiltRecipe.value
  });
}

function pinContract(
  contract: DesignContract,
  layout: { id: string; name: string },
  movement: { id: string; name: string },
  ids: IdPort,
  clock: ClockPort
): DesignContract {
  const { id: _id, created_at: _createdAt, contract_hash: _hash, ...bodyRest } = contract;
  const body = {
    ...bodyRest,
    schema_version: SCHEMA_VERSIONS.contract,
    layout,
    movement
  };
  const derived = {
    ...body,
    id: ids.next("contract"),
    created_at: clock.now().toISOString(),
    contract_hash: fnv1a(canonicalise(body))
  };
  return deepFreeze(DesignContractSchema.parse(derived));
}
