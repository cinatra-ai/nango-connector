# Testing Patterns

**Analysis Date:** 2026-06-09

## Test Framework

**Runner:**
- Vitest (version inferred from `package.json` devDependencies via host monorepo)
- Config: `vitest.config.ts`

**Assertion Library:**
- Vitest built-in `expect` (Jest-compatible API)

**Run Commands:**
```bash
npm test              # Run all tests (vitest)
vitest --watch        # Watch mode
vitest --coverage     # Coverage (if configured)
```

## Test File Organization

**Location:**
- All tests co-located under `src/__tests__/` (separate subdirectory, not co-located beside source files)

**Naming:**
- `<subject>.test.ts` pattern: `first-party-mcp.test.ts`, `connect-ui-gate.test.ts`, `dependency-direction.test.ts`, `nango-legacy-key-migration.test.ts`, `multiple-flag-lookup.test.ts`

**Structure:**
```
src/
  __tests__/
    first-party-mcp.test.ts          # Unit: buildBearerAuthHeaderFromNango
    connect-ui-gate.test.ts          # Integration gate: saveNangoConnectorConnection
    dependency-direction.test.ts     # Architectural invariant: no llm dep
    nango-legacy-key-migration.test.ts  # Security: legacy DB key purge
    multiple-flag-lookup.test.ts     # Schema: connector multiple-flag
```

## Vitest Configuration

```typescript
// vitest.config.ts
export default defineConfig({
  resolve: {
    alias: [
      { find: "server-only", replacement: serverOnlyStub },
      { find: /^@\/(.+)$/, replacement: path.join(repoRoot, "src") + "/$1" },
    ],
  },
  test: {
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
  },
});
```

Key notes:
- `server-only` is aliased to a stub (`tests/__stubs__/server-only.ts`) in the host repo to avoid Next.js server-only boundary errors
- `@/` alias resolves to the host repo `src/` — tests that mock `@/lib/database` depend on this alias being set correctly
- Environment is `node` (no browser/jsdom)

## Test Structure

**Suite Organization:**
```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mocks declared BEFORE imports of the module under test
vi.mock("../nango", () => ({
  getNangoCredentials: vi.fn(),
  isNangoConfigured: vi.fn(),
}));

import { buildBearerAuthHeaderFromNango } from "../first-party-mcp";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildBearerAuthHeaderFromNango", () => {
  it("returns null when Nango is not configured", async () => { ... });
  it("returns Authorization header when credentials contain apiKey", async () => { ... });
});
```

**Patterns:**
- `beforeEach(() => vi.clearAllMocks())` is standard in every test file that uses mocks
- `afterEach(() => vi.restoreAllMocks())` used alongside `vi.spyOn` to restore originals
- `describe` → `it` hierarchy; no nested `describe` beyond one level
- `it.each` used for parameterized tests over known connector lists (`multiple-flag-lookup.test.ts`, `connect-ui-gate.test.ts`)

## Mocking

**Framework:** Vitest's built-in `vi.mock`, `vi.fn`, `vi.mocked`, `vi.spyOn`, `vi.hoisted`

**Patterns:**

Module mock (factory function):
```typescript
vi.mock("../nango", () => ({
  getNangoCredentials: vi.fn(),
  isNangoConfigured: vi.fn(),
}));
// Access typed mock after import:
vi.mocked(isNangoConfigured).mockReturnValue(false);
vi.mocked(getNangoCredentials).mockResolvedValueOnce({ apiKey: "token" } as never);
```

Hoisted in-memory store (for DB mocks):
```typescript
const { store, writes, deletes } = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  writes: [] as Array<{ id: string; value: unknown }>,
  deletes: [] as string[],
}));

vi.mock("@/lib/database", () => ({
  readConnectorConfigFromDatabase: (id: string, fallback: unknown) =>
    store.has(id) ? store.get(id) : fallback,
  writeConnectorConfigToDatabase: (id: string, value: unknown) => {
    store.set(id, value);
    writes.push({ id, value });
  },
  deleteConnectorConfig: (id: string) => {
    store.delete(id);
    deletes.push(id);
  },
}));
```

Spy for console methods:
```typescript
const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
expect(warn).toHaveBeenCalledTimes(1);
expect(warn.mock.calls[0][0] as string).toContain(LABEL);
```

