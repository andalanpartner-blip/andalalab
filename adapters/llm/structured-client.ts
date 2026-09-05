import type { z } from "zod";
import type {
  GenerateOptions,
  LlmCallMeta,
  LlmIssue,
  LlmOutput,
  LlmPort,
  RawLlmCall,
  RawLlmResponse
} from "../../ports/llm.port";
import { llmIssue } from "../../ports/llm.port";
import type { CostLedgerPort } from "../../ports/cost.port";
import type { ClockPort } from "../../ports/clock.port";
import { costEventFrom } from "../../services/cost.service";
import { err, ok, type Result } from "../../engine/util/result";

/**
 * Provider-independent structured client.
 *
 * Every provider adapter reduces to one function: prompt in, text out. This
 * wrapper supplies everything else — JSON extraction, schema validation, the
 * single repair retry, metadata aggregation and cost recording — so that
 * behaviour is identical across providers and, critically, so the fake used in
 * tests exercises exactly the same code path as Gemini does in production.
 *
 * A fake that reimplements the retry logic tests the fake, not the system.
 */

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 2048;
/** Extraction is a classification task; sampling variety is not wanted here. */
export const DEFAULT_TEMPERATURE = 0;
/** Hard ceiling. One original call plus at most one repair. Never more. */
export const MAX_ATTEMPTS = 2;

/**
 * Pull a JSON object out of a model response.
 *
 * Models wrap JSON in fences and add a sentence of preamble no matter how
 * firmly the prompt forbids it. Recovering from that locally is far cheaper
 * than spending a whole repair call on punctuation.
 */
export function extractJson(text: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, reason: "response was empty" };

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1]?.trim(), trimmed].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );

  for (const candidate of candidates) {
    try {
      return { ok: true, value: JSON.parse(candidate) as unknown };
    } catch {
      // Fall through to the brace-slice attempt below.
    }
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return { ok: true, value: JSON.parse(candidate.slice(start, end + 1)) as unknown };
      } catch {
        // Try the next candidate.
      }
    }
  }

  return { ok: false, reason: "no parsable JSON object in the response" };
}

/**
 * Build the repair instruction from Zod issues.
 *
 * Deterministic and mechanical: it lists the exact paths that failed and what
 * was expected. It never restates the task, because a repair prompt that
 * re-explains the job invites the model to reinterpret it.
 */
export function buildRepairInstruction(
  issues: readonly z.ZodIssue[],
  previousOutput: string
): string {
  const lines = issues
    .slice(0, 20)
    .map((issue) => `- ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");

  return [
    "Your previous response did not match the required schema.",
    "",
    "Previous response:",
    previousOutput.slice(0, 4000),
    "",
    "Validation errors:",
    lines,
    "",
    "Return the corrected JSON object only. Fix exactly these errors.",
    "Do not add commentary, do not wrap the JSON in code fences, and do not",
    "change any field that was already valid. If a value is genuinely unknown,",
    "use null rather than inventing one."
  ].join("\n");
}

export type StructuredClientOptions = {
  readonly call: RawLlmCall;
  readonly ledger: CostLedgerPort;
  readonly clock: ClockPort;
  readonly maxAttempts?: 1 | 2;
  readonly defaults?: {
    readonly timeoutMs?: number;
    readonly maxOutputTokens?: number;
    readonly temperature?: number;
  };
};

export function createStructuredClient(options: StructuredClientOptions): LlmPort {
  const { call, ledger, clock } = options;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;

  return {
    async generateStructured<T>(
      schema: z.ZodType<T, z.ZodTypeDef, unknown>,
      prompt: string,
      generateOptions: GenerateOptions
    ): Promise<Result<LlmOutput<T>, LlmIssue[]>> {
      const timeoutMs =
        generateOptions.timeoutMs ?? options.defaults?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const maxOutputTokens =
        generateOptions.maxOutputTokens ??
        options.defaults?.maxOutputTokens ??
        DEFAULT_MAX_OUTPUT_TOKENS;
      const temperature =
        generateOptions.temperature ?? options.defaults?.temperature ?? DEFAULT_TEMPERATURE;

      const issues: LlmIssue[] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      let latency = 0;
      let provider = "unknown";
      let modelId = "unknown";
      let currentPrompt = prompt;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const isRepair = attempt > 1;
        let response: RawLlmResponse;

        try {
          response = await call({
            prompt: currentPrompt,
            system: generateOptions.system,
            timeoutMs,
            maxOutputTokens,
            temperature
          });
        } catch (error) {
          response = {
            ok: false,
            text: "",
            provider,
            model_id: modelId,
            input_tokens: 0,
            output_tokens: 0,
            latency_ms: 0,
            error: { code: "provider_error", message: (error as Error).message }
          };
        }

        provider = response.provider;
        modelId = response.model_id;
        inputTokens += response.input_tokens;
        outputTokens += response.output_tokens;
        latency += response.latency_ms;

        // The cost of THIS call is booked before anything is decided about it.
        // A failed call still consumed tokens and still has to be paid for.
        await ledger.record(
          costEventFrom({
            projectId: generateOptions.projectId,
            stage: generateOptions.stage,
            provider: response.provider,
            modelId: response.model_id,
            templateVersion: generateOptions.templateVersion,
            inputTokens: response.input_tokens,
            outputTokens: response.output_tokens,
            latencyMs: response.latency_ms,
            status: response.ok ? (isRepair ? "repaired" : "ok") : "failed",
            attempt,
            createdAt: clock.now().toISOString()
          })
        );

        if (!response.ok) {
          issues.push(
            llmIssue(
              response.error?.code ?? "provider_error",
              response.error?.message ?? "provider call failed",
              attempt,
              { retryable: response.error?.code === "rate_limited" }
            )
          );
          // A provider-level failure is not a schema problem; a repair prompt
          // would not help, so stop rather than burn a second call.
          break;
        }

        const parsed = extractJson(response.text);
        if (!parsed.ok) {
          issues.push(llmIssue("invalid_json", parsed.reason, attempt, { retryable: true }));
          if (attempt < maxAttempts) {
            currentPrompt = `${prompt}\n\n${buildRepairInstruction([], response.text)}`;
            continue;
          }
          break;
        }

        const validated = schema.safeParse(parsed.value);
        if (validated.success) {
          const meta: LlmCallMeta = {
            provider,
            model_id: modelId,
            template_version: generateOptions.templateVersion,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            latency_ms: latency,
            attempts: attempt,
            repaired: isRepair,
            status: isRepair ? "repaired" : "ok"
          };
          return ok({ value: validated.data, meta });
        }

        for (const issue of validated.error.issues.slice(0, 20)) {
          issues.push(
            llmIssue("schema_invalid", issue.message, attempt, {
              path: issue.path.join(".") || "(root)",
              retryable: true
            })
          );
        }

        if (attempt < maxAttempts) {
          currentPrompt = `${prompt}\n\n${buildRepairInstruction(
            validated.error.issues,
            response.text
          )}`;
          continue;
        }

        issues.push(
          llmIssue(
            "repair_failed",
            `output still invalid after ${maxAttempts} attempt(s); giving up rather than looping`,
            attempt
          )
        );
      }

      return err(issues);
    }
  };
}
