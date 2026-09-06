import type { DesignDirection } from "../../types/schemas/direction.schema";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { VisualEvidence, ReviewCategory } from "../../types/schemas/visual-evidence.schema";
import type {
  VisualReviewReport,
  ReviewIssue,
  ReviewDimension,
  ReviewSeverity,
  DimensionReport,
  CategoryStatus
} from "../../types/schemas/visual-review.schema";
import { DOCTRINE_PRINCIPLES } from "../../types/schemas/visual-review.schema";
import type { CriticFinding } from "../../types/schemas/design-critic.schema";
import { deepFreeze } from "../../domain/contract";
import { resolveTextMode } from "../prompt/text-mode";
import { auditDesign, type AuditInput } from "./audit";

export type {
  VisualReviewReport,
  ReviewIssue,
  ReviewDimension,
  ReviewSeverity,
  ReviewCategory,
  EvidenceBasis,
  DimensionReport,
  CategoryStatus
} from "../../types/schemas/visual-review.schema";
export type { VisualEvidence, EvidenceObservation } from "../../types/schemas/visual-evidence.schema";
export { DOCTRINE_PRINCIPLES } from "../../types/schemas/visual-review.schema";

/**
 * Visual Review (P4.1) — the image-measuring half of the Design Critic.
 *
 * Deterministic, pure, read-only. No model, no image processing, no network.
 * It runs the P4.0 pre-generation critic (`auditDesign`), maps its findings
 * into the twelve-category / four-severity model as `design_compliance`
 * issues, and — ONLY when a matching `VisualEvidence` fixture is supplied —
 * adds `visual_quality` and `technical_quality` issues from that evidence.
 *
 * Without evidence those two dimensions are reported `unassessed`, the overall
 * score is `null`, and each carries one explicit "not assessed" issue. No
 * visual-quality or technical-quality claim is ever presented as fact without
 * evidence. The critic never mutates the recipe.
 *
 * See `docs/visual-review.md` and ADR 0009.
 */

export const VISUAL_REVIEW_SCHEMA_VERSION = "1.0.0";

export type ReviewInput = AuditInput & {
  readonly visualEvidence?: VisualEvidence | null;
};

const SEVERITY_PENALTY: Record<ReviewSeverity, number> = { P0: 0.5, P1: 0.25, P2: 0.1, P3: 0.04 };
const SEVERITY_RANK: Record<ReviewSeverity, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

const ALL_CATEGORIES: ReviewCategory[] = [
  "communication",
  "composition",
  "hierarchy",
  "typography",
  "color",
  "imagery",
  "brand_fit",
  "industry_fit",
  "cultural_fit",
  "movement_fit",
  "platform_fit",
  "technical_quality"
];

