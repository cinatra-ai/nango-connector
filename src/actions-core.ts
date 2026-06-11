// The Nango connection save-action CORE — a factory parameterized by the
// manage-permission guard, shared by the two delivery paths:
//   - `./actions.ts` ("use server") injects the SDK `requireExtensionAction`
//     slot (the host action endpoint path), and
//   - `./register.ts` (serverEntry) injects the host's
//     `@cinatra-ai/host:extension-action-guard` service resolved through
//     `ctx.capabilities` — so the serverEntry import graph carries NO SDK
//     VALUE import (host-peer-value-import ban).
//
// The guard is awaited FIRST (fail-closed: org_owner/org_admin/platform_admin)
// — public signature and behavior identical across both paths.

import { redirect } from "next/navigation";
import { z } from "zod";
import { saveNangoSettings } from "./nango";

const nangoConnectorSchema = z.object({
  secretKey: z.string().optional(),
  serverUrl: z.string().optional(),
  redirectTo: z.string().optional(),
});

export function makeSaveNangoConnectionAction(
  requireManage: () => Promise<void>,
): (formData: FormData) => Promise<void> {
  return async function saveNangoConnectionAction(formData: FormData) {
    await requireManage();
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
  };
}
