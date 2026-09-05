import type { LlmPort, RawLlmCall, RawLlmResponse } from "../../ports/llm.port";
import type { CostLedgerPort } from "../../ports/cost.port";
import type { ClockPort } from "../../ports/clock.port";
import { createStructuredClient } from "../../adapters/llm/structured-client";

/**
 * Fake provider for tests.
 *
 * It replaces ONLY the raw provider call and is wrapped by the real
 * createStructuredClient, so JSON extraction, schema validation, the repair
 * retry and cost recording are the production code paths. A fake that
 * reimplemented those would test the fake.
 */

export type ScriptedTurn = {
  readonly text?: string;
  readonly ok?: boolean;
  readonly error?: RawLlmResponse["error"];
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly latency_ms?: number;
  /** Throw instead of returning, to exercise the try/catch path. */
  readonly throws?: string;
};

export const FAKE_PROVIDER = "fake";
export const FAKE_MODEL = "gemini-2.5-flash";

export type FakeLlm = {
  readonly port: LlmPort;
  /** Prompts as they were actually sent, so repair prompts can be inspected. */
  readonly prompts: string[];
  readonly callCount: () => number;
};

export function createFakeLlm(
  script: readonly ScriptedTurn[],
  deps: { ledger: CostLedgerPort; clock: ClockPort; model?: string }
): FakeLlm {
  const prompts: string[] = [];
  let index = 0;

  const call: RawLlmCall = async (request) => {
    const turn = script[index] ?? script[script.length - 1];
    index += 1;
    prompts.push(request.prompt);

    if (turn?.throws) throw new Error(turn.throws);

    return {
      ok: turn?.ok ?? true,
      text: turn?.text ?? "",
      provider: FAKE_PROVIDER,
      model_id: deps.model ?? FAKE_MODEL,
      input_tokens: turn?.input_tokens ?? 1200,
      output_tokens: turn?.output_tokens ?? 420,
      latency_ms: turn?.latency_ms ?? 640,
      error: turn?.error
    };
  };

  return {
    port: createStructuredClient({ call, ledger: deps.ledger, clock: deps.clock }),
    prompts,
    callCount: () => index
  };
}
