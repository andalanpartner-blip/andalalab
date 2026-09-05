import type { DatasetRegistry } from "../../types/datasets";
import type { DesignContract } from "../../types/schemas/contract.schema";
import type { Candidate } from "../../types/schemas/direction.schema";
import type { DesignMovement } from "../../types/schemas/reference/movement.schema";
import type { LayoutSystem } from "../../types/schemas/reference/layout.schema";
import { mergeBias } from "../dkv/params";
import { allMovements, movementSuitsIndustry, movementSuitsObjective } from "../movement/resolve";
import { candidateLayouts } from "../layout/resolve";
import { blendDimensions, countryForDimension, type ResolvedCountry } from "../country/blend";
import {
  deriveColorStrategy,
  deriveCompositionStrategy,
  deriveTypographyStrategy
} from "./strategies";

/**
 * Candidate generation.
 *
 * A candidate is a (movement × layout) pair. Colour, composition and
 * typography strategies are derived from that pair rather than enumerated —
 * see strategies.ts for why.
 *
 * Filtering happens here and only here. Scoring never eliminates: it ranks.
 * Keeping those two jobs apart is what makes an empty candidate set a data
 * problem with a readable explanation rather than a mysterious zero score.
 */

/** How much each source contributes to a candidate's merged DKV opinion. */
export const BIAS_WEIGHTS = { movement: 0.45, layout: 0.35, visual_type: 0.2 } as const;

export type CandidateSet = {
  readonly candidates: readonly Candidate[];
  readonly excluded: readonly { id: string; reason: string }[];
  readonly relaxations: readonly string[];
};

function prohibits(contract: DesignContract, movement: DesignMovement): boolean {
  const needles = [movement.id, movement.name.toLowerCase()];
  return contract.constraints.some((constraint) => {
    if (constraint.kind !== "must_not" && constraint.kind !== "avoid") return false;
    const statement = constraint.statement.toLowerCase();
    return needles.some((needle) => statement.includes(needle));
  });
}

export function generateCandidates(
  contract: DesignContract,
  datasets: DatasetRegistry,
  countries: readonly ResolvedCountry[]
): CandidateSet {
  const excluded: { id: string; reason: string }[] = [];
  const relaxations: string[] = [];

  const industry = datasets.industries.get(contract.industry.id);
  const visualType = datasets.visualTypes.get(contract.visual_type.id);
  if (!industry || !visualType) return { candidates: [], excluded, relaxations };

  // --- movements ----------------------------------------------------------
  let movements: DesignMovement[];

  if (contract.movement) {
    // The brief pinned a movement. That is a rank-1 instruction from the
    // client and is not overridden here — if it fights the industry, the
    // conflict is resolved by modification later, visibly, with a reason.
    const pinned = datasets.movements.get(contract.movement.id);
    movements = pinned ? [pinned] : [];
    if (pinned && !movementSuitsIndustry(pinned, industry)) {
      relaxations.push(
        `Movement "${pinned.name}" was pinned by the brief despite not being a declared fit for ${industry.name}. It is kept and constrained rather than replaced.`
      );
    }
  } else {
    const all = allMovements(datasets).filter((movement) => {
      if (prohibits(contract, movement)) {
        excluded.push({ id: movement.id, reason: "excluded by an explicit brief prohibition" });
        return false;
      }
      return true;
    });

    const industryFit = all.filter((movement) => movementSuitsIndustry(movement, industry));
    const bothFit = industryFit.filter((movement) =>
      movementSuitsObjective(movement, contract.objective)
    );

    if (bothFit.length > 0) {
      movements = bothFit;
      for (const movement of industryFit) {
        if (!bothFit.includes(movement)) {
          excluded.push({
            id: movement.id,
            reason: `does not declare support for objective "${contract.objective}"`
          });
        }
      }
    } else if (industryFit.length > 0) {
      // Relaxation rather than failure: an empty candidate set is a worse
      // answer than a scored one carrying a visible caveat.
      movements = industryFit;
      relaxations.push(
        `No movement declares support for both ${industry.name} and objective "${contract.objective}". The objective filter was relaxed; objective fit is still scored.`
      );
    } else {
      movements = all;
      relaxations.push(
        `No movement declares support for ${industry.name}. All movements were considered and industry fit is scored instead of filtered.`
      );
    }

    for (const movement of all) {
      if (!industryFit.includes(movement) && industryFit.length > 0) {
        excluded.push({ id: movement.id, reason: `not a declared fit for ${industry.name}` });
      }
    }
  }

  // --- layouts ------------------------------------------------------------
  let layouts: readonly LayoutSystem[];
  if (contract.layout) {
    const pinned = datasets.layouts.get(contract.layout.id);
    layouts = pinned ? [pinned] : [];
  } else {
    layouts = candidateLayouts(datasets, visualType);
  }

  // --- pairs --------------------------------------------------------------
  const owners = blendDimensions(countries);
  const compositionCountry = countryForDimension(countries, owners, "composition");
  const typographyCountry = countryForDimension(countries, owners, "typography");
  const colorCountry = countryForDimension(countries, owners, "color");
  const countrySaturation = colorCountry?.color.saturation_bias ?? 0.5;

  const candidates: Candidate[] = [];
  for (const movement of [...movements].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const layout of [...layouts].sort((a, b) => a.id.localeCompare(b.id))) {
      const { strategy: colorStrategy } = deriveColorStrategy(movement, countrySaturation, industry);
      candidates.push({
        candidate_id: `${movement.id}__${layout.id}`,
        movement_id: movement.id,
        movement_name: movement.name,
        layout_id: layout.id,
        layout_name: layout.name,
        color_strategy: colorStrategy,
        composition_strategy: deriveCompositionStrategy(movement, layout, compositionCountry),
        typography_strategy: deriveTypographyStrategy(movement, layout, typographyCountry),
        bias: mergeBias([
          { bias: movement.dkv_bias, weight: BIAS_WEIGHTS.movement },
          { bias: layout.dkv_bias, weight: BIAS_WEIGHTS.layout },
          { bias: visualType.dkv_bias, weight: BIAS_WEIGHTS.visual_type }
        ])
      });
    }
  }

  return {
    candidates,
    excluded: excluded.sort((a, b) => a.id.localeCompare(b.id)),
    relaxations
  };
}
