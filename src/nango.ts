import { createHmac, timingSafeEqual } from "node:crypto";
import { Nango, type ApiKeyCredentials, type BasicApiCredentials, type OAuth2Credentials } from "@nangohq/node";
import { getNangoConfigStore } from "./config-store";

export type NangoSettings = {
  secretKey?: string;
  serverUrl?: string;
};

export type NangoFrontendConfig = {
  apiURL?: string;
  baseURL?: string;
};

export type NangoConnectorKey =
  | "a2aServer"
  | "apify"
  | "apollo"
  | "claude"
  | "drupal"
  | "github"
  | "gmail"
  | "gemini"
  | "googleCalendar"
  | "googleOAuth"
  | "linkedin"
  | "openai"
  | "tailscale"
  | "tailscaleOauth"
  | "wordpress"
  | "youtube";

export type SavedNangoConnection = {
  connectorKey: NangoConnectorKey;
  connectionId: string;
  providerConfigKey: string;
  connectedAt: string;
  scope?: "app" | "user";
  userId?: string;
  displayName?: string;
  email?: string;
  authMode?: string;
  metadata?: Record<string, unknown>;
};

type NangoConnectionStore = {
  connections: Record<NangoConnectorKey, SavedNangoConnection[]>;
};

export const CINATRA_NANGO_PROVIDER_CONFIG_KEYS = {
  a2aServer: "cinatra-a2a-server",
  apify: "cinatra-apify",
  apollo: "cinatra-apollo",
  claude: "cinatra-anthropic",
  drupal: "cinatra-drupal",
  gemini: "cinatra-google-gemini",
  github: "cinatra-github",
  gmail: "cinatra-gmail",
  googleCalendar: "cinatra-google-calendar",
  googleOAuth: "cinatra-google-oauth",
  linkedin: "cinatra-linkedin",
  openai: "cinatra-openai",
  // Tailscale OAuth client (client_id + client_secret) is stored at the
  // INTEGRATION level via `ensureNangoIntegration({credentials})`.
  // Per-clone auth-keys are minted at clone-start time directly via the
  // Tailscale API (not stored in Nango). Single app-level credential.
  tailscale: "cinatra-tailscale",
  // Tailscale OAuth-client mode (cinatra-ai/tailscale-connector#23, Design C):
  // a distinct `tailscale` (auth_mode TWO_STEP) integration whose OAuth client
  // is connected via the Nango Connect UI (the secret is entered in Nango's
  // hosted UI — it never transits the Cinatra app). Kept separate from the
  // legacy `cinatra-tailscale` API-key integration so both modes coexist.
  tailscaleOauth: "cinatra-tailscale-oauth",
  wordpress: "cinatra-wordpress",
  youtube: "cinatra-youtube",
} as const;

export const CINATRA_NANGO_CONNECTION_IDS = {
  apify: "cinatra-apify",
  apollo: "cinatra-apollo",
  claude: "cinatra-anthropic-connection",
  gemini: "cinatra-google-gemini",
  github: "cinatra-github",
  gmail: "cinatra-gmail",
  googleCalendar: "cinatra-google-calendar",
  googleOAuth: "cinatra-google-oauth",
  openai: "cinatra-openai",
  // Connection record exists only to track configured/cleared status via the
  // existing `saveNangoConnectionRecord` store. The real
  // credentials live at the INTEGRATION level (see provider config key).
  tailscale: "cinatra-tailscale",
  wordpress: "cinatra-wordpress",
  youtube: "cinatra-youtube",
} as const;

function getConnectorKeysForProviderConfigKey(providerConfigKey: string): NangoConnectorKey[] {
  return (Object.entries(CINATRA_NANGO_PROVIDER_CONFIG_KEYS) as Array<[NangoConnectorKey, string]>)
    .filter(([, value]) => value === providerConfigKey)
    .map(([key]) => key);
}

