import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { StoragePort, StorageRecord } from "../../ports/storage.port";

/**
 * Single-file JSON storage adapter (P2.20-A).
 *
 * One `store.json` under `ANDALA_DATA_DIR`, written atomically (temp file +
 * rename). Suitable for one server instance serving a small internal team;
 * point the adapter at Postgres when that stops being true. Load once, keep in
 * memory, persist on every write.
 *
 * It stores JSON records only — never image bytes. Back it up by copying the
 * file (see docs/backup-recovery.md).
 */

type Db = Record<string, Record<string, StorageRecord>>;

export function createJsonFileStorage(dir: string): StoragePort {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "store.json");
  const tmp = join(dir, `store.json.tmp`);

  let db: Db = {};
  if (existsSync(file)) {
    try {
      db = JSON.parse(readFileSync(file, "utf8")) as Db;
    } catch {
      throw new Error(`ANDALA store at ${file} is corrupt — restore from a backup (docs/backup-recovery.md).`);
    }
  }

  const persist = (): void => {
    writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
    renameSync(tmp, file);
  };
  const col = (name: string): Record<string, StorageRecord> => {
    if (!db[name]) db[name] = {};
    return db[name]!;
  };
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

  return {
    async get(collection, id) {
      const r = col(collection)[id];
      return r ? (clone(r) as never) : null;
    },
    async create(collection, record) {
      const c = col(collection);
      if (c[record.id]) throw new Error(`${collection}/${record.id} already exists`);
      c[record.id] = clone(record);
      persist();
      return clone(record);
    },
    async put(collection, record) {
      col(collection)[record.id] = clone(record);
      persist();
      return clone(record);
    },
    async patch(collection, id, patch) {
      const c = col(collection);
      if (!c[id]) return null;
      const next = { ...c[id], ...patch, id, updated_at: new Date().toISOString() } as StorageRecord;
      c[id] = next;
      persist();
      return clone(next) as never;
    },
    async delete(collection, id) {
      const c = col(collection);
      if (!c[id]) return false;
      delete c[id];
      persist();
      return true;
    },
    async list(collection) {
      return Object.values(col(collection)).map(clone) as never;
    },
    async query(collection, where) {
      return Object.values(col(collection))
        .filter((r) => Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v))
        .map(clone) as never;
    }
  };
}
