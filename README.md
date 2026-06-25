# Connection Service

The centralized credential vault that the rest of your connectors quietly rely on. Configure it once and every other connector — Gmail, Calendar, GitHub, Apollo, LinkedIn, WordPress, YouTube, and the rest — can store its access tokens and API keys in one place, refresh them automatically, and hand them out at run time.

## Works with

- Gmail
- Google Calendar
- GitHub
- Apollo
- Apify
- Anthropic
- OpenAI
- LinkedIn
- WordPress
- Drupal
- YouTube
- Tailscale

## Capabilities

- Store every connector's credentials in one centralized vault
- Run OAuth sign-in flows for every supported integration through a single hosted UI
- Refresh tokens automatically so connectors stay live without manual reconnect
- Disconnect a saved account in one place when access should be revoked

---

## Purpose

`@cinatra-ai/nango-connector` is Cinatra's credential-vault layer, built on top of [Nango](https://www.nango.dev). It is a **leaf package** in the dependency graph — the LLM-orchestration layer depends on it, not the other way around.

Every connector that needs an API key, an OAuth token, or a per-site bearer token calls into this package rather than managing credentials itself. Concretely it:

- Owns the Nango REST/SDK client and wraps it with Cinatra-specific error handling.
- Maintains the connector registry (`NANGO_CONNECTOR_DEFINITIONS`) — a typed map from connector keys such as `gmail` or `drupal` to their Nango provider template, OAuth scopes, and Connect-UI settings.
- Provides a local pointer index (`connector_config:nango_connections`) so the host can list which accounts a workspace has connected without a live Nango round-trip.
- Exposes route handlers (`handleNangoConnectSessionRequest`, `handleNangoConnectionSaveRequest`, `handleNangoWebhookRequest`) that the host mounts on its `/api/nango/*` routes.
- Ships a server-only `register(ctx)` entry point so the host can activate the package as a Cinatra system extension.

## Install

This package is distributed as source and consumed as a workspace dependency via Cinatra's monorepo tooling. It is not published to npm separately.

In a local Cinatra workspace the package is already wired. To verify it is on the dependency graph:

```sh
pnpm --filter <your-package> ls @cinatra-ai/nango-connector
```

Peer dependencies required at the consumer level:

| Peer | Notes |
|---|---|
| `react`, `react-dom` | Required for the React UI components |
| `@cinatra-ai/sdk-extensions` | Optional — needed for the `requireExtensionAction` path |
| `@cinatra-ai/sdk-ui` | Optional — provides `NangoUserConnectButton` and related UI |

## Configuration

The connection service reads its runtime settings from two sources, in priority order:

1. **Environment variables** (highest priority):
   - `NANGO_SECRET_KEY` — the Nango secret key for server-side API calls.
   - `NANGO_SERVER_URL` — base URL of a self-hosted Nango instance (omit to use the Nango cloud default).
   - `NANGO_PUBLIC_CONNECT_URL` — override for the Nango Connect UI base URL (derived automatically from `NANGO_SERVER_URL` when not set).

2. **Database-persisted settings** (fallback): operators can save a secret key and server URL through the Cinatra setup wizard at `/configuration/environment?tab=connections`. The `saveNangoConnectionAction` server action (gated to `org_owner`/`org_admin`/`platform_admin`) writes these values to `connector_config:nango`.

**Checking configuration status**

`isNangoConfigured()` returns `true` when a non-empty `secretKey` is available from either source. `getNangoStatus()` returns a `{ status, detail }` object suitable for display in admin UIs.

### Supported connector keys

Each connected service is identified by a `NangoConnectorKey`. The full set is:

| Key | Service |
|---|---|
| `gmail` | Gmail |
| `googleCalendar` | Google Calendar |
| `googleOAuth` | Google OAuth (shared client for Gmail/Calendar/YouTube) |
| `github` | GitHub |
| `apollo` | Apollo API |
| `apify` | Apify |
| `claude` | Anthropic API |
| `gemini` | Gemini API |
| `openai` | OpenAI API |
| `linkedin` | LinkedIn |
| `wordpress` | WordPress (per site) |
| `drupal` | Drupal (per site) |
| `tailscale` | Tailscale (API-token mode) |
| `tailscaleOauth` | Tailscale (OAuth-client mode) |
| `a2aServer` | External A2A server |
| `youtube` | YouTube |

### Connect UI vs. first-party connectors

Connectors with `usesConnectUI: true` (for example `gmail`, `github`, `linkedin`) use the Nango-hosted OAuth flow launched from the Connect UI. Connectors with `usesConnectUI: false` (for example `apify`, `drupal`, `tailscale`) collect credentials through a Cinatra-native settings page and call `importNangoConnection` server-side — the Nango Connect UI is never involved.

### OAuth connectors that require app credentials first

Several OAuth connectors need the corresponding OAuth application registered in your Google, GitHub, or LinkedIn developer console before the Connect UI flow will work:

- **Gmail / Google Calendar / YouTube** — requires a Google OAuth client ID and secret saved at `/configuration/llm/gmail`.
- **GitHub** — requires a GitHub OAuth App client ID and secret.
- **LinkedIn** — requires a LinkedIn OAuth client ID and secret.

The `ensureNangoConnectorIntegration` call in the connect-session flow will throw a descriptive error if these are missing before any attempt to launch the Nango flow.

## Usage

### Reading credentials at run time (first-party connectors)

First-party connectors (Apify, Drupal, and similar) retrieve their API bearer token using `buildBearerAuthHeaderFromNango`:

