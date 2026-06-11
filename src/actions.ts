"use server";

// Nango connection server action — relocated from the central
// `@cinatra-ai/connectors` host hub into the connector itself (SDK-only
// decouple). Gated by the SDK's `requireExtensionAction(pkg, "manage")` as the
// FIRST awaited statement — the hub copy had NO gate, so this ADDS authorization
// (org_owner/org_admin/platform_admin, fail-closed).
//
// It persists through the in-package `saveNangoSettings`, which writes the LIVE
// `nango` connector-config key that every reader (`getNangoSettings`) consumes.
// The former hub copy wrote a dead `nango_connection` key that NO reader ever
// read, so the settings form silently never persisted usable DB config; this
// relocation fixes that latent dead-write. The dead key's values are UNTRUSTED
// (its writer was ungated), so `purgeLegacyNangoConnectionConfig` in ./nango only
// DELETES the stale key — it never promotes its values into live config.
//
// The connector carries no `@/lib/*` host edge here: setup-wizard cache
// invalidation stays host-side in the `src/app/campaigns/actions.ts` forwarder
// (the host onboarding surface that consumes it), keeping this action IoC-clean.

import { requireExtensionAction } from "@cinatra-ai/sdk-extensions";
import { makeSaveNangoConnectionAction } from "./actions-core";

const NANGO_PACKAGE_ID = "@cinatra-ai/nango-connector";

// The action BODY lives in ./actions-core.ts (a factory parameterized by the
// manage-permission guard) — shared with the serverEntry capability path,
// which injects the host's `@cinatra-ai/host:extension-action-guard` service
// instead of the SDK slot used here (host-peer-value-import ban: the
// serverEntry graph keeps the SDK type-only). Public signature and behavior
// are unchanged.
const action = makeSaveNangoConnectionAction(() =>
  requireExtensionAction(NANGO_PACKAGE_ID, "manage"),
);

export async function saveNangoConnectionAction(formData: FormData) {
  return action(formData);
}
