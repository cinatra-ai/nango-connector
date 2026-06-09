# Codebase Structure

**Analysis Date:** 2026-06-09

## Directory Layout

```
nango-connector/
├── src/
│   ├── index.ts                        # Public API surface — all re-exports
│   ├── nango.ts                        # Core Nango layer (settings, connections, SDK client)
│   ├── nango-connectors.ts             # Static connector registry (NANGO_CONNECTOR_DEFINITIONS)
│   ├── nango-connect-ui.ts             # Connect-UI orchestration (sessions, integration provisioning)
│   ├── nango-operations-card.tsx       # React component: status badge + dashboard link card
│   ├── route-handlers.ts               # Framework-agnostic HTTP request handlers
│   ├── actions.ts                      # Next.js "use server" action for settings form
│   ├── first-party-mcp.ts              # Bearer-auth-header helper for API-key connectors
│   ├── pages/
│   │   └── nango-settings-page.tsx     # React Server Component: Nango settings form
│   ├── components/
│   │   └── ui/
│   │       ├── alert.tsx
│   │       ├── button.tsx
│   │       ├── card.tsx
│   │       ├── field.tsx
│   │       ├── input.tsx
│   │       ├── input-group.tsx
│   │       ├── label.tsx
│   │       ├── separator.tsx
│   │       └── textarea.tsx
│   └── __tests__/
│       ├── dependency-direction.test.ts      # Enforces leaf-package invariant (no @cinatra-ai/llm)
│       ├── connect-ui-gate.test.ts           # Connect UI gate behaviour
│       ├── first-party-mcp.test.ts           # buildBearerAuthHeaderFromNango unit tests
│       ├── multiple-flag-lookup.test.ts      # Connector `multiple` flag logic
│       └── nango-legacy-key-migration.test.ts # Legacy key purge logic
├── package.json                        # Package manifest (cinatra connector kind)
├── tsconfig.json                       # TypeScript config
├── vitest.config.ts                    # Test runner config
├── .npmrc                              # NPM registry config
├── AGENTS.md                           # Agent conventions for this package
├── README.md                           # Package documentation
├── LICENSE                             # Apache-2.0
└── .github/
    └── workflows/
        ├── ci.yml                      # CI pipeline
        └── release.yml                 # Release pipeline
```

## Directory Purposes

**`src/`:**
- Purpose: All TypeScript source for the package
- Contains: Core modules, UI components, route handlers, server action, test suite
- Key files: `src/index.ts` (public surface), `src/nango.ts` (core logic), `src/nango-connectors.ts` (registry)

**`src/components/ui/`:**
- Purpose: Headless, Radix UI-based primitive components for the settings page UI
- Contains: Button, Card, Input, InputGroup, Field, Label, Alert, Separator, Textarea
- Key files: Used exclusively by `src/pages/nango-settings-page.tsx`

**`src/pages/`:**
- Purpose: React Server Components that are page-level features (not layout primitives)
- Contains: `nango-settings-page.tsx` — Nango secret key + server URL settings form
- Key files: `src/pages/nango-settings-page.tsx`

**`src/__tests__/`:**
- Purpose: Vitest test files for all non-trivial logic
- Contains: Unit and architectural invariant tests
- Key files: `src/__tests__/dependency-direction.test.ts` (mechanically enforces leaf-package rule)

**`.github/workflows/`:**
- Purpose: CI/CD pipeline definitions
- Contains: `ci.yml`, `release.yml`
- Generated: No
- Committed: Yes

## Key File Locations

**Entry Points:**
- `src/index.ts`: Package public API — all host imports go through here

**Core Logic:**
- `src/nango.ts`: Settings CRUD, connection CRUD, Nango SDK client factory
- `src/nango-connectors.ts`: `NANGO_CONNECTOR_DEFINITIONS` registry and `NangoConnectorDefinition` type
- `src/nango-connect-ui.ts`: Connect-UI session and integration orchestration
- `src/route-handlers.ts`: HTTP handlers wired by the host Next.js app

**Server Action:**
- `src/actions.ts`: `saveNangoConnectionAction` — Next.js form action for settings

**UI / Pages:**
- `src/pages/nango-settings-page.tsx`: Settings form page component
- `src/nango-operations-card.tsx`: Status + dashboard-link card

