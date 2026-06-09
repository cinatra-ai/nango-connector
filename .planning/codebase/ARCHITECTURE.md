<!-- refreshed: 2026-06-09 -->
# Architecture

**Analysis Date:** 2026-06-09

## System Overview

```text
┌──────────────────────────────────────────────────────────────────┐
│                    Host Application (Next.js)                     │
│          imports @cinatra-ai/nango-connector via src/index.ts     │
└───────┬──────────────────┬────────────────────┬───────────────────┘
        │                  │                    │
        ▼                  ▼                    ▼
┌───────────────┐ ┌──────────────────┐ ┌───────────────────────────┐
│  Route Layer  │ │   Action Layer   │ │     UI / Page Layer       │
│route-handlers │ │   actions.ts     │ │ pages/nango-settings-page  │
│    .ts        │ │ (Next.js Server  │ │ nango-operations-card.tsx  │
│               │ │  Action)         │ │ components/ui/*            │
└───────┬───────┘ └───────┬──────────┘ └───────────────────────────┘
        │                  │
        ▼                  ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Connect-UI Orchestration Layer                  │
│                      nango-connect-ui.ts                          │
│  (session creation, integration provisioning, connection saving)  │
└──────────────┬───────────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────────┐
│                        Core Nango Layer                           │
│                          nango.ts                                 │
│  (settings CRUD, connection CRUD, Nango SDK client factory)       │
└──────────────┬────────────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────────┐
│           @nangohq/node SDK  ←→  Nango API / Self-Hosted Server   │
└──────────────────────────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────────┐
│    @/lib/database  (host-side connector-config persistence)       │
│  readConnectorConfigFromDatabase / writeConnectorConfigToDatabase │
└──────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Public API surface | Re-exports all public symbols; IoC entry point | `src/index.ts` |
| Core Nango layer | Settings CRUD, connection CRUD, Nango SDK client factory, legacy-key migration, token resolution | `src/nango.ts` |
| Connector registry | Static definitions (title, providerConfigKey, `usesConnectUI`, `multiple`) for all 15 connectors | `src/nango-connectors.ts` |
| Connect-UI orchestration | Session creation, per-connector integration provisioning, save-connection gating | `src/nango-connect-ui.ts` |
| Route handlers | Framework-agnostic async handlers for session-create, connection-save, and webhook endpoints | `src/route-handlers.ts` |
| Server action | Next.js `"use server"` action for saving Nango settings via the setup wizard form | `src/actions.ts` |
| First-party MCP helper | Bearer-auth-header builder for API-key-style connectors (Apify, Drupal, A2A) | `src/first-party-mcp.ts` |
| Settings page | React Server Component settings form for Nango secret key + server URL | `src/pages/nango-settings-page.tsx` |
| Operations card | Status badge + dashboard-link card rendered on the admin configuration page | `src/nango-operations-card.tsx` |
| UI primitives | Headless UI components (Button, Input, Card, Field, Label, Alert, Textarea, Separator) | `src/components/ui/` |

## Pattern Overview

**Overall:** Layered connector library (leaf package) with IoC-decoupled public surface

**Key Characteristics:**
- This package is a **leaf** — it explicitly must NOT depend on `@cinatra-ai/llm`. This invariant is enforced by `src/__tests__/dependency-direction.test.ts`.
- All public symbols are aggregated via `src/index.ts` using selective re-exports (avoids name collisions with the SDK-UI re-exports).
- Connector definitions are static schema (`NANGO_CONNECTOR_DEFINITIONS`); behaviour is driven off `usesConnectUI` and `multiple` flags.
- Settings and connection records are persisted via a host-provided `@/lib/database` abstraction, not owned by this package.
- The connect-UI flow is **gated**: `createNangoConnectSession` and `saveNangoConnectorConnection` both check `definition.usesConnectUI` and `definition.providerConfigKey` before touching the Nango API.

## Layers

**Public Surface Layer:**
- Purpose: Aggregates all exports for host applications
- Location: `src/index.ts`
- Contains: Re-exports from all sub-modules, explicit named re-exports for back-compat
- Depends on: All other layers
- Used by: Host application (`@cinatra-ai/connectors` hub, Next.js routes)

**Route Handler Layer:**
- Purpose: Provide framework-agnostic HTTP request handlers the host can wire to any route
- Location: `src/route-handlers.ts`
- Contains: `handleNangoConnectSessionRequest`, `handleNangoConnectionSaveRequest`, `handleNangoWebhookRequest`
- Depends on: `nango-connect-ui.ts`, Zod schemas
- Used by: Host Next.js API routes

**Server Action Layer:**
- Purpose: Next.js `"use server"` action for settings form
- Location: `src/actions.ts`
- Contains: `saveNangoConnectionAction` (form-data → `saveNangoSettings` → redirect)
- Depends on: `nango.ts`, `@cinatra-ai/sdk-extensions` (auth gate)
- Used by: `src/index.ts` re-export, host settings pages

**Connect-UI Orchestration Layer:**
- Purpose: Coordinate the Nango Connect UI flow end-to-end
- Location: `src/nango-connect-ui.ts`
- Contains: `ensureNangoConnectorIntegration`, `createNangoConnectSession`, `saveNangoConnectorConnection`
- Depends on: `nango.ts`, `nango-connectors.ts`, host `@/lib/*` APIs (GitHub, LinkedIn, WordPress)
- Used by: `route-handlers.ts`

**Core Nango Layer:**
- Purpose: All low-level Nango operations and local connection store
- Location: `src/nango.ts`
- Contains: Settings read/write, connection record CRUD, Nango SDK client factory, legacy-key migration, token resolution, integration management
- Depends on: `@nangohq/node`, `@/lib/database` (host)
- Used by: `nango-connect-ui.ts`, `actions.ts`, `first-party-mcp.ts`, UI components

**Connector Registry:**
- Purpose: Static schema describing all supported integrations
- Location: `src/nango-connectors.ts`
- Contains: `NANGO_CONNECTOR_DEFINITIONS` record (15 entries), `NangoConnectorDefinition` type
- Depends on: `nango.ts` (for `CINATRA_NANGO_PROVIDER_CONFIG_KEYS`)
- Used by: `nango-connect-ui.ts`, `route-handlers.ts`

**First-Party MCP Helper:**
- Purpose: Extract Bearer auth headers from Nango credentials for API-key-style connectors without coupling to `@cinatra-ai/llm`
- Location: `src/first-party-mcp.ts`
- Contains: `buildBearerAuthHeaderFromNango`
- Depends on: `nango.ts` only
- Used by: Per-connector MCP tool builders in the host

**UI/Page Layer:**
- Purpose: React components for the Nango configuration UI
- Location: `src/pages/`, `src/nango-operations-card.tsx`, `src/components/ui/`
- Contains: `NangoSettingsPage`, `NangoOperationsCard`, headless UI primitives
- Depends on: `nango.ts`, `actions.ts`, Radix UI primitives, Tailwind utilities
- Used by: Host Next.js page routes

## Data Flow

### Connect-UI OAuth Flow

1. Host API route receives POST → delegates to `handleNangoConnectSessionRequest` (`src/route-handlers.ts:38`)
2. Handler validates body via Zod schema, calls `createNangoConnectSession` (`src/nango-connect-ui.ts:230`)
3. Session creator calls `ensureNangoConnectorIntegration` to upsert the Nango integration with credentials (`src/nango-connect-ui.ts:49`)
4. Nango SDK `createConnectSession` returns a session token sent to the browser (`src/nango-connect-ui.ts:259`)
5. Browser runs `@nangohq/frontend` Connect UI; on success POSTs connection details back to host
6. Host API route calls `handleNangoConnectionSaveRequest` → `saveNangoConnectorConnection` (`src/nango-connect-ui.ts:281`)
7. Connection is verified against Nango API, then written to local store via `saveNangoConnectionRecord` (`src/nango.ts:409`)

### Settings Save Flow

1. User submits Nango settings form → `saveNangoConnectionAction` (`src/actions.ts:32`)
2. Action calls `requireExtensionAction` (auth gate), then `saveNangoSettings` (`src/nango.ts:230`)
3. `saveNangoSettings` writes to `@/lib/database` under the `"nango"` connector-config key
4. Best-effort: `applyNangoConnectUINoWatermark` is called on the Nango API to disable the Connect UI watermark

### First-Party API-Key Flow (Apify, Drupal, A2A)

1. Caller invokes `buildBearerAuthHeaderFromNango` with `providerConfigKey` + `connectionId` (`src/first-party-mcp.ts:27`)
2. Helper reads `isNangoConfigured()`, calls `getNangoCredentials` (`src/nango.ts:765`)
3. Returns `{ Authorization: "Bearer <apiKey>" }` or `null` — never an MCP tool type

**State Management:**
- Nango settings (secretKey, serverUrl) persisted in the host database under connector-config key `"nango"` via `@/lib/database`
- Connection records persisted under connector-config key `"nango_connections"` as a JSON `NangoConnectionStore`
- Legacy dead key `"nango_connection"` is purged (never read) on first `readStoredNangoSettings` call
- Environment variables `NANGO_SECRET_KEY` and `NANGO_SERVER_URL` override database values at read time

## Key Abstractions

**NangoConnectorKey:**
- Purpose: Union type identifying all supported integrations
- Examples: `"github"`, `"gmail"`, `"linkedin"`, `"a2aServer"`, `"drupal"`
- Pattern: String literal union defined in `src/nango.ts:14`; used as record key throughout

**NangoConnectorDefinition:**
- Purpose: Schema record per connector describing auth mode, UI flags, and routing
- Examples: `NANGO_CONNECTOR_DEFINITIONS` in `src/nango-connectors.ts:17`
- Pattern: `usesConnectUI: boolean` gates the Connect UI path; `multiple: boolean` controls deduplication in the connection store

**NangoConnectionStore:**
- Purpose: Local database record of all saved connections, keyed by `NangoConnectorKey`
- Pattern: Read/written as a single JSON blob via `readStoredNangoConnections` / `writeStoredNangoConnections` in `src/nango.ts`

**SavedNangoConnection:**
- Purpose: Per-connection metadata record (connectionId, providerConfigKey, scope, userId, email, metadata)
- Pattern: Supports `scope: "app" | "user"` for per-user vs workspace-level connections; `userId` only set for user-scope

## Entry Points

**`src/index.ts`:**
- Location: `src/index.ts`
- Triggers: Imported by host via `import { ... } from "@cinatra-ai/nango-connector"`
- Responsibilities: Aggregate all public exports; selective named re-exports for back-compat with SDK-UI

**Route Handlers:**
- Location: `src/route-handlers.ts`
- Triggers: Host wires `handleNangoConnectSessionRequest`, `handleNangoConnectionSaveRequest`, `handleNangoWebhookRequest` to Next.js API routes
- Responsibilities: Request validation (Zod), delegation to connect-UI layer, uniform `RouteResult` return shape

**Server Action:**
- Location: `src/actions.ts`
- Triggers: Next.js form `action={saveNangoConnectionAction}` in `src/pages/nango-settings-page.tsx`
- Responsibilities: Auth gate, settings persistence, redirect

## Architectural Constraints

- **Leaf package:** Must never import `@cinatra-ai/llm`. Enforced mechanically by `src/__tests__/dependency-direction.test.ts`.
- **Host-side database abstraction:** `@/lib/database` is a path alias resolved by the host application. This package does not own or bundle the database client.
- **Circular import prevention:** `importNangoConnection` in `src/nango.ts` uses a dynamic `import("./nango-connectors")` to avoid a static circular dependency between `nango.ts` ↔ `nango-connectors.ts`.
- **SDK-UI peer dependency:** `NangoUserConnectButton`, `NangoUserConnectCard`, `NangoManagedApiCard` are re-exported from `@cinatra-ai/sdk-ui/nango` (peer dep, optional). Named re-export in `src/index.ts` prevents collision with this package's own `NangoFrontendConfig` type.
- **Cold-boot resilience:** `readStoredNangoSettings` catches Postgres timeout errors and returns `{}` (empty settings), allowing server startup without crashing all routes.
- **Global state:** `legacyNangoKeyPurged` module-level boolean in `src/nango.ts` acts as a one-shot latch for the legacy key migration.

## Anti-Patterns

### Importing `@cinatra-ai/llm` from this package

**What happens:** A developer adds an MCP tool type directly to `first-party-mcp.ts` or another file in this package.
**Why it's wrong:** Breaks the leaf-package invariant; creates coupling between credential management and LLM orchestration; blocked by `src/__tests__/dependency-direction.test.ts`.
**Do this instead:** Return only `{ Authorization: string }` from `buildBearerAuthHeaderFromNango` (`src/first-party-mcp.ts`). Construct `LlmMcpServerTool` in the per-connector builder inside the host.

### Writing to the legacy `"nango_connection"` connector-config key

**What happens:** A developer resumes writing Nango settings to `"nango_connection"` (the old dead key).
**Why it's wrong:** No reader ever consumes that key; `purgeLegacyNangoConnectionConfig` in `src/nango.ts` deletes it on every read cycle. Promoting its values would be a security risk (untrusted, ungated writer).
**Do this instead:** Write settings only to the `"nango"` key via `saveNangoSettings` in `src/nango.ts:230`.

### Bypassing `usesConnectUI` gate in `saveNangoConnectorConnection`

**What happens:** A developer removes or skips the `!definition.usesConnectUI` guard in `src/nango-connect-ui.ts:300`.
**Why it's wrong:** Allows an unverified pointer record to be written for connectors that manage their own auth flow (Apify, Drupal, Tailscale, Gemini), bypassing the readback chain in those connectors' save flows.
**Do this instead:** Always guard with `if (!definition.usesConnectUI) throw` before calling `saveNangoConnectionRecord`.

## Error Handling

**Strategy:** Fail-closed with graceful degradation on cold-boot database timeouts.

**Patterns:**
- `isNangoConfigured()` checks before every Nango API call; returns `null` instead of throwing when Nango is not set up.
- `getNangoClient()` throws with a human-readable message when `secretKey` is absent.
- `getNangoConnection` and `getNangoCredentials` catch all SDK errors and return `null` (callers decide what to do).
- Route handlers return `{ status: 400, body: { error: message } }` on validation or orchestration failures.
- `ensureNangoIntegration` handles "unique key already exists" and "invalid input" SDK errors idempotently.
- `buildBearerAuthHeaderFromNango` swallows credential-lookup errors and logs via `console.warn` (never the token).

## Cross-Cutting Concerns

**Logging:** `console.warn` only, in `src/first-party-mcp.ts`. No structured logger — log lines include a `[first-party-mcp]` prefix and the human-readable `label` param, never the credential value.
**Validation:** Zod schemas in `src/route-handlers.ts` for all inbound HTTP bodies. TypeScript `satisfies` constraints on `writeConnectorConfigToDatabase` call sites.
**Authentication:** `requireExtensionAction("@cinatra-ai/nango-connector", "manage")` in `src/actions.ts` gates the settings save action to `org_owner`, `org_admin`, and `platform_admin` roles. User-scoped connect-session creation checks for `userId` presence before creating a session.

---

*Architecture analysis: 2026-06-09*
