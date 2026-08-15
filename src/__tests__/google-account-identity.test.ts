// cinatra-ai/cinatra#2766 — the "Connected as …" label must name the AUTHORIZED
// GOOGLE ACCOUNT, never the Cinatra app login.
//
// The regression these tests pin: the saved connection record copied its
// email/displayName from the Nango `end_user`, which is tagged with the app
// session user at connect time. On the reported instance the app login was
// `marcus@horndt.de` while the authorized Google account was
// `marcushorndt@gmail.com`, so every Google connector card asserted the wrong
// identity.
//
// NO LIVE GOOGLE REPRO IS POSSIBLE on any lane host — no Google credentials are
// present and none may be introduced. Every payload below is a recorded, real-
// SHAPED Google `userinfo` response (OIDC v3 and the older v2 shape) and a
// real-shaped Google OAuth token `raw` scope string.

import { describe, expect, it, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";

import {
  GOOGLE_USERINFO_EMAIL_SCOPE,
  isGoogleAccountIdentityConnector,
  isGoogleUserinfoEmailScopeGranted,
  parseGoogleUserinfoProfile,
  readGrantedGoogleScopes,
  resolveGoogleAccountIdentity,
} from "../google-account-identity";
import { setNangoConfigStore, _resetNangoConfigStoreForTests } from "../config-store";

// ---------------------------------------------------------------------------
// Recorded, real-shaped fixtures
// ---------------------------------------------------------------------------

/** Google OIDC userinfo with ONLY `userinfo.email` granted. */
const USERINFO_V3_EMAIL_ONLY = {
  sub: "110169484474386276334",
  email: "marcushorndt@gmail.com",
  email_verified: true,
};

/** Google OIDC userinfo with `userinfo.email` + a profile scope granted. */
const USERINFO_V3_WITH_PROFILE = {
  sub: "110169484474386276334",
  name: "Marcus Horndt",
  given_name: "Marcus",
  family_name: "Horndt",
  picture: "https://lh3.googleusercontent.com/a/ACg8ocKexample=s96-c",
  email: "marcushorndt@gmail.com",
  email_verified: true,
};

/** The older `oauth2/v2/userinfo` shape (`id` / `verified_email`). */
const USERINFO_V2 = {
  id: "110169484474386276334",
  email: "marcushorndt@gmail.com",
  verified_email: true,
  picture: "https://lh3.googleusercontent.com/a/ACg8ocKexample=s96-c",
};

/** The APP LOGIN — the value the defect displayed. It must never be produced. */
const APP_LOGIN_EMAIL = "marcus@horndt.de";

function connectionWithScopes(scope: string) {
  return {
    credentials: {
      type: "OAUTH2",
      access_token: "redacted-not-a-real-token",
      raw: {
        access_token: "redacted-not-a-real-token",
        expires_in: 3599,
        scope,
        token_type: "Bearer",
      },
    },
    end_user: { id: "cinatra-user-1", email: APP_LOGIN_EMAIL, display_name: "Marcus Horndt" },
  };
}

const SCOPES_YOUTUBE_WITH_USERINFO =
  "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/userinfo.email openid";
const SCOPES_YOUTUBE_WITHOUT_USERINFO = "https://www.googleapis.com/auth/youtube.readonly";

// ---------------------------------------------------------------------------

describe("connector coverage", () => {
  it("treats every Google connector as a Google-account-identity connector", () => {
    for (const key of ["gmail", "googleCalendar", "googleOAuth", "youtube"] as const) {
      expect(isGoogleAccountIdentityConnector(key)).toBe(true);
    }
  });

  it("leaves non-Google connectors on the end_user identity", () => {
    for (const key of ["openai", "github", "linkedin", "wordpress", "apollo"] as const) {
      expect(isGoogleAccountIdentityConnector(key)).toBe(false);
    }
  });
});

describe("requested scope sets", () => {
  // YouTube's requested scope set did NOT include userinfo.email before #2766,
  // so its card could never name the Google account. Asserted against the
  // source because the per-connector scope constants are module-private.
  it("every Google integration requests userinfo.email", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const src = readFileSync(path.join(__dirname, "..", "nango-connect-ui.ts"), "utf8");

    for (const constant of [
      "GOOGLE_NANGO_SCOPES",
      "GMAIL_NANGO_SCOPES",
      "GOOGLE_CALENDAR_NANGO_SCOPES",
      "YOUTUBE_NANGO_SCOPES",
    ]) {
      const block = src.slice(src.indexOf(`const ${constant}`));
      const declaration = block.slice(0, block.indexOf('.join(","'));
      expect(declaration, `${constant} must request ${GOOGLE_USERINFO_EMAIL_SCOPE}`).toContain(
        GOOGLE_USERINFO_EMAIL_SCOPE,
      );
    }
  });
});

