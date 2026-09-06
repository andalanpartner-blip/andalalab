import type { ClockPort } from "../../ports/clock.port";
import type { CostLedgerPort } from "../../ports/cost.port";
import type { IdPort } from "../../ports/id.port";
import type {
  GenerationIssueCode,
  RawGenerationCall,
  RawGenerationResponse,
  VisualGenerationPort
} from "../../ports/visual-generation.port";
import { createVisualGenerationClient } from "./client";

/**
 * Fake visual-generation provider (P2.11).
 *
 * It replaces ONLY the raw provider call and is wrapped by the real
 * `createVisualGenerationClient`, so cost recording, error mapping and artifact
 * assembly run the production code path. It does NOT pretend an image was
 * generated: `delivery` is `"none"`, no reference, and the cost is explicit
 * test metadata (`pricing_basis: "test-fixture"`).
 */

export const FAKE_GENERATION_PROVIDER = "fake-generation";
export const FAKE_GENERATION_MODEL = "fake-image-1";

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
};

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
    return {
      ok: true,
      provider,
      model_id: model,
      latency_ms: latency,
      image: {
        width: request.targetWidth,
        height: request.targetHeight,
        mime_type: "image/png",
        delivery: "none",
        reference: null
      },
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
    ledger: options.ledger,
    clock: options.clock,
    ids: options.ids
  });
}