```ts
import { buildBearerAuthHeaderFromNango } from "@cinatra-ai/nango-connector";

const header = await buildBearerAuthHeaderFromNango({
  providerConfigKey: "cinatra-apify",
  connectionId: "cinatra-apify",
  label: "apify",
});
// header is { Authorization: "Bearer <token>" } or null when unconfigured.
```

Returns `null` (never throws) when Nango is not configured, when the credential is missing, or when the resolved credential has no `apiKey`. A `console.warn` is emitted in those cases — the token itself is never logged.

### Listing and querying saved connections

```ts
import {
  listSavedNangoConnections,
  getPrimarySavedNangoConnection,
} from "@cinatra-ai/nango-connector";

// All saved connections for a connector key
const connections = listSavedNangoConnections("linkedin");

// The primary (first) saved connection at app scope
const primary = getPrimarySavedNangoConnection("gmail", { scope: "app" });
```

### Checking connection service status

```ts
import { isNangoConfigured, getNangoStatus } from "@cinatra-ai/nango-connector";

if (!isNangoConfigured()) {
  // prompt operator to configure Nango
}

const { status, detail } = getNangoStatus();
// status: "connected" | "not_connected"
```

### Route handler integration

The host mounts three handlers on its API routes:

```ts
import {
  handleNangoConnectSessionRequest,
  handleNangoConnectionSaveRequest,
  handleNangoWebhookRequest,
} from "@cinatra-ai/nango-connector";

// POST /api/nango/connect-session
export async function POST(req: Request) {
  const result = await handleNangoConnectSessionRequest(req, {
    userId: session.user.id,
    userEmail: session.user.email,
  });
  return Response.json(result.body, { status: result.status ?? 200 });
}
```

Expected inputs and outputs:

| Handler | Request body | Success response |
|---|---|---|
| `handleNangoConnectSessionRequest` | `{ connectorKey, scope?, reconnectConnectionId? }` | `{ sessionToken }` |
| `handleNangoConnectionSaveRequest` | `{ connectorKey, providerConfigKey, connectionId, siteUrl?, scope? }` | `{ success: true, connection }` |
| `handleNangoWebhookRequest` | Nango auth webhook body | `{ ok: true }` |

The connect-session and connection-save handlers return `{ status: 400, body: { error } }` on validation failure. The webhook handler always returns `{ ok: true }` regardless of outcome — internal save errors are swallowed so the Nango webhook delivery is never retried due to an application error.

### Failure modes

| Situation | Behaviour |
|---|---|
| `NANGO_SECRET_KEY` missing and no DB value | `isNangoConfigured()` returns `false`; all async methods return `null` or throw descriptively |
| Nango server unreachable | `getNangoCredentials`, `importNangoConnection`, etc. throw; first-party read paths return `null` |
| OAuth app credentials missing | `ensureNangoConnectorIntegration` throws with a message naming the missing value |
| Postgres timeout during cold boot | `getNangoSettings()` returns `{}` so `isNangoConfigured()` returns `false` (degraded, not crashed) |
| Connection not found in Nango | `getNangoConnection` returns `null`; `deleteNangoConnectionStrict` throws (fail-closed) |

## Development

### Running tests

```sh
pnpm --filter @cinatra-ai/nango-connector test
```

### Type-checking

```sh
pnpm typecheck
```

(Run from the repo root; covers all workspace packages.)

### Linting

```sh
pnpm --filter @cinatra-ai/nango-connector lint
```

### Adding a new connector key

1. Add the key to `NangoConnectorKey` in `src/nango.ts`.
2. Add a provider-config-key constant to `CINATRA_NANGO_PROVIDER_CONFIG_KEYS`.
3. Add a `NANGO_CONNECTOR_DEFINITIONS` entry in `src/nango-connectors.ts`.
4. Add an `ensureNangoConnectorIntegration` switch arm in `src/nango-connect-ui.ts`.
5. For single-tenant connectors, add a connection-id constant to `CINATRA_NANGO_CONNECTION_IDS`; for multi-instance ones, set `multiple: true` and use a per-instance UUID as the connection id.
6. For first-party connectors (`usesConnectUI: false`), follow the readback-safe save pattern: `isNangoConfigured()` → validate credential → `ensureNangoConnectorIntegration` → `importNangoConnection` (without `connectorKey`) → `getNangoCredentials` readback assertion → persist the pointer row → `saveNangoConnectionRecord`.

### Dependency direction

This package is a **leaf**. It must never import from `@cinatra-ai/llm` or any LLM-orchestration package — doing so creates a dependency cycle. The invariant is enforced by `src/__tests__/dependency-direction.test.ts`; do not weaken or delete that test.

## Troubleshooting

**"Configure the connection administration first."**
Nango is not configured. Set `NANGO_SECRET_KEY` in the environment or save the secret key through the Cinatra connection settings at `/configuration/environment?tab=connections`.

**"Save the Google OAuth client ID and client secret first."**
The Gmail, Google Calendar, or YouTube Connect UI flow requires a Google OAuth application. Save the client credentials at `/configuration/llm/gmail` before starting the OAuth flow.

**"Unable to load the Nango connection details."**
The connection ID returned by the Connect UI could not be verified in Nango (it may have been deleted or belongs to a different Nango environment). Start the OAuth flow again.

**`deleteNangoConnectionStrict` throws when Nango is not configured**
By design. This variant is used when the caller must confirm the remote credential was scrubbed (for example, Tailscale OAuth-client disconnect). Use the best-effort `deleteNangoConnection` if a silent no-op when Nango is absent is acceptable.

**Connect UI shows the Nango watermark**
The watermark suppression is applied automatically when `saveNangoSettings` is called. If it reappears, verify the Nango plan supports `showWatermark: false` and that the server URL in settings points to the correct Nango environment.