const NANGO_CONNECTOR_ID = "nango";
const NANGO_CONNECTIONS_CONNECTOR_ID = "nango_connections";

const EMPTY_NANGO_CONNECTION_STORE: NangoConnectionStore = {
  connections: {
    a2aServer: [],
    apify: [],
    apollo: [],
    claude: [],
    drupal: [],
    gemini: [],
    github: [],
    gmail: [],
    googleCalendar: [],
    googleOAuth: [],
    linkedin: [],
    openai: [],
    tailscale: [],
    tailscaleOauth: [],
    wordpress: [],
    youtube: [],
  },
};

function getNangoErrorMessage(error: unknown, fallback: string) {
  if (!error || typeof error !== "object") {
    return fallback;
  }

  const candidate = error as {
    message?: string;
    response?: {
      data?: {
        error?: {
          message?: string;
          errors?: Array<{ message?: string }>;
        };
      };
    };
  };

  const nestedError = candidate.response?.data?.error;
  const nestedMessage = nestedError?.errors?.find((entry) => entry?.message)?.message ?? nestedError?.message;

  return nestedMessage || candidate.message || fallback;
}

// One-shot legacy-key SANITIZATION. Earlier, the central hub's
// `saveNangoConnectionAction` wrote credentials to the dead `nango_connection`
// connector-config key, which NO reader ever consumed (every reader uses the
// `nango` key via `getNangoSettings`). That writer was UNGATED, so the key's
// stored values are UNTRUSTED — any member could have seeded it. We therefore
// NEVER promote it into the live `nango` config: promoting a poisoned `serverUrl`
// would redirect the live bearer secret to an attacker host (exfiltration), and
// promoting a poisoned `secretKey` would route the workspace's OAuth through an
// attacker's Nango account (MITM). The only safe migration is to PHYSICALLY
// DELETE the dead key. Fully guarded so it NEVER throws into the cold-boot read
// path; the `legacyNangoKeyPurged` latch is set only on SUCCESS, so a
// failed/timed-out attempt retries on a later read (per security review).
const LEGACY_NANGO_CONNECTION_KEY = "nango_connection";
let legacyNangoKeyPurged = false;

function purgeLegacyNangoConnectionConfig(): void {
  try {
    const legacy = getNangoConfigStore().read<NangoSettings | null>(LEGACY_NANGO_CONNECTION_KEY, null);
    if (legacy !== null && legacy !== undefined) {
      // Physically remove the dead, untrusted key (any present row, incl. blank).
      // Its values are NEVER read back into live config.
      getNangoConfigStore().delete(LEGACY_NANGO_CONNECTION_KEY);
    }
    legacyNangoKeyPurged = true;
  } catch {
    // Degrade silently (e.g. cold-boot Postgres timeout); retry on a later read.
  }
}

function readStoredNangoSettings(): NangoSettings {
  // Fix: cold-boot Postgres timeout resilience.
  //
  // During cold boot, Turbopack compiles many routes in parallel worker_threads.
  // Each worker independently evaluates auth.ts (which has a top-level
  // `await getGoogleOAuthSettings()`), triggering this DB call before the
  // schema-init sentinel is in place. If the 30-second Atomics.wait timeout
  // fires (due to concurrent DDL contention — see database.ts:ensurePostgresSchema),
  // propagating the error crashes all 55 routes that transitively import auth-session.ts.
  //
  // Graceful handling: on Postgres timeout, return {} (empty NangoSettings).
  // isNangoConfigured() checks secretKey?.trim() — empty string/undefined → false.
  // auth.ts then initializes betterAuth without Google OAuth social provider,
  // which is acceptable (Google OAuth is optional; email/password auth still works).
  // The next warm request will succeed once schema init completes.
  try {
    const stored = getNangoConfigStore().read<NangoSettings>(NANGO_CONNECTOR_ID, {});
    if (!legacyNangoKeyPurged) {
      // Sanitize the dead, untrusted `nango_connection` key once. NEVER alters
      // the live `nango` value returned here.
      purgeLegacyNangoConnectionConfig();
    }
    return stored;
  } catch (err) {
    if (err instanceof Error && err.message.includes("Timed out while executing Postgres query")) {
      // Return empty administration — isNangoConfigured() will return false.
      // This is safe: Nango being "unconfigured" at module eval time is
      // indistinguishable from Nango not being set up at all.
      return {};
    }
    throw err;
  }
}

