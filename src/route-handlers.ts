import type { NangoAuthWebhookBody } from "@nangohq/node";
import { z } from "zod";
import {
  createNangoConnectSession,
  getNangoConnectorDefinitionByProviderConfigKey,
  saveNangoConnectorConnection,
} from "./nango-connect-ui";
import { listSavedNangoConnections, verifyNangoWebhookSignature } from "./nango";

// `gemini` is cinatra-native, so the Connect-UI session-create endpoint no
// longer accepts it. (Apify, Drupal, Tailscale, a2aServer were already absent
// from this enum since they were never Connect-UI-managed;
// saveNangoConnectorConnection has the symmetric runtime gate for any remaining
// write path.)
const nangoConnectSessionSchema = z.object({
  connectorKey: z.enum(["apollo", "claude", "github", "gmail", "googleCalendar", "googleOAuth", "linkedin", "openai", "wordpress", "youtube"]),
  reconnectConnectionId: z.string().optional(),
  scope: z.enum(["app", "user"]).optional(),
});

const nangoConnectionSaveSchema = z.object({
  connectorKey: z.enum(["apollo", "claude", "gemini", "github", "gmail", "googleCalendar", "googleOAuth", "linkedin", "openai", "wordpress", "youtube"]),
  providerConfigKey: z.string().min(1),
  connectionId: z.string().min(1),
  siteUrl: z.string().optional(),
  scope: z.enum(["app", "user"]).optional(),
});

type RouteResult =
  | {
      status: number;
      body: Record<string, unknown>;
    }
  | {
      status?: undefined;
      body: Record<string, unknown>;
    };

export async function handleNangoConnectSessionRequest(
  request: Request,
  options?: {
    userId?: string;
    userEmail?: string;
    userDisplayName?: string;
  },
): Promise<RouteResult> {
  try {
    const body = nangoConnectSessionSchema.parse(await request.json().catch(() => ({})));
    // Defense-in-depth (#266): treat a missing scope as the privileged `app`
    // scope, never as an unauthenticated default. User scope requires a
    // server-validated userId; the host route is the primary authz boundary.
    const scope = body.scope ?? "app";
    if (scope === "user" && !options?.userId) {
      throw new Error("Sign in again before starting a user connection.");
    }
    const sessionToken = await createNangoConnectSession({
      ...body,
      scope,
      // Forward the authenticated user context for user scope. This also flows
      // into the reconnect-ownership assertion (#330) so a user reconnect is
      // bound to the caller's own saved connection.
      ...(scope === "user"
        ? {
            userId: options?.userId,
            userEmail: options?.userEmail,
            userDisplayName: options?.userDisplayName,
          }
        : {}),
    });
    return { body: { sessionToken } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start the connection flow.";
    return { status: 400, body: { error: message } };
  }
}

export async function handleNangoConnectionSaveRequest(
  request: Request,
  options?: {
    userId?: string;
  },
): Promise<RouteResult> {
  try {
    const body = nangoConnectionSaveSchema.parse(await request.json().catch(() => ({})));
    // Defense-in-depth (#266): missing scope is privileged `app`, not an
    // unauthenticated default. User scope requires a server-validated userId.
    const scope = body.scope ?? "app";
    if (scope === "user" && !options?.userId) {
      throw new Error("Sign in again before saving a user connection.");
    }
    const connection = await saveNangoConnectorConnection({
      ...body,
      scope,
      ...(scope === "user" ? { userId: options?.userId } : {}),
    });
    return { body: { success: true, connection } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save the connection.";
    return { status: 400, body: { error: message } };
  }
}

export async function handleNangoWebhookRequest(request: Request): Promise<RouteResult> {
  // (#273) The webhook is an UNAUTHENTICATED public ingress. Verify the Nango
  // HMAC signature over the RAW body BEFORE any parse, and fail closed on a
  // missing/invalid signature or an unprovisioned signing secret. Read the raw
  // text first so the bytes the signature covers are exactly what we verify.
  const raw = await request.text().catch(() => "");

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  if (!verifyNangoWebhookSignature(raw, headers)) {
    // Do NOT parse, do NOT save. 401 — reject the unsigned/forged/unconfigured
    // request rather than silently accepting it.
    return { status: 401, body: { error: "Invalid webhook signature." } };
  }

  let body: NangoAuthWebhookBody | null = null;
  try {
    body = JSON.parse(raw) as NangoAuthWebhookBody;
  } catch {
    body = null;
  }

  if (!body || body.type !== "auth" || !body.success) {
    return { body: { ok: true } };
  }

  const definition = getNangoConnectorDefinitionByProviderConfigKey(body.providerConfigKey);
  if (!definition) {
    return { body: { ok: true } };
  }

  // Codex correction (#273): even after a valid signature, do NOT default the
  // saved pointer's scope to "app". A default-to-app on this sender-unverified
  // ingress would let a (signed) event mint a shared-credential app pointer by
  // omission. Establish scope/ownership from the AUTHORITATIVE Cinatra store:
  // only re-affirm a pointer that already exists for this (connector,
  // connectionId), inheriting its recorded scope/userId. If no store entry
  // matches, ignore the save — the webhook never establishes new ownership.
  const existing = listSavedNangoConnections(definition.key).find(
    (entry) => entry.connectionId === body.connectionId,
  );
  if (!existing) {
    return { body: { ok: true } };
  }

  try {
    await saveNangoConnectorConnection({
      connectorKey: definition.key,
      providerConfigKey: body.providerConfigKey,
      connectionId: body.connectionId,
      scope: existing.scope ?? "app",
      ...(existing.scope === "user" ? { userId: existing.userId } : {}),
    });
  } catch {
    // The frontend event flow is the primary local-dev path; webhook failures should not break the webhook.
  }

  return { body: { ok: true } };
}
