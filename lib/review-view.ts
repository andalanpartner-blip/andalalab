/**
 * Presentation-only logic for the Review stage (UI/UX-04).
 *
 * The Review stage puts an already-generated visual next to the design intent
 * and the compliance the pipeline already produced. It computes NO design
 * decision, NO score, NO critique, and never inspects image pixels — every
 * value is read from an existing artifact (recipe, contract, concept,
 * blueprint, GenerationRequest, GeneratedArtifact) or from the existing
 * DesignCriticReport / VisualReviewReport, which are rendered unchanged by
 * `ReviewSummary`.
 */
import type { DesignRecipe } from "../types/schemas/recipe.schema";
import type { DesignContract } from "../types/schemas/contract.schema";
import type { CreativeConcept } from "../types/schemas/concept.schema";
import type { LayoutBlueprint } from "../types/schemas/layout-blueprint.schema";
import type {
  GeneratedArtifact,
  GenerationRequest
} from "../types/schemas/visual-generation.schema";
import type { CreativeDecision } from "../types/schemas/creative-decision.schema";
import type { StageId } from "./workspace";
import { FAKE_GENERATION_PROVIDER } from "../adapters/visual-generation/fake";
import { formatChannel, percent, titleCase } from "./format";
import { focalZoneLabel } from "./blueprint-view";
import { costLabel, promptLanguageLabel, type DetailRow } from "./generate-view";

export type { DetailRow } from "./generate-view";

// --- human review status (a human decision — NEVER an AI score) ----

export type HumanReviewStatus = "awaiting" | "approved" | "needs_correction";

export const REVIEW_STATUS_LABEL: Record<HumanReviewStatus, string> = {
  awaiting: "Awaiting your review",
  approved: "Approved by you",
  needs_correction: "You sent this back for a correction"
};

// --- where the Review stage's links go (all existing stages) -------

export const REVIEW_STAGE_LINKS = {
  layout: "layout",
  prompt: "prompt",
  generate: "generate",
  correct: "correct"
} as const satisfies Record<string, StageId>;

// --- stale / mismatch detection (same restraint as Layout Blueprint) ---

/** The generated visual came from a recipe that is no longer the current one. */
export function isVisualStaleForRecipe(
  artifact: GeneratedArtifact | null,
  currentRecipeHash: string
): boolean {
  return artifact !== null && artifact.provenance.recipe_hash !== currentRecipeHash;
}

/**
 * The generated visual came from a layout blueprint that is no longer the
 * current one. If either side has no blueprint there is nothing to compare.
 */
export function isVisualStaleForBlueprint(
  artifact: GeneratedArtifact | null,
  currentBlueprintHash: string | null
): boolean {
  if (artifact === null || currentBlueprintHash === null) return false;
  if (artifact.provenance.blueprint_hash === null) return false;
  return artifact.provenance.blueprint_hash !== currentBlueprintHash;
}

export const STALE_RECIPE_NOTICE = "This visual was generated from an earlier recipe version.";
export const STALE_BLUEPRINT_NOTICE =
  "This visual was generated from an earlier layout blueprint.";

// --- real vs test provider ---------------------------------------

/** True when the visual came from the local fake adapter, not a real provider. */
export function isTestProviderArtifact(artifact: GeneratedArtifact): boolean {
  return artifact.provider === FAKE_GENERATION_PROVIDER;
}

/** A label that never lets a fake render read as a production image. */
export function providerTrustLabel(artifact: GeneratedArtifact): string {
  return isTestProviderArtifact(artifact)
    ? `Local test output — ${artifact.provider} · ${artifact.model} (not a real generation)`
    : `${artifact.provider} · ${artifact.model}`;
}

export const TEST_PROVIDER_NOTICE =
  "This is placeholder output from the local test adapter, not a real generated image.";

// --- creative decision (P2.18) --------------------------------

/**
 * Whether an `approved` decision is CURRENT — the decided artifact is still the
 * live one AND the design has not moved on since. Unlocks Final.
 *
 * `currentRecipeHash` / `currentBlueprintHash` are the workspace's live hashes;
 * a correction applied after approval changes them and the approval no longer
 * holds.
 */
export function decisionApprovesArtifact(
  decision: CreativeDecision | null,
  artifact: GeneratedArtifact | null,
  currentRecipeHash?: string,
  currentBlueprintHash?: string | null
): boolean {
  if (
    decision === null ||
    artifact === null ||
    decision.action !== "approved" ||
    decision.subject.artifact_hash !== artifact.artifact_hash ||
    decision.subject.recipe_hash !== artifact.provenance.recipe_hash
  ) {
    return false;
  }
  if (currentRecipeHash !== undefined && decision.subject.recipe_hash !== currentRecipeHash) return false;
  if (
    currentBlueprintHash !== undefined &&
    currentBlueprintHash !== null &&
    decision.subject.blueprint_hash !== null &&
    decision.subject.blueprint_hash !== currentBlueprintHash
  ) {
    return false;
  }
  return true;
}

