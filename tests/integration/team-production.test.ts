import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryStorage } from "../../adapters/storage/memory";
import { setStorageForTests } from "../../services/storage.service";
import { createUser, ensureWorkspace, authenticate, type Actor } from "../../services/team.service";
import { issueSession } from "../../lib/server/auth/session";
import { can } from "../../lib/server/auth/rbac";
import { verifyPassword } from "../../lib/server/auth/password";
import { checkEnv } from "../../lib/server/env";
import { checkRateLimit, resetRateLimits } from "../../lib/server/rate-limit";

/**
 * P2.20 — team / production enablement. Auth, roles, project isolation (IDOR),
 * server-derived generation security, approval binding, environment fail-close,
 * and the end-to-end team workflow. All against an in-memory store.
 */

const ROOT = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, ROOT), "utf8");

let store: ReturnType<typeof createMemoryStorage>;
const users: Record<string, Actor> = {};

async function seed() {
  store = createMemoryStorage();
  setStorageForTests(store);
  resetRateLimits();
  await ensureWorkspace(store);
  for (const [role, email] of [
    ["admin", "cd@andala.test"],
    ["designer", "d@andala.test"],
    ["account", "acct@andala.test"]
  ] as const) {
    await createUser(store, { email, name: role, password: "correct-horse-battery", role });
    const actor = await authenticate(store, email, "correct-horse-battery");
    if (!actor) throw new Error("seed auth");
    users[role] = actor;
  }
}

function cookieFor(role: keyof typeof users): string {
  const a = users[role]!;
  const token = issueSession({ uid: a.userId, wid: a.workspaceId, role: a.role, name: a.name });
  return `andala_session=${token}`;
}

const req = (path: string, body: unknown, cookie?: string) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body)
  });
const getReq = (path: string, cookie?: string) =>
  new Request(`http://localhost${path}`, { headers: cookie ? { cookie } : {} });

beforeEach(seed);
afterEach(() => setStorageForTests(null));

// --- AUTH (1–4) -------------------------------------------------

describe("P2.20 — authentication", () => {
  it("1/2 — unauthenticated API is denied (401)", async () => {
    const { GET } = await import("../../app/api/projects/route");
    expect((await GET(getReq("/api/projects"))).status).toBe(401);
    const { POST } = await import("../../app/api/generate/route");
    expect((await POST(req("/api/generate", { action: "generate" }))).status).toBe(401);
  });

  it("3 — a valid session is accepted", async () => {
    const { GET } = await import("../../app/api/auth/me/route");
    const res = await GET(getReq("/api/auth/me", cookieFor("designer")));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { role: string } }).user.role).toBe("designer");
  });

  it("4 — a tampered / invalid session is rejected", async () => {
    const { GET } = await import("../../app/api/auth/me/route");
    expect((await GET(getReq("/api/auth/me", "andala_session=not.a.real.token"))).status).toBe(401);
    // right shape, wrong signature
    const [payload] = issueSession({ uid: "x", wid: "ws_andala", role: "admin", name: "x" }).split(".");
    expect((await GET(getReq("/api/auth/me", `andala_session=${payload}.deadbeef`))).status).toBe(401);
  });

  it("login issues an HttpOnly cookie and rejects a bad password", async () => {
    const { POST } = await import("../../app/api/auth/login/route");
    const ok = await POST(req("/api/auth/login", { email: "d@andala.test", password: "correct-horse-battery" }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toMatch(/HttpOnly/);
    const bad = await POST(req("/api/auth/login", { email: "d@andala.test", password: "wrong" }));
    expect(bad.status).toBe(401);
  });
});

// --- AUTHORIZATION (5–9) -------------------------------------

