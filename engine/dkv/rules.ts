import type { DkvParamKey, DkvParams, DkvRule } from "../../types/schemas/dkv.schema";
import { DKV_PARAM_KEYS } from "../../types/schemas/dkv.schema";
import type {
  Conflict,
  DkvClaim,
  DkvDerivation,
  DoctrineLayer,
  Resolution
} from "../../types/schemas/direction.schema";
import { DOCTRINE, labelOf } from "./doctrine";
import { DEFAULT_DKV, round } from "./params";

/**
 * DKV parameter resolution.
 *
 * Two kinds of claim arrive here. A BAND says what is legal ("Property needs
 * contrast ≥ 0.55"). A TARGET says what is wanted ("Brutalism wants contrast
 * 0.95"). Bands are hard, targets are soft, and doctrine rank decides who wins
 * when they disagree.
 *
 * The rule the whole system rests on: conflicting requirements are never
 * averaged blindly. Targets are averaged by AUTHORITY WEIGHT, and the result
 * is then clamped hard into the surviving band. A rank-8 movement can pull a
 * value it does not control; it can never pull it outside a rank-3 floor.
 */

/** Absolute limits per parameter. Everything is 0..1 except the type scale. */
export const PARAM_LIMITS: Record<DkvParamKey, { min: number; max: number }> = {
  whitespace: { min: 0, max: 1 },
  contrast: { min: 0, max: 1 },
  visual_density: { min: 0, max: 1 },
  alignment: { min: 0, max: 1 },
  hierarchy_strength: { min: 0, max: 1 },
  color_complexity: { min: 0, max: 1 },
  focal_dominance: { min: 0, max: 1 },
  typographic_scale_ratio: { min: 1, max: 4 }
};

/**
 * Authority weight from doctrine rank.
 *
 * Linear from 1.0 at rank 1 to 0.1 at rank 10. Linear rather than exponential
 * on purpose: an exponential curve would make ranks 6–10 numerically
 * irrelevant, and a movement that never moves a number is a movement that is
 * not really in the system.
 */
export const authorityWeight = (rank: number): number => round((11 - rank) / 10);

/** Movement in a direction of this size or more counts as a real modification. */
export const RESOLUTION_TOLERANCE = 0.001;
/** A clamp bigger than this is a major (P1) conflict, not a routine adjustment. */
export const MAJOR_CLAMP = 0.1;
/** A clamp bigger than this destroys the losing layer's identity — critical (P0). */
export const CRITICAL_CLAMP = 0.25;

const layerForRank = (rank: number): DoctrineLayer =>
  (DOCTRINE.find((layer) => layer.rank === rank)?.id ?? "decorative_treatment") as DoctrineLayer;

/** Convert the contract's and the candidate's DkvRules into typed claims. */
export function toClaims(rules: readonly DkvRule[]): DkvClaim[] {
  return rules.map((rule) => ({
    param: rule.param,
    layer: layerForRank(rule.doctrine_rank),
    rank: rule.doctrine_rank,
    kind: rule.target !== undefined && rule.min === 0 && rule.max >= 1 ? "target" : "band",
    min: rule.min,
    max: rule.max,
    target: rule.target,
    source: rule.source
  }));
}

export type ResolveResult = {
  readonly params: DkvParams;
  readonly derivations: DkvDerivation[];
  readonly conflicts: Conflict[];
  readonly resolutions: Resolution[];
};

const actionName = (param: DkvParamKey, from: number, to: number): string =>
  `${to > from ? "increase" : "reduce"}_${param}`;

/**
 * Resolve every DKV parameter from a set of claims.
 *
 * Deterministic: claims are sorted by rank then source before use, so map
 * ordering and candidate ordering cannot change the output.
 */
