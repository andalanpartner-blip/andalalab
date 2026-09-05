import type { Constraint } from "../../types/schemas/contract.schema";
import type { BrandSnapshot } from "../../types/schemas/brand.schema";
import type { IndustryDNA } from "../../types/schemas/reference/industry.schema";
import type { VisualType } from "../../types/schemas/reference/visual-type.schema";
import type { NormalizedBrief } from "../../types/schemas/brief.schema";
import type { ResolvedCountry } from "../country/blend";
import { rankOf } from "../dkv/doctrine";

/** Deterministic, collision-free slug ids so contracts hash identically. */
function makeId(prefix: string, index: number): string {
  return `${prefix}-${String(index + 1).padStart(2, "0")}`;
}

/**
 * Gathers every hard requirement into one ranked list.
 *
 * Nothing here is resolved — two constraints may well contradict each other.
 * That is intentional: the contract records what every layer demands, and the
 * Design Direction engine in P1 resolves the contradictions using the doctrine
 * rank each constraint carries. Resolving early would hide the conflict, and
 * the conflict is the interesting part.
 */
export function collectConstraints(input: {
  brief: NormalizedBrief;
  brand: BrandSnapshot | null;
  industry: IndustryDNA;
  visualType: VisualType;
  countries: readonly ResolvedCountry[];
}): Constraint[] {
  const { brief, brand, industry, visualType, countries } = input;
  const constraints: Constraint[] = [];

  brief.mandatories.forEach((statement, index) => {
    constraints.push({
      id: makeId("brief-must", index),
      source: "brief",
      kind: "must",
      statement,
      doctrine_rank: rankOf("communication_objective")
    });
  });

  brief.prohibitions.forEach((statement, index) => {
    constraints.push({
      id: makeId("brief-must-not", index),
      source: "brief",
      kind: "must_not",
      statement,
      doctrine_rank: rankOf("communication_objective")
    });
  });

  industry.avoid.forEach((statement, index) => {
    constraints.push({
      id: makeId("industry-avoid", index),
      source: "industry",
      kind: "avoid",
      statement,
      doctrine_rank: rankOf("industry_requirements")
    });
  });

  industry.communication_needs.forEach((statement, index) => {
    constraints.push({
      id: makeId("industry-must", index),
      source: "industry",
      kind: "must",
      statement,
      doctrine_rank: rankOf("industry_requirements")
    });
  });

  if (brand) {
    brand.brand_rules.forEach((statement, index) => {
      constraints.push({
        id: makeId("brand-must", index),
        source: "brand",
        kind: "must",
        statement,
        doctrine_rank: rankOf("brand_identity")
      });
    });
    brand.prohibitions.forEach((statement, index) => {
      constraints.push({
        id: makeId("brand-must-not", index),
        source: "brand",
        kind: "must_not",
        statement,
        doctrine_rank: rankOf("brand_identity")
      });
    });
  }

  const platformRank = rankOf("platform_constraints");
  constraints.push({
    id: "visual-type-01",
    source: "visual_type",
    kind: "must",
    statement: `Use no more than ${visualType.structural_rules.max_text_blocks} distinct text blocks.`,
    doctrine_rank: platformRank
  });
  constraints.push({
    id: "visual-type-02",
    source: "visual_type",
    kind: "must",
    statement: `Keep all type at or above ${visualType.structural_rules.min_text_scale_px_at_1080}px when rendered at 1080px wide.`,
    doctrine_rank: platformRank
  });
  constraints.push({
    id: "visual-type-03",
    source: "visual_type",
    kind: "must",
    statement: `Keep load-bearing elements inside the safe area (top ${visualType.safe_area.top}, bottom ${visualType.safe_area.bottom}, left ${visualType.safe_area.left}, right ${visualType.safe_area.right} of the frame).`,
    doctrine_rank: platformRank
  });

  if (visualType.text_render_risk >= 0.6) {
    constraints.push({
      id: "visual-type-04",
      source: "visual_type",
      kind: "avoid",
      statement:
        "Do not ask the image model to render exact copy: text render risk is high for this visual type, so type is applied in a separate pass.",
      doctrine_rank: platformRank
    });
  }

  constraints.push({
    id: "platform-01",
    source: "platform",
    kind: "must",
    statement: `Resolve legibly at ${brief.platform.viewing_context} viewing distance in a ${
      visualType.structural_rules.scroll_context ? "scrolling" : "static"
    } context.`,
    doctrine_rank: platformRank
  });

  const countryRank = rankOf("country_visual_dna");
  countries.forEach(({ country }, index) => {
    constraints.push({
      id: makeId("country-avoid", index),
      source: "country",
      kind: "must_not",
      statement: `Do not express ${country.name} through motif shorthand (${country.avoid_stereotypes
        .map((entry) => entry.token)
        .join(", ")}). Influence must be carried by spatial behaviour, typographic relationships, colour relationships and materiality.`,
      doctrine_rank: countryRank
    });
  });

  return constraints;
}
