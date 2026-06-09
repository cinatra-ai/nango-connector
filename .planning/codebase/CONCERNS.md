# Codebase Concerns

**Analysis Date:** 2026-06-09

## Tech Debt

**`importNangoConnection` multiple-flag bypass in readback-safe save pattern:**
- Issue: `importNangoConnection` with `connectorKey` infers `multiple` from `NANGO_CONNECTOR_DEFINITIONS`. But the canonical readback-safe save pattern calls `importNangoConnection` *without* `connectorKey` (to skip local pointer write before readback). After readback, `saveNangoConnectionRecord` is called manually, but it defaults to `multiple: false`. Any multi-instance connector (Drupal, LinkedIn, WordPress, a2aServer) that follows the readback-safe pattern and omits an explicit `{ multiple: true }` in the third arg to `saveNangoConnectionRecord` will silently overwrite all saved connection pointers for that connector.
- Files: `src/nango.ts` (`importNangoConnection`, `saveNangoConnectionRecord`)
- Impact: Saving or rotating one Drupal/LinkedIn/WordPress/a2aServer instance silently replaces every saved pointer for that connector key. Data loss in multi-tenant scenarios.
- Fix approach: AGENTS.md documents the invariant explicitly (pass `{ multiple: true }` always for multi-instance connectors). Add a test that locks the explicit arg call at the save site for each multi-instance connector.

**`applyNangoConnectUINoWatermark` uses internal SDK properties via type assertions:**
- Issue: At lines 255–256 in `src/nango.ts`, `nango.serverUrl` and `nango.secretKey` are accessed with `as string` casts. These are non-public Nango SDK properties. If `@nangohq/node` changes its internal structure, these casts will compile successfully but fail at runtime.
- Files: `src/nango.ts` (lines 255–256, 649–651, 705–713)
- Impact: Silent runtime failures on Nango SDK upgrades. Multiple raw HTTP call sites (`importNangoConnection`, `ensureNangoIntegration` fallback path, `applyNangoConnectUINoWatermark`) all depend on `nango.serverUrl` / `nango.secretKey` being accessible properties.
- Fix approach: Derive `serverUrl` and `secretKey` from the locally resolved `NangoSettings` object at each call site rather than reading them back off the Nango SDK instance.

**`ensureNangoConnectorIntegration` is an unbounded switch with no default:**
- Issue: `src/nango-connect-ui.ts` has a 15-arm switch on `connectorKey` with no `default` clause. TypeScript's exhaustiveness checking only helps if the switch is inside a function that the compiler knows must return. Adding a new `NangoConnectorKey` variant without adding a matching switch arm silently falls through (returns `undefined`), breaking integration setup for the new connector.
- Files: `src/nango-connect-ui.ts` (lines 53–228)
- Impact: New connectors added to `NangoConnectorKey` and `NANGO_CONNECTOR_DEFINITIONS` may silently skip `ensureNangoIntegration`, so `createNangoConnectSession` calls succeed but no Nango integration exists on the server side.
- Fix approach: Add a TypeScript exhaustiveness check (`const _never: never = connectorKey; throw new Error(...)`) as the switch default arm, or return `never` so the compiler enforces coverage.

**`CINATRA_NANGO_CONNECTION_IDS` is incomplete (missing linkedin, a2aServer, gemini entries):**
- Issue: `src/nango.ts` defines `CINATRA_NANGO_CONNECTION_IDS` for most connectors, but `linkedin` and `a2aServer` are absent (per-instance UUID is used instead). `gemini` is also absent (Gemini uses a cinatra-native path). The asymmetry between `CINATRA_NANGO_PROVIDER_CONFIG_KEYS` (15 entries) and `CINATRA_NANGO_CONNECTION_IDS` (12 entries) can cause confusion for callers that assume a symmetric shape.
- Files: `src/nango.ts` (lines 70–86)
- Impact: Callers who look up connection IDs from the constants map for multi-instance connectors will find nothing, and must know to generate per-instance IDs out-of-band.
- Fix approach: Document the asymmetry explicitly (a type-level comment explaining multi-instance connectors do not have a fixed connection ID), or use a discriminated union.

