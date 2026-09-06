import type { DesignContract } from "../../types/schemas/contract.schema";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { LayoutBlueprint } from "../../types/schemas/layout-blueprint.schema";
import type { VisualEvidenceReport } from "../../types/schemas/visual-evidence-report.schema";
import type {
  CritiqueClassification,
  CritiqueDimension,
  CritiqueFinding,
  DesignCritique
} from "../../types/schemas/design-critique.schema";
import { DesignCritique as DesignCritiqueSchema } from "../../types/schemas/design-critique.schema";
import { DOCTRINE_PRINCIPLES } from "../../types/schemas/visual-review.schema";
import { SCHEMA_VERSIONS } from "../../types/versions";
import { canonicalise, fnv1a } from "../../types/primitives";
import { deepFreeze } from "../../domain/contract";
import { resolveTextMode } from "../prompt/text-mode";
import { err, ok, type Result } from "../util/result";
import type { DirectionIssue } from "../../domain/errors";
import { directionIssue } from "../../domain/errors";

/**
 * The vision-aware Design Critic (P2.15).
 *
 * `DesignRecipe + LayoutBlueprint + DesignContract + VisualEvidenceReport →
 * DesignCritique`.
 *
 * Pure and deterministic. No model, no image processing, no network, no clock,
 * no RNG. Every finding is a comparison between one intent signal (read from
 * the recipe or the blueprint) and one observed value (read from the evidence).
 * It never mutates any input and never decides a correction — it reports
 * mismatches; the P2.16 recommender maps them to bounded options.
 *
 * A finding is `unassessed` (never guessed) when the evidence did not observe
 * the value the dimension needs. The critique is `UNASSESSED` overall only when
 * nothing at all could be compared.
 */

export const VISION_CRITIQUE_RESOLVER_VERSION = "1.0.0";

export type VisionCritiqueInput = {
  readonly recipe: DesignRecipe;
  readonly contract: DesignContract;
  readonly blueprint: LayoutBlueprint | null;
  readonly evidence: VisualEvidenceReport;
  /** The prompt language the render was generated in — provenance only. */
  readonly promptLanguage?: string;
};

const CLASS_RANK: Record<CritiqueClassification, number> = {
  major_mismatch: 0,
  minor_mismatch: 1,
  compliant: 2,
  unassessed: 3
};

const SEVERITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;

const DIMENSION_ORDER: CritiqueDimension[] = [
  "aspect_ratio",
  "platform_format",
  "focal_alignment",
  "subject_placement",
  "composition_alignment",
  "whitespace_alignment",
  "density_alignment",
  "text_region_alignment",
  "safe_area_alignment",
  "color_relationship"
];

const round2 = (n: number): number => Math.round(n * 100) / 100;
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const ratioString = (w: number, h: number): string => {
  const g = gcd(Math.round(w), Math.round(h)) || 1;
  return `${Math.round(w / g)}:${Math.round(h / g)}`;
};

type Draft = Omit<CritiqueFinding, "confidence"> & { confidence: number };

/** Build one finding. Keeps the shape consistent and the comparison explicit. */
function finding(args: {
  code: string;
  dimension: CritiqueDimension;
  classification: CritiqueClassification;
  title: string;
  intendedSignal: string;
  intendedValue: string;
  observedValue: string;
  evidenceRef: string;
  comparison: string;
  confidence: number;
  zone?: string | null;
  parameter?: string | null;
}): Draft {
  const severity: CritiqueFinding["severity"] =
    args.classification === "major_mismatch"
      ? "P1"
      : args.classification === "minor_mismatch"
        ? "P2"
        : "P3";
  return {
    code: args.code,
    dimension: args.dimension,
    classification: args.classification,
    severity,
    title: args.title,
    intended: { signal: args.intendedSignal, value: args.intendedValue },
    observed: { value: args.observedValue, evidence_ref: args.evidenceRef },
    comparison: args.comparison,
    confidence: args.classification === "unassessed" ? 0 : round2(Math.max(0, Math.min(1, args.confidence))),
    basis: args.classification === "unassessed" ? "unassessed" : "evidence-backed",
    affected: {
      zone: (args.zone ?? null) as CritiqueFinding["affected"]["zone"],
      parameter: args.parameter ?? null
    }
  };
}

