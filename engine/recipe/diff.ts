import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { DkvParamKey } from "../../types/schemas/dkv.schema";
import { DKV_PARAM_KEYS } from "../../types/schemas/dkv.schema";
import { round } from "../dkv/params";
import { anchorViolations } from "./anchors";

/**
 * Deterministic recipe diffing (P1 spec §11).
 *
 * The correction engine in a later phase will use this to decide whether a
 * patch is an adjustment or a redesign. Fields that change on every build by
 * construction — id, timestamp, hash — are excluded, otherwise every diff
 * would report a change and the signal would be worthless.
 */

/** Volatile by construction; never a meaningful difference. */
export const IGNORED_PATHS = new Set(["id", "created_at", "recipe_hash", "direction_id"]);

export type FieldChange = {
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
};

export type RecipeDiff = {
  readonly changed: readonly FieldChange[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly anchor_violations: readonly string[];
  readonly dkv_delta: Readonly<Record<DkvParamKey, number>>;
  readonly identical: boolean;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function walk(
  before: unknown,
  after: unknown,
  path: string,
  changed: FieldChange[],
  added: string[],
  removed: string[]
): void {
  if (IGNORED_PATHS.has(path)) return;

  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      const next = path ? `${path}.${key}` : key;
      if (!(key in before)) {
        if (!IGNORED_PATHS.has(next)) added.push(next);
        continue;
      }
      if (!(key in after)) {
        if (!IGNORED_PATHS.has(next)) removed.push(next);
        continue;
      }
      walk(before[key], after[key], next, changed, added, removed);
    }
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changed.push({ path, before, after });
    }
    return;
  }

  if (before !== after) changed.push({ path, before, after });
}

export function diffRecipes(before: DesignRecipe, after: DesignRecipe): RecipeDiff {
  const changed: FieldChange[] = [];
  const added: string[] = [];
  const removed: string[] = [];

  walk(before, after, "", changed, added, removed);

  const dkvDelta = {} as Record<DkvParamKey, number>;
  for (const param of DKV_PARAM_KEYS) {
    dkvDelta[param] = round(after.dkv[param] - before.dkv[param]);
  }

  return {
    changed: changed.sort((a, b) => a.path.localeCompare(b.path)),
    added: added.sort(),
    removed: removed.sort(),
    anchor_violations: anchorViolations(before.anchors, after.anchors),
    dkv_delta: dkvDelta,
    identical: changed.length === 0 && added.length === 0 && removed.length === 0
  };
}
