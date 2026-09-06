import type { DatasetRegistry } from "../types/datasets";
import type { ClockPort } from "../ports/clock.port";
import type { IdPort } from "../ports/id.port";
import type { EvidenceIssue, VisualEvidencePort } from "../ports/visual-evidence.port";
import type { VisualEvidenceReport } from "../types/schemas/visual-evidence-report.schema";

import { DesignRecipe as DesignRecipeSchema } from "../types/schemas/recipe.schema";
import { LayoutBlueprint as LayoutBlueprintSchema } from "../types/schemas/layout-blueprint.schema";
import { GeneratedArtifact as GeneratedArtifactSchema } from "../types/schemas/visual-generation.schema";

import { systemClock } from "../ports/clock.port";
import { createCostLedger } from "./cost.service";
import { getEngineDeps } from "./pipeline.service";
import { createGeminiVisualEvidence } from "../adapters/visual-evidence/gemini-vision";
import { createReplayVisualEvidence } from "../adapters/visual-evidence/replay";

/**
 * Visual evidence — the EXPLICIT observation step (P2.14).
 *
 * `GeneratedArtifact + actual image → VisualEvidencePort → VisualEvidenceReport`.
 *
 * It is NOT part of `runRecipePipeline` / `runCorrectionPipeline` /
 * `runVisualGeneration`: inspecting a render is a separate, explicitly-triggered
 * operation so its provider, its cost and its cadence stay under human control.
 *
 * This file makes no design decision and holds no provider knowledge. It
 * re-validates the round-tripped artifacts, rejects a stale or mismatched
 * pairing, decodes the transient image, hands it to the injected port, and
 * returns the result. The evidence report carries no judgment.
 */

export type EvidenceServiceDeps = {
  readonly datasets: DatasetRegistry;
  readonly ids: IdPort;
  readonly clock: ClockPort;
  readonly observer: VisualEvidencePort;
};

/**
 * Real, process-wide evidence dependencies.
 *
 * The provider is Gemini vision by default; set `EVIDENCE_PROVIDER=replay` to
 * use the replay adapter (synthetic observations, no cost, no network) for
 * offline verification. The credential is the same `GEMINI_API_KEY` — never
 * hardcoded, never logged, never sent to the browser.
 */
export function getEvidenceDeps(
  options: { ledger?: import("../ports/cost.port").CostLedgerPort; allowReplay?: boolean } = {}
): EvidenceServiceDeps {
  const { datasets, ids, clock } = getEngineDeps();
  const ledger = options.ledger ?? createCostLedger({ clock: systemClock });

  const wantsReplay = process.env["EVIDENCE_PROVIDER"]?.trim() === "replay";
  const observer =
    wantsReplay && options.allowReplay !== false
      ? createReplayVisualEvidence({ ledger, clock: systemClock, ids, datasetVersion: datasets.version })
      : createGeminiVisualEvidence({
          apiKey: process.env["GEMINI_API_KEY"]?.trim() ?? "",
          clock: systemClock,
          ids,
          ledger,
          datasetVersion: datasets.version
        });

  return { datasets, ids, clock, observer };
}

export type VisualEvidenceInput = {
  /** The generated artifact whose render is being inspected (round-trips from the client). */
  readonly artifact: unknown;
  /** The CURRENT recipe — used only to detect a stale artifact. */
  readonly recipe: unknown;
  /** The CURRENT blueprint, when the client holds one — used only to detect a stale artifact. */
  readonly blueprint?: unknown;
  /** The actual generated image, base64-encoded. Transient — never persisted. */
  readonly imageBase64: string;
  readonly mimeType: string;
};

export type VisualEvidenceOkResult = {
  readonly status: "OK";
  readonly evidence: VisualEvidenceReport;
};
export type VisualEvidenceFailureResult = {
  readonly status: "ERROR";
  readonly message: string;
  readonly issues?: readonly EvidenceIssue[];
};
export type VisualEvidenceResult = VisualEvidenceOkResult | VisualEvidenceFailureResult;

function decodeBase64(b64: string): Uint8Array {
  const cleaned = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(cleaned, "base64"));
  const binary = atob(cleaned);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export async function runVisualEvidence(
  deps: EvidenceServiceDeps,
  input: VisualEvidenceInput
): Promise<VisualEvidenceResult> {
  const artifactParsed = GeneratedArtifactSchema.safeParse(input.artifact);
  const recipeParsed = DesignRecipeSchema.safeParse(input.recipe);
  if (!artifactParsed.success || !recipeParsed.success) {
    return { status: "ERROR", message: "That generation couldn't be read. Regenerate the visual and try again." };
  }
  const artifact = artifactParsed.data;
  const recipe = recipeParsed.data;

  if (artifact.provenance.recipe_hash !== recipe.recipe_hash) {
    return {
      status: "ERROR",
      message:
        "This visual was generated from an earlier recipe version. Regenerate before inspecting it.",
      issues: [
        {
          code: "stale_artifact",
          message: `artifact recipe_hash ${artifact.provenance.recipe_hash} != current recipe_hash ${recipe.recipe_hash}`,
          retryable: false
        }
      ]
    };
  }

  if (input.blueprint != null) {
    const blueprintParsed = LayoutBlueprintSchema.safeParse(input.blueprint);
    if (!blueprintParsed.success) {
      return { status: "ERROR", message: "That layout blueprint couldn't be read. Open the Layout stage and try again." };
    }
    const currentBlueprintHash = blueprintParsed.data.blueprint_hash;
    if (
      artifact.provenance.blueprint_hash !== null &&
      artifact.provenance.blueprint_hash !== currentBlueprintHash
    ) {
      return {
        status: "ERROR",
        message: "This visual was generated from an earlier layout blueprint. Regenerate before inspecting it.",
        issues: [
          {
            code: "stale_artifact",
            message: `artifact blueprint_hash ${artifact.provenance.blueprint_hash} != current blueprint_hash ${currentBlueprintHash}`,
            retryable: false
          }
        ]
      };
    }
  }

  if (!input.imageBase64 || input.imageBase64.trim().length === 0) {
    return {
      status: "ERROR",
      message: "There is no image to inspect. Generate a visual first.",
      issues: [{ code: "image_missing", message: "no image bytes supplied", retryable: false }]
    };
  }

  const bytes = decodeBase64(input.imageBase64);

  const observed = await deps.observer.observe(
    { artifact, imageBytes: bytes, mimeType: input.mimeType || artifact.image.mime_type },
    { projectId: recipe.project_id }
  );

  if (!observed.ok) {
    return {
      status: "ERROR",
      message: `Visual inspection failed (${observed.error.map((i) => i.code).join(", ")}).`,
      issues: observed.error
    };
  }

  return { status: "OK", evidence: observed.value };
}
