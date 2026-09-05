import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

import { loadDatasets } from "../data/loader";
import { createGeminiLlm, DEFAULT_GEMINI_MODEL } from "../adapters/llm/gemini";
import { systemClock } from "../ports/clock.port";
import { sequentialIds } from "../ports/id.port";
import { normalizeBrief } from "../engine/brief/normalize";
import { createCostLedger } from "../services/cost.service";

export const REALITY_CHECK_BRIEF =
  "Buat poster Instagram 4:5 untuk coffee shop baru di Solo. Target anak muda. Ingin tampil modern Indonesia dengan sedikit nuansa Jepang. Fokus untuk grand opening.";

/** Load local development variables without ever logging their contents. */
export function loadLocalEnv(envPath = join(process.cwd(), ".env.local")): void {
  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function requireGeminiApiKey(
  environment: { readonly GEMINI_API_KEY?: string } | NodeJS.ProcessEnv = process.env
): string {
  const apiKey = environment.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing");
  return apiKey;
}

function printDiagnostics(input: {
  readonly success: boolean;
  readonly model: string;
  readonly calls: number;
  readonly tokens?: { input: number; output: number };
  readonly cost?: number;
  readonly outcome?: Awaited<ReturnType<typeof normalizeBrief>>;
  readonly failure?: string;
}): void {
  console.log(`model: ${input.model}`);
  console.log(`success: ${input.success}`);
  if (input.outcome?.ok && input.outcome.value.brief) {
    const brief = input.outcome.value.brief;
    console.log(`normalized objective: ${brief.objective}`);
    console.log(`industry: ${brief.industry_id}`);
    console.log(`visual type: ${brief.visual_type_id}`);
    console.log(`country blend: ${JSON.stringify(brief.country)}`);
    console.log(`platform: ${brief.platform.channel}`);
    console.log(`audience summary: ${brief.audience.description}`);
    console.log(`completeness score: ${input.outcome.value.completeness.completeness_score}`);
  }
  if (input.failure) console.log(`failure: ${input.failure}`);
  console.log(`model call count: ${input.calls}`);
  if (input.tokens) {
    console.log(`input tokens: ${input.tokens.input}`);
    console.log(`output tokens: ${input.tokens.output}`);
  }
  if (input.cost !== undefined) console.log(`estimated cost USD: ${input.cost}`);
}

export async function runRealityCheck(): Promise<void> {
  loadLocalEnv();
  const apiKey = requireGeminiApiKey();
  const clock = systemClock;
  const ledger = createCostLedger({ clock });
  const llm = createGeminiLlm({
    apiKey,
    clock,
    ledger,
    maxAttempts: 1
  });

  const result = await normalizeBrief({
    rawBrief: REALITY_CHECK_BRIEF,
    projectId: "reality_check",
    datasets: loadDatasets(),
    llm,
    ids: sequentialIds()
  });
  const events = ledger.list("reality_check");
  const event = events[0];
  const metadata = event
    ? { input: event.input_tokens, output: event.output_tokens }
    : undefined;

  if (!result.ok) {
    printDiagnostics({
      success: false,
      model: event?.model_id ?? DEFAULT_GEMINI_MODEL,
      calls: events.length,
      tokens: metadata,
      cost: event?.estimated_cost_usd,
      failure: result.error.map((issue) => `${issue.code}: ${issue.message}`).join("; ")
    });
    throw new Error("Gemini reality check failed");
  }

  if (!result.value.brief) {
    printDiagnostics({
      success: false,
      model: event?.model_id ?? DEFAULT_GEMINI_MODEL,
      calls: events.length,
      tokens: metadata,
      cost: event?.estimated_cost_usd,
      outcome: result,
      failure: `normalization incomplete: ${result.value.completeness.missing_fields.join(", ")}`
    });
    throw new Error("Gemini reality check normalization failed");
  }

  printDiagnostics({
    success: true,
    model: result.value.meta.model_id,
    calls: events.length,
    tokens: metadata,
    cost: event?.estimated_cost_usd,
    outcome: result
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRealityCheck().catch((error: unknown) => {
    console.error(`reality-check failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}