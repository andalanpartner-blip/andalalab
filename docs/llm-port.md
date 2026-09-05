# LLM Port

The single boundary between the engine and any language model.

## Shape

```ts
generateStructured<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  prompt: string,
  options: GenerateOptions
): Promise<Result<LlmOutput<T>, LlmIssue[]>>
```

There is deliberately **no free-text completion method**. The port cannot return
prose, only a value that has already survived a Zod schema. A model that can
only speak in validated structures cannot quietly take over a decision that
belongs to the deterministic engine.

`LlmOutput<T>` carries the value plus `LlmCallMeta`: provider, model id,
template version, input/output tokens, latency, attempt count, whether a repair
happened, and status.

## Layers

```
engine/brief/normalize.ts        knows: LlmPort
        ↓
ports/llm.port.ts                types only, no implementation
        ↓
adapters/llm/structured-client   JSON extraction, validation, repair, cost
        ↓
adapters/llm/gemini.ts           the only file that knows what Gemini is
```

Adding Anthropic or OpenAI means writing a sibling of `gemini.ts` that satisfies
`RawLlmCall` — prompt in, text and token counts out. Nothing else changes.

## Repair loop

At most **two model calls**, ever.

1. Call the provider.
2. Extract JSON, tolerating code fences and preamble. Models add both regardless
   of instructions, and recovering locally is cheaper than spending a repair
   call on punctuation.
3. Validate against the schema.
4. On failure, build a deterministic repair instruction listing the exact failing
   paths and expectations, and call once more. The repair prompt never restates
   the task — re-explaining the job invites reinterpretation.
5. Validate again. Still invalid, return typed `LlmIssue[]`.

A **provider-level failure does not consume the repair call**. A 429 or a socket
reset is not a schema problem and a repair prompt would not fix it.

## Cost is not optional

Every model call writes a `CostEvent` *before* the result is returned, and the
write is awaited. A failed call still consumed tokens and is still booked, with
`status: "failed"`. A repaired run produces two events, because you paid twice.

The ledger accepts an optional per-project call cap that throws when exceeded —
cheap insurance against a runaway loop.

Rates in `services/cost.service.ts` are pinned with `PRICING_AS_OF` so a stale
table is visible rather than silently wrong. They are estimates for budgeting,
not an invoice.

## Logging

Accounting fields only: project, stage, provider, model, template version,
attempt, status, latency, tokens, cost. Never prompts, never responses, never
keys. The API key travels in the `x-goog-api-key` header, never in the URL,
because query strings end up in logs and proxies. A test asserts both.

## Testing

The fake provider replaces **only** the raw call and is wrapped by the real
`createStructuredClient`, so JSON extraction, validation, repair and cost
recording are the production code paths in every test. A fake that
reimplemented them would test the fake.

Gemini contract tests replay recorded HTTP responses through an injected
`fetchImpl`. CI never touches the network.
