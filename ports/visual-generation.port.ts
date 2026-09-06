import type { Result } from "../engine/util/result";
import type {
  GeneratedArtifact,
  GenerationRequest
} from "../types/schemas/visual-generation.schema";

/**
 * The visual-generation boundary (P2.11).
 *
 * This file is the ONLY thing the service layer knows about image models. It
 * describes a capability — "render this already-resolved design into a visual" —
 * and says nothing about who provides it. Swapping one image provider for
 * another must never require an edit outside `adapters/visual-generation/**`.
 *
 * The generation API itself may be non-deterministic (the pixels differ run to
 * run). Everything AROUND it here is deterministic: the request is normalised
 * and hashed by the pure engine, the provenance is fixed, the adapter is
 * selected from resolved recipe signals, and every call is booked to the cost
 * ledger before the result is returned.
 *
 * The generation layer is an EXECUTION boundary. It never makes a design
 * decision — concept, hierarchy, composition, DKV, layout, photographic
 * character, graphic treatment and cultural direction were all resolved
 * upstream and arrive fixed on the request.
 */

/** Cost-ledger stage tag for a generation call. */
export type GenerationStage = "visual_generate";

/**
 * Explicit failure classes. A provider failure is never silently retried and
 * never turned into a successful artifact.
 */
export type GenerationIssueCode =
  | "not_configured" // no adapter / no credentials for the selected provider
  | "configuration_error" // the request or adapter config is internally invalid
  | "provider_unavailable" // provider down / network unreachable
  | "authentication_error" // credentials rejected
  | "rate_limited" // provider throttled the call
  | "content_rejected" // provider refused the prompt (safety / policy)
  | "malformed_request" // provider rejected the request shape
  | "timeout" // the call exceeded its budget
  | "unknown_provider_error"; // anything else the provider returned

export type GenerationIssue = {
  readonly code: GenerationIssueCode;
  readonly message: string;
  readonly provider?: string;
  readonly retryable: boolean;
};

export const generationIssue = (
  code: GenerationIssueCode,
  message: string,
  options: { provider?: string; retryable?: boolean } = {}
): GenerationIssue => ({
  code,
  message,
  provider: options.provider,
  retryable: options.retryable ?? (code === "rate_limited" || code === "provider_unavailable")
});

/** Cost the provider (or a test fixture) reports for one generation call. */
export type GenerationCost = {
  readonly currency: "USD";
  readonly estimated_cost_usd: number;
  readonly image_cost_usd: number | null;
  readonly input_cost_usd: number | null;
  /** Where the numbers came from — never presented as an invoice. */
  readonly pricing_basis: "provider-reported" | "estimated" | "test-fixture";
};

/**
 * One raw provider call, stripped of hashing, provenance, artifact assembly and
 * cost recording — exactly the shape a provider adapter reduces to, mirroring
 * `RawLlmCall`. The provider-independent client wraps it.
 */
export type RawGenerationRequest = {
  readonly prompt: string;
  readonly negativePrompt: string;
  readonly aspectRatioId: string;
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly adapterId: string;
  readonly seed: number | null;
  readonly timeoutMs: number;
};

export type RawGenerationResponse = {
  readonly ok: boolean;
  readonly provider: string;
  readonly model_id: string;
  readonly latency_ms: number;
  readonly image?: {
    readonly width: number;
    readonly height: number;
    readonly mime_type: string;
    /**
     * How the provider handed the image back. NEVER the bytes — a short opaque
     * handle only. Object storage / persistence is a later milestone.
     */
    readonly delivery: "none" | "base64-ref" | "url" | "provider-ref";
    readonly reference: string | null;
  };
  readonly cost?: GenerationCost;
  readonly seed?: number | null;
  readonly provider_request_id?: string | null;
  readonly finish_reason?: string | null;
  readonly safety?: string | null;
  readonly error?: { code: GenerationIssueCode; message: string };
};

export type RawGenerationCall = (request: RawGenerationRequest) => Promise<RawGenerationResponse>;

export type GenerateVisualOptions = {
  readonly projectId: string;
  /** Per call. The provider-independent client aborts a raw call that exceeds this. */
  readonly timeoutMs?: number;
};

/**
 * The port itself.
 *
 * Implementations MUST: book a cost-ledger event for every call before
 * returning (on success AND on failure), never retry, and never return an
 * artifact for a failed call.
 */
export type VisualGenerationPort = {
  generate(
    request: GenerationRequest,
    options: GenerateVisualOptions
  ): Promise<Result<GeneratedArtifact, GenerationIssue[]>>;
};