**`nangoConnectSessionSchema` and `nangoConnectionSaveSchema` in `route-handlers.ts` manually list allowed connectors:**
- Issue: `src/route-handlers.ts` contains two Zod `z.enum(...)` schemas that manually list the subset of connector keys accepted at the HTTP layer (lines 15–16, 21–22). This list is duplicated and will drift from `NANGO_CONNECTOR_DEFINITIONS` as connectors are added/removed. `gemini` is absent from session-create but present in save; `tailscale`, `apify`, `drupal`, `a2aServer` are absent from both.
- Files: `src/route-handlers.ts` (lines 14–26)
- Impact: Adding a new Connect-UI-enabled connector requires updating two separate locations (`NANGO_CONNECTOR_DEFINITIONS` and both route-handler schemas) — an easy miss.
- Fix approach: Derive the Zod enum from `NANGO_CONNECTOR_DEFINITIONS` at runtime (filter `usesConnectUI === true` keys and build the enum dynamically), eliminating the manual list.

**`legacyNangoKeyPurged` is a module-level mutable singleton:**
- Issue: `src/nango.ts` line 153 declares `let legacyNangoKeyPurged = false` at module scope. In Next.js App Router with Turbopack's parallel worker threads, each worker compiles its own module instance, so the latch is per-worker (not process-wide). The migration comment acknowledges this will retry on a later request (acceptable), but the in-memory singleton pattern is fragile and will be reset after any hot-reload or serverless cold start.
- Files: `src/nango.ts` (lines 152–153, 155–167)
- Impact: The legacy key deletion is idempotent (safe to re-run), so this is low risk. However, the pattern of relying on module-scope singletons for one-time operations is a footgun for future similar patterns.
- Fix approach: No urgent change needed (intentional and documented). Document the pattern limitation in a code comment so future developers do not assume module-scope state is process-wide.

## Known Bugs

**`saveNangoSettings` cannot clear an existing `secretKey` or `serverUrl`:**
- Symptoms: If an operator wants to unset a previously saved `secretKey` (reset Nango configuration), passing an empty or omitted `secretKey` to `saveNangoSettings` falls back to `current.secretKey` via the `||` operator, so the old value is retained. There is no way to explicitly clear a stored key through the settings form.
- Files: `src/nango.ts` (lines 231–236), `src/actions.ts` (lines 43–46)
- Trigger: Operator submits the settings form with an empty `secretKey` field intending to disconnect Nango.
- Workaround: None via the UI. A developer could delete the DB row directly.

**`handleNangoWebhookRequest` silently drops webhook events for unrecognized `providerConfigKey`:**
- Symptoms: If Nango fires an auth webhook for a provider config key not in `NANGO_CONNECTOR_DEFINITIONS`, the event is silently acknowledged with `{ ok: true }` and no record is saved. This can mask misconfiguration (e.g. a Nango integration with a typo in its key).
- Files: `src/route-handlers.ts` (lines 97–99)
- Trigger: Nango fires a webhook for an integration not registered in the connector definitions.
- Workaround: No workaround; the event is lost without any log or error.

## Security Considerations

**`nango.secretKey` referenced directly off SDK instance (raw Bearer token in raw HTTP calls):**
- Risk: Multiple raw HTTP calls in `src/nango.ts` construct `Authorization: Bearer ${nango.secretKey}` headers inline (lines 256, 651, 713). If `nango.secretKey` is ever undefined (e.g. the SDK changes its property name), the header becomes `Bearer undefined`, which would silently fail authentication rather than throwing an error.
- Files: `src/nango.ts` (lines 255–257, 649–651, 705–714)
- Current mitigation: `getNangoClient()` throws before returning if `secretKey` is empty, so the Nango instance should always have a key. The `as string` casts suppress the undefined risk.
- Recommendations: Assert `nango.secretKey` is a non-empty string immediately after constructing the client (or pass the resolved settings alongside the client to avoid reading internal SDK properties).

**Webhook endpoint has no signature verification:**
- Risk: `handleNangoWebhookRequest` in `src/route-handlers.ts` accepts any POST body claiming to be a Nango auth webhook, verifies only `body.type === "auth"` and `body.success === true`, then writes a connection record. A malicious actor with network access to the webhook URL could forge a connection save for any provider config key registered in `NANGO_CONNECTOR_DEFINITIONS`.
- Files: `src/route-handlers.ts` (lines 90–113)
- Current mitigation: Partial — only connectors with `usesConnectUI: true` proceed past the `saveNangoConnectorConnection` gate; the gate also checks that the connection exists in Nango via `getNangoConnection`. An attacker would need a real Nango connection ID.
- Recommendations: Verify the Nango webhook HMAC signature (`X-Nango-Signature` header using the secret key) before processing the body. Nango provides a webhook secret for this purpose.

