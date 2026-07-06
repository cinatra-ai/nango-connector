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
  /**
   * Host-resolved env-override precedence values for THIS package's manifest
   * `cinatra.envOverrides` (cinatra-ai/cinatra#982, Option A): a map from the
   * settings/secrets KEY the connector stores a value under (`secretKey`,
   * `serverUrl`, `connectUrl`) to the CURRENT, trimmed `process.env` value —
   * present only for env vars that are set to a non-blank value. The env-var
   * NAMES live in the manifest, never in this package's source; the HOST reads
   * `process.env` and applies the mapping (`register-host-connector-services`).
   *
   * ACTOR-FREE: resolves from the process environment + the static manifest, so
   * the inbound-webhook signature-verify read (no org/actor in context) still
   * gets env-first precedence WITHOUT routing through the org-scoped
   * settings/secrets ports (which fail closed with no actor).
   *
   * Optional so an OLDER host build (whose `connector-config` capability
   * predates this member) degrades to DB-only resolution rather than throwing;
   * the bound store's caller treats a missing member as "no overrides".
   */
  resolveEnvOverrides?(): Record<string, string>;
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
