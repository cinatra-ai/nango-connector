// The serverEntry cutover (cinatra-ai/cinatra#151 Stage 1): `register(ctx)`
// must be PROBE-SAFE (no I/O, no eager host-service calls — nango is a
// systemExtension whose REQUIRED activation is boot-armed in prod), bind the
// injected config store + the blocking materializer dispatch, and publish the
// full nango-system capability surface. The save action resolves the host
// action guard LAZILY and FAILS CLOSED.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
// Hermetic Nango SDK client: saveNangoSettings constructs a client for the
// best-effort watermark call (fire-and-forget, .catch-swallowed) — keep it
// off the network in tests.
vi.mock("@nangohq/node", () => ({
  Nango: class {
    http = { defaults: {} as Record<string, unknown> };
    serverUrl = "https://nango.test";
    secretKey = "sk-test";
    constructor(_input: unknown) {}
  },
}));
// next/navigation redirect — the action core calls it after a successful save.
const { redirectCalls } = vi.hoisted(() => ({ redirectCalls: [] as string[] }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    redirectCalls.push(to);
  },
}));

import type { ExtensionHostContext } from "@cinatra-ai/sdk-extensions";
import { register } from "../register";
import { _resetNangoConfigStoreForTests, getNangoConfigStore } from "../config-store";
import {
  _resetNangoConnectionMaterializerForTests,
  materializeNangoConnection,
} from "../connection-materializer";
import { getNangoSettings } from "../nango";

type Provider = { packageName: string; impl: unknown };

function makeCtx() {
  const registry = new Map<string, Provider[]>();
  const registered: Array<{ capability: string; provider: Provider }> = [];
  const ctx = {
    capabilities: {
      registerProvider: (capability: string, provider: Provider) => {
        registry.set(capability, [...(registry.get(capability) ?? []), provider]);
        registered.push({ capability, provider });
      },
      resolveProviders: (capability: string) => registry.get(capability) ?? [],
    },
  } as unknown as ExtensionHostContext;
  return { ctx, registry, registered };
}

function publishHostServices(registry: Map<string, Provider[]>) {
  const store = new Map<string, unknown>();
  const calls = { read: 0, write: 0, delete: [] as string[] };
  registry.set("@cinatra-ai/host:connector-config", [
    {
      packageName: "@cinatra-ai/host",
      impl: {
        read: (id: string, fallback: unknown) => {
          calls.read += 1;
          return store.has(id) ? store.get(id) : fallback;
        },
        write: (id: string, value: unknown) => {
          calls.write += 1;
          store.set(id, value);
        },
        delete: (id: string) => {
          calls.delete.push(id);
          store.delete(id);
        },
      },
    },
  ]);
  return { store, calls };
}

beforeEach(() => {
  _resetNangoConfigStoreForTests();
  _resetNangoConnectionMaterializerForTests();
  redirectCalls.length = 0;
  delete process.env.NANGO_SECRET_KEY;
  delete process.env.NANGO_SERVER_URL;
});

describe("register(ctx) — probe safety + surface registration", () => {
  it("activates with NO host services resolvable: no throw, no I/O, surface registered", () => {
    const { ctx, registered } = makeCtx();
    expect(() => register(ctx)).not.toThrow();
    const surface = registered.find((r) => r.capability === "nango-system");
    expect(surface).toBeDefined();
    expect(surface?.provider.packageName).toBe("@cinatra-ai/nango-connector");
  });

  it("publishes the full surface member set (exact import-era names)", () => {
    const { ctx, registered } = makeCtx();
    register(ctx);
    const impl = registered.find((r) => r.capability === "nango-system")?.provider.impl as Record<
      string,
      unknown
    >;
    const expected = [
      "isNangoConfigured",
      "getNangoStatus",
      "getNangoFrontendConfig",
      "getNangoSettings",
      "getNangoSettingsEnvManaged",
      "getNangoOAuthCallbackUrl",
      "listSavedNangoConnections",
      "getPrimarySavedNangoConnection",
      "getPrimarySavedNangoConnections",
      "saveNangoConnectionRecord",
      "removeNangoConnectionRecord",
      "clearNangoConnectionRecords",
      "ensureNangoIntegration",
      "ensureNangoConnectorIntegration",
      "importNangoConnection",
      "getNangoConnection",
      "getNangoCredentials",
      "deleteNangoConnection",
      "deleteNangoConnectionStrict",
      "getNangoOAuth2IntegrationCredentials",
      "createNangoConnectSession",
      "buildBearerAuthHeaderFromNango",
      "handleNangoConnectSessionRequest",
      "handleNangoConnectionSaveRequest",
      "handleNangoWebhookRequest",
      "saveNangoConnectionAction",
      "providerConfigKeys",
      "connectionIds",
      "connectorDefinitions",
    ];
    expect(Object.keys(impl).sort()).toEqual([...expected].sort());
    // Least privilege: the raw Nango client is NOT a member.
    expect(impl).not.toHaveProperty("getNangoClient");
  });
});

