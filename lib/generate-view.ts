/**
 * Presentation-only logic for the Generate stage (UI/UX-03).
 *
 * A small state machine plus pure read helpers over the generation
 * preview / `GeneratedArtifact` the server returns. Nothing here computes a
 * design decision, a price, or a provider call — the server is the source of
 * truth for all three.
 */
import type { GeneratedArtifact, GenerationRequest } from "../types/schemas/visual-generation.schema";
import type { GenerationEstimate, GenerationIssueCode } from "../ports/visual-generation.port";
import type { LayoutBlueprint } from "../types/schemas/layout-blueprint.schema";
import { formatChannel, titleCase } from "./format";
import { focalZoneLabel } from "./blueprint-view";

// --- state machine --------------------------------------------------

export type GenerateState = "previewing" | "ready" | "generating" | "success" | "error";

export type GenerateEvent =
  | { type: "preview_ok" }
  | { type: "preview_error" }
  | { type: "submit" }
  | { type: "generate_ok" }
  | { type: "generate_error" }
  | { type: "reset" };

/**
 * Deterministic transitions. `submit` is ignored while `generating` — a
 * double-click cannot start a second request.
 */
export function nextGenerateState(current: GenerateState, event: GenerateEvent): GenerateState {
  switch (event.type) {
    case "preview_ok":
      return current === "previewing" ? "ready" : current;
    case "preview_error":
      return current === "previewing" ? "error" : current;
    case "submit":
      return current === "ready" || current === "error" || current === "success"
        ? "generating"
        : current; // already generating / previewing → no-op (guards duplicate submit)
    case "generate_ok":
      return current === "generating" ? "success" : current;
    case "generate_error":
      return current === "generating" ? "error" : current;
    case "reset":
      return "ready";
  }
}

/** Whether the Generate action may fire right now. */
export function canSubmit(state: GenerateState): boolean {
  return state === "ready" || state === "error" || state === "success";
}

// --- error mapping -------------------------------------------------

const ERROR_MESSAGES: Record<GenerationIssueCode, string> = {
  not_configured: "Image generation is not configured for this workspace.",
  configuration_error: "The image generation provider is not configured correctly.",
  provider_unavailable: "The image provider is temporarily unavailable.",
  authentication_error: "The image provider is not authorised for this workspace.",
  rate_limited: "Generation is temporarily unavailable because the image provider quota was reached.",
  content_rejected: "The provider rejected this generation request.",
  malformed_request: "This generation request could not be submitted.",
  timeout: "The generation request timed out.",
  unknown_provider_error: "The image provider returned an unexpected response."
};

export function generationErrorMessage(
  code: GenerationIssueCode | null | undefined,
  fallback = "Generation could not be completed."
): string {
  return code ? ERROR_MESSAGES[code] : fallback;
}

// --- view models -------------------------------------------------

export type DetailRow = { label: string; value: string };

/** The "what will be generated" summary shown before the button. */
export function previewRows(
  request: GenerationRequest,
  estimate: GenerationEstimate
): DetailRow[] {
  return [
    { label: "Visual type", value: titleCase(request.target.visual_type_id) },
    { label: "Channel", value: formatChannel(request.target.channel) },
    { label: "Aspect ratio", value: aspectLabel(request) },
    { label: "Target size", value: `${request.target.width} × ${request.target.height} px` },
    { label: "Visual character", value: titleCase(request.provenance.adapter_id) },
    { label: "Prompt language", value: request.config.prompt_language === "id" ? "Bahasa Indonesia" : "English" },
    { label: "Prompt tier", value: titleCase(request.config.prompt_tier.replace("-", " ")) },
    { label: "Provider", value: `${estimate.provider} · ${estimate.model}` }
  ];
}

function aspectLabel(request: GenerationRequest): string {
  const w = request.target.width;
  const h = request.target.height;
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** `~$0.068` — a rounded, clearly-estimated figure. Never presented as an invoice. */
export function formatEstimatedCost(estimate: GenerationEstimate): string {
  const usd = estimate.cost.estimated_cost_usd;
  if (usd === 0) return "no estimate available";
  return `~$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(3)}`;
}

/** The prominent facts about a finished artifact. */
export function artifactRows(artifact: GeneratedArtifact): DetailRow[] {
  return [
    { label: "Generated size", value: `${artifact.image.width} × ${artifact.image.height} px` },
    { label: "Format", value: artifact.image.mime_type },
    { label: "Provider", value: `${artifact.provider} · ${artifact.model}` },
    { label: "Status", value: titleCase(artifact.status) },
    {
      label: "Estimated cost",
      value: costLabel(artifact)
    }
  ];
}

export function costLabel(artifact: GeneratedArtifact): string {
  const c = artifact.cost;
  const usd = c.estimated_cost_usd;
  const amount = usd === 0 ? "$0" : `~$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(3)}`;
  const basis =
    c.pricing_basis === "provider-reported"
      ? "provider-reported"
      : c.pricing_basis === "test-fixture"
        ? "test estimate"
        : "estimated";
  return `${amount} (${basis})`;
}

/** The provenance disclosure — "this image came from THIS decision chain". */
export function provenanceRows(artifact: GeneratedArtifact): DetailRow[] {
  return [
    { label: "Recipe hash", value: artifact.provenance.recipe_hash },
    { label: "Blueprint hash", value: artifact.provenance.blueprint_hash ?? "— (no blueprint)" },
    { label: "Prompt hash", value: artifact.provenance.prompt_hash },
    { label: "Generation request hash", value: artifact.request_hash },
    { label: "Adapter", value: titleCase(artifact.provenance.adapter_id) },
    { label: "Provider / model", value: `${artifact.provider} / ${artifact.model}` },
    { label: "Artifact hash", value: artifact.artifact_hash }
  ];
}

// --- context strips (read straight from the artifacts, never recomputed) ---

export function layoutContextLabel(blueprint: LayoutBlueprint): string {
  const n = blueprint.zones.length;
  return `${n} zone${n === 1 ? "" : "s"} · focal on ${focalZoneLabel(blueprint).toLowerCase()}`;
}

export function promptLanguageLabel(language: "en" | "id"): string {
  return language === "id" ? "Bahasa Indonesia" : "English";
}

export function promptContextLabel(request: GenerationRequest): string {
  return `${titleCase(request.config.prompt_tier.replace("-", " "))} tier · ${promptLanguageLabel(
    request.config.prompt_language
  )} · ${titleCase(request.provenance.adapter_id)}`;
}
