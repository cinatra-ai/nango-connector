// Parity pins for the connect-UI inversion (cinatra-ai/cinatra#151 Stage 1):
// the four host reachbacks left `nango-connect-ui.ts`, and these tests pin
// that the replacement chains reproduce the host semantics EXACTLY:
//   - github: integration credentials from nango's own reader (the same chain
//     the host's getGitHubOAuthSettings used), fixed scope set, same error.
//   - linkedin: Nango-first credentials with the DB `"linkedin"` row (via the
//     injected store) as fallback — the host's getLinkedInAPISettings chain.
//   - wordpress/linkedin saves: BLOCKING materialization — a failure FAILS
//     the save; linkedin user-scope saves do NOT materialize (parity).

import { describe, it, expect, vi, beforeEach } from "vitest";

const { configRows } = vi.hoisted(() => ({
  configRows: new Map<string, unknown>(),
}));

vi.mock("server-only", () => ({}));

// The integration-credential reader + connection readback + record store are
// nango-internal; mock them at the module boundary so the chains under test
// stay hermetic (no Nango client, no network).
vi.mock("../nango", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../nango")>();
  return {
    ...actual,
    getNangoOAuth2IntegrationCredentials: vi.fn(async () => null),
    getNangoGoogleOAuthClientCredentials: vi.fn(async () => ({})),
    isNangoConfigured: vi.fn(() => true),
    ensureNangoIntegration: vi.fn(async (input: unknown) => input),
    getNangoConnection: vi.fn(async () => ({
      end_user: { display_name: "User", email: "user@example.com" },
      credentials: { type: "OAUTH2" },
      metadata: {},
    })),
    saveNangoConnectionRecord: vi.fn(async () => undefined),
  };
});

import {
  ensureNangoConnectorIntegration,
  saveNangoConnectorConnection,
} from "../nango-connect-ui";
import {
  ensureNangoIntegration,
  getNangoOAuth2IntegrationCredentials,
  saveNangoConnectionRecord,
} from "../nango";
import { _resetNangoConfigStoreForTests, setNangoConfigStore } from "../config-store";
import {
  _resetNangoConnectionMaterializerForTests,
  setNangoConnectionMaterializerDispatch,
} from "../connection-materializer";

beforeEach(() => {
  vi.clearAllMocks();
  configRows.clear();
  _resetNangoConfigStoreForTests();
  _resetNangoConnectionMaterializerForTests();
  // Post-cutover sweep: the injected store is the ONLY persistence path —
  // bind a fixture (register(ctx) binds the host service in production).
  setNangoConfigStore({
    read: (id, fallback) => (configRows.has(id) ? (configRows.get(id) as never) : (fallback as never)),
    write: (id, value) => {
      configRows.set(id, value);
    },
    delete: (id) => {
      configRows.delete(id);
    },
  });
  vi.mocked(getNangoOAuth2IntegrationCredentials).mockResolvedValue(null);
});

describe("github integration credentials (host getGitHubOAuthSettings parity)", () => {
  it("throws the exact host error when the integration carries no credentials", async () => {
    await expect(ensureNangoConnectorIntegration("github")).rejects.toThrow(
      "Save the GitHub client ID and client secret first.",
    );
    expect(vi.mocked(getNangoOAuth2IntegrationCredentials)).toHaveBeenCalledWith("cinatra-github");
  });

  it("re-applies the nango integration credentials with the host scope set", async () => {
    vi.mocked(getNangoOAuth2IntegrationCredentials).mockResolvedValue({
      clientId: "gh-id",
      clientSecret: "gh-secret",
    });
    await ensureNangoConnectorIntegration("github");
    expect(vi.mocked(ensureNangoIntegration)).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "github",
        providerConfigKey: "cinatra-github",
        credentials: {
          type: "OAUTH2",
          client_id: "gh-id",
          client_secret: "gh-secret",
          scopes: "repo,workflow,read:user,user:email",
        },
      }),
    );
  });
});

describe("linkedin client credentials (host getLinkedInAPISettings parity)", () => {
  it("prefers the nango integration credentials", async () => {
    vi.mocked(getNangoOAuth2IntegrationCredentials).mockResolvedValue({
      clientId: "li-nango-id",
      clientSecret: "li-nango-secret",
    });
    configRows.set("linkedin", { clientId: "li-db-id", clientSecret: "li-db-secret" });
    await ensureNangoConnectorIntegration("linkedin");
    expect(vi.mocked(ensureNangoIntegration)).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({
          client_id: "li-nango-id",
          client_secret: "li-nango-secret",
        }),
      }),
    );
  });

  it("falls back to the DB linkedin row via the injected store (trim semantics)", async () => {
    configRows.set("linkedin", { clientId: "  li-db-id  ", clientSecret: "li-db-secret" });
    await ensureNangoConnectorIntegration("linkedin");
    expect(vi.mocked(ensureNangoIntegration)).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({
          client_id: "li-db-id",
          client_secret: "li-db-secret",
        }),
      }),
    );
  });

  it("throws the exact host error when neither source has credentials", async () => {
    configRows.set("linkedin", { clientId: "   ", accounts: [] });
    await expect(ensureNangoConnectorIntegration("linkedin")).rejects.toThrow(
      "Save the LinkedIn client ID and client secret first.",
    );
  });
});

describe("save-path materialization (inline fail-blocking parity)", () => {
  it("wordpress: refuses a save without a site URL BEFORE materializing", async () => {
    const dispatched: unknown[] = [];
    setNangoConnectionMaterializerDispatch(async (input) => {
      dispatched.push(input);
    });
    await expect(
      saveNangoConnectorConnection({
        connectorKey: "wordpress",
        providerConfigKey: "cinatra-wordpress",
        connectionId: "c-1",
      }),
    ).rejects.toThrow("Enter the WordPress site domain before connecting with Nango.");
    expect(dispatched).toEqual([]);
  });

  it("wordpress: an UNBOUND dispatch fails the save LOUD (the sweep removed the legacy fallback)", async () => {
    await expect(
      saveNangoConnectorConnection({
        connectorKey: "wordpress",
        providerConfigKey: "cinatra-wordpress",
        connectionId: "c-2",
        siteUrl: " https://example.com ",
      }),
    ).rejects.toThrow(/connection-materializer dispatch is not bound/);
    // Parity note: the record save still precedes materialization (today's
    // ordering), so the record write happened before the loud failure.
    expect(vi.mocked(saveNangoConnectionRecord)).toHaveBeenCalled();
  });

  it("a bound materializer failure FAILS the save (blocking semantics)", async () => {
    setNangoConnectionMaterializerDispatch(async () => {
      throw new Error("materializer down");
    });
    await expect(
      saveNangoConnectorConnection({
        connectorKey: "linkedin",
        providerConfigKey: "cinatra-linkedin",
        connectionId: "c-3",
      }),
    ).rejects.toThrow("materializer down");
  });

  it("linkedin: app-scope saves materialize, user-scope saves do NOT (parity)", async () => {
    const dispatched: unknown[] = [];
    setNangoConnectionMaterializerDispatch(async (input) => {
      dispatched.push(input);
    });
    await saveNangoConnectorConnection({
      connectorKey: "linkedin",
      providerConfigKey: "cinatra-linkedin",
      connectionId: "c-4",
    });
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ connectorKey: "linkedin", connectionId: "c-4" });

    await saveNangoConnectorConnection({
      connectorKey: "linkedin",
      providerConfigKey: "cinatra-linkedin",
      connectionId: "c-5",
      scope: "user",
      userId: "u-1",
    });
    expect(dispatched).toHaveLength(1);
  });
});
