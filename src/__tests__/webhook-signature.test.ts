// The public Nango auth webhook must verify the
// HMAC-SHA256 signature (keyed by the Nango environment API secret key — the
// scheme self-hosted nango-server actually uses) over the RAW body BEFORE
// parsing, fail closed on missing/invalid/unconfigured signature, and (codex
// correction) never mint an app-scoped pointer by omission: only re-affirm a
// connection that already exists in the authoritative Cinatra store, inheriting
// its recorded scope.
//
// Threat: an unauthenticated POST forging a successful "auth" event must NOT
// reach the state-changing save sink.

import { createHmac } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// Keep the real verifier + listSavedNangoConnections (they run over the
// injected store); mock only the network-touching readback/record write.
const { saveRecordSpy } = vi.hoisted(() => ({ saveRecordSpy: vi.fn(async () => undefined) }));
vi.mock("../nango", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../nango")>();
  return {
    ...actual,
    getNangoConnection: vi.fn(async () => ({
      end_user: { display_name: "User", email: "user@example.com" },
      credentials: { type: "OAUTH2" },
      metadata: {},
    })),
    saveNangoConnectionRecord: saveRecordSpy,
  };
});

import { handleNangoWebhookRequest } from "../route-handlers";
import { _resetNangoConfigStoreForTests, setNangoConfigStore } from "../config-store";

// Self-hosted Nango signs webhooks with the environment API secret key
// (same value as NANGO_SECRET_KEY). There is no separate webhook secret.
const API_SECRET = "api-secret";
const PROVIDER_CONFIG_KEY = "cinatra-openai"; // openai's canonical providerConfigKey

const configRows = new Map<string, unknown>();

function sign(rawBody: string, secret = API_SECRET): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

function buildWebhookRequest(rawBody: string, signature?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== undefined) {
    headers["X-Nango-Hmac-Sha256"] = signature;
  }
  return new Request("https://app.example.com/api/nango/webhook", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

const authEvent = {
  type: "auth",
  success: true,
  providerConfigKey: PROVIDER_CONFIG_KEY,
  connectionId: "existing-app-connection",
};

beforeEach(() => {
  vi.clearAllMocks();
  saveRecordSpy.mockClear();
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
  // Provision the API secret key via the store chain (env not set here);
  // webhooks are verified with this same key.
  configRows.set("nango", { secretKey: API_SECRET });
  // Seed an existing app-scope store entry so the post-verify ownership lookup
  // has something to re-affirm in the positive case.
  configRows.set("nango_connections", {
    connections: {
      openai: [
        {
          connectorKey: "openai",
          connectionId: "existing-app-connection",
          providerConfigKey: PROVIDER_CONFIG_KEY,
          connectedAt: new Date().toISOString(),
          scope: "app",
        },
      ],
    },
  });
});

describe("handleNangoWebhookRequest — signature verification (#273)", () => {
  it("rejects an UNSIGNED forged auth webhook and does NOT save", async () => {
    const raw = JSON.stringify(authEvent);
    const result = await handleNangoWebhookRequest(buildWebhookRequest(raw));
    expect(result.status).toBe(401);
    expect(saveRecordSpy).not.toHaveBeenCalled();
  });

  it("rejects a TAMPERED body whose signature no longer matches and does NOT save", async () => {
    const original = JSON.stringify(authEvent);
    const signature = sign(original);
    const tampered = JSON.stringify({ ...authEvent, connectionId: "attacker-connection" });
    const result = await handleNangoWebhookRequest(buildWebhookRequest(tampered, signature));
    expect(result.status).toBe(401);
    expect(saveRecordSpy).not.toHaveBeenCalled();
  });

  it("rejects a valid signature with trailing junk (hex truncation / length-confusion)", async () => {
    // Buffer.from(x,'hex') truncates at the first non-hex char, so a strict
    // 64-hex format check must run BEFORE decoding, else `<valid64> + 'zz'`
    // would decode to the same 32 bytes and pass.
    const raw = JSON.stringify(authEvent);
    const result = await handleNangoWebhookRequest(buildWebhookRequest(raw, `${sign(raw)}zz`));
    expect(result.status).toBe(401);
    expect(saveRecordSpy).not.toHaveBeenCalled();
  });

  it("rejects when the API secret key is UNCONFIGURED (fail closed)", async () => {
    configRows.set("nango", {}); // no secretKey → nothing to verify against
    const raw = JSON.stringify(authEvent);
    // Even a well-formed signature must be rejected when no secret is configured.
    const result = await handleNangoWebhookRequest(buildWebhookRequest(raw, sign(raw, API_SECRET)));
    expect(result.status).toBe(401);
    expect(saveRecordSpy).not.toHaveBeenCalled();
  });

  it("accepts a VALID signature and re-affirms the existing connection pointer", async () => {
    const raw = JSON.stringify(authEvent);
    const result = await handleNangoWebhookRequest(buildWebhookRequest(raw, sign(raw)));
    expect(result.status).toBeUndefined(); // 200-ok shape
    expect(result.body).toEqual({ ok: true });
    expect(saveRecordSpy).toHaveBeenCalledTimes(1);
  });

  it("with a valid signature but NO matching store entry, ignores the save (no default-to-app)", async () => {
    // Codex correction: a signed event for a connection the store has never
    // recorded must NOT mint a new app-scoped pointer.
    configRows.set("nango_connections", { connections: {} });
    const raw = JSON.stringify(authEvent);
    const result = await handleNangoWebhookRequest(buildWebhookRequest(raw, sign(raw)));
    expect(result.body).toEqual({ ok: true });
    expect(saveRecordSpy).not.toHaveBeenCalled();
  });
});