function bandClassification(delta: number, minor: number, major: number): CritiqueClassification {
  const abs = Math.abs(delta);
  if (abs >= major) return "major_mismatch";
  if (abs >= minor) return "minor_mismatch";
  return "compliant";
}

function unassessed(
  dimension: CritiqueDimension,
  code: string,
  title: string,
  intendedSignal: string,
  intendedValue: string,
  evidenceRef: string
): Draft {
  return finding({
    code,
    dimension,
    classification: "unassessed",
    title,
    intendedSignal,
    intendedValue,
    observedValue: "not observed",
    evidenceRef,
    comparison: `Not assessed — the visual evidence did not observe ${evidenceRef}.`,
    confidence: 0
  });
}

export function evaluateVisionCritique(
  input: VisionCritiqueInput
): Result<DesignCritique, DirectionIssue[]> {
  const { recipe, contract, blueprint, evidence } = input;

  // --- provenance / staleness gate (never silently repaired) --------
  if (evidence.provenance.recipe_hash !== recipe.recipe_hash) {
    return err([
      directionIssue(
        "recipe_invalid",
        "evidence.provenance.recipe_hash",
        `the visual evidence was made against recipe ${evidence.provenance.recipe_hash}, not this one (${recipe.recipe_hash})`
      )
    ]);
  }
  if (
    blueprint &&
    evidence.provenance.blueprint_hash !== null &&
    evidence.provenance.blueprint_hash !== blueprint.blueprint_hash
  ) {
    return err([
      directionIssue(
        "recipe_invalid",
        "evidence.provenance.blueprint_hash",
        `the visual evidence was made against blueprint ${evidence.provenance.blueprint_hash}, not this one (${blueprint.blueprint_hash})`
      )
    ]);
  }

  const obs = evidence.observations;
  const evidenceConfidence = evidence.confidence.overall ?? 0.6;
  const drafts: Draft[] = [];

  // --- 1. aspect ratio --------------------------------------------
  {
    const intended = blueprint
      ? ratioString(blueprint.canvas.width, blueprint.canvas.height)
      : recipe.platform.aspect_ratio_id;
    const observed = evidence.image.aspect_ratio;
    const match = observed === intended;
    drafts.push(
      finding({
        code: "aspect-ratio",
        dimension: "aspect_ratio",
        classification: match ? "compliant" : "major_mismatch",
        title: match ? "Aspect ratio matches the target" : "Rendered aspect ratio does not match the target",
        intendedSignal: blueprint ? "blueprint.canvas" : "recipe.platform.aspect_ratio_id",
        intendedValue: intended,
        observedValue: observed,
        evidenceRef: "image.aspect_ratio",
        comparison: match
          ? `Intended ${intended}; observed ${observed}.`
          : `Intended ${intended} but the rendered frame is ${observed} — the composition is being re-cropped.`,
        confidence: 0.95
      })
    );
  }

  // --- 2. platform / crop behaviour -------------------------------
  {
    const crop = obs.crop_behavior;
    if (crop === null) {
      drafts.push(
        unassessed(
          "platform_format",
          "crop-behaviour",
          "Crop behaviour not observed",
          "generation target",
          "as-requested",
          "observations.crop_behavior"
        )
      );
    } else {
      const classification: CritiqueClassification =
        crop === "cropped" ? "major_mismatch" : crop === "padded" ? "minor_mismatch" : "compliant";
      drafts.push(
        finding({
          code: "crop-behaviour",
          dimension: "platform_format",
          classification,
          title:
            classification === "compliant"
              ? "Frame fills the requested format"
              : `Rendered frame was ${crop}`,
          intendedSignal: "generation target",
          intendedValue: "as-requested",
          observedValue: crop,
          evidenceRef: "observations.crop_behavior",
          comparison: `Intended an as-requested frame; observed "${crop}".`,
          confidence: 0.8
        })
      );
    }
  }

  // --- 3. focal alignment ---------------------------------------
  if (blueprint) {
    const focalZone = blueprint.zones.find((z) => z.id === blueprint.focal.zone) ?? null;
    const dominant = obs.dominant_region_id
      ? obs.regions.find((r) => r.id === obs.dominant_region_id) ?? null
      : null;
    if (!dominant) {
      drafts.push(
        unassessed(
          "focal_alignment",
          "focal-alignment",
          "Dominant region not observed",
          "blueprint.focal.zone",
          `${blueprint.focal.zone} at (${round2(blueprint.focal.x)}, ${round2(blueprint.focal.y)})`,
          "observations.dominant_region_id"
        )
      );
    } else {
      const cx = dominant.rect.x + dominant.rect.w / 2;
      const cy = dominant.rect.y + dominant.rect.h / 2;
      const distance = Math.hypot(cx - blueprint.focal.x, cy - blueprint.focal.y);
      const focalIsText = focalZone?.text_bearing ?? false;
      const dominantIsText = dominant.kind === "text";
      let classification = bandClassification(distance, 0.15, 0.28);
      let note = `Intended focal at (${round2(blueprint.focal.x)}, ${round2(blueprint.focal.y)}) in "${blueprint.focal.zone}"; observed dominant region centred at (${round2(cx)}, ${round2(cy)}) — ${round2(distance)} away.`;
      if (!focalIsText && dominantIsText) {
        classification = "major_mismatch";
        note = `Intended focal is the non-text "${blueprint.focal.zone}" zone, but the observed dominant region is a text block.`;
      }
      drafts.push(
        finding({
          code: "focal-alignment",
          dimension: "focal_alignment",
          classification,
          title:
            classification === "compliant"
              ? "Focal region sits where the layout intends"
              : "Observed focal region diverges from the intended one",
          intendedSignal: "blueprint.focal",
          intendedValue: `${blueprint.focal.zone} @ (${round2(blueprint.focal.x)}, ${round2(blueprint.focal.y)}), dominance ${round2(blueprint.focal.dominance)}`,
          observedValue: `${dominant.kind} region ${dominant.id} @ (${round2(cx)}, ${round2(cy)})`,
          evidenceRef: dominant.id,
          comparison: note,
          confidence: Math.min(evidenceConfidence, dominant.confidence),
          zone: blueprint.focal.zone,
          parameter: "hierarchy.focal_dominance"
        })
      );
    }
  }

  // --- 4. subject placement -----------------------------------
  if (blueprint) {
    const subject = obs.approx_subject_position;
    if (!subject) {
      drafts.push(
        unassessed(
          "subject_placement",
          "subject-placement",
          "Subject position not observed",
          "blueprint.focal",
          `(${round2(blueprint.focal.x)}, ${round2(blueprint.focal.y)})`,
          "observations.approx_subject_position"
        )
      );
    } else {
      const distance = Math.hypot(subject.x - blueprint.focal.x, subject.y - blueprint.focal.y);
      const classification = bandClassification(distance, 0.18, 0.32);
      drafts.push(
        finding({
          code: "subject-placement",
          dimension: "subject_placement",
          classification,
          title:
            classification === "compliant"
              ? "Main subject sits near the intended focal point"
              : "Main subject is placed away from the intended focal point",
          intendedSignal: "blueprint.focal",
          intendedValue: `(${round2(blueprint.focal.x)}, ${round2(blueprint.focal.y)})`,
          observedValue: `(${round2(subject.x)}, ${round2(subject.y)})`,
          evidenceRef: "observations.approx_subject_position",
          comparison: `Intended subject near (${round2(blueprint.focal.x)}, ${round2(blueprint.focal.y)}); observed near (${round2(subject.x)}, ${round2(subject.y)}) — ${round2(distance)} away.`,
          confidence: evidenceConfidence,
          parameter: "hierarchy.focal_dominance"
        })
      );
    }
  }

  // --- 5. composition / region count ------------------------
  if (blueprint) {
    const intended = blueprint.zones.length;
    const observed = obs.region_count;
    if (observed === null) {
      drafts.push(
        unassessed(
          "composition_alignment",
          "region-count",
          "Region count not observed",
          "blueprint.zones",
          `${intended} zones`,
          "observations.region_count"
        )
      );
    } else {
      const delta = observed - intended;
      const classification = Math.abs(delta) >= 3 ? "minor_mismatch" : "compliant";
      drafts.push(
        finding({
          code: "region-count",
          dimension: "composition_alignment",
          classification,
          title:
            classification === "compliant"
              ? "Rendered region count is close to the planned zone count"
              : "Rendered region count diverges from the planned zone count",
          intendedSignal: "blueprint.zones.length",
          intendedValue: `${intended}`,
          observedValue: `${observed}`,
          evidenceRef: "observations.region_count",
          comparison: `Planned ${intended} zones; observed ${observed} regions (${delta > 0 ? "+" : ""}${delta}).`,
          confidence: evidenceConfidence
        })
      );
    }
  }

  // --- 6. whitespace ---------------------------------------
  pushRatioBand(drafts, {
    code: "whitespace-alignment",
    dimension: "whitespace_alignment",
    title: "Whitespace",
    intendedSignal: "recipe.composition.whitespace",
    intendedValue: recipe.composition.whitespace,
    observed: obs.whitespace_share,
    evidenceRef: "observations.whitespace_share",
    parameter: "whitespace",
    minor: 0.15,
    major: 0.28,
    confidence: evidenceConfidence
  });

  // --- 7. visual density ----------------------------------
  pushRatioBand(drafts, {
    code: "density-alignment",
    dimension: "density_alignment",
    title: "Visual density",
    intendedSignal: "recipe.composition.density",
    intendedValue: recipe.composition.density,
    observed: obs.approx_visual_density,
    evidenceRef: "observations.approx_visual_density",
    parameter: "visual_density",
    minor: 0.15,
    major: 0.28,
    confidence: evidenceConfidence
  });

  // --- 8. text region alignment --------------------------
  {
    const textMode = resolveTextMode(recipe);
    const intendedTextZones = blueprint
      ? blueprint.zones.filter((z) => z.text_bearing).length
      : recipe.hierarchy.levels.length;
    const observed = obs.text_region_count;
    if (observed === null) {
      drafts.push(
        unassessed(
          "text_region_alignment",
          "text-region-alignment",
          "Text region count not observed",
          "blueprint.zones (text-bearing)",
          `${intendedTextZones}`,
          "observations.text_region_count"
        )
      );
    } else if (textMode === "LAYOUT_ONLY" && observed > 0) {
      drafts.push(
        finding({
          code: "text-region-alignment",
          dimension: "text_region_alignment",
          classification: "major_mismatch",
          title: "Text was rendered into a layout-only design",
          intendedSignal: "engine/prompt/text-mode",
          intendedValue: "LAYOUT_ONLY (0 rendered text regions)",
          observedValue: `${observed} text regions`,
          evidenceRef: "observations.text_region_count",
          comparison: `The recipe is LAYOUT_ONLY — typography is set in a later pass — but ${observed} text region${observed === 1 ? "" : "s"} were rendered.`,
          confidence: evidenceConfidence,
          parameter: null
        })
      );
    } else {
      const delta = observed - intendedTextZones;
      const classification = Math.abs(delta) >= 2 ? "minor_mismatch" : "compliant";
      drafts.push(
        finding({
          code: "text-region-alignment",
          dimension: "text_region_alignment",
          classification,
          title:
            classification === "compliant"
              ? "Rendered text region count is close to the plan"
              : "Rendered text region count diverges from the plan",
          intendedSignal: "blueprint.zones (text-bearing)",
          intendedValue: `${intendedTextZones}`,
          observedValue: `${observed}`,
          evidenceRef: "observations.text_region_count",
          comparison: `Planned ${intendedTextZones} text-bearing zones; observed ${observed} (${delta > 0 ? "+" : ""}${delta}).`,
          confidence: evidenceConfidence
        })
      );
    }
  }

  // --- 9. safe-area / edge bleed -------------------------
  if (blueprint) {
    const bleedZones = blueprint.zones.filter(
      (z) => ["image", "hero", "product"].includes(z.id) && !z.within_safe_area
    );
    const observed = obs.edge_bleed;
    if (observed === null) {
      drafts.push(
        unassessed(
          "safe_area_alignment",
          "edge-bleed",
          "Edge bleed not observed",
          "blueprint.safe_area",
          bleedZones.length > 0 ? "image bleed expected" : "no bleed expected",
          "observations.edge_bleed"
        )
      );
    } else {
      const bleedExpected = bleedZones.length > 0;
      const bleedObserved = observed !== "none";
      const classification: CritiqueClassification =
        bleedExpected === bleedObserved ? "compliant" : "minor_mismatch";
      drafts.push(
        finding({
          code: "edge-bleed",
          dimension: "safe_area_alignment",
          classification,
          title:
            classification === "compliant"
              ? "Edge behaviour matches the layout intent"
              : "Edge behaviour diverges from the layout intent",
          intendedSignal: "blueprint.safe_area + bleeding zones",
          intendedValue: bleedExpected ? "image bleeds to the edge" : "content stays inside the safe area",
          observedValue: `edge_bleed=${observed}`,
          evidenceRef: "observations.edge_bleed",
          comparison: `Intended ${bleedExpected ? "an image bleed" : "no bleed"}; observed edge_bleed="${observed}".`,
          confidence: evidenceConfidence
        })
      );
    }
  }

  // --- 10. colour relationship --------------------------
  {
    const observedPalette = obs.color?.approx_palette_size ?? null;
    const observedContrast = obs.color?.approx_contrast ?? null;
    if (observedPalette === null && observedContrast === null) {
      drafts.push(
        unassessed(
          "color_relationship",
          "colour-relationship",
          "Colour summary not observed",
          "recipe.color",
          `${recipe.color.palette_size}-colour palette, contrast ${round2(recipe.color.contrast)}`,
          "observations.color"
        )
      );
    } else {
      const paletteDelta = observedPalette === null ? 0 : observedPalette - recipe.color.palette_size;
      const contrastDelta = observedContrast === null ? 0 : observedContrast - recipe.color.contrast;
      const classification: CritiqueClassification =
        Math.abs(paletteDelta) >= 3 || Math.abs(contrastDelta) >= 0.3
          ? "minor_mismatch"
          : "compliant";
      drafts.push(
        finding({
          code: "colour-relationship",
          dimension: "color_relationship",
          classification,
          title:
            classification === "compliant"
              ? "Rendered colour relationship is close to the recipe"
              : "Rendered colour relationship diverges from the recipe",
          intendedSignal: "recipe.color",
          intendedValue: `${recipe.color.palette_size} colours, contrast ${round2(recipe.color.contrast)}`,
          observedValue: `${observedPalette ?? "?"} colours, contrast ${observedContrast === null ? "?" : round2(observedContrast)}`,
          evidenceRef: "observations.color",
          comparison: `Recipe: ${recipe.color.palette_size} colours / contrast ${round2(recipe.color.contrast)}. Observed: ${observedPalette ?? "?"} / ${observedContrast === null ? "?" : round2(observedContrast)}.`,
          confidence: evidenceConfidence,
          parameter: Math.abs(contrastDelta) >= 0.3 ? "contrast" : "color_complexity"
        })
      );
    }
  }

  // --- assembly ------------------------------------------
  const findings = [...drafts].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      CLASS_RANK[a.classification] - CLASS_RANK[b.classification] ||
      DIMENSION_ORDER.indexOf(a.dimension) - DIMENSION_ORDER.indexOf(b.dimension) ||
      a.code.localeCompare(b.code)
  );

  const dimensions = DIMENSION_ORDER.map((dimension) => {
    const forDim = findings.filter((f) => f.dimension === dimension);
    const worst = forDim.reduce<CritiqueClassification>((acc, f) => {
      return CLASS_RANK[f.classification] < CLASS_RANK[acc] ? f.classification : acc;
    }, "unassessed");
    return {
      dimension,
      classification: forDim.length === 0 ? ("unassessed" as CritiqueClassification) : worst,
      finding_count: forDim.length
    };
  });

  const unassessedDimensions = dimensions
    .filter((d) => d.classification === "unassessed")
    .map((d) => d.dimension);

  const assessedFindings = findings.filter((f) => f.basis === "evidence-backed");
  const anyMajor = assessedFindings.some((f) => f.classification === "major_mismatch");
  const anyMinor = assessedFindings.some((f) => f.classification === "minor_mismatch");
  const verdict: DesignCritique["verdict"] =
    assessedFindings.length === 0 ? "UNASSESSED" : anyMajor ? "REVIEW" : anyMinor ? "REVIEW" : "PASS";

  const majorCount = assessedFindings.filter((f) => f.classification === "major_mismatch").length;
  const minorCount = assessedFindings.filter((f) => f.classification === "minor_mismatch").length;
  const summary =
    verdict === "UNASSESSED"
      ? "The evidence did not observe any value that could be compared to the design intent."
      : verdict === "PASS"
        ? `Every assessed dimension matches the intent (${assessedFindings.length} compared, ${unassessedDimensions.length} not assessed).`
        : `${majorCount} major and ${minorCount} minor mismatch${majorCount + minorCount === 1 ? "" : "es"} between the rendered visual and the design intent; ${unassessedDimensions.length} dimension${unassessedDimensions.length === 1 ? "" : "s"} not assessed.`;

  const body = {
    schema_version: SCHEMA_VERSIONS.designCritique,
    resolver_version: VISION_CRITIQUE_RESOLVER_VERSION,
    dataset_version: evidence.dataset_version,
    provenance: {
      evidence_id: evidence.evidence_id,
      evidence_hash: evidence.evidence_hash,
      artifact_hash: evidence.provenance.artifact_hash,
      contract_id: contract.id,
      recipe_id: recipe.id,
      recipe_hash: recipe.recipe_hash,
      blueprint_id: blueprint ? blueprint.derived_from.recipe_id : evidence.provenance.blueprint_id,
      blueprint_hash: blueprint ? blueprint.blueprint_hash : evidence.provenance.blueprint_hash,
      prompt_hash: evidence.provenance.prompt_hash,
      generation_request_hash: evidence.provenance.generation_request_hash
    },
    verdict,
    summary,
    findings,
    dimensions,
    doctrine: [...DOCTRINE_PRINCIPLES],
    unassessed_dimensions: unassessedDimensions
  };

  const critique = {
    ...body,
    critique_id: `critique_${fnv1a(canonicalise(body))}`,
    created_at: evidence.created_at,
    critique_hash: fnv1a(canonicalise(body))
  };

  const validated = DesignCritiqueSchema.safeParse(critique);
  if (!validated.success) {
    return err(
      validated.error.issues.map((problem) =>
        directionIssue("recipe_invalid", problem.path.join(".") || "(root)", problem.message)
      )
    );
  }
  return ok(deepFreeze(validated.data));
}

