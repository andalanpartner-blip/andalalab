import type { LlmIssueCode, LlmPort, RawLlmCall, RawLlmResponse } from "../../ports/llm.port";
import type { CostLedgerPort } from "../../ports/cost.port";
import type { ClockPort } from "../../ports/clock.port";
import { createStructuredClient } from "./structured-client";

/**
 * Gemini adapter — the first provider.
 *
 * Everything Gemini-specific stops at this file: the endpoint shape, the
 * `contents`/`generationConfig` body, the `usageMetadata` token fields. The
 * engine never sees any of it. Adding Anthropic or OpenAI means writing a
 * sibling of this file and changing nothing else.
 */

export const GEMINI_PROVIDER = "google";
export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Default model.
 *
 * Brief interpretation is a short classification task over ~1.5k input tokens.
 * Flash-Lite is suitable for this short structured extraction task and keeps
 * the local reality check within the Gemini API Free Tier.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";

/** Injectable so contract tests can replay recorded responses without a network. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export type GeminiOptions = {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: FetchLike;
  readonly clock: ClockPort;
  readonly maxAttempts?: 1 | 2;
};

type GeminiResponseBody = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: { code?: number; message?: string; status?: string };
};

const statusToIssue = (status: number): LlmIssueCode => {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "not_configured";
  return "provider_error";
};

/** Extract the text from a Gemini response, tolerating multi-part candidates. */
export function readGeminiText(body: GeminiResponseBody): string {
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

export function createGeminiCall(options: GeminiOptions): RawLlmCall {
  const model = options.model ?? DEFAULT_GEMINI_MODEL;
  const baseUrl = options.baseUrl ?? GEMINI_BASE_URL;
  const doFetch = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  return async (request) => {
    const started = options.clock.now().getTime();
    const base: Omit<RawLlmResponse, "ok" | "text"> = {
      provider: GEMINI_PROVIDER,
      model_id: model,
      input_tokens: 0,
      output_tokens: 0,
      latency_ms: 0
    };

    if (!options.apiKey) {
      return {
        ...base,
        ok: false,
        text: "",
        error: { code: "not_configured", message: "GEMINI_API_KEY is not set" }
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);

    try {
      // The key goes in a header, never in the URL — query strings end up in
      // logs, proxies and error reports.
      const response = await doFetch(`${baseUrl}/${model}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": options.apiKey
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: request.prompt }] }],
          ...(request.system
            ? { systemInstruction: { parts: [{ text: request.system }] } }
            : {}),
          generationConfig: {
            temperature: request.temperature,
            maxOutputTokens: request.maxOutputTokens,
            // Ask for JSON at the API level rather than trusting the prompt.
            responseMimeType: "application/json"
          }
        }),
        signal: controller.signal
      });

      const body = (await response.json()) as GeminiResponseBody;
      const latency = Math.max(0, options.clock.now().getTime() - started);
      const usage = body.usageMetadata ?? {};

      const meta = {
        ...base,
        input_tokens: usage.promptTokenCount ?? 0,
        output_tokens: usage.candidatesTokenCount ?? 0,
        latency_ms: latency
      };

      if (!response.ok || body.error) {
        return {
          ...meta,
          ok: false,
          text: "",
          error: {
            code: statusToIssue(response.status),
            message: body.error?.message ?? `Gemini returned HTTP ${response.status}`
          }
        };
      }

      const text = readGeminiText(body);
      if (text.length === 0) {
        return {
          ...meta,
          ok: false,
          text: "",
          error: {
            code: "empty_response",
            message: `Gemini returned no text (finishReason: ${
              body.candidates?.[0]?.finishReason ?? "unknown"
            })`
          }
        };
      }

      return { ...meta, ok: true, text };
    } catch (error) {
      const aborted = (error as Error).name === "AbortError";
      return {
        ...base,
        ok: false,
        text: "",
        latency_ms: Math.max(0, options.clock.now().getTime() - started),
        error: {
          code: aborted ? "timeout" : "provider_error",
          message: aborted
            ? `Gemini call exceeded ${request.timeoutMs}ms`
            : (error as Error).message
        }
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** A ready-to-use Gemini-backed LlmPort. */
export function createGeminiLlm(
  options: GeminiOptions & { ledger: CostLedgerPort }
): LlmPort {
  return createStructuredClient({
    call: createGeminiCall(options),
    ledger: options.ledger,
    clock: options.clock,
    maxAttempts: options.maxAttempts
  });
}
