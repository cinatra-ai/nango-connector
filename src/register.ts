// The nango gateway's `register(ctx)` server entry (the serverEntry cutover,
// cinatra-ai/cinatra#151 Stage 1).
//
// nango is a `systemExtension`: the generated REQUIRED loader activates this
// entry UNGUARDED on every boot path (prod arms `required-extension-activation`
// — an activation failure fails boot). The body is therefore PROBE-SAFE and
// MINIMAL: no I/O, no eager host-service calls — it only (a) binds the
// injected config store + the blocking connection-materializer dispatch (both
// resolve their host service LAZILY at call time, so activation order against
// the host's boot imports never matters), and (b) registers the full
// nango-system capability surface the host resolves instead of importing this
// package.
//
// Least privilege: `getNangoClient` (the raw Nango SDK client) is NOT a
// member — the client stays connector-internal. Credential readers ARE
// members; the trust boundary is unchanged from the importable-module era
// (in-process host wiring; call sites own gating).
//
// HOST-PEER HYGIENE (host-peer-value-import ban): SDK imports here are
// TYPE-ONLY; the manage-permission guard for the save action arrives as a
// VALUE through the host's `@cinatra-ai/host:extension-action-guard` service
// (the openai actions-core precedent). This module imports LEAF modules only
// — never the package index, whose `@cinatra-ai/sdk-ui/nango` value re-export
// and React components must stay OUT of the serverEntry graph.

import "server-only";
import type { ExtensionHostContext, HostConnectorConfigService } from "@cinatra-ai/sdk-extensions";
import {
  CINATRA_NANGO_CONNECTION_IDS,
  CINATRA_NANGO_PROVIDER_CONFIG_KEYS,
  clearNangoConnectionRecords,
  deleteNangoConnection,
  deleteNangoConnectionStrict,
  ensureNangoIntegration,
  getNangoConnection,
  getNangoCredentials,
  getNangoFrontendConfig,
  getNangoOAuth2IntegrationCredentials,
  getNangoOAuthCallbackUrl,
  getNangoSettings,
  getNangoStatus,
  getPrimarySavedNangoConnection,
  getPrimarySavedNangoConnections,
  importNangoConnection,
  isNangoConfigured,
  listSavedNangoConnections,
  removeNangoConnectionRecord,
  saveNangoConnectionRecord,
} from "./nango";
import {
  createNangoConnectSession,
  ensureNangoConnectorIntegration,
} from "./nango-connect-ui";
import { NANGO_CONNECTOR_DEFINITIONS } from "./nango-connectors";
import {
  handleNangoConnectSessionRequest,
  handleNangoConnectionSaveRequest,
  handleNangoWebhookRequest,
} from "./route-handlers";
import { buildBearerAuthHeaderFromNango } from "./first-party-mcp";
import { makeSaveNangoConnectionAction } from "./actions-core";
import { setNangoConfigStore } from "./config-store";
import {
  setNangoConnectionMaterializerDispatch,
  type NangoConnectionMaterializeInput,
} from "./connection-materializer";

const PACKAGE_NAME = "@cinatra-ai/nango-connector";

// Capability ids are inlined string literals — the SDK constants are values
// and this graph must stay type-only (the gmail/openai serverEntry precedent).
const NANGO_SYSTEM_CAPABILITY = "nango-system";
const HOST_CONNECTOR_CONFIG_CAPABILITY = "@cinatra-ai/host:connector-config";
const HOST_ACTION_GUARD_CAPABILITY = "@cinatra-ai/host:extension-action-guard";
const NANGO_CONNECTION_MATERIALIZER_CAPABILITY = "nango-connection-materializer";

type HostActionGuard = {
  require(packageId: string, mode: "read" | "manage"): Promise<void>;
};

// Lazy per-concern host-service resolution — resolves at CALL time, never at
// activation, so a missing service fails loud at the first real use with a
// descriptive error (and never blocks the probe-safe activation itself).
function hostService<T>(ctx: ExtensionHostContext, capability: string): T {
  const provider = ctx.capabilities.resolveProviders(capability)[0];
  if (!provider) {
    throw new Error(
      `${PACKAGE_NAME}: host service "${capability}" is not registered — ` +
        `the host boot wiring (register-transport-connectors) must run before connector calls.`,
    );
  }
  return provider.impl as T;
}

