// Verifies the schema-driven `multiple` flag lookup used by
// importNangoConnection. The lookup must come from connector definitions
// rather than connector-key special cases.
//
// This catches data-shape mistakes: if anyone adds a new multi-tenant
// connector and forgets `multiple: true`, this test fails and points at it.
// importNangoConnection itself reads NANGO_CONNECTOR_DEFINITIONS via dynamic
// import (to avoid circular dep with nango.ts), so locking the data shape
// here locks the dispatch behavior end-to-end.

import { describe, expect, it } from "vitest";

import { NANGO_CONNECTOR_DEFINITIONS } from "../nango-connectors";
import type { NangoConnectorKey } from "../nango";

const EXPECTED_MULTIPLE: Record<NangoConnectorKey, boolean> = {
  // Multi-tenant: one Nango connection per logical instance.
  a2aServer: true,
  drupal: true,
  linkedin: true,
  wordpress: true,
  // Single-tenant: one workspace-wide connection.
  apify: false,
  apollo: false,
  claude: false,
  gemini: false,
  github: false,
  gmail: false,
  googleCalendar: false,
  googleOAuth: false,
  openai: false,
  // Single app-level OAuth client. Per-clone auth keys are minted directly
  // via the Tailscale API, not stored per-instance in Nango.
  tailscale: false,
  youtube: false,
};

describe("NANGO_CONNECTOR_DEFINITIONS — schema-driven multiple-flag lookup", () => {
  it.each(Object.entries(EXPECTED_MULTIPLE) as Array<[NangoConnectorKey, boolean]>)(
    "%s resolves to multiple=%s via the lookup pattern importNangoConnection uses",
    (connectorKey, expected) => {
      // Mirror the exact dispatch expression at packages/connector-nango/src/nango.ts:
      //   const multiple = NANGO_CONNECTOR_DEFINITIONS[input.connectorKey]?.multiple ?? false;
      const actual = NANGO_CONNECTOR_DEFINITIONS[connectorKey]?.multiple ?? false;
      expect(actual).toBe(expected);
    },
  );

  it("every NangoConnectorKey appears in NANGO_CONNECTOR_DEFINITIONS (Record<NangoConnectorKey,…> totality)", () => {
    const declared = new Set(Object.keys(NANGO_CONNECTOR_DEFINITIONS) as NangoConnectorKey[]);
    for (const key of Object.keys(EXPECTED_MULTIPLE) as NangoConnectorKey[]) {
      expect(declared.has(key)).toBe(true);
    }
    // Reverse direction — no orphan keys in the definitions.
    expect(declared.size).toBe(Object.keys(EXPECTED_MULTIPLE).length);
  });
});
