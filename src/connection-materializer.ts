// BLOCKING connection-save materialization (the serverEntry cutover,
// cinatra-ai/cinatra#151): when a wordpress/linkedin Nango connection is
// saved, the host must materialize its domain row (a WordPress instance / a
// LinkedIn account) INLINE — a materialization failure FAILS the save (the
// semantics `saveNangoConnectorConnection` has always had; distinct from the
// best-effort `nango-connection-saved` hooks the save ROUTE runs afterwards).
//
// `register(ctx)` binds a dispatch that resolves the host's BLOCKING
// `nango-connection-materializer` capability at save time and FAILS LOUD when
// no provider handled a key that requires materialization (never a silent
// skip).
//
// POST-CUTOVER SWEEP: the cross-repo skew window is closed — the dispatch is
// bound by `register(ctx)` on every host that loads this package (generated
// REQUIRED loader). A pre-binding materialization FAILS LOUD (never a silent
// skip, never a host import).

export type NangoConnectionMaterializeInput = {
  connectorKey: string;
  providerConfigKey: string;
  connectionId: string;
  /** WordPress-style site URL carried by the save request (when present). */
  siteUrl?: string;
  scope?: "app" | "user";
  userId?: string;
};

type MaterializerDispatch = (input: NangoConnectionMaterializeInput) => Promise<void>;

let boundDispatch: MaterializerDispatch | null = null;

/** Bound by `register(ctx)` (capability-resolving dispatch). */
export function setNangoConnectionMaterializerDispatch(dispatch: MaterializerDispatch): void {
  boundDispatch = dispatch;
}

export function _resetNangoConnectionMaterializerForTests(): void {
  boundDispatch = null;
}

export async function materializeNangoConnection(
  input: NangoConnectionMaterializeInput,
): Promise<void> {
  if (boundDispatch) {
    await boundDispatch(input);
    return;
  }

  throw new Error(
    "@cinatra-ai/nango-connector: the connection-materializer dispatch is not " +
      "bound — register(ctx) has not run. nango activates through the generated " +
      "REQUIRED loader at boot; a miss here means activation failed (the save " +
      "must not silently skip materialization).",
  );
}
