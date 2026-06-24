import { NANGO_CONNECTOR_DEFINITIONS } from "./nango-connectors";
import {
  CINATRA_NANGO_PROVIDER_CONFIG_KEYS,
  buildNangoUserEndUserId,
  ensureNangoIntegration,
  getNangoClient,
  getNangoConnection,
  getNangoGoogleOAuthClientCredentials,
  getNangoOAuth2IntegrationCredentials,
  isNangoConfigured,
  saveNangoConnectionRecord,
  type NangoConnectorKey,
} from "./nango";
import { getNangoConfigStore } from "./config-store";
import { materializeNangoConnection } from "./connection-materializer";

const GOOGLE_NANGO_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.settings.basic",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(",");

const GMAIL_NANGO_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.settings.basic",
  "https://www.googleapis.com/auth/userinfo.email",
].join(",");

const GOOGLE_CALENDAR_NANGO_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(",");

const LINKEDIN_NANGO_SCOPES = ["openid", "profile", "email", "w_member_social"].join(",");
// Parity with the host github surface's OAuth scope set (the integration
// credentials chain moved connector-side with the serverEntry cutover).
const GITHUB_NANGO_SCOPES = ["repo", "workflow", "read:user", "user:email"].join(",");
const GOOGLE_NANGO_DISPLAY_NAME = "Google";
const YOUTUBE_NANGO_SCOPES = ["https://www.googleapis.com/auth/youtube.readonly"].join(",");

/**
 * LinkedIn OAuth client credentials, resolved with the SAME precedence as the
 * host linkedin surface's settings reader: the Nango integration credentials
 * are the source of truth, with the DB `"linkedin"` connector-config row (via
 * the injected store) as the resilience fallback. Parity is test-pinned —
 * keep this chain in sync with the host's `getLinkedInAPISettings`.
 */
async function getLinkedInClientCredentials(): Promise<{
  clientId?: string;
  clientSecret?: string;
}> {
  const nangoCredentials = await getNangoOAuth2IntegrationCredentials(
    CINATRA_NANGO_PROVIDER_CONFIG_KEYS.linkedin,
  );
  const stored = getNangoConfigStore().read<{ clientId?: unknown; clientSecret?: unknown }>(
    "linkedin",
    {},
  );
  const storedClientId =
    typeof stored.clientId === "string" && stored.clientId.trim() ? stored.clientId.trim() : undefined;
  const storedClientSecret =
    typeof stored.clientSecret === "string" && stored.clientSecret.trim()
      ? stored.clientSecret.trim()
      : undefined;

  return {
    clientId: nangoCredentials?.clientId || storedClientId,
    clientSecret: nangoCredentials?.clientSecret || storedClientSecret,
  };
}

export function getNangoConnectorDefinition(connectorKey: NangoConnectorKey) {
  return NANGO_CONNECTOR_DEFINITIONS[connectorKey];
}

export function getNangoConnectorDefinitionByProviderConfigKey(providerConfigKey: string) {
  return Object.values(NANGO_CONNECTOR_DEFINITIONS).find((definition) => definition.providerConfigKey === providerConfigKey) ?? null;
}

