import { randomUUID } from "node:crypto";
import type { StoragePort } from "../ports/storage.port";
import { COLLECTIONS } from "../ports/storage.port";
import type { Role } from "../lib/server/auth/rbac";
import { isRole } from "../lib/server/auth/rbac";
import { hashPassword, verifyPassword } from "../lib/server/auth/password";

/**
 * Team model (P2.20-D): Workspace · User · Membership · Role.
 *
 * There is ONE private Andala workspace. No public registration — users are
 * created only by an admin (or the seed script). A user belongs to the
 * workspace through a Membership that carries their Role.
 */

export const ANDALA_WORKSPACE_ID = "ws_andala";

export type Workspace = { id: string; name: string; created_at: string };
export type User = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: string;
};
export type Membership = {
  id: string;
  workspace_id: string;
  user_id: string;
  role: Role;
  created_at: string;
};

export type Actor = {
  readonly userId: string;
  readonly workspaceId: string;
  readonly role: Role;
  readonly name: string;
  readonly email: string;
};

const now = () => new Date().toISOString();

export async function ensureWorkspace(store: StoragePort, name = "Andala Creative"): Promise<Workspace> {
  const existing = await store.get<Workspace>(COLLECTIONS.workspaces, ANDALA_WORKSPACE_ID);
  if (existing) return existing;
  return store.create<Workspace>(COLLECTIONS.workspaces, {
    id: ANDALA_WORKSPACE_ID,
    name,
    created_at: now()
  });
}

export async function createUser(
  store: StoragePort,
  input: { email: string; name: string; password: string; role: Role }
): Promise<{ user: User; membership: Membership }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("invalid email");
  if (!isRole(input.role)) throw new Error("invalid role");
  const existing = await store.query<User>(COLLECTIONS.users, { email });
  if (existing.length > 0) throw new Error(`a user with email ${email} already exists`);

  await ensureWorkspace(store);
  const user = await store.create<User>(COLLECTIONS.users, {
    id: `usr_${randomUUID()}`,
    email,
    name: input.name.trim(),
    password_hash: hashPassword(input.password),
    created_at: now()
  });
  const membership = await store.create<Membership>(COLLECTIONS.memberships, {
    id: `mem_${randomUUID()}`,
    workspace_id: ANDALA_WORKSPACE_ID,
    user_id: user.id,
    role: input.role,
    created_at: now()
  });
  return { user, membership };
}

export async function authenticate(
  store: StoragePort,
  email: string,
  password: string
): Promise<Actor | null> {
  const users = await store.query<User>(COLLECTIONS.users, { email: email.trim().toLowerCase() });
  const user = users[0];
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  const memberships = await store.query<Membership>(COLLECTIONS.memberships, {
    workspace_id: ANDALA_WORKSPACE_ID,
    user_id: user.id
  });
  const membership = memberships[0];
  if (!membership) return null;
  return {
    userId: user.id,
    workspaceId: ANDALA_WORKSPACE_ID,
    role: membership.role,
    name: user.name,
    email: user.email
  };
}

export async function actorFromSession(
  store: StoragePort,
  uid: string
): Promise<Actor | null> {
  const user = await store.get<User>(COLLECTIONS.users, uid);
  if (!user) return null;
  const memberships = await store.query<Membership>(COLLECTIONS.memberships, {
    workspace_id: ANDALA_WORKSPACE_ID,
    user_id: uid
  });
  const membership = memberships[0];
  if (!membership) return null;
  return {
    userId: user.id,
    workspaceId: ANDALA_WORKSPACE_ID,
    role: membership.role,
    name: user.name,
    email: user.email
  };
}

export async function listTeam(store: StoragePort): Promise<{ user: User; role: Role }[]> {
  const memberships = await store.query<Membership>(COLLECTIONS.memberships, {
    workspace_id: ANDALA_WORKSPACE_ID
  });
  const out: { user: User; role: Role }[] = [];
  for (const m of memberships) {
    const user = await store.get<User>(COLLECTIONS.users, m.user_id);
    if (user) out.push({ user, role: m.role });
  }
  return out;
}