describe("readGrantedGoogleScopes", () => {
  it("splits the space-delimited scope string Google returns in credentials.raw", () => {
    expect(readGrantedGoogleScopes(connectionWithScopes(SCOPES_YOUTUBE_WITH_USERINFO))).toEqual([
      "https://www.googleapis.com/auth/youtube.readonly",
      GOOGLE_USERINFO_EMAIL_SCOPE,
      "openid",
    ]);
  });

  it("reports UNKNOWN (null), not empty, when the connection carries no scope record", () => {
    expect(readGrantedGoogleScopes({ credentials: { type: "OAUTH2", raw: {} } })).toBeNull();
    expect(readGrantedGoogleScopes(null)).toBeNull();
    expect(readGrantedGoogleScopes(undefined)).toBeNull();
  });

  it("reads a scopes array from connection_config as a fallback", () => {
    expect(
      readGrantedGoogleScopes({
        connection_config: { scopes: ["https://www.googleapis.com/auth/gmail.send", GOOGLE_USERINFO_EMAIL_SCOPE] },
      }),
    ).toEqual(["https://www.googleapis.com/auth/gmail.send", GOOGLE_USERINFO_EMAIL_SCOPE]);
  });
});

describe("isGoogleUserinfoEmailScopeGranted", () => {
  it("is true when the granted scope set contains userinfo.email", () => {
    expect(isGoogleUserinfoEmailScopeGranted(connectionWithScopes(SCOPES_YOUTUBE_WITH_USERINFO))).toBe(true);
  });

  it("is false when a KNOWN scope set omits userinfo.email", () => {
    expect(isGoogleUserinfoEmailScopeGranted(connectionWithScopes(SCOPES_YOUTUBE_WITHOUT_USERINFO))).toBe(false);
  });

  it("is true when scope information is absent (unknown ≠ not granted)", () => {
    expect(isGoogleUserinfoEmailScopeGranted({ credentials: { type: "OAUTH2", raw: {} } })).toBe(true);
  });
});

describe("parseGoogleUserinfoProfile", () => {
  it("reads the email from the email-only OIDC v3 payload", () => {
    expect(parseGoogleUserinfoProfile(USERINFO_V3_EMAIL_ONLY)).toEqual({
      email: "marcushorndt@gmail.com",
    });
  });

  it("reads email + display name when a profile scope was also granted", () => {
    expect(parseGoogleUserinfoProfile(USERINFO_V3_WITH_PROFILE)).toEqual({
      email: "marcushorndt@gmail.com",
      displayName: "Marcus Horndt",
    });
  });

  it("reads the older v2 payload shape", () => {
    expect(parseGoogleUserinfoProfile(USERINFO_V2)).toEqual({ email: "marcushorndt@gmail.com" });
  });

  it("refuses an email Google explicitly marks unverified", () => {
    expect(parseGoogleUserinfoProfile({ ...USERINFO_V3_EMAIL_ONLY, email_verified: false })).toEqual({});
    expect(parseGoogleUserinfoProfile({ ...USERINFO_V2, verified_email: false })).toEqual({});
  });

  it("returns nothing for an unusable payload rather than a partial identity", () => {
    expect(parseGoogleUserinfoProfile(null)).toEqual({});
    expect(parseGoogleUserinfoProfile("not json")).toEqual({});
    expect(parseGoogleUserinfoProfile({ sub: "1", name: "Marcus Horndt" })).toEqual({});
    expect(parseGoogleUserinfoProfile({ email: "   " })).toEqual({});
  });
});

