import type { NangoAuthWebhookBody } from "@nangohq/node";
import { z } from "zod";
import {
  createNangoConnectSession,
  getNangoConnectorDefinitionByProviderConfigKey,
  saveNangoConnectorConnection,
} from "./nango-connect-ui";

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
    if (body.scope === "user" && !options?.userId) {
      throw new Error("Sign in again before starting a user connection.");
    }
    const sessionToken = await createNangoConnectSession({
      ...body,
      ...(body.scope === "user"
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
    if (body.scope === "user" && !options?.userId) {
      throw new Error("Sign in again before saving a user connection.");
    }
    const connection = await saveNangoConnectorConnection({
      ...body,
      ...(body.scope === "user" ? { userId: options?.userId } : {}),
    });
    return { body: { success: true, connection } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save the connection.";
    return { status: 400, body: { error: message } };
  }
}

export async function handleNangoWebhookRequest(request: Request): Promise<RouteResult> {
  const body = (await request.json().catch(() => null)) as NangoAuthWebhookBody | null;

  if (!body || body.type !== "auth" || !body.success) {
    return { body: { ok: true } };
  }

  const definition = getNangoConnectorDefinitionByProviderConfigKey(body.providerConfigKey);
  if (!definition) {
    return { body: { ok: true } };
  }

  try {
    await saveNangoConnectorConnection({
      connectorKey: definition.key,
      providerConfigKey: body.providerConfigKey,
      connectionId: body.connectionId,
    });
  } catch {
    // The frontend event flow is the primary local-dev path; webhook failures should not break the webhook.
  }

  return { body: { ok: true } };
}
