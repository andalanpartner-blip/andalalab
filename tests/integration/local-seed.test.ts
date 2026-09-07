import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStorage } from "../../adapters/storage/memory";
import { setStorageForTests } from "../../services/storage.service";
import { seedTeam } from "../../services/seed.service";
import { authenticate, listTeam } from "../../services/team.service";
import { resetRateLimits } from "../../lib/server/rate-limit";
import { verifyPassword } from "../../lib/server/auth/password";

/**
 * Local development seed + login access. Production stays untouched: no public
 * signup, credentials from the environment, scrypt hashing, and the development
 * conveniences are gated on `APP_ENV` / `NODE_ENV`.
 */

const ROOT = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, ROOT), "utf8");

let store: ReturnType<typeof createMemoryStorage>;

beforeEach(() => {
  store = createMemoryStorage();
  setStorageForTests(store);
  resetRateLimits();
});
afterEach(() => {
  setStorageForTests(null);
  vi.unstubAllEnvs();
});

const ADMIN = {
  email: "dev-admin@local.test",
  name: "Dev Admin",
  password: "local-dev-secret-1",
  role: "admin" as const
};

const loginReq = (email: string, password: string) =>
  new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });

describe("local development seed", () => {
  it("8 — creates the Andala workspace and one admin with membership", async () => {
    const report = await seedTeam(store, [ADMIN]);
    expect(report.workspace).toBe("Andala Creative");
    expect(report.created).toEqual([{ email: ADMIN.email, role: "admin" }]);

    const team = await listTeam(store);
    expect(team.map((t) => [t.user.email, t.role])).toEqual([[ADMIN.email, "admin"]]);
    expect(team[0]!.user.password_hash).toMatch(/^scrypt\$/);
    expect(verifyPassword(ADMIN.password, team[0]!.user.password_hash)).toBe(true);
  });

  it("9 — is idempotent: a second run adds nobody and does not duplicate", async () => {
    await seedTeam(store, [ADMIN]);
    const second = await seedTeam(store, [ADMIN]);
    expect(second.created).toEqual([]);
    expect(second.existed).toEqual([ADMIN.email]);
    expect(await listTeam(store)).toHaveLength(1);
  });

  it("10 — the password is never printed or returned", async () => {
    const report = await seedTeam(store, [ADMIN]);
    expect(JSON.stringify(report)).not.toContain(ADMIN.password);

    const script = read("scripts/seed.ts");
    for (const line of script.match(/console\.(log|error)\([^)]*\)/g) ?? []) {
      expect(line.toLowerCase()).not.toContain("password");
    }
  });

  it("11 — there is no public signup / registration route or invitation", () => {
    expect(readdirSync(new URL("app/api/auth/", ROOT)).sort()).toEqual(["login", "logout", "me"]);
    const appDirs = readdirSync(new URL("app/", ROOT));
    expect(appDirs).not.toContain("register");
    expect(appDirs).not.toContain("signup");
    // the login page offers no way to make an account
    const login = read("app/login/page.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(login).not.toMatch(/href=["'][^"']*(signup|register)/i);
    expect(login.toLowerCase()).not.toMatch(/sign ?up|create (an|your)? ?account/);
  });

  it("12 — development login succeeds after seeding and issues an HttpOnly cookie", async () => {
    await seedTeam(store, [ADMIN]);
    expect((await authenticate(store, ADMIN.email, ADMIN.password))?.role).toBe("admin");

    const { POST } = await import("../../app/api/auth/login/route");
    const res = await POST(loginReq(ADMIN.email, ADMIN.password));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/);
  });

  it("13 — logging in before seeding returns helpful development guidance", async () => {
    vi.stubEnv("APP_ENV", "development");
    const { POST } = await import("../../app/api/auth/login/route");
    const res = await POST(loginReq("nobody@local.test", "whatever-123"));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { message: string }).message).toMatch(/pnpm seed/);
  });

  it("14 — production has no development bypass or hint", async () => {
    vi.stubEnv("APP_ENV", "production");
    const { POST } = await import("../../app/api/auth/login/route");
    const res = await POST(loginReq("nobody@local.test", "whatever-123"));
    expect(res.status).toBe(401);
    const msg = ((await res.json()) as { message: string }).message;
    expect(msg).toBe("Email or password is incorrect.");
    expect(msg).not.toMatch(/seed/i);

    // gated in source
    expect(read("app/api/auth/login/route.ts")).toMatch(/appEnv\(\)\s*===\s*"development"/);
    expect(read("app/login/page.tsx")).toMatch(/process\.env\.NODE_ENV\s*!==\s*"production"/);
  });
});
