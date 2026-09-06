import type { ClockPort } from "../../ports/clock.port";
import type { CostLedgerPort } from "../../ports/cost.port";
import type { IdPort } from "../../ports/id.port";
import type {
  EvidenceIssueCode,
  RawVisionCall,
  RawVisionResponse,
  VisualEvidencePort
} from "../../ports/visual-evidence.port";
import { VisionObservationPayload } from "../../ports/visual-evidence.port";
import { estimateCostUsd } from "../../services/cost.service";
import { createVisualEvidenceClient } from "./client";

/**
 * Gemini vision (multimodal) evidence adapter — P2.14. Observation only.
 *
 * Everything Gemini-specific stops at this file: the `generateContent`
 * endpoint, the `inlineData` image part, the JSON response-mime request, the
 * `usageMetadata` token fields. The rest of the system never sees any of it —
 * the adapter reduces to one `RawVisionCall` wrapped by the provider-neutral
 * `createVisualEvidenceClient`.
 *
 * It asks the model for a fixed, descriptive observation structure ONLY — no
 * judgment, no scoring, no advice. The instruction is a schema description, not
 * a design brief; the adapter never sends the recipe, the blueprint or the
 * prompt.
 *
 * Model / endpoint verified against the current Gemini API docs:
 *   https://ai.google.dev/gemini-api/docs/vision  (generateContent, inlineData)
 */

export const GEMINI_VISION_PROVIDER = "google";
export const GEMINI_VISION_MODEL = "gemini-3.1-flash-lite";
export const GEMINI_VISION_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/** The observation instruction. A structure description — never a design brief. */
export const OBSERVATION_INSTRUCTION = [
  "You are an image-observation tool. Look at the attached image and report ONLY what is visibly present.",
  "Do NOT judge quality. Do NOT say whether anything is good, correct, balanced or effective.",
  "Do NOT give advice or recommendations. Report observations as neutral facts.",
  "Return a single JSON object with these keys:",
  "region_count (integer|null): how many distinct visual regions you can see.",
  "regions (array): each { kind: one of image|text|graphic|product|person|background|unknown, rect: {x,y,w,h} as fractions 0..1 from the top-left, area_share: 0..1, confidence: 0..1|null }.",
  "text_region_count (integer|null): how many regions appear to contain rendered text.",
  "text_blocks (array): each { rect: {x,y,w,h} 0..1, text: the transcribed text or null, confidence: 0..1|null }.",
  "dominant_region_index (integer|null): index into regions of the largest / most salient region.",
  "approx_subject_position ({x,y} 0..1 | null): approximate centre of the main subject.",
  "person_present (boolean|null): whether a person or face is visible.",
  "whitespace_share (0..1|null): approximate fraction of the frame that is empty / negative space.",
  "approx_visual_density (0..1|null): approximate how visually busy the frame is.",
  "color ({ dominant_hexes: string[], approx_palette_size: integer|null, approx_contrast: 0..1|null } | null).",
  "edge_bleed (none|partial|full|null): whether content runs off the edges.",
  "crop_behavior (as-requested|cropped|padded|unknown|null).",
  "semantic_descriptors (string[]): short neutral tags for objects / scene.",
  "overall_confidence (0..1|null): your overall confidence in these observations.",
  "Use null for anything you cannot determine. Never guess."
].join("\n");

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export type GeminiVisionOptions = {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: FetchLike;
  readonly clock: ClockPort;
};

function httpToIssue(status: number): EvidenceIssueCode {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "authentication_error";
  if (status === 400) return "malformed_request";
  if (status === 404) return "configuration_error";
  if (status >= 500) return "provider_unavailable";
  return "unknown_provider_error";
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

type GeminiBody = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { code?: number; message?: string; status?: string };
};

