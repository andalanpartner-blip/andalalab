# Gemini image-generation replay fixture

`success.json` is a **sanitised, schema-accurate** recording of a successful
Gemini `generateContent` image response for `gemini-3.1-flash-image`, used by
`tests/unit/gemini-image-replay.test.ts` so CI never calls the provider.

## Why it is constructed, not captured

The account behind `GEMINI_API_KEY` has **image-generation quota = 0**
(`generate_content_free_tier_input_token_count, limit: 0, model:
gemini-3.1-flash-image`). Two deliberate live calls (P2.12, P2.13) both reached
the real endpoint and returned HTTP **429 rate_limited**. A real successful
capture is blocked on an **external account action** (enable paid billing /
image-generation quota on the Google Cloud project — see the P2.13 report).

`success.json` therefore mirrors the exact response shape documented at
<https://ai.google.dev/gemini-api/docs/generate-content/image-generation> and
verified during P2.12: `candidates[0].content.parts[]` with a `text` part and an
`inlineData` part (`mimeType` + base64 `data`), `finishReason`, `safetyRatings`,
`usageMetadata` and `responseId`. It is replaced with a real recording the
moment billing is enabled — the replay test does not change.

## Sanitisation

- **No API key, no auth headers, no credentials** — the fixture is a response
  body only.
- **No real image bytes.** `inlineData.data` is a 24-byte header-only PNG whose
  IHDR encodes `896 x 1120` (4:5, 1K), so the adapter's `readPngSize` returns
  real-from-bytes dimensions that differ from the request's `1080 x 1350` —
  proving the adapter reads dimensions from the returned bytes, not the request.
- The generated description text is elided.
- `responseId` is a placeholder of the documented shape.
- `usageMetadata` token counts are representative of a ~10k-character prompt and
  the published 1K-image output-token count (1120).
