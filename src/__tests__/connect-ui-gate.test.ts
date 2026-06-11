// Verifies the generic Nango Connect save/webhook chokepoint refuses
// connectors flipped to cinatra-native (`usesConnectUI: false`). Without
// this gate, a malicious or malformed POST /api/nango/connections/save
// could write an unverified local pointer that bypasses the per-connector
// readback chain. The gate also exists symmetrically in
// createNangoConnectSession and the route-handlers.ts session-create z.enum
// as defense in depth.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock @/lib/database so the connector-config reads inside the package
// don't try to hit Postgres.
vi.mock("@/lib/database", () => ({
  readConnectorConfigFromDatabase: vi.fn(<T>(_key: string, fallback: T): T => fallback),
  writeConnectorConfigToDatabase: vi.fn(),
  deleteConnectorConfig: vi.fn(),
}));

// The legacy materializer fallbacks (./connection-materializer) still import
// @/lib/linkedin-api + @/lib/wordpress-api for the cutover skew window. The
// connection-flow gate runs synchronously off the connector definition before
// any of those code paths execute, so stubbing the imports to bare functions
// is enough: the assertions below never reach them. (The former
// @/lib/github-api mock was dropped with the serverEntry cutover — the GitHub
// integration credentials now resolve via nango's own
// getNangoOAuth2IntegrationCredentials.)
vi.mock("@/lib/linkedin-api", () => ({
  saveLinkedInAccountFromNangoConnection: vi.fn(async () => undefined),
}));
vi.mock("@/lib/wordpress-api", () => ({
  saveWordPressInstanceFromNangoConnection: vi.fn(async () => undefined),
}));

import { saveNangoConnectorConnection, getNangoConnectorDefinition } from "../nango-connect-ui";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Refuse usesConnectUI:false connectors at the chokepoint
// ---------------------------------------------------------------------------

describe("saveNangoConnectorConnection — usesConnectUI gate", () => {
  // The gate runs before getNangoConnection and throws synchronously based on
  // the connector definition. We assert the exception name matches the
  // definition lookup.
  //
  // We test the gate for all current cinatra-native connectors:
  //  - gemini
  //  - apify
  //  - drupal
  //  - a2aServer
  // Each call would otherwise have proceeded to a remote getNangoConnection
  // refresh and a local pointer write under the wrong policy.

  const cinatraNativeConnectors: Array<{ key: "gemini" | "apify" | "drupal" | "a2aServer"; titlePrefix: string }> = [
    { key: "gemini", titlePrefix: "Gemini" },
    { key: "apify", titlePrefix: "Apify" },
    { key: "drupal", titlePrefix: "Drupal" },
    { key: "a2aServer", titlePrefix: "A2A" },
  ];

  for (const { key, titlePrefix } of cinatraNativeConnectors) {
    it(`refuses ${key} (usesConnectUI:false) with a clear error mentioning the connector title`, async () => {
      // Sanity check: the definition under test is actually usesConnectUI:false.
      const def = getNangoConnectorDefinition(key);
      expect(def.usesConnectUI).toBe(false);

      await expect(
        saveNangoConnectorConnection({
          connectorKey: key,
          providerConfigKey: def.providerConfigKey,
          connectionId: `attacker-${key}-connection-id`,
        }),
      ).rejects.toThrow(new RegExp(`${titlePrefix}.*is not configured for the connection flow`));
    });
  }
});

describe("saveNangoConnectorConnection — providerConfigKey cross-wired guard", () => {
  // Even an allowed connector (usesConnectUI:true) is refused when the
  // request's providerConfigKey doesn't match the connector definition's
  // canonical providerConfigKey. Prevents materializing a pointer under
  // an allowed connectorKey with another connector's provider config.
  it("refuses a mismatched providerConfigKey for an allowed connector (openai)", async () => {
    const openaiDef = getNangoConnectorDefinition("openai");
    expect(openaiDef.usesConnectUI).toBe(true);

    await expect(
      saveNangoConnectorConnection({
        connectorKey: "openai",
        providerConfigKey: "cinatra-google-gemini", // WRONG: Gemini's PCK under OpenAI's connectorKey
        connectionId: "x",
      }),
    ).rejects.toThrow(/does not match the declared key/);
  });
});