export function register(ctx: ExtensionHostContext): void {
  // 1. Injected persistence: every connector-config read/write/delete in this
  // package now resolves the host's delete-capable config service at call time.
  const config = () =>
    hostService<HostConnectorConfigService>(ctx, HOST_CONNECTOR_CONFIG_CAPABILITY);
  setNangoConfigStore({
    read: (connectorId, fallback) => config().read(connectorId, fallback),
    write: (connectorId, value) => config().write(connectorId, value),
    delete: (connectorId) => config().delete(connectorId),
  });

  // 2. BLOCKING connection-save materialization (wordpress instance row /
  // linkedin account row): resolve the host's materializer providers at save
  // time; fail LOUD when a key that requires materialization finds no handler
  // (a failure fails the save — inline semantics preserved).
  setNangoConnectionMaterializerDispatch(async (input: NangoConnectionMaterializeInput) => {
    const providers = ctx.capabilities.resolveProviders(NANGO_CONNECTION_MATERIALIZER_CAPABILITY);
    let handled = false;
    for (const provider of providers) {
      const impl = provider.impl as {
        materialize?: (i: NangoConnectionMaterializeInput) => Promise<{ handled: boolean }>;
      };
      if (typeof impl?.materialize !== "function") continue;
      const result = await impl.materialize(input);
      if (result?.handled) handled = true;
    }
    if (!handled) {
      throw new Error(
        `${PACKAGE_NAME}: no registered materializer handled the "${input.connectorKey}" ` +
          `connection save — refusing the silent skip (the host must publish the ` +
          `"${NANGO_CONNECTION_MATERIALIZER_CAPABILITY}" service).`,
      );
    }
  });

  // 3. The manage-gated save action: same core as the "use server" export,
  // guard resolved LAZILY at action-call time (fail-closed when missing).
  const requireManage = async (): Promise<void> => {
    const provider = ctx.capabilities.resolveProviders(HOST_ACTION_GUARD_CAPABILITY)[0];
    const guard = provider?.impl as HostActionGuard | undefined;
    if (!guard || typeof guard.require !== "function") {
      throw new Error(
        `${PACKAGE_NAME}: host action-guard service is not registered — refusing the ungated action.`,
      );
    }
    await guard.require(PACKAGE_NAME, "manage");
  };
  const saveNangoConnectionAction = makeSaveNangoConnectionAction(requireManage);

  // 4. The nango-system surface — the ONE capability the host resolves in
  // place of every former `@cinatra-ai/nango-connector` / `@/lib/nango`
  // import. Function members keep their exact import-era signatures
  // (sync stays sync — `resolveCapabilityProviders` is synchronous by ABI);
  // the const key maps + connector definitions reach the host as members.
  ctx.capabilities.registerProvider(NANGO_SYSTEM_CAPABILITY, {
    packageName: PACKAGE_NAME,
    impl: {
      // settings/status (sync)
      isNangoConfigured,
      getNangoStatus,
      getNangoFrontendConfig,
      getNangoSettings,
      getNangoOAuthCallbackUrl,
      // saved-connection records (sync reads, async writes)
      listSavedNangoConnections,
      getPrimarySavedNangoConnection,
      getPrimarySavedNangoConnections,
      saveNangoConnectionRecord,
      removeNangoConnectionRecord,
      clearNangoConnectionRecords,
      // integrations + connections (async)
      ensureNangoIntegration,
      ensureNangoConnectorIntegration,
      importNangoConnection,
      getNangoConnection,
      getNangoCredentials,
      deleteNangoConnection,
      deleteNangoConnectionStrict,
      getNangoOAuth2IntegrationCredentials,
      createNangoConnectSession,
      buildBearerAuthHeaderFromNango,
      // route handler members (the host's /api/nango/* routes delegate here)
      handleNangoConnectSessionRequest,
      handleNangoConnectionSaveRequest,
      handleNangoWebhookRequest,
      // the manage-gated save action (host onboarding forwarder delegates)
      saveNangoConnectionAction,
      // const key maps + connector definitions (single author: this package)
      providerConfigKeys: CINATRA_NANGO_PROVIDER_CONFIG_KEYS,
      connectionIds: CINATRA_NANGO_CONNECTION_IDS,
      connectorDefinitions: NANGO_CONNECTOR_DEFINITIONS,
    },
  });
}
