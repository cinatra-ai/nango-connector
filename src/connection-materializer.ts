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
// SKEW COMPATIBILITY (removed by the post-cutover companion sweep): on a host
// that has NOT activated `register(ctx)` (committed-maps path), the dispatch
// falls back to the legacy `@/lib/linkedin-api` / `@/lib/wordpress-api` host
// modules so the save path keeps working exactly as before the cutover. The
// fallbacks are DYNAMIC imports inside the unbound branch ONLY: those host
// modules import the host's `@/lib/nango` facade, which re-exports THIS
// package's index (the `@cinatra-ai/sdk-ui/nango` value re-export + "use
// server" actions) — a static import here would drag that whole graph into
// `register(ctx)` activation, violating the leaf-modules-only serverEntry
// constraint. The save path is async, so call-time resolution is free.

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

  // Legacy skew fallback — identical to the pre-cutover inline calls (the
  // dynamic imports keep these host modules OUT of the register(ctx) graph).
  if (input.connectorKey === "wordpress") {
    const siteUrl = input.siteUrl?.trim();
    if (!siteUrl) {
      throw new Error("Enter the WordPress site domain before connecting with Nango.");
    }
    const { saveWordPressInstanceFromNangoConnection } = await import("@/lib/wordpress-api");
    await saveWordPressInstanceFromNangoConnection({
      siteUrl,
      providerConfigKey: input.providerConfigKey,
      connectionId: input.connectionId,
    });
    return;
  }
  if (input.connectorKey === "linkedin") {
    const { saveLinkedInAccountFromNangoConnection } = await import("@/lib/linkedin-api");
    await saveLinkedInAccountFromNangoConnection({
      providerConfigKey: input.providerConfigKey,
      connectionId: input.connectionId,
    });
    return;
  }
  throw new Error(
    `No Nango connection materializer is available for "${input.connectorKey}".`,
  );
}
