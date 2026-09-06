import type { ClockPort } from "../../ports/clock.port";
import type { CostLedgerPort } from "../../ports/cost.port";
import type { IdPort } from "../../ports/id.port";
import type {
  EvidenceIssue,
  ObserveVisualInput,
  ObserveVisualOptions,
  RawVisionCall,
  RawVisionResponse,
  VisionObservationPayload,
  VisualEvidencePort
} from "../../ports/visual-evidence.port";
import { evidenceIssue } from "../../ports/visual-evidence.port";
import type {
  EvidenceObservations,
  VisualEvidenceReport
} from "../../types/schemas/visual-evidence-report.schema";
import {
  OBSERVATION_SCHEMA_VERSION,
  VisualEvidenceReport as VisualEvidenceReportSchema
} from "../../types/schemas/visual-evidence-report.schema";
import { SCHEMA_VERSIONS } from "../../types/versions";
import { canonicalise, fnv1a } from "../../types/primitives";
import { deepFreeze } from "../../domain/contract";
import { costEventFrom } from "../../services/cost.service";
import { err, ok, type Result } from "../../engine/util/result";

/**
 * Provider-independent visual-evidence client (P2.14).
 *
 * Every vision adapter reduces to one function — `RawVisionCall`: image in,
 * structured observations (or an error) out. This wrapper supplies everything
 * else, so behaviour is identical across providers and the replay adapter
 * exercises the exact production path:
 *
 *   - require real image bytes (no evidence is ever fabricated from metadata);
 *   - copy provenance from the `GeneratedArtifact` verbatim;
 *   - book exactly one cost-ledger event for every REAL call, before the result
 *     is decided, on success and on failure (a replay adapter books none);
 *   - never retry;
 *   - never turn a provider failure into a report;
 *   - assemble the immutable, content-hashed `VisualEvidenceReport` and freeze
 *     it. It carries no judgment.
 *
 * It holds no provider SDK, no endpoint, no credentials.
 */

export const DEFAULT_EVIDENCE_TIMEOUT_MS = 45_000;
export const EVIDENCE_RESOLVER_VERSION = "1.0.0";

export type VisualEvidenceClientOptions = {
  readonly call: RawVisionCall;
  readonly source: { kind: "vision-model" | "replay-fixture" | "human"; provider: string; model: string };
  readonly ledger: CostLedgerPort;
  readonly clock: ClockPort;
  readonly ids: IdPort;
  /** Book a cost event for every real call. Replay / fixture adapters pass false. */
  readonly meter: boolean;
  readonly datasetVersion: string;
  readonly defaultTimeoutMs?: number;
};

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
function reducedRatio(width: number, height: number): string {
  const g = gcd(width, height) || 1;
  return `${Math.round(width / g)}:${Math.round(height / g)}`;
}

const clampRatio = (n: number): number => Math.min(1, Math.max(0, n));
const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

function clampRect(rect: { x: number; y: number; w: number; h: number }): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const x = clampRatio(rect.x);
  const y = clampRatio(rect.y);
  return {
    x: round4(x),
    y: round4(y),
    w: round4(Math.min(1 - x, Math.max(1e-4, rect.w))),
    h: round4(Math.min(1 - y, Math.max(1e-4, rect.h)))
  };
}

/**
 * Map the raw provider payload into the strict `EvidenceObservations`, and
 * collect the names of every field the provider left null so they can be
 * reported as `unassessed` rather than silently defaulted.
 */
