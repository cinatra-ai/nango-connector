// Google connection ACCOUNT IDENTITY (cinatra-ai/cinatra#2766).
//
// THE DEFECT this module exists to remove: every Google connector's setup card
// rendered `Connected as <app-login email>`. The saved connection record's
// `email`/`displayName` were copied from the Nango `end_user`, and the
// `end_user` is tagged with the CINATRA SESSION USER at connect time (see
// `createNangoConnectSession`). So the card showed the local login, not the
// Google account the operator actually authorized in the consent screen. When
// those two differ (the reported case: app login `…@horndt.de`, authorized
// Google account `…@gmail.com`) the UI silently asserted the wrong identity.
//
// THE RULE, and it is not negotiable: the "Connected as" label is the
// AUTHORIZED THIRD-PARTY ACCOUNT — never the local login. The end_user keeps
// its real job (OWNERSHIP: which Cinatra user owns this connection, used for
// user-scope filtering); it is simply never again used as the account label.
//
// THE SOURCE: the Google `userinfo` profile, read back for the granted
// `https://www.googleapis.com/auth/userinfo.email` scope. The read goes
// through the Nango proxy, so the access token never leaves Nango.
//
// FAIL-CLOSED: when the profile cannot be resolved (scope not granted, proxy
// or Google error, unusable payload) the resolver reports NO email, and the
// label degrades to a bare "Connected". It MUST NOT fall back to the app-login
// email — that fallback IS the misleading state this fix removes, and a
// fallback would make the defect unobservable rather than fixed.

import type { NangoConnectorKey } from "./nango";

/** The Google scope that authorizes reading the account's email address. */
export const GOOGLE_USERINFO_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";

/**
 * Nango proxy target for the profile read. `oauth2/v3/userinfo` is Google's
 * OIDC-shaped userinfo endpoint on the googleapis.com host; with only
 * `userinfo.email` granted it answers `{ sub, email, email_verified }`, and
 * adds `name`/`picture` when a profile scope is also granted.
 */
export const GOOGLE_USERINFO_BASE_URL = "https://www.googleapis.com";
export const GOOGLE_USERINFO_ENDPOINT = "/oauth2/v3/userinfo";

/**
 * The connectors whose account label is a GOOGLE account. One list, so the fix
 * lands once for Gmail / Calendar / YouTube / the shared Google OAuth
 * connection rather than being re-derived (and re-broken) per connector.
 */
const GOOGLE_ACCOUNT_IDENTITY_CONNECTOR_KEYS = new Set<NangoConnectorKey>([
  "gmail",
  "googleCalendar",
  "googleOAuth",
  "youtube",
]);

export function isGoogleAccountIdentityConnector(connectorKey: NangoConnectorKey): boolean {
  return GOOGLE_ACCOUNT_IDENTITY_CONNECTOR_KEYS.has(connectorKey);
}

export type GoogleAccountIdentity = {
  /** The authorized Google account's email, or undefined when unresolvable. */
  email?: string;
  /** The authorized Google account's display name, when the payload carries one. */
  displayName?: string;
};

/** Shape of the Nango connection fields this module reads. Structural on
 * purpose — the SDK's connection type is a wide union and only these members
 * matter here. */
export type GoogleIdentityConnectionLike = {
  credentials?: unknown;
  connection_config?: unknown;
} | null | undefined;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function normalizeScopeValue(value: unknown): string[] | null {
  if (typeof value === "string") {
    const parts = value.split(/[\s,]+/).filter(Boolean);
    return parts.length ? parts : null;
  }
  if (Array.isArray(value)) {
    const parts = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
    return parts.length ? parts : null;
  }
  return null;
}

/**
 * The scopes Google actually GRANTED for this connection, or `null` when the
 * connection carries no scope information at all.
 *
 * `null` is deliberately distinct from `[]`: an absent scope record means
 * UNKNOWN, not "nothing granted". The caller treats unknown as "attempt the
 * read" (Google is then the authority and answers 403 if the scope is missing);
 * only a PRESENT scope list that omits `userinfo.email` skips the call.
 */