/** Each category's home dimension. Doctrine order is encoded by the list order above. */
const CATEGORY_DIMENSION: Record<ReviewCategory, ReviewDimension> = {
  communication: "design_compliance",
  composition: "visual_quality",
  hierarchy: "visual_quality",
  typography: "visual_quality",
  color: "visual_quality",
  imagery: "visual_quality",
  brand_fit: "design_compliance",
  industry_fit: "design_compliance",
  cultural_fit: "design_compliance",
  movement_fit: "design_compliance",
  platform_fit: "design_compliance",
  technical_quality: "technical_quality"
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

// --- P4.0 finding -> review issue -------------------------------------------

const DKV_PARAM_CATEGORY: Record<string, ReviewCategory> = {
  whitespace: "composition",
  visual_density: "composition",
  alignment: "composition",
  contrast: "color",
  color_complexity: "color",
  hierarchy_strength: "hierarchy",
  focal_dominance: "hierarchy",
  typographic_scale_ratio: "typography"
};

function categoryForFinding(finding: CriticFinding): ReviewCategory {
  const paramHit = finding.evidence
    .join(" ")
    .match(/\b(whitespace|visual_density|alignment|contrast|color_complexity|hierarchy_strength|focal_dominance|typographic_scale_ratio)\b/);
  if (paramHit && DKV_PARAM_CATEGORY[paramHit[1]!]) return DKV_PARAM_CATEGORY[paramHit[1]!]!;

  switch (finding.check) {
    case "movement-influence":
      return "movement_fit";
    case "artificiality-vs-target":
      return "imagery";
    case "stereotype-guard":
      return "cultural_fit";
    case "constraint-coverage":
    case "core-message-rendering":
    case "core-message-drift":
    case "objective-drift":
    case "concept-direction-drift":
    case "linkage-concept":
      return "communication";
    case "anchor-direction-unlocked":
      return "composition";
    default:
      return finding.area === "dkv" ? "color" : "communication";
  }
}

/** Deterministic doctrine framing per check slug — never model-generated. */
const FINDING_FRAME: Record<string, { why: string; impact: string; fix: string; upholds: string }> = {
  "dkv-conflict": {
    why: "A surviving DKV conflict means two doctrine layers wanted incompatible values and only one could win. Function before style: the resolved number must still serve the brief.",
    impact: "The losing layer's intent is largely absent from the finished design; the client may not recognise the direction they asked for.",
    fix: "Confirm the resolution is acceptable, or revise the brief input (industry, movement pin, audience) that created the conflict.",
    upholds: "Function before style."
  },
  "movement-influence": {
    why: "The client pinned a movement that higher-authority doctrine then overruled. Brand before trend — but a pin the client cares about should not vanish silently.",
    impact: "The generated visual will read as the industry/country default rather than the requested movement.",
    fix: "Either accept the doctrine-led direction, or relax the constraint (industry, trust pressure) that suppressed the movement.",
    upholds: "Brand before trend."
  },
  "artificiality-vs-target": {
    why: "The recipe aims for photoreal output but its own optical choices push artificiality risk up. Function before style: a realism target must be reachable.",
    impact: "The rendered image is likely to read as synthetic despite a photoreal brief.",
    fix: "Sanity-check depth of field, saturation and dynamic range in the recipe before generating.",
    upholds: "Function before style."
  },
  "stereotype-guard": {
    why: "A guarded cultural motif reached the compiled prompt. Context before stereotype: country influence is spatial and material, never a decorative shortcut.",
    impact: "The generated visual may lean on a cultural cliché the country data exists to prevent.",
    fix: "Edit the source prose (concept, movement or imagery) so the influence is expressed structurally, not as a motif.",
    upholds: "Context before stereotype."
  },
  "constraint-coverage": {
    why: "A required client constraint did not reach any compiled prompt tier. Communication before decoration: mandatories are the message.",
    impact: "The generator is not told to include something the client explicitly required; the asset will fail review.",
    fix: "Check the constraint text and the prompt compiler mapping for that constraint source.",
    upholds: "Communication before decoration."
  },
  "core-message-rendering": {
    why: "The recipe is TEXT_CRITICAL but the exact core message is not quoted in the Master Prompt. Communication before decoration.",
    impact: "The generator may paraphrase, translate or omit the headline the client signed off.",
    fix: "Ensure the core message is passed verbatim into the text-bearing zone instruction.",
    upholds: "Communication before decoration."
  }
};

const DEFAULT_FRAME = {
  why: "An integrity or linkage check failed, which means a design decision does not match the artifact it was derived from. Design decisions before prompt generation.",
  impact: "The compiled prompt may describe a design the client did not approve.",
  fix: "Re-run the pipeline for this brief; if it persists, the stored artifact has been altered.",
  upholds: "Design decisions before prompt generation."
} as const;

function issueFromFinding(finding: CriticFinding): ReviewIssue {
  const frame = FINDING_FRAME[finding.check] ?? DEFAULT_FRAME;
  return {
    dimension: "design_compliance",
    category: categoryForFinding(finding),
    severity: finding.severity, // P0/P1/P2 map straight through
    basis: "evidence-backed",
    what: finding.message,
    why: frame.why,
    impact: frame.impact,
    fix: frame.fix,
    upholds: frame.upholds,
    evidence: finding.evidence.length > 0 ? [...finding.evidence] : [`check:${finding.check}`]
  };
}

// --- low fit-score -> review issue ----------------------------------------

const FIT_CATEGORY: Record<string, ReviewCategory | null> = {
  communication_fit: "communication",
  audience_fit: "communication",
  industry_fit: "industry_fit",
  brand_fit: "brand_fit",
  culture_fit: "cultural_fit",
  movement_fit: "movement_fit",
  platform_fit: "platform_fit",
  distinctiveness: null
};

/** Below this a selected direction's fit is weak enough to be worth a note. */
export const FIT_WEAK = 0.45;

function fitIssues(direction: DesignDirection): { issues: ReviewIssue[]; brandApplicable: boolean } {
  const selected = direction.candidates.find(
    (candidate) => candidate.candidate.candidate_id === direction.selected_candidate_id
  );
  const issues: ReviewIssue[] = [];
  let brandApplicable = true;
  if (!selected) return { issues, brandApplicable };

  for (const dim of selected.score_breakdown) {
    if (dim.dimension === "brand_fit") brandApplicable = dim.applicable;
    if (!dim.applicable) continue;
    const category = FIT_CATEGORY[dim.dimension];
    if (!category) continue;
    if (dim.raw >= FIT_WEAK) continue;

    issues.push({
      dimension: "design_compliance",
      category,
      severity: "P2",
      basis: "evidence-backed",
      what: `The selected direction scores ${Math.round(dim.raw * 100)}% on ${dim.dimension.replace(/_/g, " ")} — a weak match for this brief.`,
      why: "Fit scores are how the deterministic engine measures whether a candidate serves the brief. A weak fit is not a defect, but it is worth a human glance before generating.",
      impact: "The chosen direction may under-serve this dimension relative to what a different candidate could have delivered.",
      fix: "Review the score breakdown for this candidate; if the gap matters, adjust the brief input that drives the dimension or pick a different concept.",
      upholds: "Function before style.",
      evidence: [`${dim.dimension} raw=${dim.raw}`, `weighted=${dim.weighted}`]
    });
  }
  return { issues, brandApplicable };
}

// --- visual evidence -> review issues -----------------------------------

function evidenceIssues(
  recipe: DesignRecipe,
  evidence: VisualEvidence
): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const textMode = resolveTextMode(recipe);
  const src = `observed by ${evidence.source}`;

  if (evidence.aspect_ratio.observed !== evidence.aspect_ratio.expected) {
    issues.push({
      dimension: "technical_quality",
      category: "technical_quality",
      severity: "P1",
      basis: "fixture-backed",
      what: `The rendered frame is ${evidence.aspect_ratio.observed}, not the ${evidence.aspect_ratio.expected} the recipe specifies.`,
      why: "Platform fit before detail: an asset in the wrong ratio does not place correctly and is re-cropped by the client app.",
      impact: "Composition and safe-area decisions are invalidated by the crop; the asset may be rejected outright.",
      fix: "Re-render at the recipe's aspect ratio, or set the generator's ratio parameter explicitly.",
      upholds: "Function before style.",
      evidence: [`observed ${evidence.aspect_ratio.observed}`, `expected ${evidence.aspect_ratio.expected}`, src]
    });
  }

  if (evidence.text_render.rendered_text_present && textMode === "LAYOUT_ONLY") {
    issues.push({
      dimension: "technical_quality",
      category: "technical_quality",
      severity: "P1",
      basis: "fixture-backed",
      what: "The image rendered text into zones the design reserves as clean space.",
      why: "The two-pass flow puts real typography in pass 2. Text rendered in pass 1 is almost always garbled.",
      impact: "The reserved text zones now contain unusable placeholder glyphs and must be painted out or re-rendered.",
      fix: "Strengthen the 'leave text zones clean' instruction, or regenerate; apply typography in the layout tool.",
      upholds: "Hierarchy before detail.",
      evidence: ["rendered_text_present=true", `text_mode=${textMode}`, src]
    });
  }

  if (textMode === "TEXT_CRITICAL" && evidence.text_render.core_message_legible === false) {
    issues.push({
      dimension: "technical_quality",
      category: "technical_quality",
      severity: "P0",
      basis: "fixture-backed",
      what: "The core message is not legible in the rendered frame, though the recipe is TEXT_CRITICAL.",
      why: "Communication before decoration: if the headline cannot be read, the asset has not done its job.",
      impact: "The single most important element of the brief is missing or unreadable.",
      fix: "Regenerate with the message rendered, or composite the headline in the layout tool at the specified scale.",
      upholds: "Communication before decoration.",
      evidence: ["core_message_legible=false", "text_mode=TEXT_CRITICAL", src]
    });
  }

  for (const artifact of evidence.artifacts) {
    issues.push({
      dimension: "technical_quality",
      category: "technical_quality",
      severity: "P1",
      basis: "fixture-backed",
      what: artifact,
      why: "Consistency before novelty: a visible render artifact breaks the surface the design worked to build.",
      impact: "The asset needs retouching or a re-render before it can be used.",
      fix: "Regenerate with a different seed, or repair the artifact in post.",
      upholds: "Consistency before novelty.",
      evidence: [artifact, src]
    });
  }

  for (const observation of evidence.observations) {
    if (observation.polarity !== "concern") continue;
    const category = observation.category;
    const dimension = CATEGORY_DIMENSION[category];
    const severity = observation.severity_hint ?? "P2";
    issues.push({
      dimension,
      category,
      severity,
      basis: "fixture-backed",
      what: observation.statement,
      why: doctrineWhyFor(category),
      impact: "The rendered result under-delivers on this category relative to the recipe's intent.",
      fix: "Adjust the recipe input for this category (via a P6 correction) and re-render, or select a different concept.",
      upholds: doctrinePrincipleFor(category),
      evidence: [`${observation.polarity} (${category})`, `confidence ${observation.confidence}`, src]
    });
  }

  return issues;
}

