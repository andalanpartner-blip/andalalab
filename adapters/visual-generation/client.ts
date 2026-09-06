import type { ClockPort } from "../../ports/clock.port";
import type { CostLedgerPort } from "../../ports/cost.port";
import type { IdPort } from "../../ports/id.port";
import type {
  GenerateVisualOptions,
  GenerationEstimate,
  GenerationIssue,
  RawGenerationCall,
  RawGenerationResponse,
  VisualGenerationPort
} from "../../ports/visual-generation.port";
import { generationIssue } from "../../ports/visual-generation.port";
import type {
  GeneratedArtifact,
  GenerationRequest
} from "../../types/schemas/visual-generation.schema";
import { GeneratedArtifact as GeneratedArtifactSchema } from "../../types/schemas/visual-generation.schema";
import { SCHEMA_VERSIONS } from "../../types/versions";
import { canonicalise, fnv1a } from "../../types/primitives";
import { deepFreeze } from "../../domain/contract";
import { costEventFrom } from "../../services/cost.service";
import { err, ok, type Result } from "../../engine/util/result";

/**
 * Provider-independent visual-generation client (P2.11).
 *
 * Every provider adapter reduces to one function — `RawGenerationCall`: request
 * in, image reference (or an error) out. This wrapper supplies everything else,
 * so behaviour is identical across providers and the test fake exercises the
 * exact production path:
 *
 *   - book a cost-ledger event for EVERY call, before the result is decided,
 *     on success and on failure;
 *   - never retry;
 *   - never turn a provider failure into a successful artifact;
 *   - assemble the immutable, content-hashed `GeneratedArtifact` with full
 *     design provenance.
 *
 * It holds no provider SDK, no endpoint, no credentials.
 */

export const DEFAULT_GENERATION_TIMEOUT_MS = 60_000;

export type VisualGenerationClientOptions = {
  readonly call: RawGenerationCall;
  /** Deterministic pre-call estimate. Pure — no provider call, no cost event. */
  readonly estimate: (request: GenerationRequest) => GenerationEstimate;
  readonly ledger: CostLedgerPort;
  readonly clock: ClockPort;
  readonly ids: IdPort;
  readonly defaultTimeoutMs?: number;
};

function synthErrorResponse(message: string): RawGenerationResponse {
  return {
    ok: false,
    provider: "unknown",
    model_id: "unknown",
    latency_ms: 0,
    error: { code: "unknown_provider_error", message }
  };
}

export function createVisualGenerationClient(
  options: VisualGenerationClientOptions
): VisualGenerationPort {
  const { call, ledger, clock, ids } = options;
  const timeoutDefault = options.defaultTimeoutMs ?? DEFAULT_GENERATION_TIMEOUT_MS;

  return {
    estimate: options.estimate,

    async generate(
      request: GenerationRequest,
      generateOptions: GenerateVisualOptions
    ): Promise<Result<GeneratedArtifact, GenerationIssue[]>> {
      const timeoutMs = generateOptions.timeoutMs ?? timeoutDefault;

      let response: RawGenerationResponse;
      try {
        response = await call({
          prompt: request.prompt,
          negativePrompt: request.negative_prompt,
          aspectRatioId: request.target.aspect_ratio_id,
          targetWidth: request.target.width,
          targetHeight: request.target.height,
          adapterId: request.provenance.adapter_id,
          seed: request.config.seed,
          timeoutMs
        });
      } catch (error) {
        response = synthErrorResponse((error as Error).message);
      }

      // Book the cost of THIS call before anything is decided about it. A failed
      // call may still have consumed provider quota and still has to be visible.
      await ledger.record(
        costEventFrom({
          projectId: generateOptions.projectId,
          stage: "visual_generate",
          provider: response.provider,
          modelId: response.model_id,
          templateVersion: request.provenance.generation_request_version,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: response.latency_ms,
          status: response.ok ? "ok" : "failed",
          attempt: 1,
          createdAt: clock.now().toISOString(),
          estimatedCostUsd: response.cost?.estimated_cost_usd ?? 0
        })
      );

      if (!response.ok || !response.image) {
        return err([
          generationIssue(
            response.error?.code ?? "unknown_provider_error",
            response.error?.message ?? "the provider returned no image and no error",
            { provider: response.provider, retryable: response.error?.code === "rate_limited" }
          )
        ]);
      }

      const image = {
        width: response.image.width,
        height: response.image.height,
        aspect_ratio_id: request.target.aspect_ratio_id,
        mime_type: response.image.mime_type,
        delivery: response.image.delivery,
        reference: response.image.reference
      };

      const cost = response.cost ?? {
        currency: "USD" as const,
        estimated_cost_usd: 0,
        image_cost_usd: null,
        input_cost_usd: null,
        pricing_basis: "estimated" as const
      };

      // The hash identifies the generation ENVELOPE, not the pixels: provenance
      // + provider + model + adapter + image spec + cost basis + seed. Volatile
      // fields are excluded.
      const envelope = {
        provenance: request.provenance,
        request_hash: request.request_hash,
        provider: response.provider,
        model: response.model_id,
        adapter_id: request.provenance.adapter_id,
        image: { width: image.width, height: image.height, aspect_ratio_id: image.aspect_ratio_id, mime_type: image.mime_type },
        cost_basis: cost.pricing_basis,
        seed: response.seed ?? request.config.seed
      };

      const artifact = {
        schema_version: SCHEMA_VERSIONS.generatedArtifact,
        artifact_id: ids.next("genart"),
        artifact_hash: fnv1a(canonicalise(envelope)),
        status: "generated" as const,
        created_at: clock.now().toISOString(),
        provenance: request.provenance,
        request_hash: request.request_hash,
        provider: response.provider,
        model: response.model_id,
        adapter_id: request.provenance.adapter_id,
        image,
        run: {
          latency_ms: response.latency_ms,
          seed: response.seed ?? request.config.seed,
          provider_request_id: response.provider_request_id ?? null,
          finish_reason: response.finish_reason ?? null,
          safety: response.safety ?? null
        },
        cost,
        note: null
      };

      const validated = GeneratedArtifactSchema.safeParse(artifact);
      if (!validated.success) {
        return err([
          generationIssue(
            "unknown_provider_error",
            `the provider response could not be assembled into a valid artifact: ${validated.error.issues
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
