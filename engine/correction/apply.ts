import type { DatasetRegistry } from "../../types/datasets";
import type { DesignContract } from "../../types/schemas/contract.schema";
import { DesignContract as DesignContractSchema } from "../../types/schemas/contract.schema";
import type { DesignDirection } from "../../types/schemas/direction.schema";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { CreativeConcept } from "../../types/schemas/concept.schema";
import type { DkvParamKey, DkvRule } from "../../types/schemas/dkv.schema";
import { DKV_PARAM_KEYS } from "../../types/schemas/dkv.schema";
import type {
  AppliedChange,
  CorrectionField,
  CorrectionPatch,
  CorrectionReport
} from "../../types/schemas/correction.schema";
import { DKV_CORRECTION_FIELDS } from "../../types/schemas/correction.schema";
import { canonicalise, fnv1a } from "../../types/primitives";
import { deepFreeze } from "../../domain/contract";
import { SCHEMA_VERSIONS } from "../../types/versions";
import type { ClockPort } from "../../ports/clock.port";
import type { IdPort } from "../../ports/id.port";
import type { DirectionIssue } from "../../domain/errors";
import { directionIssue } from "../../domain/errors";
import { labelOf } from "../dkv/doctrine";
import { PARAM_LIMITS } from "../dkv/rules";
import { round } from "../dkv/params";
import { buildDesignDirection } from "../decision/resolve";
import { buildDesignRecipe } from "../recipe/build";
import { diffRecipes, IGNORED_PATHS } from "../recipe/diff";
import { err, ok, type Result } from "../util/result";
import { classifyRecipeDiff } from "./classify";

/**
 * The Correction Engine (P6).
 *
 * Deterministic, pure, no LLM, no image, no network. It takes a finished
 * recipe and a bounded `CorrectionPatch` and produces a NEW derived recipe —
 * the parent is never mutated (ADR 0004). A DKV correction flows through
 * `resolveDkv` as a rank-2 target claim; a bias correction is applied as a
 * recipe-build override. Anything that would move a locked anchor or a
 * structural field is rejected as `redesign` and no recipe is produced.
 *
 * See `docs/correction-engine.md`.
 */

/** Client corrections speak at audience authority — strong, but below objective demands and industry bands. */
const CORRECTION_RANK = 2;

const DKV_FIELD_SET = new Set<string>(DKV_CORRECTION_FIELDS);

export type ApplyCorrectionInput = {
  readonly parentRecipe: DesignRecipe;
  readonly contract: DesignContract;
  readonly direction: DesignDirection;
  readonly patch: CorrectionPatch;
  readonly datasets: DatasetRegistry;
  readonly ids: IdPort;
  readonly clock: ClockPort;
  readonly concept?: CreativeConcept | null;
};

export type ApplyCorrectionResult = {
  readonly report: CorrectionReport;
  /** The derived recipe — non-null only when `report.outcome === "adjustment"`. */
  readonly recipe: DesignRecipe | null;
  /**
   * The contract and direction the derived recipe was built from. On an
   * `adjustment` that included a DKV correction these are NEW derived artifacts
   * (with fresh ids); otherwise they are the ones passed in. A caller chaining
   * corrections must carry these forward, not the originals. Null unless
   * `report.outcome === "adjustment"`.
   */
  readonly contract: DesignContract | null;
  readonly direction: DesignDirection | null;
};

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));

function parentValue(recipe: DesignRecipe, field: CorrectionField): number {
  if (DKV_FIELD_SET.has(field)) return recipe.dkv[field as DkvParamKey];
  switch (field) {
    case "color_saturation":
      return recipe.color.saturation;
    case "imagery_realism":
      return recipe.imagery.realism;
    case "materiality_texture":
      return recipe.materiality.texture;
    case "graphic_ornament":
      return recipe.graphic_language.ornament;
    default:
      return 0;
  }
}

function resolvedValue(recipe: DesignRecipe, field: CorrectionField): number {
  return parentValue(recipe, field);
}

/** Absolute range for a field (DKV param limits, or 0..1 for the biases). */
function fieldRange(field: CorrectionField): { min: number; max: number } {
  if (DKV_FIELD_SET.has(field)) return PARAM_LIMITS[field as DkvParamKey];
  return { min: 0, max: 1 };
}

type Request = {
  field: CorrectionField;
  raw: number;
  target: number;
  heldBy?: string;
};

/**
 * Fold the patch into one request per field. `set` overwrites the running
 * value; `increase` / `decrease` accumulate onto it. The result is clamped to
 * the field's absolute range and, for a DKV field, to the band the parent
 * direction already established (a correction moves WITHIN the design's bands,
 * it never widens them).
 */