const BLOCK_FINISH = new Set(["SAFETY", "IMAGE_SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "RECITATION", "SPII"]);

export function createGeminiVisionCall(options: GeminiVisionOptions): RawVisionCall {
  const model = options.model ?? GEMINI_VISION_MODEL;
  const baseUrl = options.baseUrl ?? GEMINI_VISION_BASE_URL;
  const doFetch = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  return async (request) => {
    const started = options.clock.now().getTime();
    const base = { provider: GEMINI_VISION_PROVIDER, model_id: model } as const;
    const elapsed = () => Math.max(0, options.clock.now().getTime() - started);

    if (!options.apiKey) {
      return { ...base, ok: false, latency_ms: 0, error: { code: "not_configured", message: "GEMINI_API_KEY is not set" } };
    }

    const body = JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: OBSERVATION_INSTRUCTION },
            { inlineData: { mimeType: request.mimeType || "image/png", data: toBase64(request.imageBytes) } }
          ]
        }
      ],
      generationConfig: { temperature: 0, responseMimeType: "application/json" }
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
      const json = (await response.json()) as GeminiBody;
      const latency = elapsed();

      if (!response.ok || json.error) {
        return {
          ...base,
          ok: false,
          latency_ms: latency,
          error: {
            code: httpToIssue(response.status),
            message: json.error?.message ?? `Gemini vision API returned HTTP ${response.status}`
          }
        };
      }

      const candidate = json.candidates?.[0];
      const finish = candidate?.finishReason ?? null;
      if (finish && BLOCK_FINISH.has(finish)) {
        return {
          ...base,
          ok: false,
          latency_ms: latency,
          error: { code: "content_rejected", message: `the provider refused to describe the image (finishReason: ${finish})` }
        };
      }

      const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return {
          ...base,
          ok: false,
          latency_ms: latency,
          error: { code: "invalid_observation", message: "the vision response was not valid JSON" }
        };
      }

      const validated = VisionObservationPayload.safeParse(coerce(parsed));
      if (!validated.success) {
        return {
          ...base,
          ok: false,
          latency_ms: latency,
          error: {
            code: "invalid_observation",
            message: `the vision response did not match the observation shape: ${validated.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")}`
          }
        };
      }

      const usage = json.usageMetadata ?? {};
      const inputTokens = usage.promptTokenCount ?? 0;
      const outputTokens = usage.candidatesTokenCount ?? 0;

      const result: RawVisionResponse = {
        ...base,
        ok: true,
        latency_ms: latency,
        observations: validated.data,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: estimateCostUsd(model, inputTokens, outputTokens)
      };
      return result;
    } catch (error) {
      const aborted = (error as Error).name === "AbortError";
      return {
        ...base,
        ok: false,
        latency_ms: elapsed(),
        error: {
          code: aborted ? "timeout" : "provider_unavailable",
          message: aborted ? `Gemini vision call exceeded ${request.timeoutMs}ms` : (error as Error).message
        }
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Fill absent optional keys with null so a terse-but-valid model reply still parses. */
function coerce(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const obj = value as Record<string, unknown>;
  const keyed = (key: string, fallback: unknown) => (key in obj ? obj[key] : fallback);
  return {
    region_count: keyed("region_count", null),
    regions: keyed("regions", []),
    text_region_count: keyed("text_region_count", null),
    text_blocks: keyed("text_blocks", []),
    dominant_region_index: keyed("dominant_region_index", null),
    approx_subject_position: keyed("approx_subject_position", null),
    person_present: keyed("person_present", null),
    whitespace_share: keyed("whitespace_share", null),
    approx_visual_density: keyed("approx_visual_density", null),
    color: keyed("color", null),
    edge_bleed: keyed("edge_bleed", null),
    crop_behavior: keyed("crop_behavior", null),
    semantic_descriptors: keyed("semantic_descriptors", []),
    overall_confidence: keyed("overall_confidence", null)
  };
}

/** A ready-to-use Gemini-vision-backed `VisualEvidencePort`. Books one cost event per call. */
export function createGeminiVisualEvidence(
  options: GeminiVisionOptions & { ledger: CostLedgerPort; ids: IdPort; datasetVersion: string }
): VisualEvidencePort {
  const model = options.model ?? GEMINI_VISION_MODEL;
  return createVisualEvidenceClient({
    call: createGeminiVisionCall(options),
    source: { kind: "vision-model", provider: GEMINI_VISION_PROVIDER, model },
    ledger: options.ledger,
    clock: options.clock,
    ids: options.ids,
    meter: true,
    datasetVersion: options.datasetVersion
  });
}