export function readGrantedGoogleScopes(connection: GoogleIdentityConnectionLike): string[] | null {
  const record = asRecord(connection);
  if (!record) return null;

  const credentials = asRecord(record.credentials);
  const raw = asRecord(credentials?.raw);
  const connectionConfig = asRecord(record.connection_config);

  return (
    normalizeScopeValue(raw?.scope) ??
    normalizeScopeValue(raw?.scopes) ??
    normalizeScopeValue(credentials?.scope) ??
    normalizeScopeValue(connectionConfig?.scope) ??
    normalizeScopeValue(connectionConfig?.scopes) ??
    null
  );
}

/**
 * `false` only when the connection PROVES the scope is absent. Unknown scope
 * information yields `true` so a granted-but-unreported scope still resolves an
 * identity rather than silently degrading to "Connected".
 */
export function isGoogleUserinfoEmailScopeGranted(connection: GoogleIdentityConnectionLike): boolean {
  const granted = readGrantedGoogleScopes(connection);
  if (granted === null) return true;
  return granted.includes(GOOGLE_USERINFO_EMAIL_SCOPE);
}

/**
 * Read a Google userinfo payload into the account identity. Accepts both the
 * OIDC v3 shape (`{ sub, email, email_verified, name }`) and the older v2 shape
 * (`{ id, email, verified_email, name }`).
 *
 * An unverified email is REFUSED: `email_verified: false` means Google does not
 * vouch for the address, so labelling a connection with it would repeat the
 * "asserts an identity it cannot back" defect in a new form. A payload that
 * simply omits the verification flag is accepted (the flag is absent from some
 * responses), only an explicit `false` is refused.
 */
export function parseGoogleUserinfoProfile(payload: unknown): GoogleAccountIdentity {
  const record = asRecord(payload);
  if (!record) return {};

  const verified = record.email_verified ?? record.verified_email;
  if (verified === false || verified === "false") {
    return {};
  }

  const rawEmail = record.email;
  const email = typeof rawEmail === "string" && rawEmail.trim() ? rawEmail.trim() : undefined;

  const rawName = record.name;
  const displayName = typeof rawName === "string" && rawName.trim() ? rawName.trim() : undefined;

  // No email means no identity: a bare display name would still leave the card
  // unable to say WHICH Google account is connected.
  if (!email) return {};

  return displayName ? { email, displayName } : { email };
}

/**
 * Resolve the authorized Google account for a connection.
 *
 * `fetchUserinfo` is injected so the resolver is testable without the Nango
 * SDK, and so the only network path stays the Nango proxy (the token never
 * leaves Nango).
 *
 * Returns `{}` — NOT the app-login identity — on every failure mode.
 */
export async function resolveGoogleAccountIdentity(input: {
  connection: GoogleIdentityConnectionLike;
  fetchUserinfo: () => Promise<unknown>;
}): Promise<GoogleAccountIdentity> {
  if (!isGoogleUserinfoEmailScopeGranted(input.connection)) {
    // The connection provably lacks `userinfo.email` (e.g. a connection made
    // before the scope was requested). Do not call Google, and do NOT fall back
    // to the app login — the card says "Connected" until the operator
    // reconnects and grants the scope.
    return {};
  }

  let payload: unknown;
  try {
    payload = await input.fetchUserinfo();
  } catch {
    // Proxy down, token unusable, Google 403/5xx — unresolvable. Same rule: no
    // email beats the wrong email.
    return {};
  }

  const profile = parseGoogleUserinfoProfile(payload);
  if (!profile.email) return {};

  // `displayName` is rendered by its consumers as "the connected account" (the
  // connector status detail lines read `Connected as <displayName>`), so it is
  // an ACCOUNT label too and falls under the same rule as `email`. Google only
  // returns `name` when a profile scope was granted, and the Google connectors
  // request `userinfo.email` alone — so the usual case has no name. The honest
  // stand-in is then the account's own address; the one value it must never
  // hold is the app user's display name, which is what the end_user carried.
  return { email: profile.email, displayName: profile.displayName ?? profile.email };
}
