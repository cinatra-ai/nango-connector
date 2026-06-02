# connector-nango — AGENTS.md

Package-specific guidance for `@cinatra-ai/connector-nango`. Read alongside the repo-root `AGENTS.md`.

## Package role

The Nango credential-vault wrapper. Owns the Nango REST/SDK client, the connector→integration registry (`NANGO_CONNECTOR_DEFINITIONS`), provider-config-key + connection-id constants, the local `connector_config:nango_connections` pointer index, and the `ensureNangoConnectorIntegration` switch (one arm per connector key, mapping it to its upstream Nango template — e.g. `apify`, `private-api-bearer`, `google-mail`).

## This package is a LEAF (load-bearing invariant)

`connector-nango` MUST NOT depend on `@cinatra-ai/llm`. The dep arrow runs `llm-orchestration → connector-openai`/`connector-nango`, never the reverse — adding an orchestration dep here creates a cycle (see `feedback_llm_orchestration_connector_openai_dep_direction` / the broader memory). This is why `buildBearerAuthHeaderFromNango` (`src/first-party-mcp.ts`) returns a bare `{ Authorization }` shape and **deliberately does NOT construct an `LlmMcpServerTool`** — tool construction stays in the app-layer `src/lib/<x>-mcp-connection.ts` builders that DO depend on orchestration. The invariant is mechanically enforced by `src/__tests__/dependency-direction.test.ts` (asserts package.json has no orchestration dep + `first-party-mcp.ts` imports only `./nango` + no source import statement references llm-orchestration). Do not weaken or delete that test.

## First-party-connector vault pattern

When a first-party connector needs its credential vaulted in Nango, follow the locked shape (Apify + Drupal are the reference implementations):

1. **Registry**: add the connector key to `NangoConnectorKey`, `CINATRA_NANGO_PROVIDER_CONFIG_KEYS`, `EMPTY_NANGO_CONNECTION_STORE`, a `NANGO_CONNECTOR_DEFINITIONS` entry (`usesConnectUI: false` — Nango Connect UI is never used for first-party connectors; the cinatra-native settings page collects the credential), and an `ensureNangoConnectorIntegration` switch arm. Single-tenant connectors also get a `CINATRA_NANGO_CONNECTION_IDS` constant; multi-instance ones use a per-instance UUID as the connection id and set `multiple: true`.
2. **Save flow** (readback-safe): `isNangoConfigured()` check first (fail-closed loud) → validate the credential against the upstream API → `ensureNangoConnectorIntegration(key)` → `importNangoConnection({ providerConfigKey, connectionId, credentials })` **WITHOUT `connectorKey`** → `getNangoCredentials(providerConfigKey, connectionId, { forceRefresh: true })` and assert the readback equals the input (generic error on mismatch — never echo the token) → persist the cinatra-DB pointer row (`nangoConnectionId`, no plaintext) → **then** call `saveNangoConnectionRecord(key, record, { multiple })` separately.
3. **MCP delivery**: a first-party builder in `src/lib/<x>-mcp-connection.ts` calls `buildBearerAuthHeaderFromNango` and constructs the `LlmMcpServerTool` with a clean URL + the resolved `Authorization` header. Never put the token in the URL.

## `importNangoConnection` `multiple`-flag gotcha

`importNangoConnection({ connectorKey, ... })` infers `multiple` from `NANGO_CONNECTOR_DEFINITIONS[connectorKey]?.multiple` and internally calls `saveNangoConnectionRecord`. **But the readback-safe save pattern calls `importNangoConnection` WITHOUT `connectorKey`** (so the local pointer is not written before the readback verification), which bypasses that inference entirely. You then call `saveNangoConnectionRecord` yourself — and it defaults to `multiple: false`. For any multi-instance connector (Drupal, LinkedIn, WordPress, a2aServer) you MUST pass an explicit `{ multiple: true }` as the third arg, or saving/rotating one instance silently replaces every saved pointer for that connector. Test-lock the explicit arg. See `feedback_nango_import_multiple_flag_bypass`.

## Files

| File | Role |
|---|---|
| `src/nango.ts` | Nango client, settings, `importNangoConnection`/`getNangoCredentials`/`saveNangoConnectionRecord`/`deleteNangoConnection`, key/id constants, `NangoConnectorKey` union |
| `src/nango-connectors.ts` | `NANGO_CONNECTOR_DEFINITIONS` (one entry per connector key) |
| `src/nango-connect-ui.ts` | `ensureNangoConnectorIntegration` switch — connector key → upstream Nango provider template |
| `src/first-party-mcp.ts` | `buildBearerAuthHeaderFromNango` — Nango connection → `{ Authorization }` (LEAF; no orchestration dep) |
| `src/__tests__/dependency-direction.test.ts` | LEAF-invariant enforcement — do not weaken |

## Validation

`pnpm --filter @cinatra-ai/connector-nango test` then `pnpm typecheck` (repo root). The dependency-direction test must stay green.
