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

import { _resetNangoConfigStoreForTests, setNangoConfigStore } from "../config-store";
import { deleteNangoConnectionStrict } from "../nango";

// Config resolves through the injected store (bound by register(ctx) in the
// real runtime; an in-memory double here — no DB). The secret arrives via the
// HOST-resolved env-override map (`resolveEnvOverrides`, cinatra-ai/cinatra#982
// Option A) — the surface that replaced this package's direct
// `process.env.NANGO_SECRET_KEY` read — and drives isNangoConfigured() /
// getNangoClient(). Mutated per test to model the unconfigured state.
let envOverrides: Record<string, string>;

beforeEach(() => {
  vi.clearAllMocks();
  envOverrides = { secretKey: "test-secret" };
  _resetNangoConfigStoreForTests();
  setNangoConfigStore({
    read: (_id, fallback) => fallback,
    write: () => undefined,
    delete: () => undefined,
    resolveEnvOverrides: () => envOverrides,
  });
});
afterEach(() => {
  _resetNangoConfigStoreForTests();
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
    expect(deleteConnectionMock).toHaveBeenCalledWith("pck", "c1");
  });

  it("PROPAGATES a non-404 failure (e.g. 503) so the caller can retain its pointer", async () => {
    deleteConnectionMock.mockRejectedValueOnce({
      response: { status: 503, data: { error: { message: "service unavailable" } } },
    });
    await expect(deleteNangoConnectionStrict("pck", "c1")).rejects.toThrow();
    // The rejection must come from the DELETE call, not an unconfigured
    // short-circuit (which would make this assertion pass vacuously).
    expect(deleteConnectionMock).toHaveBeenCalledWith("pck", "c1");
  });

  it("PROPAGATES a transport error with no HTTP status", async () => {
    deleteConnectionMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(deleteNangoConnectionStrict("pck", "c1")).rejects.toThrow();
    expect(deleteConnectionMock).toHaveBeenCalledWith("pck", "c1");
  });

  it("FAILS CLOSED when Nango isn't configured (cannot confirm the scrub) — never calls the client", async () => {
    envOverrides = {};
    await expect(deleteNangoConnectionStrict("pck", "c1")).rejects.toThrow();
    expect(deleteConnectionMock).not.toHaveBeenCalled();
  });
});
