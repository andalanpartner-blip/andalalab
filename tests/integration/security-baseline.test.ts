import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * P2.19 — the security baseline that must hold BEFORE P2.20 adds full auth.
 *
 *   - no provider key / secret in any client-shipped file
 *   - API routes validate their input and never 500 on malformed JSON
 *   - server boundaries intact: secrets read only in adapters / services / routes
 *   - the cost logger never logs prompts, responses, credentials or image bytes
 *   - no generated image bytes are logged anywhere
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") return [];
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(full) ? [full] : [];
  });
}

// Files that ship to the browser bundle: client components, client libs, app pages.
const CLIENT_DIRS = ["components", "lib"].map((d) => join(ROOT, d));
const APP_TSX = walk(join(ROOT, "app")).filter((f) => f.endsWith(".tsx"));
const CLIENT_FILES = [...CLIENT_DIRS.flatMap(walk), ...APP_TSX];

// Server-only files may legitimately read the key.
const SERVER_PREFIXES = ["adapters/", "services/", "app/api/", "ports/", "scripts/"];
const isServerFile = (path: string) =>
  SERVER_PREFIXES.some((p) => path.replace(/\\/g, "/").includes(`/${p}`) || path.replace(/\\/g, "/").includes(p));

describe("security baseline — no secret reaches the client", () => {
  it("no client-shipped file reads GEMINI_API_KEY / SESSION_SECRET or sends x-goog-api-key", () => {
    const offenders: string[] = [];
    for (const file of CLIENT_FILES) {
      const src = readFileSync(file, "utf8");
      if (/GEMINI_API_KEY|x-goog-api-key|SESSION_SECRET|process\.env\.[A-Z_]*KEY|process\.env\[["'][A-Z_]*KEY/.test(src)) {
        offenders.push(file.replace(ROOT, ""));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no client-shipped file constructs a provider endpoint URL", () => {
    const offenders: string[] = [];
    for (const file of CLIENT_FILES) {
      const src = readFileSync(file, "utf8");
      if (/generativelanguage\.googleapis\.com|:generateContent/.test(src)) offenders.push(file.replace(ROOT, ""));
    }
    expect(offenders).toEqual([]);
  });

  it("the provider key is read ONLY in server files", () => {
    const all = walk(ROOT);
    const readers = all.filter((f) => /process\.env\["GEMINI_API_KEY"\]|process\.env\.GEMINI_API_KEY/.test(readFileSync(f, "utf8")));
    expect(readers.length).toBeGreaterThan(0);
    for (const r of readers) {
      const rel = r.replace(ROOT, "").replace(/\\/g, "/");
      expect(isServerFile(rel) || rel.startsWith("tests/")).toBe(true);
    }
  });
});

describe("security baseline — API routes validate input", () => {
  it("every API route pins the Node.js runtime (keeps provider calls server-side)", () => {
    const routes = walk(join(ROOT, "app", "api"));
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(readFileSync(route, "utf8")).toMatch(/export const runtime = "nodejs"/);
    }
  });

  it("/api/generate rejects malformed JSON with a sanitized 400, not a 500 stack", async () => {
    const { POST } = await import("../../app/api/generate/route");
    const res = await POST(new Request("http://localhost/api/generate", { method: "POST", body: "{not json" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; message: string };
    expect(body.status).toBe("ERROR");
    expect(body.message).not.toMatch(/SyntaxError|at Object|node:internal/);
  });

  it("/api/generate rejects a request with no recipe / contract", async () => {
    const { POST } = await import("../../app/api/generate/route");
    const res = await POST(
      new Request("http://localhost/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "generate" })
      })
    );
    expect(res.status).toBe(400);
  });

  it("/api/decision rejects an unknown action and a missing subject", async () => {
    const { POST } = await import("../../app/api/decision/route");
    const bad = await POST(
      new Request("http://localhost/api/decision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "publish" })
      })
    );
    expect(bad.status).toBe(400);

    const missing = await POST(
      new Request("http://localhost/api/decision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approved" })
      })
    );
    expect(missing.status).toBe(400);
  });

  it("/api/vision-loop rejects an unknown action", async () => {
    const { POST } = await import("../../app/api/vision-loop/route");
    const res = await POST(
      new Request("http://localhost/api/vision-loop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete-everything" })
      })
    );
    expect(res.status).toBe(400);
  });
});

describe("security baseline — logging never leaks", () => {
  it("the cost ledger logger only emits accounting fields (no prompt / response / image / key)", () => {
    const src = readFileSync(join(ROOT, "services", "cost.service.ts"), "utf8");
    // the single logger.() call
    const call = src.slice(src.indexOf("options.logger?."), src.indexOf("options.logger?.") + 600).toLowerCase();
    // "prompt" only ever appears as the harmless "prompt_template_version"
    expect(call.replace(/prompt_template_version/g, "")).not.toContain("prompt");
    for (const forbidden of ["response", "image", "bytes", "api_key", "apikey", "credential", "secret", "authorization"]) {
      expect(call).not.toContain(forbidden);
    }
  });

  it("no server file logs raw image bytes / base64 image data", () => {
    const servers = walk(ROOT).filter((f) => {
      const rel = f.replace(ROOT, "").replace(/\\/g, "/");
      return (isServerFile(rel) && !rel.startsWith("tests/")) || rel.startsWith("engine/");
    });
    const offenders = servers.filter((f) => {
      const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
      return /console\.(log|info|warn|error)\([^)]*(imageBytes|imageBase64|inlineData|base64|dataUrl)/.test(src);
    });
    expect(offenders.map((f) => f.replace(ROOT, ""))).toEqual([]);
  });
});
