# Coding Conventions

**Analysis Date:** 2026-06-09

## Naming Patterns

**Files:**
- `kebab-case` for multi-word source files: `nango-connect-ui.ts`, `nango-connectors.ts`, `first-party-mcp.ts`, `route-handlers.ts`
- `kebab-case` with category prefix for UI components: `nango-operations-card.tsx`, `nango-settings-page.tsx`
- UI primitives in `src/components/ui/` use plain kebab-case: `input-group.tsx`, `button.tsx`
- Test files mirror the module under test with a `.test.ts` suffix: `first-party-mcp.test.ts`

**Functions:**
- `camelCase` for all exported and internal functions: `getNangoSettings`, `saveNangoConnectionRecord`, `buildBearerAuthHeaderFromNango`
- `get*` prefix for reads: `getNangoClient`, `getNangoCredentials`, `getNangoSettings`, `getNangoStatus`
- `save*` prefix for writes: `saveNangoSettings`, `saveNangoConnectionRecord`, `saveNangoConnectorConnection`
- `list*` prefix for multi-result reads: `listSavedNangoConnections`
- `ensure*` prefix for idempotent upserts: `ensureNangoIntegration`
- `delete*` / `remove*` / `clear*` for removal: `deleteNangoIntegration`, `removeNangoConnectionRecord`, `clearNangoConnectionRecords`
- `is*` prefix for boolean predicates: `isNangoConfigured`
- `build*` prefix for constructors: `buildBearerAuthHeaderFromNango`, `buildNangoUserEndUserId`
- Private/internal helpers use `camelCase` without export: `readStoredNangoSettings`, `purgeLegacyNangoConnectionConfig`

**Variables and Constants:**
- `UPPER_SNAKE_CASE` for module-level constants: `NANGO_CONNECTOR_ID`, `EMPTY_NANGO_CONNECTION_STORE`, `CINATRA_NANGO_PROVIDER_CONFIG_KEYS`
- `camelCase` for local variables: `existing`, `deduped`, `normalized`
- `UPPER_SNAKE_CASE` for exported constant records and maps: `NANGO_CONNECTOR_DEFINITIONS`, `CINATRA_NANGO_CONNECTION_IDS`

**Types:**
- `PascalCase` for all types and interfaces: `NangoSettings`, `SavedNangoConnection`, `NangoConnectorKey`, `NangoFrontendConfig`
- Union types for discriminated enums inline: `"app" | "user"`, `"connected" | "not_connected"`
- `const` object-as-enum pattern for config key maps: `CINATRA_NANGO_PROVIDER_CONFIG_KEYS as const`
- `type` keyword preferred over `interface` throughout

## Code Style

**Formatting:**
- No Prettier or ESLint config files detected in this package; formatting is consistent with host monorepo conventions
- Trailing commas in multi-line object and array literals
- Double quotes for string literals
- Semicolons throughout

**TypeScript:**
- `strict: true` in `tsconfig.json` but `noImplicitAny: false` relaxes one strict sub-rule
- `verbatimModuleSyntax: true` — use `import type` for type-only imports
- `isolatedModules: true` — each file must be independently compilable
- ES module output (`"type": "module"` in `package.json`, `"module": "ESNext"`)

## Import Organization

**Order:**
1. Node built-ins with `node:` prefix: `import * as path from "node:path"`, `import { readFileSync } from "node:fs"`
2. External packages: `import { Nango } from "@nangohq/node"`
3. Internal absolute aliases (`@/` maps to repo root `src/`): `import { readConnectorConfigFromDatabase } from "@/lib/database"`
4. Relative imports: `import { getNangoCredentials, isNangoConfigured } from "./nango"`

**Path Aliases:**
- `@/` resolves to the host repo's `src/` directory (configured in `vitest.config.ts`)
- `server-only` is stubbed in tests via alias to `tests/__stubs__/server-only.ts`

**Named exports only:**
- No default exports anywhere in source; all exports are named
- Barrel re-exports in `src/index.ts` using `export *` for module groups, named `export { ... }` for selective back-compat re-exports

## Error Handling

**Patterns:**
- Null-return pattern for infrastructure failures: functions like `getNangoConnection`, `getNangoCredentials`, `getNangoIntegration` return `null` instead of throwing when Nango is unavailable
- Guard at top of async functions: `if (!isNangoConfigured()) { return null; }` is the standard early-exit
- Silent `catch` with `return null` for network-level errors (DNS, timeouts) on external Nango API calls
- `try/catch` with re-throw only for unexpected errors in `ensureNangoIntegration`; known error strings are intercepted and handled
- `console.warn` for non-fatal failures that require operator attention: `buildBearerAuthHeaderFromNango` logs label (never token) on credential failure
- Cold-boot resilience: `readStoredNangoSettings` catches Postgres timeout errors and returns `{}` instead of propagating, documented with inline comment

**Security-specific patterns:**
- Tokens and secrets are NEVER interpolated into log messages — only human-readable labels (`label` param) are logged
- `legacyNangoKeyPurged` module-level latch ensures one-shot sanitization of untrusted legacy DB key
- `purgeLegacyNangoConnectionConfig` is DELETE-only: it never promotes values from the legacy key to live config

## Logging

**Framework:** `console.warn` only (no structured logging library)

**Patterns:**
- Warnings include a bracketed module prefix: `[first-party-mcp]`
- Warnings always include the human-readable label, never credential values
- Exception messages are surfaced in warnings only when they don't risk leaking secrets (e.g., `err.message` from a network error)

## Comments

**When to Comment:**
- Security-critical decisions are heavily commented with rationale, threat model, and invariants in block comments above the relevant code
- Functions with non-obvious behavior have a JSDoc-style block comment explaining returns, side effects, and invariants
- Inline `// Fix:` comments document historical context for workarounds (e.g., cold-boot Postgres timeout)
- `// INVARIANT:` markers document cross-module contracts

**JSDoc/TSDoc:**
- Used selectively for exported functions with non-obvious behavior: `deleteNangoIntegration`, `getNangoGoogleOAuthClientCredentials`, `buildBearerAuthHeaderFromNango`
- Parameters are documented inline in the object type, not with `@param` tags

## Function Design

**Size:** Functions are short and focused; long orchestration logic (e.g., `ensureNangoIntegration`) is broken into named sub-flows with comments

**Parameters:** Object destructuring pattern for all multi-parameter functions — no positional argument lists with more than 2 params

**Return Values:**
- Async functions return `Promise<T | null>` when the operation can be skipped (Nango not configured, resource missing)
- Synchronous reads return `T` directly (non-nullable), relying on fallback defaults from `readConnectorConfigFromDatabase`

## Module Design

**Exports:**
- `src/index.ts` is the single barrel re-exporting everything public
- Selective named re-exports used when wildcard would cause collisions: `export { NangoUserConnectButton, ... } from "@cinatra-ai/sdk-ui/nango"`

**Architectural invariant:**
- `connector-nango` must remain a leaf package with no dependency on `@cinatra-ai/llm` or `llm-orchestration`
- `first-party-mcp.ts` imports ONLY from `./nango` (enforced mechanically by `dependency-direction.test.ts`)
- Dynamic import (`await import("./nango-connectors")`) used inside `importNangoConnection` to break a circular dependency

---

*Convention analysis: 2026-06-09*
