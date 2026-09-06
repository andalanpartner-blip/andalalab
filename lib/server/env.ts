/**
 * Environment separation + fail-closed configuration (P2.20-N).
 *
 * `APP_ENV` is development | staging | production. Production refuses to run
 * with the fake / replay providers and refuses to start without the secrets a
 * real deployment needs — a missing critical value fails CLOSED rather than
 * silently degrading.
 *
 * Nothing here is a secret; it only reads and validates. Secret VALUES never
 * leave the server and are never logged.
 */

export type AppEnv = "development" | "staging" | "production";

export function appEnvOf(env: Record<string, string | undefined>): AppEnv {
  const raw = (env["APP_ENV"] ?? "development").trim().toLowerCase();
  if (raw === "production" || raw === "staging") return raw;
  return "development";
}

export function appEnv(): AppEnv {
  return appEnvOf(process.env);
}

export const isProduction = (): boolean => appEnv() === "production";

/** A configuration problem serious enough that the process must not serve traffic. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const truthy = (v: string | undefined): boolean => v === "fake" || v === "replay";

/**
 * Validate the environment for the current `APP_ENV`. Throws `ConfigError` in
 * production/staging when a critical value is missing or a test provider is
 * enabled. In development it only warns (returns the list of issues).
 */
export function checkEnv(env: Record<string, string | undefined> = process.env): {
  ok: boolean;
  env: AppEnv;
  issues: string[];
} {
  const mode = appEnvOf(env);
  const issues: string[] = [];

  const required = ["SESSION_SECRET", "GEMINI_API_KEY", "ANDALA_DATA_DIR"];
  for (const key of required) {
    const value = env[key];
    if (!value || value.trim().length === 0) issues.push(`${key} is not set`);
  }

  if (env["SESSION_SECRET"] && env["SESSION_SECRET"].trim().length < 32) {
    issues.push("SESSION_SECRET must be at least 32 characters");
  }

  if (mode !== "development") {
    if (truthy(env["GENERATION_PROVIDER"]?.trim())) {
      issues.push(`GENERATION_PROVIDER="${env["GENERATION_PROVIDER"]}" is not allowed in ${mode}`);
    }
    if (truthy(env["EVIDENCE_PROVIDER"]?.trim())) {
      issues.push(`EVIDENCE_PROVIDER="${env["EVIDENCE_PROVIDER"]}" is not allowed in ${mode}`);
    }
  }

  const ok = issues.length === 0;
  if (!ok && mode !== "development") {
    throw new ConfigError(
      `Refusing to start in ${mode}: ${issues.join("; ")}. See docs/production-config.md.`
    );
  }
  return { ok, env: mode, issues };
}

/** Whether the fake generation provider may be used right now. */
export function fakeGenerationAllowed(): boolean {
  return !isProduction() && appEnv() !== "staging";
}
export function replayEvidenceAllowed(): boolean {
  return !isProduction() && appEnv() !== "staging";
}

/** The runtime data directory for the JSON store. */
export function dataDir(): string {
  const dir = process.env["ANDALA_DATA_DIR"]?.trim();
  if (dir && dir.length > 0) return dir;
  if (isProduction() || appEnv() === "staging") {
    throw new ConfigError("ANDALA_DATA_DIR must be set outside development. See docs/production-config.md.");
  }
  return ".andala-data";
}

/** The signing secret for session cookies. */
export function sessionSecret(): string {
  const secret = process.env["SESSION_SECRET"]?.trim();
  if (secret && secret.length >= 32) return secret;
  if (isProduction() || appEnv() === "staging") {
    throw new ConfigError("SESSION_SECRET (>=32 chars) must be set outside development.");
  }
  // A fixed, obviously-non-secret value for local development only.
  return "dev-only-insecure-session-secret-do-not-ship";
}
