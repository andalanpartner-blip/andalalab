import type { ClockPort } from "../../ports/clock.port";
import type { CostLedgerPort } from "../../ports/cost.port";
import type { IdPort } from "../../ports/id.port";
import type {
  EvidenceIssueCode,
  RawVisionCall,
  VisionObservationPayload,
  VisualEvidencePort
} from "../../ports/visual-evidence.port";
import { VisionObservationPayload as VisionObservationPayloadSchema } from "../../ports/visual-evidence.port";
import { createVisualEvidenceClient } from "./client";

/**
 * Replay / fixture visual-evidence adapter (P2.14).
 *
 * Returns a recorded (or synthetic) structured observation payload WITHOUT a
 * network call and WITHOUT booking any cost — it is test / local-development
 * only. It goes through the same `createVisualEvidenceClient` as a real
 * provider, so the report assembly, hashing, provenance binding and freezing
 * are exercised on the exact production path.
 *
 * It never claims to be a real vision inspection: `source.kind` is
 * `replay-fixture` and `confidence.basis` is `fixture`.
 */

export const REPLAY_EVIDENCE_PROVIDER = "replay";
export const REPLAY_EVIDENCE_MODEL = "replay-observer-1";

/**
 * A neutral synthetic payload for the fake path — a plausible 6-region layout
 * with one dominant image region and two text regions. Deterministic.
 */
export const SYNTHETIC_OBSERVATION_PAYLOAD: VisionObservationPayload = {
  region_count: 4,
  regions: [
    { kind: "image", rect: { x: 0.0, y: 0.0, w: 1.0, h: 0.62 }, area_share: 0.62, confidence: 0.8 },
    { kind: "text", rect: { x: 0.08, y: 0.66, w: 0.84, h: 0.12 }, area_share: 0.1, confidence: 0.7 },
    { kind: "text", rect: { x: 0.08, y: 0.8, w: 0.6, h: 0.08 }, area_share: 0.05, confidence: 0.65 },
    { kind: "graphic", rect: { x: 0.08, y: 0.9, w: 0.3, h: 0.05 }, area_share: 0.015, confidence: 0.6 }
  ],
  text_region_count: 2,
  text_blocks: [
    { rect: { x: 0.08, y: 0.66, w: 0.84, h: 0.12 }, text: null, confidence: 0.7 },
    { rect: { x: 0.08, y: 0.8, w: 0.6, h: 0.08 }, text: null, confidence: 0.65 }
  ],
  dominant_region_index: 0,
  approx_subject_position: { x: 0.5, y: 0.31 },
  person_present: false,
  whitespace_share: 0.28,
  approx_visual_density: 0.52,
  color: { dominant_hexes: ["#2b2b2b", "#d9c9a8", "#8a5a2b"], approx_palette_size: 4, approx_contrast: 0.7 },
  edge_bleed: "partial",
  crop_behavior: "as-requested",
  semantic_descriptors: ["beverage", "bottle", "studio lighting", "typographic caption"],
  overall_confidence: null
};

export type ReplayEvidenceOptions = {
  readonly ledger: CostLedgerPort;
  readonly clock: ClockPort;
  readonly ids: IdPort;
  readonly datasetVersion: string;
  /** The observation payload to replay. Defaults to `SYNTHETIC_OBSERVATION_PAYLOAD`. */
  readonly payload?: VisionObservationPayload;
  /** Force a structured provider failure with this code. */
  readonly failWith?: EvidenceIssueCode;
  /** Throw from the raw call (to exercise the client's catch path). */
  readonly throws?: boolean;
  readonly provider?: string;
  readonly model?: string;
};

export function createReplayVisionCall(options: ReplayEvidenceOptions): RawVisionCall {
  const provider = options.provider ?? REPLAY_EVIDENCE_PROVIDER;
  const model = options.model ?? REPLAY_EVIDENCE_MODEL;
  // Validate the fixture payload up front so a malformed fixture fails loudly.
  const payload = VisionObservationPayloadSchema.parse(options.payload ?? SYNTHETIC_OBSERVATION_PAYLOAD);

  return async () => {
    if (options.throws) throw new Error("replay vision call threw");
    if (options.failWith) {
      return {
        ok: false,
        provider,
        model_id: model,
        latency_ms: 0,
        error: { code: options.failWith, message: `replay forced failure: ${options.failWith}` }
      };
    }
    return {
      ok: true,
      provider,
      model_id: model,
      latency_ms: 0,
      observations: payload,
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_usd: 0
    };
  };
}

/** A ready-to-use replay-backed `VisualEvidencePort`. Books no cost. */
export function createReplayVisualEvidence(options: ReplayEvidenceOptions): VisualEvidencePort {
  return createVisualEvidenceClient({
    call: createReplayVisionCall(options),
    source: {
      kind: "replay-fixture",
      provider: options.provider ?? REPLAY_EVIDENCE_PROVIDER,
      model: options.model ?? REPLAY_EVIDENCE_MODEL
    },
    ledger: options.ledger,
    clock: options.clock,
    ids: options.ids,
    meter: false,
    datasetVersion: options.datasetVersion
  });
}