type RatioBandArgs = {
  code: string;
  dimension: CritiqueDimension;
  title: string;
  intendedSignal: string;
  intendedValue: number;
  observed: number | null;
  evidenceRef: string;
  parameter: string;
  minor: number;
  major: number;
  confidence: number;
};

function pushRatioBand(drafts: Draft[], args: RatioBandArgs): void {
  if (args.observed === null) {
    drafts.push(
      unassessed(args.dimension, args.code, `${args.title} not observed`, args.intendedSignal, `${round2(args.intendedValue)}`, args.evidenceRef)
    );
    return;
  }
  const delta = args.observed - args.intendedValue;
  const classification = bandClassification(delta, args.minor, args.major);
  drafts.push(
    finding({
      code: args.code,
      dimension: args.dimension,
      classification,
      title:
        classification === "compliant"
          ? `${args.title} matches the recipe`
          : `${args.title} diverges from the recipe`,
      intendedSignal: args.intendedSignal,
      intendedValue: `${round2(args.intendedValue)}`,
      observedValue: `${round2(args.observed)}`,
      evidenceRef: args.evidenceRef,
      comparison: `Recipe ${round2(args.intendedValue)}; observed ${round2(args.observed)} (${delta > 0 ? "+" : ""}${round2(delta)}).`,
      confidence: args.confidence,
      parameter: args.parameter
    })
  );
}
