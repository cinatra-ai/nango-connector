// Regression coverage (CWE-863) — Nango reconnect sessions must be bound to the existing connection's owner.
// A caller must not be able to mint a reconnect token for a connection id they
// do not own (which would let them complete OAuth and rebind the victim's
// connector identity). Authorization source = the Cinatra store.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const createReconnectSessionSpy = vi.fn(async () => ({ data: { token: "reconnect-token" } }));

// Keep the real listSavedNangoConnections / isNangoConfigured (run over the
// injected store); mock the Nango client + integration ensure so no network.
vi.mock("../nango", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../nango")>();
  return {
    ...actual,
    isNangoConfigured: vi.fn(() => true),
    ensureNangoIntegration: vi.fn(async (input: unknown) => input),
    getNangoOAuth2IntegrationCredentials: vi.fn(async () => null),
    getNangoGoogleOAuthClientCredentials: vi.fn(async () => ({})),
    getNangoClient: vi.fn(() => ({
      createReconnectSession: createReconnectSessionSpy,
      createConnectSession: vi.fn(async () => ({ data: { token: "connect-token" } })),
    })),
  };
});

import { createNangoConnectSession } from "../nango-connect-ui";
import { _resetNangoConfigStoreForTests, setNangoConfigStore } from "../config-store";

const configRows = new Map<string, unknown>();

const VICTIM_CONNECTION = "victim-connection-id";
const OWNER_USER = "owner-user-1";
const ATTACKER_USER = "attacker-user-2";
const APP_CONNECTION = "app-connection-id";

beforeEach(() => {
  vi.clearAllMocks();
  createReconnectSessionSpy.mockClear();
  configRows.clear();
  _resetNangoConfigStoreForTests();
  setNangoConfigStore({
    read: (id, fallback) => (configRows.has(id) ? (configRows.get(id) as never) : (fallback as never)),
    write: (id, value) => {
      configRows.set(id, value);
    },
    delete: (id) => {
      configRows.delete(id);
    },
  });
  // openai uses Connect UI. Seed a victim USER-scope connection owned by
  // OWNER_USER, plus an APP-scope connection.
  configRows.set("nango_connections", {
    connections: {
      openai: [
        {
          connectorKey: "openai",
          connectionId: VICTIM_CONNECTION,
          providerConfigKey: "cinatra-openai",
          connectedAt: new Date().toISOString(),
          scope: "user",
          userId: OWNER_USER,
        },
        {
          connectorKey: "openai",
          connectionId: APP_CONNECTION,
          providerConfigKey: "cinatra-openai",
          connectedAt: new Date().toISOString(),
          scope: "app",
        },
      ],
    },
  });
});

describe("createNangoConnectSession — reconnect ownership (CWE-863)", () => {
  it("DENIES a cross-user reconnect of a victim's connection id", async () => {
    await expect(
      createNangoConnectSession({
        connectorKey: "openai",
        reconnectConnectionId: VICTIM_CONNECTION,
        scope: "user",
        userId: ATTACKER_USER,
      }),
    ).rejects.toThrow(/only reconnect your own connection/i);
    expect(createReconnectSessionSpy).not.toHaveBeenCalled();
  });

  it("REJECTS a user-scope reconnect with no userId", async () => {
    await expect(
      createNangoConnectSession({
        connectorKey: "openai",
        reconnectConnectionId: VICTIM_CONNECTION,
        scope: "user",
      }),
    ).rejects.toThrow(/sign in again/i);
    expect(createReconnectSessionSpy).not.toHaveBeenCalled();
  });

  it("ALLOWS the owner to reconnect their own connection id", async () => {
    const token = await createNangoConnectSession({
      connectorKey: "openai",
      reconnectConnectionId: VICTIM_CONNECTION,
      scope: "user",
      userId: OWNER_USER,
    });
    expect(token).toBe("reconnect-token");
    expect(createReconnectSessionSpy).toHaveBeenCalledWith({
      connection_id: VICTIM_CONNECTION,
      integration_id: "cinatra-openai",
    });
  });

  it("DENIES an app/unset-scope reconnect of an arbitrary (unknown) connection id", async () => {
    await expect(
      createNangoConnectSession({
        connectorKey: "openai",
        reconnectConnectionId: "never-saved-connection",
        scope: "app",
      }),
    ).rejects.toThrow(/cannot be reconnected/i);
    expect(createReconnectSessionSpy).not.toHaveBeenCalled();
  });

  it("ALLOWS an app-scope reconnect of an existing app-saved connection id", async () => {
    const token = await createNangoConnectSession({
      connectorKey: "openai",
      reconnectConnectionId: APP_CONNECTION,
      scope: "app",
    });
    expect(token).toBe("reconnect-token");
    expect(createReconnectSessionSpy).toHaveBeenCalledTimes(1);
  });
});