function readStoredNangoConnections() {
  return getNangoConfigStore().read<NangoConnectionStore>(NANGO_CONNECTIONS_CONNECTOR_ID, EMPTY_NANGO_CONNECTION_STORE);
}

function writeStoredNangoConnections(value: NangoConnectionStore) {
  getNangoConfigStore().write(NANGO_CONNECTIONS_CONNECTOR_ID, value);
}

export function buildNangoUserEndUserId(userId: string) {
  return `cinatra-user:${userId}`;
}

export function getNangoSettings(): NangoSettings {
  const stored = readStoredNangoSettings();

  // Use `?.trim() ||` rather than `??` so a `.env` line like
  // `NANGO_SECRET_KEY=` (key set, value empty) falls back to the
  // DB-stored value instead of being treated as an explicit empty override.
  // With `??`, the empty string is "set" and shadows `stored.*`, leaving
  // getNangoStatus() at "not_connected" even when the operator wrote a
  // secret via the setup wizard.
  return {
    secretKey: process.env.NANGO_SECRET_KEY?.trim() || stored.secretKey,
    serverUrl: process.env.NANGO_SERVER_URL?.trim() || stored.serverUrl,
  };
}

/**
 * Verify an incoming Nango webhook request.
 *
 * Self-hosted nango-server (0.70.x line) signs the RAW request body with
 * HMAC-SHA256 (hex digest) keyed by the environment's API secret key — the
 * SAME `secretKey` we use for API calls — and sends it in the
 * `X-Nango-Hmac-Sha256` header. Verified against upstream source:
 * server `getHmacSignatureHeader(secret, body)` is called with the env API
 * secret (`DBAPISecret['secret']`), and the SDK's `verifyIncomingWebhookRequest`
 * HMACs the raw body with `this.secretKey`. Self-hosted Nango has NO separate
 * webhook signing secret, so we verify with `secretKey` (no NANGO_WEBHOOK_SECRET).
 *
 * Fail-closed: returns false when the secret is unconfigured, the header is
 * missing, the signature is not a 64-char hex digest, or the constant-time
 * compare fails. Never throws; never short-circuits on length to avoid leaking timing.
 */
export function verifyNangoWebhookSignature(
  rawBody: string,
  headers: Record<string, unknown>,
): boolean {
  const secret = getNangoSettings().secretKey?.trim();
  if (!secret) {
    // No API secret key configured → cannot verify → reject every webhook
    // (intended secure default; the connect/save event flow remains primary).
    return false;
  }

  const headerKey = Object.keys(headers).find(
    (key) => key.toLowerCase() === "x-nango-hmac-sha256",
  );
  const provided = headerKey ? headers[headerKey] : undefined;
  if (typeof provided !== "string") {
    return false;
  }

  // Canonicalization guard: a SHA-256 HMAC hex digest is EXACTLY 64 lowercase
  // hex chars. Reject anything else BEFORE decoding. `Buffer.from(x, "hex")`
  // silently truncates at the first non-hex char, so without this an attacker
  // could append junk (e.g. a valid digest + "zz") and still decode to a
  // matching buffer (length-confusion bypass). Compare hex case-insensitively.
  if (!/^[0-9a-fA-F]{64}$/.test(provided)) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  // Both buffers are now guaranteed 32 bytes; timingSafeEqual is constant-time.
  try {
    return timingSafeEqual(expectedBuf, providedBuf);
  } catch {
    return false;
  }
}