function doctrinePrincipleFor(category: ReviewCategory): string {
  switch (category) {
    case "communication":
      return "Communication before decoration.";
    case "hierarchy":
      return "Hierarchy before detail.";
    case "brand_fit":
      return "Brand before trend.";
    case "cultural_fit":
      return "Context before stereotype.";
    case "composition":
    case "typography":
    case "color":
    case "imagery":
    case "industry_fit":
    case "movement_fit":
      return "Function before style.";
    case "technical_quality":
    case "platform_fit":
      return "Consistency before novelty.";
  }
}

function doctrineWhyFor(category: ReviewCategory): string {
  return `${doctrinePrincipleFor(category)} This observation was made against the rendered frame and is reported as fixture-backed, not as a deterministic fact.`;
}

// --- assembly ----------------------------------------------------------------

function scoreDimension(issues: ReviewIssue[]): number {
  const penalty = issues.reduce((total, issue) => total + SEVERITY_PENALTY[issue.severity], 0);
  return round2(Math.max(0, Math.min(1, 1 - penalty)));
}

function sortIssues(issues: ReviewIssue[]): ReviewIssue[] {
  const catRank = (c: ReviewCategory): number => ALL_CATEGORIES.indexOf(c);
  return [...issues].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      catRank(a.category) - catRank(b.category) ||
      a.what.localeCompare(b.what)
  );
}

