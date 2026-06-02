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

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireExtensionAction } from "@cinatra-ai/sdk-extensions";
import { saveNangoSettings } from "./nango";

const nangoConnectorSchema = z.object({
  secretKey: z.string().optional(),
  serverUrl: z.string().optional(),
  redirectTo: z.string().optional(),
});

export async function saveNangoConnectionAction(formData: FormData) {
  await requireExtensionAction("@cinatra-ai/nango-connector", "manage");
  const parsed = nangoConnectorSchema.parse({
    secretKey: formData.get("secretKey") ?? undefined,
    serverUrl: formData.get("serverUrl") ?? undefined,
    redirectTo: formData.get("redirectTo") ?? undefined,
  });
  const redirectTo = parsed.redirectTo?.trim() || "/configuration/environment?tab=connections";

  try {
    await saveNangoSettings({
      secretKey: parsed.secretKey?.trim() || undefined,
      serverUrl: parsed.serverUrl?.trim() || undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save Nango settings.";
    throw new Error(message);
  }
  redirect(redirectTo);
}
