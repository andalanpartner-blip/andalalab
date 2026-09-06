import type { ClockPort } from "../../ports/clock.port";
import type { CostLedgerPort } from "../../ports/cost.port";
import type { IdPort } from "../../ports/id.port";
import type {
  GenerationCost,
  GenerationEstimate,
  GenerationIssueCode,
  RawGenerationCall,
  RawGenerationResponse,
  VisualGenerationPort
} from "../../ports/visual-generation.port";
import type { GenerationRequest } from "../../types/schemas/visual-generation.schema";
import { fnv1a } from "../../types/primitives";
import { createVisualGenerationClient } from "./client";

/**
 * Gemini image-generation adapter — P2.12. Execution only.
 *
 * Everything Gemini-specific stops at this file: the `generateContent` endpoint,
 * the `contents` / `generationConfig.imageConfig` body, the
 * `candidates[].content.parts[].inlineData` response, the `usageMetadata` token
 * fields, the per-image token pricing. The rest of the system never sees any of
 * it — the adapter reduces to one `RawGenerationCall` and is wrapped by the
 * unchanged P2.11 `createVisualGenerationClient`.
 *
 * It makes NO design decision. It serialises the already-compiled prompt and
 * the already-resolved target, and sends them. It does not append creative
 * instructions and does not rewrite the prompt.
 *
 * Model / endpoint / pricing verified against the current Gemini API docs:
 *   https://ai.google.dev/gemini-api/docs/image-generation  (generateContent, legacy path)
 *   https://ai.google.dev/gemini-api/docs/pricing
 */

export const GEMINI_IMAGE_PROVIDER = "google";
export const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";
export const GEMINI_IMAGE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Paid-tier "standard" rates, per 1M tokens, checked against
 * ai.google.dev/gemini-api/docs/pricing on this date. An estimate for budgeting
 * and for catching a runaway loop — not an invoice.
 */
export const GEMINI_IMAGE_PRICING_AS_OF = "2026-09-06";
const RATE_INPUT_PER_MILLION_USD = 0.5;
const RATE_IMAGE_OUTPUT_PER_MILLION_USD = 60.0;
/** Published per-image output-token counts by resolution (pricing page). */
const IMAGE_OUTPUT_TOKENS: Record<GeminiImageSize, number> = {
  "512px": 747,
  "1K": 1120,
  "2K": 1680,
  "4K": 2520
};

/** The provider's supported aspect-ratio strings (image-generation docs). */
const SUPPORTED_ASPECT_RATIOS = new Set([
  "1:1",
  "1:4",
  "1:8",
  "2:3",
  "3:2",
  "3:4",
  "4:1",
  "4:3",
  "4:5",
  "5:4",
  "8:1",
  "9:16",
  "16:9",
  "21:9"
]);

type GeminiImageSize = "512px" | "1K" | "2K" | "4K";

/** Injectable so contract tests replay recorded responses without a network. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export type GeminiImageOptions = {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: FetchLike;
  readonly clock: ClockPort;
  /**
   * Called with the decoded image bytes on success, then forgotten by the
   * adapter (no persistence). Used only by the deliberate live smoke test to
   * write the one image somewhere a human can look at it.
   */
  readonly onImageBytes?: (bytes: Uint8Array, mimeType: string) => void;
};

// --- deterministic provider mappings ---------------------------------

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Reduced "w:h" string, e.g. 1080x1350 → "4:5". */
export function reducedRatio(width: number, height: number): string {
  const g = gcd(width, height) || 1;
  return `${width / g}:${height / g}`;
}

/** The provider image-size bucket for the larger requested dimension. */
export function imageSizeFor(maxDimension: number): GeminiImageSize {
  if (maxDimension <= 640) return "512px";
  if (maxDimension <= 1536) return "1K";
  if (maxDimension <= 3072) return "2K";
  return "4K";
}

