import type { CostEvent, CostLedgerPort } from "../ports/cost.port";
import type { ClockPort } from "../ports/clock.port";

/**
 * Cost ledger.
 *
 * Rates are published per million tokens and change; they are pinned here with
 * the date they were checked so a stale table is visible rather than silently
 * wrong. Verify against https://ai.google.dev/gemini-api/docs/pricing before
 * trusting a number for billing — this is an estimate for budgeting and for
 * spotting a runaway loop, not an invoice.
 */

export const PRICING_AS_OF = "2026-09-04";

export type ModelRate = {
  readonly input_per_million_usd: number;
  readonly output_per_million_usd: number;
};

/** USD per million tokens, checked against ai.google.dev on PRICING_AS_OF. */
export const MODEL_RATES: Record<string, ModelRate> = {
  "gemini-2.5-flash-lite": { input_per_million_usd: 0.1, output_per_million_usd: 0.4 },
  "gemini-2.5-flash": { input_per_million_usd: 0.3, output_per_million_usd: 2.5 },
  "gemini-2.5-pro": { input_per_million_usd: 1.25, output_per_million_usd: 10.0 },
  "gemini-3-flash": { input_per_million_usd: 0.5, output_per_million_usd: 3.0 },
  "gemini-3.1-flash-lite": { input_per_million_usd: 0.25, output_per_million_usd: 1.5 },
  "gemini-3.1-pro": { input_per_million_usd: 2.0, output_per_million_usd: 12.0 }
};

/** Used when a model is not in the table, so an unknown model still books cost. */
export const FALLBACK_RATE: ModelRate = {
  input_per_million_usd: 1.0,
  output_per_million_usd: 5.0
};

export function rateFor(modelId: string): { rate: ModelRate; known: boolean } {
  const rate = MODEL_RATES[modelId];
  return rate ? { rate, known: true } : { rate: FALLBACK_RATE, known: false };
}

export function estimateCostUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number {
  const { rate } = rateFor(modelId);
  const cost =
    (inputTokens / 1_000_000) * rate.input_per_million_usd +
    (outputTokens / 1_000_000) * rate.output_per_million_usd;
  // Six decimals: a single brief interpretation costs fractions of a cent and
  // rounding to four would report most calls as free.
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export type LedgerLogger = (line: string, fields: Record<string, unknown>) => void;

export type CreateLedgerOptions = {
  readonly clock: ClockPort;
  readonly logger?: LedgerLogger;
  /** Refuse to record beyond this many calls per project. 0 disables the cap. */
  readonly maxCallsPerProject?: number;
};

export class CostCapExceededError extends Error {
  constructor(projectId: string, cap: number) {
    super(`project ${projectId} exceeded its cap of ${cap} model call(s)`);
    this.name = "CostCapExceededError";
  }
}

/**
 * In-memory ledger. P4 swaps this for a Supabase-backed implementation behind
 * the same port; nothing upstream changes.
 */
export function createCostLedger(options: CreateLedgerOptions): CostLedgerPort {
  const events: CostEvent[] = [];
  const cap = options.maxCallsPerProject ?? 0;

  return {
    async record(event: CostEvent): Promise<void> {
      if (cap > 0) {
        const used = events.filter((entry) => entry.project_id === event.project_id).length;
        if (used >= cap) throw new CostCapExceededError(event.project_id, cap);
      }
      events.push(event);
      // Never log prompts, responses or credentials — only accounting fields.
      options.logger?.("llm_call", {
        project_id: event.project_id,
        stage: event.stage,
        provider: event.provider,
        model: event.model_id,
        template_version: event.prompt_template_version,
        attempt: event.attempt,
        status: event.status,
        latency_ms: event.latency_ms,
        input_tokens: event.input_tokens,
        output_tokens: event.output_tokens,
        estimated_cost_usd: event.estimated_cost_usd
      });
    },

    list(projectId?: string): readonly CostEvent[] {
      return projectId ? events.filter((event) => event.project_id === projectId) : [...events];
    },

    totalUsd(projectId?: string): number {
      const total = this.list(projectId).reduce(
        (sum, event) => sum + event.estimated_cost_usd,
        0
      );
      return Math.round(total * 1_000_000) / 1_000_000;
    }
  };
}

/** Build a ledger event from call metadata. Pure. */
export function costEventFrom(input: {
  readonly projectId: string;
  readonly stage: CostEvent["stage"];
  readonly provider: string;
  readonly modelId: string;
  readonly templateVersion: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly status: CostEvent["status"];
  readonly attempt: number;
  readonly createdAt: string;
}): CostEvent {
  return {
    project_id: input.projectId,
    stage: input.stage,
    provider: input.provider,
    model_id: input.modelId,
    prompt_template_version: input.templateVersion,
    input_tokens: input.inputTokens,
    output_tokens: input.outputTokens,
    estimated_cost_usd: estimateCostUsd(input.modelId, input.inputTokens, input.outputTokens),
    latency_ms: input.latencyMs,
    status: input.status,
    attempt: input.attempt,
    created_at: input.createdAt
  };
}