export async function ensureNangoConnectorIntegration(connectorKey: NangoConnectorKey) {
  const definition = getNangoConnectorDefinition(connectorKey);
  const connectDisplayName = definition.connectDisplayName ?? definition.title;

  switch (connectorKey) {
    case "openai":
      return ensureNangoIntegration({
        provider: "openai",
        providerConfigKey: definition.providerConfigKey,
        displayName: connectDisplayName,
      });
    case "gmail": {
      const settings = await getNangoGoogleOAuthClientCredentials();
      if (!settings.clientId || !settings.clientSecret) {
        throw new Error("Save the Google OAuth client ID and client secret first.");
      }

      return ensureNangoIntegration({
        provider: "google-mail",
        providerConfigKey: definition.providerConfigKey,
        displayName: connectDisplayName,
        credentials: {
          type: "OAUTH2",
          client_id: settings.clientId,
          client_secret: settings.clientSecret,
          scopes: GMAIL_NANGO_SCOPES,
        },
      });
    }
    case "gemini":
      return ensureNangoIntegration({
        provider: "google-gemini",
        providerConfigKey: definition.providerConfigKey,
        displayName: connectDisplayName,
      });
    case "googleCalendar": {
      const settings = await getNangoGoogleOAuthClientCredentials();
      if (!settings.clientId || !settings.clientSecret) {
        throw new Error("Save the Google OAuth client ID and client secret first.");
      }

      return ensureNangoIntegration({
        provider: "google-calendar",
        providerConfigKey: definition.providerConfigKey,
        displayName: connectDisplayName,
        credentials: {
          type: "OAUTH2",
          client_id: settings.clientId,
          client_secret: settings.clientSecret,
          scopes: GOOGLE_CALENDAR_NANGO_SCOPES,
        },
      });
    }
    case "apollo":
      return ensureNangoIntegration({
        provider: "apollo",
        providerConfigKey: definition.providerConfigKey,
        displayName: connectDisplayName,
      });
    case "claude":
      return ensureNangoIntegration({
        provider: "anthropic",
        providerConfigKey: definition.providerConfigKey,
        displayName: connectDisplayName,
      });
    case "github": {
      // Same chain the host's github surface uses for these credentials: the
      // Nango integration itself is the source of truth (this package's own
      // reader) — no host import.
      const credentials = await getNangoOAuth2IntegrationCredentials(
        CINATRA_NANGO_PROVIDER_CONFIG_KEYS.github,
      );
      if (!credentials?.clientId || !credentials?.clientSecret) {
        throw new Error("Save the GitHub client ID and client secret first.");
      }

      return ensureNangoIntegration({
        provider: "github",
        providerConfigKey: definition.providerConfigKey,
        displayName: connectDisplayName,
        credentials: {
          type: "OAUTH2",
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          scopes: GITHUB_NANGO_SCOPES,
        },
      });
    }
    case "googleOAuth": {
      const settings = await getNangoGoogleOAuthClientCredentials();
      if (!settings.clientId || !settings.clientSecret) {
        throw new Error("Save the Google OAuth client ID and client secret first.");
      }

      return ensureNangoIntegration({
        provider: "google",
        providerConfigKey: definition.providerConfigKey,
        displayName: GOOGLE_NANGO_DISPLAY_NAME,
        credentials: {
          type: "OAUTH2",
          client_id: settings.clientId,
          client_secret: settings.clientSecret,
          scopes: GOOGLE_NANGO_SCOPES,
        },
      });
    }
    case "linkedin": {
      const settings = await getLinkedInClientCredentials();
      if (!settings.clientId || !settings.clientSecret) {
        throw new Error("Save the LinkedIn client ID and client secret first.");
      }

      return ensureNangoIntegration({
        provider: "linkedin",
        providerConfigKey: definition.providerConfigKey,
        displayName: connectDisplayName,
        credentials: {
          type: "OAUTH2",
          client_id: settings.clientId,
          client_secret: settings.clientSecret,
          scopes: LINKEDIN_NANGO_SCOPES,
        },
      });
    }
    case "youtube": {
      const settings = await getNangoGoogleOAuthClientCredentials();
      if (!settings.clientId || !settings.clientSecret) {
        throw new Error("Save the Google OAuth client ID and client secret first.");
      }

      return ensureNangoIntegration({
        provider: "youtube",
        providerConfigKey: definition.providerConfigKey,
        displayName: connectDisplayName,
        credentials: {
          type: "OAUTH2",
          client_id: settings.clientId,
          client_secret: settings.clientSecret,
          scopes: YOUTUBE_NANGO_SCOPES,
        },
      });
    }
    case "wordpress":
      return ensureNangoIntegration({
        provider: "private-api-basic",
        providerConfigKey: definition.providerConfigKey,
        displayName: connectDisplayName,
      });
    // Tailscale OAuth-client mode (cinatra-ai/tailscale-connector#23, Design C).
    // The `tailscale` template is auth_mode TWO_STEP: the OAuth client_id/secret
    // are CONNECTION-level credentials entered in the Nango Connect UI, so the
    // integration is created BARE (no integration-level credentials — Nango
    // rejects OAUTH2-typed creds on a TWO_STEP provider). Nango then mints the
    // 1h access token itself; the clone worker mints auth-keys via the proxy.
    case "tailscaleOauth":
      return ensureNangoIntegration({
        provider: "tailscale",
        providerConfigKey: definition.providerConfigKey,
        displayName: connectDisplayName,
      });
    // A2A server connector. `private-api-key` lets operators paste
    // a bearer token; the server URL is stored in metadata.baseUrl when the
    // connection is imported. The Connect UI flow is NOT used for a2aServer
    // (definition.usesConnectUI is false) — createNangoConnectSession rejects
    // it before reaching this switch arm.
    case "a2aServer":
      return ensureNangoIntegration({
        provider: "private-api-key",
        providerConfigKey: definition.providerConfigKey,
        displayName: connectDisplayName,
      });
    // Apify (single-tenant API token). Uses the ready-made `apify`
    // template so the integration carries Apify-specific branding + future
    // proxy support for api.apify.com REST. Connect UI is NOT used; the token
    // is collected by the cinatra-native settings page and saved via
    // importNangoConnection server-side.
    case "apify":
      return ensureNangoIntegration({
        provider: "apify",
        providerConfigKey: definition.providerConfigKey,
        displayName: connectDisplayName,
      });
    // Drupal (per-instance Bearer token from `drush mcp-tools:remote-key-create`).
    // Uses generic `private-api-bearer` (matches the Bearer auth shape exactly;
    // Nango's catalog `drupal` template targets the wrong auth module). If the
    // deployed Nango rejects this provider string, fall back to
    // `private-api-key`. Connect UI is NOT used; the token + site URL are
    // collected by /connectors/drupal and saved via importNangoConnection
    // server-side.
    case "drupal":
      return ensureNangoIntegration({
        provider: "private-api-bearer",
        providerConfigKey: definition.providerConfigKey,
        displayName: connectDisplayName,
      });
  }
}

