import type { ClockPort } from "../../ports/clock.port";
import type { CostLedgerPort } from "../../ports/cost.port";
import type { IdPort } from "../../ports/id.port";
import type {
  GenerationEstimate,
  GenerationIssueCode,
  RawGenerationCall,
  RawGenerationResponse,
  VisualGenerationPort
} from "../../ports/visual-generation.port";
import type { GenerationRequest } from "../../types/schemas/visual-generation.schema";
import { createVisualGenerationClient } from "./client";

/**
 * Fake visual-generation provider (P2.11 / P2.12 / UI/UX-03).
 *
 * It replaces ONLY the raw provider call and is wrapped by the real
 * `createVisualGenerationClient`, so cost recording, error mapping, artifact
 * assembly and the pre-call estimate all run the production code path.
 *
 * By default it does NOT pretend an image was generated: `delivery` is
 * `"none"`, no reference, cost is explicit test metadata. With `deliverImage`
 * set it returns a small hand-authored grey placeholder PNG (clearly not a
 * generated design) so the Generate UI's success state can be exercised
 * offline while the provider account has no image-generation quota.
 */

export const FAKE_GENERATION_PROVIDER = "fake-generation";
export const FAKE_GENERATION_MODEL = "fake-image-1";

/**
 * A hand-authored, solid grey 8x10 PNG (4:5). NOT a generated design — a
 * placeholder so the offline Generate UI has something to render. ~110 bytes.
 */
export const FAKE_PLACEHOLDER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAKCAIAAAAGpYjXAAAAEUlEQVR4nGO4duEQVsQw3CUACzzAgYVbGPwAAAAASUVORK5CYII=";

export type FakeGenerationOptions = {
  /** Force a failure of this class instead of a success. */
  readonly failWith?: GenerationIssueCode;
  /** Throw from the raw call, to exercise the client's try/catch. */
  readonly throws?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly latencyMs?: number;
  /** Explicit test cost. Never a real production price. */
  readonly costUsd?: number;
  /**
   * Return the grey placeholder PNG (delivery "base64-ref") and hand its bytes
   * to `onImageBytes`. Used by the offline Generate UI verification path.
   */
  readonly deliverImage?: boolean;
  /** Called with the decoded placeholder bytes when `deliverImage` is set. */
  readonly onImageBytes?: (bytes: Uint8Array, mimeType: string) => void;
};

function decodeBase64(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

export function createFakeGenerationCall(options: FakeGenerationOptions = {}): RawGenerationCall {
  return async (request) => {
    if (options.throws) throw new Error(options.throws);

    const provider = options.provider ?? FAKE_GENERATION_PROVIDER;
    const model = options.model ?? FAKE_GENERATION_MODEL;
    const latency = options.latencyMs ?? 0;

    if (options.failWith) {
      const response: RawGenerationResponse = {
        ok: false,
        provider,
        model_id: model,
        latency_ms: latency,
        error: { code: options.failWith, message: `fake generation failure: ${options.failWith}` }
      };
      return response;
    }

    const cost = options.costUsd ?? 0.002;
    let image: RawGenerationResponse["image"] = {
      width: request.targetWidth,
      height: request.targetHeight,
      mime_type: "image/png",
      delivery: "none",
      reference: null
    };
    if (options.deliverImage) {
      const bytes = decodeBase64(FAKE_PLACEHOLDER_PNG_BASE64);
      options.onImageBytes?.(bytes, "image/png");
      image = {
        width: request.targetWidth,
        height: request.targetHeight,
        mime_type: "image/png",
        delivery: "base64-ref",
        reference: `fake:${bytes.byteLength}`
      };
    }

    return {
      ok: true,
      provider,
      model_id: model,
      latency_ms: latency,
      image,
      cost: {
        currency: "USD",
        estimated_cost_usd: cost,
        image_cost_usd: cost,
        input_cost_usd: 0,
        pricing_basis: "test-fixture"
      },
      seed: request.seed,
      provider_request_id: null,
      finish_reason: "fake-complete",
      safety: null
    };
  };
}

export function estimateFakeGeneration(
  request: GenerationRequest,
  options: FakeGenerationOptions = {}
): GenerationEstimate {
  const cost = options.costUsd ?? 0.002;
  return {
    provider: options.provider ?? FAKE_GENERATION_PROVIDER,
    model: options.model ?? FAKE_GENERATION_MODEL,
    adapter_id: request.provenance.adapter_id,
    cost: {
      currency: "USD",
      estimated_cost_usd: cost,
      image_cost_usd: cost,
      input_cost_usd: 0,
      pricing_basis: "test-fixture"
    }
  };
}

export type CreateFakeVisualGenerationOptions = FakeGenerationOptions & {
  readonly ledger: CostLedgerPort;
  readonly clock: ClockPort;
  readonly ids: IdPort;
};

/** A ready-to-use fake-backed `VisualGenerationPort`. */
export function createFakeVisualGeneration(
  options: CreateFakeVisualGenerationOptions
): VisualGenerationPort {
  return createVisualGenerationClient({
    call: createFakeGenerationCall(options),
    estimate: (request) => estimateFakeGeneration(request, options),
    ledger: options.ledger,
    clock: options.clock,
    ids: options.ids
  });
}
