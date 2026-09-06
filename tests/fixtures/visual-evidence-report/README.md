# Visual-evidence observation fixtures (P2.14)

Each `*.json` file is a **sanitised, synthetic** `VisionObservationPayload` —
the raw structured shape a vision provider returns when asked to *describe* one
generated image (`ports/visual-evidence.port.ts`).

## Why synthetic

The Gemini account behind `GEMINI_API_KEY` has **image-generation quota = 0**
(P2.12 / P2.13 both returned HTTP 429), so there is no real generated frame to
send to a vision model, and therefore no real vision response to record. These
fixtures mirror the documented observation shape so CI can exercise the full
`RawVisionCall → createVisualEvidenceClient → VisualEvidenceReport` path without
a network. They are replaced with real recordings the moment a real generation
exists to inspect; the replay test does not change.

## Sanitisation

- **Observation only.** No quality score, no pass/fail, no advice — the payload
  answers "what is present", never "is it good".
- **No API key, no auth headers, no credentials, no real image bytes.**
- Region rectangles and ratios are plausible for the design under test but are
  not measured from a real render.
