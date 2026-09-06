import { randomUUID } from "node:crypto";

/**
 * Minimal structured logging (P2.20-Q).
 *
 * One line per AI operation with the fields cost control and debugging need.
 * NEVER logs: API keys, auth tokens, session cookies, raw image bytes, prompt
 * or response bodies, or anything else client-sensitive.
 */

export type AiLogEntry = {
  request_id: string;
  user_id?: string;
  project_id?: string;
  operation: string;
  provider?: string;
  model?: string;
  latency_ms?: number;
  estimated_cost_usd?: number;
  status: "ok" | "failed" | "denied";
  failure_code?: string;
};

const FORBIDDEN = /(api[_-]?key|authorization|cookie|session|secret|token|inlineData|base64|image_?bytes)/i;

function scrub(entry: AiLogEntry): AiLogEntry {
  const out = { ...entry };
  for (const [k, v] of Object.entries(out)) {
    if (FORBIDDEN.test(k) || (typeof v === "string" && v.length > 300)) {
      delete (out as Record<string, unknown>)[k];
    }
  }
  return out;
}

export function newRequestId(): string {
  return `req_${randomUUID()}`;
}

export function logAi(entry: AiLogEntry): void {
  // Structured JSON to stdout — a log shipper picks it up in production.
  try {
    console.log(JSON.stringify({ t: new Date().toISOString(), kind: "ai_op", ...scrub(entry) }));
  } catch {
    /* logging must never throw */
  }
}
