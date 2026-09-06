import { z } from "zod";
import type { Result } from "../engine/util/result";
import type { VisualEvidenceReport } from "../types/schemas/visual-evidence-report.schema";
import type { GeneratedArtifact } from "../types/schemas/visual-generation.schema";

/**
 * The visual-evidence boundary (P2.14).
 *
 * This file is the ONLY thing the service layer knows about vision / multimodal
 * models. It describes a capability — "look at this generated image and report,
 * in a fixed structure, what is observed" — and says nothing about who provides
 * it. Swapping one vision provider for another must never require an edit
 * outside `adapters/visual-evidence/**`.
 *
 * The existing `LlmPort` is text-only (`generateStructured` takes a string
 * prompt). Multimodal input does not fit that contract cleanly, so evidence
 * gets its own port and its own provider adapters, exactly like
 * `VisualGenerationPort`.
 *
 * The vision call may be non-deterministic. Everything AROUND it here is
 * deterministic: the provenance is copied from the artifact, the report is
 * assembled and hashed by the client wrapper, and every real call is booked to
 * the cost ledger before the result is returned.
 *
 * An evidence report carries NO judgment. The port's job ends at "here is what
 * was observed"; interpretation is the P2.15 critic's job.
 */

/** Cost-ledger stage tag for a vision inspection. */
export type EvidenceStage = "visual_evidence";

export type EvidenceIssueCode =
  | "not_configured" // no adapter / no credentials for the selected provider
  | "configuration_error" // the request or adapter config is internally invalid
  | "image_missing" // no actual image bytes were supplied to inspect
  | "artifact_mismatch" // the supplied image / provenance does not match the artifact
  | "stale_artifact" // the artifact was generated from a different recipe than the one under review
  | "provider_unavailable"
  | "authentication_error"
  | "rate_limited"
  | "content_rejected" // the provider refused to describe the image
  | "malformed_request"
  | "invalid_observation" // the provider replied but not in the observation shape
  | "timeout"
  | "unknown_provider_error";

export type EvidenceIssue = {
  readonly code: EvidenceIssueCode;
  readonly message: string;
  readonly provider?: string;
  readonly retryable: boolean;
};

export const evidenceIssue = (
  code: EvidenceIssueCode,
  message: string,
  options: { provider?: string; retryable?: boolean } = {}
): EvidenceIssue => ({
  code,
  message,
  provider: options.provider,
  retryable: options.retryable ?? (code === "rate_limited" || code === "provider_unavailable")
});

/**
 * The structured observation payload a provider adapter must return — the
 * shape the vision model is asked to fill in. Purely descriptive: every field
 * is "what is there", never "what should be there". Any field the provider
 * cannot produce is `null` (or an empty array); the client records it under
 * `unassessed` and never fabricates it.
 */
export const VisionObservationPayload = z
  .object({
    region_count: z.number().int().min(0).max(64).nullable(),
    regions: z
      .array(
        z.object({
          kind: z.enum(["image", "text", "graphic", "product", "person", "background", "unknown"]),
          rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
          area_share: z.number().min(0).max(1),
          confidence: z.number().min(0).max(1).nullable()
        })
      )
      .max(64),
    text_region_count: z.number().int().min(0).max(64).nullable(),
    text_blocks: z
      .array(
        z.object({
          rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
          text: z.string().nullable(),
          confidence: z.number().min(0).max(1).nullable()
        })
      )
      .max(64),
    dominant_region_index: z.number().int().min(0).nullable(),
    approx_subject_position: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullable(),
    person_present: z.boolean().nullable(),
    whitespace_share: z.number().min(0).max(1).nullable(),
    approx_visual_density: z.number().min(0).max(1).nullable(),
    color: z
      .object({
        dominant_hexes: z.array(z.string()).max(8),
        approx_palette_size: z.number().int().min(0).max(64).nullable(),
        approx_contrast: z.number().min(0).max(1).nullable()
      })
      .nullable(),
    edge_bleed: z.enum(["none", "partial", "full"]).nullable(),
    crop_behavior: z.enum(["as-requested", "cropped", "padded", "unknown"]).nullable(),
    semantic_descriptors: z.array(z.string()).max(32),
    overall_confidence: z.number().min(0).max(1).nullable()
  })
  .strict();
export type VisionObservationPayload = z.infer<typeof VisionObservationPayload>;

/**
 * One raw provider call, stripped of hashing, provenance, report assembly and
 * cost recording — exactly what a vision adapter reduces to, mirroring
 * `RawGenerationCall`. The provider-independent client wraps it.
 */
export type RawVisionRequest = {
  /** The actual image bytes to inspect. Transient — never persisted. */
  readonly imageBytes: Uint8Array;
  readonly mimeType: string;
  readonly declaredWidth: number;
  readonly declaredHeight: number;
  /** The target aspect ratio the generation asked for, as "w:h" — context only. */
  readonly requestedAspectRatio: string;
  readonly timeoutMs: number;
};

export type RawVisionResponse = {
  readonly ok: boolean;
  readonly provider: string;
  readonly model_id: string;
  readonly latency_ms: number;
  /** Present on success — the structured observation payload. */
  readonly observations?: VisionObservationPayload;
  /** Observed pixel dimensions, when the provider reports them. */
  readonly observedWidth?: number | null;
  readonly observedHeight?: number | null;
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  /** Cost in USD the provider (or a fixture) attributes to this call. */
  readonly estimated_cost_usd?: number;
  readonly error?: { code: EvidenceIssueCode; message: string };
};

export type RawVisionCall = (request: RawVisionRequest) => Promise<RawVisionResponse>;

export type ObserveVisualOptions = {
  readonly projectId: string;
  readonly timeoutMs?: number;
};

/** The image + artifact the client needs to bind a report to a specific generation. */
export type ObserveVisualInput = {
  readonly artifact: GeneratedArtifact;
  /** The actual generated image. Required — evidence is never fabricated from metadata. */
  readonly imageBytes: Uint8Array;
  readonly mimeType: string;
};

/**
 * The port itself.
 *
 * Implementations MUST: require real image bytes, copy provenance from the
 * artifact verbatim, book exactly one cost-ledger event for every real
 * `observe` call (on success AND on failure) before returning, never retry,
 * and never return a report for a failed call. A replay / fixture adapter
 * books NO cost.
 */
export type VisualEvidencePort = {
  observe(
    input: ObserveVisualInput,
    options: ObserveVisualOptions
  ): Promise<Result<VisualEvidenceReport, EvidenceIssue[]>>;
};
