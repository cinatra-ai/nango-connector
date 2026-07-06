// Env-override precedence for nango's settings/secrets (cinatra-ai/cinatra#982,
// Option A). Nango KEEPS its instance-global connector-config store; the
// operator env override is resolved HOST-SIDE from the manifest and handed to
// the connector via `NangoConfigStore.resolveEnvOverrides()`. These regressions
// pin the two properties the option exists to guarantee:
//
//   1. The ACTOR-FREE read path keeps working — `getNangoSettings()` and the
//      inbound-webhook signature verify resolve the secret with NO org/actor in
//      context (the store carries no actor concept), env-first-else-DB.
//   2. An env override WINS when set; with no override the DB-stored value is
//      returned byte-equivalently (the UI-configured, no-env deployment shape).

import { createHmac } from "node:crypto";
import { describe, it, expect, beforeEach } from "vitest";

import {
  getNangoSettings,
  getNangoSettingsEnvManaged,
  getNangoFrontendConfig,
  verifyNangoWebhookSignature,
  type NangoSettings,
} from "../nango";
import { _resetNangoConfigStoreForTests, setNangoConfigStore } from "../config-store";

const configRows = new Map<string, unknown>();

/**
 * Bind a store double whose `resolveEnvOverrides()` returns exactly `env` —
 * standing in for the host resolver that reads process.env against the manifest
 * `cinatra.envOverrides`. Deliberately actor-free: `read` is a plain KV lookup
 * with NO org/actor parameter, mirroring nango's instance-global store.
 */
function bindStore(env: Record<string, string> = {}): void {
  _resetNangoConfigStoreForTests();
  setNangoConfigStore({
    read: (id, fallback) => (configRows.has(id) ? (configRows.get(id) as never) : (fallback as never)),
    write: (id, value) => {
      configRows.set(id, value);
    },
    delete: (id) => {
      configRows.delete(id);
    },
    resolveEnvOverrides: () => env,
  });
}

function setStoredSettings(value: NangoSettings): void {
  configRows.set("nango", value);
}

beforeEach(() => {
  configRows.clear();
});

describe("getNangoSettings — env-override precedence (Option A)", () => {
  it("returns the DB-stored value when NO env override is set (UI-configured deployment)", () => {
    bindStore({});
    setStoredSettings({ secretKey: "db-secret", serverUrl: "https://db.nango.example" });

    expect(getNangoSettings()).toEqual({
      secretKey: "db-secret",
      serverUrl: "https://db.nango.example",
    });
    expect(getNangoSettingsEnvManaged()).toEqual({ secretKey: false, serverUrl: false });
  });

  it("lets the env override WIN over the DB-stored value when set", () => {
    bindStore({ secretKey: "env-secret", serverUrl: "https://env.nango.example" });
    setStoredSettings({ secretKey: "db-secret", serverUrl: "https://db.nango.example" });

    expect(getNangoSettings()).toEqual({
      secretKey: "env-secret",
      serverUrl: "https://env.nango.example",
    });
    expect(getNangoSettingsEnvManaged()).toEqual({ secretKey: true, serverUrl: true });
  });

  it("applies the override per-key — an env serverUrl with a DB-only secret", () => {
    bindStore({ serverUrl: "https://env.nango.example" });
    setStoredSettings({ secretKey: "db-secret" });

    expect(getNangoSettings()).toEqual({
      secretKey: "db-secret",
      serverUrl: "https://env.nango.example",
    });
    expect(getNangoSettingsEnvManaged()).toEqual({ secretKey: false, serverUrl: true });
  });

  it("resolves the secret with NO stored row and NO actor (boot-/webhook-time env-only read)", () => {
    // No `nango` config row at all, no org/actor — the env override alone must
    // surface the secret. This is the shape the required systemExtension needs.
    bindStore({ secretKey: "env-only-secret" });

    expect(getNangoSettings().secretKey).toBe("env-only-secret");
  });
});

describe("verifyNangoWebhookSignature — actor-free env-first secret resolution", () => {
  const rawBody = JSON.stringify({ type: "auth", success: true });

  it("verifies an inbound webhook using the ENV-provided secret with no actor in context", () => {
    // The whole reason for Option A: the webhook signature check reads the
    // secret with zero org/actor. The env override must resolve here.
    bindStore({ secretKey: "env-secret" });
    // No `nango` DB row — env is the only source.
    const signature = createHmac("sha256", "env-secret").update(rawBody).digest("hex");

    expect(verifyNangoWebhookSignature(rawBody, { "X-Nango-Hmac-Sha256": signature })).toBe(true);
  });

  it("still verifies from the DB-stored secret when no env override is set", () => {
    bindStore({});
    setStoredSettings({ secretKey: "db-secret" });
    const signature = createHmac("sha256", "db-secret").update(rawBody).digest("hex");

    expect(verifyNangoWebhookSignature(rawBody, { "X-Nango-Hmac-Sha256": signature })).toBe(true);
  });

  it("rejects a signature computed with a DIFFERENT secret than the env override (fail closed)", () => {
    bindStore({ secretKey: "env-secret" });
    const signature = createHmac("sha256", "attacker-secret").update(rawBody).digest("hex");

    expect(verifyNangoWebhookSignature(rawBody, { "X-Nango-Hmac-Sha256": signature })).toBe(false);
  });
});

describe("getNangoFrontendConfig — NANGO_PUBLIC_CONNECT_URL override", () => {
  it("surfaces the host-resolved connectUrl override with no DB backing", () => {
    bindStore({ connectUrl: "https://connect.nango.example" });

    expect(getNangoFrontendConfig()).toEqual({
      apiURL: undefined,
      baseURL: "https://connect.nango.example",
    });
  });

  it("returns an empty config when neither a server URL nor a connect URL is present", () => {
    bindStore({});

    expect(getNangoFrontendConfig()).toEqual({});
  });
});
