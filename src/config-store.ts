// Injected persistence for the nango gateway (the serverEntry cutover,
// cinatra-ai/cinatra#151): every connector-config read/write/delete in this
// package goes through ONE injectable store, module-bound by `register(ctx)`
// from the host's `@cinatra-ai/host:connector-config` capability (which
// carries the PHYSICAL `delete` member the legacy-key purge requires).
//
// SKEW COMPATIBILITY (removed by the post-cutover companion sweep): on a host
// that has NOT activated this package's `register(ctx)` (committed-maps path —
// the host calls index functions directly through its `@/lib/nango` facade),
// the store falls back to the legacy `@/lib/database` host import so every
// index function keeps working exactly as before the cutover. Once the host
// re-points its consumers through the capability surface and the generated
// required loader activates `register(ctx)` on every boot path, the fallback
// (and this file's `@/lib/database` import) is deleted.

import {
  deleteConnectorConfig,
  readConnectorConfigFromDatabase,
  writeConnectorConfigToDatabase,
} from "@/lib/database";

export type NangoConfigStore = {
  read<T>(connectorId: string, fallback: T): T;
  write(connectorId: string, value: unknown): void;
  delete(connectorId: string): void;
};

const legacyHostDatabaseStore: NangoConfigStore = {
  read: (connectorId, fallback) => readConnectorConfigFromDatabase(connectorId, fallback),
  write: (connectorId, value) => writeConnectorConfigToDatabase(connectorId, value),
  delete: (connectorId) => deleteConnectorConfig(connectorId),
};

let boundStore: NangoConfigStore | null = null;

/** Bound by `register(ctx)` (lazy per-call host-service adapter). */
export function setNangoConfigStore(store: NangoConfigStore): void {
  boundStore = store;
}

export function getNangoConfigStore(): NangoConfigStore {
  return boundStore ?? legacyHostDatabaseStore;
}

export function _resetNangoConfigStoreForTests(): void {
  boundStore = null;
}