**`redirectTo` parameter in `saveNangoConnectionAction` is accepted from user input without an allowlist:**
- Risk: `src/actions.ts` line 39 reads `redirectTo` from the submitted form data and uses it directly in `redirect(redirectTo)`. If the host validates redirects at a higher layer, this is safe; if not, it is an open redirect.
- Files: `src/actions.ts` (lines 29, 39, 50)
- Current mitigation: The action is gated by `requireExtensionAction("manage")` (org_owner/org_admin only), reducing exposure to privileged users only.
- Recommendations: Restrict `redirectTo` to same-origin paths (assert it starts with `/` and contains no `://`).

## Performance Bottlenecks

**`ensureNangoIntegration` makes two round-trips (list + update/create) on every integration setup:**
- Problem: `ensureNangoIntegration` calls `nango.listIntegrations()` (fetches all integrations) then conditionally calls `updateIntegration` or `createIntegration`. For workspaces with many integrations, `listIntegrations()` fetches all of them just to find one by key.
- Files: `src/nango.ts` (lines 607–684)
- Cause: The Nango SDK does not expose a single-integration upsert; `getIntegration` is available but the code uses the list approach. The fallback PATCH path adds a third round-trip.
- Improvement path: Use `getNangoIntegration(providerConfigKey)` (already defined at line 543) instead of `nango.listIntegrations()` to do a targeted single-integration GET before deciding whether to create or update.

**`getNangoSettings()` is called multiple times per request without caching:**
- Problem: `getNangoSettings()` calls `readStoredNangoSettings()`, which calls `readConnectorConfigFromDatabase()` (a synchronous Postgres/SQLite read) on every call. Multiple places call `getNangoSettings()` within a single request path (e.g. `isNangoConfigured()`, `getNangoStatus()`, `getNangoFrontendConfig()` each call it independently).
- Files: `src/nango.ts` (lines 215–228, 278–281, 283–297, 299–325)
- Cause: No request-scoped memoization.
- Improvement path: Memoize `readStoredNangoSettings()` with a short-lived cache (e.g. 1-second TTL or per-request cache using `React.cache` if in a Server Component context).

## Fragile Areas

