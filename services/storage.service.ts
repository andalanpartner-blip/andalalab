import type { StoragePort } from "../ports/storage.port";
import { createJsonFileStorage } from "../adapters/storage/json-file";
import { dataDir } from "../lib/server/env";

/**
 * Process-wide storage singleton (P2.20).
 *
 * A single JSON-file store under `ANDALA_DATA_DIR`. Swap for a Postgres adapter
 * behind the same `StoragePort` when the team outgrows one instance — nothing
 * upstream changes.
 */
let cached: StoragePort | null = null;

export function getStorage(): StoragePort {
  if (!cached) cached = createJsonFileStorage(dataDir());
  return cached;
}

/** For tests: inject a fake store. */
export function setStorageForTests(store: StoragePort | null): void {
  cached = store;
}
