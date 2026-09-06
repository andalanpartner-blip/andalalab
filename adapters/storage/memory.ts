import type { StoragePort, StorageRecord } from "../../ports/storage.port";

/**
 * In-memory storage adapter — tests and ephemeral dev. No persistence.
 */
export function createMemoryStorage(seed?: Record<string, StorageRecord[]>): StoragePort {
  const db = new Map<string, Map<string, StorageRecord>>();
  for (const [collection, records] of Object.entries(seed ?? {})) {
    db.set(collection, new Map(records.map((r) => [r.id, structuredClone(r)])));
  }
  const col = (name: string): Map<string, StorageRecord> => {
    let m = db.get(name);
    if (!m) {
      m = new Map();
      db.set(name, m);
    }
    return m;
  };
  const clone = <T>(v: T): T => structuredClone(v);

  return {
    async get(collection, id) {
      const r = col(collection).get(id);
      return r ? (clone(r) as never) : null;
    },
    async create(collection, record) {
      const m = col(collection);
      if (m.has(record.id)) throw new Error(`${collection}/${record.id} already exists`);
      m.set(record.id, clone(record));
      return clone(record);
    },
    async put(collection, record) {
      col(collection).set(record.id, clone(record));
      return clone(record);
    },
    async patch(collection, id, patch) {
      const m = col(collection);
      const existing = m.get(id);
      if (!existing) return null;
      const next = { ...existing, ...patch, id, updated_at: new Date(0).toISOString() } as StorageRecord;
      m.set(id, next);
      return clone(next) as never;
    },
    async delete(collection, id) {
      return col(collection).delete(id);
    },
    async list(collection) {
      return [...col(collection).values()].map(clone) as never;
    },
    async query(collection, where) {
      return [...col(collection).values()]
        .filter((r) => Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v))
        .map(clone) as never;
    }
  };
}
