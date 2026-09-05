import type { DatasetRegistry } from "../../types/datasets";
import type { BrandSnapshot } from "../../types/schemas/brand.schema";
import type { NormalizedBrief } from "../../types/schemas/brief.schema";
import type { DesignContract } from "../../types/schemas/contract.schema";
import type { DkvRule } from "../../types/schemas/dkv.schema";
import { NormalizedBrief as NormalizedBriefSchema } from "../../types/schemas/brief.schema";
import { DesignContract as DesignContractSchema } from "../../types/schemas/contract.schema";
import { SCHEMA_VERSIONS } from "../../types/versions";
import { canonicalise, fnv1a } from "../../types/primitives";

import type { ContractIssue } from "../../domain/errors";
import { issue } from "../../domain/errors";
import { deepFreeze } from "../../domain/contract";
import type { ClockPort } from "../../ports/clock.port";
import type { IdPort } from "../../ports/id.port";

import { err, ok, type Result } from "../util/result";
import { rankOf } from "../dkv/doctrine";
import { blendScalar, normaliseBlend, type ResolvedCountry } from "../country/blend";
import { collectBannedTokens } from "../country/anti-stereotype";
import { industryDkvBands, resolveIndustry } from "../industry/resolve";
import { resolveAspectRatio, resolveVisualType, visualTypeDkvBands } from "../visual-type/resolve";
import { layoutSupportsVisualType, resolveLayout } from "../layout/resolve";
import { collectConstraints } from "./constraints";
import { deriveAnchors } from "./anchors";

export type BuildContractInput = {
  readonly projectId: string;
  readonly brief: NormalizedBrief;
  readonly brand: BrandSnapshot | null;
  readonly datasets: DatasetRegistry;
  readonly clock: ClockPort;
  readonly ids: IdPort;
  readonly createdBy?: string;
};

/**
 * Build the Design Contract.
 *
 * This is the single most important function in P0 — everything downstream
 * (direction, concept, recipe, prompt, critic, campaign) reads from what this
 * produces. Three properties matter more than anything else here:
 *
 *  1. It is pure. Datasets, time and identity are injected, so the same inputs
 *     always produce the same contract and the same hash.
 *  2. It decides nothing. It resolves references, gathers what every layer
 *     demands, and records the ranks. Choosing between competing demands is
 *     P1's job and must not leak backwards into the contract.
 *  3. It reports every problem at once. A brief with four bad references gets
 *     four messages, not one.
 */