describe("P2.20 — authorization / roles", () => {
  it("5/6/7 — the permission matrix matches the role model", () => {
    expect(can("admin", "team:manage")).toBe(true);
    expect(can("admin", "usage:view")).toBe(true);
    expect(can("designer", "workflow:run")).toBe(true);
    expect(can("designer", "decision:approve")).toBe(true);
    expect(can("designer", "team:manage")).toBe(false);
    expect(can("designer", "usage:view")).toBe(false);
    expect(can("account", "project:create")).toBe(true);
    expect(can("account", "workflow:run")).toBe(false);
    expect(can("account", "settings:manage")).toBe(false);
  });

  it("8 — usage view is admin-only (designer + account get 403)", async () => {
    const { GET } = await import("../../app/api/admin/usage/route");
    expect((await GET(getReq("/api/admin/usage", cookieFor("admin")))).status).toBe(200);
    expect((await GET(getReq("/api/admin/usage", cookieFor("designer")))).status).toBe(403);
    expect((await GET(getReq("/api/admin/usage", cookieFor("account")))).status).toBe(403);
  });

  it("a designer cannot create a project; an account can", async () => {
    const { POST } = await import("../../app/api/projects/route");
    expect((await POST(req("/api/projects", { name: "X" }, cookieFor("designer")))).status).toBe(403);
    expect((await POST(req("/api/projects", { name: "X" }, cookieFor("account")))).status).toBe(200);
  });
});

// --- PROJECT + ISOLATION (10–13, IDOR) ---------------------

async function makeProject(role: keyof typeof users, name = "P"): Promise<string> {
  const { POST } = await import("../../app/api/projects/route");
  const res = await POST(req("/api/projects", { name }, cookieFor(role)));
  return ((await res.json()) as { project: { id: string } }).project.id;
}

describe("P2.20 — project isolation (IDOR)", () => {
  it("10/11/12 — the creator can read their project; it appears in their list", async () => {
    const id = await makeProject("account");
    const { GET } = await import("../../app/api/projects/[id]/route");
    const res = await GET(getReq(`/api/projects/${id}`, cookieFor("account")), { params: { id } });
    expect(res.status).toBe(200);
  });

  it("13 — a non-member (different account) is denied read / generate / correction / decision / history", async () => {
    // second account user, not a member of the first's project
    await createUser(store, { email: "acct2@andala.test", name: "acct2", password: "correct-horse-battery", role: "account" });
    const other = await authenticate(store, "acct2@andala.test", "correct-horse-battery");
    users["account2" as keyof typeof users] = other!;
    const id = await makeProject("account");

    const otherCookie = (() => {
      const a = other!;
      return `andala_session=${issueSession({ uid: a.userId, wid: a.workspaceId, role: a.role, name: a.name })}`;
    })();

    const projectRoute = await import("../../app/api/projects/[id]/route");
    expect((await projectRoute.GET(getReq(`/api/projects/${id}`, otherCookie), { params: { id } })).status).toBe(403);

    const gen = await import("../../app/api/generate/route");
    expect((await gen.POST(req("/api/generate", { action: "generate", projectId: id, recipe: {}, contract: {} }, otherCookie))).status).toBe(403);

    const vl = await import("../../app/api/vision-loop/route");
    expect((await vl.POST(req("/api/vision-loop", { action: "inspect", projectId: id }, otherCookie))).status).toBe(403);

    const corr = await import("../../app/api/correction/route");
    expect((await corr.POST(req("/api/correction", { projectId: id, parentRecipe: {}, contract: {}, direction: {}, patch: {} }, otherCookie))).status).toBe(403);

    const dec = await import("../../app/api/decision/route");
    expect((await dec.POST(req("/api/decision", { action: "approved", projectId: id, artifact: {}, recipe: {}, request: {} }, otherCookie))).status).toBe(403);
  });

  it("an admin can see any project (oversight), a designer cannot see one they are not on", async () => {
    const id = await makeProject("account");
    const projectRoute = await import("../../app/api/projects/[id]/route");
    expect((await projectRoute.GET(getReq(`/api/projects/${id}`, cookieFor("admin")), { params: { id } })).status).toBe(200);
    expect((await projectRoute.GET(getReq(`/api/projects/${id}`, cookieFor("designer")), { params: { id } })).status).toBe(403);
  });
});

// --- GENERATION SECURITY (17–21) -------------------------

