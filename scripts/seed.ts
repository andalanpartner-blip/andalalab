import { createJsonFileStorage } from "../adapters/storage/json-file";
import { seedTeam, type SeedUserInput } from "../services/seed.service";
import { dataDir } from "../lib/server/env";
import { isRole, type Role } from "../lib/server/auth/rbac";

/**
 * Seed the private Andala workspace + team users (P2.20-D).
 *
 *   pnpm seed
 *
 * There is NO public signup — this script (run explicitly by a developer or
 * operator) is the only way users are created. Credentials come from env vars
 * so nothing sensitive is committed:
 *
 *   Local development (the common case):
 *     ADMIN_EMAIL=you@local.test ADMIN_PASSWORD='at least 10 chars' pnpm seed
 *
 *   Operator, full team:
 *     ANDALA_DATA_DIR=/data \
 *     ANDALA_SEED='[{"email":"…","name":"…","password":"…","role":"admin"}, …]' \
 *     pnpm seed
 *
 * The data directory falls back to the development default (`.andala-data`) when
 * `ANDALA_DATA_DIR` is unset; outside development it is required (fail-closed).
 * The password is read but never printed.
 */

function coerceRole(value: unknown): Role {
  if (isRole(value)) return value;
  throw new Error(`invalid role ${JSON.stringify(value)} — expected admin | designer | account`);
}

function readSeed(): SeedUserInput[] {
  const json = process.env["ANDALA_SEED"];
  if (json) {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) throw new Error("ANDALA_SEED must be a JSON array");
    return parsed.map((raw) => {
      const u = raw as Record<string, unknown>;
      if (typeof u["email"] !== "string" || typeof u["password"] !== "string") {
        throw new Error("each ANDALA_SEED entry needs an email and a password");
      }
      return {
        email: u["email"],
        name: typeof u["name"] === "string" && u["name"].trim() ? u["name"] : "Admin",
        password: u["password"],
        role: coerceRole(u["role"] ?? "admin")
      };
    });
  }

  const email = process.env["ADMIN_EMAIL"] ?? process.env["ANDALA_ADMIN_EMAIL"];
  const name = process.env["ADMIN_NAME"] ?? process.env["ANDALA_ADMIN_NAME"] ?? "Admin";
  const password = process.env["ADMIN_PASSWORD"] ?? process.env["ANDALA_ADMIN_PASSWORD"];
  if (!email || !password) {
    throw new Error(
      "Set ADMIN_EMAIL and ADMIN_PASSWORD (or ANDALA_SEED as a JSON array). See docs/local-development.md."
    );
  }
  return [{ email, name, password, role: "admin" }];
}

async function main(): Promise<void> {
  const users = readSeed();
  const store = createJsonFileStorage(dataDir());
  const report = await seedTeam(store, users);

  console.log("Seed complete.");
  for (const { email, role } of report.created) {
    console.log(`${role[0]!.toUpperCase()}${role.slice(1)}: ${email}`);
  }
  for (const email of report.existed) {
    console.log(`Already present: ${email}`);
  }
  console.log(`Workspace: ${report.workspace}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
