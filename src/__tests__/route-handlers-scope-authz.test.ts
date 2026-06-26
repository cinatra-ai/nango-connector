// Defense-in-depth — the connector route handlers must treat
// a MISSING scope as the privileged `app` scope (never as an unauthenticated
// default), and must require a server-validated userId for user scope. The
// host route is the primary authz boundary; this is the connector-side backstop.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const { createConnectSessionSpy, saveConnectorConnectionSpy } = vi.hoisted(() => ({
  createConnectSessionSpy: vi.fn(async (input: unknown) => ({ input, body: { sessionToken: "tok" } })),
  saveConnectorConnectionSpy: vi.fn(async (input: unknown) => ({ input })),
}));

vi.mock("../nango-connect-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../nango-connect-ui")>();
  return {
    ...actual,
    createNangoConnectSession: createConnectSessionSpy,
    saveNangoConnectorConnection: saveConnectorConnectionSpy,
  };
});

import {
  handleNangoConnectSessionRequest,
  handleNangoConnectionSaveRequest,
} from "../route-handlers";

function jsonRequest(body: unknown): Request {
  return new Request("https://app.example.com/api/nango/connect/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleNangoConnectSessionRequest — scope normalization", () => {
  it("treats a MISSING scope as privileged app (forwards scope:'app', no userId leak)", async () => {
    await handleNangoConnectSessionRequest(jsonRequest({ connectorKey: "openai" }), {
      userId: "u1",
    });
    expect(createConnectSessionSpy).toHaveBeenCalledTimes(1);
    const arg = createConnectSessionSpy.mock.calls[0][0] as { scope?: string; userId?: string };
    expect(arg.scope).toBe("app");
    expect(arg.userId).toBeUndefined();
  });

  it("DENIES a user-scope connect session with no validated userId", async () => {
    const result = await handleNangoConnectSessionRequest(
      jsonRequest({ connectorKey: "openai", scope: "user" }),
      {},
    );
    expect(result.status).toBe(400);
    expect(createConnectSessionSpy).not.toHaveBeenCalled();
  });

  it("forwards the validated userId for user scope", async () => {
    await handleNangoConnectSessionRequest(
      jsonRequest({ connectorKey: "openai", scope: "user" }),
      { userId: "u1", userEmail: "u1@example.com" },
    );
    const arg = createConnectSessionSpy.mock.calls[0][0] as { scope?: string; userId?: string };
    expect(arg.scope).toBe("user");
    expect(arg.userId).toBe("u1");
  });
});

describe("handleNangoConnectionSaveRequest — scope normalization", () => {
  it("treats a MISSING scope as privileged app", async () => {
    await handleNangoConnectionSaveRequest(
      jsonRequest({ connectorKey: "openai", providerConfigKey: "cinatra-openai", connectionId: "c1" }),
      { userId: "u1" },
    );
    const arg = saveConnectorConnectionSpy.mock.calls[0][0] as { scope?: string; userId?: string };
    expect(arg.scope).toBe("app");
    expect(arg.userId).toBeUndefined();
  });

  it("DENIES a user-scope save with no validated userId", async () => {
    const result = await handleNangoConnectionSaveRequest(
      jsonRequest({ connectorKey: "openai", providerConfigKey: "cinatra-openai", connectionId: "c1", scope: "user" }),
      {},
    );
    expect(result.status).toBe(400);
    expect(saveConnectorConnectionSpy).not.toHaveBeenCalled();
  });
});
