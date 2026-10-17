// LinkedIn scope set per app kind.
//
// A LinkedIn app with the Community Management API (CM) carries no other
// product — LinkedIn requires CM to be the only product on its app — so it has
// no OpenID scopes, and an authorize request that names openid/profile/email
// fails with "Invalid scope". When the admin form set
// `organizationPosting: true` on the shared "linkedin" row, the integration
// this connector PATCHes before every Connect session must carry only
// CM-granted scopes. Without the flag the OpenID + Share set stays exactly as
// it was.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { configRows } = vi.hoisted(() => ({
  configRows: new Map<string, unknown>(),
}));

vi.mock("server-only", () => ({}));

vi.mock("../nango", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../nango")>();
  return {
    ...actual,
    getNangoOAuth2IntegrationCredentials: vi.fn(async () => null),
    isNangoConfigured: vi.fn(() => true),
    ensureNangoIntegration: vi.fn(async (input: unknown) => input),
  };
});

import { ensureNangoConnectorIntegration } from "../nango-connect-ui";
import { ensureNangoIntegration, getNangoOAuth2IntegrationCredentials } from "../nango";
import { _resetNangoConfigStoreForTests, setNangoConfigStore } from "../config-store";

beforeEach(() => {
  vi.clearAllMocks();
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
  vi.mocked(getNangoOAuth2IntegrationCredentials).mockResolvedValue(null);
});

function appliedLinkedInScopes(): string[] {
  const call = vi.mocked(ensureNangoIntegration).mock.calls.at(-1)?.[0] as
    | { provider?: string; credentials?: { scopes?: string } }
    | undefined;
  expect(call?.provider).toBe("linkedin");
  return String(call?.credentials?.scopes ?? "").split(",");
}

describe("linkedin integration scopes per app kind", () => {
  it("a Community Management app (organizationPosting: true) gets only CM-granted scopes, no OpenID scope", async () => {
    configRows.set("linkedin", { clientId: "cm-id", clientSecret: "cm-secret", organizationPosting: true });
    await ensureNangoConnectorIntegration("linkedin");
    const scopes = appliedLinkedInScopes();
    expect(scopes).toEqual([
      "r_basicprofile",
      "w_member_social",
      "rw_organization_admin",
      "w_organization_social",
      "r_organization_social",
    ]);
    for (const openIdScope of ["openid", "profile", "email"]) {
      expect(scopes).not.toContain(openIdScope);
    }
  });

  it("an OpenID + Share app (no flag) keeps the unchanged OpenID set", async () => {
    configRows.set("linkedin", { clientId: "oidc-id", clientSecret: "oidc-secret" });
    await ensureNangoConnectorIntegration("linkedin");
    expect(appliedLinkedInScopes()).toEqual(["openid", "profile", "email", "w_member_social"]);
  });

  it("only a boolean true selects the CM set (a stray string keeps the OpenID set)", async () => {
    configRows.set("linkedin", { clientId: "oidc-id", clientSecret: "oidc-secret", organizationPosting: "true" });
    await ensureNangoConnectorIntegration("linkedin");
    expect(appliedLinkedInScopes()).toEqual(["openid", "profile", "email", "w_member_social"]);
  });

  it("a CM app saved over an older OpenID integration PATCHes the row's CM pair, with no OpenID scope", async () => {
    vi.mocked(getNangoOAuth2IntegrationCredentials).mockResolvedValue({
      clientId: "oidc-nango-id",
      clientSecret: "oidc-nango-secret",
    });
    configRows.set("linkedin", { clientId: "cm-id", clientSecret: "cm-secret", organizationPosting: true });
    await ensureNangoConnectorIntegration("linkedin");
    const call = vi.mocked(ensureNangoIntegration).mock.calls.at(-1)?.[0] as
      | { credentials?: { client_id?: string; client_secret?: string; scopes?: string } }
      | undefined;
    expect(call?.credentials?.client_id).toBe("cm-id");
    expect(call?.credentials?.client_secret).toBe("cm-secret");
    expect(String(call?.credentials?.scopes ?? "").split(",")).not.toContain("openid");
  });

  it("with the flag on and only a client id on the row, Connect stops before any PATCH (fails closed)", async () => {
    vi.mocked(getNangoOAuth2IntegrationCredentials).mockResolvedValue({
      clientId: "oidc-nango-id",
      clientSecret: "oidc-nango-secret",
    });
    configRows.set("linkedin", { clientId: "cm-id", organizationPosting: true });
    await expect(ensureNangoConnectorIntegration("linkedin")).rejects.toThrow(
      "Save the LinkedIn client ID and client secret first.",
    );
    expect(vi.mocked(ensureNangoIntegration)).not.toHaveBeenCalled();
  });
});
