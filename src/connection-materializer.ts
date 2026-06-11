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
// falls back to the legacy direct `@/lib/linkedin-api` / `@/lib/wordpress-api`
// host imports so the save path keeps working exactly as before the cutover.

import { saveLinkedInAccountFromNangoConnection } from "@/lib/linkedin-api";
import { saveWordPressInstanceFromNangoConnection } from "@/lib/wordpress-api";

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

  // Legacy skew fallback — identical to the pre-cutover inline calls.
  if (input.connectorKey === "wordpress") {
    const siteUrl = input.siteUrl?.trim();
    if (!siteUrl) {
      throw new Error("Enter the WordPress site domain before connecting with Nango.");
    }
    await saveWordPressInstanceFromNangoConnection({
      siteUrl,
      providerConfigKey: input.providerConfigKey,
      connectionId: input.connectionId,
    });
    return;
  }
  if (input.connectorKey === "linkedin") {
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