export function resolveDkv(claims: readonly DkvClaim[], idPrefix = "conflict"): ResolveResult {
  const conflicts: Conflict[] = [];
  const resolutions: Resolution[] = [];
  const derivations: DkvDerivation[] = [];
  const params = {} as Record<DkvParamKey, number>;
  let counter = 0;

  const nextId = (): string => {
    counter += 1;
    return `${idPrefix}_${String(counter).padStart(3, "0")}`;
  };

  for (const param of DKV_PARAM_KEYS) {
    const limits = PARAM_LIMITS[param];
    const relevant = [...claims]
      .filter((claim) => claim.param === param)
      .sort((a, b) => (a.rank === b.rank ? a.source.localeCompare(b.source) : a.rank - b.rank));

    // --- 1. intersect bands, strongest authority first ---------------------
    // `governing` stays null until some layer actually narrows the parameter.
    // The absolute limits are the parameter's definition, not a doctrine
    // position, and clamping to them is not a conflict with anybody.
    let min = limits.min;
    let max = limits.max;
    let governing: DoctrineLayer | null = null;
    let governingRank = Number.POSITIVE_INFINITY;

    for (const claim of relevant) {
      if (claim.kind !== "band") continue;
      const claimMin = claim.min ?? limits.min;
      const claimMax = claim.max ?? limits.max;
      const nextMin = Math.max(min, claimMin);
      const nextMax = Math.min(max, claimMax);

      if (nextMin > nextMax) {
        // Two bands cannot both hold. Claims are rank-sorted, so the band
        // already in force is the more authoritative one and it stands.
        const severity = claim.rank <= 3 && governingRank <= 3 ? "P0" : "P1";
        const conflictId = nextId();
        const winner = governing ?? "dkv_fundamentals";
        conflicts.push({
          conflict_id: conflictId,
          param,
          severity,
          claims: [
            {
              param,
              layer: winner,
              rank: Number.isFinite(governingRank) ? governingRank : 5,
              kind: "band",
              min,
              max,
              source: "established band"
            },
            claim
          ],
          description: `Band [${round(claimMin)}, ${round(claimMax)}] from ${labelOf(claim.rank)} cannot intersect the established band [${round(min)}, ${round(max)}] on ${param}.`
        });
        resolutions.push({
          conflict_id: conflictId,
          param,
          winner,
          loser: claim.layer,
          rule: `${winner} outranks ${claim.layer}`,
          action: `discard_band_${param}`,
          requested: round((claimMin + claimMax) / 2),
          resolved: round((min + max) / 2),
          reason: `${labelOf(Number.isFinite(governingRank) ? governingRank : 5)} holds ${param} to [${round(min)}, ${round(max)}]; the ${labelOf(claim.rank)} band cannot be satisfied at the same time and is discarded rather than blended.`
        });
        continue;
      }

      if (nextMin > min || nextMax < max) {
        governing = claim.layer;
        governingRank = claim.rank;
      }
      min = nextMin;
      max = nextMax;
    }

    // --- 2. weighted average of targets, by authority ----------------------
    const targets = relevant.filter(
      (claim) => claim.kind === "target" && typeof claim.target === "number"
    );
    const base = DEFAULT_DKV[param];
    let weightedTarget = base;

    if (targets.length > 0) {
      let sum = 0;
      let weightSum = 0;
      for (const claim of targets) {
        const weight = authorityWeight(claim.rank);
        sum += (claim.target ?? base) * weight;
        weightSum += weight;
      }
      weightedTarget = weightSum > 0 ? round(sum / weightSum) : base;
    }

    // --- 3. does a MORE authoritative target overrule the band? ------------
    // Doctrine is a total order. A rank-6 platform band must not beat a rank-1
    // objective demand just because bands are structurally "harder" than
    // targets. When the stronger layer is the one being clamped, the band
    // yields instead — and the exchange is logged either way.
    const outsiders = targets.filter((claim) => {
      const value = claim.target ?? base;
      return value < min - RESOLUTION_TOLERANCE || value > max + RESOLUTION_TOLERANCE;
    });
    const strongestOutsider = [...outsiders].sort((a, b) => a.rank - b.rank)[0];

    let effectiveMin = min;
    let effectiveMax = max;
    let bandYielded = false;

    if (strongestOutsider && governing !== null && strongestOutsider.rank < governingRank) {
      bandYielded = true;
      effectiveMin = limits.min;
      effectiveMax = limits.max;
    }

    const final = round(Math.min(effectiveMax, Math.max(effectiveMin, weightedTarget)));

    if (bandYielded && strongestOutsider && governing !== null) {
      const conflictId = nextId();
      const requested = round(strongestOutsider.target ?? base);
      conflicts.push({
        conflict_id: conflictId,
        param,
        severity: governingRank - strongestOutsider.rank >= 3 ? "P1" : "P2",
        claims: [
          { param, layer: governing, rank: governingRank, kind: "band", min, max, source: "governing band" },
          strongestOutsider
        ],
        description: `${labelOf(strongestOutsider.rank)} asks for ${param} ${requested}, outside the [${round(min)}, ${round(max)}] band held by ${labelOf(governingRank)}.`
      });
      resolutions.push({
        conflict_id: conflictId,
        param,
        winner: strongestOutsider.layer,
        loser: governing,
        rule: `${strongestOutsider.layer} outranks ${governing}`,
        action: `release_band_${param}`,
        requested,
        resolved: final,
        reason: `${labelOf(strongestOutsider.rank)} sits above ${labelOf(governingRank)} in the doctrine, so the ${labelOf(governingRank)} band on ${param} was released rather than enforced, and the value settled at ${final}.`
      });
    }

    // --- 4. log every target the outcome overruled -------------------------
    // Reported per claim, not only on the blended value. Averaging can land a
    // movement's demand inside the band while the movement itself was
    // completely overruled — silently, which is the failure mode this exists
    // to prevent.
    if (!bandYielded && governing !== null) {
      const overruled = outsiders
        .filter((claim) => claim.rank >= governingRank)
        .sort((a, b) => (a.rank === b.rank ? a.source.localeCompare(b.source) : a.rank - b.rank));

      const seen = new Set<string>();
      for (const claim of overruled) {
        if (seen.has(claim.layer)) continue;
        seen.add(claim.layer);

        const requested = round(claim.target ?? base);
        const gap = Math.abs(requested - final);
        const severity = gap >= CRITICAL_CLAMP ? "P0" : gap >= MAJOR_CLAMP ? "P1" : "P2";
        const conflictId = nextId();

        conflicts.push({
          conflict_id: conflictId,
          param,
          severity,
          claims: [
            { param, layer: governing, rank: governingRank, kind: "band", min, max, source: "governing band" },
            claim
          ],
          description: `${labelOf(claim.rank)} asks for ${param} ${requested}; ${labelOf(governingRank)} allows only [${round(min)}, ${round(max)}].`
        });
        resolutions.push({
          conflict_id: conflictId,
          param,
          winner: governing,
          loser: claim.layer,
          rule: `${governing} outranks ${claim.layer}`,
          action: actionName(param, requested, final),
          requested,
          resolved: final,
          reason: `${labelOf(governingRank)} constrains ${param} to [${round(min)}, ${round(max)}], so the ${labelOf(claim.rank)} request of ${requested} was resolved to ${final}.`
        });
      }
    }

    params[param] = final;

    const reportedLayer: DoctrineLayer = governing ?? "dkv_fundamentals";
    derivations.push({
      param,
      base,
      weighted_target: round(weightedTarget),
      clamped_to: { min: round(effectiveMin), max: round(effectiveMax) },
      final,
      governing_layer: reportedLayer,
      contributors: targets.map((claim) => ({
        layer: claim.layer,
        rank: claim.rank,
        value: round(claim.target ?? base),
        authority: authorityWeight(claim.rank)
      })),
      explanation:
        governing === null && targets.length === 0
          ? `${param} stayed at the default ${base}: no layer expressed an opinion.`
          : governing === null
            ? `${param} resolved to ${final} from a weighted request of ${round(weightedTarget)}; no layer narrowed its range.`
            : `${param} resolved to ${final} from a weighted request of ${round(weightedTarget)}, held inside [${round(effectiveMin)}, ${round(effectiveMax)}] by ${labelOf(governingRank)}.`
    });
  }

  return {
    params: params as DkvParams,
    derivations,
    conflicts,
    resolutions
  };
}
