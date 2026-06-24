// deleteNangoConnectionStrict is the AUTHORITATIVE delete (cinatra-ai/
// tailscale-connector#23, Design C): unlike best-effort deleteNangoConnection,
// it tolerates a 404 (idempotent) but PROPAGATES any other failure so the
// caller can retain its pointer + report a failed disconnect rather than
// falsely claim the stored credential was scrubbed.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const deleteConnectionMock = vi.fn();
vi.mock("@nangohq/node", () => ({
  Nango: class {
    http = { defaults: {} as Record<string, unknown> };
    deleteConnection = deleteConnectionMock;
  },
}));
// Keep getNangoSettings() off the DB-backed store — env NANGO_SECRET_KEY drives
// isNangoConfigured()/getNangoClient().
vi.mock("../config-store", () => ({
  getNangoConfigStore: () => ({ read: () => ({}), write: () => undefined }),
}));

import { deleteNangoConnectionStrict } from "../nango";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NANGO_SECRET_KEY = "test-secret";
});
afterEach(() => {
  delete process.env.NANGO_SECRET_KEY;
});

describe("deleteNangoConnectionStrict", () => {
  it("resolves on a successful delete", async () => {
    deleteConnectionMock.mockResolvedValueOnce(undefined);
    await expect(deleteNangoConnectionStrict("pck", "c1")).resolves.toBeUndefined();
    expect(deleteConnectionMock).toHaveBeenCalledWith("pck", "c1");
  });

  it("tolerates a 404 (connection already gone) as idempotent success", async () => {
    deleteConnectionMock.mockRejectedValueOnce({ response: { status: 404 } });
    await expect(deleteNangoConnectionStrict("pck", "c1")).resolves.toBeUndefined();
  });

  it("PROPAGATES a non-404 failure (e.g. 503) so the caller can retain its pointer", async () => {
    deleteConnectionMock.mockRejectedValueOnce({
      response: { status: 503, data: { error: { message: "service unavailable" } } },
    });
    await expect(deleteNangoConnectionStrict("pck", "c1")).rejects.toThrow();
  });

  it("PROPAGATES a transport error with no HTTP status", async () => {
    deleteConnectionMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(deleteNangoConnectionStrict("pck", "c1")).rejects.toThrow();
  });

  it("FAILS CLOSED when Nango isn't configured (cannot confirm the scrub) — never calls the client", async () => {
    delete process.env.NANGO_SECRET_KEY;
    await expect(deleteNangoConnectionStrict("pck", "c1")).rejects.toThrow();
    expect(deleteConnectionMock).not.toHaveBeenCalled();
  });
});