export const DECISION_ACTION_LABEL: Record<CreativeDecision["action"], string> = {
  approved: "Approved",
  needs_correction: "Sent for correction",
  regenerate: "Marked for regeneration"
};

// --- image display decision ------------------------------------

/** Whether a real transported image exists to show. Metadata-only otherwise. */
export function hasDisplayableImage(imageDataUrl: string | null): boolean {
  return typeof imageDataUrl === "string" && imageDataUrl.length > 0;
}

export function metadataOnlyReason(artifact: GeneratedArtifact): string {
  return artifact.image.delivery === "none"
    ? "The provider returned metadata only for this response. The record below is the full generation."
    : "The image bytes are not transported in this build. The record below is the full generation.";
}

// --- design intent (read from recipe / contract / blueprint / concept) ---

export function designIntentRows(input: {
  recipe: DesignRecipe;
  contract: DesignContract;
  blueprint: LayoutBlueprint | null;
  concept: CreativeConcept | null;
  request: GenerationRequest | null;
}): DetailRow[] {
  const { recipe, contract, blueprint, concept, request } = input;
  const rows: DetailRow[] = [
    { label: "Visual type", value: contract.visual_type.name },
    { label: "Channel", value: formatChannel(recipe.platform.channel) },
    {
      label: "Aspect ratio",
      value: request
        ? aspectRatio(request.target.width, request.target.height)
        : titleCase(recipe.platform.aspect_ratio_id)
    }
  ];
  if (concept) rows.push({ label: "Concept", value: concept.proposal.name });
  if (blueprint) {
    rows.push({ label: "Focal zone", value: focalZoneLabel(blueprint) });
    rows.push({
      label: "Hierarchy",
      value: `${percent(blueprint.hierarchy.strength)} strength · ${blueprint.reading_flow.pattern} reading flow`
    });
  }
  rows.push({
    label: "Visual character",
    value: titleCase(request?.provenance.adapter_id ?? recipe.photographic_character.photographic_style)
  });
  return rows;
}

function aspectRatio(w: number, h: number): string {
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

// --- generation result (read straight from the artifact) --------

export function generationResultRows(artifact: GeneratedArtifact): DetailRow[] {
  return [
    { label: "Generated size", value: `${artifact.image.width} × ${artifact.image.height} px` },
    { label: "Format", value: artifact.image.mime_type },
    { label: "Provider / model", value: providerTrustLabel(artifact) },
    { label: "Status", value: titleCase(artifact.status) },
    { label: "Estimated cost", value: costLabel(artifact) },
    { label: "Generated at", value: formatTimestamp(artifact.created_at) },
    { label: "Artifact hash", value: artifact.artifact_hash }
  ];
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// --- provenance (read straight from the artifact) --------------

export function reviewProvenanceRows(artifact: GeneratedArtifact): DetailRow[] {
  return [
    { label: "Recipe hash", value: artifact.provenance.recipe_hash },
    { label: "Blueprint hash", value: artifact.provenance.blueprint_hash ?? "— (no blueprint)" },
    { label: "Prompt hash", value: artifact.provenance.prompt_hash },
    { label: "Generation request hash", value: artifact.request_hash },
    { label: "Artifact hash", value: artifact.artifact_hash },
    { label: "Provider / model", value: `${artifact.provider} / ${artifact.model}` }
  ];
}

/** The compact "Based on" line — Recipe · Layout · Prompt · Generation. */
export function provenanceChainLabel(artifact: GeneratedArtifact): string {
  const parts = ["Recipe"];
  if (artifact.provenance.blueprint_hash !== null) parts.push("Layout");
  parts.push("Prompt", "Generation");
  return parts.join(" · ");
}

// --- context strips -------------------------------------------

export function promptContextLine(input: {
  request: GenerationRequest | null;
  artifact: GeneratedArtifact | null;
}): string {
  if (input.request) {
    return `${titleCase(input.request.config.prompt_tier.replace("-", " "))} · ${promptLanguageLabel(
      input.request.config.prompt_language
    )}`;
  }
  if (input.artifact) {
    return `${promptLanguageLabel(input.artifact.provenance.prompt_language)} · ${titleCase(
      input.artifact.provenance.adapter_id
    )}`;
  }
  return "Not generated yet";
}

/** Alt text for the generated image — derived from real artifact + intent data. */
export function generatedImageAlt(input: {
  artifact: GeneratedArtifact;
  contract: DesignContract;
  recipe: DesignRecipe;
  concept: CreativeConcept | null;
}): string {
  const { artifact, contract, recipe, concept } = input;
  const subject = concept ? `“${concept.proposal.name}”` : contract.visual_type.name;
  return `Generated ${contract.visual_type.name.toLowerCase()} for ${subject}, ${artifact.image.width}×${artifact.image.height} px, for ${formatChannel(
    recipe.platform.channel
  )}`;
}
