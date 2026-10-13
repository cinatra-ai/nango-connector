// The connection service client follows no redirect: a 3xx answer fails the
// call, so requests go only to the configured service address. The cases run
// the real client against local servers on the loopback interface.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { getNangoClient, importNangoConnection } from "../nango";
import { _resetNangoConfigStoreForTests, setNangoConfigStore } from "../config-store";

const servers: Server[] = [];

/** Starts a server on the loopback interface at a free port and answers its base address. */
async function startServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
  const port = (server.address() as AddressInfo).port;
  return `http://localhost:${port}`;
}

/** Binds the settings store with the service address the client uses. */
function bindSettings(serverUrl: string): void {
  const rows = new Map<string, unknown>([["nango", { secretKey: "loopback-test-key", serverUrl }]]);
  setNangoConfigStore({
    read: (id, fallback) => (rows.has(id) ? (rows.get(id) as never) : (fallback as never)),
    write: (id, value) => {
      rows.set(id, value);
    },
    delete: (id) => {
      rows.delete(id);
    },
    resolveEnvOverrides: () => ({}),
  });
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  _resetNangoConfigStoreForTests();
});

describe("getNangoClient", () => {
  it("the client it builds follows no redirect", async () => {
    const address = await startServer((req, res) => {
      req.resume();
      req.on("end", () => res.end());
    });
    bindSettings(address);

    const client = getNangoClient();

    expect(client.http.defaults.maxRedirects).toBe(0);
    expect(client.http.defaults.proxy).toBe(false);
  });

  it.each([307, 308])("a connection write answered with %i fails and the second server receives no request", async (status) => {
    let secondCount = 0;
    const second = await startServer((req, res) => {
      secondCount += 1;
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    let firstCount = 0;
    const first = await startServer((req, res) => {
      firstCount += 1;
      req.resume();
      req.on("end", () => {
        res.writeHead(status, { location: second + "/connections" });
        res.end();
      });
    });
    bindSettings(first);

    await expect(
      importNangoConnection({
        providerConfigKey: "example-integration",
        connectionId: "example-connection",
        credentials: { type: "API_KEY", apiKey: "loopback-test-api-key" },
      }),
    ).rejects.toThrow();
    expect(firstCount).toBe(1);
    expect(secondCount).toBe(0);
  });
});