export function reviewDesign(input: ReviewInput): VisualReviewReport {
  const pre = auditDesign(input);
  const { recipe, direction } = input;

  const complianceIssues: ReviewIssue[] = [...pre.findings.map(issueFromFinding)];
  const { issues: fit, brandApplicable } = fitIssues(direction);
  complianceIssues.push(...fit);

  const evidence = input.visualEvidence ?? null;
  const stale = evidence !== null && evidence.recipe_hash !== recipe.recipe_hash;
  const evidenceUsable = evidence !== null && !stale;

  const renderableIssues: ReviewIssue[] = evidenceUsable ? evidenceIssues(recipe, evidence!) : [];
  const visualIssues = renderableIssues.filter((i) => i.dimension === "visual_quality");
  const technicalIssues = renderableIssues.filter((i) => i.dimension === "technical_quality");
  // fixture observations can also land on design_compliance
  complianceIssues.push(...renderableIssues.filter((i) => i.dimension === "design_compliance"));

  const dimensions: DimensionReport[] = [
    {
      dimension: "design_compliance",
      status: "assessed",
      basis: "evidence-backed",
      score: scoreDimension(complianceIssues),
      issue_count: complianceIssues.length
    },
    dimensionOrUnassessed("visual_quality", visualIssues, evidenceUsable),
    dimensionOrUnassessed("technical_quality", technicalIssues, evidenceUsable)
  ];

  const unassessedIssues: ReviewIssue[] = [];
  if (!evidenceUsable) {
    for (const dim of ["visual_quality", "technical_quality"] as const) {
      unassessedIssues.push({
        dimension: dim,
        category: dim === "visual_quality" ? "composition" : "technical_quality",
        severity: "P3",
        basis: "unassessed",
        what:
          stale
            ? `Not assessed — the supplied visual evidence was rendered from a different recipe (${evidence!.recipe_hash}), not this one (${recipe.recipe_hash}).`
            : "Not assessed — no rendered-image evidence was supplied for this recipe.",
        why: "Design decisions before prompt generation: this dimension can only be judged from an actual rendered frame, and none was provided.",
        impact: "Visual and technical quality of the finished image are unknown until a render is reviewed.",
        fix: "Render the design and supply a VisualEvidence fixture (or a human review) keyed to this recipe hash.",
        upholds: "Design decisions before prompt generation.",
        evidence: []
      });
    }
  }

  const allIssues = sortIssues([...complianceIssues, ...visualIssues, ...technicalIssues, ...unassessedIssues]);

  const actionable = allIssues.filter((i) => i.basis !== "unassessed");
  const anyP0 = actionable.some((i) => i.severity === "P0");
  const anyP1 = actionable.some((i) => i.severity === "P1");
  const verdict: VisualReviewReport["verdict"] = anyP0 ? "BLOCK" : anyP1 ? "REVIEW" : "PASS";

  const allAssessed = dimensions.every((d) => d.status === "assessed");
  const overallScore = allAssessed
    ? round2(dimensions.reduce((t, d) => t + (d.score ?? 0), 0) / dimensions.length)
    : null;
  const overallStatus = allAssessed ? "assessed" : "partially-assessed";

  const categories: CategoryStatus[] = ALL_CATEGORIES.map((category) => {
    const dimension = CATEGORY_DIMENSION[category];
    const dimReport = dimensions.find((d) => d.dimension === dimension)!;
    const status =
      category === "brand_fit" && !brandApplicable ? "unassessed" : dimReport.status;
    return {
      category,
      dimension,
      status,
      issue_count: allIssues.filter((i) => i.category === category && i.basis !== "unassessed").length
    };
  });

  const summary = buildSummary(verdict, overallScore, overallStatus, actionable);

  const report: VisualReviewReport = {
    schema_version: VISUAL_REVIEW_SCHEMA_VERSION,
    verdict,
    summary,
    doctrine: [...DOCTRINE_PRINCIPLES],
    dimensions,
    categories,
    issues: allIssues,
    overall: { score: overallScore, status: overallStatus, verdict },
    pre_generation: pre,
    audited: {
      contract_id: input.contract.id,
      direction_id: input.direction.id,
      recipe_id: recipe.id,
      recipe_hash: recipe.recipe_hash,
      prompt_language: input.promptLanguage,
      concept_ref: recipe.concept_ref,
      visual_evidence_ref: evidenceUsable ? evidence!.evidence_id : null,
      visual_evidence_stale: stale
    }
  };

  return deepFreeze(report);
}

