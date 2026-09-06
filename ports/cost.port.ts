import type { LlmStage } from "./llm.port";
import type { GenerationStage } from "./visual-generation.port";

/**
 * Every pipeline stage that spends money with an external provider. LLM stages
 * (P2.1–P4.0) plus the P2.11 visual-generation stage. One ledger, one shape.
 */
export type CostStage = LlmStage | GenerationStage;

/**
 * Cost accounting, injected.
 *
 * Recording is not optional and not fire-and-forget: the structured client
 * awaits the write before returning, so a caller can never act on a model
 * result whose cost was never booked. Given how easily unmetered model calls
 * turn into a surprise invoice, "we forgot to log that one" is not an
 * acceptable failure mode.
 */
export type CostEvent = {
  readonly project_id: string;
  readonly stage: CostStage;
  readonly provider: string;
  readonly model_id: string;
  /** Prompt template / compiler version for an LLM call; request version for a generation call. */
  readonly prompt_template_version: string;
  /** 0 for a per-image generation call — images are not token-priced. */
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly estimated_cost_usd: number;
  readonly latency_ms: number;
  readonly status: "ok" | "repaired" | "failed";
  /** 1 for the first call, 2 for the repair attempt. */
  readonly attempt: number;
  readonly created_at: string;
};

export type CostLedgerPort = {
  record(event: CostEvent): Promise<void>;
  list(projectId?: string): readonly CostEvent[];
  totalUsd(projectId?: string): number;
};
