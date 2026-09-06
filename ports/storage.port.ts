/**
 * The persistence boundary (P2.20-A).
 *
 * A tiny document store: named collections of JSON records keyed by id. It is
 * deliberately minimal — the smallest thing that lets a small internal team
 * keep users, projects and immutable artifact METADATA. It is NOT a database
 * abstraction to build a product on; swap the adapter for Postgres when the
 * team outgrows a single instance.
 *
 * Rules the callers rely on:
 *   - records are plain JSON, no image bytes (artifacts store hashes + refs);
 *   - `create` fails if the id already exists (no accidental overwrite);
 *   - `patch` shallow-merges and bumps `updated_at`;
 *   - list/query are unindexed scans — fine for an internal team's data volume.
 */

export type StorageRecord = { readonly id: string } & Record<string, unknown>;

export type StoragePort = {
  get<T extends StorageRecord>(collection: string, id: string): Promise<T | null>;
  create<T extends StorageRecord>(collection: string, record: T): Promise<T>;
  put<T extends StorageRecord>(collection: string, record: T): Promise<T>;
  patch<T extends StorageRecord>(collection: string, id: string, patch: Partial<T>): Promise<T | null>;
  delete(collection: string, id: string): Promise<boolean>;
  list<T extends StorageRecord>(collection: string): Promise<T[]>;
  /** Shallow-equality filter over a collection. */
  query<T extends StorageRecord>(collection: string, where: Partial<T>): Promise<T[]>;
};

export const COLLECTIONS = {
  users: "users",
  workspaces: "workspaces",
  memberships: "memberships",
  projects: "projects",
  brands: "brands",
  jobs: "jobs",
  artifacts: "artifacts",
  decisions: "decisions",
  cycles: "cycles",
  costEvents: "cost_events"
} as const;