describe("resolveGoogleAccountIdentity", () => {
  it("profile present → the AUTHORIZED Google account, not the app login", async () => {
    const identity = await resolveGoogleAccountIdentity({
      connection: connectionWithScopes(SCOPES_YOUTUBE_WITH_USERINFO),
      fetchUserinfo: async () => USERINFO_V3_WITH_PROFILE,
    });

    expect(identity).toEqual({ email: "marcushorndt@gmail.com", displayName: "Marcus Horndt" });
    expect(identity.email).not.toBe(APP_LOGIN_EMAIL);
  });

  it("profile fetch fails → NO email (never the app-login fallback)", async () => {
    const identity = await resolveGoogleAccountIdentity({
      connection: connectionWithScopes(SCOPES_YOUTUBE_WITH_USERINFO),
      fetchUserinfo: async () => {
        throw new Error("Request failed with status code 403");
      },
    });

    expect(identity).toEqual({});
    expect(identity.email).toBeUndefined();
  });

  it("scope not granted → NO email, and Google is not called", async () => {
    const fetchUserinfo = vi.fn(async () => USERINFO_V3_EMAIL_ONLY);

    const identity = await resolveGoogleAccountIdentity({
      connection: connectionWithScopes(SCOPES_YOUTUBE_WITHOUT_USERINFO),
      fetchUserinfo,
    });

    expect(identity).toEqual({});
    expect(fetchUserinfo).not.toHaveBeenCalled();
  });

  it("scope unknown → still attempts the read (Google is then the authority)", async () => {
    const fetchUserinfo = vi.fn(async () => USERINFO_V3_EMAIL_ONLY);

    const identity = await resolveGoogleAccountIdentity({
      connection: { credentials: { type: "OAUTH2", raw: {} } },
      fetchUserinfo,
    });

    expect(fetchUserinfo).toHaveBeenCalledTimes(1);
    expect(identity.email).toBe("marcushorndt@gmail.com");
  });

  it("no Google name (userinfo.email alone) → displayName is the Google address, never the app user's name", async () => {
    const identity = await resolveGoogleAccountIdentity({
      connection: connectionWithScopes(SCOPES_YOUTUBE_WITH_USERINFO),
      fetchUserinfo: async () => USERINFO_V3_EMAIL_ONLY,
    });

    // `Connected as <displayName>` is an ACCOUNT label too, so it must never
    // keep the end_user's "Marcus Horndt" (the app user's display name).
    expect(identity).toEqual({
      email: "marcushorndt@gmail.com",
      displayName: "marcushorndt@gmail.com",
    });
  });

  it("an unusable payload yields NO identity at all", async () => {
    const identity = await resolveGoogleAccountIdentity({
      connection: connectionWithScopes(SCOPES_YOUTUBE_WITH_USERINFO),
      fetchUserinfo: async () => ({ error: "invalid_token" }),
    });

    expect(identity).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// The shared write path: saveNangoConnectorConnection must persist the Google
// identity, and must CLEAR (not fall back) when it cannot be resolved.
// ---------------------------------------------------------------------------

const savedRecords: Array<{ connectorKey: string; record: Record<string, unknown> }> = [];
const getNangoConnectionMock = vi.fn();
const fetchGoogleUserinfoProfileMock = vi.fn();

vi.mock("../nango", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../nango")>();
  return {
    ...actual,
    getNangoConnection: (...args: unknown[]) => getNangoConnectionMock(...args),
    fetchGoogleUserinfoProfile: (...args: unknown[]) => fetchGoogleUserinfoProfileMock(...args),
    saveNangoConnectionRecord: async (connectorKey: string, record: Record<string, unknown>) => {
      savedRecords.push({ connectorKey, record });
    },
  };
});

beforeAll(() => {
  setNangoConfigStore({
    read: (_id, fallback) => fallback,
    write: () => {},
    delete: () => {},
  });
});
afterAll(() => {
  _resetNangoConfigStoreForTests();
});

beforeEach(() => {
  savedRecords.length = 0;
  getNangoConnectionMock.mockReset();
  fetchGoogleUserinfoProfileMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("saveNangoConnectorConnection — Google account identity", () => {
  const googleConnectors = [
    { key: "gmail", providerConfigKey: "cinatra-gmail" },
    { key: "googleCalendar", providerConfigKey: "cinatra-google-calendar" },
    { key: "youtube", providerConfigKey: "cinatra-youtube" },
    { key: "googleOAuth", providerConfigKey: "cinatra-google-oauth" },
  ] as const;

  for (const { key, providerConfigKey } of googleConnectors) {
    it(`${key}: persists the authorized Google account, not the app login`, async () => {
      const { saveNangoConnectorConnection } = await import("../nango-connect-ui");

      getNangoConnectionMock.mockResolvedValue(connectionWithScopes(SCOPES_YOUTUBE_WITH_USERINFO));
      fetchGoogleUserinfoProfileMock.mockResolvedValue(USERINFO_V3_WITH_PROFILE);

      await saveNangoConnectorConnection({
        connectorKey: key,
        providerConfigKey,
        connectionId: `${key}-connection`,
      });

      expect(savedRecords).toHaveLength(1);
      expect(savedRecords[0].record.email).toBe("marcushorndt@gmail.com");
      expect(savedRecords[0].record.email).not.toBe(APP_LOGIN_EMAIL);
      expect(savedRecords[0].record.displayName).toBe("Marcus Horndt");
      expect(fetchGoogleUserinfoProfileMock).toHaveBeenCalledWith(providerConfigKey, `${key}-connection`);
    });
  }

  it("clears the email when the profile read fails — no app-login fallback", async () => {
    const { saveNangoConnectorConnection } = await import("../nango-connect-ui");

    getNangoConnectionMock.mockResolvedValue(connectionWithScopes(SCOPES_YOUTUBE_WITH_USERINFO));
    fetchGoogleUserinfoProfileMock.mockRejectedValue(new Error("Request failed with status code 403"));

    await saveNangoConnectorConnection({
      connectorKey: "gmail",
      providerConfigKey: "cinatra-gmail",
      connectionId: "gmail-connection",
    });

    expect(savedRecords).toHaveLength(1);
    expect(savedRecords[0].record.email).toBeUndefined();
    expect(savedRecords[0].record.displayName).toBeUndefined();
  });

  it("clears the email when the granted scopes omit userinfo.email", async () => {
    const { saveNangoConnectorConnection } = await import("../nango-connect-ui");

    getNangoConnectionMock.mockResolvedValue(connectionWithScopes(SCOPES_YOUTUBE_WITHOUT_USERINFO));

    await saveNangoConnectorConnection({
      connectorKey: "youtube",
      providerConfigKey: "cinatra-youtube",
      connectionId: "youtube-connection",
    });

    expect(savedRecords).toHaveLength(1);
    expect(savedRecords[0].record.email).toBeUndefined();
    expect(fetchGoogleUserinfoProfileMock).not.toHaveBeenCalled();
  });

  it("non-Google connectors keep the end_user identity (their app-level credential)", async () => {
    const { saveNangoConnectorConnection } = await import("../nango-connect-ui");

    getNangoConnectionMock.mockResolvedValue({
      credentials: { type: "API_KEY", raw: {} },
      end_user: { id: "cinatra-local-user", email: APP_LOGIN_EMAIL, display_name: "Cinatra User" },
    });

    await saveNangoConnectorConnection({
      connectorKey: "openai",
      providerConfigKey: "cinatra-openai",
      connectionId: "cinatra-openai",
    });

    expect(savedRecords).toHaveLength(1);
    expect(savedRecords[0].record.email).toBe(APP_LOGIN_EMAIL);
    expect(fetchGoogleUserinfoProfileMock).not.toHaveBeenCalled();
  });
});
