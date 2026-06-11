/**
 * One-shot legacy-key SANITIZATION. Earlier, the central
 * hub's `saveNangoConnectionAction` wrote Nango credentials to the dead
 * `nango_connection` connector-config key, which NO reader consumed. That writer
 * was UNGATED, so the key's values are UNTRUSTED. `purgeLegacyNangoConnectionConfig`
 * (driven lazily from `readStoredNangoSettings`, exercised here via
 * `getNangoSettings`) DELETES the dead key and NEVER promotes its values into the
 * live `nango` config — promoting a poisoned `serverUrl` would exfiltrate the live
 * bearer secret to an attacker host, and a poisoned `secretKey` would MITM the
 * workspace's OAuth. It is idempotent and fully guarded.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { store, writes, deletes } = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  writes: [] as Array<{ id: string; value: unknown }>,
  deletes: [] as string[],
}));

// Post-cutover sweep: persistence is the INJECTED config store (bound by
// register(ctx) in production; bound to a fixture here — the legacy
// @/lib/database fallback is gone).
async function bindFixtureStore() {
  const { setNangoConfigStore } = await import("../config-store");
  setNangoConfigStore({
    read: (id, fallback) => (store.has(id) ? (store.get(id) as never) : (fallback as never)),
    write: (id, value) => {
      store.set(id, value);
      writes.push({ id, value });
    },
    delete: (id) => {
      store.delete(id);
      deletes.push(id);
    },
  });
}

beforeEach(() => {
  store.clear();
  writes.length = 0;
  deletes.length = 0;
  delete process.env.NANGO_SECRET_KEY;
  delete process.env.NANGO_SERVER_URL;
  // Reset the per-module `legacyNangoKeyPurged` latch so each case starts fresh.
  vi.resetModules();
});

describe("purgeLegacyNangoConnectionConfig — DELETE-only sanitization of the dead nango_connection key", () => {
  it("deletes the dead legacy key and leaves live `nango` UNCHANGED", async () => {
    store.set("nango", { secretKey: "real-secret", serverUrl: "https://real.example" });
    store.set("nango_connection", { secretKey: "legacy", serverUrl: "https://legacy.example" });
    await bindFixtureStore();
    const { getNangoSettings } = await import("../nango");

    const settings = getNangoSettings();

    expect(settings).toEqual({ secretKey: "real-secret", serverUrl: "https://real.example" });
    expect(store.get("nango")).toEqual({ secretKey: "real-secret", serverUrl: "https://real.example" });
    expect(deletes).toContain("nango_connection");
    expect(store.has("nango_connection")).toBe(false);
    // The purge NEVER writes the live `nango` key.
    expect(writes.some((w) => w.id === "nango")).toBe(false);
  });

  it("SECURITY: never promotes a legacy serverUrl into a live secret (exfiltration guard)", async () => {
    // The old writer was ungated, so a non-admin could have seeded only a
    // poisoned serverUrl. A live secret must NOT inherit that URL — otherwise the
    // bearer secret would be sent to the attacker host on the next Nango call.
    store.set("nango", { secretKey: "real-secret" }); // live secret, no serverUrl
    store.set("nango_connection", { serverUrl: "https://attacker.example" });
    await bindFixtureStore();
    const { getNangoSettings } = await import("../nango");

    const settings = getNangoSettings();

    expect(settings.secretKey).toBe("real-secret");
    expect(settings.serverUrl).toBeUndefined();
    expect(store.get("nango")).toEqual({ secretKey: "real-secret" });
    expect(deletes).toContain("nango_connection");
  });

  it("SECURITY: never promotes a legacy secretKey into an unconfigured live (MITM guard)", async () => {
    store.set("nango_connection", { secretKey: "attacker-secret", serverUrl: "https://attacker.example" });
    await bindFixtureStore();
    const { getNangoSettings } = await import("../nango");

    const settings = getNangoSettings();

    expect(settings.secretKey).toBeUndefined();
    expect(settings.serverUrl).toBeUndefined();
    expect(store.has("nango")).toBe(false);
    expect(deletes).toContain("nango_connection");
  });

  it("deletes a blank legacy row too (no stale key left behind)", async () => {
    store.set("nango_connection", {});
    await bindFixtureStore();
    const { getNangoSettings } = await import("../nango");

    getNangoSettings();

    expect(deletes).toContain("nango_connection");
    expect(store.has("nango_connection")).toBe(false);
  });

  it("no-op when no legacy key exists (no delete)", async () => {
    store.set("nango", { secretKey: "real-secret" });
    await bindFixtureStore();
    const { getNangoSettings } = await import("../nango");

    getNangoSettings();

    expect(deletes).toHaveLength(0);
  });

  it("latches after the first read so it never re-probes the legacy key", async () => {
    store.set("nango_connection", { secretKey: "x" });
    await bindFixtureStore();
    const { getNangoSettings } = await import("../nango");

    getNangoSettings();
    const after = deletes.length;
    getNangoSettings();

    expect(deletes.length).toBe(after);
    expect(deletes).toEqual(["nango_connection"]);
  });
});