function collectRequests(input: ApplyCorrectionInput): Request[] {
  const running = new Map<CorrectionField, number>();
  const bandByParam = new Map(input.direction.derivations.map((d) => [d.param, d]));

  for (const adjustment of input.patch.adjustments) {
    const current = running.get(adjustment.field) ?? parentValue(input.parentRecipe, adjustment.field);
    let next: number;
    if (adjustment.mode === "set") next = adjustment.amount;
    else if (adjustment.mode === "increase") next = current + Math.abs(adjustment.amount);
    else next = current - Math.abs(adjustment.amount);
    running.set(adjustment.field, next);
  }

  const requests: Request[] = [];
  for (const [field, raw] of running) {
    const range = fieldRange(field);
    let target = clamp(round(raw), range.min, range.max);
    let heldBy: string | undefined;

    if (DKV_FIELD_SET.has(field)) {
      const derivation = bandByParam.get(field as DkvParamKey);
      if (derivation) {
        const banded = clamp(target, derivation.clamped_to.min, derivation.clamped_to.max);
        if (Math.abs(banded - target) > 1e-9) heldBy = labelOf(rankFor(derivation.governing_layer));
        target = round(banded);
      }
    } else if (Math.abs(target - round(raw)) > 1e-9) {
      heldBy = "the 0–1 range limit";
    }

    requests.push({ field, raw: round(raw), target, heldBy });
  }
  return requests.sort((a, b) => a.field.localeCompare(b.field));
}

/** Rank number for a governing-layer id (reverse of `labelForRank`). */
function rankFor(layer: string): number {
  const table: Record<string, number> = {
    communication_objective: 1,
    audience: 2,
    industry_requirements: 3,
    brand_identity: 4,
    dkv_fundamentals: 5,
    platform_constraints: 6,
    country_visual_dna: 7,
    design_movement: 8,
    contemporary_trends: 9,
    decorative_treatment: 10
  };
  return table[layer] ?? 5;
}

/** A frozen contract identical to `contract` but for the appended correction rules and lineage. */
function deriveContract(
  contract: DesignContract,
  rules: readonly DkvRule[],
  ids: IdPort,
  clock: ClockPort
): DesignContract {
  const { id: _id, created_at: _createdAt, contract_hash: _hash, ...bodyRest } = contract;
  const body = {
    ...bodyRest,
    schema_version: SCHEMA_VERSIONS.contract,
    dkv_rules: [...contract.dkv_rules, ...rules]
  };
  const derived = {
    ...body,
    id: ids.next("contract"),
    created_at: clock.now().toISOString(),
    contract_hash: fnv1a(canonicalise(body))
  };
  return deepFreeze(DesignContractSchema.parse(derived));
}

/** Paths that change on every correction by construction — never a "change" a reviewer cares about. */
const CORRECTION_NOISE = new Set(["contract_id", "derived_from"]);

function projectDiff(
  before: DesignRecipe,
  after: DesignRecipe,
  structural: readonly string[]
): CorrectionReport["diff"] {
  const diff = diffRecipes(before, after);
  const dkvDelta: Record<string, number> = {};
  for (const param of DKV_PARAM_KEYS) {
    if (diff.dkv_delta[param] !== 0) dkvDelta[param] = diff.dkv_delta[param];
  }
  return {
    changed_paths: diff.changed
      .map((c) => c.path)
      .filter((p) => !IGNORED_PATHS.has(p) && !CORRECTION_NOISE.has(p)),
    dkv_delta: dkvDelta,
    anchor_violations: [...diff.anchor_violations],
    structural_changes: [...structural]
  };
}

function describe(field: CorrectionField): string {
  return field.replace(/_/g, " ");
}