export async function createNangoConnectSession(input: {
  connectorKey: NangoConnectorKey;
  reconnectConnectionId?: string;
  scope?: "app" | "user";
  userId?: string;
  userEmail?: string;
  userDisplayName?: string;
}) {
  if (!isNangoConfigured()) {
    throw new Error("Configure the connection administration first.");
  }

  const definition = getNangoConnectorDefinition(input.connectorKey);
  if (!definition.usesConnectUI) {
    throw new Error(`${definition.title} is not configured for the connection flow.`);
  }

  await ensureNangoConnectorIntegration(input.connectorKey);
  const nango = getNangoClient();

  if (input.reconnectConnectionId) {
    const reconnect = await nango.createReconnectSession({
      connection_id: input.reconnectConnectionId,
      integration_id: definition.providerConfigKey,
    });

    return reconnect.data.token;
  }

  const session = await nango.createConnectSession({
    allowed_integrations: [definition.providerConfigKey],
    end_user: {
      id:
        input.scope === "user" && input.userId
          ? buildNangoUserEndUserId(input.userId)
          : "cinatra-local-user",
      display_name:
        input.scope === "user" ? input.userDisplayName || input.userEmail || "Cinatra User" : "Cinatra User",
      ...(input.scope === "user" && input.userEmail ? { email: input.userEmail } : {}),
    },
    tags: {
      connector_key: input.connectorKey,
      app: "cinatra",
      scope: input.scope ?? "app",
      ...(input.scope === "user" && input.userId ? { user_id: input.userId } : {}),
    },
  });

  return session.data.token;
}

export async function saveNangoConnectorConnection(input: {
  connectorKey: NangoConnectorKey;
  providerConfigKey: string;
  connectionId: string;
  siteUrl?: string;
  scope?: "app" | "user";
  userId?: string;
}) {
  const definition = getNangoConnectorDefinition(input.connectorKey);

  // Refuse to materialize a local Nango pointer record for cinatra-native
  // connectors (`usesConnectUI: false`).
  // Without this gate, a generic POST /api/nango/connections/save (or the
  // Nango auth webhook) could write an unverified pointer that bypasses
  // the readback chain in the connector's own save flow. Equivalent flows
  // exist for Gemini, Apify, Drupal, and Tailscale. createNangoConnectSession
  // already has the same guard shape; this closes the symmetric write path.
  // Gate runs BEFORE getNangoConnection so disallowed connectors fail
  // without a remote refresh.
  if (!definition.usesConnectUI) {
    throw new Error(`${definition.title} is not configured for the connection flow.`);
  }

  // Cross-wired pointer guard: refuse if the request's providerConfigKey doesn't match the connector
  // definition's declared providerConfigKey. Otherwise a malformed POST
  // could write a pointer under one connector key with another connector's
  // provider config key. Allowed connectors only ever use their canonical
  // providerConfigKey here.
  if (input.providerConfigKey !== definition.providerConfigKey) {
    throw new Error(
      `Refusing connection save: providerConfigKey "${input.providerConfigKey}" does not match the declared key for ${definition.title}.`,
    );
  }

  const connection = await getNangoConnection(input.providerConfigKey, input.connectionId, {
    forceRefresh: false,
    refreshToken: true,
  });

  if (!connection) {
    throw new Error("Unable to load the Nango connection details.");
  }

  await saveNangoConnectionRecord(
    input.connectorKey,
    {
      connectionId: input.connectionId,
      providerConfigKey: input.providerConfigKey,
      displayName: connection.end_user?.display_name ?? undefined,
      email: connection.end_user?.email ?? undefined,
      authMode: connection.credentials?.type,
      scope: input.scope ?? "app",
      userId: input.scope === "user" ? input.userId : undefined,
      metadata:
        input.connectorKey === "wordpress"
          ? {
              ...(connection.metadata ?? {}),
              ...(input.siteUrl?.trim() ? { siteUrl: input.siteUrl.trim() } : {}),
            }
          : (connection.metadata ?? undefined),
    },
    {
      multiple: definition.multiple,
      scope: input.scope ?? "app",
      userId: input.scope === "user" ? input.userId : undefined,
    },
  );

  // BLOCKING materialization (wordpress instance row / linkedin account row):
  // dispatched through the host's `nango-connection-materializer` capability
  // when `register(ctx)` bound it; a failure FAILS the save (inline semantics
  // preserved — see ./connection-materializer.ts).
  if (input.connectorKey === "wordpress") {
    const siteUrl = input.siteUrl?.trim();
    if (!siteUrl) {
      throw new Error("Enter the WordPress site domain before connecting with Nango.");
    }

    await materializeNangoConnection({
      connectorKey: "wordpress",
      providerConfigKey: input.providerConfigKey,
      connectionId: input.connectionId,
      siteUrl,
      scope: input.scope,
      userId: input.userId,
    });
  }

  if (input.connectorKey === "linkedin" && input.scope !== "user") {
    await materializeNangoConnection({
      connectorKey: "linkedin",
      providerConfigKey: input.providerConfigKey,
      connectionId: input.connectionId,
      scope: input.scope,
      userId: input.userId,
    });
  }

  return connection;
}
