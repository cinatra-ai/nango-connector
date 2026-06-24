// Locks the Tailscale OAuth-client (Design C) connector contract and its
// coexistence with the legacy API-key connector (cinatra-ai/tailscale-connector#23).

import { describe, it, expect } from "vitest";

import { NANGO_CONNECTOR_DEFINITIONS } from "../nango-connectors";
import { CINATRA_NANGO_PROVIDER_CONFIG_KEYS } from "../nango";

describe("tailscaleOauth connector definition", () => {
  it("is a Connect-UI connector on a DISTINCT provider config key from the legacy API-key one", () => {
    const oauth = NANGO_CONNECTOR_DEFINITIONS.tailscaleOauth;
    const legacy = NANGO_CONNECTOR_DEFINITIONS.tailscale;

    expect(oauth.usesConnectUI).toBe(true); // secret entered in Nango's hosted UI
    expect(oauth.providerConfigKey).toBe("cinatra-tailscale-oauth");
    expect(oauth.providerConfigKey).toBe(CINATRA_NANGO_PROVIDER_CONFIG_KEYS.tailscaleOauth);

    // Coexistence invariant: the OAuth mode never collides with the live
    // API-key integration — distinct keys, and the legacy one is untouched.
    expect(legacy.providerConfigKey).toBe("cinatra-tailscale");
    expect(legacy.usesConnectUI).toBe(false);
    expect(oauth.providerConfigKey).not.toBe(legacy.providerConfigKey);
  });

  it("shares the /connectors/tailscale management page with the legacy connector", () => {
    expect(NANGO_CONNECTOR_DEFINITIONS.tailscaleOauth.manageHref).toBe("/connectors/tailscale");
  });
});