function dimensionOrUnassessed(
  dimension: ReviewDimension,
  issues: ReviewIssue[],
  assessed: boolean
): DimensionReport {
  if (!assessed) {
    return { dimension, status: "unassessed", basis: "unassessed", score: null, issue_count: 0 };
  }
  return {
    dimension,
    status: "assessed",
    basis: "fixture-backed",
    score: scoreDimension(issues),
    issue_count: issues.length
  };
}

function buildSummary(
  verdict: string,
  score: number | null,
  status: string,
  actionable: ReviewIssue[]
): string {
  const p0 = actionable.filter((i) => i.severity === "P0").length;
  const p1 = actionable.filter((i) => i.severity === "P1").length;
  const scorePart = score === null ? "overall score not assessed (no rendered image)" : `overall ${Math.round(score * 100)}%`;
  if (verdict === "BLOCK") {
    return `Block — ${p0} critical issue${p0 === 1 ? "" : "s"}; ${scorePart}.`;
  }
  if (verdict === "REVIEW") {
    return `Review — ${p1} major issue${p1 === 1 ? "" : "s"} to check; ${scorePart}.`;
  }
  return status === "assessed"
    ? `Pass — no major issue; ${scorePart}.`
    : `Pass on what was checked; visual and technical quality ${scorePart.replace("overall score not assessed (no rendered image)", "remain unassessed until a render is reviewed")}.`;
}
