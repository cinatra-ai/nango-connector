// Injected persistence for the nango gateway (the serverEntry cutover,
// cinatra-ai/cinatra#151): every connector-config read/write/delete in this
// package goes through ONE injectable store, module-bound by `register(ctx)`
// from the host's `@cinatra-ai/host:connector-config` capability (which
// carries the PHYSICAL `delete` member the legacy-key purge requires).
//
// POST-CUTOVER SWEEP: the cross-repo skew window is closed — every host that
// loads this package activates `register(ctx)` through its generated REQUIRED
// loader (nango is a `systemExtension`) and resolves the surface through the
// host-side `nango-system` resolver, never the index directly. The legacy
// `@/lib/database` fallback is gone; a pre-binding call FAILS LOUD with a
// descriptive error (the design's R-B posture — module-eval-time nango access
// is banned; resolve at call time).

export type NangoConfigStore = {
  read<T>(connectorId: string, fallback: T): T;
  write(connectorId: string, value: unknown): void;
  delete(connectorId: string): void;
};

let boundStore: NangoConfigStore | null = null;

/** Bound by `register(ctx)` (lazy per-call host-service adapter). */
export function setNangoConfigStore(store: NangoConfigStore): void {
  boundStore = store;
}

export function getNangoConfigStore(): NangoConfigStore {
  if (!boundStore) {
    throw new Error(
      "@cinatra-ai/nango-connector: the config store is not bound — register(ctx) " +
        "has not run. nango activates through the generated REQUIRED loader at " +
        "boot; a miss here means this code ran BEFORE activation (resolve at " +
        "call time, never at module eval) or the activation itself failed.",
    );
  }
  return boundStore;
}

export function _resetNangoConfigStoreForTests(): void {
  boundStore = null;
}
