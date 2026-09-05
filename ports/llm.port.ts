import type { z } from "zod";
import type { Result } from "../engine/util/result";

/**
 * The LLM boundary.
 *
 * This file is the ONLY thing the engine knows about language models. It
 * describes a capability — "turn this prompt into a value of this shape" — and
 * says nothing about who provides it. Swapping Gemini for Anthropic or OpenAI
 * must never require an edit to engine/brief/normalize.ts.
 *
 * Note what is NOT here: no free-text completion. The port cannot return prose,
 * only a value that has already survived a Zod schema. An LLM that can only
 * speak in validated structures cannot quietly take over a decision that
 * belongs to the deterministic engine.
 */

/** Where in the pipeline a call was made. Used for cost attribution. */
export type LlmStage =
  | "brief_normalize"
  | "concept_generate"
  | "prompt_polish"
  | "critic_judgment";

export type LlmIssueCode =
  | "provider_error"
  | "timeout"
  | "rate_limited"
  | "empty_response"
  | "invalid_json"
  | "schema_invalid"
  | "repair_failed"
  | "not_configured";

export type LlmIssue = {
  readonly code: LlmIssueCode;
  readonly message: string;
  /** Field path when the failure came from schema validation. */
  readonly path?: string;
  /** 1 for the first call, 2 for the repair attempt. */
  readonly attempt: number;
  readonly retryable: boolean;
};

export const llmIssue = (
  code: LlmIssueCode,
  message: string,
  attempt: number,
  options: { path?: string; retryable?: boolean } = {}
): LlmIssue => ({
  code,
  message,
  attempt,
  path: options.path,
  retryable: options.retryable ?? false
});

/** Everything the cost ledger and the logs need. Never contains the API key. */
export type LlmCallMeta = {
  readonly provider: string;
  readonly model_id: string;
  readonly template_version: string;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly latency_ms: number;
  /** 1 when the first response validated, 2 when a repair was needed. */
  readonly attempts: number;
  readonly repaired: boolean;
  readonly status: "ok" | "repaired" | "failed";
};

export type LlmOutput<T> = {
  readonly value: T;
  readonly meta: LlmCallMeta;
};

export type GenerateOptions = {
  readonly projectId: string;
  readonly stage: LlmStage;
  readonly templateVersion: string;
  /** Per call, not for the whole run. A repair gets its own budget. */
  readonly timeoutMs?: number;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly system?: string;
};

/**
 * The port itself.
 *
 * Implementations MUST: validate against the schema, retry exactly once with a
 * deterministic repair instruction when validation fails, never exceed two
 * model calls, and write a cost ledger event for every call before returning.
 */
export type LlmPort = {
  generateStructured<T>(
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    prompt: string,
    options: GenerateOptions
  ): Promise<Result<LlmOutput<T>, LlmIssue[]>>;
};

/** A single provider call, stripped of validation and retry concerns. */
export type RawLlmCall = (request: {
  readonly prompt: string;
  readonly system?: string;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
  readonly temperature: number;
}) => Promise<RawLlmResponse>;

export type RawLlmResponse = {
  readonly ok: boolean;
  readonly text: string;
  readonly provider: string;
  readonly model_id: string;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly latency_ms: number;
  readonly error?: { code: LlmIssueCode; message: string };
};