**`applyNangoConnectUINoWatermark` uses internal Nango HTTP client and unpublished API path:**
- Files: `src/nango.ts` (lines 254–276)
- Why fragile: Calls `/api/v1/connect-ui-administration?env=prod` — an undocumented internal Nango API endpoint — via `nango.http` (the SDK's internal Axios instance). Both the endpoint path and `nango.http` exposure could change in any `@nangohq/node` minor release.
- Safe modification: Always wrap in try/catch (already done). Before upgrading `@nangohq/node`, check if `nango.http` is still accessible and the endpoint is unchanged.
- Test coverage: No test covers this function. Failures are fully silent (catch-and-ignore).

**`ensureNangoConnectorIntegration` fallback delete+recreate path can destroy existing connections:**
- Files: `src/nango-connect-ui.ts` (lines 659–664)
- Why fragile: When a PATCH update fails with "invalid input" AND credentials-only PATCH also fails, the code deletes the integration (only if `hasSavedConnections === false`) and recreates it. The `hasSavedConnections` guard checks the local pointer store (`listSavedNangoConnections`), which may be stale if connection records were cleared without removing the Nango integration. A stale empty local store + update failure would trigger integration deletion even when live Nango connections exist.
- Safe modification: Treat delete+recreate as a last resort and log a warning before executing it. Do not rely solely on the local pointer store — query Nango directly for existing connections before deleting.
- Test coverage: Not tested.

**`createNangoConnectSession` uses `"cinatra-local-user"` as a hardcoded end-user ID for app-scope sessions:**
- Files: `src/nango-connect-ui.ts` (lines 261–263)
- Why fragile: All app-scope Nango connect sessions share the same `end_user.id = "cinatra-local-user"`. If Nango introduces per-user rate limits or session isolation keyed on `end_user.id`, all app-scope flows will collide. Also, if a user-scope session is started and then an app-scope session is started for the same integration, they will have distinct end_user records in Nango, which may cause confusion in the Nango dashboard.
- Safe modification: This is intentional for now. Document the known limitation.

## Scaling Limits

**Local `connector_config:nango_connections` JSON store is a single serialized blob:**
- Current capacity: All saved Nango connection records for all connector keys are stored as a single JSON object in one database row (`nango_connections` connector-config key).
- Limit: As the number of multi-instance connectors grows (linkedin, wordpress, drupal, a2aServer all support `multiple: true`), every `saveNangoConnectionRecord` or `removeNangoConnectionRecord` call reads the entire blob, mutates it in memory, and writes it back. Under concurrent requests, last-write-wins can silently drop connection records.
- Scaling path: Normalize connection records into a dedicated table with one row per connection, keyed by `(connectorKey, connectionId, scope, userId)`. This also enables proper atomic upsert/delete.

## Dependencies at Risk

**`@nangohq/node` and `@nangohq/frontend` pinned to `^0.70.3`:**
- Risk: Both packages use `^` (caret), allowing automatic minor/patch upgrades. Internal properties `nango.http`, `nango.secretKey`, and `nango.serverUrl` are accessed directly in `src/nango.ts`; these are not part of the documented public API.
- Impact: A Nango SDK minor release that renames or privatizes these properties would cause runtime failures without a compile-time error (due to `as string` casts bypassing type checking).
- Migration plan: Pin to exact versions (`0.70.3`) until a proper SDK version gate is in place, or stop accessing internal properties by deriving credentials from the local `NangoSettings` object.

**`zod ^4.4.3`:**
- Risk: Zod v4 introduced breaking changes from v3. The `package.json` pins `^4.4.3`, which is fine if the host application is also on v4. However, the package lists zod as a `dependency` (not `peerDependency`), so if the host uses a different major version, there will be duplicate zod instances in the bundle.
- Impact: Schema `.parse()` results from this package's zod instance may not be compatible with the host's zod instance if they ever interop.
- Migration plan: Move `zod` to `peerDependencies` to allow the host to supply a single shared instance.

## Missing Critical Features

**No Nango webhook signature verification:**
- Problem: The webhook handler (`handleNangoWebhookRequest`) accepts and processes any POST claiming to be from Nango without verifying the HMAC signature. This is a standard security control that Nango supports.
- Blocks: Safely exposing the webhook endpoint to the internet without IP allowlisting.

**No mechanism to clear/reset a saved Nango secret key through the settings UI:**
- Problem: `saveNangoSettings` cannot clear an existing key (the `||` fallback always retains the old value). The settings page has no explicit "Disconnect" button that would call a clear path.
- Blocks: Operators who need to rotate or remove their Nango configuration without direct DB access.

## Test Coverage Gaps

**`applyNangoConnectUINoWatermark` is entirely untested:**
- What's not tested: The function that disables the Nango Connect UI watermark by calling undocumented API endpoints — including the GET+PUT round-trip, the fallback to default theme values, and error swallowing.
- Files: `src/nango.ts` (lines 254–276)
- Risk: Regressions in this path are invisible. Since the call is fire-and-forget, a broken implementation would silently do nothing.
- Priority: Low (cosmetic feature), but worth a basic happy-path test.

**`ensureNangoConnectorIntegration` switch arms are not tested:**
- What's not tested: The per-connector switch in `src/nango-connect-ui.ts` that maps connector keys to Nango provider templates and integration credentials. None of the 15 arms are covered by the existing test suite.
- Files: `src/nango-connect-ui.ts` (lines 49–228)
- Risk: A new connector arm that passes wrong credentials (e.g. wrong scopes or provider template string) would only surface as a runtime failure during an actual user connect flow.
- Priority: Medium.

**`saveNangoSettings` write path (cannot-clear bug) is not tested:**
- What's not tested: That passing an empty `secretKey` to `saveNangoSettings` retains the existing key rather than clearing it. The existing migration tests cover `getNangoSettings` read behavior but not the write path.
- Files: `src/nango.ts` (lines 230–246)
- Risk: The "cannot clear" behavior is currently a bug, not an intentional feature. A test would both document the limitation and catch any future change.
- Priority: Medium.

**`route-handlers.ts` has zero tests:**
- What's not tested: `handleNangoConnectSessionRequest`, `handleNangoConnectionSaveRequest`, and `handleNangoWebhookRequest` — including their Zod validation, error wrapping, status code assignment, and the user-scope guard (`scope === "user" && !options?.userId`).
- Files: `src/route-handlers.ts`
- Risk: The HTTP interface surface — the most likely entry point for malformed input — has no automated coverage.
- Priority: High.

---

*Concerns audit: 2026-06-09*