export async function saveNangoSettings(input: NangoSettings) {
  const current = readStoredNangoSettings();
  getNangoConfigStore().write(NANGO_CONNECTOR_ID, {
    ...current,
    secretKey: input.secretKey?.trim() || current.secretKey,
    serverUrl: input.serverUrl?.trim() || current.serverUrl,
  } satisfies NangoSettings);

  // Best-effort: disable Nango Connect UI watermark on every key save.
  // Silently ignored if the plan doesn't support it or the API call fails.
  try {
    const nango = getNangoClient();
    applyNangoConnectUINoWatermark(nango).catch(() => null);
  } catch {
    // getNangoClient throws when no secret key — safe to ignore
  }
}

type ConnectUISettingsPayload = {
  showWatermark: boolean;
  defaultTheme: string;
  theme: { light: { primary: string }; dark: { primary: string } };
};

async function applyNangoConnectUINoWatermark(nango: InstanceType<typeof Nango>): Promise<void> {
  const baseUrl = (nango.serverUrl as string).replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${nango.secretKey as string}` };

  // GET current administration to preserve existing theme values
  let current: ConnectUISettingsPayload | null = null;
  try {
    const res = await nango.http.get(`${baseUrl}/api/v1/connect-ui-administration?env=prod`, { headers });
    current = (res.data as { data: ConnectUISettingsPayload })?.data ?? null;
  } catch {
    // ignore — we'll use fallback defaults
  }

  await nango.http.put(
    `${baseUrl}/api/v1/connect-ui-administration?env=prod`,
    {
      showWatermark: false,
      defaultTheme: current?.defaultTheme ?? "system",
      theme: current?.theme ?? { light: { primary: "#000000" }, dark: { primary: "#ffffff" } },
    } satisfies ConnectUISettingsPayload,
    { headers },
  );
}

export function isNangoConfigured() {
  const settings = getNangoSettings();
  return Boolean(settings.secretKey?.trim());
}

export function getNangoStatus() {
  const settings = getNangoSettings();

  if (settings.secretKey?.trim()) {
    return {
      status: "connected" as const,
      detail: settings.serverUrl?.trim() ? `Using the configured connection service at ${settings.serverUrl.trim()}` : "Using the default hosted connection service.",
    };
  }

  return {
    status: "not_connected" as const,
    detail: "Add a secret key to enable API and OAuth connections.",
  };
}

export function getNangoFrontendConfig(): NangoFrontendConfig {
  const settings = getNangoSettings();
  const serverUrl = settings.serverUrl?.trim();
  const connectUrl = process.env.NANGO_PUBLIC_CONNECT_URL?.trim();

  if (!serverUrl && !connectUrl) {
    return {};
  }

  let derivedConnectUrl = connectUrl;
  if (!derivedConnectUrl && serverUrl) {
    try {
      const url = new URL(serverUrl);
      if (url.port === "3003") {
        url.port = "3009";
      }
      derivedConnectUrl = url.toString().replace(/\/$/, "");
    } catch {
      derivedConnectUrl = undefined;
    }
  }

  return {
    apiURL: serverUrl || undefined,
    baseURL: derivedConnectUrl || undefined,
  };
}

export function getNangoOAuthCallbackUrl() {
  const settings = getNangoSettings();
  const baseUrl = settings.serverUrl?.trim() || "https://api.nango.dev";

  try {
    return new URL("/oauth/callback", baseUrl).toString();
  } catch {
    return "https://api.nango.dev/oauth/callback";
  }
}

export function listSavedNangoConnections(
  connectorKey: NangoConnectorKey,
  options?: {
    scope?: "app" | "user";
    userId?: string;
  },
) {
  const store = readStoredNangoConnections();
  const allConnections = [...(store.connections[connectorKey] ?? [])];

  if (!options?.scope) {
    return allConnections;
  }

  return allConnections.filter((entry) => {
    const entryScope = entry.scope ?? "app";
    if (entryScope !== options.scope) {
      return false;
    }

    if (options.scope === "user") {
      return entry.userId === options.userId;
    }

    return true;
  });
}

export function getPrimarySavedNangoConnection(
  connectorKey: NangoConnectorKey,
  options?: {
    scope?: "app" | "user";
    userId?: string;
  },
) {
  return listSavedNangoConnections(connectorKey, options)[0] ?? null;
}

export function getPrimarySavedNangoConnections(
  options?: {
    scope?: "app" | "user";
    userId?: string;
  },
) {
  const store = readStoredNangoConnections();
  const result = {} as Partial<Record<NangoConnectorKey, SavedNangoConnection | null>>;

  for (const connectorKey of Object.keys(store.connections) as NangoConnectorKey[]) {
    const matching = (store.connections[connectorKey] ?? []).filter((entry) => {
      if (!options?.scope) {
        return true;
      }

      const entryScope = entry.scope ?? "app";
      if (entryScope !== options.scope) {
        return false;
      }

      if (options.scope === "user") {
        return entry.userId === options.userId;
      }

      return true;
    });

    result[connectorKey] = matching[0] ?? null;
  }

  return result as Record<NangoConnectorKey, SavedNangoConnection | null>;
}

export async function saveNangoConnectionRecord(
  connectorKey: NangoConnectorKey,
  record: Omit<SavedNangoConnection, "connectorKey" | "connectedAt"> & { connectedAt?: string },
  options?: {
    multiple?: boolean;
    scope?: "app" | "user";
    userId?: string;
  },
) {
  const store = readStoredNangoConnections();
  const existing = store.connections[connectorKey] ?? [];
  const normalized: SavedNangoConnection = {
    connectorKey,
    connectedAt: record.connectedAt ?? new Date().toISOString(),
    scope: options?.scope ?? record.scope ?? "app",
    userId: options?.scope === "user" ? options.userId ?? record.userId : undefined,
    ...record,
  };

  const deduped = existing.filter((entry) => {
    if (entry.connectionId === normalized.connectionId) {
      return false;
    }

    const entryScope = entry.scope ?? "app";
    const normalizedScope = normalized.scope ?? "app";
    if (entryScope !== normalizedScope) {
      return true;
    }

    if (normalizedScope === "user") {
      return entry.userId !== normalized.userId;
    }

    // multiple=true: keep other app-scope entries (only the same connectionId is removed above).
    // multiple=false (default): replace all app-scope entries with the new one.
    return options?.multiple ?? false;
  });
  store.connections[connectorKey] = options?.multiple ? [...deduped, normalized] : [normalized];
  writeStoredNangoConnections(store);
}

export async function removeNangoConnectionRecord(
  connectorKey: NangoConnectorKey,
  connectionId: string,
  options?: {
    scope?: "app" | "user";
    userId?: string;
  },
) {
  const store = readStoredNangoConnections();
  store.connections[connectorKey] = (store.connections[connectorKey] ?? []).filter((entry) => {
    if (entry.connectionId !== connectionId) {
      return true;
    }

    if (!options?.scope) {
      return false;
    }

    const entryScope = entry.scope ?? "app";
    if (entryScope !== options.scope) {
      return true;
    }

    if (options.scope === "user") {
      return entry.userId !== options.userId;
    }

    return false;
  });
  writeStoredNangoConnections(store);
}

export async function clearNangoConnectionRecords(
  connectorKey: NangoConnectorKey,
  options?: {
    scope?: "app" | "user";
    userId?: string;
  },
) {
  const store = readStoredNangoConnections();
  if (!options?.scope) {
    store.connections[connectorKey] = [];
  } else {
    store.connections[connectorKey] = (store.connections[connectorKey] ?? []).filter((entry) => {
      const entryScope = entry.scope ?? "app";
      if (entryScope !== options.scope) {
        return true;
      }

      if (options.scope === "user") {
        return entry.userId !== options.userId;
      }

      return false;
    });
  }
  writeStoredNangoConnections(store);
}

export function getNangoClient() {
  const settings = getNangoSettings();
  if (!settings.secretKey?.trim()) {
    throw new Error("The connection service is not configured. Set NANGO_SECRET_KEY or save a secret key in Cinatra.");
  }

  const nango = new Nango({
    secretKey: settings.secretKey,
    ...(settings.serverUrl?.trim() ? { host: settings.serverUrl.trim() } : {}),
  });

  // The Nango SDK uses Axios internally. Disabling proxy auto-detection avoids
  // Node's legacy `url.parse()` path from surfacing as a dev-time deprecation warning.
  nango.http.defaults.proxy = false;

  return nango;
}

type IntegrationCredentials =
  | {
      type: "OAUTH2";
      client_id: string;
      client_secret: string;
      scopes?: string;
    }
  | undefined;

type NangoOAuth2IntegrationCredentials = {
  clientId?: string;
  clientSecret?: string;
  scopes?: string;
};

export async function getNangoIntegration(providerConfigKey: string) {
  if (!isNangoConfigured()) {
    return null;
  }

  const nango = getNangoClient();

  try {
    const integration = await nango.getIntegration(
      { uniqueKey: providerConfigKey },
      { include: ["credentials"] },
    );

    return integration.data ?? null;
  } catch {
    return null;
  }
}

export async function getNangoOAuth2IntegrationCredentials(
  providerConfigKey: string,
): Promise<NangoOAuth2IntegrationCredentials | null> {
  const integration = await getNangoIntegration(providerConfigKey);
  const credentials = integration?.credentials;

  if (!credentials || credentials.type !== "OAUTH2") {
    return null;
  }

  return {
    clientId: typeof credentials.client_id === "string" && credentials.client_id.trim() ? credentials.client_id.trim() : undefined,
    clientSecret:
      typeof credentials.client_secret === "string" && credentials.client_secret.trim() ? credentials.client_secret.trim() : undefined,
    scopes: typeof credentials.scopes === "string" && credentials.scopes.trim() ? credentials.scopes.trim() : undefined,
  };
}

/**
 * Google OAuth *client* credentials (clientId/clientSecret), resolved the SAME
 * way as `@cinatra-ai/google-oauth-connection`'s `getGoogleOAuthSettings`: the
 * Nango integration credentials are the source of truth, with the DB
 * `"google_oauth"` connector-config as a resilience fallback across Nango
 * restarts. Inlined here from nango's OWN exports so the connector's OAuth
 * connect UI no longer imports `@cinatra-ai/google-oauth-connection` (SDK-only
 * decouple). INVARIANT: this + `getGoogleOAuthSettings` must stay in
 * sync on the `"google_oauth"` config key and the Nango-first precedence.
 */
export async function getNangoGoogleOAuthClientCredentials(): Promise<{
  clientId?: string;
  clientSecret?: string;
}> {
  const nangoCredentials = await getNangoOAuth2IntegrationCredentials(
    CINATRA_NANGO_PROVIDER_CONFIG_KEYS.googleOAuth,
  );
  const stored = getNangoConfigStore().read<{ clientId?: string; clientSecret?: string }>(
    "google_oauth",
    {},
  );
  return {
    clientId: nangoCredentials?.clientId ?? stored.clientId,
    clientSecret: nangoCredentials?.clientSecret ?? stored.clientSecret,
  };
}

export async function ensureNangoIntegration(input: {
  provider: string;
  providerConfigKey: string;
  displayName: string;
  credentials?: IntegrationCredentials;
}) {
  if (!isNangoConfigured()) {
    return null;
  }

  const nango = getNangoClient();
  const integrations = await nango.listIntegrations();
  const existing = integrations.configs.find((integration) => integration.unique_key === input.providerConfigKey);

  const body = {
    provider: input.provider,
    unique_key: input.providerConfigKey,
    display_name: input.displayName,
    ...(input.credentials ? { credentials: input.credentials } : {}),
  };

  try {
    if (existing) {
      const updateBody = {
        display_name: input.displayName,
        ...(input.credentials ? { credentials: input.credentials } : {}),
      };

      try {
        await nango.updateIntegration({ uniqueKey: input.providerConfigKey }, updateBody);
      } catch (updateError) {
        const updateMessage = getNangoErrorMessage(updateError, "Unable to update the Nango integration.");

        if (!updateMessage.toLowerCase().includes("invalid input")) {
          throw updateError;
        }

        // Some Nango versions reject PATCH with display_name + credentials together.
        // Try updating credentials alone via a raw HTTP request as a fallback.
        if (input.credentials) {
          try {
            await nango.http.patch(
              `${nango.serverUrl}/integrations/${input.providerConfigKey}`,
              { credentials: input.credentials },
              { headers: { Authorization: `Bearer ${nango.secretKey}` } },
            );
            return input.providerConfigKey;
          } catch {
            // Credentials-only PATCH also failed; fall through to delete+recreate.
          }
        }

        const relatedConnectorKeys = getConnectorKeysForProviderConfigKey(input.providerConfigKey);
        const hasSavedConnections = relatedConnectorKeys.some((connectorKey) => listSavedNangoConnections(connectorKey).length > 0);

        if (!hasSavedConnections) {
          await nango.deleteIntegration(input.providerConfigKey).catch(() => null);
          await nango.createIntegration(body);
        }

        return input.providerConfigKey;
      }

      return input.providerConfigKey;
    }

    await nango.createIntegration(body);
    return input.providerConfigKey;
  } catch (error) {
    const message = getNangoErrorMessage(error, "Unable to configure the Nango integration.");

    if (message.toLowerCase().includes("unique key already exists") || message.toLowerCase().includes("invalid input")) {
      return input.providerConfigKey;
    }

    throw new Error(message);
  }
}

export async function importNangoConnection(input: {
  connectorKey?: NangoConnectorKey;
  providerConfigKey: string;
  connectionId: string;
  credentials: Omit<ApiKeyCredentials, "raw"> | Omit<BasicApiCredentials, "raw"> | Omit<OAuth2Credentials, "raw">;
  metadata?: Record<string, unknown>;
  connectionConfig?: Record<string, unknown>;
  endUser?: {
    id: string;
    email?: string;
    display_name?: string;
  };
  tags?: Record<string, string>;
}) {
  if (!isNangoConfigured()) {
    return null;
  }

  const nango = getNangoClient();
  const response = await nango.http.post(`${nango.serverUrl}/connections`, {
    provider_config_key: input.providerConfigKey,
    connection_id: input.connectionId,
    credentials: input.credentials,
    ...(input.metadata ? { metadata: input.metadata } : {}),
    ...(input.connectionConfig ? { connection_config: input.connectionConfig } : {}),
    ...(input.endUser ? { end_user: input.endUser } : {}),
    ...(input.tags ? { tags: input.tags } : {}),
  }, { headers: { Authorization: `Bearer ${nango.secretKey}` } });

  if (input.connectorKey) {
    // Schema-driven `multiple` lookup avoids silently overwriting
    // per-instance entries for multi-tenant connectors.
    // Dynamic import avoids the nango.ts ↔ nango-connectors.ts circular dep
    // that an eager top-level import would create.
    const { NANGO_CONNECTOR_DEFINITIONS } = await import("./nango-connectors");
    const multiple =
      NANGO_CONNECTOR_DEFINITIONS[input.connectorKey]?.multiple ?? false;
    await saveNangoConnectionRecord(
      input.connectorKey,
      {
        connectionId: input.connectionId,
        providerConfigKey: input.providerConfigKey,
        displayName: input.endUser?.display_name,
        email: input.endUser?.email,
        metadata: input.metadata,
      },
      { multiple },
    );
  }

  return response.data as unknown;
}

export async function getNangoConnection(
  providerConfigKey: string,
  connectionId: string,
  options?: {
    forceRefresh?: boolean;
    refreshToken?: boolean;
  },
) {
  if (!isNangoConfigured()) {
    return null;
  }

  const nango = getNangoClient();

  try {
    return await nango.getConnection(
      providerConfigKey,
      connectionId,
      options?.forceRefresh ?? false,
      options?.refreshToken ?? true,
    );
  } catch {
    return null;
  }
}

export async function getNangoCredentials(
  providerConfigKey: string,
  connectionId: string,
  options?: {
    forceRefresh?: boolean;
  },
) {
  if (!isNangoConfigured()) {
    return null;
  }

  const nango = getNangoClient();

  try {
    return await nango.getToken(providerConfigKey, connectionId, options?.forceRefresh ?? false);
  } catch {
    return null;
  }
}

/**
 * Delete a Nango integration entirely (provider config + the integration-level
 * credentials it stores). Idempotent; never throws past this boundary.
 *
 * Used by `clearTailscaleConnection` to scrub the OAuth client_secret from
 * Nango on Disconnect — without this, the integration credentials persist
 * after the operator clicks Disconnect, and the CLI can still read them
 * on the next `cinatra clone start`.
 */
export async function deleteNangoIntegration(providerConfigKey: string) {
  if (!isNangoConfigured()) {
    return;
  }
  const nango = getNangoClient();
  try {
    await nango.deleteIntegration(providerConfigKey);
  } catch {
    // Best-effort cleanup — the integration may already be gone, or the
    // operator may have removed it in the Nango admin console.
  }
}

export async function deleteNangoConnection(providerConfigKey: string, connectionId: string) {
  if (!isNangoConfigured()) {
    return;
  }

  const nango = getNangoClient();

  try {
    await nango.deleteConnection(providerConfigKey, connectionId);
  } catch {
    // Ignore missing connections so local clears still work.
  }
}

/**
 * AUTHORITATIVE connection delete (cinatra-ai/tailscale-connector#23, Design C).
 *
 * Unlike `deleteNangoConnection` (best-effort — swallows ALL errors so local
 * "clear" still works), this PROPAGATES a real failure. A `404` / already-gone
 * connection is the desired end state and resolves successfully (idempotent);
 * any other failure (5xx, network, 401/403) throws a SANITISED error so the
 * caller can retain its local pointer and report a failed disconnect rather than
 * falsely claim the stored credential was scrubbed while it lingers in Nango.
 *
 * Used by the Tailscale OAuth (TWO_STEP) disconnect, where the connection holds
 * the OAuth client secret. The error message never includes a secret or the raw
 * response body.
 */
export async function deleteNangoConnectionStrict(
  providerConfigKey: string,
  connectionId: string,
): Promise<void> {
  if (!isNangoConfigured()) {
    // Authoritative semantics: we CANNOT confirm the remote credential was
    // scrubbed when Nango is unreachable, so we must NOT report success (which
    // would let the caller falsely clear its pointer). Fail closed. (Contrast
    // the best-effort `deleteNangoConnection`, which returns here so local
    // clears still work.)
    throw new Error("The connection service (Nango) is not configured; cannot confirm the connection was deleted.");
  }

  const nango = getNangoClient();

  try {
    await nango.deleteConnection(providerConfigKey, connectionId);
  } catch (error) {
    const status =
      error && typeof error === "object"
        ? ((error as { response?: { status?: number } }).response?.status ??
          (error as { status?: number }).status)
        : undefined;
    // 404 / already-gone is success (idempotent).
    if (status === 404) {
      return;
    }
    throw new Error(getNangoErrorMessage(error, "Nango connection delete failed."));
  }
}
