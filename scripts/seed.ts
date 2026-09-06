import { createJsonFileStorage } from "../adapters/storage/json-file";
import { ensureWorkspace, createUser } from "../services/team.service";
import type { Role } from "../lib/server/auth/rbac";

/**
 * Seed the private Andala workspace + team users (P2.20-D).
 *
 * There is NO public signup — this script (run by an operator) is the only way
 * users are created. Credentials come from env vars so nothing sensitive is
 * committed:
 *
 *   ANDALA_DATA_DIR=... \
 *   ANDALA_SEED='[{"email":"a@x.co","name":"A","password":"...","role":"admin"}, ...]' \
 *   pnpm tsx scripts/seed.ts
 *
 * or the single-admin shortcut:
 *
 *   ANDALA_ADMIN_EMAIL=... ANDALA_ADMIN_NAME=... ANDALA_ADMIN_PASSWORD=... pnpm tsx scripts/seed.ts
 */

type SeedUser = { email: string; name: string; password: string; role: Role };

function readSeed(): SeedUser[] {
  const json = process.env["ANDALA_SEED"];
  if (json) {
    const parsed = JSON.parse(json) as SeedUser[];
    if (!Array.isArray(parsed)) throw new Error("ANDALA_SEED must be a JSON array");
    return parsed;
  }
  const email = process.env["ANDALA_ADMIN_EMAIL"];
  const name = process.env["ANDALA_ADMIN_NAME"] ?? "Admin";
  const password = process.env["ANDALA_ADMIN_PASSWORD"];
  if (!email || !password) {
    throw new Error("Set ANDALA_SEED (JSON array) or ANDALA_ADMIN_EMAIL + ANDALA_ADMIN_PASSWORD.");
  }
  return [{ email, name, password, role: "admin" }];
}

async function main() {
  const dir = process.env["ANDALA_DATA_DIR"];
  if (!dir) throw new Error("ANDALA_DATA_DIR must be set.");
  const store = createJsonFileStorage(dir);
  await ensureWorkspace(store);

  for (const user of readSeed()) {
    try {
      const { user: created } = await createUser(store, user);
      console.log(`+ ${created.email} (${user.role})`);
    } catch (error) {
      console.log(`· skipped ${user.email}: ${(error as Error).message}`);
    }
  }
  console.log("seed complete");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