export function applyCorrection(
  input: ApplyCorrectionInput
): Result<ApplyCorrectionResult, DirectionIssue[]> {
  const { parentRecipe, contract, direction } = input;

  if (direction.contract_id !== contract.id) {
    return err([directionIssue("recipe_invalid", "direction.contract_id", "direction does not belong to the given contract")]);
  }
  if (parentRecipe.contract_id !== contract.id || parentRecipe.direction_id !== direction.id) {
    return err([directionIssue("recipe_invalid", "parentRecipe", "the recipe does not belong to the given contract / direction")]);
  }

  const requests = collectRequests(input);

  // Drop requests that ask for a value already in place (and weren't clamped) —
  // they would only add churn to the rebuild. `changes` in the report still
  // lists every requested field so the reviewer sees "already there".
  const effective = requests.filter(
    (r) => r.heldBy !== undefined || Math.abs(r.target - round(parentValue(parentRecipe, r.field))) > 1e-9
  );

  const changesForAll: AppliedChange[] = requests.map((request) => ({
    field: request.field,
    requested: request.raw,
    resolved: round(parentValue(parentRecipe, request.field)),
    ...(request.heldBy ? { held_by: request.heldBy } : {})
  }));

  if (effective.length === 0) {
    return ok({
      recipe: null,
      contract: null,
      direction: null,
      report: {
        outcome: "noop",
        reason: "Every requested value was already in place — nothing moved and no new recipe was created.",
        changes: changesForAll,
        diff: { changed_paths: [], dkv_delta: {}, anchor_violations: [], structural_changes: [] },
        lineage: []
      }
    });
  }

  const dkvRequests = effective.filter((r) => DKV_FIELD_SET.has(r.field));
  const biasRequests = effective.filter((r) => !DKV_FIELD_SET.has(r.field));

  const correctionId = input.ids.next("correction");

  // --- 1. DKV corrections flow through resolveDkv via the contract ---------
  let workingContract = contract;
  let workingDirection = direction;

  if (dkvRequests.length > 0) {
    const rules: DkvRule[] = dkvRequests.map((request) => ({
      param: request.field as DkvParamKey,
      min: 0,
      max: request.field === "typographic_scale_ratio" ? 4 : 1,
      target: request.target,
      source: `client correction:${correctionId}`,
      doctrine_rank: CORRECTION_RANK
    }));
    workingContract = deriveContract(contract, rules, input.ids, input.clock);

    const rebuilt = buildDesignDirection({
      projectId: workingContract.project_id,
      contract: workingContract,
      datasets: input.datasets,
      clock: input.clock,
      ids: input.ids
    });
    if (!rebuilt.ok) return err(rebuilt.error);
    workingDirection = rebuilt.value;
  }

  // --- 2. bias corrections are recipe-build overrides ---------------------
  const overrides: {
    colorSaturation?: number;
    imageryRealism?: number;
    materialityTexture?: number;
    ornament?: number;
  } = {};
  for (const request of biasRequests) {
    if (request.field === "color_saturation") overrides.colorSaturation = request.target;
    else if (request.field === "imagery_realism") overrides.imageryRealism = request.target;
    else if (request.field === "materiality_texture") overrides.materialityTexture = request.target;
    else if (request.field === "graphic_ornament") overrides.ornament = request.target;
  }

  const rebuiltRecipe = buildDesignRecipe({
    projectId: workingContract.project_id,
    contract: workingContract,
    direction: workingDirection,
    datasets: input.datasets,
    clock: input.clock,
    ids: input.ids,
    concept: input.concept ?? null,
    derivedFrom: parentRecipe.id,
    overrides: Object.keys(overrides).length > 0 ? overrides : undefined
  });
  if (!rebuiltRecipe.ok) return err(rebuiltRecipe.error);
  const candidate = rebuiltRecipe.value;

  // --- 3. classify and report -------------------------------------------
  const diff = diffRecipes(parentRecipe, candidate);
  const classification = classifyRecipeDiff(diff, parentRecipe, candidate);

  const changes: AppliedChange[] = requests.map((request) => ({
    field: request.field,
    requested: request.raw,
    resolved: round(resolvedValue(candidate, request.field)),
    ...(request.heldBy ? { held_by: request.heldBy } : {})
  }));

  const moved = changes.filter((c) => Math.abs(c.resolved - round(parentValue(parentRecipe, c.field))) > 1e-9);

  const diffProjection = projectDiff(parentRecipe, candidate, classification.structural_changes);

  if (classification.outcome === "redesign") {
    return ok({
      recipe: null,
      contract: null,
      direction: null,
      report: {
        outcome: "redesign",
        reason:
          `This change would alter ${classification.structural_changes.join(", ")} — that changes what the work is, ` +
          `which is a new design direction, not a correction. Go back to the Design Direction stage to change it.`,
        changes: [],
        diff: diffProjection,
        lineage: []
      }
    });
  }

  if (classification.outcome === "noop" || moved.length === 0) {
    const clamped = changes.filter((c) => c.held_by);
    return ok({
      recipe: null,
      contract: null,
      direction: null,
      report: {
        outcome: "noop",
        reason:
          clamped.length > 0
            ? `The requested change to ${clamped.map((c) => describe(c.field)).join(", ")} was already held by ${clamped.map((c) => c.held_by).join("; ")}, so nothing measurable moved. No new recipe was created.`
            : "The requested value was already in place, so nothing measurable moved. No new recipe was created.",
        changes,
        diff: { ...diffProjection, structural_changes: [] },
        lineage: []
      }
    });
  }

  const summary = moved
    .map((c) => `${describe(c.field)} ${round(parentValue(parentRecipe, c.field))} → ${c.resolved}${c.held_by ? ` (held by ${c.held_by})` : ""}`)
    .join("; ");

  return ok({
    recipe: candidate,
    contract: workingContract,
    direction: workingDirection,
    report: {
      outcome: "adjustment",
      reason:
        `Applied ${moved.length} adjustment${moved.length === 1 ? "" : "s"}: ${summary}. ` +
        `The movement, layout, composition strategy, concept, objective and core message are unchanged.`,
      changes,
      diff: diffProjection,
      lineage: [parentRecipe.derived_from, parentRecipe.id, candidate.id].filter(
        (value): value is string => typeof value === "string" && value.length > 0
      )
    }
  });
}