function mapObservations(payload: VisionObservationPayload): {
  observations: EvidenceObservations;
  unassessed: string[];
} {
  const unassessed: string[] = [];
  const note = (name: string, value: unknown) => {
    if (value === null || value === undefined) unassessed.push(name);
  };

  const regions = payload.regions.map((region, index) => ({
    id: `region-${String(index + 1).padStart(2, "0")}`,
    kind: region.kind,
    rect: clampRect(region.rect),
    area_share: clampRatio(round4(region.area_share)),
    confidence: clampRatio(region.confidence ?? 0.5)
  }));

  const textBlocks = payload.text_blocks.map((block, index) => ({
    id: `text-${String(index + 1).padStart(2, "0")}`,
    rect: clampRect(block.rect),
    text: block.text,
    confidence: clampRatio(block.confidence ?? 0.5)
  }));

  const dominantRegionId =
    payload.dominant_region_index !== null && regions[payload.dominant_region_index]
      ? regions[payload.dominant_region_index]!.id
      : null;

  note("region_count", payload.region_count);
  note("text_region_count", payload.text_region_count);
  note("approx_subject_position", payload.approx_subject_position);
  note("person_present", payload.person_present);
  note("whitespace_share", payload.whitespace_share);
  note("approx_visual_density", payload.approx_visual_density);
  note("color", payload.color);
  note("edge_bleed", payload.edge_bleed);
  note("crop_behavior", payload.crop_behavior);
  if (regions.length === 0) unassessed.push("regions");
  if (dominantRegionId === null) unassessed.push("dominant_region_id");

  return {
    observations: {
      region_count: payload.region_count,
      regions,
      text_region_count: payload.text_region_count,
      text_blocks: textBlocks,
      dominant_region_id: dominantRegionId,
      approx_subject_position: payload.approx_subject_position
        ? { x: clampRatio(payload.approx_subject_position.x), y: clampRatio(payload.approx_subject_position.y) }
        : null,
      person_present: payload.person_present,
      whitespace_share: payload.whitespace_share === null ? null : clampRatio(round4(payload.whitespace_share)),
      approx_visual_density:
        payload.approx_visual_density === null ? null : clampRatio(round4(payload.approx_visual_density)),
      color: payload.color
        ? {
            dominant_hexes: payload.color.dominant_hexes
              .filter((hex) => /^#?[0-9a-fA-F]{6}$/.test(hex))
              .slice(0, 8)
              .map((hex) => (hex.startsWith("#") ? hex.toLowerCase() : `#${hex.toLowerCase()}`)),
            approx_palette_size: payload.color.approx_palette_size,
            approx_contrast:
              payload.color.approx_contrast === null ? null : clampRatio(round4(payload.color.approx_contrast))
          }
        : null,
      edge_bleed: payload.edge_bleed,
      crop_behavior: payload.crop_behavior,
      semantic_descriptors: payload.semantic_descriptors
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
        .slice(0, 32)
    },
    unassessed: [...new Set(unassessed)].sort()
  };
}

export function createVisualEvidenceClient(
  options: VisualEvidenceClientOptions
): VisualEvidencePort {
  const { call, ledger, clock, ids, meter } = options;
  const timeoutDefault = options.defaultTimeoutMs ?? DEFAULT_EVIDENCE_TIMEOUT_MS;

  return {
    async observe(
      input: ObserveVisualInput,
      observeOptions: ObserveVisualOptions
    ): Promise<Result<VisualEvidenceReport, EvidenceIssue[]>> {
      if (!input.imageBytes || input.imageBytes.length === 0) {
        return err([
          evidenceIssue("image_missing", "no image bytes were supplied — evidence is never fabricated from metadata")
        ]);
      }

      const artifact = input.artifact;
      const requestedRatio = reducedRatio(artifact.image.width, artifact.image.height);
      const timeoutMs = observeOptions.timeoutMs ?? timeoutDefault;

      let response: RawVisionResponse;
      try {
        response = await call({
          imageBytes: input.imageBytes,
          mimeType: input.mimeType,
          declaredWidth: artifact.image.width,
          declaredHeight: artifact.image.height,
          requestedAspectRatio: requestedRatio,
          timeoutMs
        });
      } catch (error) {
        response = {
          ok: false,
          provider: options.source.provider,
          model_id: options.source.model,
          latency_ms: 0,
          error: { code: "unknown_provider_error", message: (error as Error).message }
        };
      }

      if (meter) {
        await ledger.record(
          costEventFrom({
            projectId: observeOptions.projectId,
            stage: "visual_evidence",
            provider: response.provider,
            modelId: response.model_id,
            templateVersion: OBSERVATION_SCHEMA_VERSION,
            inputTokens: response.input_tokens ?? 0,
            outputTokens: response.output_tokens ?? 0,
            latencyMs: response.latency_ms,
            status: response.ok ? "ok" : "failed",
            attempt: 1,
            createdAt: clock.now().toISOString(),
            estimatedCostUsd: response.estimated_cost_usd ?? 0
          })
        );
      }

      if (!response.ok || !response.observations) {
        return err([
          evidenceIssue(
            response.error?.code ?? "unknown_provider_error",
            response.error?.message ?? "the vision provider returned no observations and no error",
            { provider: response.provider, retryable: response.error?.code === "rate_limited" }
          )
        ]);
      }

      const { observations, unassessed } = mapObservations(response.observations);

      const observedWidth = response.observedWidth ?? artifact.image.width;
      const observedHeight = response.observedHeight ?? artifact.image.height;

      const now = clock.now().toISOString();
      const body = {
        schema_version: SCHEMA_VERSIONS.visualEvidenceReport,
        resolver_version: EVIDENCE_RESOLVER_VERSION,
        dataset_version: options.datasetVersion,
        provenance: {
          generated_artifact_id: artifact.artifact_id,
          artifact_hash: artifact.artifact_hash,
          recipe_id: artifact.provenance.recipe_id,
          recipe_hash: artifact.provenance.recipe_hash,
          blueprint_id: artifact.provenance.blueprint_id,
          blueprint_hash: artifact.provenance.blueprint_hash,
          prompt_hash: artifact.provenance.prompt_hash,
          generation_request_hash: artifact.request_hash,
          provider: artifact.provider,
          model: artifact.model,
          adapter_id: artifact.adapter_id
        },
        source: {
          kind: options.source.kind,
          provider: options.source.provider,
          model: options.source.model,
          observation_schema_version: OBSERVATION_SCHEMA_VERSION,
          observed_at: now
        },
        image: {
          width: observedWidth,
          height: observedHeight,
          aspect_ratio: reducedRatio(observedWidth, observedHeight),
          mime_type: input.mimeType || artifact.image.mime_type
        },
        observations,
        confidence: {
          basis: (options.source.kind === "replay-fixture"
            ? "fixture"
            : response.observations.overall_confidence !== null
              ? "provider-reported"
              : "none") as "provider-reported" | "fixture" | "none",
          overall:
            response.observations.overall_confidence === null
              ? null
              : clampRatio(round4(response.observations.overall_confidence))
        },
        unassessed,
        issues: [] as VisualEvidenceReport["issues"]
      };

      const evidence = {
        ...body,
        evidence_id: ids.next("evidence"),
        created_at: now,
        evidence_hash: fnv1a(canonicalise(body))
      };

      const validated = VisualEvidenceReportSchema.safeParse(evidence);
      if (!validated.success) {
        return err([
          evidenceIssue(
            "invalid_observation",
            `the observation set could not be assembled into a valid evidence report: ${validated.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")}`,
            { provider: response.provider }
          )
        ]);
      }

      return ok(deepFreeze(validated.data));
    }
  };
}
