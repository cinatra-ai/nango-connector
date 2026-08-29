// The OAuth callback the connector shows must equal the address Nango itself
// sends to the provider (cinatra-ai/nango-connector#63). Nango concatenates
// `serverUrl + "/oauth/callback"`, so a server published under a path prefix
// (`https://example.test/nango`) receives `https://example.test/nango/oauth/callback`.
// Resolving an ABSOLUTE path against the base URL discards that prefix and
// yields the origin-only address, which a person then registers with the
// provider and gets a redirect-uri mismatch. These regressions pin the four
// base-URL shapes from the issue plus the fallback.

import { describe, it, expect, beforeEach } from "vitest";

import { getNangoOAuthCallbackUrl } from "../nango";
import { _resetNangoConfigStoreForTests, setNangoConfigStore } from "../config-store";

const configRows = new Map<string, unknown>();

function bindStore(): void {
  _resetNangoConfigStoreForTests();
  setNangoConfigStore({
    read: (id, fallback) => (configRows.has(id) ? (configRows.get(id) as never) : (fallback as never)),
    write: (id, value) => {
      configRows.set(id, value);
    },
    delete: (id) => {
      configRows.delete(id);
    },
    resolveEnvOverrides: () => ({}),
  });
}

function setServerUrl(serverUrl?: string): void {
  configRows.clear();
  if (serverUrl !== undefined) {
    configRows.set("nango", { serverUrl });
  }
}

beforeEach(() => {
  bindStore();
});

describe("getNangoOAuthCallbackUrl — the callback keeps the server URL's base path", () => {
  it("keeps a path prefix (the shape that is wrong today)", () => {
    setServerUrl("https://example.test/nango");

    expect(getNangoOAuthCallbackUrl()).toBe("https://example.test/nango/oauth/callback");
  });

  it("keeps a path prefix carrying a trailing slash, with no doubled slash", () => {
    setServerUrl("https://example.test/nango/");

    expect(getNangoOAuthCallbackUrl()).toBe("https://example.test/nango/oauth/callback");
  });

  it("yields the origin-only callback for a bare origin", () => {
    setServerUrl("https://example.test");

    expect(getNangoOAuthCallbackUrl()).toBe("https://example.test/oauth/callback");
  });

  it("yields the origin-only callback for a bare origin carrying a trailing slash", () => {
    setServerUrl("https://example.test/");

    expect(getNangoOAuthCallbackUrl()).toBe("https://example.test/oauth/callback");
  });

  it("keeps a deeper path prefix and a non-default port", () => {
    setServerUrl("https://example.test:8443/apps/nango/");

    expect(getNangoOAuthCallbackUrl()).toBe("https://example.test:8443/apps/nango/oauth/callback");
  });

  it("drops a query string and a fragment from the base URL", () => {
    setServerUrl("https://example.test/nango?tenant=1#section");

    expect(getNangoOAuthCallbackUrl()).toBe("https://example.test/nango/oauth/callback");
  });

  it("falls back to the hosted Nango callback with no server URL configured", () => {
    setServerUrl(undefined);

    expect(getNangoOAuthCallbackUrl()).toBe("https://api.nango.dev/oauth/callback");
  });

  it("falls back to the hosted Nango callback for a blank server URL", () => {
    setServerUrl("   ");

    expect(getNangoOAuthCallbackUrl()).toBe("https://api.nango.dev/oauth/callback");
  });

  it("falls back to the hosted Nango callback for a server URL that is not an http address", () => {
    setServerUrl("ftp://example.test/nango");

    expect(getNangoOAuthCallbackUrl()).toBe("https://api.nango.dev/oauth/callback");
  });

  it("falls back to the hosted Nango callback for a server URL that is not a URL", () => {
    setServerUrl("not a url");

    expect(getNangoOAuthCallbackUrl()).toBe("https://api.nango.dev/oauth/callback");
  });
});