export function buildDesignContract(
  input: BuildContractInput
): Result<DesignContract, ContractIssue[]> {
  const issues: ContractIssue[] = [];

  const briefResult = NormalizedBriefSchema.safeParse(input.brief);
  if (!briefResult.success) {
    return err(
      briefResult.error.issues.map((problem) =>
        issue("brief_invalid", problem.path.join(".") || "(root)", problem.message)
      )
    );
  }
  const brief = briefResult.data;
  const { datasets } = input;

  // --- resolve references -------------------------------------------------
  const industry = resolveIndustry(datasets, brief.industry_id);
  if (!industry) {
    issues.push(
      issue("unknown_industry", "industry_id", `no industry dataset with id "${brief.industry_id}"`)
    );
  }

  const visualType = resolveVisualType(datasets, brief.visual_type_id);
  if (!visualType) {
    issues.push(
      issue(
        "unknown_visual_type",
        "visual_type_id",
        `no visual type dataset with id "${brief.visual_type_id}"`
      )
    );
  }

  if (visualType && !resolveAspectRatio(visualType, brief.platform.aspect_ratio_id)) {
    issues.push(
      issue(
        "unknown_aspect_ratio",
        "platform.aspect_ratio_id",
        `"${brief.platform.aspect_ratio_id}" is not offered by visual type "${visualType.id}" (available: ${visualType.aspect_ratios
          .map((ratio) => ratio.id)
          .join(", ")})`
      )
    );
  }

  const normalisedBlend = normaliseBlend(brief.country);
  const countries: ResolvedCountry[] = [];
  for (const [countryId, weight] of Object.entries(normalisedBlend).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const country = datasets.countries.get(countryId);
    if (!country) {
      issues.push(issue("unknown_country", `country.${countryId}`, `no country dataset with id "${countryId}"`));
      continue;
    }
    countries.push({ country, weight });
  }

  const movement = brief.movement_id ? datasets.movements.get(brief.movement_id) ?? null : null;
  if (brief.movement_id && !movement) {
    issues.push(
      issue("unknown_movement", "movement_id", `no movement dataset with id "${brief.movement_id}"`)
    );
  }

  const layout = brief.layout_id ? resolveLayout(datasets, brief.layout_id) : null;
  if (brief.layout_id && !layout) {
    issues.push(issue("unknown_layout", "layout_id", `no layout dataset with id "${brief.layout_id}"`));
  }
  if (layout && visualType && !layoutSupportsVisualType(layout, visualType)) {
    issues.push(
      issue(
        "layout_not_supported_by_visual_type",
        "layout_id",
        `layout "${layout.id}" does not support visual type "${visualType.id}"`
      )
    );
  }

  // --- brand snapshot -----------------------------------------------------
  if (brief.brand_id && !input.brand) {
    issues.push(
      issue("brand_required", "brand", `brief references brand "${brief.brand_id}" but no snapshot was supplied`)
    );
  }
  if (brief.brand_id && input.brand && input.brand.brand_id !== brief.brand_id) {
    issues.push(
      issue(
        "brand_mismatch",
        "brand.brand_id",
        `brief references "${brief.brand_id}" but the supplied snapshot is "${input.brand.brand_id}"`
      )
    );
  }
  const brand = brief.brand_id ? input.brand : null;

  if (issues.length > 0 || !industry || !visualType) return err(issues);

  // --- DKV bands ----------------------------------------------------------
  // Bands say what is legal, not what is chosen. Competing bands are left
  // competing; P1 resolves them by doctrine rank.
  const dkvRules: DkvRule[] = [...industryDkvBands(industry), ...visualTypeDkvBands(visualType)];

  if (countries.length > 0) {
    const countryRank = rankOf("country_visual_dna");
    dkvRules.push(
      {
        param: "whitespace",
        min: 0,
        max: 1,
        target: blendScalar(countries, (country) => country.composition.whitespace_bias),
        source: `country blend whitespace bias (${countries.map((entry) => entry.country.id).join(" + ")})`,
        doctrine_rank: countryRank
      },
      {
        param: "visual_density",
        min: 0,
        max: 1,
        target: blendScalar(countries, (country) => country.composition.density_bias),
        source: `country blend density bias (${countries.map((entry) => entry.country.id).join(" + ")})`,
        doctrine_rank: countryRank
      },
      {
        param: "color_complexity",
        min: 0,
        max: 1,
        target: blendScalar(countries, (country) => country.color.saturation_bias),
        source: `country blend saturation bias (${countries.map((entry) => entry.country.id).join(" + ")})`,
        doctrine_rank: countryRank
      }
    );
  }

  dkvRules.sort((a, b) =>
    a.doctrine_rank === b.doctrine_rank
      ? a.param.localeCompare(b.param) || a.source.localeCompare(b.source)
      : a.doctrine_rank - b.doctrine_rank
  );

  // --- constraints, anchors, banned tokens --------------------------------
  const constraints = collectConstraints({ brief, brand, industry, visualType, countries });
  const anchors = deriveAnchors(brief, brand);

  // Stereotype filtering is a default, not a censor: a token the brief asks for
  // explicitly is released, and the release is recorded as a visible constraint.
  const explicitMentions = [...brief.mandatories, brief.core_message, brief.raw_input];
  const tokenReport = collectBannedTokens(countries, explicitMentions);
  tokenReport.released.forEach((release, index) => {
    constraints.push({
      id: `country-override-${String(index + 1).padStart(2, "0")}`,
      source: "brief",
      kind: "prefer",
      statement: `Stereotype guard released for "${release.token}" — ${release.reason}.`,
      doctrine_rank: rankOf("communication_objective")
    });
  });

  // --- assemble -----------------------------------------------------------
  const body = {
    project_id: input.projectId,
    schema_version: SCHEMA_VERSIONS.contract,
    dataset_version: datasets.version,
    created_by: input.createdBy ?? "system",
    brief_id: brief.brief_id,
    objective: brief.objective,
    core_message: brief.core_message,
    audience: brief.audience,
    industry: { id: industry.id, name: industry.name },
    visual_type: {
      id: visualType.id,
      name: visualType.name,
      aspect_ratio_id: brief.platform.aspect_ratio_id
    },
    layout: layout ? { id: layout.id, name: layout.name } : null,
    movement: movement ? { id: movement.id, name: movement.name } : null,
    brand,
    country: normalisedBlend,
    platform: brief.platform,
    dkv_rules: dkvRules,
    constraints,
    anchors,
    banned_tokens: tokenReport.banned,
    concept_id: null,
    frozen: true as const
  };

  // The hash covers the body only. Id and timestamp are injected per run, so
  // excluding them is what makes "same brief in, same contract out" testable.
  const contract = {
    ...body,
    id: input.ids.next("contract"),
    created_at: input.clock.now().toISOString(),
    contract_hash: fnv1a(canonicalise(body))
  };

  const validated = DesignContractSchema.safeParse(contract);
  if (!validated.success) {
    return err(
      validated.error.issues.map((problem) =>
        issue("contract_invalid", problem.path.join(".") || "(root)", problem.message)
      )
    );
  }

  return ok(deepFreeze(validated.data));
}
