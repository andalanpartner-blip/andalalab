import { describe, expect, it } from "vitest";
import { requireGeminiApiKey } from "../../scripts/reality-check";

describe("reality-check configuration", () => {
  it("fails clearly when the API key is missing without exposing credentials", () => {
    expect(() => requireGeminiApiKey({})).toThrow("GEMINI_API_KEY is missing");
    expect(() => requireGeminiApiKey({ GEMINI_API_KEY: "secret" })).not.toThrow();
  });
});