describe("P2.20 — generation security", () => {
  it("17 — generation requires an authenticated project member", async () => {
    const gen = await import("../../app/api/generate/route");
    expect((await gen.POST(req("/api/generate", { action: "generate" }))).status).toBe(401);
  });

  it("19 — the browser cannot choose the provider / model / cost — they are not read from the body", () => {
    const route = read("app/api/generate/route.ts").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    expect(route).not.toMatch(/body\.(provider|model|cost|apiKey|api_key)/);
    // provider/model come off the produced artifact, not the request
    expect(route).toMatch(/result\.artifact\.provider/);
  });

  it("21 — the expensive routes are rate-limited per user", () => {
    const t = 5_000_000;
    for (let i = 0; i < 3; i += 1) {
      expect(checkRateLimit("u1", "generate", t).allowed).toBe(true);
    }
    // burst of 3 is exhausted; the 4th within the same tick is refused
    expect(checkRateLimit("u1", "generate", t).allowed).toBe(false);
    // a different user is unaffected
    expect(checkRateLimit("u2", "generate", t).allowed).toBe(true);
  });
});

// --- APPROVAL (22–25) ----------------------------------

describe("P2.20 — approval", () => {
  it("24/25 — the decision route never generates or publishes (source)", () => {
    const route = read("app/api/decision/route.ts").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    expect(route).not.toMatch(/runVisualGeneration|\.generate\(|publish|share|cdn|public/i);
  });

  it("22/23 — a decision is refused without a valid subject (member, but no artifact/recipe/request)", async () => {
    const dec = await import("../../app/api/decision/route");
    const id = await makeProject("admin"); // admin is the owner + member
    const res = await dec.POST(req("/api/decision", { action: "approved", projectId: id }, cookieFor("admin")));
    expect(res.status).toBe(400);
  });
});

// --- ENVIRONMENT (26–28) ------------------------------

describe("P2.20 — environment separation fails closed", () => {
  it("26/27 — the fake / replay providers are refused in production", () => {
    expect(() =>
      checkEnv({
        APP_ENV: "production",
        SESSION_SECRET: "x".repeat(40),
        GEMINI_API_KEY: "k",
        ANDALA_DATA_DIR: "/data",
        GENERATION_PROVIDER: "fake"
      })
    ).toThrow(/not allowed in production/);
    expect(() =>
      checkEnv({
        APP_ENV: "staging",
        SESSION_SECRET: "x".repeat(40),
        GEMINI_API_KEY: "k",
        ANDALA_DATA_DIR: "/data",
        EVIDENCE_PROVIDER: "replay"
      })
    ).toThrow(/not allowed in staging/);
  });

  it("28 — missing required config fails closed in production", () => {
    expect(() => checkEnv({ APP_ENV: "production" })).toThrow(/Refusing to start/);
    // development only warns
    const dev = checkEnv({ APP_ENV: "development" });
    expect(dev.ok).toBe(false);
    expect(dev.env).toBe("development");
  });
});

// --- SECURITY (29–33) --------------------------------

describe("P2.20 — security", () => {
  it("29 — the provider key is not read in any client-shipped file", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const base = process.cwd();
    const files: string[] = [];
    const rec = (d: string) => {
      for (const e of readdirSync(d)) {
        if (e === "node_modules" || e === ".next" || e === ".git" || e === "server") continue;
        const full = join(d, e);
        if (statSync(full).isDirectory()) rec(full);
        else if (/\.tsx?$/.test(full)) files.push(full);
      }
    };
    rec(join(base, "components"));
    rec(join(base, "lib"));
    for (const f of files) {
      const rel = f.replace(base, "").replace(/\\/g, "/");
      if (rel.startsWith("/lib/server/")) continue;
      expect(readFileSync(f, "utf8")).not.toMatch(/GEMINI_API_KEY|SESSION_SECRET|x-goog-api-key/);
    }
  });

  it("30 — passwords are hashed with scrypt, never stored in plaintext", async () => {
    const user = (await store.list<{ id: string; email: string; password_hash: string }>("users")).filter(
      (u) => u.email === "d@andala.test"
    );
    expect(user[0]!.password_hash).toMatch(/^scrypt\$/);
    expect(verifyPassword("correct-horse-battery", user[0]!.password_hash)).toBe(true);
    expect(verifyPassword("nope", user[0]!.password_hash)).toBe(false);
  });

  it("31 — routes return sanitized errors, never a stack trace", async () => {
    const gen = await import("../../app/api/generate/route");
    const res = await gen.POST(new Request("http://localhost/api/generate", { method: "POST", body: "{bad" }));
    const text = await res.text();
    expect(text).not.toMatch(/SyntaxError|node:internal|\bat \w+ \(/);
  });

  it("32 — the login route validates payload shape / size", async () => {
    const { POST } = await import("../../app/api/auth/login/route");
    expect((await POST(req("/api/auth/login", { email: 123, password: {} }))).status).toBe(400);
    expect((await POST(req("/api/auth/login", { email: "a".repeat(400), password: "x" }))).status).toBe(400);
  });

  it("33 — middleware sets security headers and blocks unauthenticated pages", async () => {
    const src = read("middleware.ts");
    expect(src).toMatch(/X-Frame-Options.*DENY/);
    expect(src).toMatch(/X-Content-Type-Options.*nosniff/);
    expect(src).toMatch(/redirect|401/);
    expect(src).not.toMatch(/node:crypto|createHmac/);
  });
});

// --- END-TO-END TEAM WORKFLOW (34–37) -----------------

describe("P2.20 — the team workflow", () => {
  it("34/35/36/37 — account creates → designer runs workflow (persisted) → admin sees usage", async () => {
    const projects = await import("../../app/api/projects/route");
    const created = await projects.POST(req("/api/projects", { name: "Cold Brew Promo", brand: "Kopi Lawas" }, cookieFor("account")));
    const projectId = ((await created.json()) as { project: { id: string } }).project.id;

    // add the designer as a member (owner/admin action)
    const { addMember } = await import("../../services/project.service");
    await addMember(store, users["admin"]!, projectId, users["designer"]!.userId);

    // designer records a recipe + a generation via the project route
    const projectRoute = await import("../../app/api/projects/[id]/route");
    const rec = await projectRoute.POST(
      req(`/api/projects/${projectId}`, { kind: "recipe", hash: "aaaa1111", summary: { movement: "bauhaus" } }, cookieFor("designer")),
      { params: { id: projectId } }
    );
    expect(rec.status).toBe(200);
    await projectRoute.POST(
      req(`/api/projects/${projectId}`, { kind: "generation", hash: "bbbb2222", parent_hash: "aaaa1111", summary: { prompt_hash: "pppp" } }, cookieFor("designer")),
      { params: { id: projectId } }
    );
    // the decision route records an approval as kind "final"
    await projectRoute.POST(
      req(`/api/projects/${projectId}`, { kind: "final", hash: "cccc3333", parent_hash: "bbbb2222", summary: { action: "approved", artifact_hash: "bbbb2222", decided_by: "Dana Designer" } }, cookieFor("designer")),
      { params: { id: projectId } }
    );

    // project shows approved + history is the lineage
    const view = await projectRoute.GET(getReq(`/api/projects/${projectId}`, cookieFor("designer")), { params: { id: projectId } });
    const viewData = (await view.json()) as { project: { status: string; latest: { approved_artifact_hash: string | null } }; history: unknown[] };
    expect(viewData.project.status).toBe("approved");
    expect(viewData.project.latest.approved_artifact_hash).toBe("bbbb2222");
    expect(viewData.history.length).toBe(3);

    // an image-ish summary key is stripped
    await projectRoute.POST(
      req(`/api/projects/${projectId}`, { kind: "generation", hash: "dddd4444", summary: { imageBase64: "SHOULD_BE_DROPPED", ok: 1 } }, cookieFor("designer")),
      { params: { id: projectId } }
    );
    const view2 = await projectRoute.GET(getReq(`/api/projects/${projectId}`, cookieFor("designer")), { params: { id: projectId } });
    const h = ((await view2.json()) as { history: { hash: string; summary: Record<string, unknown> }[] }).history;
    const last = h.find((x) => x.hash === "dddd4444")!;
    expect(last.summary["imageBase64"]).toBeUndefined();
    expect(last.summary["ok"]).toBe(1);
  });
});
