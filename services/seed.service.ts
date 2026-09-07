import type { StoragePort } from "../ports/storage.port";
import { COLLECTIONS } from "../ports/storage.port";
import { ensureWorkspace, createUser, type User } from "./team.service";
import type { Role } from "../lib/server/auth/rbac";

/**
 * Local / operator seeding (P2.20-D).
 *
 * There is NO public signup. `scripts/seed.ts` (run explicitly, credentials from
 * env) is the only way the first users are created. This module holds the pure,
 * idempotent core so it can be unit tested without a filesystem.
 *
 * Passwords pass straight through to `createUser` (which scrypt-hashes them) and
 * are never returned, logged, or stored in plaintext.
 */

export type SeedUserInput = {
  readonly email: string;
  readonly name: string;
  readonly password: string;
  readonly role: Role;
};

export type SeedReport = {
  readonly workspace: string;
  /** Users created by this run (email + role only — never the password). */
  readonly created: ReadonlyArray<{ email: string; role: Role }>;
  /** Users that already existed and were left untouched. */
  readonly existed: readonly string[];
};

/**
 * Ensure the Andala workspace and the given users exist. Idempotent: a user
 * whose email already exists is skipped, so running the seed twice is safe and
 * never duplicates anyone.
 */
export async function seedTeam(store: StoragePort, users: readonly SeedUserInput[]): Promise<SeedReport> {
  const workspace = await ensureWorkspace(store);
  const created: Array<{ email: string; role: Role }> = [];
  const existed: string[] = [];

  for (const input of users) {
    const email = input.email.trim().toLowerCase();
    const found = await store.query<User>(COLLECTIONS.users, { email });
    if (found.length > 0) {
      existed.push(email);
      continue;
    }
    // createUser makes the user AND the workspace membership atomically.
    await createUser(store, { email, name: input.name, password: input.password, role: input.role });
    created.push({ email, role: input.role });
  }

  return { workspace: workspace.name, created, existed };
}