**What to Mock:**
- All external connector imports (`@/lib/database`, `@/lib/github-api`, `@/lib/linkedin-api`, `@/lib/wordpress-api`) that reach infrastructure (Postgres, network)
- Sibling modules under test when isolating a single unit (`../nango` mocked in `first-party-mcp.test.ts`)
- `console.warn` when asserting log-redaction behavior (security tests)

**What NOT to Mock:**
- The module under test itself
- Pure utility functions with no side effects
- `NANGO_CONNECTOR_DEFINITIONS` — the multiple-flag tests import and assert on the real definitions

## Fixtures and Factories

**Test Data:**
- Inline literals rather than shared fixture files
- Named constants within each test file: `const LABEL = "apify"`, `const CANARY_TOKEN = "SECRET_CANARY_TOKEN_..."`
- Map-based in-memory store (`vi.hoisted` pattern) acts as a lightweight fixture for DB state

**Location:**
- No dedicated fixtures directory in this package
- Host repo has `tests/__stubs__/server-only.ts` used as an alias stub

## Coverage

**Requirements:** Not enforced (no coverage threshold configured in `vitest.config.ts`)

**View Coverage:**
```bash
vitest --coverage
```

## Test Types

**Unit Tests:**
- `first-party-mcp.test.ts`: Pure unit test of `buildBearerAuthHeaderFromNango` with all dependencies mocked
- `multiple-flag-lookup.test.ts`: Data-shape assertion on `NANGO_CONNECTOR_DEFINITIONS` — no mocking, reads real exported data

**Integration / Gate Tests:**
- `connect-ui-gate.test.ts`: Exercises `saveNangoConnectorConnection` with DB mocked but real connector definitions — asserts security policy enforcement (refusal of `usesConnectUI: false` connectors)
- `nango-legacy-key-migration.test.ts`: Exercises full `getNangoSettings` → `purgeLegacyNangoConnectionConfig` path with in-memory DB; uses `vi.resetModules()` per test to reset the module-level `legacyNangoKeyPurged` latch

**Architectural Invariant Tests:**
- `dependency-direction.test.ts`: Reads `package.json` and source files directly via `fs.readFileSync`; uses `execSync` to grep for forbidden import patterns — no mocking, enforces structural constraints

**E2E Tests:** Not used in this package

## Common Patterns

**Async Testing:**
```typescript
it("returns null when credentials throw", async () => {
  vi.mocked(getNangoCredentials).mockRejectedValueOnce(new Error("nango network down"));
  const result = await buildBearerAuthHeaderFromNango({ ... });
  expect(result).toBeNull();
});
```

**Error Testing:**
```typescript
// Assert thrown errors by regex pattern
await expect(
  saveNangoConnectorConnection({ connectorKey: "gemini", ... }),
).rejects.toThrow(/Gemini.*is not configured for the connection flow/);
```

**Module Reset for Singleton State:**
```typescript
beforeEach(() => {
  // Reset per-module latch (legacyNangoKeyPurged) between tests
  vi.resetModules();
});
// Then use dynamic import INSIDE each test:
const { getNangoSettings } = await import("../nango");
```

**Security / Log-Redaction Assertions:**
```typescript
// Canary-token pattern: assert a known secret string never appears in warn output
const CANARY_TOKEN = "SECRET_CANARY_TOKEN_DO_NOT_LEAK_INTO_LOGS_12345";
const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
// ... exercise code path ...
const allWarnPayloads = warn.mock.calls.flat().filter((c) => typeof c === "string") as string[];
expect(allWarnPayloads.some((m) => m.includes(CANARY_TOKEN))).toBe(false);
```

**Parameterized Tests:**
```typescript
const cinatraNativeConnectors = [
  { key: "gemini", titlePrefix: "Gemini" },
  { key: "apify", titlePrefix: "Apify" },
];

for (const { key, titlePrefix } of cinatraNativeConnectors) {
  it(`refuses ${key} (usesConnectUI:false) ...`, async () => { ... });
}
// OR using it.each:
it.each(Object.entries(EXPECTED_MULTIPLE) as Array<[NangoConnectorKey, boolean]>)(
  "%s resolves to multiple=%s",
  (connectorKey, expected) => { ... },
);
```

---

*Testing analysis: 2026-06-09*
