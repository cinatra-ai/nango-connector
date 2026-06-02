// extensions/cinatra-ai/nango-connector/src/__tests__/first-party-mcp.test.ts
//
// Verifies buildBearerAuthHeaderFromNango credential handling and log redaction.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("../nango", () => ({
  getNangoCredentials: vi.fn(),
  isNangoConfigured: vi.fn(),
}));

import { getNangoCredentials, isNangoConfigured } from "../nango";
import { buildBearerAuthHeaderFromNango } from "../first-party-mcp";

const LABEL = "apify";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildBearerAuthHeaderFromNango", () => {
  it("returns null when Nango is not configured (does NOT call getNangoCredentials)", async () => {
    vi.mocked(isNangoConfigured).mockReturnValue(false);

    const result = await buildBearerAuthHeaderFromNango({
      providerConfigKey: "cinatra-apify",
      connectionId: "cinatra-apify",
      label: LABEL,
    });

    expect(result).toBeNull();
    expect(vi.mocked(getNangoCredentials)).not.toHaveBeenCalled();
  });

  it("returns the Authorization header when Nango returns { apiKey }", async () => {
    vi.mocked(isNangoConfigured).mockReturnValue(true);
    vi.mocked(getNangoCredentials).mockResolvedValueOnce({ apiKey: "token-abc" } as never);

    const result = await buildBearerAuthHeaderFromNango({
      providerConfigKey: "cinatra-apify",
      connectionId: "cinatra-apify",
      label: LABEL,
    });

    expect(result).toEqual({ Authorization: "Bearer token-abc" });
    expect(vi.mocked(getNangoCredentials)).toHaveBeenCalledWith("cinatra-apify", "cinatra-apify");
  });

  it("accepts string credentials (fallback shape) and wraps as Bearer", async () => {
    vi.mocked(isNangoConfigured).mockReturnValue(true);
    vi.mocked(getNangoCredentials).mockResolvedValueOnce("raw-string-token" as never);

    const result = await buildBearerAuthHeaderFromNango({
      providerConfigKey: "cinatra-apify",
      connectionId: "cinatra-apify",
      label: LABEL,
    });

    expect(result).toEqual({ Authorization: "Bearer raw-string-token" });
  });

  it("returns null + warns with label (NOT token) when credentials are missing apiKey", async () => {
    vi.mocked(isNangoConfigured).mockReturnValue(true);
    vi.mocked(getNangoCredentials).mockResolvedValueOnce(null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await buildBearerAuthHeaderFromNango({
      providerConfigKey: "cinatra-apify",
      connectionId: "cinatra-apify",
      label: LABEL,
    });

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const warnMessage = warn.mock.calls[0][0] as string;
    expect(warnMessage).toContain(LABEL);
  });

  it("returns null + warns (with label, NOT token) when getNangoCredentials throws", async () => {
    vi.mocked(isNangoConfigured).mockReturnValue(true);
    vi.mocked(getNangoCredentials).mockRejectedValueOnce(new Error("nango network down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await buildBearerAuthHeaderFromNango({
      providerConfigKey: "cinatra-apify",
      connectionId: "cinatra-apify",
      label: LABEL,
    });

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const warnMessage = warn.mock.calls[0][0] as string;
    expect(warnMessage).toContain(LABEL);
    expect(warnMessage).toContain("nango network down"); // exception surface ok
  });

  it("never includes a candidate token string in console.warn", async () => {
    // Regression guard: even if an internal change tried to interpolate the
    // resolved apiKey into the warn message, the test catches it.
    const CANARY_TOKEN = "SECRET_CANARY_TOKEN_DO_NOT_LEAK_INTO_LOGS_12345";
    vi.mocked(isNangoConfigured).mockReturnValue(true);
    vi.mocked(getNangoCredentials).mockResolvedValueOnce({ apiKey: CANARY_TOKEN } as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await buildBearerAuthHeaderFromNango({
      providerConfigKey: "cinatra-apify",
      connectionId: "cinatra-apify",
      label: LABEL,
    });

    // happy path returns the header; no warn at all
    expect(result).toEqual({ Authorization: `Bearer ${CANARY_TOKEN}` });
    expect(warn).not.toHaveBeenCalled();

    // explicit assertion: if any warn fired, the token would not be in it
    const allWarnPayloads = warn.mock.calls.flat().filter((c) => typeof c === "string") as string[];
    expect(allWarnPayloads.some((m) => m.includes(CANARY_TOKEN))).toBe(false);
  });
});
