// packages/connector-nango/src/first-party-mcp.ts
//
// Low-level Nango-credential to Bearer-auth-header helper.
//
// First-party MCP connectors (Apify, Drupal, ...) call this from their
// per-connector MCP tool builder. Returns the Authorization header shape ONLY;
// LlmMcpServerTool construction stays in the connector-specific builder so
// `connector-nango` stays free of the `@cinatra-ai/llm` dep
// and preserves package direction.
//
// Returns null when:
//   - Nango is not configured (isNangoConfigured() === false)
//   - getNangoCredentials returns null
//   - the resolved credentials object has no apiKey
//   - getNangoCredentials throws (swallowed, logged via console.warn)
//
// In all "no header" cases, `label` is logged via console.warn — NEVER the
// token itself.

import { getNangoCredentials, isNangoConfigured } from "./nango";

export async function buildBearerAuthHeaderFromNango(input: {
  providerConfigKey: string;
  connectionId: string;
  /** Human-readable identifier (connector slug + per-instance suffix). Used in warn-only logging; NEVER include the token. */
  label: string;
}): Promise<{ Authorization: string } | null> {
  if (!isNangoConfigured()) {
    return null;
  }
  let credentials: unknown;
  try {
    credentials = await getNangoCredentials(input.providerConfigKey, input.connectionId);
  } catch (err) {
    console.warn(
      `[first-party-mcp] Nango credential lookup failed for ${input.label}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
  // Verify the extracted apiKey is a string before interpolating, so an
  // unexpected Nango shape can't produce `Bearer [object Object]`.
  let apiKey: string | null = null;
  if (credentials && typeof credentials === "object" && "apiKey" in credentials) {
    const candidate = (credentials as { apiKey: unknown }).apiKey;
    apiKey = typeof candidate === "string" ? candidate : null;
  } else if (typeof credentials === "string") {
    apiKey = credentials;
  }
  if (!apiKey) {
    console.warn(`[first-party-mcp] no usable apiKey in Nango credentials for ${input.label}`);
    return null;
  }
  return { Authorization: `Bearer ${apiKey}` };
}