**First-Party MCP:**
- `src/first-party-mcp.ts`: `buildBearerAuthHeaderFromNango` — Bearer header for API-key connectors

**Configuration:**
- `package.json`: Declares `"cinatra": { "kind": "connector" }` manifest and peer deps
- `tsconfig.json`: TypeScript compilation settings
- `vitest.config.ts`: Test runner configuration

**Testing:**
- `src/__tests__/dependency-direction.test.ts`: Architectural invariant (no `@cinatra-ai/llm`)
- `src/__tests__/connect-ui-gate.test.ts`: Connect-UI gate behaviour
- `src/__tests__/first-party-mcp.test.ts`: Bearer header builder unit tests
- `src/__tests__/multiple-flag-lookup.test.ts`: `multiple` flag dedup logic
- `src/__tests__/nango-legacy-key-migration.test.ts`: Legacy key purge

## Naming Conventions

**Files:**
- kebab-case for all source files: `nango-connect-ui.ts`, `route-handlers.ts`, `first-party-mcp.ts`
- React components use kebab-case filenames: `nango-settings-page.tsx`, `nango-operations-card.tsx`
- UI primitives: kebab-case, single-concept names: `input-group.tsx`, `card.tsx`
- Tests: match source filename with `.test.ts` suffix in `__tests__/`

**Directories:**
- lowercase with hyphens for multi-word directories: `src/components/ui/`
- Test directory: `src/__tests__/` (double-underscore convention)

**Exports:**
- Named exports throughout; no default exports
- Public types are PascalCase: `NangoConnectorKey`, `SavedNangoConnection`, `NangoConnectorDefinition`
- Public constants are SCREAMING_SNAKE_CASE: `NANGO_CONNECTOR_DEFINITIONS`, `CINATRA_NANGO_PROVIDER_CONFIG_KEYS`
- Functions are camelCase: `getNangoClient`, `saveNangoConnectionRecord`, `buildBearerAuthHeaderFromNango`

## Where to Add New Code

**New connector integration:**
1. Add the connector key to `NangoConnectorKey` union in `src/nango.ts:14`
2. Add the provider config key to `CINATRA_NANGO_PROVIDER_CONFIG_KEYS` in `src/nango.ts:48`
3. Add an entry to `CINATRA_NANGO_CONNECTION_IDS` in `src/nango.ts:70` if the connector has a fixed connection ID
4. Add a connection slot to `EMPTY_NANGO_CONNECTION_STORE` in `src/nango.ts:97`
5. Add a `NangoConnectorDefinition` entry to `NANGO_CONNECTOR_DEFINITIONS` in `src/nango-connectors.ts:17`
6. Add the `ensureNangoConnectorIntegration` switch arm in `src/nango-connect-ui.ts:53`
7. If `usesConnectUI: true`, add the connector key to the Zod enums in `src/route-handlers.ts:15` and `:21`

**New UI component:**
- Implementation: `src/components/ui/<component-name>.tsx`
- Follow existing Radix UI + `class-variance-authority` + `tailwind-merge` pattern from `src/components/ui/button.tsx`

**New page-level component:**
- Implementation: `src/pages/<feature-name>.tsx`
- Re-export from `src/index.ts` if it needs to be host-accessible

**New HTTP handler:**
- Add to `src/route-handlers.ts` following the `RouteResult` return shape
- Export from `src/index.ts`

**New architectural constraint test:**
- Add to `src/__tests__/dependency-direction.test.ts` for package-level invariants
- Add a new `src/__tests__/<feature>.test.ts` for feature-level behaviour

**Utilities:**
- Shared helpers: `src/lib/utils.ts` (currently contains `cn()` Tailwind class merger)

## Special Directories

**`src/__tests__/`:**
- Purpose: All test files; Vitest test suite
- Generated: No
- Committed: Yes

**`.planning/`:**
- Purpose: GSD planning and codebase analysis documents
- Generated: Yes (by GSD mapper)
- Committed: Yes

**`.github/`:**
- Purpose: GitHub Actions CI/CD workflows
- Generated: No
- Committed: Yes

---

*Structure analysis: 2026-06-09*