/** Read width/height from a PNG IHDR chunk. null when the bytes are not a PNG. */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i += 1) if (bytes[i] !== sig[i]) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

function decodeBase64(b64: string): Uint8Array {
  // Node + modern runtimes: atob is available; Buffer is the fallback.
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

const round6 = (n: number): number => Math.round(n * 1_000_000) / 1_000_000;

/**
 * Deterministic pre-call cost estimate — same published rates, applied to the
 * request instead of a provider response. Input tokens are approximated from
 * the prompt length (~4 chars/token); the image output token count is the
 * published figure for the resolution bucket. No network, no cost event.
 */
export function estimateGeminiImageCost(
  targetWidth: number,
  targetHeight: number,
  promptChars: number
): GenerationCost {
  const size = imageSizeFor(Math.max(targetWidth, targetHeight));
  const inputTokens = Math.ceil(promptChars / 4);
  const inputCost = round6((inputTokens / 1_000_000) * RATE_INPUT_PER_MILLION_USD);
  const imageCost = round6((IMAGE_OUTPUT_TOKENS[size] / 1_000_000) * RATE_IMAGE_OUTPUT_PER_MILLION_USD);
  return {
    currency: "USD",
    estimated_cost_usd: round6(inputCost + imageCost),
    image_cost_usd: imageCost,
    input_cost_usd: inputCost,
    pricing_basis: "estimated"
  };
}

export function estimateGeminiImage(request: GenerationRequest, model = GEMINI_IMAGE_MODEL): GenerationEstimate {
  return {
    provider: GEMINI_IMAGE_PROVIDER,
    model,
    adapter_id: request.provenance.adapter_id,
    cost: estimateGeminiImageCost(request.target.width, request.target.height, request.prompt.length)
  };
}

// --- response shape (Gemini generateContent, image) ------------------

type GeminiImageBody = {
  candidates?: {
    content?: { parts?: { text?: string; inlineData?: { mimeType?: string; data?: string } }[] };
    finishReason?: string;
    safetyRatings?: unknown;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  responseId?: string;
  error?: { code?: number; message?: string; status?: string };
};

const BLOCK_FINISH_REASONS = new Set([
  "SAFETY",
  "IMAGE_SAFETY",
  "PROHIBITED_CONTENT",
  "BLOCKLIST",
  "RECITATION",
  "SPII"
]);

function httpToIssue(status: number): GenerationIssueCode {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "authentication_error";
  if (status === 400) return "malformed_request";
  if (status === 404) return "configuration_error";
  if (status >= 500) return "provider_unavailable";
  return "unknown_provider_error";
}

// --- the raw call --------------------------------------------------

export function createGeminiImageCall(options: GeminiImageOptions): RawGenerationCall {
  const model = options.model ?? GEMINI_IMAGE_MODEL;
  const baseUrl = options.baseUrl ?? GEMINI_IMAGE_BASE_URL;
  const doFetch = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  return async (request) => {
    const started = options.clock.now().getTime();
    const base = { provider: GEMINI_IMAGE_PROVIDER, model_id: model } as const;
    const elapsed = () => Math.max(0, options.clock.now().getTime() - started);

    if (!options.apiKey) {
      return { ...base, ok: false, latency_ms: 0, error: { code: "not_configured", message: "GEMINI_API_KEY is not set" } };
    }

    const ratio = reducedRatio(request.targetWidth, request.targetHeight);
    if (!SUPPORTED_ASPECT_RATIOS.has(ratio)) {
      return {
        ...base,
        ok: false,
        latency_ms: 0,
        error: {
          code: "malformed_request",
          message: `aspect ratio ${ratio} (from "${request.aspectRatioId}", ${request.targetWidth}x${request.targetHeight}) is not one the provider supports`
        }
      };
    }
    const imageSize = imageSizeFor(Math.max(request.targetWidth, request.targetHeight));

    // The compiled prompt is authoritative — sent verbatim, no additions.
    // generateContent image generation exposes neither a negative-prompt nor a
    // seed parameter, so request.negativePrompt and request.seed are not sent.
    const body = JSON.stringify({
      contents: [{ role: "user", parts: [{ text: request.prompt }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: ratio, imageSize }
      }
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await doFetch(`${baseUrl}/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": options.apiKey },
        body,
        signal: controller.signal
      });
      const json = (await response.json()) as GeminiImageBody;
      const latency = elapsed();

      if (!response.ok || json.error) {
        return {
          ...base,
          ok: false,
          latency_ms: latency,
          error: {
            code: httpToIssue(response.status),
            message: json.error?.message ?? `Gemini image API returned HTTP ${response.status}`
          }
        };
      }

      const candidate = json.candidates?.[0];
      const finish = candidate?.finishReason ?? null;
      if (finish && BLOCK_FINISH_REASONS.has(finish)) {
        return {
          ...base,
          ok: false,
          latency_ms: latency,
          finish_reason: finish,
          error: { code: "content_rejected", message: `the provider refused this prompt (finishReason: ${finish})` }
        };
      }

      const imagePart = candidate?.content?.parts?.find((part) => part.inlineData?.data);
      const b64 = imagePart?.inlineData?.data;
      if (!b64) {
        return {
          ...base,
          ok: false,
          latency_ms: latency,
          finish_reason: finish,
          error: {
            code: "unknown_provider_error",
            message: `the response carried no image (finishReason: ${finish ?? "none"})`
          }
        };
      }

      const mime = imagePart?.inlineData?.mimeType ?? "image/png";
      const bytes = decodeBase64(b64);
      options.onImageBytes?.(bytes, mime);
      const png = readPngSize(bytes);
      const width = png?.width ?? request.targetWidth;
      const height = png?.height ?? request.targetHeight;

      const usage = json.usageMetadata ?? {};
      const promptTokens = usage.promptTokenCount ?? 0;
      const imageTokens = usage.candidatesTokenCount ?? IMAGE_OUTPUT_TOKENS[imageSize];
      const inputCost = round6((promptTokens / 1_000_000) * RATE_INPUT_PER_MILLION_USD);
      const imageCost = round6((imageTokens / 1_000_000) * RATE_IMAGE_OUTPUT_PER_MILLION_USD);

      const image: NonNullable<RawGenerationResponse["image"]> = {
        width,
        height,
        mime_type: mime,
        // No persistence in this milestone: a short content fingerprint, never the bytes.
        delivery: "base64-ref",
        reference: `${fnv1a(b64)}:${b64.length}`
      };

      return {
        ...base,
        ok: true,
        latency_ms: latency,
        image,
        cost: {
          currency: "USD",
          estimated_cost_usd: round6(inputCost + imageCost),
          image_cost_usd: imageCost,
          input_cost_usd: inputCost,
          pricing_basis: "estimated"
        },
        seed: null,
        provider_request_id: json.responseId ?? null,
        finish_reason: finish,
        safety: candidate?.safetyRatings ? JSON.stringify(candidate.safetyRatings) : null
      };
    } catch (error) {
      const aborted = (error as Error).name === "AbortError";
      return {
        ...base,
        ok: false,
        latency_ms: elapsed(),
        error: {
          code: aborted ? "timeout" : "provider_unavailable",
          message: aborted
            ? `Gemini image call exceeded ${request.timeoutMs}ms`
            : (error as Error).message
        }
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** A ready-to-use Gemini-image-backed `VisualGenerationPort`. */
export function createGeminiImageGeneration(
  options: GeminiImageOptions & { ledger: CostLedgerPort; ids: IdPort }
): VisualGenerationPort {
  const model = options.model ?? GEMINI_IMAGE_MODEL;
  return createVisualGenerationClient({
    call: createGeminiImageCall(options),
    estimate: (request) => estimateGeminiImage(request, model),
    ledger: options.ledger,
    clock: options.clock,
    ids: options.ids
  });
}