describe("config-store binding", () => {
  it("purges the dead legacy key via the host service's PHYSICAL delete", () => {
    const { ctx, registry } = makeCtx();
    register(ctx);
    const host = publishHostServices(registry);

    host.store.set("nango", { secretKey: "live" });
    host.store.set("nango_connection", { secretKey: "poisoned", serverUrl: "https://evil.example" });
    const settings = getNangoSettings();
    expect(settings.secretKey).toBe("live");
    expect(host.calls.delete).toContain("nango_connection");
    expect(host.store.has("nango_connection")).toBe(false);
  });

  // NOTE: runs AFTER the purge test — the one-shot purge latch in ./nango
  // fires on the FIRST settings read in this module instance.
  it("binds reads/writes/deletes through the host connector-config service (lazy)", () => {
    const { ctx, registry } = makeCtx();
    register(ctx);
    const host = publishHostServices(registry);

    host.store.set("nango", { secretKey: "from-host-store", serverUrl: "" });
    const settings = getNangoSettings();
    expect(settings.secretKey).toBe("from-host-store");
    expect(host.calls.read).toBeGreaterThan(0);
  });
  it("FAILS LOUD when register(ctx) never ran (the sweep removed the skew fallback)", () => {
    expect(() => getNangoConfigStore().read("nango", {})).toThrow(/config store is not bound/);
  });
});

describe("materializer dispatch binding", () => {
  it("dispatches through registered host materializers and accepts handled saves", async () => {
    const { ctx, registry } = makeCtx();
    register(ctx);
    const materialized: unknown[] = [];
    registry.set("nango-connection-materializer", [
      {
        packageName: "@cinatra-ai/host",
        impl: {
          materialize: async (input: unknown) => {
            materialized.push(input);
            return { handled: true };
          },
        },
      },
    ]);
    await expect(
      materializeNangoConnection({
        connectorKey: "wordpress",
        providerConfigKey: "cinatra-wordpress",
        connectionId: "c-1",
        siteUrl: "https://example.com",
      }),
    ).resolves.toBeUndefined();
    expect(materialized).toHaveLength(1);
  });

  it("fails LOUD when bound but no provider handled the key (never a silent skip)", async () => {
    const { ctx } = makeCtx();
    register(ctx);
    await expect(
      materializeNangoConnection({
        connectorKey: "wordpress",
        providerConfigKey: "cinatra-wordpress",
        connectionId: "c-2",
        siteUrl: "https://example.com",
      }),
    ).rejects.toThrow(/no registered materializer handled/);
  });

  it("propagates a materializer failure (a failure fails the save)", async () => {
    const { ctx, registry } = makeCtx();
    register(ctx);
    registry.set("nango-connection-materializer", [
      {
        packageName: "@cinatra-ai/host",
        impl: {
          materialize: async () => {
            throw new Error("instance write failed");
          },
        },
      },
    ]);
    await expect(
      materializeNangoConnection({
        connectorKey: "linkedin",
        providerConfigKey: "cinatra-linkedin",
        connectionId: "c-3",
      }),
    ).rejects.toThrow("instance write failed");
  });
});

describe("gated save action (host action-guard service)", () => {
  it("fails CLOSED when the guard service is missing — nothing persists", async () => {
    const { ctx, registry, registered } = makeCtx();
    register(ctx);
    const host = publishHostServices(registry);
    const impl = registered.find((r) => r.capability === "nango-system")?.provider.impl as {
      saveNangoConnectionAction: (formData: FormData) => Promise<void>;
    };
    const formData = new FormData();
    formData.set("secretKey", "sk-new");
    await expect(impl.saveNangoConnectionAction(formData)).rejects.toThrow(
      /action-guard service is not registered/,
    );
    expect(host.calls.write).toBe(0);
  });

  it("runs the guard FIRST, then persists and redirects", async () => {
    const { ctx, registry, registered } = makeCtx();
    register(ctx);
    const host = publishHostServices(registry);
    const guarded: string[] = [];
    registry.set("@cinatra-ai/host:extension-action-guard", [
      {
        packageName: "@cinatra-ai/host",
        impl: {
          require: async (packageId: string, mode: string) => {
            guarded.push(`${packageId}:${mode}`);
          },
        },
      },
    ]);
    const impl = registered.find((r) => r.capability === "nango-system")?.provider.impl as {
      saveNangoConnectionAction: (formData: FormData) => Promise<void>;
    };
    const formData = new FormData();
    formData.set("secretKey", "sk-new");
    await impl.saveNangoConnectionAction(formData);
    expect(guarded).toEqual(["@cinatra-ai/nango-connector:manage"]);
    expect(host.calls.write).toBeGreaterThan(0);
    expect(redirectCalls).toEqual(["/configuration/environment?tab=connections"]);
  });

  it("a denying guard blocks persistence", async () => {
    const { ctx, registry, registered } = makeCtx();
    register(ctx);
    const host = publishHostServices(registry);
    registry.set("@cinatra-ai/host:extension-action-guard", [
      {
        packageName: "@cinatra-ai/host",
        impl: {
          require: async () => {
            throw new Error("forbidden");
          },
        },
      },
    ]);
    const impl = registered.find((r) => r.capability === "nango-system")?.provider.impl as {
      saveNangoConnectionAction: (formData: FormData) => Promise<void>;
    };
    const formData = new FormData();
    formData.set("secretKey", "sk-new");
    await expect(impl.saveNangoConnectionAction(formData)).rejects.toThrow("forbidden");
    expect(host.calls.write).toBe(0);
  });
});
